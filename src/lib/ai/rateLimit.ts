// ============================================================
// Limit żądań per user — server-only, PRZED wywołaniem Gemini.
//
// Darmowy tier Gemini ma limity per PROJEKT (wspólne dla wszystkich userów).
// Jeden user klepiący Enter nie może spalić RPM/RPD całej apki, więc:
//   • RPM — okno przesuwne w pamięci procesu (tanie, wystarczające na burst),
//   • RPD — liczone w DB (`coach_messages` role=user z ostatnich 24h), bo
//     pamięć procesu na serverless nie przeżywa cold startu.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const recent = new Map<string, number[]>();

export interface RateCheck {
  ok: boolean;
  scope?: 'minute' | 'day';
  retryAfterSec?: number;
}

// Rejestruje żądanie i sprawdza limit minutowy (pamięć procesu).
export function checkMinuteLimit(userId: string, rpm: number, now = Date.now()): RateCheck {
  const list = (recent.get(userId) ?? []).filter((t) => now - t < MINUTE_MS);
  if (list.length >= rpm) {
    recent.set(userId, list);
    const retryAfterSec = Math.max(1, Math.ceil((MINUTE_MS - (now - list[0])) / 1000));
    return { ok: false, scope: 'minute', retryAfterSec };
  }
  list.push(now);
  recent.set(userId, list);
  // Sprzątanie — mapa nie rośnie w nieskończoność.
  if (recent.size > 5000) {
    for (const [k, v] of recent) if (v.every((t) => now - t >= MINUTE_MS)) recent.delete(k);
  }
  return { ok: true };
}

// Limit dzienny z DB. Błąd zapytania = przepuszczamy (fail-open) — limit
// dzienny to bezpiecznik, nie funkcja krytyczna.
export async function checkDayLimit(
  supabase: SupabaseClient,
  userId: string,
  rpd: number,
): Promise<RateCheck> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const { count, error } = await supabase
    .from('coach_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'user')
    .gte('created_at', since);
  if (error || count == null) return { ok: true };
  return count >= rpd ? { ok: false, scope: 'day', retryAfterSec: 3600 } : { ok: true };
}

export function rateLimitMessage(check: RateCheck): string {
  return check.scope === 'day'
    ? "You've reached today's Coach message limit — it resets within 24 hours."
    : `You're sending messages a bit fast — try again in ${check.retryAfterSec ?? 60}s.`;
}
