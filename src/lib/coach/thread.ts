// ============================================================
// Stan wątku Coacha (server-only) — tabela `coach_threads` (migracja 0006).
//
// Jeden wiersz na usera:
//   • summary / summarized_until — streszczenie starszych tur (model `light`)
//   • slots                      — stan onboardingu (sloty profilu), JSONB
//   • offtopic_*                 — budżet nadużyć (seria off-topic + blokada)
//
// Brak tabeli (migracja niewgrana) NIE psuje czatu: stan żyje wtedy w
// pamięci procesu (best-effort, do cold startu) — zachowanie jak przed v2.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AbuseState } from '@/lib/ai/guard';
import type { UserStrategy } from './types';

export type SlotState = Partial<UserStrategy>;

export interface ThreadState {
  summary: string | null;
  summarizedUntil: string | null; // ISO created_at ostatniej streszczonej wiadomości
  slots: SlotState;
  abuse: AbuseState;
}

const EMPTY: ThreadState = {
  summary: null,
  summarizedUntil: null,
  slots: {},
  abuse: { streak: 0, lockedUntil: null },
};

const memory = new Map<string, ThreadState>();

interface ThreadRow {
  summary: string | null;
  summarized_until: string | null;
  slots: SlotState | null;
  offtopic_streak: number | null;
  offtopic_locked_until: string | null;
}

export async function loadThread(supabase: SupabaseClient, userId: string): Promise<ThreadState> {
  const { data, error } = await supabase
    .from('coach_threads')
    .select('summary, summarized_until, slots, offtopic_streak, offtopic_locked_until')
    .eq('user_id', userId)
    .maybeSingle<ThreadRow>();

  if (error || !data) return memory.get(userId) ?? { ...EMPTY, slots: {} };

  return {
    summary: data.summary,
    summarizedUntil: data.summarized_until,
    slots: data.slots ?? {},
    abuse: {
      streak: data.offtopic_streak ?? 0,
      lockedUntil: data.offtopic_locked_until ? Date.parse(data.offtopic_locked_until) : null,
    },
  };
}

export async function saveThread(
  supabase: SupabaseClient,
  userId: string,
  state: ThreadState,
): Promise<void> {
  memory.set(userId, state);
  const { error } = await supabase.from('coach_threads').upsert(
    {
      user_id: userId,
      summary: state.summary,
      summarized_until: state.summarizedUntil,
      slots: state.slots,
      offtopic_streak: state.abuse.streak,
      offtopic_locked_until: state.abuse.lockedUntil
        ? new Date(state.abuse.lockedUntil).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) console.warn('[coach/thread] persist skipped (memory only):', error.message);
}

// Reset pamięci (DELETE /api/coach) — wątek zaczyna się od zera.
export async function clearThread(supabase: SupabaseClient, userId: string): Promise<void> {
  memory.delete(userId);
  await supabase.from('coach_threads').delete().eq('user_id', userId);
}
