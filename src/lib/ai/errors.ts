// ============================================================
// Błędy warstwy AI — wspólne dla coacha, newsów i strategii.
//
// Wcześniej `RateLimitError` żył w `news/analyzer.ts`, a coach go stamtąd
// importował (przeciek warstw). Teraz źródłem jest ten plik; analyzer
// zostawia re-export, żeby nie łamać istniejących importów.
// ============================================================

// Rate limit providera (429 po wyczerpaniu prób na puli kluczy) albo
// nasz własny limit per user — route mapuje go na HTTP 429.
export class RateLimitError extends Error {
  constructor(provider: string, message?: string) {
    super(message ?? `${provider} rate limit (429) — spróbuj ponownie za chwilę`);
    this.name = 'RateLimitError';
  }
}

// Błąd HTTP / brak klucza / pusta odpowiedź — wszystko poza rate limitem.
export class GeminiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}
