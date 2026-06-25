'use client';

// ============================================================
// Panel Kup/Sprzedaj — pod wykresem, dla aktualnie oglądanego tickera.
// Dwa sprzężone pola: kwota $ ⇄ ilość akcji (ułamkowa), przeliczane po cenie
// z cache (podgląd). Egzekucja po świeżej cenie serwerowej. Wysyłamy to pole,
// które user ostatnio edytował — kwota → amountUsd, ilość → quantity.
// ============================================================
import { useEffect, useState } from 'react';
import { useChartStore } from '@/store/chartStore';
import { usePortfolioStore } from '@/store/portfolioStore';
import { isMarketOpen } from '@/lib/market/hours';
import { fmtUSD, fmtSignedUSD } from '@/lib/portfolio/format';
import { roundShares, fmtShares } from '@/lib/portfolio/shares';
import { cn } from '@/lib/utils';

export default function OrderPanel() {
  const ticker = useChartStore((s) => s.activeTicker);
  const quote = useChartStore((s) => (ticker ? s.quoteCache[ticker] : undefined));

  const portfolio = usePortfolioStore((s) => s.portfolio);
  const ordering = usePortfolioStore((s) => s.ordering);
  const placeOrder = usePortfolioStore((s) => s.placeOrder);
  const fetchPortfolio = usePortfolioStore((s) => s.fetchPortfolio);

  const [amount, setAmount] = useState('100');
  const [shares, setShares] = useState('');
  const [lastEdited, setLastEdited] = useState<'amount' | 'shares'>('amount');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!portfolio) void fetchPortfolio();
  }, [portfolio, fetchPortfolio]);

  // Reset przy zmianie instrumentu.
  useEffect(() => {
    setMsg(null);
    setAmount('100');
    setLastEdited('amount');
  }, [ticker]);

  const price = quote?.price;

  // Synchronizacja pól: przelicz pole zależne ze źródła (ostatnio edytowanego)
  // — także gdy cena tyknie. Setery są idempotentne w punkcie stałym → bez pętli.
  useEffect(() => {
    if (price == null) return;
    if (lastEdited === 'amount') {
      const a = Number(amount);
      setShares(Number.isFinite(a) && a > 0 ? String(roundShares(a / price)) : '');
    } else {
      const s = Number(shares);
      setAmount(Number.isFinite(s) && s > 0 ? (s * price).toFixed(2) : '');
    }
  }, [price, amount, shares, lastEdited]);

  if (!ticker) return null;

  const marketOpen = isMarketOpen();
  const owned = portfolio?.positions.find((p) => p.ticker === ticker)?.quantity ?? 0;
  const cash = portfolio?.cash ?? 0;
  const amountNum = Number(amount);
  const sharesNum = Number(shares);

  const canBuy =
    price != null && !ordering && amountNum > 0 && amountNum <= cash;
  const canSell =
    price != null && !ordering && owned > 0 && sharesNum > 0 && sharesNum <= owned + 1e-9;

  const onAmount = (v: string) => {
    setAmount(v);
    setLastEdited('amount');
  };
  const onShares = (v: string) => {
    setShares(v);
    setLastEdited('shares');
  };
  // Wypełnij ilością całej pozycji (czyste pełne wyjście, bez pyłu).
  const fillMax = () => {
    if (owned <= 0) return;
    setShares(String(owned));
    setLastEdited('shares');
  };

  const submit = async (side: 'buy' | 'sell') => {
    setMsg(null);
    const req =
      lastEdited === 'amount'
        ? { ticker, side, amountUsd: amountNum }
        : { ticker, side, quantity: sharesNum };
    const res = await placeOrder(req);
    if (res.ok && res.result) {
      const r = res.result;
      setMsg({
        type: 'ok',
        text:
          `${side === 'buy' ? 'Bought' : 'Sold'} ${fmtShares(r.quantity)}× ${r.ticker} @ ${fmtUSD(r.executionPrice)}` +
          (r.realizedPnL != null ? `  ·  P/L ${fmtSignedUSD(r.realizedPnL)}` : ''),
      });
    } else {
      setMsg({ type: 'err', text: res.error ?? 'Order error' });
    }
  };

  const inputCls =
    'w-24 bg-transparent border border-border-subtle rounded px-2 py-1 font-mono text-[11px] text-gray-100 tabular-nums outline-none focus:border-accent/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  return (
    <div className="border-t border-border-subtle shrink-0 px-4 py-2">
      {!marketOpen && (
        <div className="mb-2 font-mono text-[9px] text-amber-500/80 uppercase tracking-wider">
          ⚠ Market closed — price may not reflect real value
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

        {/* Kwota $ */}
        <label className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-zinc-500">$</span>
          <input
            type="number"
            min={0}
            step="any"
            value={amount}
            onChange={(e) => onAmount(e.target.value)}
            placeholder="Amount"
            aria-label="Amount in USD"
            className={inputCls}
          />
        </label>

        {/* Ilość akcji (ułamkowa) */}
        <label className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            step="any"
            value={shares}
            onChange={(e) => onShares(e.target.value)}
            placeholder="Qty"
            aria-label="Shares"
            className={inputCls}
          />
          <span className="font-mono text-[9px] text-zinc-600">shares</span>
          {owned > 0 && (
            <button
              onClick={fillMax}
              className="font-mono text-[9px] text-zinc-500 hover:text-accent transition-colors"
              type="button"
            >
              max
            </button>
          )}
        </label>

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
            Buy
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
            Sell
          </button>
        </div>
      </div>

      {/* Posiadane + cash + komunikat */}
      <div className="flex items-center justify-between mt-1.5">
        <span className="font-mono text-[9px] text-zinc-600">
          Holdings: {fmtShares(owned)} · Cash: {fmtUSD(cash)}
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
