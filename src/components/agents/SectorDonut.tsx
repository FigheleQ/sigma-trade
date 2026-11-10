'use client';

// ============================================================
// Donut planu — udział motywów (kategorii katalogu) w rekomendacjach.
//
// Paleta zwalidowana skryptem dataviz (dark, tło panelu #111111):
// pas jasności, chroma, separacja CVD sąsiadów, próg normal-vision i
// kontrast ≥ 3:1 — wszystko PASS. Zieleń core to ciemniejszy krok akcentu
// strony (#00ff88 jest za jasny na wykres). Gotówka = neutralny szary i
// zawsze leży między ostatnim motywem a core, więc pierścień kolorów jest
// liniowy (zieleń nie styka się z magentą). Identyfikację niesie też
// legenda z nazwami — kolor nigdy nie jest jedynym nośnikiem.
// ============================================================
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { fmtUSD } from '@/lib/portfolio/format';
import { RECOMMENDATION_CATALOG } from '@/lib/strategy/catalog';
import type { Recommendation } from '@/lib/coach/types';

// Kolejność slotów stała (kolor wynika z pozycji w tej liście, nie z rangi).
const CORE_COLOR = '#00b062';
const SATELLITE_COLORS = ['#3987e5', '#d95926', '#9085e9', '#c98500', '#d55181'];
const OTHER_COLOR = '#a1a1aa';
const CASH_COLOR = '#71717a';

const SIZE = 104;
const STROKE = 14;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
const GAP = 2; // px przerwy między wycinkami (wymóg czytelności przy sąsiadach)

interface Slice {
  key: string;
  label: string;
  weight: number; // 0..1 budżetu
  amount: number | null;
  color: string;
}

const shortLabelOf = (label: string): string =>
  RECOMMENDATION_CATALOG.find((c) => c.label === label)?.shortLabel ?? label;

export function buildSlices(recs: Recommendation[]): Slice[] {
  const groups = new Map<string, { label: string; weight: number; amount: number; hasAmount: boolean; core: boolean }>();
  for (const r of recs) {
    const core = r.role === 'core';
    const key = core ? '__core' : (r.category ?? r.ticker);
    const g = groups.get(key) ?? {
      label: core ? 'Broad market (core)' : shortLabelOf(r.category ?? r.ticker),
      weight: 0,
      amount: 0,
      hasAmount: false,
      core,
    };
    g.weight += r.suggestedWeight;
    if (r.suggestedAmount != null) {
      g.amount += r.suggestedAmount;
      g.hasAmount = true;
    }
    groups.set(key, g);
  }

  const core = groups.get('__core');
  // Satelity: największy udział pierwszy, remis → alfabetycznie (deterministycznie).
  const sats = [...groups.entries()]
    .filter(([k]) => k !== '__core')
    .sort(([, a], [, b]) => b.weight - a.weight || a.label.localeCompare(b.label));

  const slices: Slice[] = [];
  if (core) slices.push({ key: 'core', label: core.label, weight: core.weight, amount: core.hasAmount ? core.amount : null, color: CORE_COLOR });

  // Max 5 kolorów satelitów; reszta składa się do „Other" (nigdy generowany 6. odcień).
  sats.slice(0, SATELLITE_COLORS.length).forEach(([k, g], i) =>
    slices.push({ key: k, label: g.label, weight: g.weight, amount: g.hasAmount ? g.amount : null, color: SATELLITE_COLORS[i] }),
  );
  const rest = sats.slice(SATELLITE_COLORS.length);
  if (rest.length) {
    slices.push({
      key: 'other',
      label: 'Other',
      weight: rest.reduce((s, [, g]) => s + g.weight, 0),
      amount: rest.every(([, g]) => g.hasAmount) ? rest.reduce((s, [, g]) => s + g.amount, 0) : null,
      color: OTHER_COLOR,
    });
  }

  const invested = slices.reduce((s, x) => s + x.weight, 0);
  const cash = Math.max(0, 1 - invested);
  if (cash > 0.0005) slices.push({ key: 'cash', label: 'Cash buffer', weight: cash, amount: null, color: CASH_COLOR });
  return slices;
}

const pct = (w: number) => `${Math.round(w * 100)}%`;

export default function SectorDonut({ recommendations, base }: { recommendations: Recommendation[]; base?: number }) {
  const [active, setActive] = useState<string | null>(null);
  const slices = buildSlices(recommendations);
  if (slices.length === 0) return null;

  const total = slices.reduce((s, x) => s + x.weight, 0) || 1;
  let offset = 0;
  const arcs = slices.map((s) => {
    const len = (s.weight / total) * C;
    const arc = { ...s, dash: Math.max(0, len - GAP), offset };
    offset += len;
    return arc;
  });

  const focus = slices.find((s) => s.key === active) ?? null;
  const amountOf = (s: Slice): number | null =>
    s.amount ?? (base != null && s.key === 'cash' ? s.weight * base : null);

  return (
    <div data-testid="coach-rec-donut" className="flex items-center gap-3 mb-2">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Plan by theme: ${slices.map((s) => `${s.label} ${pct(s.weight)}`).join(', ')}`}
          className="-rotate-90"
        >
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#1f1f1f" strokeWidth={STROKE} />
          {arcs.map((a) => (
            <circle
              key={a.key}
              data-testid="coach-donut-slice"
              data-label={a.label}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={a.color}
              strokeWidth={active === a.key ? STROKE + 3 : STROKE}
              strokeDasharray={`${a.dash} ${C - a.dash}`}
              strokeDashoffset={-a.offset}
              opacity={active && active !== a.key ? 0.3 : 1}
              onMouseEnter={() => setActive(a.key)}
              onMouseLeave={() => setActive(null)}
              className="transition-[opacity,stroke-width] duration-150 cursor-default"
            >
              <title>{`${a.label}: ${pct(a.weight)}`}</title>
            </circle>
          ))}
        </svg>
        {/* Środek: aktywny wycinek albo liczba motywów */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4 text-center">
          {focus ? (
            <>
              <span className="font-mono text-sm font-bold text-gray-100 tabular-nums">{pct(focus.weight)}</span>
              <span className="font-mono text-[9px] leading-tight text-zinc-400 line-clamp-2">{focus.label}</span>
            </>
          ) : (
            <>
              <span className="font-mono text-sm font-bold text-gray-100 tabular-nums">
                {slices.filter((s) => s.key !== 'core' && s.key !== 'cash').length}
              </span>
              <span className="font-mono text-[9px] text-zinc-500">themes</span>
            </>
          )}
        </div>
      </div>

      {/* Legenda = widok tabelaryczny: nazwa · % · $ (tekst w kolorach tekstu, nie serii) */}
      <ul className="flex-1 min-w-0 space-y-0.5" aria-label="Plan breakdown by theme">
        {slices.map((s) => {
          const amt = amountOf(s);
          return (
            <li key={s.key}>
              <button
                type="button"
                data-testid="coach-donut-legend"
                onMouseEnter={() => setActive(s.key)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(s.key)}
                onBlur={() => setActive(null)}
                className={cn(
                  'w-full flex items-center gap-1.5 rounded px-1 py-px text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60',
                  active === s.key && 'bg-white/5',
                )}
              >
                <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: s.color }} aria-hidden="true" />
                <span className="font-mono text-[10px] text-zinc-300 truncate flex-1">{s.label}</span>
                <span className="font-mono text-[10px] text-zinc-400 tabular-nums">{pct(s.weight)}</span>
                {amt != null && (
                  <span className="font-mono text-[10px] text-zinc-500 tabular-nums w-16 text-right">{fmtUSD(amt)}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
