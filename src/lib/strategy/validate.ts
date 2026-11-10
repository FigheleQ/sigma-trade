// ============================================================
// Walidacja profilu (UserStrategy) — jedno źródło prawdy dla:
//   • /api/coach (decyzja „onboarding complete" po stronie KODU),
//   • /api/strategy (zapis profilu),
//   • ekstrakcji slotów (model `light` / slotUpdates z czatu).
// Plik CZYSTY — bez I/O.
// ============================================================
import type { RiskTolerance, SkillLevel, UserStrategy } from '../coach/types';

const LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced'];
const RISKS: RiskTolerance[] = ['low', 'medium', 'high'];
const BANDS = ['low', 'medium', 'high'] as const;

export const isLevel = (v: unknown): v is SkillLevel => LEVELS.includes(v as SkillLevel);
export const isRisk = (v: unknown): v is RiskTolerance => RISKS.includes(v as RiskTolerance);

// Budżet: dodatni, rozsądny zakres paper tradingu (bez absurdów typu 1e12).
export const MIN_BUDGET = 100;
export const MAX_BUDGET = 10_000_000;
export const isBudget = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= MIN_BUDGET && v <= MAX_BUDGET;

const cleanStrings = (v: unknown, max: number, maxLen = 40): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => String(x).trim()).filter((x) => x.length > 0 && x.length <= maxLen))].slice(0, max)
    : [];

// Częściowy profil (sloty) → tylko poprawne pola. Nigdy nie rzuca.
export function sanitizeSlots(input: unknown): Partial<UserStrategy> {
  if (!input || typeof input !== 'object') return {};
  const o = input as Record<string, unknown>;
  const out: Partial<UserStrategy> = {};
  if (isLevel(o.level)) out.level = o.level;
  if (isRisk(o.risk)) out.risk = o.risk;
  const budget = typeof o.budget === 'string' ? Number(o.budget) : o.budget;
  if (isBudget(budget)) out.budget = Math.round(budget);
  const interests = cleanStrings(o.interests, 6);
  if (interests.length) out.interests = interests;

  const horizon = Number(o.horizonYears);
  if (o.horizonYears != null && Number.isFinite(horizon) && horizon > 0 && horizon <= 60) out.horizonYears = Math.round(horizon);
  const monthly = Number(o.monthlyContribution);
  if (o.monthlyContribution != null && Number.isFinite(monthly) && monthly >= 0 && monthly <= 1_000_000) out.monthlyContribution = Math.round(monthly);
  if (BANDS.includes(o.drawdownComfort as (typeof BANDS)[number])) out.drawdownComfort = o.drawdownComfort as (typeof BANDS)[number];
  const instruments = cleanStrings(o.preferredInstruments, 2).filter((x): x is 'etf' | 'stocks' => x === 'etf' || x === 'stocks');
  if (instruments.length) out.preferredInstruments = instruments;
  if (typeof o.dividendPreference === 'boolean') out.dividendPreference = o.dividendPreference;
  const exclusions = cleanStrings(o.exclusions, 10);
  if (exclusions.length) out.exclusions = exclusions;
  return out;
}

// Pełny profil albo null (rozwinięcie dawnego coerceStrategy z agent.ts).
export function coerceStrategy(input: unknown): UserStrategy | null {
  const s = sanitizeSlots(input);
  if (!s.level || !s.risk || s.budget == null || !s.interests?.length) return null;
  return { ...s, level: s.level, risk: s.risk, budget: s.budget, interests: s.interests };
}
