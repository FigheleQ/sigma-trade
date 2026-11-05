// ============================================================
// /api/coach — czat z Coachem (multi-turn).
//
//   GET    → historia wątku zalogowanego usera + flaga needsOnboarding
//   POST   → { message } (lub legacy { history }) → CoachReply
//   DELETE → reset pamięci (wiadomości + stan wątku)
//
// POST (AI v2) — kolejność jest kluczowa dla kosztu na darmowym tierze:
//   1. limit per user (RPM w pamięci, RPD w DB)       → 429, 0 wywołań Gemini
//   2. budżet nadużyć (seria off-topic → blokada)     → szablon, 0 wywołań
//   3. lokalny gate guard.ts (heurystyki)             → szablon, 0 wywołań
//   4. `ambiguous` → mikro-gate `light` (8 tokenów)   → szablon albo dalej
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
import { awaitingSlot } from '@/lib/coach/slots';
import { loadStoredStrategy } from '@/lib/strategy/store';
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

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await selectMessages(supabase, 200);
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
  const needsOnboarding = !botHasSpoken || (isLegacyAccount && !botHasSpoken);

  return NextResponse.json({ messages, needsOnboarding, isLegacyAccount });
}

// Kolumna `off_topic` pochodzi z migracji 0006 — bez niej spadamy na stary select.
async function selectMessages(
  supabase: SupabaseClient,
  limit: number,
): Promise<{ data: MessageRow[]; error: unknown }> {
  const withFlag = await supabase
    .from('coach_messages')
    .select('id, role, content, created_at, off_topic')
    .order('created_at', { ascending: true })
    .limit(limit);
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

  // RLS i tak ogranicza do auth.uid(), ale filtrujemy jawnie dla pewności.
  const { error } = await supabase.from('coach_messages').delete().eq('user_id', user.id);
  if (error) {
    console.error('[api/coach][DELETE]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
  await clearThread(supabase, user.id);
  return NextResponse.json({ ok: true });
}

// ---- POST: nowa tura -----------------------------------------

interface CoachPostBody {
  message?: string; // AI v2: tylko nowa wiadomość — historię składa serwer
  history?: CoachTurn[]; // legacy: bierzemy z niej WYŁĄCZNIE ostatnią turę usera
  strategy?: UserStrategy | null; // profil znany klientowi (fallback, gdy C nie ma go w DB)
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

  const rawMessage = extractUserMessage(body);
  if (!rawMessage || !rawMessage.trim()) {
    return NextResponse.json(
      { error: 'message must be a non-empty string (or history ending with a user turn)' },
      { status: 400 },
    );
  }
  const message = rawMessage.trim().slice(0, MAX_MESSAGE_CHARS);

  const settings = getGeminiSettings();
  const flags = getCoachFlags();
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

  // 1) Limit per user — zanim spalimy klucz projektu.
  const minute = checkMinuteLimit(user.id, settings.limits.user_rpm);
  const rate = minute.ok ? await checkDayLimit(supabase, user.id, settings.limits.user_rpd) : minute;
  if (!rate.ok) {
    gate = 'rate_limited';
    const res = finish(
      { reply: '', onboardingComplete: false, strategy: null, error: rateLimitMessage(rate) },
      429,
    );
    res.headers.set('Retry-After', String(rate.retryAfterSec ?? 60));
    return res;
  }

  try {
    const thread = await loadThread(supabase, user.id);
    const knownStrategy = (await loadStoredStrategy(supabase, user.id)) ?? body.strategy ?? null;
    const guardCtx: GuardContext = { awaitingSlot: awaitingSlot(thread.slots, knownStrategy) };

    if (flags.guardrails) {
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
        await persistPair(supabase, user.id, message, reply, true);
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
        const scope = await classifyScopeWithModel(message, collector);
        if (scope === 'out') {
          blocked = 'off_topic';
          gate = 'light';
        }
      }

      if (blocked) {
        const abuse = nextAbuseState(thread.abuse, true, now, abuseCfg);
        const reply = templateReply(blocked, guardCtx);
        await persistPair(supabase, user.id, message, reply, true);
        await saveThread(supabase, user.id, { ...thread, abuse });
        return finish({ reply, onboardingComplete: false, strategy: null, offTopic: true, gate });
      }

      // W temacie → zerujemy serię (tylko gdy coś było do wyzerowania).
      if (thread.abuse.streak > 0) {
        thread.abuse = nextAbuseState(thread.abuse, false, now, abuseCfg);
      }
    }

    // 5) Właściwa tura czatu.
    const userContext = await buildUserContext(supabase, user.id, knownStrategy);
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

    await persistPair(supabase, user.id, message, turn.reply.reply, turn.offTopic);
    await saveThread(supabase, user.id, turn.thread);
    if (turn.afterResponse) after(turn.afterResponse);

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
): Promise<void> {
  const rows = [
    { user_id: userId, role: 'user', content: userText },
    { user_id: userId, role: 'model', content: modelText },
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

