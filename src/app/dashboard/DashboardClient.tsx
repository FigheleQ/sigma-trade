'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import AgentSidebar, {
  type AgentId,
  type AgentMeta,
} from '@/components/agents/AgentSidebar';
import MarketView from '@/components/market/MarketView';

// NewsFeed jest ukryty dopóki użytkownik nie otworzy panelu agenta —
// lazy-load zdejmuje jego bundle (radix tooltip + pipeline newsów) z
// initial load, skracając JS execution i main-thread przy starcie.
const NewsFeed = dynamic(() => import('@/components/agents/NewsFeed'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <span className="font-mono text-xs text-zinc-500">Loading…</span>
    </div>
  ),
});

// CoachPanel lazy-load — czat + onboarding ładujemy dopiero po otwarciu panelu.
const CoachPanel = dynamic(() => import('@/components/agents/CoachPanel'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <span className="font-mono text-xs text-zinc-500">Loading…</span>
    </div>
  ),
});
import ProfileButton from '@/components/ui/ProfileButton';
import PortfolioSummary from '@/components/market/PortfolioSummary';
import { X } from 'lucide-react';
import MobileTickerDrawer from '@/components/market/MobileTickerDrawer';
import CoachIntroPopup from '@/components/agents/CoachIntroPopup';
import { cn } from '@/lib/utils';

const SIDEBAR_WIDTH = 80; // szerokość kolumny ikon agentów
const MIN_RIGHT_PCT = 15;
const MAX_RIGHT_PCT = 70;

// Klucz „widziałem powitanie Coacha" — bump sufiksu = popup pokaże się znów.
const coachIntroKey = (email: string) => `coach_intro_seen_v1_${email}`;

// Etykiety paneli (mobilny nagłówek overlay).
const AGENT_LABELS: Record<AgentId, string> = {
  news: 'News Agent',
  technical: 'Technical Agent',
  sentiment: 'Sentiment Agent',
  orchestrator: 'Orchestrator',
  coach: 'Coach',
};

// Treść panelu zależna od aktywnego agenta. News i Coach mają realne UI;
// reszta (Phase 2) jest wyłączona w sidebarze, więc tu nie trafia.
function AgentPanelContent({
  activeAgent,
  intervalSeconds,
  autoFetch,
}: {
  activeAgent: AgentId;
  intervalSeconds: number;
  autoFetch: boolean;
}) {
  if (activeAgent === 'coach') return <CoachPanel />;
  return <NewsFeed intervalSeconds={intervalSeconds} autoFetch={autoFetch} />;
}

interface Props {
  agents: AgentMeta[];
  intervalSeconds: number;
  autoFetch: boolean;
  userEmail: string;
}

export default function DashboardClient({ agents, intervalSeconds, autoFetch, userEmail }: Props) {
  const [activeAgent, setActiveAgent] = useState<AgentId | null>(null);
  const [rightPct, setRightPct] = useState(40);
  const [isResizing, setIsResizing] = useState(false);
  const [showCoachIntro, setShowCoachIntro] = useState(false);
  const desktopRef = useRef<HTMLDivElement>(null);

  const coachEnabled = agents.some((a) => a.id === 'coach' && a.enabled);

  // Toggle: kliknięcie aktywnego agenta zamyka panel
  const handleAgentChange = useCallback((id: AgentId) => {
    setActiveAgent((prev) => (prev === id ? null : id));
  }, []);

  // Jednorazowe powitanie nowej funkcji (desktop) — pokazujemy raz na przeglądarkę,
  // dopiero gdy Coach jest włączony. Mobile pomijamy (onboarding rusza w panelu).
  const introKey = coachIntroKey(userEmail);

  useEffect(() => {
    if (!coachEnabled) return;
    // W Cypress blokujemy popup domyślnie — zasłania DCA/portfolio testy.
    // Test sprawdzający popup sam ustawia flagę 'cypress_show_coach_intro'.
    if ('Cypress' in window && !localStorage.getItem('cypress_show_coach_intro')) return;
    if (localStorage.getItem(introKey) === '1') return;
    setShowCoachIntro(true);
  }, [coachEnabled, introKey]);

  const dismissCoachIntro = useCallback(() => {
    localStorage.setItem(introKey, '1');
    setShowCoachIntro(false);
  }, [introKey]);

  const openCoachFromIntro = useCallback(() => {
    localStorage.setItem(introKey, '1');
    setShowCoachIntro(false);
    setActiveAgent('coach');
  }, [introKey]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      if (!desktopRef.current) return;
      const { left, width } = desktopRef.current.getBoundingClientRect();
      // Uchwyt = lewa krawędź panelu newsów. Prawa krawędź panelu kończy się
      // przy stałej kolumnie ikon (SIDEBAR_WIDTH), więc szerokość newsów liczymy
      // od kursora do początku ikon.
      const newsWidthPx = left + width - SIDEBAR_WIDTH - e.clientX;
      const pct = (newsWidthPx / width) * 100;
      setRightPct(Math.min(MAX_RIGHT_PCT, Math.max(MIN_RIGHT_PCT, pct)));
    };
    const onUp = () => setIsResizing(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isResizing]);

  const panelOpen = activeAgent !== null;

  return (
    <div className="flex flex-col h-screen bg-bg-base overflow-hidden">
      {/* TopBar */}
      <header className="h-12 flex items-center justify-between px-4 border-b border-subtle shrink-0">
        <div className="flex items-center gap-3">
          <div className="md:hidden">
            <MobileTickerDrawer />
          </div>
          <span className="font-mono text-sm font-semibold text-gray-100 tracking-wide">
            Sigma Trade
          </span>
          <span className="font-mono text-xs text-gray-400">v0.2.0</span>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="hidden md:block font-mono text-xs text-gray-400 uppercase tracking-wider">
              Paper Trading
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <PortfolioSummary />
          <ProfileButton email={userEmail} />
        </div>
      </header>

      {/* Główny obszar aplikacji — landmark <main> dla czytników ekranu
          i nawigacji klawiaturą (skip-to-content). Obejmuje oba warianty
          layoutu; w danym breakpoincie widoczny jest tylko jeden. */}
      <main className="flex flex-1 flex-col overflow-hidden min-h-0">
      {/* ── DESKTOP layout (md+) ─────────────────────────────────── */}
      <div
        ref={desktopRef}
        className={cn(
          'hidden md:flex flex-1 overflow-hidden',
          isResizing && 'select-none cursor-col-resize',
        )}
      >
        {/* Lewy panel — Market View — rośnie do fill */}
        <div className="flex-1 border-r border-border-subtle overflow-hidden min-w-0">
          <MarketView />
        </div>

        {/* Resize handle — widoczny tylko gdy panel otwarty */}
        {panelOpen && (
          <div
            onMouseDown={startResize}
            className="w-1 shrink-0 cursor-col-resize bg-border-subtle hover:bg-accent/40 active:bg-accent/60 transition-colors"
          />
        )}

        {/* Panel treści agenta — animuje szerokość (0 ↔ rightPct%).
            Oddzielony od kolumny ikon, żeby ta nie znikała przy zamykaniu
            i nie gubiła hovera/podświetlenia. */}
        <div
          className={cn(
            'shrink-0 overflow-hidden',
            !isResizing && 'transition-[width] duration-200 ease-in-out',
          )}
          style={{ width: panelOpen ? `${rightPct}%` : '0px' }}
        >
          {activeAgent && (
            <div className="h-full w-full overflow-hidden">
              <AgentPanelContent
                activeAgent={activeAgent}
                intervalSeconds={intervalSeconds}
                autoFetch={autoFetch}
              />
            </div>
          )}
        </div>

        {/* Kolumna ikon — NA STAŁE przypięta do prawej krawędzi.
            Nigdy nie animuje ani nie znika → hover działa zawsze. */}
        <div className="w-20 shrink-0 border-l border-border-subtle overflow-y-auto">
          <AgentSidebar
            agents={agents}
            activeAgent={activeAgent}
            onAgentChange={handleAgentChange}
          />
        </div>
      </div>

      {/* ── MOBILE layout (<md) ──────────────────────────────────── */}
      <div className="md:hidden flex flex-col flex-1 overflow-hidden">
        {/* Market View zajmuje całą przestrzeń */}
        <div className="flex-1 overflow-hidden min-h-0">
          <MarketView />
        </div>

        {/* Dolny pasek z ikonami agentów */}
        <div className="border-t border-border-subtle shrink-0">
          <AgentSidebar
            agents={agents}
            activeAgent={activeAgent}
            onAgentChange={handleAgentChange}
          />
        </div>

        {/* Pełnoekranowy overlay agenta */}
        <div
          className={`fixed inset-0 z-50 bg-bg-base flex flex-col transition-transform duration-300 ease-in-out ${
            panelOpen ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          <div className="flex items-center justify-between px-4 h-12 border-b border-border-subtle shrink-0">
            <span className="font-mono text-xs text-zinc-400 uppercase tracking-wider">
              {activeAgent ? AGENT_LABELS[activeAgent] : ''}
            </span>
            <button
              onClick={() => setActiveAgent(null)}
              aria-label="Close agent panel"
              className="text-zinc-500 hover:text-accent"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {activeAgent && (
              <AgentPanelContent
                activeAgent={activeAgent}
                intervalSeconds={intervalSeconds}
                autoFetch={autoFetch}
              />
            )}
          </div>
        </div>
      </div>
      </main>

      {/* Jednorazowe powitanie Coacha (tylko desktop) */}
      {showCoachIntro && (
        <CoachIntroPopup onClose={dismissCoachIntro} onOpenCoach={openCoachFromIntro} />
      )}
    </div>
  );
}
