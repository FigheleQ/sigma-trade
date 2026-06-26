// ============================================================
// Supabase Edge Function — check-tp-sl
//
// Wywoływana co minutę przez pg_cron via pg_net.
// Sprawdza wszystkie otwarte loty z TP/SL i zamyka te, które
// osiągnęły swój poziom. Replika logiki /api/cron/check-tp-sl
// przeniesiona poza Vercel (plan Hobby = max 1 cron/dzień).
//
// Wymagane sekrety (supabase secrets set):
//   FINNHUB_API_KEY  — klucz Finnhub
//   CRON_SECRET      — opcjonalny; jeśli ustawiony, weryfikuje
//                      nagłówek Authorization: Bearer <secret>
//
// SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY są wstrzykiwane
// automatycznie przez runtime Supabase.
// ============================================================
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Finnhub ──────────────────────────────────────────────────

async function fetchFinnhubQuote(ticker: string, apiKey: string): Promise<number | null> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) return null
  const q = await res.json() as { c?: number }
  return typeof q.c === 'number' && q.c > 0 ? q.c : null
}

// ── Helpers ──────────────────────────────────────────────────

type LotRow = {
  id: string
  portfolio_id: string
  ticker: string
  quantity: number | string
  entry_price: number | string
  take_profit: number | string | null
  stop_loss: number | string | null
}

async function recalcAggregate(
  supabase: SupabaseClient,
  portfolioId: string,
  ticker: string,
): Promise<void> {
  const { data: remaining } = await supabase
    .from('position_lots')
    .select('quantity, entry_price')
    .eq('portfolio_id', portfolioId)
    .eq('ticker', ticker)
    .eq('status', 'open')

  const lots = (remaining ?? []) as Array<{ quantity: string | number; entry_price: string | number }>

  if (lots.length === 0) {
    await supabase
      .from('positions')
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('ticker', ticker)
    return
  }

  const totalQty = lots.reduce((s, l) => s + Number(l.quantity), 0)
  const weightedAvg =
    lots.reduce((s, l) => s + Number(l.entry_price) * Number(l.quantity), 0) / totalQty

  const { data: posRow } = await supabase
    .from('positions')
    .select('id')
    .eq('portfolio_id', portfolioId)
    .eq('ticker', ticker)
    .maybeSingle()

  const pos = posRow as { id: string } | null

  if (pos) {
    await supabase
      .from('positions')
      .update({ quantity: totalQty, avg_entry_price: weightedAvg, updated_at: new Date().toISOString() })
      .eq('id', pos.id)
  } else {
    await supabase.from('positions').insert({
      portfolio_id: portfolioId,
      ticker,
      quantity: totalQty,
      avg_entry_price: weightedAvg,
    })
  }
}

// ── Handler ──────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const finnhubKey = Deno.env.get('FINNHUB_API_KEY')!

  if (!finnhubKey) {
    return new Response(JSON.stringify({ error: 'FINNHUB_API_KEY not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    const { data: rawLots, error } = await supabase
      .from('position_lots')
      .select('id, portfolio_id, ticker, quantity, entry_price, take_profit, stop_loss')
      .eq('status', 'open')
      .or('take_profit.not.is.null,stop_loss.not.is.null')

    if (error) throw error

    const lots = (rawLots ?? []) as LotRow[]

    if (lots.length === 0) {
      return new Response(JSON.stringify({ checked: 0, triggered: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const uniqueTickers = [...new Set(lots.map((l) => l.ticker))]

    const priceMap: Record<string, number> = {}
    await Promise.all(
      uniqueTickers.map(async (ticker) => {
        try {
          const price = await fetchFinnhubQuote(ticker, finnhubKey)
          if (price != null) priceMap[ticker] = price
        } catch {
          // brak ceny — pomijamy ten ticker
        }
      }),
    )

    let triggered = 0
    const now = new Date().toISOString()

    for (const lot of lots) {
      const currentPrice = priceMap[lot.ticker]
      if (currentPrice == null) continue

      const tp = lot.take_profit != null ? Number(lot.take_profit) : null
      const sl = lot.stop_loss != null ? Number(lot.stop_loss) : null

      let closeReason: 'take_profit' | 'stop_loss' | null = null
      if (tp != null && currentPrice >= tp) closeReason = 'take_profit'
      else if (sl != null && currentPrice <= sl) closeReason = 'stop_loss'

      if (!closeReason) continue

      const qty = Number(lot.quantity)
      const entryPrice = Number(lot.entry_price)
      const realizedPnL = (currentPrice - entryPrice) * qty

      await supabase
        .from('position_lots')
        .update({ status: 'closed', closed_at: now, close_price: currentPrice, close_reason: closeReason })
        .eq('id', lot.id)

      await recalcAggregate(supabase, lot.portfolio_id, lot.ticker)

      const { data: portfolioRow } = await supabase
        .from('portfolios')
        .select('cash')
        .eq('id', lot.portfolio_id)
        .maybeSingle()

      const portfolio = portfolioRow as { cash: number | string } | null
      if (portfolio) {
        await supabase
          .from('portfolios')
          .update({ cash: Number(portfolio.cash) + currentPrice * qty })
          .eq('id', lot.portfolio_id)
      }

      await supabase.from('trades').insert({
        portfolio_id: lot.portfolio_id,
        ticker: lot.ticker,
        side: 'sell',
        quantity: qty,
        price: currentPrice,
        realized_pnl: realizedPnL,
      })

      triggered++
    }

    return new Response(JSON.stringify({ checked: lots.length, triggered }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[check-tp-sl]', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
