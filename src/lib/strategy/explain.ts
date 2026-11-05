// ============================================================
// Uzasadnienia rekomendacji — deterministyczne, z metadanych katalogu.
//
// Decyzja AI v2: `rationale` i `risks` generuje KOD, nie model.
//   • zero tokenów (narracja modelu to tylko 2–4 zdania podsumowania),
//   • zero halucynacji (każdy punkt wynika z danych pozycji i profilu),
//   • stabilne między renderami / testowalne.
// Plik CZYSTY — bez I/O.
// ============================================================
import type { PlanItem, PortfolioPlan } from './allocate';
import type { AnalystConsensus, Confidence, Recommendation, UserStrategy } from '../coach/types';

const pct = (n: number) => `${Math.round(n * 100)}%`;

function rationaleFor(it: PlanItem, s: UserStrategy, plan: PortfolioPlan, consensus: AnalystConsensus | null): string[] {
  const out: string[] = [];
  const e = it.entry;

  if (it.role === 'core') {
    out.push(
      `Core holding: ${pct(plan.limits.coreShare)} of the plan sits in broad ETFs, sized for a ${s.level} investor with ${s.risk} risk.`,
    );
  } else if (it.interestMatch) {
    out.push(`Matches your interest in ${it.category.label.toLowerCase()}.`);
  } else {
    out.push(`Adds ${e.sector.toLowerCase()} exposure so the plan is not concentrated in one theme.`);
  }

  if (e.volatilityBand === 'low') out.push(`Lower volatility — a steadier fit for a ${s.risk}-risk profile.`);
  else if (e.volatilityBand === 'high') out.push(`Higher-octane pick, kept small (${pct(it.weight)}) to fit your ${s.risk} risk.`);
  else out.push(`Middle-of-the-road volatility, capped at ${pct(it.weight)} of the plan.`);

  if (s.dividendPreference && (e.dividendYieldBand === 'medium' || e.dividendYieldBand === 'high')) {
    out.push('Pays a meaningful dividend, in line with your income preference.');
  } else if (consensus && consensus.buy > consensus.hold + consensus.sell) {
    out.push(`Most analysts rate it a buy (${consensus.buy} of ${consensus.buy + consensus.hold + consensus.sell}).`);
  } else if (s.level === 'beginner' && e.beginnerFriendly) {
    out.push('Well-known, liquid name — easy to follow while you learn.');
  }
  return out.slice(0, 3);
}

function risksFor(it: PlanItem): string[] {
  const e = it.entry;
  const out: string[] = [];
  if (it.role === 'core') out.push('Still falls with the whole market in a downturn — diversification is not a floor.');
  if (e.themes.includes('speculative') || e.themes.includes('small-cap')) {
    out.push('Speculative company — it could lose most of its value.');
  }
  if (e.volatilityBand === 'high') out.push('High volatility — 30%+ drops have happened and can happen again.');
  if (e.themes.includes('commodity')) out.push('Tied to commodity prices, which swing with the economic cycle.');
  if (e.themes.includes('turnaround')) out.push('Turnaround story — the recovery may take years or not happen.');
  if (e.themes.includes('growth') && e.volatilityBand !== 'low') {
    out.push('Priced for growth — earnings misses tend to be punished hard.');
  }
  if (e.sector === 'Financials' || e.sector === 'Utilities') out.push('Sensitive to interest-rate changes.');
  if (e.themes.includes('dividend') && it.role !== 'core') out.push('Dividends are not guaranteed and can be cut in tough years.');
  if (it.role === 'satellite' && out.length < 2) {
    out.push(`Single-company risk: ${e.sector.toLowerCase()} news can move it sharply.`);
  }
  return out.slice(0, 2);
}

function confidenceFor(it: PlanItem, s: UserStrategy, consensus: AnalystConsensus | null): Confidence {
  if (it.role === 'core') return 'high';
  const riskFit = it.entry.risk === s.risk || (s.risk !== 'low' && it.entry.risk !== 'high');
  const analystsPositive = consensus ? consensus.buy >= consensus.hold + consensus.sell : false;
  if (it.interestMatch && riskFit && (analystsPositive || !consensus)) return consensus ? 'high' : 'medium';
  if (!it.interestMatch) return 'low';
  return 'medium';
}

// Dokłada rationale / risks / konsensus / confidence do rekomendacji z planu.
export function explainPlan(
  plan: PortfolioPlan,
  s: UserStrategy,
  recs: Recommendation[],
  consensus: Record<string, AnalystConsensus | null> = {},
): Recommendation[] {
  const byTicker = new Map(plan.items.map((i) => [i.entry.ticker, i]));
  return recs.map((r) => {
    const it = byTicker.get(r.ticker);
    if (!it) return r;
    const c = consensus[r.ticker] ?? null;
    return {
      ...r,
      rationale: rationaleFor(it, s, plan, c),
      risks: risksFor(it),
      analystConsensus: c,
      confidence: confidenceFor(it, s, c),
    };
  });
}

// Deterministyczna narracja — fallback, gdy model nie odpowie albo jego
// tekst nie przejdzie walidacji tickerów.
export function deterministicNarration(plan: PortfolioPlan, s: UserStrategy): string {
  const core = plan.items.filter((i) => i.role === 'core').map((i) => i.entry.ticker);
  const sats = plan.items.filter((i) => i.role === 'satellite').map((i) => i.entry.ticker);
  const cashPct = plan.base > 0 ? Math.round((plan.cashReserved / plan.base) * 100) : 0;
  return (
    `Here's a starter plan for a ${s.level} investor with ${s.risk} risk: ` +
    `${core.join(' and ')} as your core, plus ${sats.join(', ')} as smaller satellite positions. ` +
    `About ${cashPct}% stays in cash as a buffer, and no single company or sector dominates. ` +
    'This is paper trading and education, not financial advice — tap any card to see why it fits and what could go wrong.'
  );
}
