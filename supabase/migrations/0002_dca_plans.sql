-- ============================================================
-- Sigma Trade — DCA (Dollar-Cost Averaging): cykliczny zakup „za X$"
-- ============================================================
-- Jak zastosować:
--   Supabase → SQL Editor → wklej całość → Run.
-- Idempotentne (IF NOT EXISTS / DROP POLICY IF EXISTS) — można puścić ponownie.
--
-- Model: plan = „kupuj za amount_usd danego tickera co tydzień".
--   • amount_usd  — budżet w USD na jeden cykl (tygodniowy)
--   • carry_usd   — niewykorzystana reszta budżetu (bo handlujemy CAŁYMI akcjami):
--                   floor(budget/cena) akcji, reszta przechodzi na następny cykl
--   • next_run_at — kiedy plan jest „due"; cron skanuje codziennie i odpala due,
--                   po egzekucji przesuwa się o +7 dni
--
-- Bezpieczeństwo: RLS po auth.uid() (wzorzec z 0001). Cron działa kluczem
-- service-role (omija RLS po stronie serwera) — patrz src/lib/supabase/service.ts.
-- ============================================================

create table if not exists public.dca_plans (
  id            uuid primary key default gen_random_uuid(),
  portfolio_id  uuid not null references public.portfolios(id) on delete cascade,
  ticker        text not null,
  amount_usd    numeric(18,2) not null check (amount_usd > 0),
  carry_usd     numeric(18,2) not null default 0 check (carry_usd >= 0),
  status        text not null default 'active' check (status in ('active','paused','cancelled')),
  next_run_at   timestamptz not null default now(),
  last_run_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- Skan cron: „aktywne plany, które są już due" — indeks pod ten dokładnie filtr.
create index if not exists idx_dca_due
  on public.dca_plans (status, next_run_at);
create index if not exists idx_dca_portfolio
  on public.dca_plans (portfolio_id);

-- ============================================================
-- Row Level Security — user operuje tylko na planach swojego portfela.
-- ============================================================
alter table public.dca_plans enable row level security;

drop policy if exists "own dca plans" on public.dca_plans;
create policy "own dca plans" on public.dca_plans
  for all to authenticated
  using (portfolio_id in (select id from public.portfolios where user_id = auth.uid()))
  with check (portfolio_id in (select id from public.portfolios where user_id = auth.uid()));
