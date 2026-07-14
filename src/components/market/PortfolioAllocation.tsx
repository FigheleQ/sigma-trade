'use client';

// ============================================================
// Wspólny breakdown portfela — pełny rozkład + pasek alokacji %.
// Jedna prawda dla dwóch afordancji: mobilnego sheeta (MobilePortfolioBar)
// i desktopowego hover-popovera (PortfolioSummary).
//   Portfolio = Investments + Cash (stąd caption przy Portfolio)
// ============================================================
import { cn } from '@/lib/utils';
import { fmtUSD, fmtSignedUSD, fmtPct } from '@/lib/portfolio/format';
import type { PortfolioState } from '@/lib/portfolio/types';

export default function PortfolioAllocation({
  portfolio,
}: {
  portfolio: PortfolioState;
}) {
  const invested = portfolio.positionsValue;
  const investedPct =
    portfolio.totalValue > 0 ? (invested / portfolio.totalValue) * 100 : 0;
  const cashPct = 100 - investedPct;
  const positive = portfolio.totalPnL >= 0;

  return (
    <div className="space-y-2">
      {/* Portfolio total = investments + cash */}
      <Row
        label="Portfolio"
        value={fmtUSD(portfolio.totalValue)}
        valueClass="text-gray-100"
      />
      <Row label="Investments" value={fmtUSD(invested)} valueClass="text-gray-300" />
      <Row label="Cash" value={fmtUSD(portfolio.cash)} valueClass="text-gray-300" />
      <Row
        label="P/L"
        value={`${fmtSignedUSD(portfolio.totalPnL)} (${fmtPct(portfolio.totalPnLPercent)})`}
        valueClass={positive ? 'text-accent' : 'text-red-400'}
      />

      {/* Pasek alokacji investments / cash */}
      <div className="pt-1.5">
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div className="bg-accent/70" style={{ width: `${investedPct}%` }} />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-zinc-600">
          <span>{investedPct.toFixed(0)}% invested</span>
          <span>{cashPct.toFixed(0)}% cash</span>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between font-mono text-xs">
      <span className="text-zinc-500">{label}</span>
      <span className={cn('tabular-nums', valueClass)}>{value}</span>
    </div>
  );
}
