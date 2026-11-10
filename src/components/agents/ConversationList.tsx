'use client';

// ============================================================
// Lista konwersacji Coacha: przypięty Setup + luźne chaty + wejście do
// pamięci. Każdy chat ma własny kontekst; profil i pamięć faktów są wspólne.
// ============================================================
import { Brain, MessageSquare, Pin, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCoachStore } from '@/lib/store/coachStore';

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < 60_000) return 'now';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function ConversationList() {
  const conversations = useCoachStore((s) => s.conversations);
  const active = useCoachStore((s) => s.activeConversation);
  const memoryCount = useCoachStore((s) => s.memory.length);
  const openConversation = useCoachStore((s) => s.openConversation);
  const newChat = useCoachStore((s) => s.newChat);
  const deleteChat = useCoachStore((s) => s.deleteChat);
  const setView = useCoachStore((s) => s.setView);

  const chats = conversations.filter((c) => c.kind === 'chat');
  const setupActive = !active || active.kind === 'setup';

  return (
    <nav data-testid="coach-conversation-list" aria-label="Coach conversations" className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
      <button
        type="button"
        data-testid="coach-new-chat-list"
        onClick={() => void newChat()}
        className="w-full flex items-center justify-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-accent hover:bg-accent/20 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        <Plus size={12} aria-hidden="true" /> New chat
      </button>

      {/* Przypięty Setup — zawsze pierwszy, nie da się go usunąć */}
      <button
        type="button"
        data-testid="coach-conv-setup"
        onClick={() => void openConversation(null)}
        aria-current={setupActive ? 'page' : undefined}
        className={cn(
          'w-full flex items-center gap-2 rounded border px-3 py-2 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60',
          setupActive ? 'border-accent/50 bg-accent/10' : 'border-border-subtle bg-bg-panel hover:border-accent/30',
        )}
      >
        <Pin size={12} className="text-accent shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-0">
          <span className="block font-mono text-[11px] font-bold text-zinc-100">Setup &amp; plan</span>
          <span className="block font-mono text-[10px] text-zinc-500">Your profile, onboarding and starter plan</span>
        </span>
      </button>

      <div>
        <div className="px-1 pb-1 font-mono text-[9px] uppercase tracking-wider text-zinc-600">Chats</div>
        {chats.length === 0 ? (
          <p className="px-1 font-mono text-[10px] text-zinc-500">
            No chats yet — start one for any investing question. Each chat has its own context.
          </p>
        ) : (
          <ul className="space-y-1">
            {chats.map((c) => (
              <li key={c.id} data-testid="coach-conv-chat" data-id={c.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void openConversation(c.id)}
                  aria-current={active?.id === c.id ? 'page' : undefined}
                  className={cn(
                    'flex-1 min-w-0 flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60',
                    active?.id === c.id ? 'bg-accent/10 text-accent' : 'text-zinc-300 hover:bg-white/5',
                  )}
                >
                  <MessageSquare size={11} className="shrink-0 text-zinc-500" aria-hidden="true" />
                  <span className="flex-1 truncate font-mono text-[11px]">{c.title}</span>
                  <span className="font-mono text-[9px] text-zinc-600 tabular-nums">{relativeTime(c.updatedAt)}</span>
                </button>
                <button
                  type="button"
                  data-testid="coach-conv-delete"
                  onClick={() => void deleteChat(c.id)}
                  aria-label={`Delete chat: ${c.title}`}
                  className="p-1 rounded text-zinc-600 hover:text-red-400 focus-visible:text-red-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400/60 transition-colors"
                >
                  <Trash2 size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        data-testid="coach-open-memory"
        onClick={() => setView('memory')}
        className="w-full flex items-center gap-2 rounded border border-border-subtle bg-bg-panel px-3 py-2 text-left hover:border-accent/30 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        <Brain size={12} className="text-zinc-400 shrink-0" aria-hidden="true" />
        <span className="flex-1 font-mono text-[11px] text-zinc-300">What Coach remembers</span>
        {memoryCount > 0 && <span className="font-mono text-[10px] text-zinc-500 tabular-nums">{memoryCount}</span>}
      </button>
    </nav>
  );
}
