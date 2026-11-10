// ============================================================
// DELETE /api/coach/conversations/[id] — usuwa luźny chat (z wiadomościami,
// kaskadą). Setupu nie da się usunąć — można go zresetować (DELETE /api/coach).
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { conversationsAvailable, deleteChat } from '@/lib/coach/conversations';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await conversationsAvailable(supabase))) {
    return NextResponse.json({ error: 'Conversations are not enabled' }, { status: 404 });
  }

  const { id } = await params;
  const ok = await deleteChat(supabase, id);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Chat not found (the pinned Setup cannot be deleted)' }, { status: 404 });
}
