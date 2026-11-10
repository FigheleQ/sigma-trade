// ============================================================
// GET /api/strategy/describe?ticker=INTC — krótki opis spółki/ETF-u.
//
// Tylko tickery z katalogu. Opis generuje model `light` RAZ na ticker
// (cache wspólny), potem kosztuje 0 tokenów. Szczegóły: lib/strategy/describe.ts.
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { describeTicker } from '@/lib/strategy/describe';
import { checkMinuteLimit } from '@/lib/ai/rateLimit';
import { createCollector, logTurn } from '@/lib/ai/telemetry';

// Osobny, luźniejszy limit niż czat — trafienia w cache są darmowe, a
// nowe opisy i tak są ograniczone wielkością katalogu.
const DESCRIBE_RPM = 20;

export async function GET(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ticker = new URL(req.url).searchParams.get('ticker')?.trim().toUpperCase() ?? '';
  if (!/^[A-Z]{1,5}$/.test(ticker)) {
    return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 });
  }

  const rate = checkMinuteLimit(`describe:${user.id}`, DESCRIBE_RPM);
  if (!rate.ok) {
    return NextResponse.json({ error: 'Too many requests — try again in a moment.' }, { status: 429 });
  }

  const collector = createCollector();
  const result = await describeTicker(supabase, ticker, collector);
  logTurn({ route: 'describe', userId: user.id, gate: 'none', intent: result?.source, events: collector.events });

  if (!result) return NextResponse.json({ error: 'Ticker not in catalog' }, { status: 404 });
  const res = NextResponse.json(result);
  res.headers.set('x-gemini-calls', String(collector.events.length));
  return res;
}
