// ============================================================
// Defensywny parser JSON z odpowiedzi modelu.
//
// Przy `responseMimeType: application/json` + `responseSchema` Gemini zwraca
// czysty JSON, więc to tylko fallback (np. stary model / provider Claude),
// gdy tekst przyjdzie opakowany w ```json … ```.
// ============================================================

export function extractJson(raw: string): string {
  const stripped = raw.trim();
  const match = stripped.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  return match ? match[1].trim() : stripped;
}

// Bezpieczne parsowanie — zwraca `null` zamiast rzucać.
export function safeParseJson(raw: string): unknown {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(extractJson(raw)) as unknown;
  } catch {
    return null;
  }
}
