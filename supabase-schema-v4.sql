-- Brand My Bottle: schema v4 — visitor country tracking for the worldwide map.
--
-- Adds a country_code column to bmb_visitors so the "Live from the internet"
-- panel on the landing page can render a real world map showing where the
-- traffic is coming from.
--
--   * country_code = ISO-3166-1 alpha-2 (e.g. "US", "DE", "JP"), nullable.
--     Derived on the client from `Intl.DateTimeFormat().resolvedOptions().timeZone`
--     and passed on every /bmb-beat POST. The Edge Function validates + upserts.
--   * bmb_visitor_countries view = one row per country with visitor count,
--     exposed to anon so the SVG world map can fetch fills without service_role.
--
-- APPLY: run via Supabase Management API (POST /v1/projects/.../database/query).
--        DO NOT run `supabase db push`.

alter table public.bmb_visitors
  add column if not exists country_code text;

create index if not exists bmb_visitors_country
  on public.bmb_visitors (country_code);

drop view if exists public.bmb_visitor_countries;
create view public.bmb_visitor_countries
  with (security_invoker = false)
  as
    select country_code, count(*)::int as visitors
      from public.bmb_visitors
      where country_code is not null
      group by country_code;

grant select on public.bmb_visitor_countries to anon;

notify pgrst, 'reload schema';

-- Self-check (last SELECT is what the Management API returns).
select count(*)::int as country_rows from public.bmb_visitor_countries;
