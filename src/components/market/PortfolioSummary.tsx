'use client';

// ============================================================
// Podgląd portfela w TopBarze — total value, P/L, cash.
// Zawsze widoczny (desktop) — kluczowa informacja dla tradera.
// ============================================================
import { useEffect } from 'react';
import { usePortfolioStore } from '@/store/portfolioStore';
import { cn } from '@/lib/utils';
import { fmtUSD, fmtSignedUSD, fmtPct } from '@/lib/portfolio/format';

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
    <div className="hidden md:flex items-center gap-3 font-mono text-xs">
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
  );
}
