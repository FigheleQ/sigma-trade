// ============================================================
// Konwersacje Coacha — server-only (tabela coach_conversations, 0008).
//
//   • `setup` — dokładnie jedna na usera, przypięta: onboarding, profil, plan.
//   • `chat`  — luźne rozmowy; każda ma WŁASNY kontekst (historia +
//     streszczenie), więc nowy chat = czysty kontekst. Między chatami
//     przechodzi tylko profil i pamięć faktów (memory.ts).
//
// Bez migracji 0008 (albo z flagą `conversations: false`) wszystko zwraca
// `null` i Coach działa jak wcześniej — jeden wątek na usera.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCoachFlags } from '@/lib/config';
import type { CoachConversation, CoachConversationKind } from './types';

export interface ConversationRow {
  id: string;
  kind: CoachConversationKind;
  title: string;
  summary: string | null;
  summarized_until: string | null;
  memory_extracted_until: string | null;
  updated_at: string;
}

const COLUMNS = 'id, kind, title, summary, summarized_until, memory_extracted_until, updated_at';
export const SETUP_TITLE = 'Setup & plan';
export const NEW_CHAT_TITLE = 'New chat';
// Limit chatów na usera — po przekroczeniu najstarszy znika (z wiadomościami, kaskadą).
export const MAX_CHATS = 30;

// ---- Dostępność (flaga + tabela) ------------------------------

// Pozytywny wynik zapamiętujemy na zawsze, negatywny na 60 s (żeby po
// wgraniu migracji funkcja włączyła się bez restartu serwera).
let available: boolean | null = null;
let checkedAt = 0;

export async function conversationsAvailable(supabase: SupabaseClient): Promise<boolean> {
  if (!getCoachFlags().conversations) return false;
  if (available === true) return true;
  if (available === false && Date.now() - checkedAt < 60_000) return false;
  const { error } = await supabase.from('coach_conversations').select('id').limit(1);
  available = !error;
  checkedAt = Date.now();
  if (error) console.warn('[coach/conversations] disabled (run migration 0008):', error.message);
  return available;
}

export const toClient = (r: ConversationRow): CoachConversation => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  updatedAt: r.updated_at,
});

// ---- Odczyt / tworzenie -----------------------------------------

export async function getOrCreateSetup(supabase: SupabaseClient, userId: string): Promise<ConversationRow | null> {
  const existing = await supabase
    .from('coach_conversations')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('kind', 'setup')
    .maybeSingle<ConversationRow>();
  if (existing.data) return existing.data;

  const created = await supabase
    .from('coach_conversations')
    .insert({ user_id: userId, kind: 'setup', title: SETUP_TITLE })
    .select(COLUMNS)
    .single<ConversationRow>();
  if (created.data) return created.data;

  // Wyścig dwóch żądań — unikalny indeks odrzucił drugi insert; czytamy ponownie.
  const retry = await supabase
    .from('coach_conversations')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('kind', 'setup')
    .maybeSingle<ConversationRow>();
  return retry.data ?? null;
}

// RLS gwarantuje, że user dostanie tylko swoją konwersację.
export async function getConversation(supabase: SupabaseClient, id: string): Promise<ConversationRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabase.from('coach_conversations').select(COLUMNS).eq('id', id).maybeSingle<ConversationRow>();
  return data ?? null;
}

export async function listConversations(supabase: SupabaseClient, userId: string): Promise<CoachConversation[]> {
  const setup = await getOrCreateSetup(supabase, userId);
  const { data } = await supabase
    .from('coach_conversations')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('kind', 'chat')
    .order('updated_at', { ascending: false })
    .limit(MAX_CHATS);
  const chats = ((data ?? []) as ConversationRow[]).map(toClient);
  return [...(setup ? [toClient(setup)] : []), ...chats];
}

export async function createChat(supabase: SupabaseClient, userId: string): Promise<ConversationRow | null> {
  const { data } = await supabase
    .from('coach_conversations')
    .insert({ user_id: userId, kind: 'chat', title: NEW_CHAT_TITLE })
    .select(COLUMNS)
    .single<ConversationRow>();
  await enforceChatLimit(supabase, userId);
  return data ?? null;
}

async function enforceChatLimit(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data } = await supabase
    .from('coach_conversations')
    .select('id')
    .eq('user_id', userId)
    .eq('kind', 'chat')
    .order('updated_at', { ascending: false })
    .range(MAX_CHATS, MAX_CHATS + 50);
  const stale = (data ?? []).map((r: { id: string }) => r.id);
  if (stale.length) await supabase.from('coach_conversations').delete().in('id', stale);
}

// Usuwa tylko `chat` — Setup nie da się usunąć (można go zresetować).
export async function deleteChat(supabase: SupabaseClient, id: string): Promise<boolean> {
  const conv = await getConversation(supabase, id);
  if (!conv || conv.kind !== 'chat') return false;
  const { error } = await supabase.from('coach_conversations').delete().eq('id', id);
  return !error;
}

// ---- Aktualizacje -----------------------------------------------

// Tytuł chatu z pierwszej wiadomości usera — bez modelu (0 tokenów).
export function titleFrom(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim();
  return clean.length <= 48 ? clean : `${clean.slice(0, 45).trimEnd()}…`;
}

export async function touchConversation(
  supabase: SupabaseClient,
  conv: ConversationRow,
  firstUserMessage: string | null,
): Promise<void> {
  const patch: Record<string, string> = { updated_at: new Date().toISOString() };
  if (conv.kind === 'chat' && conv.title === NEW_CHAT_TITLE && firstUserMessage) patch.title = titleFrom(firstUserMessage);
  await supabase.from('coach_conversations').update(patch).eq('id', conv.id);
}

export async function saveConversationSummary(
  supabase: SupabaseClient,
  id: string,
  summary: string,
  summarizedUntil: string,
): Promise<void> {
  const { error } = await supabase
    .from('coach_conversations')
    .update({ summary, summarized_until: summarizedUntil })
    .eq('id', id);
  if (error) console.warn('[coach/conversations] summary persist skipped:', error.message);
}

export async function markMemoryExtracted(supabase: SupabaseClient, id: string, until: string): Promise<void> {
  await supabase.from('coach_conversations').update({ memory_extracted_until: until }).eq('id', id);
}

// Reset Setupu: wiadomości i streszczenie Setupu znikają; chaty i pamięć zostają.
export async function resetSetup(supabase: SupabaseClient, userId: string): Promise<void> {
  const setup = await getOrCreateSetup(supabase, userId);
  if (!setup) return;
  await supabase.from('coach_messages').delete().eq('conversation_id', setup.id);
  await supabase
    .from('coach_conversations')
    .update({ summary: null, summarized_until: null, memory_extracted_until: null, updated_at: new Date().toISOString() })
    .eq('id', setup.id);
}
