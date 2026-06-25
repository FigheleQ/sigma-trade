'use client';

// ============================================================
// Pionowy pasek ikon przy lewej krawędzi — Lista / Pozycje / Historia.
// Wizualnie spójny z AgentSidebar po prawej (okrągłe przyciski, ring na
// aktywnym, hover-glow). Klik aktywnej ikony zwija panel (jak agenci).
// ============================================================
import { List, Wallet, History, Repeat, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MarketTab = 'watchlist' | 'positions' | 'history' | 'dca';

const ITEMS: { id: MarketTab; label: string; Icon: LucideIcon }[] = [
  { id: 'watchlist', label: 'Watchlist', Icon: List },
  { id: 'positions', label: 'Positions', Icon: Wallet },
  { id: 'history', label: 'History', Icon: History },
  { id: 'dca', label: 'DCA', Icon: Repeat },
];

interface MarketRailProps {
  active: MarketTab | null;
  onSelect: (tab: MarketTab) => void;
}

export default function MarketRail({ active, onSelect }: MarketRailProps) {
  return (
    <div className="w-20 shrink-0 border-r border-border-subtle flex flex-col items-center gap-3 py-4 px-2 overflow-y-auto">
      {ITEMS.map(({ id, label, Icon }) => {
        const isActive = active === id;
        return (
          <div key={id} className="relative group">
            <button
              onClick={() => onSelect(id)}
              title={label}
              aria-label={label}
              className={cn(
                'relative w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center cursor-pointer',
                'bg-bg-panel border border-border-subtle transition-all duration-150',
                isActive
                  ? 'ring-2 ring-accent border-accent'
                  : 'hover:scale-105 hover:shadow-[0_0_12px_rgba(0,255,136,0.25)] hover:border-accent/40',
              )}
            >
              <Icon
                size={22}
                className={cn(
                  isActive ? 'text-accent' : 'text-gray-400',
                  !isActive && 'group-hover:text-accent/70',
                )}
              />
            </button>

            {/* Tooltip na hover */}
            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-10 hidden group-hover:block">
              <div className="bg-bg-panel border border-border-subtle rounded px-2 py-1 whitespace-nowrap">
                <p className="font-mono text-xs text-gray-400">{label}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
