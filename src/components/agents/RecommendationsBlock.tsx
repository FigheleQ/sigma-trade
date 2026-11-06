'use client';

// ============================================================
// Rekomendacje Coacha (po onboardingu) — karta per pozycja planu.
//
// Pola AI v2 są opcjonalne (kontrakt addytywny): gdy przychodzi stary
// kształt (mock: ticker/reason/suggestedWeight), karta degraduje się do
// widoku sprzed v2 — bez kwot, rozwijania i konsensusu.
// ============================================================
import { useId, useState } from 'react';
import { Sparkles, X, ChevronDown, ShoppingCart, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtUSD } from '@/lib/portfolio/format';
import { fmtShares } from '@/lib/portfolio/shares';
import { useCoachStore, selectCoachRecommendations } from '@/lib/store/coachStore';
import { usePortfolioStore } from '@/store/portfolioStore';
import { useWatchlistStore } from '@/store/watchlistStore';
import type { Recommendation, RiskTolerance } from '@/lib/coach/types';
import { fetchTickerInfo, type TickerInfo } from '@/lib/coach/describeClient';

const RISK_STYLES: Record<RiskTolerance, string> = {
  low: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5',
  medium: 'border-amber-500/30 text-amber-400 bg-amber-500/5',
  high: 'border-red-500/30 text-red-400 bg-red-500/5',
};

function Badge({ children, className, testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className={cn(
        'px-1.5 py-px rounded border font-mono text-[9px] uppercase tracking-wider shrink-0',
        className,
      )}
    >
      {children}
    </span>
  );
}

function ConsensusBar({ buy, hold, sell }: { buy: number; hold: number; sell: number }) {
  const total = buy + hold + sell || 1;
  return (
    <div data-testid="coach-rec-consensus" className="space-y-1">
      <div
        className="flex h-1.5 rounded overflow-hidden bg-zinc-800"
        role="img"
        aria-label={`Analyst consensus: ${buy} buy, ${hold} hold, ${sell} sell`}
      >
        <div className="bg-emerald-500/70" style={{ width: `${(buy / total) * 100}%` }} />
        <div className="bg-zinc-500/70" style={{ width: `${(hold / total) * 100}%` }} />
        <div className="bg-red-500/70" style={{ width: `${(sell / total) * 100}%` }} />
      </div>
      <div className="font-mono text-[10px] text-zinc-500">
        Analysts: <span className="text-emerald-400">{buy} buy</span> · {hold} hold ·{' '}
        <span className="text-red-400">{sell} sell</span>
      </div>
    </div>
  );
}

function RecommendationCard({ r }: { r: Recommendation }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const aboutId = useId();
  const requestOrderPrefill = usePortfolioStore((s) => s.requestOrderPrefill);

  // Opis spółki po kliknięciu tickera — model `light`, cache wspólny + lokalny.
  const [aboutOpen, setAboutOpen] = useState(false);
  const [about, setAbout] = useState<TickerInfo | null>(null);
  const [aboutLoading, setAboutLoading] = useState(false);

  const toggleAbout = () => {
    const next = !aboutOpen;
    setAboutOpen(next);
    if (next && !about && !aboutLoading) {
      setAboutLoading(true);
      void fetchTickerInfo(r.ticker).then((info) => {
        setAbout(info);
        setAboutLoading(false);
      });
    }
  };

  const hasDetails = (r.rationale?.length ?? 0) > 0 || (r.risks?.length ?? 0) > 0 || !!r.analystConsensus;
  const pct = `${Math.round(r.suggestedWeight * 100)}%`;

  const placeOrder = () => {
    // Przełącz wykres na ticker (watchlistStore synchronizuje chartStore),
    // OrderPanel otworzy BuyModal z sugerowaną liczbą akcji, gdy dojdzie cena.
    useWatchlistStore.getState().setActiveTicker(r.ticker);
    requestOrderPrefill(r.ticker, r.suggestedShares ?? 1);
  };

  return (
    <li
      data-testid="coach-rec-card"
      data-ticker={r.ticker}
      className="rounded border border-border-subtle bg-bg-panel p-2.5 space-y-1.5"
    >
      {/* Nagłówek: ticker, nazwa, rola, ryzyko */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          data-testid="coach-rec-about"
          onClick={toggleAbout}
          aria-expanded={aboutOpen}
          aria-controls={aboutId}
          aria-label={`What does ${r.name ?? r.ticker} do?`}
          title="What does this company do?"
          className="flex items-center gap-2 min-w-0 text-left group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 rounded"
        >
          <span className="font-mono text-xs font-bold text-accent shrink-0 underline decoration-dotted decoration-accent/40 underline-offset-2 group-hover:decoration-accent">
            {r.ticker}
          </span>
          {r.name && <span className="font-mono text-[10px] text-zinc-400 truncate">{r.name}</span>}
          <Info size={10} className="text-zinc-600 group-hover:text-accent shrink-0" aria-hidden="true" />
        </button>
        <span className="ml-auto flex items-center gap-1">
          {r.role && (
            <Badge
              testId="coach-rec-role"
              className={r.role === 'core' ? 'border-accent/40 text-accent bg-accent/5' : 'border-zinc-700 text-zinc-400'}
            >
              {r.role}
            </Badge>
          )}
          {r.risk && (
            <Badge testId="coach-rec-risk" className={RISK_STYLES[r.risk]}>
              {r.risk} risk
            </Badge>
          )}
        </span>
      </div>

      {aboutOpen && (
        <p
          id={aboutId}
          data-testid="coach-rec-description"
          aria-live="polite"
          className="font-mono text-[10px] leading-snug text-zinc-300 bg-bg-base/60 border border-border-subtle rounded px-2 py-1.5"
        >
          {aboutLoading ? 'Loading…' : (about?.description ?? r.reason)}
        </p>
      )}

      {/* Liczby: waga · kwota · akcje @ cena */}
      <div data-testid="coach-rec-amount" className="font-mono text-[11px] text-zinc-300 tabular-nums">
        <span className="text-zinc-500">{pct}</span>
        {r.suggestedAmount != null && <> · {fmtUSD(r.suggestedAmount)}</>}
        {r.suggestedShares != null && (
          <>
            {' '}
            · <span data-testid="coach-rec-shares">{fmtShares(r.suggestedShares)} sh</span>
            {r.price != null && <span className="text-zinc-500"> @ {fmtUSD(r.price)}</span>}
          </>
        )}
      </div>

      <p className="font-mono text-[11px] text-zinc-400 leading-snug">{r.reason}</p>

      {hasDetails && (
        <button
          type="button"
          data-testid="coach-rec-toggle"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500 hover:text-accent focus-visible:text-accent focus-visible:outline-none transition-colors"
        >
          <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
          Why it fits &amp; risks
        </button>
      )}

      {hasDetails && open && (
        <div id={detailsId} data-testid="coach-rec-details" className="space-y-2 pt-0.5">
          {r.rationale && r.rationale.length > 0 && (
            <div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-accent/80 mb-0.5">Why it fits you</div>
              <ul className="space-y-0.5">
                {r.rationale.map((line) => (
                  <li key={line} className="font-mono text-[10px] text-zinc-400 leading-snug pl-2 border-l border-accent/30">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.risks && r.risks.length > 0 && (
            <div data-testid="coach-rec-risks">
              <div className="font-mono text-[9px] uppercase tracking-wider text-red-400/80 mb-0.5">What could go wrong</div>
              <ul className="space-y-0.5">
                {r.risks.map((line) => (
                  <li key={line} className="font-mono text-[10px] text-zinc-400 leading-snug pl-2 border-l border-red-500/30">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.analystConsensus && <ConsensusBar {...r.analystConsensus} />}
        </div>
      )}

      <button
        type="button"
        data-testid="coach-rec-order"
        onClick={placeOrder}
        aria-label={`Place this order: buy ${r.suggestedShares != null ? fmtShares(r.suggestedShares) : 1} ${r.ticker}`}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded border font-mono text-[10px] uppercase tracking-wider transition-colors',
          'border-accent/30 text-accent bg-accent/5 hover:bg-accent/15',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60',
        )}
      >
        <ShoppingCart size={11} />
        Place this order
      </button>
    </li>
  );
}

export default function RecommendationsBlock() {
  const recommendations = useCoachStore(selectCoachRecommendations);
  const [dismissed, setDismissed] = useState(false);
  if (recommendations.length === 0 || dismissed) return null;

  const invested = recommendations.reduce((s, r) => s + (r.suggestedAmount ?? 0), 0);
  const coreShare = recommendations
    .filter((r) => r.role === 'core')
    .reduce((s, r) => s + r.suggestedWeight, 0);

  return (
    <div
      data-testid="coach-recommendations"
      className="mx-3 mb-3 rounded border border-accent/30 bg-accent/5 p-3 max-h-[45vh] overflow-y-auto"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles size={12} className="text-accent" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
          Recommended for you
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="ml-auto text-zinc-600 hover:text-zinc-400 transition-colors"
          aria-label="Dismiss recommendations"
        >
          <X size={12} />
        </button>
      </div>

      {invested > 0 && (
        <div data-testid="coach-rec-summary" className="font-mono text-[10px] text-zinc-500 mb-2 tabular-nums">
          {fmtUSD(invested)} planned
          {coreShare > 0 && <> · core {Math.round(coreShare * 100)}%</>} · paper trading, not advice
        </div>
      )}

      <ul className="space-y-2">
        {recommendations.map((r, i) => (
          <RecommendationCard key={`${r.ticker}-${i}`} r={r} />
        ))}
      </ul>
    </div>
  );
}
