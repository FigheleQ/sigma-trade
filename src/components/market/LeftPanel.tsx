'use client';

// ============================================================
// Lewy panel: pionowy pasek ikon (MarketRail) + treść aktywnej zakładki.
// Lustrzane odbicie panelu agentów po prawej. Klik aktywnej ikony zwija
// panel treści (wykres dostaje więcej miejsca), tak jak u agentów.
// ============================================================
import { useState } from 'react';
import MarketRail, { type MarketTab } from './MarketRail';
import TickerSidebar from './TickerSidebar';
import PositionsPanel from './PositionsPanel';
import HistoryPanel from './HistoryPanel';

export default function LeftPanel() {
  const [tab, setTab] = useState<MarketTab | null>('watchlist');

  // Klik tej samej ikony → zwiń (toggle), jak w panelu agentów.
  const handleSelect = (t: MarketTab) =>
    setTab((prev) => (prev === t ? null : t));

  return (
    <div className="flex h-full">
      <MarketRail active={tab} onSelect={handleSelect} />

      {tab && (
        <div className="w-[185px] shrink-0 border-r border-border-subtle flex flex-col h-full overflow-hidden">
          {tab === 'watchlist' && <TickerSidebar embedded />}
          {tab === 'positions' && <PositionsPanel />}
          {tab === 'history' && <HistoryPanel />}
        </div>
      )}
    </div>
  );
}
