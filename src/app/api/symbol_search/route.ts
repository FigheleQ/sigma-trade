import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol');
  if (!symbol || symbol.trim().length < 2) {
    return NextResponse.json({ error: 'Missing or too short symbol' }, { status: 400 });
  }

  const apiKey = process.env.TWELVEDATA_API_KEY;
  const url = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(symbol.trim())}&outputsize=8&apikey=${apiKey}`;

  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    return NextResponse.json({ error: `Upstream error ${res.status}` }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
