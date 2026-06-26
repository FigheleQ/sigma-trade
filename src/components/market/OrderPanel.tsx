'use client';

// ============================================================
// Buy/Sell panel — Buy opens a modal with quantity + optional TP/SL.
// Sell closes all lots for the ticker, or a specific lot when selected.
// ============================================================
import { useEffect, useState } from 'react';
import { Minus, Plus, Target, ShieldAlert, X } from 'lucide-react';
import { useChartStore } from '@/store/chartStore';
import { usePortfolioStore } from '@/store/portfolioStore';
import { isMarketOpen } from '@/lib/market/hours';
import Snackbar, { type SnackbarMessage } from '@/components/ui/Snackbar';
import { fmtUSD, fmtSignedUSD } from '@/lib/portfolio/format';
import { fmtShares } from '@/lib/portfolio/shares';
import { cn } from '@/lib/utils';

// ── Buy modal ────────────────────────────────────────────────

interface BuyModalProps {
  ticker: string;
  price: number;
  cash: number;
  ordering: boolean;
  onConfirm: (qty: number, tp?: number, sl?: number) => void;
  onClose: () => void;
}

function BuyModal({ ticker, price, cash, ordering, onConfirm, onClose }: BuyModalProps) {
  const [qty, setQty] = useState(1);
  const [tp, setTp] = useState((price * 1.05).toFixed(2));
  const [sl, setSl] = useState((price * 0.97).toFixed(2));
  const [tpEnabled, setTpEnabled] = useState(false);
  const [slEnabled, setSlEnabled] = useState(false);

  const cost = price * qty;
  const canAfford = cost <= cash;

  const handleConfirm = () => {
    const parsedTp = tpEnabled && tp ? Number(tp) : undefined;
    const parsedSl = slEnabled && sl ? Number(sl) : undefined;
    onConfirm(qty, parsedTp, parsedSl);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-sm mx-4 mb-4 md:mb-0 bg-bg-panel border border-border-subtle rounded-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-bold text-gray-100">Buy {ticker}</span>
            <span className="font-mono text-xs text-zinc-400 tabular-nums">{fmtUSD(price)}</span>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-5">

          {/* Quantity */}
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Quantity</span>
            <div className="flex items-center border border-border-subtle rounded overflow-hidden">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="px-2.5 py-1.5 text-zinc-500 hover:text-accent transition-colors"
              >
                <Minus size={13} />
              </button>
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className="w-14 bg-transparent text-center font-mono text-sm text-gray-100 outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={() => setQty((q) => q + 1)}
                className="px-2.5 py-1.5 text-zinc-500 hover:text-accent transition-colors"
              >
                <Plus size={13} />
              </button>
            </div>
          </div>

          {/* Cost */}
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Cost</span>
            <span className={cn('font-mono text-sm tabular-nums', canAfford ? 'text-gray-100' : 'text-red-400')}>
              {fmtUSD(cost)}
              {!canAfford && <span className="text-[9px] ml-1.5">· insufficient funds</span>}
            </span>
          </div>

          {/* Separator */}
          <div className="border-t border-border-subtle" />

          {/* Take Profit */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTpEnabled((v) => !v)}
                className={cn(
                  'w-8 h-4 rounded-full transition-colors relative shrink-0',
                  tpEnabled ? 'bg-emerald-500/70' : 'bg-zinc-700',
                )}
              >
                <span className={cn(
                  'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all duration-150',
                  tpEnabled ? 'left-4' : 'left-0.5',
                )} />
              </button>
              <Target size={12} className="text-emerald-500" />
              <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Take Profit</span>
            </div>
            <input
              type="number"
              min={0}
              step={0.01}
              value={tp}
              onChange={(e) => setTp(e.target.value)}
              disabled={!tpEnabled}
              className={cn(
                'w-24 text-right bg-zinc-800/80 border rounded px-2 py-1 font-mono text-[12px] outline-none tabular-nums transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                tpEnabled
                  ? 'border-emerald-500/30 text-emerald-400 focus:border-emerald-500/60'
                  : 'border-zinc-700 text-zinc-600 cursor-not-allowed',
              )}
            />
          </div>

          {/* Stop Loss */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSlEnabled((v) => !v)}
                className={cn(
                  'w-8 h-4 rounded-full transition-colors relative shrink-0',
                  slEnabled ? 'bg-red-500/70' : 'bg-zinc-700',
                )}
              >
                <span className={cn(
                  'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all duration-150',
                  slEnabled ? 'left-4' : 'left-0.5',
                )} />
              </button>
              <ShieldAlert size={12} className="text-red-500" />
              <span className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">Stop Loss</span>
            </div>
            <input
              type="number"
              min={0}
              step={0.01}
              value={sl}
              onChange={(e) => setSl(e.target.value)}
              disabled={!slEnabled}
              className={cn(
                'w-24 text-right bg-zinc-800/80 border rounded px-2 py-1 font-mono text-[12px] outline-none tabular-nums transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                slEnabled
                  ? 'border-red-500/30 text-red-400 focus:border-red-500/60'
                  : 'border-zinc-700 text-zinc-600 cursor-not-allowed',
              )}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <button
            onClick={handleConfirm}
            disabled={!canAfford || ordering}
            className={cn(
              'w-full py-2.5 rounded-lg font-mono text-[12px] font-bold uppercase tracking-wider transition-colors',
              canAfford && !ordering
                ? 'bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30'
                : 'bg-zinc-900 text-zinc-700 cursor-not-allowed border border-zinc-800',
            )}
          >
            {ordering ? 'Processing…' : `Buy ${qty} × ${ticker}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────

export default function OrderPanel() {
  const ticker = useChartStore((s) => s.activeTicker);
  const quote = useChartStore((s) => (ticker ? s.quoteCache[ticker] : undefined));

  const portfolio = usePortfolioStore((s) => s.portfolio);
  const ordering = usePortfolioStore((s) => s.ordering);
  const placeOrder = usePortfolioStore((s) => s.placeOrder);
  const fetchPortfolio = usePortfolioStore((s) => s.fetchPortfolio);
  const lots = usePortfolioStore((s) => s.lots);
  const selectedLotId = usePortfolioStore((s) => s.selectedLotId);
  const selectLot = usePortfolioStore((s) => s.selectLot);

  const [showBuyModal, setShowBuyModal] = useState(false);
  const [snack, setSnack] = useState<SnackbarMessage | null>(null);

  const notify = (type: 'ok' | 'err', text: string) =>
    setSnack({ id: Date.now(), type, text });

  useEffect(() => {
    if (!portfolio) void fetchPortfolio();
  }, [portfolio, fetchPortfolio]);

  useEffect(() => {
    setShowBuyModal(false);
  }, [ticker]);

  if (!ticker) return null;

  const marketOpen = isMarketOpen();
  const price = quote?.price;
  const owned = portfolio?.positions.find((p) => p.ticker === ticker)?.quantity ?? 0;
  const cash = portfolio?.cash ?? 0;

  const selectedLot = selectedLotId
    ? lots.find((l) => l.id === selectedLotId && l.ticker === ticker)
    : null;

  const canBuy = price != null && !ordering;
  const canSellAll = price != null && !ordering && owned > 0;
  const canSellLot = price != null && !ordering && selectedLot != null;

  const handleBuyConfirm = async (qty: number, tp?: number, sl?: number) => {
    const res = await placeOrder({ ticker, side: 'buy', quantity: qty, takeProfit: tp, stopLoss: sl });
    setShowBuyModal(false);
    if (res.ok && res.result) {
      const r = res.result;
      notify('ok', `Bought ${fmtShares(r.quantity)}× ${r.ticker} @ ${fmtUSD(r.executionPrice)}`);
    } else {
      notify('err', res.error ?? 'Order error');
    }
  };

  const handleSell = async (lotId?: string) => {
    const res = await placeOrder(
      lotId
        ? { ticker, side: 'sell', quantity: 1, lotId }
        : { ticker, side: 'sell', quantity: owned },
    );
    if (res.ok && res.result) {
      const r = res.result;
      notify('ok', `Sold ${fmtShares(r.quantity)}× ${r.ticker} @ ${fmtUSD(r.executionPrice)}  ·  P/L ${fmtSignedUSD(r.realizedPnL ?? 0)}`);
    } else {
      notify('err', res.error ?? 'Order error');
    }
  };

  return (
    <>
      <Snackbar message={snack} />
      {showBuyModal && price != null && (
        <BuyModal
          ticker={ticker}
          price={price}
          cash={cash}
          ordering={ordering}
          onConfirm={handleBuyConfirm}
          onClose={() => setShowBuyModal(false)}
        />
      )}

      <div className="border-t border-border-subtle shrink-0">
        {!marketOpen && (
          <div className="px-4 pt-1.5 font-mono text-[9px] text-amber-500/80 uppercase tracking-wider">
            ⚠ Market closed — price may not reflect real value
          </div>
        )}

        <div className="flex items-center gap-0 px-4 py-2">

          {/* ── Left: instrument info ── */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Ticker + price */}
            <div className="flex items-baseline gap-1.5 shrink-0">
              <span className="font-mono text-xs font-bold text-gray-100">{ticker}</span>
              <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                {price != null ? fmtUSD(price) : '—'}
              </span>
            </div>

            {/* Separator */}
            <div className="w-px h-3.5 bg-border-subtle shrink-0" />

            {/* Lot badge or holdings */}
            {selectedLot ? (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-accent/5 border border-accent/20 shrink-0">
                <span className="font-mono text-[10px] text-accent">
                  Lot · {fmtShares(selectedLot.quantity)} shr @ {fmtUSD(selectedLot.entryPrice)}
                </span>
                <button onClick={() => selectLot(null)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                  <X size={10} />
                </button>
              </div>
            ) : (
              <span className="font-mono text-[10px] text-zinc-500 shrink-0">
                {owned > 0 ? <><span className="text-zinc-300">{fmtShares(owned)} shr</span> · </> : null}
                Cash: <span className="text-zinc-400">{fmtUSD(cash)}</span>
              </span>
            )}
          </div>

          {/* ── Right: actions ── */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowBuyModal(true)}
                disabled={!canBuy}
                className={cn(
                  'px-4 py-1.5 rounded font-mono text-[11px] font-bold uppercase tracking-wider transition-colors',
                  canBuy
                    ? 'bg-accent/15 text-accent hover:bg-accent/25'
                    : 'bg-zinc-900 text-zinc-700 cursor-not-allowed',
                )}
              >
                Buy
              </button>

              {selectedLot ? (
                <>
                  <button
                    onClick={() => void handleSell(selectedLot.id)}
                    disabled={!canSellLot}
                    className={cn(
                      'px-4 py-1.5 rounded font-mono text-[11px] font-bold uppercase tracking-wider transition-colors',
                      canSellLot
                        ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                        : 'bg-zinc-900 text-zinc-700 cursor-not-allowed',
                    )}
                  >
                    Close lot
                  </button>
                  <button
                    onClick={() => void handleSell()}
                    disabled={!canSellAll}
                    className={cn(
                      'px-3 py-1.5 rounded font-mono text-[10px] font-semibold uppercase tracking-wider border transition-colors',
                      canSellAll
                        ? 'border-red-500/30 text-red-500/70 hover:bg-red-500/10'
                        : 'border-zinc-800 text-zinc-700 cursor-not-allowed',
                    )}
                  >
                    All
                  </button>
                </>
              ) : (
                <button
                  onClick={() => void handleSell()}
                  disabled={!canSellAll}
                  className={cn(
                    'px-4 py-1.5 rounded font-mono text-[11px] font-bold uppercase tracking-wider transition-colors',
                    canSellAll
                      ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                      : 'bg-zinc-900 text-zinc-700 cursor-not-allowed',
                  )}
                >
                  Sell
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
