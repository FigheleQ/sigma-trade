-- ============================================================
-- Sigma Trade — AI v2: wspólny cache opisów spółek (ticker_profiles)
-- ============================================================
-- Jak zastosować:
--   Supabase → SQL Editor → wklej całość → Run.
-- Idempotentne — można puścić ponownie.
--
-- Opis tickera (2 zdania, model Flash-Lite) generuje się RAZ i służy
-- wszystkim userom — wzorzec jak price_cache (dane rynkowe, nie dane usera).
-- Bez tej tabeli opisy żyją tylko w pamięci procesu serwera.
-- ============================================================

create table if not exists public.ticker_profiles (
  ticker       text primary key check (ticker ~ '^[A-Z]{1,5}$'),
  description  text not null check (char_length(description) between 20 and 500),
  model        text,
  created_at   timestamptz not null default now()
);

alter table public.ticker_profiles enable row level security;

-- Czytają wszyscy zalogowani (wspólny cache).
drop policy if exists "read ticker profiles" on public.ticker_profiles;
create policy "read ticker profiles" on public.ticker_profiles
  for select to authenticated using (true);

-- Zapis: zalogowani (serwer działa w kontekście usera). Treść waliduje
-- serwer (bez cyfr, ≤ 420 znaków) + check constraint powyżej.
drop policy if exists "write ticker profiles" on public.ticker_profiles;
create policy "write ticker profiles" on public.ticker_profiles
  for insert to authenticated with check (true);

drop policy if exists "update ticker profiles" on public.ticker_profiles;
create policy "update ticker profiles" on public.ticker_profiles
  for update to authenticated using (true) with check (true);
