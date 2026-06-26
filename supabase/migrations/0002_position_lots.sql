-- ============================================================
-- Sigma Trade — Faza 2: loty pozycji z TP/SL
-- ============================================================
-- Każde otwarcie pozycji (zakup) tworzy osobny lot z opcjonalnym TP/SL.
-- Tabela `positions` pozostaje jako agregat (ilość + avg entry).
-- ============================================================

-- ── Loty pozycji ─────────────────────────────────────────────
create table if not exists public.position_lots (
  id              uuid primary key default gen_random_uuid(),
  portfolio_id    uuid not null references public.portfolios(id) on delete cascade,
  ticker          text not null,
  quantity        integer not null check (quantity > 0),
  entry_price     numeric(18,4) not null,
  take_profit     numeric(18,4),           -- opcjonalny TP (cena absolutna)
  stop_loss       numeric(18,4),           -- opcjonalny SL (cena absolutna)
  status          text not null default 'open'
                    check (status in ('open', 'closed')),
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  close_price     numeric(18,4),
  close_reason    text check (close_reason in ('manual', 'take_profit', 'stop_loss'))
);

-- ── Indeksy ──────────────────────────────────────────────────
create index if not exists idx_lots_portfolio    on public.position_lots(portfolio_id);
create index if not exists idx_lots_ticker       on public.position_lots(ticker);
create index if not exists idx_lots_status       on public.position_lots(status);
create index if not exists idx_lots_open_tp_sl   on public.position_lots(status, take_profit, stop_loss)
  where status = 'open';

-- ── RLS ──────────────────────────────────────────────────────
alter table public.position_lots enable row level security;

drop policy if exists "own lots" on public.position_lots;
create policy "own lots" on public.position_lots
  for all to authenticated
  using (portfolio_id in (select id from public.portfolios where user_id = auth.uid()))
  with check (portfolio_id in (select id from public.portfolios where user_id = auth.uid()));

-- Polityka serwisowa (cron / service_role) — dostęp do wszystkich lotów przy TP/SL check.
drop policy if exists "service role full access lots" on public.position_lots;
create policy "service role full access lots" on public.position_lots
  for all to service_role
  using (true) with check (true);
