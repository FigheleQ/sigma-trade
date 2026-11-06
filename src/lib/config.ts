// ============================================================
// Config loader — czyta config.yaml RAZ przy pierwszym imporcie
// i cache'uje. Działa tylko po stronie serwera (fs).
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { NewsAgentConfig, WatchlistTicker } from './news/types';

// ---- Gemini: tiering modeli + limity (AI v2) ----------------
// Stary kształt (`model` / `max_tokens`) zostaje jako fallback — config bez
// sekcji `models` / `limits` dalej działa (wsteczna kompatybilność).
export type GeminiTier = 'chat' | 'light' | 'analysis';

export interface GeminiLimitsConfig {
	chat_max_output_tokens?: number;
	light_max_output_tokens?: number;
	analysis_max_output_tokens?: number;
	history_turns?: number;
	summary_after_turns?: number;
	user_rpm?: number;
	user_rpd?: number;
	offtopic_max_streak?: number;
	offtopic_window_minutes?: number;
}

export interface GeminiProviderConfig {
	model?: string; // legacy — jeden model do wszystkiego
	max_tokens?: number; // legacy — jeden limit wyjścia
	temperature: number;
	models?: Partial<Record<GeminiTier, string>>;
	limits?: GeminiLimitsConfig;
}

export interface CoachAgentFlags {
	enabled: boolean;
	guardrails?: boolean; // warstwa 1 (lokalny gate) + warstwa 2 (blok SCOPE w prompcie)
	intent_gate?: boolean; // mikro-wywołanie `light` dla wiadomości „ambiguous"
	history_summary?: boolean; // zwijanie starszych tur w streszczenie (`light`)
	usage_log?: boolean; // zapis telemetrii do tabeli `ai_usage_log`
	onboarding_tiles?: boolean; // onboarding na kafelkach (0 wywołań modelu do podsumowania)
}

export interface AppConfig {
	app: {
		name: string;
		version: string;
		environment: 'development' | 'staging' | 'production';
		locale: 'en' | 'pl';
		currency: string;
	};
	data_provider: {
		name: string;
		base_url: string;
		rate_limit: { requests_per_minute: number };
		endpoints: Record<string, string>;
	};
	ai_provider: {
		provider: 'gemini' | 'claude';
		gemini: GeminiProviderConfig;
		claude: { model: string; max_tokens: number; temperature: number };
	};
	watchlist: { tickers: WatchlistTicker[] };
	features: {
		news_agent: NewsAgentConfig;
		technical_agent: { enabled: boolean };
		sentiment_agent: { enabled: boolean };
		orchestrator_agent: { enabled: boolean };
		coach_agent: CoachAgentFlags;
		strategy_agent: { enabled: boolean };
		onboarding: {
			enabled: boolean;
			knowledge_quiz: boolean;
			strategy_setup: boolean;
			guided_first_trade: boolean;
		};
		ui: {
			dark_mode: boolean;
			agent_workspace_position: 'right' | 'left';
			show_debug_panel: boolean;
		};
	};
	dev: {
		use_mock_data: boolean;
		verbose_logging: boolean;
		artificial_delay_ms: number;
		max_api_calls_per_session: number;
	};
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
	if (cached) return cached;
	const configPath = path.join(process.cwd(), 'config.yaml');
	const raw = fs.readFileSync(configPath, 'utf-8');
	cached = parse(raw) as AppConfig;
	return cached;
}

// Convenience accessors — czytelniej w wywołaniach
export const getNewsAgentConfig = (): NewsAgentConfig =>
	loadConfig().features.news_agent;

export const getWatchlist = (): WatchlistTicker[] =>
	loadConfig().watchlist.tickers;

export const getAiProvider = () => loadConfig().ai_provider;

// ---- Rozwiązane ustawienia Gemini (z domyślnymi) ------------

export interface ResolvedGeminiSettings {
	models: Record<GeminiTier, string>;
	temperature: number;
	limits: Required<GeminiLimitsConfig>;
}

// 2.5-flash nie jest już dostępny dla nowych projektów Google (HTTP 404) → 3.5.
const DEFAULT_CHAT_MODEL = 'gemini-3.5-flash';
// Flash-Lite: tańszy i z WYŻSZYM darmowym limitem (osobna pula per model) —
// idealny do klasyfikacji / ekstrakcji / streszczeń, gdzie jakość prozy nie gra roli.
const DEFAULT_LIGHT_MODEL = 'gemini-3.5-flash-lite';

export function getGeminiSettings(): ResolvedGeminiSettings {
	const g = loadConfig().ai_provider.gemini;
	const legacyModel = g.model ?? DEFAULT_CHAT_MODEL;
	const l = g.limits ?? {};
	return {
		models: {
			chat: g.models?.chat ?? legacyModel,
			light: g.models?.light ?? DEFAULT_LIGHT_MODEL,
			analysis: g.models?.analysis ?? legacyModel,
		},
		temperature: g.temperature ?? 0.3,
		limits: {
			// Odpowiedzi coacha to 2–5 zdań (~60–150 tokenów) + mały JSON.
			// 512 daje zapas ×3, a nie pozwala modelowi „rozgadać się" na free tier.
			chat_max_output_tokens: l.chat_max_output_tokens ?? 512,
			// Klasyfikacja / ekstrakcja slotu = jedno pole JSON (~5–15 tokenów).
			light_max_output_tokens: l.light_max_output_tokens ?? 32,
			// News batch: do 15 artykułów × ~80 tokenów JSON — tu 4096 ma sens.
			analysis_max_output_tokens: l.analysis_max_output_tokens ?? g.max_tokens ?? 4096,
			history_turns: l.history_turns ?? 8,
			summary_after_turns: l.summary_after_turns ?? 10,
			user_rpm: l.user_rpm ?? 6,
			user_rpd: l.user_rpd ?? 150,
			offtopic_max_streak: l.offtopic_max_streak ?? 3,
			offtopic_window_minutes: l.offtopic_window_minutes ?? 30,
		},
	};
}

export const getCoachFlags = (): Required<CoachAgentFlags> => {
	const f = loadConfig().features.coach_agent;
	return {
		enabled: f.enabled,
		guardrails: f.guardrails ?? true,
		intent_gate: f.intent_gate ?? false,
		history_summary: f.history_summary ?? false,
		usage_log: f.usage_log ?? false,
		onboarding_tiles: f.onboarding_tiles ?? false,
	};
};

export const isStrategyAgentEnabled = (): boolean =>
	loadConfig().features.strategy_agent?.enabled === true;
