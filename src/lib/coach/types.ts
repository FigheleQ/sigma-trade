// ============================================================
// Wspólny kontrakt A ↔ C — Coach (czat) + Strategy (rekomendacje).
//
// ⚠️ PLIK WSPÓŁWŁASNOŚCI (A + C). Po PR contract-first traktujemy go
//    jako ZAMROŻONY. Zmiana typu = uzgodnienie obu stron, jeden PR.
//    A czyta `UserStrategy`/`Recommendation` jako kontekst rozmowy,
//    C je produkuje. Reszta (CoachMessage/CoachTurn) należy do A.
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
}

// ---- Rekomendacja (produkuje C, pokazuje A w czacie) --------

export interface Recommendation {
  ticker: string;
  reason: string; // krótkie uzasadnienie pod profil usera
  suggestedWeight: number; // sugerowana waga w portfelu, 0..1
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
