-- ============================================================
-- pg_cron + pg_net — harmonogram sprawdzania TP/SL co minutę
--
-- Kontekst: Vercel Hobby nie pozwala na cron częstszy niż raz/dzień.
-- Rozwiązanie: pg_cron (wewnątrz Supabase Postgres) wywołuje
-- Supabase Edge Function check-tp-sl przez pg_net co minutę.
--
-- Jak zastosować:
--   Supabase → SQL Editor → wklej całość → Run.
--
-- Przed uruchomieniem uzupełnij:
--   1. Zastąp <PROJECT_REF> swoim ID projektu Supabase
--      (widoczny w URL: https://supabase.com/dashboard/project/<PROJECT_REF>)
--   2. Ustaw sekret FINNHUB_API_KEY w panelu:
--      Supabase → Edge Functions → Secrets → Add new secret
-- ============================================================

-- Rozszerzenia (wymagają uprawnień superuser — dostępne w Supabase)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Usuń poprzedni harmonogram jeśli istnieje (idempotentne)
select cron.unschedule('check-tp-sl') where exists (
  select 1 from cron.job where jobname = 'check-tp-sl'
);

-- Zarejestruj wywołanie edge function co minutę
select cron.schedule(
  'check-tp-sl',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/check-tp-sl',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
