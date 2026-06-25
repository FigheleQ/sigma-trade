// ============================================================
// /api/coach — czat z Coachem (multi-turn).
//
//   GET  → historia wątku zalogowanego usera + flaga needsOnboarding
//          (do wykrycia „pierwszego oprowadzania")
//   POST → { history: CoachTurn[] } (ostatnia tura = nowa wiadomość usera)
//          → woła Gemini, zapisuje obie wiadomości do `coach_messages`,
//            zwraca CoachReply (reply + onboardingComplete + strategy).
//
// Multi-user: historia ZAWSZE filtrowana przez RLS (auth.uid()).
// Świeży user = pusty wątek → klient startuje onboarding, route nie crashuje.
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadConfig } from '@/lib/config';
import { getOrCreatePortfolio } from '@/lib/portfolio/service';
import { chat } from '@/lib/coach/agent';
import { RateLimitError } from '@/lib/news/analyzer';
import type { CoachTurn, CoachMessage, CoachUserContext, UserStrategy } from '@/lib/coach/types';

// Coach wszedł 25.06.2026. Konta założone WCZEŚNIEJ (w tym nasze deweloperskie)
// nigdy nie były oprowadzone przez AI → przy pierwszym wejściu też dostają
// pełny onboarding, niezależnie od tego czy mają już profil od C.
const ONBOARDING_CUTOFF_MS = Date.parse('2026-06-25T00:00:00Z');

// ---- GET: historia wątku + czy potrzebny onboarding ----------

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('coach_messages')
    .select('id, role, content, created_at')
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    console.error('[api/coach][GET]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  const messages: CoachMessage[] = (data ?? []).map((m) => ({
    id: m.id,
    role: m.role === 'model' ? 'model' : 'user',
    content: m.content,
    createdAt: m.created_at,
  }));

  // Legacy = konto sprzed wprowadzenia Coacha. Bot „mówił" w wątku =
  // user już był prowadzony. Świeży wątek LUB legacy bez rozmowy → onboarding.
  const createdMs = user.created_at ? Date.parse(user.created_at) : Date.now();
  const isLegacyAccount = Number.isFinite(createdMs) && createdMs < ONBOARDING_CUTOFF_MS;
  const botHasSpoken = messages.some((m) => m.role === 'model');
  const needsOnboarding = !botHasSpoken || (isLegacyAccount && !botHasSpoken);

  return NextResponse.json({ messages, needsOnboarding, isLegacyAccount });
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
  return NextResponse.json({ ok: true });
}

// ---- POST: nowa tura -----------------------------------------

interface CoachPostBody {
  history?: CoachTurn[];
  strategy?: UserStrategy | null; // profil od C (jeśli klient go zna)
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

  const history = (body.history ?? []).filter(
    (t): t is CoachTurn =>
      !!t && (t.role === 'user' || t.role === 'model') && typeof t.content === 'string',
  );
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return NextResponse.json(
      { error: 'history must be non-empty and end with a user turn' },
      { status: 400 },
    );
  }

  try {
    const userContext = await buildUserContext(supabase, user.id, body.strategy ?? null);
    const reply = await chat(history, userContext);

    // Persist: nowa wiadomość usera + odpowiedź bota. Wcześniejsze tury wątku
    // już są w bazie (zapisane w poprzednich turach), więc dopisujemy tylko parę.
    const newUserTurn = history[history.length - 1];
    await supabase.from('coach_messages').insert([
      { user_id: user.id, role: 'user', content: newUserTurn.content },
      { user_id: user.id, role: 'model', content: reply.reply },
    ]);

    return NextResponse.json(reply);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    console.error('[api/coach][POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ---- Kontekst usera do promptu -------------------------------

async function buildUserContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
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
      positions: (posRows ?? []).map((p) => p.ticker),
      watchlist,
    };
  } catch {
    // Portfel może jeszcze nie istnieć — nie blokujemy czatu.
    return { strategy, cash: null, positions: [], watchlist };
  }
}
