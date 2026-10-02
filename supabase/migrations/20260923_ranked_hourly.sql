-- Ranked-Karten wechseln jede Stunde (statt alle 12 Stunden). Kennung: Datum + Stunde in Berlin-Zeit, z. B. 2026092214.
-- Die Wochengrenze (Mittwoch 12:00) ist weiterhin eine Stundengrenze; die Wochenwertung summiert wie bisher den besten Lauf je Karte.

create or replace function public.ranked_slot(p_ts timestamptz default now())
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_ts at time zone 'Europe/Berlin', 'YYYYMMDDHH24');
$$;

create or replace function public.ranked_info()
returns table (slot text, starts_at timestamptz, ends_at timestamptz, server_now timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select public.ranked_slot(now()),
         date_trunc('hour', now()),
         date_trunc('hour', now()) + interval '1 hour',
         now();
$$;

-- submit_score: gleiche Prüfungen wie zuvor, nur das Ranked-Fenster ist jetzt eine Stunde lang
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
  -- Ranked-Karten zählen nur in ihrer Stunde (die vorherige Karte noch für angefangene Runden)
  if p_race is not null and p_race like 'ranked-%' then
    if p_race not in ('ranked-' || public.ranked_slot(now()), 'ranked-' || public.ranked_slot(now() - interval '1 hour')) then
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

revoke all on function public.ranked_slot(timestamptz) from public, anon, authenticated;
revoke all on function public.ranked_info(),
  public.submit_score(uuid, text, uuid, integer, real, integer, integer, integer, integer, integer, text, text, text, integer[]) from public;
grant execute on function public.ranked_info() to anon, authenticated;
grant execute on function public.submit_score(uuid, text, uuid, integer, real, integer, integer, integer, integer, integer, text, text, text, integer[]) to anon, authenticated;
