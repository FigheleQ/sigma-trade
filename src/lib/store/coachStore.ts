import { create } from 'zustand';
import type {
  CoachMessage,
  CoachTurn,
  CoachReply,
  Recommendation,
  UserStrategy,
} from '@/lib/coach/types';
import { getRecommendations, saveStrategy } from '@/lib/coach/strategyClient';

// ----------------------------------------------------------------
// Typy stanu
// ----------------------------------------------------------------

export type CoachStatus = 'idle' | 'loading' | 'sending' | 'error';

interface CoachState {
  messages: CoachMessage[];
  status: CoachStatus;
  errorMessage: string | null;

  // Onboarding
  initialized: boolean; // czy pobraliśmy już wątek z /api/coach
  needsOnboarding: boolean; // świeży/legacy user → bot oprowadza
  isOnboarded: boolean; // onboarding zakończony (profil zebrany)
  strategy: UserStrategy | null; // profil zebrany w onboardingu

  // Rekomendacje (po onboardingu)
  recommendations: Recommendation[];
  recommendationsSource: 'api' | 'mock' | null;
}

interface CoachActions {
  init: () => Promise<void>; // pobierz wątek, wykryj onboarding, ewentualnie powitaj
  sendMessage: (text: string) => Promise<void>;
  resetConversation: () => Promise<void>; // skasuj pamięć w bazie i zacznij od nowa
  reset: () => void; // tylko stan klienta (np. wylogowanie)
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

let msgSeq = 0;
function localMessage(role: CoachMessage['role'], content: string): CoachMessage {
  return {
    id: `local-${Date.now()}-${msgSeq++}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

// Historia w formacie modelu (lekkie tury) z aktualnych wiadomości.
function toTurns(messages: CoachMessage[]): CoachTurn[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

// Zaczepka pierwszego wejścia — bot przywita i ruszy onboarding.
const ONBOARDING_KICKOFF: CoachTurn = {
  role: 'user',
  content: 'Hi, I just opened the app. Please introduce yourself and get me started.',
};

// ----------------------------------------------------------------
// Store
// ----------------------------------------------------------------

export const useCoachStore = create<CoachState & CoachActions>((set, get) => ({
  messages: [],
  status: 'idle',
  errorMessage: null,
  initialized: false,
  needsOnboarding: false,
  isOnboarded: false,
  strategy: null,
  recommendations: [],
  recommendationsSource: null,

  init: async () => {
    if (get().initialized || get().status === 'loading') return;
    set({ status: 'loading', errorMessage: null });

    try {
      const res = await fetch('/api/coach', { method: 'GET' });
      if (!res.ok) throw new Error(`Failed to load chat (${res.status})`);
      const data = (await res.json()) as {
        messages: CoachMessage[];
        needsOnboarding: boolean;
      };

      set({
        messages: data.messages,
        needsOnboarding: data.needsOnboarding,
        isOnboarded: !data.needsOnboarding,
        initialized: true,
        status: 'idle',
      });

      // Świeży/legacy user z pustym wątkiem → bot wita i zadaje 1. pytanie.
      if (data.needsOnboarding && data.messages.length === 0) {
        await runTurn(set, get, ONBOARDING_KICKOFF, { persistUserBubble: false });
      }
    } catch (err) {
      set({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Network error',
        initialized: true,
      });
    }
  },

  sendMessage: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().status === 'sending') return;
    await runTurn(set, get, { role: 'user', content: trimmed }, { persistUserBubble: true });
  },

  resetConversation: async () => {
    if (get().status === 'sending' || get().status === 'loading') return;
    set({ status: 'loading', errorMessage: null });

    try {
      const res = await fetch('/api/coach', { method: 'DELETE' });
      if (!res.ok) throw new Error(`Reset failed (${res.status})`);
    } catch (err) {
      set({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Reset failed',
      });
      return;
    }

    // Czyścimy stan i odpalamy onboarding od zera (init wykryje pusty wątek).
    set({
      messages: [],
      status: 'idle',
      errorMessage: null,
      initialized: false,
      needsOnboarding: false,
      isOnboarded: false,
      strategy: null,
      recommendations: [],
      recommendationsSource: null,
    });
    await get().init();
  },

  reset: () =>
    set({
      messages: [],
      status: 'idle',
      errorMessage: null,
      initialized: false,
      needsOnboarding: false,
      isOnboarded: false,
      strategy: null,
      recommendations: [],
      recommendationsSource: null,
    }),
}));

// ----------------------------------------------------------------
// Wspólna logika tury — wysyła historię do /api/coach, dopisuje
// odpowiedź, a po zakończeniu onboardingu pobiera rekomendacje od C.
// ----------------------------------------------------------------

async function runTurn(
  set: (partial: Partial<CoachState>) => void,
  get: () => CoachState & CoachActions,
  userTurn: CoachTurn,
  opts: { persistUserBubble: boolean },
): Promise<void> {
  // Bąbel usera w UI (kickoff onboardingu nie pokazujemy).
  const baseMessages = get().messages;
  const optimistic = opts.persistUserBubble
    ? [...baseMessages, localMessage('user', userTurn.content)]
    : baseMessages;

  set({ messages: optimistic, status: 'sending', errorMessage: null });

  const history: CoachTurn[] = [...toTurns(baseMessages), userTurn];

  try {
    const res = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history, strategy: get().strategy }),
    });

    if (!res.ok) {
      const msg =
        res.status === 429
          ? 'Coach is rate limited — try again in a moment.'
          : `Coach error (${res.status})`;
      set({ status: 'error', errorMessage: msg });
      return;
    }

    const reply = (await res.json()) as CoachReply;
    set({
      messages: [...optimistic, localMessage('model', reply.reply)],
      status: 'idle',
    });

    // Onboarding domknięty → zapisz profil u C i pobierz rekomendacje.
    if (reply.onboardingComplete && reply.strategy) {
      set({
        strategy: reply.strategy,
        isOnboarded: true,
        needsOnboarding: false,
      });
      void saveStrategy(reply.strategy);
      try {
        const { recommendations, source } = await getRecommendations(reply.strategy);
        set({ recommendations, recommendationsSource: source });
      } catch {
        // brak rekomendacji nie psuje czatu
      }
    }
  } catch (err) {
    set({
      status: 'error',
      errorMessage: err instanceof Error ? err.message : 'Network error',
    });
  }
}

// ----------------------------------------------------------------
// Selektory
// ----------------------------------------------------------------

export const selectCoachMessages = (s: CoachState) => s.messages;
export const selectCoachStatus = (s: CoachState) => s.status;
export const selectCoachRecommendations = (s: CoachState) => s.recommendations;
export const selectCoachIsOnboarded = (s: CoachState) => s.isOnboarded;
