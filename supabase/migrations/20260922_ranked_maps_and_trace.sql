-- Ranked-Karten (wechseln alle 12 Stunden), Wochenwertung aus Ranked-Runden und ein strengerer Cheat-Schutz.

-- ---------------------------------------------------------------------------
-- 12-Stunden-Fenster (Berlin 00:00 und 12:00 – die Wochengrenze Mi 12:00 ist also immer auch eine Grenze)
-- ---------------------------------------------------------------------------
create or replace function public.ranked_slot(p_ts timestamptz default now())
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_ts at time zone 'Europe/Berlin', 'YYYYMMDD')
         || case when extract(hour from (p_ts at time zone 'Europe/Berlin')) < 12 then 'a' else 'b' end;
$$;

create or replace function public.ranked_info()
returns table (slot text, starts_at timestamptz, ends_at timestamptz, server_now timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with l as (select (now() at time zone 'Europe/Berlin') as t),
       s as (select t, date_trunc('day', t) + case when extract(hour from t) < 12 then interval '0 hours' else interval '12 hours' end as st from l)
  select public.ranked_slot(now()),
         (s.st at time zone 'Europe/Berlin'),
         ((s.st + interval '12 hours') at time zone 'Europe/Berlin'),
         now()
  from s;
$$;

-- Live-Rangliste der aktuellen (oder einer vergangenen) Ranked-Karte: bester Score je Spieler
create or replace function public.leaderboard_ranked(p_slot text, p_limit integer default 50)
returns table (player_id uuid, name text, car text, color text, best integer, runs integer)
language sql
stable
security definer
set search_path = ''
as $$
  with sc as (
    select s.player_id, max(s.score)::integer as best, count(*)::integer as runs,
           (array_agg(s.created_at order by s.score desc, s.created_at asc))[1] as at_best
    from public.scores s
    where s.race_id = 'ranked-' || coalesce(nullif(p_slot, ''), public.ranked_slot())
    group by s.player_id
  )
  select p.id, p.name, p.car, p.color, sc.best, sc.runs
  from sc join public.players p on p.id = sc.player_id
  order by sc.best desc, sc.at_best asc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- ---------------------------------------------------------------------------
-- Wochenwertung = Summe der besten Ranked-Runden je Karte (bis zu 14 Karten pro Woche)
-- ---------------------------------------------------------------------------
create or replace function public._week_ranking(p_week timestamptz)
returns table (player_id uuid, best integer, at_best timestamptz, rn integer)
language sql
stable
set search_path = ''
as $$
  with per_map as (
    select s.player_id, s.race_id,
           max(s.score) as sc,
           (array_agg(s.created_at order by s.score desc, s.created_at asc))[1] as at_best
    from public.scores s
    where s.race_id like 'ranked-%' and s.created_at >= p_week and s.created_at < public.week_end(p_week)
    group by s.player_id, s.race_id
  ),
  tot as (
    select pm.player_id, sum(pm.sc)::integer as best, max(pm.at_best) as at_best
    from per_map pm group by pm.player_id
  )
  select tot.player_id, tot.best, tot.at_best, (row_number() over (order by tot.best desc, tot.at_best asc, tot.player_id))::integer
  from tot
  where tot.best > 0;
$$;

create or replace function public.leaderboard_week(p_limit integer default 50)
returns table (player_id uuid, name text, car text, color text, best integer, runs integer, wins integer)
language sql
stable
security definer
set search_path = ''
as $$
  with w as (select public.week_start() as ws),
  per_map as (
    select s.player_id, s.race_id, max(s.score) as sc, count(*) as n,
           (array_agg(s.created_at order by s.score desc, s.created_at asc))[1] as at_best
    from public.scores s, w
    where s.race_id like 'ranked-%' and s.created_at >= w.ws and s.created_at < public.week_end(w.ws)
    group by s.player_id, s.race_id
  ),
  sc as (
    select pm.player_id, sum(pm.sc)::integer as best, sum(pm.n)::integer as runs, max(pm.at_best) as at_best
    from per_map pm group by pm.player_id
  ),
  mem as (
    select m.player_id from public.week_members m, w where m.week_start = w.ws
    union
    select sc.player_id from sc
  )
  select p.id, p.name, p.car, p.color,
         coalesce(sc.best, 0),
         coalesce(sc.runs, 0),
         (select count(*) from public.week_results r where r.player_id = p.id and r.rank = 1)::integer
  from mem
  join public.players p on p.id = mem.player_id
  left join sc on sc.player_id = p.id
  order by coalesce(sc.best, 0) desc, sc.at_best asc nulls last, p.created_at asc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- ---------------------------------------------------------------------------
-- Cheat-Schutz: Fahrtverlauf ("Trace") prüfen
-- Der Client meldet alle 1,5 Sekunden Spielzeit die gefahrene Strecke. Der Server prüft, ob dieser Verlauf zur
-- Physik passt (Höchst- und Mindesttempo je Zeitpunkt), zum Endstand und zur Fahrzeit. Ein erfundener Score braucht
-- damit einen stimmigen Verlauf, nicht nur eine plausible Endzahl.
-- ---------------------------------------------------------------------------
create or replace function public._base_speed(p_t double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$ select 25 + 47 * least(greatest(p_t, 0), 180) / 180.0; $$;

create or replace function public._trace_ok(p_trace integer[], p_score integer, p_dur double precision)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  n integer := coalesce(array_length(p_trace, 1), 0);
  expected integer := floor(p_dur / 1.5);
  bad integer;
  v_last integer;
begin
  -- Kurze Runden brauchen keinen Verlauf
  if p_score < 400 and n = 0 then return true; end if;
  if n = 0 or n > 400 then return false; end if;
  if abs(n - expected) > 2 then return false; end if;
  select count(*) into bad
  from (
    select v, ord, coalesce(lag(v) over (order by ord), 0) as prev
    from unnest(p_trace) with ordinality as u(v, ord)
  ) x
  where x.v < x.prev                                                                                     -- rückwärts
     or (x.v - x.prev) > 1.5 * (public._base_speed(x.ord * 1.5) * 2.9 * 1.03) + 3                           -- schneller als physikalisch möglich
     or (x.ord > 4 and (x.v - x.prev) < 1.5 * public._base_speed((x.ord - 1) * 1.5) * 0.6);                -- langsamer als das Mindesttempo
  if bad > 0 then return false; end if;
  v_last := p_trace[n];
  -- Endstand passt zum Verlauf (höchstens ein angefangenes Intervall danach)
  if v_last > p_score + 5 then return false; end if;
  if p_score - v_last > 1.6 * (public._base_speed(p_dur) * 2.9 * 1.03) + 10 then return false; end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_score: Ranked-Fenster prüfen und Trace verlangen
-- ---------------------------------------------------------------------------
drop function if exists public.submit_score(uuid, text, uuid, integer, real, integer, integer, integer, integer, integer, text, text, text);

create or replace function public.submit_score(
  p_player uuid, p_secret text, p_run uuid, p_score integer, p_duration real, p_coins integer,
  p_near integer, p_overtakes integer, p_smashed integer, p_level integer, p_car text,
  p_party text default null, p_race text default null, p_trace integer[] default null
)
returns table(rank integer, best integer, is_record boolean)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_started timestamptz;
  v_elapsed double precision;
  v_dur double precision;
  v_max double precision;
  v_old_best integer;
  v_new_best integer;
  v_today date := (now() at time zone 'utc')::date;
begin
  if not public._check_secret(p_player, p_secret) then
    raise exception 'Ungültiger Spieler' using errcode = '28000';
  end if;

  -- Runde sperren und als benutzt markieren (jede Runde zählt genau einmal)
  select r.started_at into v_started
  from public.runs r
  where r.id = p_run and r.player_id = p_player and not r.used
  for update;
  if v_started is null then
    raise exception 'Ungültige oder bereits verwendete Runde' using errcode = '22023';
  end if;
  update public.runs set used = true where runs.id = p_run;

  v_elapsed := extract(epoch from (now() - v_started));
  if p_duration is null or p_duration < 1 then
    raise exception 'Ungültige Fahrzeit' using errcode = '22023';
  end if;
  if p_duration > v_elapsed + 1.5 then
    raise exception 'Fahrzeit passt nicht zur Rundenzeit' using errcode = '22023';
  end if;
  v_dur := least(p_duration::double precision, v_elapsed);

  -- Physikalische Obergrenze: Grundtempo steigt in 180 s von 25 auf 72 m/s,
  -- das schnellste Auto schafft mit Boost und Nitro höchstens das 2,4-fache.
  if v_dur <= 180 then
    v_max := 25 * v_dur + 47.0 / 360.0 * v_dur * v_dur;
  else
    v_max := 8730 + 72 * (v_dur - 180);
  end if;
  v_max := v_max * 2.4 + 100;
  if p_score is null or p_score < 0 or p_score > v_max then
    raise exception 'Unplausibler Score' using errcode = '22023';
  end if;
  if coalesce(p_coins, 0) > 25 * v_dur + 2000
     or coalesce(p_near, 0) > 3 * v_dur + 5
     or coalesce(p_overtakes, 0) > 6 * v_dur + 10
     or coalesce(p_smashed, 0) > coalesce(p_overtakes, 0) + 5 then
    raise exception 'Unplausible Werte' using errcode = '22023';
  end if;

  -- Aktivität passt zur Strecke (mindestens ein überholtes/gerammtes Auto pro 90 m nach den ersten 500 m)
  if coalesce(p_overtakes, 0) + coalesce(p_smashed, 0) < (p_score - 500) / 90.0 then
    raise exception 'Unplausible Werte' using errcode = '22023';
  end if;
  -- Level steigt alle 12 s um eins (Höchstwert 15)
  if coalesce(p_level, 1) > least(15, 2 + floor(v_dur / 12.0)) then
    raise exception 'Unplausible Werte' using errcode = '22023';
  end if;

  -- Fahrtverlauf muss zu Physik, Fahrzeit und Endstand passen
  if not public._trace_ok(p_trace, p_score, v_dur) then
    raise exception 'Fahrtverlauf unplausibel' using errcode = '22023';
  end if;

  -- Tagesrennen zählen nur für den heutigen (oder gestrigen) UTC-Tag
  if p_race is not null and p_race like 'daily-%' then
    if p_race not in ('daily-' || to_char(v_today, 'YYYYMMDD'), 'daily-' || to_char(v_today - 1, 'YYYYMMDD')) then
      raise exception 'Dieses Tagesrennen ist abgelaufen' using errcode = '22023';
    end if;
  end if;
  -- Ranked-Karten zählen nur in ihrem 12-Stunden-Fenster (die vorherige Karte noch für angefangene Runden)
  if p_race is not null and p_race like 'ranked-%' then
    if p_race not in ('ranked-' || public.ranked_slot(now()), 'ranked-' || public.ranked_slot(now() - interval '13 hours')) then
      raise exception 'Diese Ranked-Karte ist abgelaufen' using errcode = '22023';
    end if;
  end if;

  select pl.best_score into v_old_best from public.players pl where pl.id = p_player;

  insert into public.scores (player_id, score, duration, coins, near_misses, overtakes, smashed, level, car, party, race_id)
  values (p_player, p_score, v_dur, greatest(coalesce(p_coins, 0), 0), greatest(coalesce(p_near, 0), 0),
          greatest(coalesce(p_overtakes, 0), 0), greatest(coalesce(p_smashed, 0), 0),
          least(greatest(coalesce(p_level, 1), 1), 99), p_car, p_party, p_race);

  v_new_best := greatest(coalesce(v_old_best, 0), p_score);
  update public.players
     set best_score = v_new_best, runs = players.runs + 1, car = p_car, last_seen = now()
   where players.id = p_player;

  return query
    select (1 + (select count(*) from public.players o where o.best_score > v_new_best))::integer,
           v_new_best,
           p_score > coalesce(v_old_best, 0);
end;
$function$;

-- Rechte
revoke all on function public._base_speed(double precision), public._trace_ok(integer[], integer, double precision), public.ranked_slot(timestamptz) from public, anon, authenticated;
revoke all on function public.ranked_info(), public.leaderboard_ranked(text, integer),
  public.submit_score(uuid, text, uuid, integer, real, integer, integer, integer, integer, integer, text, text, text, integer[]) from public;
grant execute on function public.ranked_info(), public.leaderboard_ranked(text, integer) to anon, authenticated;
grant execute on function public.submit_score(uuid, text, uuid, integer, real, integer, integer, integer, integer, integer, text, text, text, integer[]) to anon, authenticated;
