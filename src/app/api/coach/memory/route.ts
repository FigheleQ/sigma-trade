// ============================================================
// /api/coach/memory — co Coach pamięta o userze (fakty z rozmów).
//
//   GET              → { facts: CoachMemoryFact[] }
//   DELETE ?id=<id>  → usuwa jeden fakt
//   DELETE           → usuwa wszystkie („Forget everything")
//
// User zawsze widzi i kontroluje swoją pamięć — także jako zabezpieczenie
// przed zatruciem (fałszywy fakt można po prostu usunąć).
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { conversationsAvailable } from '@/lib/coach/conversations';
import { clearMemory, deleteFact, loadMemory } from '@/lib/coach/memory';

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(): Promise<NextResponse> {
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await conversationsAvailable(supabase))) return NextResponse.json({ facts: [] });
  return NextResponse.json({ facts: await loadMemory(supabase, user.id) });
}

export async function DELETE(req: Request): Promise<NextResponse> {
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await conversationsAvailable(supabase))) return NextResponse.json({ ok: true });

  const id = new URL(req.url).searchParams.get('id');
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const ok = id ? await deleteFact(supabase, id) : await clearMemory(supabase, user.id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Internal error' }, { status: 500 });
}
