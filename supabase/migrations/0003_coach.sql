-- ============================================================
-- Sigma Trade — Faza „bot": Coach (czat onboardingowy) — Agent A
-- ============================================================
-- Jak zastosować:
--   Supabase → SQL Editor → wklej całość → Run.
-- Idempotentne (IF NOT EXISTS / DROP POLICY IF EXISTS) — można puścić ponownie.
--
-- Model: historia rozmowy usera z botem (multi-turn). Role zgodne z Gemini
-- `contents`: 'user' / 'model'. Bezpieczeństwo: RLS po auth.uid() — wzorzec z 0001.
-- ============================================================

-- ── Wiadomości czatu Coacha ─────────────────────────────────
create table if not exists public.coach_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('user','model')),
  content     text not null,
  created_at  timestamptz not null default now()
);

-- Wątek czytamy chronologicznie per user.
create index if not exists idx_coach_messages_user_created
  on public.coach_messages(user_id, created_at);

-- ============================================================
-- Row Level Security — user widzi i pisze tylko swój wątek
-- ============================================================
alter table public.coach_messages enable row level security;

drop policy if exists "own coach messages" on public.coach_messages;
create policy "own coach messages" on public.coach_messages
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
