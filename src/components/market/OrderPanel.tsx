'use client';

// ============================================================
// Panel Kup/Sprzedaj — pod wykresem, dla aktualnie oglądanego tickera.
// Egzekucja po świeżej cenie serwerowej; tu pokazujemy cenę z cache (quote)
// tylko do podglądu kosztu.
// ============================================================
import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useChartStore } from '@/store/chartStore';
import { usePortfolioStore } from '@/store/portfolioStore';
import { isMarketOpen } from '@/lib/market/hours';
import { fmtUSD, fmtSignedUSD } from '@/lib/portfolio/format';
import { cn } from '@/lib/utils';

export default function OrderPanel() {
  const ticker = useChartStore((s) => s.activeTicker);
  const quote = useChartStore((s) => (ticker ? s.quoteCache[ticker] : undefined));

  const portfolio = usePortfolioStore((s) => s.portfolio);
  const ordering = usePortfolioStore((s) => s.ordering);
  const placeOrder = usePortfolioStore((s) => s.placeOrder);
  const fetchPortfolio = usePortfolioStore((s) => s.fetchPortfolio);

  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!portfolio) void fetchPortfolio();
  }, [portfolio, fetchPortfolio]);

  // Reset komunikatu i ilości przy zmianie instrumentu
  useEffect(() => {
    setMsg(null);
    setQty(1);
  }, [ticker]);

  if (!ticker) return null;

  const marketOpen = isMarketOpen();
  const price = quote?.price;
  const owned = portfolio?.positions.find((p) => p.ticker === ticker)?.quantity ?? 0;
  const cash = portfolio?.cash ?? 0;
  const cost = price != null ? price * qty : 0;

  const canBuy = price != null && !ordering && cost <= cash;
  const canSell = price != null && !ordering && owned >= qty;

  const submit = async (side: 'buy' | 'sell') => {
    setMsg(null);
    const res = await placeOrder({ ticker, side, quantity: qty });
    if (res.ok && res.result) {
      const r = res.result;
      setMsg({
        type: 'ok',
        text:
          `${side === 'buy' ? 'Kupiono' : 'Sprzedano'} ${r.quantity}× ${r.ticker} @ ${fmtUSD(r.executionPrice)}` +
          (r.realizedPnL != null ? `  ·  P/L ${fmtSignedUSD(r.realizedPnL)}` : ''),
      });
    } else {
      setMsg({ type: 'err', text: res.error ?? 'Błąd zlecenia' });
    }
  };

  return (
    <div className="border-t border-border-subtle shrink-0 px-4 py-2">
      {!marketOpen && (
        <div className="mb-2 font-mono text-[9px] text-amber-500/80 uppercase tracking-wider">
          ⚠ Rynek zamknięty — cena może nie odzwierciedlać wartości rzeczywistej
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        {/* Ticker + cena */}
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-xs font-bold text-gray-100">{ticker}</span>
          <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
            {price != null ? fmtUSD(price) : '—'}
          </span>
        </div>

        {/* Stepper ilości */}
        <div className="flex items-center border border-border-subtle rounded overflow-hidden">
          <button
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="px-1.5 py-1 text-zinc-500 hover:text-accent transition-colors"
            aria-label="Zmniejsz ilość"
          >
            <Minus size={12} />
          </button>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="w-12 bg-transparent text-center font-mono text-[11px] text-gray-100 outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            onClick={() => setQty((q) => q + 1)}
            className="px-1.5 py-1 text-zinc-500 hover:text-accent transition-colors"
            aria-label="Zwiększ ilość"
          >
            <Plus size={12} />
          </button>
        </div>

        {/* Koszt */}
        <span className="font-mono text-[10px] text-zinc-500">
          Koszt: <span className="text-zinc-300 tabular-nums">{fmtUSD(cost)}</span>
        </span>

        {/* Akcje */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => void submit('buy')}
            disabled={!canBuy}
            className={cn(
              'px-3 py-1 rounded font-mono text-[11px] font-bold uppercase tracking-wider transition-colors',
              canBuy
                ? 'bg-accent/15 text-accent hover:bg-accent/25'
                : 'bg-zinc-900 text-zinc-700 cursor-not-allowed',
            )}
          >
            Kup
          </button>
          <button
            onClick={() => void submit('sell')}
            disabled={!canSell}
            className={cn(
              'px-3 py-1 rounded font-mono text-[11px] font-bold uppercase tracking-wider transition-colors',
              canSell
                ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                : 'bg-zinc-900 text-zinc-700 cursor-not-allowed',
            )}
          >
            Sprzedaj
          </button>
        </div>
      </div>

      {/* Posiadane + cash + komunikat */}
      <div className="flex items-center justify-between mt-1.5">
        <span className="font-mono text-[9px] text-zinc-600">
          Posiadasz: {owned} · Cash: {fmtUSD(cash)}
        </span>
        {msg && (
          <span
            className={cn(
              'font-mono text-[9px]',
              msg.type === 'ok' ? 'text-accent' : 'text-red-400',
            )}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
