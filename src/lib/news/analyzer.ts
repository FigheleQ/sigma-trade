// ============================================================
// News Analyzer — server-only
// Przyjmuje RawArticle[], wysyła do Gemini lub Claude,
// zwraca AnalyzedArticle[]. Fallback gdy AI niedostępne.
// ============================================================
import { loadConfig } from '@/lib/config';
import { nextGeminiKey } from '@/lib/apiKeys';
import type { RawArticle, AnalyzedArticle, ArticleCategory, Urgency } from './types';

// ----------------------------------------------------------------
// Typy odpowiedzi AI
// ----------------------------------------------------------------

interface AIAnalysisItem {
  id: number;
  impactScore: number;
  category: ArticleCategory;
  urgency: Urgency;
  interpretation: string;
  affectsPortfolio: boolean;
  tags: string[];
}

// ----------------------------------------------------------------
// Fallback — neutralna analiza gdy AI nie odpowiada
// ----------------------------------------------------------------

function fallbackAnalysis(article: RawArticle): AnalyzedArticle {
  return {
    ...article,
    impactScore: 0,
    category: 'company',
    urgency: 'low',
    interpretation: 'AI analysis unavailable.',
    affectsPortfolio: false,
    tags: [],
  };
}

// ----------------------------------------------------------------
// Prompt builder
// ----------------------------------------------------------------

function buildPrompt(articles: RawArticle[], watchlistSymbols: string[]): string {
  const articlesJson = JSON.stringify(
    articles.map(({ id, headline, summary, tickers }) => ({
      id,
      headline,
      summary: summary.slice(0, 2000), // więcej treści gdy fetchujemy z URL
      tickers,
    })),
    null,
    2,
  );

  return `You are a financial news analyst for a stock trading app.
Watchlist (portfolio tickers): ${watchlistSymbols.join(', ')}

Analyze each article and return a JSON array. For each article return:
{
  "id": <number — same as input>,
  "impactScore": <number -1.0 to 1.0, negative=bearish, positive=bullish>,
  "category": <"earnings"|"macro"|"sector"|"company"|"regulatory">,
  "urgency": <"low"|"medium"|"high"|"critical">,
  "interpretation": <string, 1-2 sentences, plain English, no markdown>,
  "affectsPortfolio": <boolean — true if any ticker is in watchlist>,
  "tags": <string[], max 4 short tags>
}

Articles:
${articlesJson}

Return ONLY the raw JSON array. No markdown, no explanation.`;
}

// ----------------------------------------------------------------
// Helper: wyciąga raw JSON z odpowiedzi AI (Gemini/Claude często
// opakowują output w ```json ... ``` mimo "Return ONLY raw JSON")
// ----------------------------------------------------------------

function extractJson(raw: string): string {
  const stripped = raw.trim();
  // Usuń code fences: ```json\n...\n``` lub ```\n...\n```
  const match = stripped.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  return match ? match[1].trim() : stripped;
}

// Specjalny error żeby route i hook mogły rozróżnić rate limit od innych błędów
export class RateLimitError extends Error {
  constructor(provider: string) {
    super(`${provider} rate limit (429) — spróbuj ponownie za chwilę`);
    this.name = 'RateLimitError';
  }
}

// ----------------------------------------------------------------
// Gemini
// ----------------------------------------------------------------

async function callGemini(
  prompt: string,
  model: string,
  maxTokens: number,
  temperature: number,
): Promise<AIAnalysisItem[]> {
  const callWith = (apiKey: string): Promise<Response> => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    });
  };

  // Pula kluczy: round-robin, a na 429 jeden retry na kolejnym kluczu.
  const firstKey = nextGeminiKey();
  if (!firstKey) throw new Error('GEMINI_API_KEY not set');

  let res = await callWith(firstKey);
  if (res.status === 429) {
    const retryKey = nextGeminiKey();
    if (retryKey && retryKey !== firstKey) res = await callWith(retryKey);
  }

  if (res.status === 429) throw new RateLimitError('Gemini');
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error(`[analyzer] Gemini HTTP ${res.status}:`, errBody.slice(0, 300));
    throw new Error(`Gemini HTTP ${res.status}`);
  }

  const data = await res.json() as {
    candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  console.log('[analyzer] Gemini raw response:', text.slice(0, 500));
  const parsed = JSON.parse(extractJson(text)) as AIAnalysisItem[];
  console.log('[analyzer] Gemini parsed items:', JSON.stringify(parsed));
  return parsed;
}

// ----------------------------------------------------------------
// Claude
// ----------------------------------------------------------------

async function callClaude(
  prompt: string,
  model: string,
  maxTokens: number,
  temperature: number,
): Promise<AIAnalysisItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (res.status === 429) throw new RateLimitError('Claude');
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);

  const data = await res.json() as {
    content?: Array<{ type: string; text: string }>;
  };

  const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
  return JSON.parse(extractJson(text)) as AIAnalysisItem[];
}

// ----------------------------------------------------------------
// Main export
// ----------------------------------------------------------------

export async function analyzeArticles(articles: RawArticle[]): Promise<AnalyzedArticle[]> {
  if (articles.length === 0) return [];

  const config = loadConfig();
  const { provider, gemini, claude } = config.ai_provider;
  const watchlistSymbols = config.watchlist.tickers.map((t) => t.symbol);

  const prompt = buildPrompt(articles, watchlistSymbols);

  let aiResults: AIAnalysisItem[] = [];

  try {
    if (provider === 'gemini') {
      aiResults = await callGemini(prompt, gemini.model, gemini.max_tokens, gemini.temperature);
    } else {
      aiResults = await callClaude(prompt, claude.model, claude.max_tokens, claude.temperature);
    }
  } catch (err) {
    // RateLimitError propagujemy wyżej — route zwróci 429 do klienta
    if (err instanceof RateLimitError) throw err;
    console.error('[analyzer] AI call failed, using fallback:', err);
    return articles.map(fallbackAnalysis);
  }

  // Łączymy AI wyniki z oryginalnymi danymi artykułów po id
  const aiMap = new Map<number, AIAnalysisItem>(aiResults.map((r) => [r.id, r]));
  console.log('[analyzer] article ids:', articles.map(a => a.id), '| AI ids:', aiResults.map(r => r.id));

  return articles.map((article) => {
    const ai = aiMap.get(article.id);
    if (!ai) {
      console.warn('[analyzer] no AI result for article id', article.id, '— using fallback');
      return fallbackAnalysis(article);
    }

    return {
      ...article,
      impactScore: Math.max(-1, Math.min(1, ai.impactScore)), // clamp
      category: ai.category,
      urgency: ai.urgency,
      interpretation: ai.interpretation,
      affectsPortfolio: ai.affectsPortfolio,
      tags: ai.tags.slice(0, 4),
    };
  });
}
