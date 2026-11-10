// ============================================================
// Silnik portfela (warstwa C) — DETERMINISTYCZNY.
//
// Zasada AI v2: skład portfela liczy KOD, model tylko go opisuje.
// Zero halucynowanych tickerów (wyłącznie katalog), zero tokenów na dobór,
// wynik stabilny i testowalny (bez Math.random, jawny tie-break).
//
// Model core / satellite:
//   • core      — szerokie ETF-y (fundament), udział sterowany level + risk
//                 (beginner/low → większy, advanced/high → mniejszy, NIGDY 0),
//   • satellite — pozycje z kategorii zainteresowań, filtr ryzyka,
//                 limity: max % na ticker i max % na sektor,
//   • cash      — bufor gotówki (nigdy nie alokujemy 100% budżetu).
//
// Ceny: whole shares (api/orders kupuje całe akcje) — gdy jednej akcji nie
// da się kupić w limicie pozycji, ticker wypada i wchodzi następny kandydat.
//
// Plik CZYSTY (bez I/O, bez aliasu `@/`) — ceny/konsensus wstrzykuje route,
// testy `cy.task` wołają go bezpośrednio w Node.
// ============================================================
import {
  RECOMMENDATION_CATALOG,
  BROAD_MARKET_KEY,
  matchCategories,
  defaultCategories,
  allowedRisks,
  type CatalogCategory,
  type CatalogEntry,
} from './catalog';
import type { Recommendation, RiskTolerance, UserStrategy } from '../coach/types';

// ---- Typy ---------------------------------------------------

export interface PlanContext {
  positions: string[]; // tickery już posiadane — nie proponujemy ich ponownie
  prices?: Record<string, number>; // żywe ceny (cache prices.ts); brak = bez akcji
  cash?: number | null; // gotówka w portfelu — budżet nie może jej przekroczyć
}

export interface PlanLimits {
  coreShare: number; // docelowy udział core (0..1)
  cashBuffer: number; // udział gotówki (0..1)
  maxTickerWeight: number; // max udział pojedynczego satelity
  maxSectorWeight: number; // max udział jednego sektora (satelity)
  coreCount: number;
  satelliteCount: number;
}

export interface PlanItem {
  entry: CatalogEntry;
  category: CatalogCategory;
  role: 'core' | 'satellite';
  weight: number; // docelowa waga (0..1 bazy)
  amount: number; // USD
  shares?: number; // całe akcje (gdy znana cena)
  price?: number;
  interestMatch: boolean;
  themeException?: boolean; // high-risk z reguły motywu (≤ 5%)
}

export interface PortfolioPlan {
  budget: number; // budżet z profilu
  base: number; // baza alokacji = min(budżet, gotówka)
  limits: PlanLimits;
  items: PlanItem[];
  invested: number; // suma kwot pozycji
  cashReserved: number; // base − invested (bufor + reszty z zaokrągleń)
  skippedOwned: string[]; // tickery pominięte, bo user je ma
  skippedUnaffordable: string[]; // jedna akcja > limit pozycji
  priced: boolean; // czy kwoty/akcje policzono z cen
}

// ---- Parametry profilu --------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Udział core: bazowo z ryzyka, korekta z poziomu i tolerancji spadków.
export function planLimits(s: UserStrategy): PlanLimits {
  const baseCore: Record<RiskTolerance, number> = { low: 0.65, medium: 0.5, high: 0.35 };
  const levelAdj = s.level === 'beginner' ? 0.1 : s.level === 'advanced' ? -0.1 : 0;
  const ddAdj = s.drawdownComfort === 'low' ? 0.05 : s.drawdownComfort === 'high' ? -0.05 : 0;
  const etfOnly =
    s.preferredInstruments?.length === 1 && s.preferredInstruments[0] === 'etf';
  // Core NIGDY poniżej 25% — nawet agresywny profil ma fundament.
  const coreShare = etfOnly ? 0.85 : clamp(baseCore[s.risk] + levelAdj + ddAdj, 0.25, 0.8);

  // Bufor gotówki: ostrożniejsi trzymają więcej; regularne dopłaty go zmniejszają.
  const baseCash: Record<RiskTolerance, number> = { low: 0.1, medium: 0.07, high: 0.05 };
  const cashBuffer = clamp(baseCash[s.risk] - ((s.monthlyContribution ?? 0) > 0 ? 0.02 : 0), 0.03, 0.15);

  const maxTicker: Record<RiskTolerance, number> = { low: 0.1, medium: 0.12, high: 0.15 };
  const maxSector: Record<RiskTolerance, number> = { low: 0.2, medium: 0.25, high: 0.3 };
  const satelliteCount = s.level === 'beginner' ? 4 : s.level === 'intermediate' ? 5 : 6;
  const coreCount = s.level === 'beginner' || s.risk === 'low' ? 2 : 1;

  return {
    coreShare,
    cashBuffer,
    maxTickerWeight: maxTicker[s.risk],
    maxSectorWeight: maxSector[s.risk],
    coreCount,
    satelliteCount,
  };
}

// ---- Wykluczenia --------------------------------------------

function isExcluded(entry: CatalogEntry, category: CatalogCategory, exclusions: string[]): boolean {
  if (exclusions.length === 0) return false;
  const hay = [
    entry.ticker,
    entry.name,
    entry.sector,
    category.key,
    category.label,
    ...entry.themes,
  ].map((x) => x.toLowerCase());
  return exclusions
    .map((x) => x.toLowerCase().trim())
    .filter((x) => x.length >= 2)
    .some((x) => hay.some((h) => h === x || (x.length >= 3 && h.includes(x))));
}

// ---- Dobór core ---------------------------------------------

// Kolejność kandydatów core per ryzyko: druga pozycja ma DYWERSYFIKOWAĆ
// (VOO+VTI to prawie to samo, VOO+SCHD to inny czynnik).
const CORE_ORDER: Record<RiskTolerance, string[]> = {
  low: ['VOO', 'SCHD', 'VTI', 'QQQ'],
  medium: ['VOO', 'SCHD', 'QQQ', 'VTI'],
  high: ['VOO', 'QQQ', 'SCHD', 'VTI'],
};

function coreCandidates(s: UserStrategy, skip: Set<string>): CatalogEntry[] {
  const broad = RECOMMENDATION_CATALOG.find((c) => c.key === BROAD_MARKET_KEY);
  if (!broad) return [];
  let order = [...CORE_ORDER[s.risk]];
  if (s.dividendPreference) order = ['SCHD', ...order.filter((t) => t !== 'SCHD')];
  const allowed = allowedRisks(s.level, s.risk);
  return order
    .map((t) => broad.entries.find((e) => e.ticker === t))
    .filter((e): e is CatalogEntry => !!e && allowed.has(e.risk) && !skip.has(e.ticker))
    .filter((e) => !isExcluded(e, broad, s.exclusions ?? []));
}

// ---- Dobór satelitów ----------------------------------------

function scoreEntry(e: CatalogEntry, s: UserStrategy, interestMatch: boolean): number {
  let score = interestMatch ? 3 : 0;
  score += e.risk === s.risk ? 2 : 1;
  if (s.level === 'beginner' && e.beginnerFriendly) score += 1;
  if (s.dividendPreference && (e.dividendYieldBand === 'medium' || e.dividendYieldBand === 'high')) score += 1;
  if (s.risk === 'low' && e.volatilityBand === 'low') score += 1;
  if (s.risk === 'high' && e.volatilityBand === 'high') score += 0.5;
  return score;
}

const RANK = new Map<string, number>(
  RECOMMENDATION_CATALOG.flatMap((c) => c.entries).map((e, i) => [e.ticker, i]),
);
const catalogRank = (e: CatalogEntry): number => RANK.get(e.ticker) ?? Number.MAX_SAFE_INTEGER;

interface Candidate {
  entry: CatalogEntry;
  category: CatalogCategory;
  interestMatch: boolean;
  score: number;
  themeException?: boolean; // high-risk wpuszczony regułą motywu (max 1, ≤ 5%)
}

// Reguła motywu: user WPROST wybrał motyw, a filtr ryzyka wyciął z niego
// wszystko (np. magnesy → tylko MP/REMX, oba high). Dla profilu medium
// wpuszczamy wtedy max 1 taką pozycję, z wagą ≤ 5% i oznaczeniem ryzyka —
// lepsze niż cicho zignorować zainteresowanie usera.
export const THEME_EXCEPTION_MAX_WEIGHT = 0.05;

function satelliteCandidates(s: UserStrategy, skip: Set<string>): Candidate[] {
  const allowed = allowedRisks(s.level, s.risk);
  const matched = matchCategories(s.interests);
  const matchedKeys = new Set(matched.map((c) => c.key));
  // Kategorie zainteresowań najpierw, potem domyślne — dla dywersyfikacji,
  // gdy zainteresowania są wąskie (np. tylko „nuclear").
  const cats = [...matched, ...defaultCategories().filter((c) => !matchedKeys.has(c.key))];
  const stocksAllowed = !(s.preferredInstruments?.length === 1 && s.preferredInstruments[0] === 'etf');
  const shortHorizon = s.horizonYears != null && s.horizonYears < 3;

  const eligible = (c: CatalogCategory, riskOk: (e: CatalogEntry) => boolean): Candidate[] =>
    c.entries
      .filter((e) => riskOk(e) && !skip.has(e.ticker))
      .filter((e) => stocksAllowed || e.kind === 'etf')
      // Beginner + niskie ryzyko → tylko pozycje „beginnerFriendly".
      .filter((e) => !(s.level === 'beginner' && s.risk === 'low') || e.beginnerFriendly)
      // Krótki horyzont → bez pozycji wymagających długiego trzymania.
      .filter((e) => !shortHorizon || e.horizon !== 'long')
      .filter((e) => !isExcluded(e, c, s.exclusions ?? []))
      .map((e) => ({ entry: e, category: c, interestMatch: matchedKeys.has(c.key), score: scoreEntry(e, s, matchedKeys.has(c.key)) }))
      // Tie-break deterministyczny: score malejąco, potem kuratorowana
      // kolejność katalogu (liderzy kategorii są pierwsi, np. NVDA przed INTC).
      .sort((a, b) => b.score - a.score || catalogRank(a.entry) - catalogRank(b.entry));

  const perCat: Candidate[][] = cats.map((c) => eligible(c, (e) => allowed.has(e.risk)));

  // Reguła motywu (patrz THEME_EXCEPTION_MAX_WEIGHT) — tylko risk medium,
  // tylko kategoria z zainteresowań, która po filtrze ryzyka jest pusta.
  if (s.risk === 'medium') {
    const emptyIdx = perCat.findIndex((list, ci) => ci < matched.length && list.length === 0);
    if (emptyIdx >= 0) {
      // ETF przed pojedynczą spółką (REMX przed MP) — mniej ryzyka idiosynkratycznego.
      const best = eligible(cats[emptyIdx], (e) => e.risk === 'high').sort(
        (a, b) => (a.entry.kind === 'etf' ? 0 : 1) - (b.entry.kind === 'etf' ? 0 : 1),
      )[0];
      if (best) perCat[emptyIdx] = [{ ...best, themeException: true }];
    }
  }

  // Round-robin po kategoriach → różnorodność zamiast 4× tech.
  // Osobno dla kategorii z zainteresowań i dla domyślnych (dywersyfikatorów).
  const roundRobin = (lists: Candidate[][]): Candidate[] => {
    const out: Candidate[] = [];
    for (let idx = 0; ; idx++) {
      let progressed = false;
      for (const list of lists) {
        if (list[idx]) {
          out.push(list[idx]);
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    return out;
  };
  return [
    ...roundRobin(perCat.slice(0, matched.length)),
    ...roundRobin(perCat.slice(matched.length)),
  ];
}

// Wybór satelitów: ~2/3 slotów dla zainteresowań, reszta dywersyfikuje
// poza nimi; max 2 tickery na sektor.
function pickSatellites(cands: Candidate[], count: number): Candidate[] {
  const picked: Candidate[] = [];
  const perSector = new Map<string, number>();
  const hasDiversifiers = cands.some((c) => !c.interestMatch);
  const interestSlots = hasDiversifiers ? Math.ceil((count * 2) / 3) : count;
  let interestPicked = 0;
  for (const c of cands) {
    if (picked.length >= count) break;
    if (c.interestMatch && interestPicked >= interestSlots) continue;
    const n = perSector.get(c.entry.sector) ?? 0;
    if (n >= 2) continue;
    picked.push(c);
    perSector.set(c.entry.sector, n + 1);
    if (c.interestMatch) interestPicked++;
  }
  // Gdy zabrakło dywersyfikatorów — dobierz z zainteresowań ponad 2/3 (limit sektorów zostaje).
  for (const c of cands) {
    if (picked.length >= count) break;
    if (picked.includes(c)) continue;
    const n = perSector.get(c.entry.sector) ?? 0;
    if (n >= 2) continue;
    picked.push(c);
    perSector.set(c.entry.sector, n + 1);
  }
  // Gdy limit sektorów zostawił luki — dobierz resztę bez limitu.
  for (const c of cands) {
    if (picked.length >= count) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked;
}

// ---- Wagi z limitami ----------------------------------------

// Bazowa waga satelity: stabilniejsze ważą więcej, spekulacyjne mniej;
// pozycje z zainteresowań usera ×1,3 (to one mają „nieść" jego tezę).
function rawWeight(c: Candidate, s: UserStrategy): number {
  const e = c.entry;
  const base = e.risk === 'low' ? 1.2 : e.risk === 'medium' ? 1 : s.risk === 'high' ? 0.9 : 0.7;
  return base * (c.interestMatch ? 1.3 : 1);
}

// Rozkłada `total` na satelity z limitem per ticker i per sektor.
// Nadwyżka, której nie da się ulokować, wraca jako `overflow` (trafia do core).
export function capWeights(
  items: Array<{ key: string; sector: string; raw: number; cap?: number }>,
  total: number,
  maxTicker: number,
  maxSector: number,
): { weights: Record<string, number>; overflow: number } {
  const weights: Record<string, number> = {};
  const capped = new Set<string>();
  let remaining = total;

  for (let iter = 0; iter < 20 && remaining > 1e-9; iter++) {
    const open = items.filter((i) => !capped.has(i.key));
    if (open.length === 0) break;
    const rawSum = open.reduce((s, i) => s + i.raw, 0);
    // Rozdaj `remaining` proporcjonalnie, potem przytnij do limitów.
    for (const i of open) weights[i.key] = (weights[i.key] ?? 0) + (remaining * i.raw) / rawSum;
    remaining = 0;

    for (const i of open) {
      const cap = Math.min(maxTicker, i.cap ?? maxTicker);
      if (weights[i.key] > cap) {
        remaining += weights[i.key] - cap;
        weights[i.key] = cap;
        capped.add(i.key);
      }
    }
    const sectors = [...new Set(items.map((i) => i.sector))];
    for (const sec of sectors) {
      const members = items.filter((i) => i.sector === sec);
      const sum = members.reduce((s, i) => s + (weights[i.key] ?? 0), 0);
      if (sum > maxSector + 1e-9) {
        const scale = maxSector / sum;
        for (const m of members) {
          remaining += weights[m.key] * (1 - scale);
          weights[m.key] *= scale;
          capped.add(m.key);
        }
      }
    }
  }
  return { weights, overflow: remaining };
}

// ---- Główna funkcja -----------------------------------------

export function buildPortfolioPlan(strategy: UserStrategy, ctx: PlanContext): PortfolioPlan {
  const limits = planLimits(strategy);
  const owned = new Set(ctx.positions.map((t) => t.toUpperCase()));
  const base = round2(
    ctx.cash != null && ctx.cash > 0 ? Math.min(strategy.budget, ctx.cash) : strategy.budget,
  );
  const prices = ctx.prices ?? {};
  const unaffordable = new Set<string>();

  // Pętla „wyrzuć niekupowalne i przelicz" — max kilka iteracji, deterministyczna.
  for (let attempt = 0; attempt < 8; attempt++) {
    const skip = new Set<string>([...owned, ...unaffordable]);
    const plan = allocateOnce(strategy, limits, base, skip, prices);
    const newlyUnaffordable = plan.items
      .filter((i) => i.price != null && i.shares === 0)
      .map((i) => i.entry.ticker);
    if (newlyUnaffordable.length === 0) {
      return finalize(plan, strategy, owned, unaffordable);
    }
    newlyUnaffordable.forEach((t) => unaffordable.add(t));
  }
  const skip = new Set<string>([...owned, ...unaffordable]);
  const last = allocateOnce(strategy, limits, base, skip, prices);
  last.items = last.items.filter((i) => i.shares !== 0);
  return finalize(last, strategy, owned, unaffordable);
}

function allocateOnce(
  s: UserStrategy,
  limits: PlanLimits,
  base: number,
  skip: Set<string>,
  prices: Record<string, number>,
): PortfolioPlan {
  const core = coreCandidates(s, skip).slice(0, limits.coreCount);
  const sats = pickSatellites(satelliteCandidates(s, skip), limits.satelliteCount);

  const investable = 1 - limits.cashBuffer;
  // Bez satelitów (np. tylko ETF) całość idzie do core.
  const satShare = sats.length > 0 ? Math.max(0, investable - limits.coreShare) : 0;
  const { weights: satW, overflow } = capWeights(
    sats.map((c) => ({
      key: c.entry.ticker,
      sector: c.entry.sector,
      raw: rawWeight(c, s),
      ...(c.themeException ? { cap: THEME_EXCEPTION_MAX_WEIGHT } : {}),
    })),
    satShare,
    limits.maxTickerWeight,
    limits.maxSectorWeight,
  );
  const coreShare = investable - satShare + overflow;

  // Core: 1 ETF = całość; 2 ETF-y = 60/40 (główny + dywersyfikujący).
  const coreSplit = core.length >= 2 ? [0.6, 0.4] : [1];
  const broad = RECOMMENDATION_CATALOG.find((c) => c.key === BROAD_MARKET_KEY);

  const items: PlanItem[] = [
    ...core.map((e, i): PlanItem => ({
      entry: e,
      category: broad as CatalogCategory,
      role: 'core',
      weight: coreShare * (coreSplit[i] ?? 0),
      amount: 0,
      interestMatch: false,
    })),
    ...sats.map((c): PlanItem => ({
      entry: c.entry,
      category: c.category,
      role: 'satellite',
      weight: satW[c.entry.ticker] ?? 0,
      amount: 0,
      interestMatch: c.interestMatch,
      ...(c.themeException ? { themeException: true } : {}),
    })),
  ];

  // Kwoty + całe akcje z cen.
  const tickerCap = limits.maxTickerWeight * base;
  for (const it of items) {
    const target = it.weight * base;
    const price = prices[it.entry.ticker];
    if (price != null && price > 0) {
      let shares = Math.floor(target / price);
      // Jedna akcja lekko ponad cel (≤ 1,5× i w limicie pozycji) → bierzemy 1.
      // Droższa → 0 akcji → ticker wypada, wchodzi następny kandydat.
      if (shares === 0 && price <= Math.min(tickerCap, target * 1.5)) shares = 1;
      it.price = price;
      it.shares = shares;
      it.amount = round2(shares * price);
    } else {
      // Floor do centów — suma zaokrągleń nie może przebić bufora gotówki.
      it.amount = Math.floor(target * 100) / 100;
    }
  }

  // Reszta z zaokrągleń → dokupujemy całe akcje core (bezpieczny „zlew"),
  // nie naruszając bufora gotówki.
  const investableUsd = investable * base;
  let invested = items.reduce((sum, i) => sum + i.amount, 0);
  // Bump „1 akcja" mógł przebić bufor — oddajemy akcje core (od ostatniej).
  for (const it of items.filter((i) => i.role === 'core' && i.price).reverse()) {
    const price = it.price as number;
    while (invested > investableUsd + 1e-6 && (it.shares ?? 0) > 1) {
      it.shares = (it.shares ?? 0) - 1;
      it.amount = round2((it.shares ?? 0) * price);
      invested -= price;
    }
  }
  for (const it of items.filter((i) => i.role === 'core' && i.price)) {
    const price = it.price as number;
    while (invested + price <= investableUsd + 1e-6) {
      it.shares = (it.shares ?? 0) + 1;
      it.amount = round2((it.shares ?? 0) * price);
      invested += price;
    }
  }

  return {
    budget: s.budget,
    base,
    limits,
    items,
    invested: round2(invested),
    cashReserved: round2(base - invested),
    skippedOwned: [],
    skippedUnaffordable: [],
    priced: items.some((i) => i.price != null),
  };
}

function finalize(
  plan: PortfolioPlan,
  s: UserStrategy,
  owned: Set<string>,
  unaffordable: Set<string>,
): PortfolioPlan {
  const invested = round2(plan.items.reduce((sum, i) => sum + i.amount, 0));
  // Wagi raportujemy względem faktycznych kwot (spójne z tym, co UI pokaże).
  if (plan.priced && plan.base > 0) {
    for (const it of plan.items) it.weight = Math.round((it.amount / plan.base) * 10000) / 10000;
  }
  // Pominięte posiadane: tylko te, które silnik by rozważył (są w katalogu).
  const catalogTickers = new Set(RECOMMENDATION_CATALOG.flatMap((c) => c.entries.map((e) => e.ticker)));
  return {
    ...plan,
    budget: s.budget,
    invested,
    cashReserved: round2(plan.base - invested),
    skippedOwned: [...owned].filter((t) => catalogTickers.has(t)).sort(),
    skippedUnaffordable: [...unaffordable].sort(),
    priced: plan.items.some((i) => i.price != null),
  };
}

// ---- Mapowanie na kontrakt Recommendation -------------------

const horizonOf = (e: CatalogEntry): 'short' | 'mid' | 'long' => e.horizon;

// Plan → Recommendation[] (bez rationale/risks — dokłada je explain.ts).
export function planToRecommendations(plan: PortfolioPlan): Recommendation[] {
  return plan.items.map((it) => ({
    ticker: it.entry.ticker,
    reason: it.entry.reason,
    suggestedWeight: Math.round(it.weight * 10000) / 10000,
    name: it.entry.name,
    category: it.category.label,
    kind: it.entry.kind,
    risk: it.entry.risk,
    role: it.role,
    suggestedAmount: it.amount,
    ...(it.shares != null ? { suggestedShares: it.shares } : {}),
    ...(it.price != null ? { price: it.price } : {}),
    horizon: horizonOf(it.entry),
  }));
}

// ---- Weryfikacja planu (używana w testach i w route) ---------

export interface PlanCheck {
  ok: boolean;
  problems: string[];
}

export function checkPlan(plan: PortfolioPlan, ctx: PlanContext): PlanCheck {
  const problems: string[] = [];
  const owned = new Set(ctx.positions.map((t) => t.toUpperCase()));
  const catalog = new Set(RECOMMENDATION_CATALOG.flatMap((c) => c.entries.map((e) => e.ticker)));
  const sectorSum = new Map<string, number>();
  for (const it of plan.items) {
    if (!catalog.has(it.entry.ticker)) problems.push(`${it.entry.ticker} not in catalog`);
    if (owned.has(it.entry.ticker)) problems.push(`${it.entry.ticker} already owned`);
    if (it.role === 'satellite') {
      if (it.weight > plan.limits.maxTickerWeight + 0.005) problems.push(`${it.entry.ticker} over ticker cap`);
      sectorSum.set(it.entry.sector, (sectorSum.get(it.entry.sector) ?? 0) + it.weight);
    }
  }
  for (const [sec, w] of sectorSum) {
    if (w > plan.limits.maxSectorWeight + 0.005) problems.push(`sector ${sec} over cap (${w.toFixed(3)})`);
  }
  if (!plan.items.some((i) => i.role === 'core')) problems.push('no core position');
  if (plan.invested > plan.base * (1 - plan.limits.cashBuffer) + 0.01) problems.push('cash buffer violated');
  return { ok: problems.length === 0, problems };
}
