-- ============================================================
-- Sigma Trade — Coach: przypięty Setup + luźne chaty + pamięć o userze
-- ============================================================
-- Jak zastosować:
--   Supabase → SQL Editor → wklej całość → Run.
-- Idempotentne — można puścić ponownie. Wymaga 0003 (coach_messages).
-- Nic nie usuwa: istniejące wiadomości trafiają do konwersacji „Setup".
-- (Supabase może pokazać ostrzeżenie przez DROP POLICY IF EXISTS — to tylko
--  odtworzenie reguł RLS o tych samych nazwach.)
--
-- Model:
--   • coach_conversations — 1 przypięta konwersacja `setup` na usera
--     (onboarding, profil, plan) + dowolne `chat` (luźne rozmowy, każda z
--     własnym kontekstem i streszczeniem),
--   • coach_messages.conversation_id — wiadomość należy do konwersacji,
--   • coach_user_memory — krótkie fakty o userze wyciągane z rozmów
--     (cele, preferencje, ograniczenia), widoczne i usuwalne przez usera.
-- Bezpieczeństwo: RLS po auth.uid() — wzorzec z 0001.
-- ============================================================

-- ── Konwersacje ─────────────────────────────────────────────
create table if not exists public.coach_conversations (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  kind                    text not null check (kind in ('setup','chat')),
  title                   text not null default 'New chat' check (char_length(title) <= 80),
  summary                 text,          -- 1–2 zdania o starszych turach TEJ konwersacji
  summarized_until        timestamptz,
  memory_extracted_until  timestamptz,   -- do kiedy wiadomości przeszły ekstrakcję pamięci
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Dokładnie jedna konwersacja `setup` na usera.
create unique index if not exists uq_coach_conversations_setup
  on public.coach_conversations(user_id) where kind = 'setup';
create index if not exists idx_coach_conversations_user_updated
  on public.coach_conversations(user_id, updated_at desc);

-- ── Wiadomości → konwersacja ────────────────────────────────
alter table public.coach_messages
  add column if not exists conversation_id uuid
  references public.coach_conversations(id) on delete cascade;
create index if not exists idx_coach_messages_conversation_created
  on public.coach_messages(conversation_id, created_at);

-- Backfill: każdy user z historią dostaje konwersację Setup, a jego
-- dotychczasowe wiadomości do niej trafiają (nic nie ginie).
insert into public.coach_conversations (user_id, kind, title)
select distinct m.user_id, 'setup', 'Setup & plan'
from public.coach_messages m
where not exists (
  select 1 from public.coach_conversations c where c.user_id = m.user_id and c.kind = 'setup'
);

update public.coach_messages m
set conversation_id = c.id
from public.coach_conversations c
where m.conversation_id is null and c.user_id = m.user_id and c.kind = 'setup';

-- Streszczenie z coach_threads (0006) przechodzi na konwersację Setup.
do $$
begin
  if to_regclass('public.coach_threads') is not null then
    update public.coach_conversations c
    set summary = t.summary, summarized_until = t.summarized_until
    from public.coach_threads t
    where c.user_id = t.user_id and c.kind = 'setup' and c.summary is null and t.summary is not null;
  end if;
end $$;

-- ── Pamięć o userze ─────────────────────────────────────────
create table if not exists public.coach_user_memory (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  fact                    text not null check (char_length(fact) between 8 and 160),
  category                text not null default 'other'
                          check (category in ('goal','preference','constraint','experience','other')),
  source_conversation_id  uuid references public.coach_conversations(id) on delete set null,
  created_at              timestamptz not null default now()
);
create index if not exists idx_coach_user_memory_user_created
  on public.coach_user_memory(user_id, created_at);

-- ============================================================
-- Row Level Security — user widzi i zmienia tylko swoje dane
-- ============================================================
alter table public.coach_conversations enable row level security;
alter table public.coach_user_memory   enable row level security;

drop policy if exists "own coach conversations" on public.coach_conversations;
create policy "own coach conversations" on public.coach_conversations
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own coach memory" on public.coach_user_memory;
create policy "own coach memory" on public.coach_user_memory
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
