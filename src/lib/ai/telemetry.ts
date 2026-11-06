// ============================================================
// Telemetria kosztu AI — server-only.
//
// Każde wywołanie `callGemini` dopisuje zdarzenie do kolektora requestu.
// Route na końcu:
//   • loguje jedną linię `[ai-usage]` (zawsze — darmowe, widać w logach Vercel),
//   • opcjonalnie zapisuje wiersze do `ai_usage_log` (flaga coach_agent.usage_log).
// Dzięki temu da się udowodnić oszczędność: prompt tokens przed/po, ile
// tur uciął lokalny gate (0 wywołań), ile było retry.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';

export type AiPurpose = 'chat' | 'intent_gate' | 'slot_extract' | 'summary' | 'news_analysis';

// Skąd przyszła odpowiedź na turę: model, lokalny szablon (gate) czy limit.
// 'template' = odpowiedź z szablonu poza guardrails (powitanie przy kafelkach).
export type GateOutcome = 'none' | 'local' | 'light' | 'budget' | 'rate_limited' | 'template';

export interface AiUsageEvent {
  purpose: AiPurpose;
  model: string;
  promptTokens: number;
  outputTokens: number;
  cachedTokens: number;
  retried: boolean;
  ok: boolean;
  latencyMs: number;
}

export interface UsageCollector {
  events: AiUsageEvent[];
}

export const createCollector = (): UsageCollector => ({ events: [] });

export interface TurnTelemetry {
  route: string;
  userId: string;
  gate: GateOutcome;
  intent?: string;
  events: AiUsageEvent[];
}

// Jedna linia JSON na turę — łatwo zgrepować i policzyć sumy.
export function logTurn(t: TurnTelemetry): void {
  const totals = t.events.reduce(
    (acc, e) => ({
      calls: acc.calls + 1,
      prompt: acc.prompt + e.promptTokens,
      output: acc.output + e.outputTokens,
      cached: acc.cached + e.cachedTokens,
    }),
    { calls: 0, prompt: 0, output: 0, cached: 0 },
  );
  console.log(
    '[ai-usage]',
    JSON.stringify({
      route: t.route,
      gate: t.gate,
      intent: t.intent,
      geminiCalls: totals.calls,
      promptTokens: totals.prompt,
      outputTokens: totals.output,
      cachedTokens: totals.cached,
      events: t.events.map((e) => ({
        p: e.purpose,
        m: e.model,
        in: e.promptTokens,
        out: e.outputTokens,
        c: e.cachedTokens,
        r: e.retried,
        ok: e.ok,
        ms: e.latencyMs,
      })),
    }),
  );
}

// Best-effort zapis do tabeli (migracja 0006). Brak tabeli = cichy no-op.
export async function persistTurn(supabase: SupabaseClient, t: TurnTelemetry): Promise<void> {
  const rows =
    t.events.length > 0
      ? t.events.map((e) => ({
          user_id: t.userId,
          route: t.route,
          purpose: e.purpose,
          model: e.model,
          prompt_tokens: e.promptTokens,
          output_tokens: e.outputTokens,
          cached_tokens: e.cachedTokens,
          retried: e.retried,
          ok: e.ok,
          gate: t.gate,
          latency_ms: e.latencyMs,
        }))
      : // Tura ucięta przez gate — też ją liczymy (0 tokenów), żeby mieć % oszczędności.
        [
          {
            user_id: t.userId,
            route: t.route,
            purpose: 'chat' as const,
            model: 'none',
            prompt_tokens: 0,
            output_tokens: 0,
            cached_tokens: 0,
            retried: false,
            ok: true,
            gate: t.gate,
            latency_ms: 0,
          },
        ];
  const { error } = await supabase.from('ai_usage_log').insert(rows);
  if (error) console.warn('[ai-usage] persist skipped:', error.message);
}
