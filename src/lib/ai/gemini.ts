// ============================================================
// Wspólny klient Gemini — server-only. JEDYNA integracja z Gemini w apce
// (coach, intent gate, sloty, streszczenia, news analyzer).
//
// Kluczowe decyzje:
//   • Structured output NATYWNIE: `responseMimeType: application/json` +
//     `responseSchema` (OpenAPI subset). Model nie może dorzucić code-fence'ów
//     ani prozy → zero retry przez zły JSON. `extractJson` zostaje fallbackiem.
//   • `thinkingConfig.thinkingBudget: 0` DOMYŚLNIE — 2.5 Flash to model
//     „thinking"; bez tego tokeny myślenia zjadają budżet wyjścia
//     (finishReason MAX_TOKENS → pusta odpowiedź). Nasze zadania nie
//     wymagają rozumowania, a wyłączenie myślenia też tnie koszt.
//   • Pula kluczy round-robin: 429/5xx/błąd sieci → druga (ostatnia) próba
//     na kolejnym kluczu po krótkim backoffie, potem RateLimitError/GeminiError.
//     Max 2 próby: na free tier każda kolejna próba to spalony RPM.
//     401/402/403 (zły klucz / wyczerpany billing) → od razu kolejny klucz z
//     puli, bez limitu prób — taka odmowa nie zużywa żadnego limitu.
//   • Klucz w nagłówku `x-goog-api-key`, nie w URL (nie ląduje w logach).
//   • Zwraca `usage` (prompt/candidates/cached) → telemetria kosztu.
// ============================================================
import { nextGeminiKey, geminiKeys } from '@/lib/apiKeys';
import { RateLimitError, GeminiError } from './errors';
import { safeParseJson } from './extractJson';
import type { AiPurpose, UsageCollector } from './telemetry';

// ---- Typy żądania -------------------------------------------

export type GeminiRole = 'user' | 'model';

export interface GeminiContent {
  role: GeminiRole;
  parts: Array<{ text: string }>;
}

// Podzbiór OpenAPI 3.0 akceptowany przez `responseSchema`.
export interface GeminiSchema {
  type: 'OBJECT' | 'ARRAY' | 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN';
  description?: string;
  enum?: string[];
  nullable?: boolean;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  propertyOrdering?: string[];
  items?: GeminiSchema;
  maxItems?: number;
}

export interface CallGeminiOptions {
  model: string;
  purpose: AiPurpose;
  systemInstruction?: string;
  contents: GeminiContent[] | string; // string = jedna tura `user`
  responseSchema?: GeminiSchema;
  maxOutputTokens: number;
  temperature: number;
  thinkingBudget?: number; // domyślnie 0 (patrz nagłówek)
  collector?: UsageCollector;
}

export interface GeminiUsage {
  promptTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface GeminiResult {
  text: string;
  json: unknown; // sparsowany JSON (gdy responseSchema) albo null
  usage: GeminiUsage;
  retried: boolean;
  finishReason: string | null;
  model: string;
}

// ---- Typy odpowiedzi API ------------------------------------

interface GeminiApiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_ATTEMPTS = 2;
const BACKOFF_MS = 400;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

// Błąd PRZYPISANY DO KLUCZA (nieważny klucz, wyczerpany billing/prepaid,
// brak uprawnień) — taki klucz nic nie zużył, więc próbujemy kolejnego z puli
// (inny projekt Google). Nie liczy się do limitu prób 429/5xx.
function isKeyError(status: number): boolean {
  return status === 401 || status === 402 || status === 403;
}

// ---- Główna funkcja -----------------------------------------

export async function callGemini(opts: CallGeminiOptions): Promise<GeminiResult> {
  const contents: GeminiContent[] =
    typeof opts.contents === 'string'
      ? [{ role: 'user', parts: [{ text: opts.contents }] }]
      : opts.contents;

  const body = JSON.stringify({
    ...(opts.systemInstruction
      ? { systemInstruction: { parts: [{ text: opts.systemInstruction }] } }
      : {}),
    contents,
    generationConfig: {
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      thinkingConfig: { thinkingBudget: opts.thinkingBudget ?? 0 },
      ...(opts.responseSchema
        ? { responseMimeType: 'application/json', responseSchema: opts.responseSchema }
        : {}),
    },
  });

  const started = Date.now();
  let retried = false;
  let res: Response | null = null;
  let lastNetworkError: unknown = null;

  const firstKey = nextGeminiKey();
  if (!firstKey) throw new GeminiError('GEMINI_API_KEY not set');
  const poolSize = geminiKeys().length;

  let key = firstKey;
  let transientAttempts = 0; // 429/5xx/sieć — max MAX_ATTEMPTS
  const deadKeys = new Set<string>(); // klucze z błędem 401/402/403 w tym żądaniu

  for (;;) {
    try {
      res = await fetch(`${API_BASE}/${opts.model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body,
        cache: 'no-store',
      });
      lastNetworkError = null;
    } catch (err) {
      lastNetworkError = err;
      res = null;
    }

    if (res && isKeyError(res.status)) {
      deadKeys.add(key);
      if (deadKeys.size >= poolSize) break; // cała pula martwa
      console.warn(`[gemini:${opts.purpose}] key error HTTP ${res.status} — trying next key`);
    } else {
      transientAttempts++;
      const transient = !res || isRetryable(res.status);
      if (!transient || transientAttempts >= MAX_ATTEMPTS) break;
      await sleep(BACKOFF_MS);
    }

    // Kolejny klucz z puli, pomijając martwe (pula 1-elementowa → ten sam).
    retried = true;
    let next = nextGeminiKey() ?? key;
    for (let i = 0; i < poolSize && deadKeys.has(next); i++) next = nextGeminiKey() ?? next;
    key = next;
  }

  const record = (usage: GeminiUsage, ok: boolean) => {
    opts.collector?.events.push({
      purpose: opts.purpose,
      model: opts.model,
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      retried,
      ok,
      latencyMs: Date.now() - started,
    });
  };
  const ZERO: GeminiUsage = { promptTokens: 0, outputTokens: 0, cachedTokens: 0 };

  if (!res) {
    record(ZERO, false);
    throw new GeminiError(
      `Gemini network error: ${lastNetworkError instanceof Error ? lastNetworkError.message : 'unknown'}`,
    );
  }
  if (res.status === 429) {
    record(ZERO, false);
    throw new RateLimitError('Gemini');
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error(`[gemini:${opts.purpose}] HTTP ${res.status}:`, errBody.slice(0, 300));
    record(ZERO, false);
    throw new GeminiError(`Gemini HTTP ${res.status}`, res.status);
  }

  // Parsujemy z surowego tekstu — przy 200 z pustym/niepełnym body res.json() rzuca.
  const bodyText = await res.text();
  let data: GeminiApiResponse;
  try {
    data = JSON.parse(bodyText) as GeminiApiResponse;
  } catch {
    console.error(`[gemini:${opts.purpose}] 200 z nie-JSON body:`, bodyText.slice(0, 300));
    record(ZERO, false);
    return { text: '', json: null, usage: ZERO, retried, finishReason: null, model: opts.model };
  }

  const usage: GeminiUsage = {
    promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    cachedTokens: data.usageMetadata?.cachedContentTokenCount ?? 0,
  };
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const finishReason = candidate?.finishReason ?? null;

  if (!text) {
    console.error(
      `[gemini:${opts.purpose}] brak tekstu — finishReason:`,
      finishReason,
      '| block:',
      data.promptFeedback?.blockReason,
    );
  }

  record(usage, text.length > 0);
  return {
    text,
    json: opts.responseSchema ? safeParseJson(text) : null,
    usage,
    retried,
    finishReason,
    model: opts.model,
  };
}
