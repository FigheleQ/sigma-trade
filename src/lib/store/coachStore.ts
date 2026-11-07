import { create } from 'zustand';
import type {
  CoachConversation,
  CoachMemoryFact,
  CoachMessage,
  CoachTurn,
  CoachReply,
  Recommendation,
  UserStrategy,
} from '@/lib/coach/types';
import { getRecommendations, saveStrategy } from '@/lib/coach/strategyClient';
import { describeSlots, type SlotState } from '@/lib/coach/slots';

// ----------------------------------------------------------------
// Typy stanu
// ----------------------------------------------------------------

export type CoachStatus = 'idle' | 'loading' | 'sending' | 'error';
// Widok panelu: rozmowa, lista konwersacji albo pamięć o userze.
export type CoachPanelView = 'chat' | 'chats' | 'memory';

interface CoachState {
  messages: CoachMessage[];
  status: CoachStatus;
  errorMessage: string | null;

  // Onboarding
  initialized: boolean; // czy pobraliśmy już wątek z /api/coach
  needsOnboarding: boolean; // świeży/legacy user → bot oprowadza
  isOnboarded: boolean; // onboarding zakończony (profil zebrany)
  strategy: UserStrategy | null; // profil zebrany w onboardingu
  tilesEnabled: boolean; // onboarding na kafelkach (flaga serwera)

  // Rekomendacje (po onboardingu, tylko w Setupie)
  recommendations: Recommendation[];
  recommendationsSource: 'api' | 'mock' | null;

  // Konwersacje i pamięć (migracja 0008; false → jeden wątek jak wcześniej)
  conversationsEnabled: boolean;
  activeConversation: CoachConversation | null; // null = Setup / stary tryb
  conversations: CoachConversation[];
  memory: CoachMemoryFact[];
  view: CoachPanelView;
}

interface CoachActions {
  init: () => Promise<void>; // pobierz Setup, wykryj onboarding, ewentualnie powitaj
  sendMessage: (text: string) => Promise<void>;
  submitOnboarding: (slots: SlotState) => Promise<void>; // wybór z kafelków → plan
  resetConversation: () => Promise<void>; // reset Setupu (profil + wątek Setupu)
  reset: () => void; // tylko stan klienta (np. wylogowanie)

  setView: (view: CoachPanelView) => void;
  loadConversations: () => Promise<void>;
  openConversation: (id: string | null) => Promise<void>; // null = Setup
  newChat: () => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  loadMemory: () => Promise<void>;
  forgetFact: (id: string) => Promise<void>;
  forgetAll: () => Promise<void>;
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

// Odpowiedź /api/coach: CoachReply + pola addytywne AI v2.
type CoachApiReply = CoachReply & {
  offTopic?: boolean;
  recommendations?: Recommendation[];
};

interface ThreadResponse {
  messages: CoachMessage[];
  needsOnboarding: boolean;
  profileComplete?: boolean;
  onboardingTiles?: boolean;
  strategy?: UserStrategy | null;
  conversationsEnabled?: boolean;
  conversation?: CoachConversation | null;
}

// Zaczepka pierwszego wejścia — bot przywita i ruszy onboarding.
const ONBOARDING_KICKOFF: CoachTurn = {
  role: 'user',
  content: 'Hi, I just opened the app. Please introduce yourself and get me started.',
};

const INITIAL: CoachState = {
  messages: [],
  status: 'idle',
  errorMessage: null,
  initialized: false,
  needsOnboarding: false,
  isOnboarded: false,
  strategy: null,
  tilesEnabled: false,
  recommendations: [],
  recommendationsSource: null,
  conversationsEnabled: false,
  activeConversation: null,
  conversations: [],
  memory: [],
  view: 'chat',
};

// ----------------------------------------------------------------
// Store
// ----------------------------------------------------------------

export const useCoachStore = create<CoachState & CoachActions>((set, get) => ({
  ...INITIAL,

  init: async () => {
    if (get().initialized || get().status === 'loading') return;
    await loadThread(set, get, null, { kickoff: true });
  },

  sendMessage: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().status === 'sending') return;
    await runTurn(set, get, { role: 'user', content: trimmed }, { persistUserBubble: true });
  },

  submitOnboarding: async (slots) => {
    if (get().status === 'sending') return;
    // Bąbel usera = to samo zdanie, które zbuduje serwer (describeSlots).
    await runTurn(
      set,
      get,
      { role: 'user', content: describeSlots(slots) },
      { persistUserBubble: true, extraBody: { slots } },
    );
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

    // Reset dotyczy Setupu: czyścimy jego stan i odpalamy onboarding od zera.
    // Lista chatów i pamięć zostają (serwer też ich nie rusza).
    set({
      ...INITIAL,
      conversations: get().conversations,
      memory: get().memory,
    });
    await get().init();
  },

  reset: () => set({ ...INITIAL }),

  // ---- Konwersacje ----

  setView: (view) => {
    set({ view });
    if (view === 'chats') void get().loadConversations();
    if (view === 'memory') void get().loadMemory();
  },

  loadConversations: async () => {
    try {
      const res = await fetch('/api/coach/conversations');
      if (!res.ok) return;
      const data = (await res.json()) as { conversations: CoachConversation[] };
      set({ conversations: data.conversations });
    } catch {
      // lista nie jest krytyczna
    }
  },

  openConversation: async (id) => {
    if (get().status === 'sending') return;
    set({ view: 'chat' });
    await loadThread(set, get, id, { kickoff: id == null });
  },

  newChat: async () => {
    if (get().status === 'sending') return;
    const active = get().activeConversation;
    try {
      const res = await fetch('/api/coach/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Chat, z którego wychodzimy, przechodzi ekstrakcję pamięci w tle.
        body: JSON.stringify({ previousConversationId: active?.kind === 'chat' ? active.id : undefined }),
      });
      if (!res.ok) throw new Error(`Could not start a new chat (${res.status})`);
      const { conversation } = (await res.json()) as { conversation: CoachConversation };
      // Nowy chat = czysty kontekst: pusta lista wiadomości, bez GET.
      set({
        activeConversation: conversation,
        messages: [],
        view: 'chat',
        status: 'idle',
        errorMessage: null,
        conversations: [conversation, ...get().conversations.filter((c) => c.id !== conversation.id)],
      });
    } catch (err) {
      set({ status: 'error', errorMessage: err instanceof Error ? err.message : 'Network error' });
    }
  },

  deleteChat: async (id) => {
    try {
      const res = await fetch(`/api/coach/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) return;
      set({ conversations: get().conversations.filter((c) => c.id !== id) });
      // Usunięty aktywny chat → wracamy do Setupu.
      if (get().activeConversation?.id === id) await get().openConversation(null);
    } catch {
      // ignorujemy — lista odświeży się przy następnym otwarciu
    }
  },

  // ---- Pamięć ----

  loadMemory: async () => {
    try {
      const res = await fetch('/api/coach/memory');
      if (!res.ok) return;
      const data = (await res.json()) as { facts: CoachMemoryFact[] };
      set({ memory: data.facts });
    } catch {
      // brak pamięci nie psuje czatu
    }
  },

  forgetFact: async (id) => {
    const res = await fetch(`/api/coach/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) set({ memory: get().memory.filter((f) => f.id !== id) });
  },

  forgetAll: async () => {
    const res = await fetch('/api/coach/memory', { method: 'DELETE' }).catch(() => null);
    if (res?.ok) set({ memory: [] });
  },
}));

// ----------------------------------------------------------------
// Ładowanie wątku (Setup albo wskazany chat)
// ----------------------------------------------------------------

async function loadThread(
  set: (partial: Partial<CoachState>) => void,
  get: () => CoachState & CoachActions,
  conversationId: string | null,
  opts: { kickoff: boolean },
): Promise<void> {
  set({ status: 'loading', errorMessage: null });
  try {
    const url = conversationId ? `/api/coach?conversation=${encodeURIComponent(conversationId)}` : '/api/coach';
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`Failed to load chat (${res.status})`);
    const data = (await res.json()) as ThreadResponse;
    const tilesEnabled = data.onboardingTiles === true;
    const isChat = data.conversation?.kind === 'chat';

    set({
      messages: data.messages,
      needsOnboarding: data.needsOnboarding,
      // Przy kafelkach o „onboarded" decyduje kompletny profil (sloty), nie
      // to, że bot już coś powiedział (powitanie to jeszcze nie profil).
      isOnboarded: tilesEnabled ? data.profileComplete === true : !data.needsOnboarding,
      tilesEnabled,
      strategy: data.strategy ?? get().strategy,
      conversationsEnabled: data.conversationsEnabled === true,
      activeConversation: data.conversation ?? null,
      initialized: true,
      status: 'idle',
    });

    // Setup z kompletnym profilem → plan przeliczany deterministycznie
    // (bez AI), żeby nie znikał po odświeżeniu.
    if (!isChat && data.strategy && get().recommendations.length === 0) {
      const strategy = data.strategy;
      void getRecommendations(strategy)
        .then(({ recommendations, source }) => set({ recommendations, recommendationsSource: source }))
        .catch(() => undefined);
    }

    // Świeży/legacy user z pustym Setupem → bot wita i zadaje 1. pytanie.
    if (opts.kickoff && !isChat && data.needsOnboarding && data.messages.length === 0) {
      await runTurn(set, get, ONBOARDING_KICKOFF, {
        persistUserBubble: false,
        extraBody: tilesEnabled ? { kickoff: true } : undefined,
      });
    }
  } catch (err) {
    set({
      status: 'error',
      errorMessage: err instanceof Error ? err.message : 'Network error',
      initialized: true,
    });
  }
}

// ----------------------------------------------------------------
// Wspólna logika tury — wysyła wiadomość do /api/coach, dopisuje
// odpowiedź, a po zakończeniu onboardingu pobiera rekomendacje od C.
// ----------------------------------------------------------------

async function runTurn(
  set: (partial: Partial<CoachState>) => void,
  get: () => CoachState & CoachActions,
  userTurn: CoachTurn,
  opts: { persistUserBubble: boolean; extraBody?: Record<string, unknown> },
): Promise<void> {
  // Bąbel usera w UI (kickoff onboardingu nie pokazujemy).
  const baseMessages = get().messages;
  const optimistic = opts.persistUserBubble
    ? [...baseMessages, localMessage('user', userTurn.content)]
    : baseMessages;
  const conversationId = get().activeConversation?.id;

  set({ messages: optimistic, status: 'sending', errorMessage: null });

  try {
    // AI v2: wysyłamy TYLKO nową wiadomość — historię (przyciętą, bez
    // off-topic, ze streszczeniem) składa serwer z coach_messages.
    const res = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userTurn.content,
        strategy: get().strategy,
        ...(conversationId ? { conversationId } : {}),
        ...opts.extraBody,
      }),
    });

    if (!res.ok) {
      let serverMsg: string | null = null;
      try {
        serverMsg = ((await res.json()) as { error?: string }).error ?? null;
      } catch {
        // body nie-JSON
      }
      const msg =
        res.status === 429
          ? (serverMsg ?? 'Coach is rate limited — try again in a moment.')
          : res.status === 503 && serverMsg
            ? serverMsg
            : `Coach error (${res.status})`;
      set({ status: 'error', errorMessage: msg });
      return;
    }

    const reply = (await res.json()) as CoachApiReply;
    const userBubble = optimistic[optimistic.length - 1];
    set({
      // Para off-topic: oznaczamy (UI ją przygasza; serwer pomija ją w historii).
      messages: [
        ...(reply.offTopic && opts.persistUserBubble
          ? [...baseMessages, { ...userBubble, offTopic: true }]
          : optimistic),
        { ...localMessage('model', reply.reply), ...(reply.offTopic ? { offTopic: true } : {}) },
      ],
      status: 'idle',
    });

    // Tytuł nowego chatu nadaje serwer z 1. wiadomości — odśwież listę w tle.
    const active = get().activeConversation;
    if (active?.kind === 'chat' && active.title === 'New chat' && !reply.offTopic) {
      void get().loadConversations().then(() => {
        const updated = get().conversations.find((c) => c.id === active.id);
        if (updated) set({ activeConversation: updated });
      });
    }

    // Onboarding domknięty → zapisz profil u C i pobierz rekomendacje.
    if (reply.onboardingComplete && reply.strategy) {
      set({
        strategy: reply.strategy,
        isOnboarded: true,
        needsOnboarding: false,
      });
      // Serwer (flaga C włączona) policzył już plan i zapisał profil —
      // nie dublujemy zapytań do /api/strategy.
      if (Array.isArray(reply.recommendations) && reply.recommendations.length > 0) {
        set({ recommendations: reply.recommendations, recommendationsSource: 'api' });
        return;
      }
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
export const selectIsChatActive = (s: CoachState) => s.activeConversation?.kind === 'chat';
