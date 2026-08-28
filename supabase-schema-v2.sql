-- Brand My Bottle: schema v2 — add Stripe deposit flow.
--
-- Bids are now written EXCLUSIVELY by the `bmb-stripe-webhook` Edge Function
-- (using the service_role key), after Stripe has captured the 20% deposit.
-- The anon INSERT policy is removed so the browser can no longer bypass Stripe
-- and drop free rows into `bmb_bids`.
--
-- Idempotency: the webhook keys off `stripe_session_id`. Stripe redelivers
-- events; a UNIQUE constraint here makes the second delivery a harmless no-op.
--
-- APPLY: run via Management API against project kmzjbyndzgaxkrdbrdof
--        (scripts/sbq.ps1 or POST /v1/projects/{ref}/database/query).

-- 1. New column for idempotency + audit
alter table public.bmb_bids
  add column if not exists stripe_session_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bmb_bids_stripe_session_id_key'
  ) then
    alter table public.bmb_bids
      add constraint bmb_bids_stripe_session_id_key unique (stripe_session_id);
  end if;
end $$;

-- 2. Close the anon INSERT door — only service_role writes bids now.
drop policy if exists bmb_bids_anon_insert on public.bmb_bids;
revoke insert on public.bmb_bids from anon;

-- 3. Confirm service_role can write (implicit in Supabase, but explicit is safer).
grant insert, select, update on public.bmb_bids to service_role;

-- 4. Refresh PostgREST cache so the new column is visible to the API.
notify pgrst, 'reload schema';

-- 5. Self-check (last SELECT is what the Management API returns).
select
  (select exists (
     select 1 from information_schema.columns
     where table_schema='public' and table_name='bmb_bids'
       and column_name='stripe_session_id'
   )) as has_stripe_session_id,
  (select exists (
     select 1 from pg_policies
     where schemaname='public' and tablename='bmb_bids'
       and policyname='bmb_bids_anon_insert'
   )) as anon_insert_policy_still_present,
  (select has_table_privilege('anon', 'public.bmb_bids', 'INSERT')) as anon_can_insert,
  (select has_table_privilege('service_role', 'public.bmb_bids', 'INSERT')) as service_role_can_insert;
