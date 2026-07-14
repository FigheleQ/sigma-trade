'use client';

// ============================================================
// Mobilny podgląd portfela — luka po `PortfolioSummary` (hidden md:flex).
// Warstwa 1: stały pasek pod TopBarem (total value + P/L pill), zawsze
//   widoczny — „hero number", który trader sprawdza odruchowo.
// Warstwa 2: slide-up bottom sheet z pełnym breakdownem (cash / invested,
//   pasek alokacji) + lista pozycji przez istniejący PositionsPanel.
// Reużywa wzorca overlaya agentów z DashboardClient (translate-y-full).
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { ChevronUp, TrendingUp, TrendingDown, X } from 'lucide-react';
import { usePortfolioStore } from '@/store/portfolioStore';
import { cn } from '@/lib/utils';
import { fmtUSD, fmtPct } from '@/lib/portfolio/format';
import PositionsPanel from './PositionsPanel';
import PortfolioAllocation from './PortfolioAllocation';

export default function MobilePortfolioBar() {
  const portfolio = usePortfolioStore((s) => s.portfolio);
  const fetchPortfolio = usePortfolioStore((s) => s.fetchPortfolio);
  const [open, setOpen] = useState(false);
  // Wysokość sheeta w px — sterowana dragiem uchwytu. null → przed otwarciem.
  const [height, setHeight] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    void fetchPortfolio();
  }, [fetchPortfolio]);

  // Blokada scrolla body pod otwartym sheetem.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Zanim dane dotrą — cienki placeholder o stałej wysokości, żeby MarketView
  // nie „podskakiwał" po fetchu (analogicznie do slotu w PortfolioSummary).
  if (!portfolio) {
    return (
      <div
        className="md:hidden h-11 border-b border-border-subtle shrink-0"
        aria-hidden="true"
      />
    );
  }

  const positive = portfolio.totalPnL >= 0;
  const Trend = positive ? TrendingUp : TrendingDown;

  // Punkty zaczepienia (snap) liczone od aktualnej wysokości viewportu:
  // half = domyślne otwarcie, full = maks, closeBelow = próg zamknięcia dragiem.
  const snapPoints = () => {
    const vh = window.innerHeight;
    return { half: vh * 0.5, full: vh * 0.92, closeBelow: vh * 0.3, min: 120 };
  };

  const openSheet = () => {
    setHeight(Math.round(window.innerHeight * 0.5));
    setOpen(true);
  };

  const onHandleDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startY: e.clientY,
      startH: height ?? window.innerHeight * 0.5,
    };
    setDragging(true);
  };

  const onHandleMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const { min, full } = snapPoints();
    const delta = dragRef.current.startY - e.clientY; // w górę = dodatnie
    setHeight(Math.min(full, Math.max(min, dragRef.current.startH + delta)));
  };

  const onHandleUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    const { half, full, closeBelow } = snapPoints();
    const h = height ?? half;
    if (h < closeBelow) {
      setOpen(false);
      return;
    }
    // Snap do najbliższego z dwóch stanów: half / full.
    setHeight(Math.round(h < (half + full) / 2 ? half : full));
  };

  return (
    <>
      {/* ── Warstwa 1: stały pasek ─────────────────────────────── */}
      <button
        onClick={openSheet}
        aria-label="Open portfolio details"
        className="md:hidden shrink-0 flex items-center justify-between gap-3 px-4 h-11
                   border-b border-border-subtle bg-bg-base active:bg-bg-panel transition-colors"
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider shrink-0">
            Portfolio
          </span>
          <span className="font-mono text-base font-semibold text-gray-100 tabular-nums truncate">
            {fmtUSD(portfolio.totalValue)}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              'flex items-center gap-1 font-mono text-xs tabular-nums rounded px-1.5 py-0.5',
              positive ? 'text-accent bg-accent/10' : 'text-red-400 bg-red-500/10',
            )}
          >
            <Trend size={12} />
            {fmtPct(portfolio.totalPnLPercent)}
          </span>
          <ChevronUp
            size={14}
            className={cn(
              'text-zinc-600 transition-transform duration-300',
              open && 'rotate-180',
            )}
          />
        </div>
      </button>

      {/* ── Warstwa 2: bottom sheet ────────────────────────────── */}
      {/* Backdrop */}
      <div
        className={cn(
          'md:hidden fixed inset-0 z-40 bg-black/60 transition-opacity duration-300',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => setOpen(false)}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-label="Portfolio details"
        style={{ height: open && height ? `${height}px` : undefined }}
        className={cn(
          'md:hidden fixed inset-x-0 bottom-0 z-50 flex flex-col',
          'bg-bg-base border-t border-border-subtle rounded-t-2xl',
          // Podczas draga bez transition (śledzi palec); po puszczeniu snap animuje.
          !dragging && 'transition-[transform,height] duration-300 ease-in-out',
          open ? 'translate-y-0' : 'translate-y-full pointer-events-none',
        )}
      >
        {/* Uchwyt + header */}
        <div className="shrink-0">
          {/* Drag handle — rozwijanie/zwijanie sheeta w pionie (touch + mysz).
              touch-none blokuje natywny scroll strony podczas gestu. */}
          <div
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none"
          >
            <span
              className={cn(
                'h-1 w-10 rounded-full transition-colors',
                dragging ? 'bg-accent' : 'bg-zinc-700',
              )}
            />
          </div>
          <div className="flex items-center justify-between px-4 h-11">
            <span className="font-mono text-xs text-zinc-400 uppercase tracking-wider">
              Portfolio
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close portfolio details"
              className="text-zinc-500 hover:text-accent"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Breakdown */}
        <div className="shrink-0 px-4 pb-3 border-b border-border-subtle">
          <PortfolioAllocation portfolio={portfolio} />
        </div>

        {/* Pozycje — reużyty panel (własny scroll + nagłówek „Positions") */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <PositionsPanel />
        </div>
      </div>
    </>
  );
}
