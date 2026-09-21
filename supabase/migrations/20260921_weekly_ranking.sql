-- Wochenwertung: Die Rangliste startet jeden Mittwoch um 12:00 Uhr (Europe/Berlin) neu.
-- Nach Ablauf bekommen alle Platzierten Belohnungen (Münzen; Plätze 1-3 zusätzlich Sonderpreise).
-- Alles liegt in der Datenbank: Die Wertung wird aus den Scores der jeweiligen Woche berechnet, die Ergebnisse werden
-- beim ersten Abruf nach Wochenende "eingefroren" (finalize_weeks) und bleiben gespeichert, bis sie abgeholt sind.

-- ---------------------------------------------------------------------------
-- Wochenfenster
-- ---------------------------------------------------------------------------
create or replace function public.week_start(p_ts timestamptz default now())
returns timestamptz
language sql
stable
set search_path = ''
as $$
  with l as (select (p_ts at time zone 'Europe/Berlin') as t),
       c as (
         select t,
                date_trunc('day', t) - (((extract(isodow from t)::int - 3) + 7) % 7) * interval '1 day' + interval '12 hours' as cand
         from l
       )
  select (case when cand > t then cand - interval '7 days' else cand end) at time zone 'Europe/Berlin' from c;
$$;

create or replace function public.week_end(p_ts timestamptz default now())
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((public.week_start(p_ts) at time zone 'Europe/Berlin') + interval '7 days') at time zone 'Europe/Berlin';
$$;

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------
create table if not exists public.week_members (
  week_start timestamptz not null,
  player_id uuid not null references public.players(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (week_start, player_id)
);
create table if not exists public.week_results (
  week_start timestamptz not null,
  player_id uuid not null references public.players(id) on delete cascade,
  rank integer not null check (rank >= 1),
  score integer not null check (score >= 0),
  coins integer not null check (coins >= 0),
  item text check (item is null or item in ('champion', 'silver', 'bronze')),
  claimed boolean not null default false,
  claimed_at timestamptz,
  primary key (week_start, player_id)
);
create index if not exists week_results_player_idx on public.week_results (player_id, claimed);
create table if not exists public.week_finalized (
  week_start timestamptz primary key,
  finalized_at timestamptz not null default now(),
  participants integer not null
);
alter table public.week_members enable row level security;
alter table public.week_results enable row level security;
alter table public.week_finalized enable row level security;
revoke all on public.week_members, public.week_results, public.week_finalized from anon, authenticated;

-- Wer sich registriert oder einen Score einreicht, ist automatisch in der Wertung der laufenden Woche
-- (zwei Funktionen, weil PL/pgSQL kein Feld anspricht, das es in der jeweiligen Tabelle nicht gibt)
create or replace function public._join_week_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.week_members (week_start, player_id) values (public.week_start(), new.id) on conflict do nothing;
  return new;
end;
$$;
create or replace function public._join_week_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.week_members (week_start, player_id) values (public.week_start(), new.player_id) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists players_join_week on public.players;
create trigger players_join_week after insert on public.players
  for each row execute function public._join_week_player();
drop trigger if exists scores_join_week on public.scores;
create trigger scores_join_week after insert on public.scores
  for each row execute function public._join_week_score();

-- ---------------------------------------------------------------------------
-- Preise (gleiche Tabelle steht in js/config.js → WEEKLY_PRIZES)
-- ---------------------------------------------------------------------------
create or replace function public.week_prize_coins(p_rank integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_rank = 1 then 1500 when p_rank = 2 then 1000 when p_rank = 3 then 750
    when p_rank = 4 then 500 when p_rank = 5 then 400 when p_rank = 6 then 320
    when p_rank = 7 then 260 when p_rank = 8 then 210 when p_rank = 9 then 170
    when p_rank = 10 then 140
    when p_rank <= 15 then 100 when p_rank <= 25 then 70 when p_rank <= 50 then 40
    else 25 end;
$$;

-- Rangfolge einer Woche: bester Score, bei Gleichstand wer ihn zuerst erreicht hat. Nur Spieler mit Score > 0.
create or replace function public._week_ranking(p_week timestamptz)
returns table (player_id uuid, best integer, at_best timestamptz, rn integer)
language sql
stable
set search_path = ''
as $$
  with sc as (
    select s.player_id,
           max(s.score)::integer as best,
           (array_agg(s.created_at order by s.score desc, s.created_at asc))[1] as at_best
    from public.scores s
    where s.created_at >= p_week and s.created_at < public.week_end(p_week)
    group by s.player_id
  )
  select sc.player_id, sc.best, sc.at_best, (row_number() over (order by sc.best desc, sc.at_best asc, sc.player_id))::integer
  from sc
  where sc.best > 0;
$$;

-- ---------------------------------------------------------------------------
-- Öffentlich lesbar: Woche und Live-Rangliste
-- ---------------------------------------------------------------------------
create or replace function public.week_info()
returns table (week_start timestamptz, ends_at timestamptz, server_now timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select public.week_start(), public.week_end(), now();
$$;

create or replace function public.leaderboard_week(p_limit integer default 50)
returns table (player_id uuid, name text, car text, color text, best integer, runs integer, wins integer)
language sql
stable
security definer
set search_path = ''
as $$
  with w as (select public.week_start() as ws),
  sc as (
    select s.player_id,
           max(s.score)::integer as best,
           count(*)::integer as runs,
           (array_agg(s.created_at order by s.score desc, s.created_at asc))[1] as at_best
    from public.scores s, w
    where s.created_at >= w.ws and s.created_at < public.week_end(w.ws)
    group by s.player_id
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

-- Wer hat mich eingeladen? (nur der Name – der steht ohnehin in der Rangliste)
create or replace function public.invite_info(p_code text)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.name from public.players p
  where p.friend_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Mit Anmeldung: Woche beitreten, Belohnungen abholen
-- ---------------------------------------------------------------------------
create or replace function public.join_week(p_player uuid, p_secret text)
returns table (week_start timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._check_secret(p_player, p_secret) then
    raise exception 'Ungültiger Spieler' using errcode = '28000';
  end if;
  insert into public.week_members (week_start, player_id) values (public.week_start(), p_player) on conflict do nothing;
  return query select public.week_start(), public.week_end();
end;
$$;

-- Vergangene Wochen abschließen (idempotent, von jedem Client auslösbar; niemand muss "der Server" sein)
create or replace function public.finalize_weeks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  w timestamptz;
  n integer := 0;
  cur timestamptz := public.week_start();
begin
  perform pg_advisory_xact_lock(7331);
  for w in
    select distinct public.week_start(s.created_at)
    from public.scores s
    where public.week_start(s.created_at) < cur
      and not exists (select 1 from public.week_finalized f where f.week_start = public.week_start(s.created_at))
  loop
    insert into public.week_results (week_start, player_id, rank, score, coins, item)
    select w, r.player_id, r.rn, r.best, public.week_prize_coins(r.rn),
           case r.rn when 1 then 'champion' when 2 then 'silver' when 3 then 'bronze' end
    from public._week_ranking(w) r;
    insert into public.week_finalized (week_start, participants)
    values (w, (select count(*) from public._week_ranking(w)));
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Nicht abgeholte Belohnungen. Sie bleiben, bis der Client sie mit ack_rewards bestätigt (kein Verlust bei Abbruch).
create or replace function public.claim_rewards(p_player uuid, p_secret text)
returns table (week_start timestamptz, rank integer, score integer, coins integer, item text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._check_secret(p_player, p_secret) then
    raise exception 'Ungültiger Spieler' using errcode = '28000';
  end if;
  perform public.finalize_weeks();
  return query
    select r.week_start, r.rank, r.score, r.coins, r.item
    from public.week_results r
    where r.player_id = p_player and not r.claimed
    order by r.week_start;
end;
$$;

create or replace function public.ack_rewards(p_player uuid, p_secret text, p_weeks timestamptz[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  if not public._check_secret(p_player, p_secret) then
    raise exception 'Ungültiger Spieler' using errcode = '28000';
  end if;
  update public.week_results r
     set claimed = true, claimed_at = now()
   where r.player_id = p_player and not r.claimed and r.week_start = any (coalesce(p_weeks, '{}'));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Rechte: nur die gewollten Funktionen sind von außen aufrufbar
revoke all on function public.week_start(timestamptz), public.week_end(timestamptz), public.week_prize_coins(integer),
  public._week_ranking(timestamptz), public._join_week_player(), public._join_week_score(), public.finalize_weeks() from public, anon, authenticated;
revoke all on function public.join_week(uuid, text), public.claim_rewards(uuid, text), public.ack_rewards(uuid, text, timestamptz[]),
  public.week_info(), public.leaderboard_week(integer), public.invite_info(text) from public;
grant execute on function public.week_info(), public.leaderboard_week(integer), public.invite_info(text) to anon, authenticated;
grant execute on function public.join_week(uuid, text), public.claim_rewards(uuid, text), public.ack_rewards(uuid, text, timestamptz[]) to anon, authenticated;

-- Bestehende Spieler kommen direkt in die laufende Woche
insert into public.week_members (week_start, player_id)
select public.week_start(), p.id from public.players p
on conflict do nothing;
