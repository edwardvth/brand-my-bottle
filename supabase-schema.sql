-- Brand My Bottle: schema for reusing commit.cash's Supabase project.
-- Everything is prefixed `bmb_` and lives in the public schema alongside commit-cash
-- tables. No changes to any existing commit-cash table.
--
-- APPLY: copy-paste into the Supabase SQL editor for project kmzjbyndzgaxkrdbrdof.
-- It's idempotent — safe to re-run.

-- ------------------------------------------------------------
-- 1. Bids table (source of truth for every bid ever placed)
-- ------------------------------------------------------------
create table if not exists public.bmb_bids (
  id            uuid primary key default gen_random_uuid(),
  spot_id       smallint not null check (spot_id between 1 and 10),
  amount_cents  int not null check (amount_cents >= 100),          -- min $1
  brand         text not null check (char_length(brand) between 1 and 80),
  email         text not null check (email ~ '^[^@]+@[^@]+\.[^@]+$'),
  website       text check (website is null or char_length(website) <= 200),
  x_handle      text check (x_handle is null or char_length(x_handle) <= 30),
  logo_url      text,
  created_at    timestamptz not null default now()
);
create index if not exists bmb_bids_spot_amt
  on public.bmb_bids (spot_id, amount_cents desc, created_at desc);

-- ------------------------------------------------------------
-- 2. Public view: top bid per spot, NO PII (email is not exposed)
-- ------------------------------------------------------------
drop view if exists public.bmb_current_bids;
create view public.bmb_current_bids
  with (security_invoker = false)      -- runs as the view owner, bypasses RLS on base
  as
  select distinct on (spot_id)
    spot_id, amount_cents, brand, x_handle, website, logo_url, created_at
  from public.bmb_bids
  order by spot_id, amount_cents desc, created_at desc;

grant select on public.bmb_current_bids to anon;

-- ------------------------------------------------------------
-- 3. RLS: anon can INSERT bids; anon CANNOT SELECT the base table
--    (protects email addresses — browsers read via the view above).
-- ------------------------------------------------------------
alter table public.bmb_bids enable row level security;

drop policy if exists bmb_bids_anon_insert on public.bmb_bids;
create policy bmb_bids_anon_insert
  on public.bmb_bids
  for insert
  to anon
  with check (true);
-- Intentionally no SELECT policy → anon can't read bids directly.

grant insert on public.bmb_bids to anon;

-- ------------------------------------------------------------
-- 4. Logo storage bucket (public read, anon can upload)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('bmb-logos', 'bmb-logos', true)
on conflict (id) do nothing;

drop policy if exists bmb_logo_read   on storage.objects;
drop policy if exists bmb_logo_upload on storage.objects;

create policy bmb_logo_read
  on storage.objects for select
  to public
  using (bucket_id = 'bmb-logos');

create policy bmb_logo_upload
  on storage.objects for insert
  to anon
  with check (bucket_id = 'bmb-logos');

-- Refresh PostgREST schema cache so the new view + table are visible immediately
notify pgrst, 'reload schema';
