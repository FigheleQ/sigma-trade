// ============================================================
// Onboarding na slotach — jawna maszyna stanów profilu.
//
// Zamiast liczyć, że model sam domknie profil (`onboardingComplete` z
// modelu), serwer trzyma stan slotów, a decyzję „complete" podejmuje KOD:
//   wymagane: level → interests → risk → budget (ta kolejność pytań),
//   opcjonalne (zbierane okazjonalnie, gdy user sam je poda):
//   horizonYears, monthlyContribution, drawdownComfort,
//   preferredInstruments, dividendPreference, exclusions.
//
// Ekstrakcja wartości: najpierw LOKALNY parser (0 wywołań, łapie ~90%
// odpowiedzi: „beginner", „50k", „medium", „tech and energy"), dopiero
// gdy zawiedzie — model `light` z maleńkim responseSchema (agent.ts).
//
// Plik CZYSTY (bez I/O, bez aliasu `@/`) — testowalny przez cy.task.
// ============================================================
import { matchCategories, RECOMMENDATION_CATALOG } from '../strategy/catalog';
import { sanitizeSlots, coerceStrategy } from '../strategy/validate';
import type { UserStrategy } from './types';

export type SlotState = Partial<UserStrategy>;
export type RequiredSlot = 'level' | 'interests' | 'risk' | 'budget';
export const SLOT_ORDER: RequiredSlot[] = ['level', 'interests', 'risk', 'budget'];

// ---- Stan ---------------------------------------------------

const has = (s: SlotState, slot: RequiredSlot): boolean => {
  if (slot === 'interests') return Array.isArray(s.interests) && s.interests.length > 0;
  return s[slot] != null;
};

export function missingSlots(s: SlotState): RequiredSlot[] {
  return SLOT_ORDER.filter((slot) => !has(s, slot));
}

// Znany pełny profil (z DB / klienta) wygrywa — onboarding nie jest potrzebny.
export function effectiveSlots(slots: SlotState, known: UserStrategy | null): SlotState {
  return known ? { ...slots, ...known } : slots;
}

// Na który slot czekamy (pierwszy brakujący) — kontekst dla guard.ts.
export function awaitingSlot(slots: SlotState, known: UserStrategy | null): RequiredSlot | null {
  return missingSlots(effectiveSlots(slots, known))[0] ?? null;
}

// Scalanie: nowe wartości nadpisują stare, wszystko przechodzi przez walidację.
export function mergeSlots(base: SlotState, update: unknown): SlotState {
  return { ...base, ...sanitizeSlots(update) };
}

export function completeStrategy(s: SlotState): UserStrategy | null {
  return coerceStrategy(s);
}

// ---- Lokalny parser -----------------------------------------

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/(\d),(\d{3})/g, '$1$2') // „50,000" → „50000"
    .trim();
}

// Jedno dopasowanie z kilku klas — przy konflikcie (dwie klasy) zwraca null,
// żeby niejednoznaczną odpowiedź rozstrzygnął model `light`.
function pickOne<T extends string>(text: string, classes: Array<[T, RegExp]>): T | null {
  const hits = classes.filter(([, re]) => re.test(text)).map(([v]) => v);
  return hits.length === 1 ? hits[0] : null;
}

const LEVEL_AWAITED: Array<['beginner' | 'intermediate' | 'advanced', RegExp]> = [
  ['beginner', /\b(beginner|newbie|novice|new to (this|investing|stocks|it)|never (invested|traded)|first time|just (starting|started)|starting out|no experience|zero experience|complete(ly)? new|poczatkuj\w*|nowicjusz\w*|zielony)\b/],
  ['intermediate', /\b(intermediate|some experience|a bit of experience|a little experience|a few years|somewhat experienced|average|sredniozaawansowan\w*|troche doswiadczeni\w*)\b/],
  ['advanced', /\b(advanced|experienced|expert|professional|pro trader|years of (experience|trading|investing)|veteran|zaawansowan\w*|doswiadczon\w*)\b/],
];
// Okazjonalnie (gdy NIE pytamy o poziom) tylko jednoznaczne etykiety.
const LEVEL_EXPLICIT: Array<['beginner' | 'intermediate' | 'advanced', RegExp]> = [
  ['beginner', /\b(i'?m a beginner|i am a beginner|complete beginner|total beginner|beginner investor)\b/],
  ['intermediate', /\b(i'?m (an )?intermediate|intermediate investor)\b/],
  ['advanced', /\b(i'?m (an )?(advanced|experienced)|advanced investor|experienced investor)\b/],
];

const RISK_AWAITED: Array<['low' | 'medium' | 'high', RegExp]> = [
  ['low', /\b(low|lower|conservative|safe|safer|cautious|careful|minimal|not much|little risk|avoid risk|nisk\w*|ostrozn\w*|bezpieczn\w*)\b/],
  ['medium', /\b(medium|moderate|balanced|middle|mid|average|some risk|in between|sredni\w*|umiarkowan\w*)\b/],
  ['high', /\b(high|higher|aggressive|risky|yolo|lots of risk|a lot of risk|maximum|wysok\w*|agresywn\w*)\b/],
];
const RISK_EXPLICIT: Array<['low' | 'medium' | 'high', RegExp]> = [
  ['low', /\b(low|conservative)[- ]risk\b|\brisk (tolerance |appetite )?(is )?low\b/],
  ['medium', /\b(medium|moderate)[- ]risk\b|\brisk (tolerance |appetite )?(is )?(medium|moderate)\b/],
  ['high', /\b(high|aggressive)[- ]risk\b|\brisk (tolerance |appetite )?(is )?high\b/],
];

const UNIT: Record<string, number> = { k: 1e3, thousand: 1e3, tys: 1e3, tysiecy: 1e3, m: 1e6, mln: 1e6, million: 1e6 };

// Kwota z jawnym sygnałem: „$50000", „50k", „budget of 10000".
const EXPLICIT_AMOUNT =
  /(?:\$\s*(\d+(?:\.\d+)?)\s*(k|thousand|mln|million|m)?\b)|(?:\b(\d+(?:\.\d+)?)\s*(k|thousand|tys(?:iecy)?|mln|million)\b)|(?:budget (?:of |is )?\$?\s*(\d+(?:\.\d+)?)\s*(k|thousand)?\b)/;
// Gdy pytaliśmy o budżet — wystarczy goła liczba („100000").
const BARE_AMOUNT = /\b(\d+(?:\.\d+)?)\b/;

function parseBudget(t: string, awaited: boolean): number | null {
  // Najpierw jawny sygnał („I have 3 kids and 50k" → 50k, nie 3).
  const explicit = t.match(EXPLICIT_AMOUNT);
  let num: string | undefined;
  let unit: string | undefined;
  if (explicit) {
    num = explicit[1] ?? explicit[3] ?? explicit[5];
    unit = explicit[2] ?? explicit[4] ?? explicit[6];
  } else if (awaited) {
    num = t.match(BARE_AMOUNT)?.[1];
  }
  if (!num) return null;
  const value = Number(num) * (unit ? (UNIT[unit] ?? 1) : 1);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

const UNSURE_INTERESTS = /\b(not sure|no idea|don'?t know|dont know|anything|whatever|no preference|everything|nie wiem|obojetnie|wszystko)\b/;

// Zwraca KLUCZE kategorii (np. „clean-nuclear"), nie etykiety — etykieta
// „Nuclear & clean energy" dopasowana ponownie po słowach łapała ropę.
function parseInterests(t: string, awaited: boolean): string[] | null {
  const cats = matchCategories([t]);
  if (cats.length > 0) return cats.map((c) => c.key);
  if (awaited && /\b(etf|etfs|index|indexes|diversified|passive)\b/.test(t)) return ['Diversified (broad ETFs)'];
  if (awaited && UNSURE_INTERESTS.test(t)) return ['Diversified (broad ETFs)'];
  return null;
}

// Wyciąga wartości slotów z wiadomości. `awaited` = slot, o który pytaliśmy
// (dla niego parser jest łagodniejszy), reszta tylko przy jawnych sygnałach.
export function parseSlotsLocally(text: string, awaited: RequiredSlot | null): SlotState {
  const t = norm(text);
  const out: SlotState = {};

  const level = pickOne(t, awaited === 'level' ? LEVEL_AWAITED : LEVEL_EXPLICIT);
  if (level) out.level = level;

  const risk = pickOne(t, awaited === 'risk' ? RISK_AWAITED : RISK_EXPLICIT);
  if (risk) out.risk = risk;

  const budget = parseBudget(t, awaited === 'budget');
  if (budget != null) out.budget = budget;

  // Zainteresowania tylko gdy o nie pytamy albo jest jawny sygnał („interested in", „I like").
  if (awaited === 'interests' || /\b(interested in|i like|i'?m into|interests? (are|is)|interesuj\w*)\b/.test(t)) {
    const interests = parseInterests(t, awaited === 'interests');
    if (interests) out.interests = interests;
  }

  // Opcjonalne — tylko jednoznaczne frazy.
  const horizon = t.match(/\b(\d{1,2})\s*(years?|yrs?|lat|lata)\b/);
  if (horizon && /\b(for|over|horizon|hold|keep|invest|na)\b/.test(t)) out.horizonYears = Number(horizon[1]);
  const monthly = t.match(/\$?\s*(\d+(?:\.\d+)?)\s*(k)?\s*(a|per|\/|each|every)\s*month\b/);
  if (monthly) out.monthlyContribution = Math.round(Number(monthly[1]) * (monthly[2] ? 1000 : 1));
  if (/\b(dividends?|income)\b/.test(t) && /\b(like|prefer|want|love|need)\b/.test(t)) out.dividendPreference = true;
  if (/\b(only|just) etfs?\b|\bno (individual )?stocks\b/.test(t)) out.preferredInstruments = ['etf'];

  return sanitizeSlots(out);
}

// ---- Kafelki onboardingu ------------------------------------

// Wartość kafelka „Not sure — keep it broad" (brak kategorii → domyślny przekrój).
export const BROAD_INTEREST = 'diversified';

const interestLabel = (key: string): string =>
  key === BROAD_INTEREST
    ? 'a broad, diversified mix'
    : (RECOMMENDATION_CATALOG.find((c) => c.key === key)?.shortLabel ?? key);

// Zdanie opisujące wybór z kafelków. Budowane z ZWALIDOWANYCH slotów — na
// serwerze zastępuje tekst od klienta, więc kafelki nie są furtką obok gate'u.
export function describeSlots(s: SlotState): string {
  const parts: string[] = [];
  if (s.level) parts.push(`I'm ${s.level === 'intermediate' || s.level === 'advanced' ? 'an' : 'a'} ${s.level} investor`);
  if (s.interests?.length) parts.push(`interested in ${s.interests.map(interestLabel).join(', ')}`);
  if (s.risk) parts.push(`${s.risk} risk`);
  if (s.budget != null) parts.push(`$${s.budget.toLocaleString('en-US')} budget`);
  return parts.join(' · ');
}

// Powitanie przy kafelkach — szablon, 0 wywołań modelu.
export const TILES_WELCOME =
  "Hi! I'm Coach, your investing mentor in Sigma Trade — paper trading with virtual money and real prices. " +
  "Tap a few tiles below and I'll build you a starter plan, or just type a question.";

// Powitanie, gdy profil jest już kompletny (kafelki się nie pokażą).
export const welcomeBack = (profile: string): string =>
  `Welcome back! Your profile: ${profile}. Ask me anything about investing — or hit Reset to rebuild your profile with the tiles.`;

// Pytanie o slot (używane, gdy model zawiedzie — deterministyczny fallback).
export const SLOT_PROMPTS: Record<RequiredSlot, string> = {
  level: 'Are you a beginner, intermediate or advanced investor?',
  interests: 'Which sectors or themes interest you — for example tech, energy, healthcare or EVs?',
  risk: 'How much risk are you comfortable with: low, medium or high?',
  budget: 'Which starting budget should we plan for — $10k, $50k or $100k?',
};
