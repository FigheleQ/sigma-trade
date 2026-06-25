// ============================================================
// Pula kluczy API — server-only.
//
// Darmowe limity (Gemini free, Finnhub 60/min, TwelveData 8/min) są
// wąskim gardłem przy wielu userach. Rozwiązanie: kilka kluczy +
// round-robin, z przeskokiem na kolejny klucz przy 429.
//
// Czyta listę z `*_API_KEYS` (CSV) albo pojedynczy `*_API_KEY` jako
// fallback → zmiana NIEŁAMIĄCA (stara konfiguracja dalej działa).
// ============================================================

function pool(envList: string, envSingle: string): string[] {
  const multi = (process.env[envList] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (multi.length) return multi;
  const one = process.env[envSingle];
  return one ? [one] : [];
}

export const geminiKeys = (): string[] => pool('GEMINI_API_KEYS', 'GEMINI_API_KEY');
export const finnhubKeys = (): string[] => pool('FINNHUB_API_KEYS', 'FINNHUB_API_KEY');

// Round-robin — wskaźnik przesuwa się przy każdym pobraniu klucza.
let gi = 0;
let fi = 0;

export const nextGeminiKey = (): string | undefined => {
  const k = geminiKeys();
  return k.length ? k[gi++ % k.length] : undefined;
};

export const nextFinnhubKey = (): string | undefined => {
  const k = finnhubKeys();
  return k.length ? k[fi++ % k.length] : undefined;
};
