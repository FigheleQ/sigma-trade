import { NextRequest, NextResponse } from 'next/server';

// GET /api/quotes?symbols=AAPL,MSFT,TSLA
// Proxies Twelve Data /quote (supports comma-separated symbols in one request)
// Normalizes response to always return { [SYMBOL]: quoteData }
export async function GET(req: NextRequest) {
  const symbols = req.nextUrl.searchParams.get('symbols');
  if (!symbols?.trim()) {
    return NextResponse.json({ error: 'Missing symbols' }, { status: 400 });
  }

  const apiKey = process.env.TWELVEDATA_API_KEY;
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${apiKey}`;

  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    return NextResponse.json({ error: `Upstream ${res.status}` }, { status: 502 });
  }

  const data = await res.json();

  // Twelve Data returns a flat object for 1 symbol, keyed object for multiple
  const symbolList = symbols.split(',').map((s) => s.trim());
  if (symbolList.length === 1) {
    return NextResponse.json({ [symbolList[0]]: data });
  }

  return NextResponse.json(data);
}
