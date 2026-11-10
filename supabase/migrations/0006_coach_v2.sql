-- ============================================================
-- Sigma Trade — AI v2: Coach (guardrails, sloty, streszczenia, telemetria)
-- ============================================================
-- Jak zastosować:
--   Supabase → SQL Editor → wklej całość → Run.
-- Idempotentne (IF NOT EXISTS / DROP POLICY IF EXISTS) — można puścić ponownie.
-- Wymaga 0003_coach.sql (coach_messages).
--
-- Bez tej migracji Coach dalej działa: stan wątku trzyma pamięć procesu,
-- pary off-topic nie są zapisywane, a telemetria idzie tylko do logów.
-- Bezpieczeństwo: RLS po auth.uid() — wzorzec z 0001.
-- ============================================================

-- ── Flaga off-topic na wiadomościach ────────────────────────
-- Pary odcięte przez guardrails zapisujemy (żeby UI je pokazał po reloadzie),
-- ale POMIJAMY przy budowie historii dla modelu (nie zaśmiecają kontekstu).
alter table public.coach_messages
  add column if not exists off_topic boolean not null default false;

-- ── Stan wątku (1 wiersz / user) ────────────────────────────
create table if not exists public.coach_threads (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  summary               text,                       -- 1–2 zdania o starszych turach
  summarized_until      timestamptz,                -- created_at ostatniej streszczonej wiadomości
  slots                 jsonb not null default '{}'::jsonb,  -- sloty profilu (onboarding)
  offtopic_streak       integer not null default 0, -- seria off-topic pod rząd
  offtopic_locked_until timestamptz,                -- blokada modelu (budżet nadużyć)
  updated_at            timestamptz not null default now()
);

-- ── Telemetria kosztu AI (opcjonalna, flaga coach_agent.usage_log) ──
create table if not exists public.ai_usage_log (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  route          text not null,
  purpose        text not null,          -- chat | intent_gate | slot_extract | summary | news_analysis
  model          text not null,          -- 'none' = tura ucięta przez gate (0 wywołań)
  prompt_tokens  integer not null default 0,
  output_tokens  integer not null default 0,
  cached_tokens  integer not null default 0,
  retried        boolean not null default false,
  ok             boolean not null default true,
  gate           text not null default 'none',  -- none | local | light | budget | rate_limited
  latency_ms     integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists idx_ai_usage_log_user_created
  on public.ai_usage_log(user_id, created_at);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.coach_threads enable row level security;
alter table public.ai_usage_log  enable row level security;

drop policy if exists "own coach thread" on public.coach_threads;
create policy "own coach thread" on public.coach_threads
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Telemetria: user może tylko DOPISYWAĆ i czytać swoje wiersze.
drop policy if exists "insert own ai usage" on public.ai_usage_log;
create policy "insert own ai usage" on public.ai_usage_log
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "read own ai usage" on public.ai_usage_log;
create policy "read own ai usage" on public.ai_usage_log
  for select to authenticated
  using (user_id = auth.uid());
