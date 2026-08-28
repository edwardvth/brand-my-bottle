-- Brand My Bottle: schema v3 — bid history view + visitor presence tracking.
--
-- Two additions, both anon-safe:
--   1. `bmb_bid_history` view = full chronological bid feed for the History tab.
--      No email column, ever. Anon reads via the view; the view is owner-owned
--      (security_invoker = false) so it bypasses RLS on bmb_bids.
--   2. `bmb_visitors` table + `bmb_stats` view = "X visiting now / Y all-time"
--      badges. Raw table is service-role only; anon reads only the aggregate
--      view. Writes go through the `bmb-beat` Edge Function using service_role.
--
-- APPLY: run via Management API against project kmzjbyndzgaxkrdbrdof.
--        DO NOT run `supabase db push`.

-- ------------------------------------------------------------
-- 1. Bid history view (chronological, no PII)
-- ------------------------------------------------------------
drop view if exists public.bmb_bid_history;
create view public.bmb_bid_history
  with (security_invoker = false)
  as
  select
    id, spot_id, amount_cents, brand, x_handle, website, logo_url, created_at
  from public.bmb_bids
  order by created_at desc;

grant select on public.bmb_bid_history to anon;

-- ------------------------------------------------------------
-- 2. Visitor presence
-- ------------------------------------------------------------
create table if not exists public.bmb_visitors (
  token       uuid primary key,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists bmb_visitors_last_seen
  on public.bmb_visitors (last_seen desc);

alter table public.bmb_visitors enable row level security;
-- No SELECT / INSERT / UPDATE policy for anon: the Edge Function writes with
-- service_role, which bypasses RLS. Belt-and-suspenders: revoke privileges.
revoke all on public.bmb_visitors from anon;

drop view if exists public.bmb_stats;
create view public.bmb_stats
  with (security_invoker = false)
  as
    select
      (select count(*)::int from public.bmb_visitors
        where last_seen > now() - interval '5 minutes') as visiting_now,
      (select count(*)::int from public.bmb_visitors)    as total_visitors;

grant select on public.bmb_stats to anon;

-- ------------------------------------------------------------
-- 3. Reload PostgREST cache so new relations are visible immediately.
-- ------------------------------------------------------------
notify pgrst, 'reload schema';

-- 4. Self-check (last SELECT is what the Management API returns).
select
  (select count(*) from public.bmb_bid_history) as bid_history_rows,
  (select visiting_now from public.bmb_stats)  as visiting_now,
  (select total_visitors from public.bmb_stats) as total_visitors;
