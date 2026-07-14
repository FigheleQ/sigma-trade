'use client';

// ============================================================
// Podgląd portfela w TopBarze — total value, P/L, cash.
// Zawsze widoczny (desktop) — kluczowa informacja dla tradera.
// ============================================================
import { useEffect } from 'react';
import { usePortfolioStore } from '@/store/portfolioStore';
import { cn } from '@/lib/utils';
import { fmtUSD, fmtSignedUSD, fmtPct } from '@/lib/portfolio/format';
import PortfolioAllocation from './PortfolioAllocation';

export default function PortfolioSummary() {
  const portfolio = usePortfolioStore((s) => s.portfolio);
  const fetchPortfolio = usePortfolioStore((s) => s.fetchPortfolio);

  useEffect(() => {
    void fetchPortfolio();
  }, [fetchPortfolio]);

  // Rezerwujemy szerokość slotu, zanim dane portfela dotrą. Bez tego blok
  // „wskakuje" w topbar po fetchu i przesuwa ProfileButton — to był główny
  // źródło CLS na desktopie (mobile go nie renderuje, stąd tam CLS ~0).
  if (!portfolio) {
    return <div className="hidden md:block w-[280px]" aria-hidden="true" />;
  }

  const positive = portfolio.totalPnL >= 0;

  return (
    // Desktop: hover na summary „spływa" popoverem z alokacją. Bridge (pt-2 na
    // wrapperze popovera zamiast marginu) trzyma ciągły obszar hovera, więc
    // przejście kursora z liczby na kartę nie gubi hovera.
    <div className="relative group hidden md:block">
      <div className="flex items-center gap-3 font-mono text-xs cursor-default">
        <span className="text-zinc-500">
          Portfolio{' '}
          <span className="text-gray-100 tabular-nums">{fmtUSD(portfolio.totalValue)}</span>
        </span>
        <span className={cn('tabular-nums', positive ? 'text-accent' : 'text-red-400')}>
          {fmtSignedUSD(portfolio.totalPnL)} ({fmtPct(portfolio.totalPnLPercent)})
        </span>
        <span className="text-zinc-500">
          Cash{' '}
          <span className="text-gray-300 tabular-nums">{fmtUSD(portfolio.cash)}</span>
        </span>
      </div>

      {/* Hover popover — fade + subtelny slide, spójne z overlayami (ease-in-out).
          invisible/visible zdejmuje kartę z tab-flow i hit-testu gdy schowana. */}
      <div
        className={cn(
          'absolute right-0 top-full z-50 pt-2',
          'opacity-0 invisible -translate-y-1',
          'group-hover:opacity-100 group-hover:visible group-hover:translate-y-0',
          'transition-all duration-200 ease-in-out',
        )}
      >
        <div className="w-64 rounded-lg border border-border-subtle bg-bg-panel p-3 shadow-xl">
          <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-wider">
            Allocation
          </span>
          <div className="mt-2">
            <PortfolioAllocation portfolio={portfolio} />
          </div>
        </div>
      </div>
    </div>
  );
}
