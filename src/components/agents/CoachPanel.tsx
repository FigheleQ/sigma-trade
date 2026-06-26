'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, AlertTriangle, Sparkles, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useCoachStore,
  selectCoachMessages,
  selectCoachStatus,
  selectCoachRecommendations,
} from '@/lib/store/coachStore';
import type { CoachStatus } from '@/lib/store/coachStore';
import type { CoachMessage } from '@/lib/coach/types';

// ----------------------------------------------------------------
// Recommendations — pokazywane po onboardingu
// ----------------------------------------------------------------

function RecommendationsBlock() {
  const recommendations = useCoachStore(selectCoachRecommendations);
  const [dismissed, setDismissed] = useState(false);
  if (recommendations.length === 0 || dismissed) return null;

  return (
    <div
      data-testid="coach-recommendations"
      className="mx-3 mb-3 rounded border border-accent/30 bg-accent/5 p-3"
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles size={12} className="text-accent" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
          Recommended for you
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="ml-auto text-zinc-600 hover:text-zinc-400 transition-colors"
          aria-label="Dismiss recommendations"
        >
          <X size={12} />
        </button>
      </div>
      <ul className="space-y-2">
        {recommendations.map((r, i) => (
          <li key={`${r.ticker}-${i}`} className="flex items-start gap-2">
            <span className="font-mono text-xs font-bold text-accent shrink-0 w-12">
              {r.ticker}
            </span>
            <span className="font-mono text-[11px] text-zinc-400 leading-snug flex-1">
              {r.reason}
            </span>
            <span className="font-mono text-[10px] text-zinc-500 shrink-0">
              {Math.round(r.suggestedWeight * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------
// Message bubble
// ----------------------------------------------------------------

function MessageBubble({
  role,
  content,
  showCursor,
}: {
  role: 'user' | 'model';
  content: string;
  showCursor?: boolean;
}) {
  const isUser = role === 'user';
  return (
    <div className={cn('flex items-end gap-2', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <img
          src="/coach-icon.svg"
          alt=""
          width={24}
          height={24}
          className="rounded shrink-0 opacity-90"
        />
      )}
      <div
        className={cn(
          'max-w-[78%] rounded px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap',
          isUser
            ? 'bg-accent/15 text-zinc-100 border border-accent/30'
            : 'bg-bg-panel text-zinc-300 border border-border-subtle',
        )}
      >
        {content}
        {showCursor && (
          <span className="inline-block w-[2px] h-[12px] bg-accent ml-[2px] align-middle animate-pulse" />
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Typewriter hook — animuje TYLKO nowe wiadomości bota
// ----------------------------------------------------------------

const CHARS_PER_TICK = 3;
const TICK_MS = 16;

function useTypewriter(messages: CoachMessage[], status: CoachStatus) {
  // IDs wiadomości obecnych przy montowaniu — nigdy ich nie animujemy.
  // Inicjalizacja synchroniczna (poza useEffect) → działa już w 1. renderze.
  const mountedIds = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    messages.forEach((m) => mountedIds.current.add(m.id));
  }

  // Synchronicznie podczas renderowania — gdy init() zakończy (loading → idle),
  // seedujemy mountedIds historią z serwera ZANIM getContent() zostanie wywołane.
  // Podejście synchroniczne (nie useEffect) jest kluczowe: efekty odpałają się
  // po renderze, a getContent jest wywoływane w trakcie renderowania bąbli.
  const prevStatusRef = useRef<CoachStatus>(status);
  if (prevStatusRef.current === 'loading' && status === 'idle') {
    messages.forEach((m) => mountedIds.current.add(m.id));
  }
  prevStatusRef.current = status;

  const [typingId, setTypingId] = useState<string | null>(null);
  const [displayed, setDisplayed] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'model') return;
    if (mountedIds.current.has(last.id)) return; // stara wiadomość — pomiń
    if (last.id === typingId) return;             // już animujemy

    if (timerRef.current) clearInterval(timerRef.current);
    setTypingId(last.id);
    setDisplayed('');

    let pos = 0;
    const full = last.content;
    timerRef.current = setInterval(() => {
      pos = Math.min(pos + CHARS_PER_TICK, full.length);
      setDisplayed(full.slice(0, pos));
      if (pos >= full.length && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, TICK_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Zwraca treść do wyrenderowania dla danej wiadomości.
  // Dla "nowej, jeszcze nie przejętej przez effect" — pusty string zamiast
  // pełnej treści, żeby nie było flash przed startem animacji.
  function getContent(m: CoachMessage): string {
    if (m.id === typingId) return displayed;
    if (m.role === 'model' && !mountedIds.current.has(m.id) && typingId === null) return '';
    return m.content;
  }

  const isTyping = typingId !== null &&
    displayed.length < (messages.find((m) => m.id === typingId)?.content.length ?? 0);

  return { typingId, getContent, isTyping };
}

// ----------------------------------------------------------------
// Main panel
// ----------------------------------------------------------------

export default function CoachPanel() {
  const messages = useCoachStore(selectCoachMessages);
  const status = useCoachStore(selectCoachStatus);
  const errorMessage = useCoachStore((s) => s.errorMessage);
  const init = useCoachStore((s) => s.init);
  const sendMessage = useCoachStore((s) => s.sendMessage);
  const resetConversation = useCoachStore((s) => s.resetConversation);

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { typingId, getContent, isTyping } = useTypewriter(messages, status);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, status, isTyping]);

  const isBusy = status === 'sending' || status === 'loading';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isBusy) return;
    void sendMessage(input);
    setInput('');
  }

  function handleReset() {
    if (isBusy) return;
    if (window.confirm('Reset the conversation and start over? This clears your chat memory.')) {
      void resetConversation();
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle shrink-0">
        <img
          src="/coach-icon.svg"
          alt="Coach"
          width={32}
          height={32}
          className={cn('rounded shrink-0', (isBusy || isTyping) && 'coach-icon-glow')}
        />
        <span className="font-mono text-xs text-zinc-400 uppercase tracking-wider">Coach</span>
        {status === 'sending' && (
          <span className="font-mono text-[10px] text-accent animate-pulse">thinking…</span>
        )}
        <button
          onClick={handleReset}
          disabled={isBusy}
          title="Reset chat & memory"
          aria-label="Reset chat and memory"
          className={cn(
            'ml-auto flex items-center gap-1.5 px-2 py-1 rounded border border-zinc-700 text-zinc-400',
            'hover:border-accent/50 hover:text-accent transition-colors font-mono text-[10px] uppercase tracking-wider',
            isBusy && 'opacity-40 cursor-not-allowed',
          )}
        >
          <RotateCcw size={11} />
          Reset
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && status === 'loading' && (
          <div className="flex items-center justify-center h-full gap-2">
            <Loader2 size={14} className="text-accent animate-spin" />
            <span className="font-mono text-xs text-zinc-500">Loading…</span>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            role={m.role}
            content={getContent(m)}
            showCursor={m.id === typingId && isTyping}
          />
        ))}

        {status === 'sending' && (
          <div className="flex items-end gap-2 justify-start">
            <img src="/coach-icon.svg" alt="" width={24} height={24} className="rounded shrink-0 opacity-90" />
            <div className="rounded px-3 py-2 bg-bg-panel border border-border-subtle">
              <Loader2 size={12} className="text-accent animate-spin" />
            </div>
          </div>
        )}

        {status === 'error' && errorMessage && (
          <div className="flex items-center gap-1.5 px-1">
            <AlertTriangle size={11} className="text-red-400 shrink-0" />
            <span className="font-mono text-[11px] text-red-400">{errorMessage}</span>
          </div>
        )}
      </div>

      {/* Recommendations (po onboardingu) */}
      <RecommendationsBlock />

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-3 py-2 border-t border-border-subtle shrink-0"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your coach…"
          aria-label="Message your coach"
          className={cn(
            'flex-1 bg-bg-base border border-border-subtle rounded px-3 py-2',
            'font-mono text-xs text-zinc-200 placeholder:text-zinc-600',
            'focus:outline-none focus:border-accent/50',
          )}
        />
        <button
          type="submit"
          disabled={isBusy || !input.trim()}
          aria-label="Send message"
          className={cn(
            'w-9 h-9 rounded flex items-center justify-center shrink-0 transition-colors',
            'bg-accent/15 border border-accent/30 text-accent',
            'hover:bg-accent/25',
            (isBusy || !input.trim()) && 'opacity-40 cursor-not-allowed',
          )}
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
