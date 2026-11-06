'use client';

// ============================================================
// Onboarding na kafelkach — zamiast 4 tur czatu z modelem.
//
// Użytkownik klika: poziom → zainteresowania (multi) → ryzyko → budżet.
// Wybór idzie do /api/coach jako gotowe sloty (`slots`), więc onboarding
// kosztuje 0 wywołań modelu aż do jednego podsumowania planu. Kategorie
// pochodzą z katalogu silnika (jedno źródło prawdy z allocate.ts).
// Czat obok dalej działa — można pisać zamiast klikać.
// ============================================================
import { useState } from 'react';
import {
  ArrowLeft,
  Atom,
  Bot,
  Car,
  Check,
  Clapperboard,
  Coffee,
  Cpu,
  Fuel,
  Gauge,
  GraduationCap,
  HeartPulse,
  Landmark,
  Magnet,
  PieChart,
  Plane,
  Rocket,
  Shield,
  ShoppingCart,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { RECOMMENDATION_CATALOG, BROAD_MARKET_KEY } from '@/lib/strategy/catalog';
import { BROAD_INTEREST, type SlotState } from '@/lib/coach/slots';
import type { RiskTolerance, SkillLevel } from '@/lib/coach/types';

interface TileOption<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
  icon: LucideIcon;
}

const LEVELS: TileOption<SkillLevel>[] = [
  { value: 'beginner', label: 'Beginner', hint: 'New to investing', icon: GraduationCap },
  { value: 'intermediate', label: 'Intermediate', hint: 'Bought a few stocks', icon: Gauge },
  { value: 'advanced', label: 'Advanced', hint: 'Years of trading', icon: Rocket },
];

const RISKS: TileOption<RiskTolerance>[] = [
  { value: 'low', label: 'Low', hint: 'Steady, smaller swings', icon: Shield },
  { value: 'medium', label: 'Medium', hint: 'Balanced growth', icon: Gauge },
  { value: 'high', label: 'High', hint: 'Big swings, big upside', icon: Rocket },
];

const BUDGETS: TileOption<number>[] = [
  { value: 10_000, label: '$10k', hint: 'Starter', icon: Wallet },
  { value: 50_000, label: '$50k', hint: 'Balanced', icon: Wallet },
  { value: 100_000, label: '$100k', hint: 'Full sandbox', icon: Wallet },
];

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  technology: Bot,
  semiconductors: Cpu,
  'automotive-ev': Car,
  'food-beverage': Coffee,
  healthcare: HeartPulse,
  financials: Landmark,
  'energy-traditional': Fuel,
  'clean-nuclear': Atom,
  'materials-rare-earth': Magnet,
  'aerospace-defense': Plane,
  'retail-ecommerce': ShoppingCart,
  'entertainment-media': Clapperboard,
};

const INTERESTS: TileOption<string>[] = [
  ...RECOMMENDATION_CATALOG.filter((c) => c.key !== BROAD_MARKET_KEY).map((c) => ({
    value: c.key,
    label: c.shortLabel,
    icon: CATEGORY_ICONS[c.key] ?? PieChart,
  })),
  { value: BROAD_INTEREST, label: 'Not sure — keep it broad', icon: PieChart },
];

const MAX_INTERESTS = 5;
const STEP_TITLES = ['Your experience', 'What interests you?', 'Comfort with risk', 'Starting budget'];

function Tile<T extends string | number>({
  option,
  selected,
  disabled,
  onClick,
}: {
  option: TileOption<T>;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = option.icon;
  return (
    <button
      type="button"
      data-testid={`coach-tile-${option.value}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-start gap-1 rounded border px-2.5 py-2 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60',
        selected
          ? 'border-accent/60 bg-accent/10 text-accent'
          : 'border-border-subtle bg-bg-panel text-zinc-300 hover:border-accent/30 hover:text-zinc-100',
        disabled && !selected && 'opacity-40 cursor-not-allowed',
      )}
    >
      <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold leading-tight">
        <Icon size={13} className="shrink-0" aria-hidden="true" />
        {option.label}
      </span>
      {option.hint && <span className="font-mono text-[10px] text-zinc-500 leading-tight">{option.hint}</span>}
      {selected && <Check size={11} className="absolute top-1.5 right-1.5" aria-hidden="true" />}
    </button>
  );
}

export default function OnboardingTiles({
  onSubmit,
  busy,
}: {
  onSubmit: (slots: SlotState) => void;
  busy: boolean;
}) {
  const [step, setStep] = useState(0);
  const [level, setLevel] = useState<SkillLevel | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [risk, setRisk] = useState<RiskTolerance | null>(null);
  const [budget, setBudget] = useState<number | null>(null);

  // „Keep it broad" wyklucza się z konkretnymi motywami.
  const toggleInterest = (value: string) =>
    setInterests((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      if (value === BROAD_INTEREST) return [BROAD_INTEREST];
      const next = prev.filter((v) => v !== BROAD_INTEREST);
      return next.length >= MAX_INTERESTS ? next : [...next, value];
    });

  const canNext = [level != null, interests.length > 0, risk != null, budget != null][step];
  const isLast = step === STEP_TITLES.length - 1;

  const submit = () => {
    if (!level || !risk || budget == null || interests.length === 0) return;
    onSubmit({ level, interests, risk, budget });
  };

  // Wybór jednokrotny → od razu dalej (mniej klikania); multi → przycisk Next.
  const pickAndAdvance = <T,>(setter: (v: T) => void, value: T) => {
    setter(value);
    if (!isLast) setStep((s) => s + 1);
  };

  return (
    <section
      data-testid="coach-onboarding-tiles"
      aria-label="Build your investor profile"
      className="rounded border border-accent/30 bg-accent/5 p-3 space-y-2.5"
    >
      <div className="flex items-center gap-2">
        {step > 0 && (
          <button
            type="button"
            data-testid="coach-tiles-back"
            onClick={() => setStep((s) => s - 1)}
            aria-label="Previous step"
            className="text-zinc-500 hover:text-accent transition-colors"
          >
            <ArrowLeft size={13} />
          </button>
        )}
        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">{STEP_TITLES[step]}</span>
        <span className="ml-auto flex gap-1" aria-label={`Step ${step + 1} of ${STEP_TITLES.length}`}>
          {STEP_TITLES.map((t, i) => (
            <span
              key={t}
              className={cn('h-1 w-4 rounded-full', i <= step ? 'bg-accent/70' : 'bg-zinc-800')}
            />
          ))}
        </span>
      </div>

      {step === 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {LEVELS.map((o) => (
            <Tile key={o.value} option={o} selected={level === o.value} onClick={() => pickAndAdvance(setLevel, o.value)} />
          ))}
        </div>
      )}

      {step === 1 && (
        <>
          <p className="font-mono text-[10px] text-zinc-500">Pick up to {MAX_INTERESTS}.</p>
          <div className="grid grid-cols-2 gap-1.5">
            {INTERESTS.map((o) => (
              <Tile
                key={o.value}
                option={o}
                selected={interests.includes(o.value)}
                disabled={!interests.includes(o.value) && interests.length >= MAX_INTERESTS}
                onClick={() => toggleInterest(o.value)}
              />
            ))}
          </div>
        </>
      )}

      {step === 2 && (
        <div className="grid grid-cols-3 gap-1.5">
          {RISKS.map((o) => (
            <Tile key={o.value} option={o} selected={risk === o.value} onClick={() => pickAndAdvance(setRisk, o.value)} />
          ))}
        </div>
      )}

      {step === 3 && (
        <div className="grid grid-cols-3 gap-1.5">
          {BUDGETS.map((o) => (
            <Tile key={o.value} option={o} selected={budget === o.value} onClick={() => setBudget(o.value)} />
          ))}
        </div>
      )}

      <div className="flex justify-end">
        {isLast ? (
          <button
            type="button"
            data-testid="coach-tiles-submit"
            onClick={submit}
            disabled={!canNext || busy}
            className={cn(
              'px-3 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-wider transition-colors',
              canNext && !busy
                ? 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/25'
                : 'border-zinc-800 bg-zinc-900 text-zinc-600 cursor-not-allowed',
            )}
          >
            {busy ? 'Building…' : 'Build my plan'}
          </button>
        ) : (
          step === 1 && (
            <button
              type="button"
              data-testid="coach-tiles-next"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext}
              className={cn(
                'px-3 py-1.5 rounded border font-mono text-[10px] font-bold uppercase tracking-wider transition-colors',
                canNext
                  ? 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/25'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-600 cursor-not-allowed',
              )}
            >
              Next
            </button>
          )
        )}
      </div>
    </section>
  );
}
