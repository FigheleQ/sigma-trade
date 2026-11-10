// ============================================================
// /api/coach — czat z Coachem (multi-turn).
//
//   GET    ?conversation=<id> → historia konwersacji (domyślnie przypięty Setup)
//   POST   { message, conversationId? } (lub legacy { history }) → CoachReply
//   DELETE → reset Setupu (wiadomości Setupu + profil + stan wątku);
//            luźne chaty i pamięć faktów zostają (mają własne endpointy)
//
// Konwersacje (migracja 0008, flaga coach_agent.conversations): Setup =
// onboarding/profil/plan, chaty = luźne rozmowy z własnym kontekstem,
// pamięć faktów o userze wspólna dla wszystkich. Bez 0008 → jeden wątek.
//
// POST (AI v2) — kolejność jest kluczowa dla kosztu na darmowym tierze:
//   1. limit per user (RPM w pamięci, RPD w DB)       → 429, 0 wywołań Gemini
//   2. budżet nadużyć (seria off-topic → blokada)     → szablon, 0 wywołań
//   3. lokalny gate guard.ts (heurystyki)             → szablon, 0 wywołań
//   4. `ambiguous` → mikro-gate `light` (~11 tokenów)→ szablon albo dalej
//   5. tura czatu (agent.ts) — dopiero tu pełny prompt
//
// Multi-user: wszystko filtrowane przez RLS (auth.uid()).
// ============================================================
import { NextResponse, after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { loadConfig, getGeminiSettings, getCoachFlags } from '@/lib/config';
import { getOrCreatePortfolio } from '@/lib/portfolio/service';
import { runCoachTurn } from '@/lib/coach/agent';
import { RateLimitError, GeminiError } from '@/lib/ai/errors';
import { checkMinuteLimit, checkDayLimit, rateLimitMessage } from '@/lib/ai/rateLimit';
import { analyzeIntent, templateReply, nextAbuseState, isLocked } from '@/lib/ai/guard';
import type { GuardContext } from '@/lib/ai/guard';
import { classifyScopeWithModel } from '@/lib/ai/intentGate';
import { createCollector, logTurn, persistTurn, type GateOutcome } from '@/lib/ai/telemetry';
import { loadThread, saveThread, clearThread } from '@/lib/coach/thread';
import {
  awaitingSlot,
  completeStrategy,
  describeSlots,
  effectiveSlots,
  missingSlots,
  TILES_WELCOME,
  welcomeBack,
} from '@/lib/coach/slots';
import { sanitizeSlots } from '@/lib/strategy/validate';
import { loadStoredStrategy, clearStoredStrategy } from '@/lib/strategy/store';
import {
  conversationsAvailable,
  getConversation,
  getOrCreateSetup,
  resetSetup,
  toClient,
  touchConversation,
  type ConversationRow,
} from '@/lib/coach/conversations';
import { loadMemory, memoryForPrompt, maybeExtractMemory, EXTRACT_EVERY } from '@/lib/coach/memory';
import type {
  CoachTurn,
  CoachMessage,
  CoachUserContext,
  CoachReply,
  Recommendation,
  UserStrategy,
} from '@/lib/coach/types';

// Coach wszedł 25.06.2026. Konta założone WCZEŚNIEJ (w tym nasze deweloperskie)
// nigdy nie były oprowadzone przez AI → przy pierwszym wejściu też dostają
// pełny onboarding, niezależnie od tego czy mają już profil od C.
const ONBOARDING_CUTOFF_MS = Date.parse('2026-06-25T00:00:00Z');

// Twardy limit długości wiadomości — dłuższe teksty to zwykle wklejki/
// injection i tylko pompują prompt (≈ 1 token / 4 znaki).
const MAX_MESSAGE_CHARS = 1200;

interface MessageRow {
  id: string;
  role: string;
  content: string;
  created_at: string;
  off_topic?: boolean | null;
}

// ---- GET: historia wątku + czy potrzebny onboarding ----------

export async function GET(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Konwersacja: wskazana w ?conversation=… albo przypięty Setup.
  const convOn = await conversationsAvailable(supabase);
  const requested = new URL(req.url).searchParams.get('conversation');
  let conv: ConversationRow | null = null;
  if (convOn) {
    conv = requested ? await getConversation(supabase, requested) : await getOrCreateSetup(supabase, user.id);
    if (requested && !conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const { data, error } = await selectMessages(supabase, 200, conv?.id ?? null);
  if (error) {
    console.error('[api/coach][GET]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  const messages: CoachMessage[] = data.map((m) => ({
    id: m.id,
    role: m.role === 'model' ? 'model' : 'user',
    content: m.content,
    createdAt: m.created_at,
    ...(m.off_topic ? { offTopic: true } : {}),
  }));

  // Legacy = konto sprzed wprowadzenia Coacha. Bot „mówił" w wątku =
  // user już był prowadzony. Świeży wątek LUB legacy bez rozmowy → onboarding.
  const createdMs = user.created_at ? Date.parse(user.created_at) : Date.now();
  const isLegacyAccount = Number.isFinite(createdMs) && createdMs < ONBOARDING_CUTOFF_MS;
  const botHasSpoken = messages.some((m) => m.role === 'model');
  // Luźny chat nie ma onboardingu ani powitania — zaczyna się pusty.
  const needsOnboarding =
    conv?.kind === 'chat' ? false : !botHasSpoken || (isLegacyAccount && !botHasSpoken);

  // AI v2: czy profil (sloty) jest kompletny — przy kafelkach to on, a nie
  // „bot już mówił", decyduje, czy pokazać kreator onboardingu.
  const flags = getCoachFlags();
  const thread = await loadThread(supabase, user.id);
  const known = await loadStoredStrategy(supabase, user.id);
  const profile = effectiveSlots(thread.slots, known);
  const profileComplete = missingSlots(profile).length === 0;

  return NextResponse.json({
    messages,
    needsOnboarding,
    isLegacyAccount,
    profileComplete,
    onboardingTiles: flags.onboarding_tiles,
    // Profil → klient przelicza plan w Setupie po odświeżeniu (silnik
    // deterministyczny, 0 tokenów), więc plan nie znika po reloadzie.
    strategy: profileComplete ? completeStrategy(profile) : null,
    conversationsEnabled: convOn,
    conversation: conv ? toClient(conv) : null,
  });
}

// Kolumna `off_topic` pochodzi z migracji 0006 — bez niej spadamy na stary select.
async function selectMessages(
  supabase: SupabaseClient,
  limit: number,
  conversationId: string | null,
): Promise<{ data: MessageRow[]; error: unknown }> {
  let q = supabase.from('coach_messages').select('id, role, content, created_at, off_topic');
  if (conversationId) q = q.eq('conversation_id', conversationId);
  const withFlag = await q.order('created_at', { ascending: true }).limit(limit);
  if (!withFlag.error) return { data: (withFlag.data ?? []) as MessageRow[], error: null };

  const legacy = await supabase
    .from('coach_messages')
    .select('id, role, content, created_at')
    .order('created_at', { ascending: true })
    .limit(limit);
  return { data: (legacy.data ?? []) as MessageRow[], error: legacy.error };
}

// ---- DELETE: czyści pamięć (cały wątek usera) ----------------

export async function DELETE(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (await conversationsAvailable(supabase)) {
    // Reset dotyczy tylko Setupu — chaty i pamięć faktów zostają.
    await resetSetup(supabase, user.id);
  } else {
    // RLS i tak ogranicza do auth.uid(), ale filtrujemy jawnie dla pewności.
    const { error } = await supabase.from('coach_messages').delete().eq('user_id', user.id);
    if (error) {
      console.error('[api/coach][DELETE]', error);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  }
  await clearThread(supabase, user.id);
  await clearStoredStrategy(supabase, user.id);
  return NextResponse.json({ ok: true });
}

// ---- POST: nowa tura -----------------------------------------

interface CoachPostBody {
  message?: string; // AI v2: tylko nowa wiadomość — historię składa serwer
  history?: CoachTurn[]; // legacy: bierzemy z niej WYŁĄCZNIE ostatnią turę usera
  strategy?: UserStrategy | null; // profil znany klientowi (fallback, gdy C nie ma go w DB)
  kickoff?: boolean; // pierwsze wejście — przy kafelkach powitanie z szablonu (0 wywołań)
  slots?: unknown; // wybór z kafelków onboardingu (walidowany sanitizeSlots)
  conversationId?: string; // konwersacja (0008); brak → przypięty Setup
}

// Odpowiedź API = dzisiejszy CoachReply + pola addytywne (ignorowane przez stary klient).
type CoachApiReply = CoachReply & {
  offTopic?: boolean;
  gate?: GateOutcome;
  recommendations?: Recommendation[]; // gotowy plan (gdy flaga C włączona) — klient nie musi dociągać
  error?: string; // przy 429
};

function extractUserMessage(body: CoachPostBody): string | null {
  if (typeof body.message === 'string') return body.message;
  const last = Array.isArray(body.history) ? body.history[body.history.length - 1] : undefined;
  if (last && last.role === 'user' && typeof last.content === 'string') return last.content;
  return null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: CoachPostBody;
  try {
    body = (await req.json()) as CoachPostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const flags = getCoachFlags();

  // Konwersacja: wskazana albo Setup. Tryb decyduje o onboardingu.
  const convOn = await conversationsAvailable(supabase);
  let conv: ConversationRow | null = null;
  if (convOn) {
    conv =
      typeof body.conversationId === 'string'
        ? await getConversation(supabase, body.conversationId)
        : await getOrCreateSetup(supabase, user.id);
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }
  const mode: 'setup' | 'chat' = conv?.kind ?? 'setup';

  // Zapis pary + odświeżenie konwersacji (updated_at, tytuł z 1. wiadomości).
  const persist = async (userText: string, modelText: string, offTopic: boolean): Promise<void> => {
    let first = false;
    if (conv) {
      const { count } = await supabase
        .from('coach_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .eq('role', 'user');
      first = (count ?? 0) === 0;
    }
    await persistPair(supabase, user.id, userText, modelText, offTopic, conv?.id ?? null);
    if (conv) await touchConversation(supabase, conv, first && !offTopic ? userText : null);
  };

  // Kafelki: wartości slotów przychodzą wprost — walidujemy je, a tekst
  // wiadomości budujemy SAMI z wyniku walidacji (klient nie przemyci nim
  // dowolnej treści obok gate'u).
  // Kafelki tylko w Setupie.
  const structured =
    flags.onboarding_tiles && mode === 'setup' && body.slots != null ? sanitizeSlots(body.slots) : null;
  if (structured && Object.keys(structured).length === 0) {
    return NextResponse.json({ error: 'slots contain no valid values' }, { status: 400 });
  }

  const rawMessage = structured ? describeSlots(structured) : extractUserMessage(body);
  if (!rawMessage || !rawMessage.trim()) {
    return NextResponse.json(
      { error: 'message must be a non-empty string (or history ending with a user turn)' },
      { status: 400 },
    );
  }
  const message = rawMessage.trim().slice(0, MAX_MESSAGE_CHARS);

  const settings = getGeminiSettings();
  const collector = createCollector();
  let gate: GateOutcome = 'none';
  let intentLabel: string | undefined;

  const finish = (payload: CoachApiReply, status = 200): NextResponse => {
    const telemetry = { route: 'coach', userId: user.id, gate, intent: intentLabel, events: collector.events };
    logTurn(telemetry);
    if (flags.usage_log) after(() => persistTurn(supabase, telemetry));
    const res = NextResponse.json(payload, { status });
    res.headers.set('x-coach-gate', gate);
    res.headers.set('x-gemini-calls', String(collector.events.length));
    return res;
  };

  // 1) Limit per user — sprawdzany LENIWIE, tuż przed pierwszym wywołaniem
  //    modelu (raz na żądanie). Odpowiedzi z szablonu (powitanie, off-topic,
  //    blokada) nic nie kosztują, więc nie zjadają limitu — spam off-topic i
  //    tak hamuje budżet nadużyć.
  let rateChecked = false;
  const enforceRate = async (): Promise<NextResponse | null> => {
    if (rateChecked) return null;
    rateChecked = true;
    const minute = checkMinuteLimit(user.id, settings.limits.user_rpm);
    const rate = minute.ok ? await checkDayLimit(supabase, user.id, settings.limits.user_rpd) : minute;
    if (rate.ok) return null;
    gate = 'rate_limited';
    const res = finish(
      { reply: '', onboardingComplete: false, strategy: null, error: rateLimitMessage(rate) },
      429,
    );
    res.headers.set('Retry-After', String(rate.retryAfterSec ?? 60));
    return res;
  };

  // Powitanie przy kafelkach — stały tekst, model niepotrzebny.
  if (body.kickoff === true && flags.onboarding_tiles && mode === 'setup') {
    gate = 'template';
    intentLabel = 'kickoff';
    // Profil już jest (np. zapisany wcześniej) → kafelki się nie pokażą, więc
    // powitanie nie może ich obiecywać.
    const thread = await loadThread(supabase, user.id);
    const known = await loadStoredStrategy(supabase, user.id);
    const profile = effectiveSlots(thread.slots, known);
    const welcome =
      missingSlots(profile).length === 0 ? welcomeBack(describeSlots(profile)) : TILES_WELCOME;
    await persist(message, welcome, false);
    return finish({ reply: welcome, onboardingComplete: false, strategy: null, gate });
  }

  try {
    const thread = await loadThread(supabase, user.id);
    const knownStrategy = (await loadStoredStrategy(supabase, user.id)) ?? body.strategy ?? null;
    // Oczekiwany slot (krótkie odpowiedzi są w temacie) tylko w Setupie.
    const guardCtx: GuardContext = {
      awaitingSlot: mode === 'setup' ? awaitingSlot(thread.slots, knownStrategy) : null,
    };

    // Wybór z kafelków jest w temacie z definicji — pomijamy gate.
    if (flags.guardrails && !structured) {
      const now = Date.now();
      const abuseCfg = {
        maxStreak: settings.limits.offtopic_max_streak,
        windowMs: settings.limits.offtopic_window_minutes * 60_000,
      };

      // 2) Budżet nadużyć — blokada aktywna: szablon, model nie jest wołany wcale.
      if (isLocked(thread.abuse, now)) {
        gate = 'budget';
        intentLabel = 'locked';
        const reply = templateReply('budget', guardCtx);
        await persist(message, reply, true);
        return finish({ reply, onboardingComplete: false, strategy: null, offTopic: true, gate });
      }

      // 3) Lokalny gate (0 wywołań API).
      const analysis = analyzeIntent(message, guardCtx);
      intentLabel = analysis.intent;
      let blocked: 'off_topic' | 'injection' | null =
        analysis.intent === 'off_topic' || analysis.intent === 'injection' ? analysis.intent : null;
      if (blocked) gate = 'local';

      // 4) Ambiguous → jedno mikro-wywołanie `light` (tylko gdy flaga włączona).
      if (!blocked && analysis.intent === 'ambiguous' && flags.intent_gate) {
        const limited = await enforceRate();
        if (limited) return limited;
        const scope = await classifyScopeWithModel(message, collector);
        if (scope === 'out') {
          blocked = 'off_topic';
          gate = 'light';
        }
      }

      if (blocked) {
        const abuse = nextAbuseState(thread.abuse, true, now, abuseCfg);
        const reply = templateReply(blocked, guardCtx);
        await persist(message, reply, true);
        await saveThread(supabase, user.id, { ...thread, abuse });
        return finish({ reply, onboardingComplete: false, strategy: null, offTopic: true, gate });
      }

      // W temacie → zerujemy serię (tylko gdy coś było do wyzerowania).
      if (thread.abuse.streak > 0) {
        thread.abuse = nextAbuseState(thread.abuse, false, now, abuseCfg);
      }
    }

    // 5) Właściwa tura czatu.
    const limited = await enforceRate();
    if (limited) return limited;
    const userContext = await buildUserContext(supabase, user.id, knownStrategy);
    const memory = convOn ? memoryForPrompt(await loadMemory(supabase, user.id)) : [];
    const turn = await runCoachTurn({
      supabase,
      userId: user.id,
      message,
      thread,
      userContext,
      guardCtx,
      flags,
      collector,
      legacyHistory: Array.isArray(body.history) ? body.history : null,
      structuredSlots: structured ?? undefined,
      mode,
      conversation: conv
        ? { id: conv.id, summary: conv.summary, summarizedUntil: conv.summarized_until }
        : { id: null, summary: thread.summary, summarizedUntil: thread.summarizedUntil },
      memory,
    });

    if (turn.offTopic) {
      // Przeciek gate'a złapany przez warstwę 2 — liczymy do budżetu nadużyć.
      gate = 'none';
      intentLabel = `${intentLabel ?? 'unknown'}→model_off_topic`;
      turn.thread.abuse = nextAbuseState(turn.thread.abuse, true, Date.now(), {
        maxStreak: settings.limits.offtopic_max_streak,
        windowMs: settings.limits.offtopic_window_minutes * 60_000,
      });
    }

    await persist(message, turn.reply.reply, turn.offTopic);
    await saveThread(supabase, user.id, turn.thread);
    if (turn.afterResponse) after(turn.afterResponse);
    // Pamięć faktów: co EXTRACT_EVERY wiadomości usera w tej konwersacji, w tle.
    if (conv && !turn.offTopic) {
      const c = conv;
      after(async () => {
        const memCollector = createCollector();
        const saved = await maybeExtractMemory(supabase, user.id, c, EXTRACT_EVERY, memCollector);
        if (memCollector.events.length) {
          logTurn({ route: 'coach-memory', userId: user.id, gate: 'none', intent: `facts:${saved}`, events: memCollector.events });
        }
      });
    }

    return finish({ ...turn.reply, offTopic: turn.offTopic, gate });
  } catch (err) {
    if (err instanceof RateLimitError) {
      gate = 'rate_limited';
      return finish(
        { reply: '', onboardingComplete: false, strategy: null, error: 'Coach is busy right now — try again in a moment.' },
        429,
      );
    }
    if (err instanceof GeminiError) {
      // Provider niedostępny (np. cała pula kluczy 402/403) — czytelny 503 zamiast 500.
      console.error('[api/coach][POST] Gemini unavailable:', err.message);
      return finish(
        { reply: '', onboardingComplete: false, strategy: null, error: 'Coach is temporarily unavailable — please try again later.' },
        503,
      );
    }
    console.error('[api/coach][POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ---- Persistencja pary wiadomości ----------------------------

// Off-topic zapisujemy z flagą (UI pokaże je po reloadzie, historia dla
// modelu je pomija). Bez kolumny `off_topic` (brak 0006) — pary off-topic
// po prostu nie zapisujemy, żeby nie zaśmiecały kontekstu kolejnych tur.
async function persistPair(
  supabase: SupabaseClient,
  userId: string,
  userText: string,
  modelText: string,
  offTopic: boolean,
  conversationId: string | null,
): Promise<void> {
  const conv = conversationId ? { conversation_id: conversationId } : {};
  const rows = [
    { user_id: userId, role: 'user', content: userText, ...conv },
    { user_id: userId, role: 'model', content: modelText, ...conv },
  ];
  if (!offTopic) {
    await supabase.from('coach_messages').insert(rows);
    return;
  }
  const { error } = await supabase
    .from('coach_messages')
    .insert(rows.map((r) => ({ ...r, off_topic: true })));
  if (error) console.warn('[api/coach] off-topic pair not persisted:', error.message);
}

// ---- Kontekst usera do promptu -------------------------------

async function buildUserContext(
  supabase: SupabaseClient,
  userId: string,
  strategy: UserStrategy | null,
): Promise<CoachUserContext> {
  const watchlist = loadConfig().watchlist.tickers.map((t) => t.symbol);

  try {
    const portfolio = await getOrCreatePortfolio(supabase, userId);
    const { data: posRows } = await supabase
      .from('positions')
      .select('ticker')
      .eq('portfolio_id', portfolio.id);
    return {
      strategy,
      cash: portfolio.cash,
      positions: (posRows ?? []).map((p: { ticker: string }) => p.ticker),
      watchlist,
    };
  } catch {
    // Portfel może jeszcze nie istnieć — nie blokujemy czatu.
    return { strategy, cash: null, positions: [], watchlist };
  }
}

