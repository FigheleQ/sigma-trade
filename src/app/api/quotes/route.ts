import { NextRequest, NextResponse } from 'next/server';

// GET /api/quotes?symbols=AAPL,MSFT,TSLA
// Źródło: Finnhub /quote (60 req/min — z zapasem dla watchlisty).
//
// TwelveData free tier (8 kredytów/min) był wcześniej tu używany i wyczerpywał
// limit, przez co zapytania o świece wykresu dostawały 429 i wpadały w mock.
// Finnhub /quote jest jednosymbolowy → fan-out N równoległych zapytań.
//
// Kształt odpowiedzi zachowany 1:1 ze starym (TwelveData), żeby
// useWatchlistQuotes nie wymagał zmian: { [SYMBOL]: { close, change, percent_change } }
export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get('symbols');
  if (!symbols?.trim()) {
    return NextResponse.json({ error: 'Missing symbols' }, { status: 400 });
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'FINNHUB_API_KEY not set' }, { status: 500 });
  }

  const symbolList = symbols
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  // Fan-out: jedno zapytanie Finnhub na symbol, równolegle.
  const entries = await Promise.all(
    symbolList.map(async (sym) => {
      try {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${apiKey}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return [sym, null] as const;

        // Finnhub: c=current, d=change, dp=change%
        const q = (await res.json()) as { c?: number; d?: number; dp?: number };
        if (typeof q.c !== 'number' || q.c <= 0) return [sym, null] as const;

        return [
          sym,
          {
            close: String(q.c),
            change: String(q.d ?? 0),
            percent_change: String(q.dp ?? 0),
          },
        ] as const;
      } catch {
        return [sym, null] as const;
      }
    }),
  );

  // Pomijamy symbole bez danych (null) — hook i tak je filtruje po `close`.
  const result = Object.fromEntries(entries.filter(([, v]) => v !== null));
  return NextResponse.json(result);
}
