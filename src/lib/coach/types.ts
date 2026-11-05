// ============================================================
// Wspólny kontrakt A ↔ C — Coach (czat) + Strategy (rekomendacje).
//
// ⚠️ PLIK WSPÓŁWŁASNOŚCI (A + C). Po PR contract-first traktujemy go
//    jako ZAMROŻONY. Zmiana typu = uzgodnienie obu stron, jeden PR.
//    A czyta `UserStrategy`/`Recommendation` jako kontekst rozmowy,
//    C je produkuje. Reszta (CoachMessage/CoachTurn) należy do A.
//
// 📝 UZGODNIENIE A + C (AI v2, 2026-11): rozszerzenie WYŁĄCZNIE ADDYTYWNE.
//    • `UserStrategy` + opcjonalne: horizonYears, monthlyContribution,
//      drawdownComfort, preferredInstruments, dividendPreference, exclusions.
//    • `Recommendation` + opcjonalne: name, category, kind, risk, role,
//      suggestedAmount, suggestedShares, price, horizon, rationale, risks,
//      analystConsensus, confidence.
//    • `CoachMessage` + opcjonalne `offTopic` (pary odcięte przez guardrails).
//    Żadne istniejące pole nie zmieniło nazwy, typu ani wymagalności —
//    stary klient / mock / Cypress działają bez zmian.
// ============================================================

// ---- Profil inwestycyjny (produkuje C, czyta A) -------------

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';
export type RiskTolerance = 'low' | 'medium' | 'high';

// Profil zbudowany z odpowiedzi usera w onboardingu. Zapisuje C
// (`user_strategy`), A dostaje go z `GET /api/strategy` i wkleja jako
// kontekst do promptu Gemini.
export interface UserStrategy {
  level: SkillLevel;
  risk: RiskTolerance;
  budget: number; // wybrany balans startowy (USD), np. 10000 / 50000 / 100000
  interests: string[]; // sektory / motywy, np. ['Technology', 'Automotive']
  // ---- AI v2 (opcjonalne) ----
  horizonYears?: number; // horyzont inwestycji w latach
  monthlyContribution?: number; // planowane dopłaty miesięczne (USD)
  drawdownComfort?: 'low' | 'medium' | 'high'; // ile spadku user zniesie
  preferredInstruments?: Array<'etf' | 'stocks'>;
  dividendPreference?: boolean; // woli spółki dywidendowe
  exclusions?: string[]; // tickery / sektory do pominięcia
}

// ---- Rekomendacja (produkuje C, pokazuje A w czacie) --------

export type InstrumentKind = 'etf' | 'stock';
export type Confidence = 'low' | 'medium' | 'high';

export interface AnalystConsensus {
  buy: number; // buy + strongBuy
  hold: number;
  sell: number; // sell + strongSell
}

export interface Recommendation {
  ticker: string;
  reason: string; // krótkie uzasadnienie pod profil usera
  suggestedWeight: number; // sugerowana waga w portfelu, 0..1
  // ---- AI v2 (opcjonalne) ----
  name?: string;
  category?: string;
  kind?: InstrumentKind;
  risk?: RiskTolerance;
  role?: 'core' | 'satellite';
  suggestedAmount?: number; // USD z budżetu
  suggestedShares?: number; // z żywej ceny (może być ułamkowa)
  price?: number; // cena użyta do wyliczenia akcji
  horizon?: 'short' | 'mid' | 'long';
  rationale?: string[]; // 2–3 punkty „dlaczego pod TWÓJ profil"
  risks?: string[]; // „co może pójść nie tak"
  analystConsensus?: AnalystConsensus | null;
  confidence?: Confidence;
}

// ---- Wiadomości czatu (własność A) --------------------------

// Rola zgodna z konwencją Gemini `contents` (user / model).
export type CoachRole = 'user' | 'model';

// Pojedyncza tura wysyłana do/zwracana z modelu (lekka, bez metadanych DB).
export interface CoachTurn {
  role: CoachRole;
  content: string;
}

// Wiadomość persystowana w `coach_messages` (z metadanymi).
export interface CoachMessage {
  id: string;
  role: CoachRole;
  content: string;
  createdAt: string; // ISO
  offTopic?: boolean; // AI v2: para odcięta przez guardrails (pomijana w historii modelu)
}

// ---- Kontrakt request/response /api/coach (własność A) ------

// Kontekst usera wstrzykiwany do promptu (personalizacja, NIE fine-tuning).
export interface CoachUserContext {
  strategy: UserStrategy | null; // profil od C; null = świeży user (onboarding)
  cash: number | null; // gotówka w portfelu, jeśli znana
  positions: string[]; // tickery aktualnych pozycji
  watchlist: string[]; // tickery watchlisty (z config.yaml)
}

// Odpowiedź agenta: tekst do pokazania + sygnał zakończenia onboardingu.
export interface CoachReply {
  reply: string;
  // true gdy bot zebrał komplet profilu (level + risk + budget + interests).
  onboardingComplete: boolean;
  // Wypełnione tylko razem z onboardingComplete — gotowy profil dla C.
  strategy: UserStrategy | null;
}
