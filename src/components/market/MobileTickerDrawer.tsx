'use client';

// ============================================================
// Mobilny drawer — lustro desktopowego LeftPanel: pionowy pasek ikon
// (MarketRail: Lista / Pozycje / Historia) + treść aktywnej zakładki po
// prawej. Klik ikony przełącza zakładkę; wybór instrumentu zamyka drawer.
// Wyszukiwarka jest tylko w zakładce „Lista" (header TickerSidebar).
// ============================================================
import { useState, useRef, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWatchlistStore } from '@/store/watchlistStore';
import MarketRail, { type MarketTab } from './MarketRail';
import TickerSidebar from './TickerSidebar';
import PositionsPanel from './PositionsPanel';
import HistoryPanel from './HistoryPanel';

export default function MobileTickerDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<MarketTab>('watchlist');

  // Wybór instrumentu (watchlista / pozycje / historia) zmienia activeTicker —
  // wtedy zamykamy drawer, żeby pokazać wykres.
  const activeTicker = useWatchlistStore((s) => s.activeTicker);
  const prevTicker = useRef(activeTicker);
  useEffect(() => {
    if (isOpen && activeTicker !== prevTicker.current) setIsOpen(false);
    prevTicker.current = activeTicker;
  }, [activeTicker, isOpen]);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Otwórz menu instrumentów"
        className="p-1 text-zinc-400 hover:text-accent"
      >
        <Menu size={20} />
      </button>

      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-black/60 z-40 md:hidden transition-opacity duration-300',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => setIsOpen(false)}
      />

      {/* Drawer panel */}
      <div
        className={cn(
          'fixed top-0 left-0 h-full w-[300px] bg-bg-base border-r border-border-subtle z-50 md:hidden',
          'transition-transform duration-300 ease-in-out flex',
          isOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pasek ikon — close X na górze, niżej MarketRail (jak na desktopie) */}
        <div className="shrink-0 flex flex-col border-r border-border-subtle">
          <div className="flex items-center justify-center h-12 border-b border-border-subtle shrink-0">
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Zamknij menu"
              className="p-1.5 text-zinc-500 hover:text-accent transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          <MarketRail active={tab} onSelect={setTab} />
        </div>

        {/* Treść aktywnej zakładki */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {tab === 'watchlist' && <TickerSidebar embedded />}
          {tab === 'positions' && <PositionsPanel />}
          {tab === 'history' && <HistoryPanel />}
        </div>
      </div>
    </>
  );
}
