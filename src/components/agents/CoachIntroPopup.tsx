'use client';

import { GraduationCap, X } from 'lucide-react';

interface CoachIntroPopupProps {
  onClose: () => void; // „Później" / X — zamyka i oznacza jako widziane
  onOpenCoach: () => void; // CTA — otwiera panel Coacha
}

// Jednorazowe powitanie nowej funkcji. Renderowane TYLKO na desktopie
// (`hidden md:flex`) — na telefonie onboarding i tak startuje w panelu czatu.
export default function CoachIntroPopup({ onClose, onOpenCoach }: CoachIntroPopupProps) {
  return (
    <div className="hidden md:flex fixed inset-0 z-[60] items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-[440px] max-w-[90vw] rounded-lg border border-accent/30 bg-bg-panel p-6 shadow-[0_0_40px_rgba(0,255,136,0.15)]">
        <button
          onClick={onClose}
          aria-label="Dismiss"
          className="absolute top-3 right-3 text-zinc-500 hover:text-accent transition-colors"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-2 mb-3">
          <div className="w-10 h-10 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center">
            <GraduationCap size={20} className="text-accent" />
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
            New
          </span>
        </div>

        <h2 className="font-mono text-sm font-bold text-zinc-100 mb-2">
          Meet Coach — your new investing assistant
        </h2>
        <p className="font-mono text-xs text-zinc-400 leading-relaxed mb-5">
          Coach is an AI chatbot that helps you get started: it learns your skill level,
          interests and budget, suggests where to begin, and answers your trading questions
          anytime. You&apos;ll find it at the top of the agents bar.
        </p>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="font-mono text-xs text-zinc-400 hover:text-zinc-200 px-3 py-2 transition-colors"
          >
            Later
          </button>
          <button
            onClick={onOpenCoach}
            className="font-mono text-xs text-accent bg-accent/15 border border-accent/30 rounded px-4 py-2 hover:bg-accent/25 transition-colors"
          >
            Meet your coach
          </button>
        </div>
      </div>
    </div>
  );
}
