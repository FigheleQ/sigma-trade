// ============================================================
// Coach Agent — server-only.
//
// Różnica vs News Analyzer: czat jest MULTI-TURN. `analyzer.ts` robi
// jeden strzał (prompt → JSON); tu przekazujemy całą historię rozmowy
// w `contents` (role user/model) + personę i flow onboardingu w
// `systemInstruction`. Personalizacja = kontekst w promicie (profil,
// budżet, pozycje), NIE trenowanie modelu.
// ============================================================
import { loadConfig } from '@/lib/config';
import { nextGeminiKey } from '@/lib/apiKeys';
import { RateLimitError } from '@/lib/news/analyzer';
import { catalogForPrompt } from './recommendationCatalog';
import type {
  CoachTurn,
  CoachUserContext,
  CoachReply,
  UserStrategy,
} from './types';

// ---- System prompt (persona + onboarding) -------------------

function buildSystemInstruction(ctx: CoachUserContext): string {
  const profile = ctx.strategy
    ? `Known profile — level: ${ctx.strategy.level}, risk: ${ctx.strategy.risk}, ` +
      `budget: $${ctx.strategy.budget}, interests: ${ctx.strategy.interests.join(', ') || 'n/a'}.`
    : 'No profile yet — this user is brand new, run the onboarding.';

  const portfolio =
    ctx.cash != null
      ? `Portfolio cash: $${ctx.cash}. Positions: ${ctx.positions.join(', ') || 'none'}.`
      : 'Portfolio not loaded.';

  return `You are "Coach", the friendly onboarding mentor inside Sigma Trade, a paper-trading app
(virtual money, real prices). You greet new users, show them around, and gently profile their
investing experience so the app can tailor recommendations. Warm, concise, plain English, no markdown.

PERSONALIZATION CONTEXT (do not repeat verbatim, use it to tailor tone and content):
${profile}
${portfolio}
Watchlist available in-app: ${ctx.watchlist.join(', ') || 'n/a'}.

IN-APP INVESTMENT UNIVERSE — when you give ideas, GROUND them in these real categories and
tickers (all tradable in Sigma Trade). Prefer naming concrete tickers from here over vague talk.
Match categories to the user's interests, and pick across SEVERAL categories for diversification:
${catalogForPrompt()}

HOW TO ADVISE (every user, not just beginners):
- Beginners / low risk: start from broad ETFs (VOO, VTI, SCHD) plus 1–2 stable blue chips, and
  explain diversification.
- Intermediate: blend a core ETF with sector picks aligned to their interests.
- Advanced / high risk: it's fine to surface higher-volatility or thematic names (e.g. NVDA, TSLA,
  CCJ/CEG for nuclear, MP/ALB for rare-earth & materials), but always flag the risk.
- Give a few specific, varied tickers with a one-line "why" each — never a single generic name.

ONBOARDING FLOW (only while there is NO known profile):
1. Welcome the user and say you'll ask a couple of quick questions to personalize things.
2. Gauge skill level (beginner / intermediate / advanced).
3. Ask what sectors or themes interest them (e.g. technology, automotive, energy).
4. Ask their comfort with risk and starting budget (the app offers $10k / $50k / $100k).
Ask ONE thing at a time; acknowledge each answer before the next question.
Once you have level, risk, budget AND interests, set onboardingComplete=true and fill "strategy".
After onboarding (profile known), just be a helpful trading-education chat.

OUTPUT FORMAT — return ONLY a raw JSON object, no markdown, no code fences:
{
  "reply": <string, your message to the user>,
  "onboardingComplete": <boolean — true ONLY when level+risk+budget+interests are all gathered>,
  "strategy": <null, OR { "level": "beginner|intermediate|advanced",
                          "risk": "low|medium|high",
                          "budget": <number>,
                          "interests": <string[]> }>
}`;
}

// ---- Helpers (lokalne — symetryczne do analyzer.ts) ----------

function extractJson(raw: string): string {
  const stripped = raw.trim();
  const match = stripped.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  return match ? match[1].trim() : stripped;
}

function coerceStrategy(s: unknown): UserStrategy | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const level = o.level;
  const risk = o.risk;
  const budget = Number(o.budget);
  const interests = Array.isArray(o.interests) ? o.interests.map(String) : [];
  const levelOk = level === 'beginner' || level === 'intermediate' || level === 'advanced';
  const riskOk = risk === 'low' || risk === 'medium' || risk === 'high';
  if (!levelOk || !riskOk || !Number.isFinite(budget) || budget <= 0) return null;
  return { level, risk, budget, interests };
}

// ---- Gemini multi-turn call ---------------------------------

async function callGeminiChat(
  systemInstruction: string,
  history: CoachTurn[],
  model: string,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  // Round-robin klucz; na 429 jeden retry na kolejnym kluczu, potem propaguj.
  const attempt = async (apiKey: string): Promise<Response> => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: history.map((t) => ({ role: t.role, parts: [{ text: t.content }] })),
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          // gemini-2.5-flash to model „thinking" — bez tego tokeny myślenia
          // potrafią zjeść cały budżet wyjścia (MAX_TOKENS → pusta odpowiedź).
          // W czacie nie potrzebujemy rozumowania, więc je wyłączamy.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
  };

  const firstKey = nextGeminiKey();
  if (!firstKey) throw new Error('GEMINI_API_KEY not set');

  let res = await attempt(firstKey);
  // Retry raz przy 429 LUB przejściowym 5xx (Gemini free tier bywa „overloaded").
  // Na kolejnym kluczu z puli, a gdy puli brak — na tym samym (zwykła ponowna próba).
  if (res.status === 429 || res.status >= 500) {
    const retryKey = nextGeminiKey() ?? firstKey;
    res = await attempt(retryKey);
  }

  if (res.status === 429) throw new RateLimitError('Gemini');
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error(`[coach] Gemini HTTP ${res.status}:`, errBody.slice(0, 300));
    throw new Error(`Gemini HTTP ${res.status}`);
  }

  // Parsujemy z surowego tekstu — gdy Gemini odda 200 z pustym/niepełnym body
  // (zdarza się przy MAX_TOKENS / thinking), res.json() rzuca. Łapiemy i logujemy.
  const bodyText = await res.text();
  let data: {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };
  try {
    data = JSON.parse(bodyText);
  } catch {
    console.error('[coach] Gemini 200 z nie-JSON body:', bodyText.slice(0, 500));
    return '';
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) {
    console.error(
      '[coach] Gemini bez tekstu — finishReason:',
      data.candidates?.[0]?.finishReason,
      '| block:',
      data.promptFeedback?.blockReason,
      '| raw:',
      bodyText.slice(0, 500),
    );
  }
  return text;
}

// ---- Main export --------------------------------------------

// `history` musi kończyć się turą `user` (najnowsza wiadomość). Dla
// pierwszego wejścia (pusty wątek) przekaż jedną turę-zaczepkę, np.
// { role: 'user', content: '__start__' } — bot przywita i ruszy onboarding.
export async function chat(
  history: CoachTurn[],
  userContext: CoachUserContext,
): Promise<CoachReply> {
  const { gemini } = loadConfig().ai_provider;
  const systemInstruction = buildSystemInstruction(userContext);

  const text = await callGeminiChat(
    systemInstruction,
    history,
    gemini.model,
    gemini.max_tokens,
    gemini.temperature,
  );

  // Parsujemy structured output; przy złym JSON degradujemy do czystego tekstu
  // (lepiej pokazać odpowiedź niż wywalić czat).
  try {
    const parsed = JSON.parse(extractJson(text)) as {
      reply?: unknown;
      onboardingComplete?: unknown;
      strategy?: unknown;
    };
    const reply = typeof parsed.reply === 'string' ? parsed.reply : text;
    const strategy = coerceStrategy(parsed.strategy);
    // onboardingComplete tylko gdy faktycznie mamy komplet profilu.
    const onboardingComplete = parsed.onboardingComplete === true && strategy != null;
    return { reply, onboardingComplete, strategy: onboardingComplete ? strategy : null };
  } catch {
    const fallback =
      text.trim() || 'Sorry, I glitched for a second — could you say that again?';
    return { reply: fallback, onboardingComplete: false, strategy: null };
  }
}
