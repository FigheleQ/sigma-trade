// ============================================================
// /api/coach/conversations — lista i tworzenie konwersacji Coacha.
//
//   GET  → { conversations: CoachConversation[] } (Setup zawsze pierwszy)
//   POST → nowy luźny chat (czysty kontekst) → { conversation }
//
// Przy otwarciu nowego chatu poprzedni (ostatnio używany) przechodzi
// ekstrakcję pamięci faktów w tle — fakty „przechodzą" do nowej rozmowy,
// historia nie.
// ============================================================
import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  conversationsAvailable,
  createChat,
  getConversation,
  listConversations,
  toClient,
} from '@/lib/coach/conversations';
import { maybeExtractMemory, EXTRACT_ON_CLOSE_MIN } from '@/lib/coach/memory';
import { createCollector, logTurn } from '@/lib/ai/telemetry';

const unavailable = () =>
  NextResponse.json({ error: 'Conversations are not enabled (migration 0008)' }, { status: 404 });

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await conversationsAvailable(supabase))) return unavailable();

  return NextResponse.json({ conversations: await listConversations(supabase, user.id) });
}

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await conversationsAvailable(supabase))) return unavailable();

  // Opcjonalnie: chat, z którego user właśnie wychodzi → ekstrakcja pamięci.
  let previousId: string | null = null;
  try {
    const body = (await req.json()) as { previousConversationId?: unknown };
    if (typeof body.previousConversationId === 'string') previousId = body.previousConversationId;
  } catch {
    // puste body — bez ekstrakcji
  }

  const created = await createChat(supabase, user.id);
  if (!created) return NextResponse.json({ error: 'Could not create chat' }, { status: 500 });

  if (previousId) {
    const prev = await getConversation(supabase, previousId);
    if (prev) {
      after(async () => {
        const collector = createCollector();
        const saved = await maybeExtractMemory(supabase, user.id, prev, EXTRACT_ON_CLOSE_MIN, collector);
        if (collector.events.length) {
          logTurn({ route: 'coach-memory', userId: user.id, gate: 'none', intent: `facts:${saved}`, events: collector.events });
        }
      });
    }
  }

  return NextResponse.json({ conversation: toClient(created) }, { status: 201 });
}
