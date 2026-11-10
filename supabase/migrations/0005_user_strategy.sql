-- ============================================================
-- Sigma Trade — Warstwa C: profil inwestycyjny usera (user_strategy)
-- ============================================================
-- Jak zastosować:
--   Supabase → SQL Editor → wklej całość → Run.
-- Idempotentne (IF NOT EXISTS / DROP POLICY IF EXISTS) — można puścić ponownie.
--
-- Po wgraniu: `features.strategy_agent.enabled: true` w config.yaml
-- włącza /api/strategy i /api/strategy/recommendations (silnik allocate.ts).
-- Bezpieczeństwo: RLS po auth.uid() — wzorzec z 0001.
-- ============================================================

create table if not exists public.user_strategy (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  -- Pola kontraktu (wymagane)
  level                 text not null check (level in ('beginner','intermediate','advanced')),
  risk                  text not null check (risk in ('low','medium','high')),
  budget                numeric(18,2) not null check (budget > 0),
  interests             text[] not null default '{}',
  -- AI v2 (opcjonalne, addytywnie)
  horizon_years         integer check (horizon_years is null or horizon_years between 1 and 60),
  monthly_contribution  numeric(18,2) check (monthly_contribution is null or monthly_contribution >= 0),
  drawdown_comfort      text check (drawdown_comfort is null or drawdown_comfort in ('low','medium','high')),
  preferred_instruments text[],
  dividend_preference   boolean,
  exclusions            text[],
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ============================================================
-- Row Level Security — user widzi i zmienia tylko swój profil
-- ============================================================
alter table public.user_strategy enable row level security;

drop policy if exists "own strategy" on public.user_strategy;
create policy "own strategy" on public.user_strategy
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
