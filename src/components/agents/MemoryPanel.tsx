'use client';

// ============================================================
// „What Coach remembers" — fakty o userze wyciągnięte z rozmów.
// User widzi wszystko i może usunąć pojedynczy fakt albo całą pamięć.
// ============================================================
import { ArrowLeft, X } from 'lucide-react';
import { useCoachStore } from '@/lib/store/coachStore';
import type { CoachMemoryCategory } from '@/lib/coach/types';

const CATEGORY_LABEL: Record<CoachMemoryCategory, string> = {
  goal: 'goal',
  preference: 'preference',
  constraint: 'avoid',
  experience: 'experience',
  other: 'note',
};

export default function MemoryPanel() {
  const memory = useCoachStore((s) => s.memory);
  const forgetFact = useCoachStore((s) => s.forgetFact);
  const forgetAll = useCoachStore((s) => s.forgetAll);
  const setView = useCoachStore((s) => s.setView);

  const confirmForgetAll = () => {
    if (window.confirm('Forget everything Coach has learned about you? Your chats and profile stay.')) {
      void forgetAll();
    }
  };

  return (
    <section data-testid="coach-memory-panel" aria-label="What Coach remembers" className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setView('chats')}
          aria-label="Back to conversations"
          className="text-zinc-500 hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 rounded"
        >
          <ArrowLeft size={13} />
        </button>
        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">What Coach remembers</span>
      </div>

      <p className="font-mono text-[10px] leading-snug text-zinc-500">
        Coach saves short facts from your chats (goals, preferences, things to avoid) to personalize advice in every
        conversation. Remove anything that is wrong.
      </p>

      {memory.length === 0 ? (
        <p data-testid="coach-memory-empty" className="font-mono text-[11px] text-zinc-400">
          Nothing saved yet — chat a bit and Coach will remember what matters.
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {memory.map((f) => (
              <li
                key={f.id}
                data-testid="coach-memory-fact"
                className="flex items-start gap-2 rounded border border-border-subtle bg-bg-panel px-2.5 py-2"
              >
                <span className="shrink-0 mt-px px-1.5 py-px rounded border border-zinc-700 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
                  {CATEGORY_LABEL[f.category]}
                </span>
                <span className="flex-1 font-mono text-[11px] leading-snug text-zinc-200">{f.fact}</span>
                <button
                  type="button"
                  data-testid="coach-memory-forget"
                  onClick={() => void forgetFact(f.id)}
                  aria-label={`Forget: ${f.fact}`}
                  className="p-0.5 rounded text-zinc-600 hover:text-red-400 focus-visible:text-red-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400/60 transition-colors"
                >
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            data-testid="coach-memory-forget-all"
            onClick={confirmForgetAll}
            className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400/60 rounded px-1"
          >
            Forget everything
          </button>
        </>
      )}
    </section>
  );
}
