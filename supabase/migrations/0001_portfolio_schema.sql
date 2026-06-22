-- ============================================================
-- Sigma Trade — Faza 1: schemat portfela (paper trading)
-- ============================================================
-- Jak zastosować:
--   Supabase → SQL Editor → wklej całość → Run.
-- Idempotentne (IF NOT EXISTS / DROP POLICY IF EXISTS) — można puścić ponownie.
--
-- Model: 1 portfel na użytkownika, akcje long-only, całe sztuki.
-- Bezpieczeństwo: RLS oparte o auth.uid() — user widzi tylko swoje dane.
-- ============================================================

-- ── Portfele ─────────────────────────────────────────────────
create table if not exists public.portfolios (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  cash            numeric(18,2) not null default 100000,
  initial_balance numeric(18,2) not null default 100000,
  created_at      timestamptz not null default now(),
  unique (user_id)                       -- jeden portfel na usera (Faza 1)
);

-- ── Otwarte pozycje (jedna na ticker, avg entry ważona) ──────
create table if not exists public.positions (
  id              uuid primary key default gen_random_uuid(),
  portfolio_id    uuid not null references public.portfolios(id) on delete cascade,
  ticker          text not null,
  quantity        integer not null check (quantity > 0),   -- całe akcje
  avg_entry_price numeric(18,4) not null,
  opened_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (portfolio_id, ticker)
);

-- ── Historia transakcji (niezmienny ledger) ─────────────────
create table if not exists public.trades (
  id            uuid primary key default gen_random_uuid(),
  portfolio_id  uuid not null references public.portfolios(id) on delete cascade,
  ticker        text not null,
  side          text not null check (side in ('buy','sell')),
  quantity      integer not null check (quantity > 0),
  price         numeric(18,4) not null,        -- cena wykonania, zapisana na sztywno
  realized_pnl  numeric(18,2),                 -- tylko przy 'sell' (zamknięcie części)
  executed_at   timestamptz not null default now()
);

-- ── Cache cen — WSPÓLNY dla wszystkich userów (klucz = ticker) ─
-- Serwuje watchlistę i daje fallback ceny dla egzekucji zleceń, odciążając
-- darmowy limit Finnhub (jedno realne zapytanie na ticker na okno TTL).
create table if not exists public.price_cache (
  ticker         text primary key,
  price          numeric(18,4) not null,
  change         numeric(18,4),
  change_percent numeric(18,4),
  fetched_at     timestamptz not null default now()
);
-- Dla istniejących instalacji (gdy tabela powstała wcześniej bez tych kolumn):
alter table public.price_cache add column if not exists change         numeric(18,4);
alter table public.price_cache add column if not exists change_percent numeric(18,4);

-- ── Indeksy pod skalowanie ──────────────────────────────────
create index if not exists idx_positions_portfolio on public.positions(portfolio_id);
create index if not exists idx_trades_portfolio     on public.trades(portfolio_id);
create index if not exists idx_trades_executed       on public.trades(executed_at desc);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.portfolios enable row level security;
alter table public.positions  enable row level security;
alter table public.trades     enable row level security;
alter table public.price_cache enable row level security;

-- Portfele: user operuje tylko na swoim
drop policy if exists "own portfolio" on public.portfolios;
create policy "own portfolio" on public.portfolios
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Pozycje: tylko z portfela należącego do usera
drop policy if exists "own positions" on public.positions;
create policy "own positions" on public.positions
  for all to authenticated
  using (portfolio_id in (select id from public.portfolios where user_id = auth.uid()))
  with check (portfolio_id in (select id from public.portfolios where user_id = auth.uid()));

-- Transakcje: jw.
drop policy if exists "own trades" on public.trades;
create policy "own trades" on public.trades
  for all to authenticated
  using (portfolio_id in (select id from public.portfolios where user_id = auth.uid()))
  with check (portfolio_id in (select id from public.portfolios where user_id = auth.uid()));

-- Cache cen: dane rynkowe wspólne — każdy zalogowany czyta i odświeża
drop policy if exists "read prices" on public.price_cache;
create policy "read prices" on public.price_cache
  for select to authenticated using (true);

drop policy if exists "write prices" on public.price_cache;
create policy "write prices" on public.price_cache
  for all to authenticated using (true) with check (true);
