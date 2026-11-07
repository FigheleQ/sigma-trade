// ============================================================
// Filtr faktów pamięci Coacha — CZYSTY moduł (bez I/O, bez aliasu `@/`),
// testowany przez Cypress cy.task.
//
// Fakt trafia do pamięci tylko, gdy: ma rozsądną długość, nie wygląda na
// instrukcję / prompt injection (lokalny gate guard.ts + słowa-klucze) i nie
// dubluje istniejącego faktu (także jako parafraza — Jaccard słów ≥ 0,6).
// ============================================================
import { analyzeIntent } from '../ai/guard';

export const FACT_MAX_CHARS = 120;

// Znaczące słowa faktu (≥ 4 znaki, bez końcowego „s") — do wykrywania parafraz.
const keyWords = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9$% ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .map((w) => w.replace(/s$/, '')),
  );

// „Prefers dividend stocks" vs „Prefers dividend-paying stocks" = 3/4 → duplikat.
export function similarFacts(a: string, b: string): boolean {
  const A = keyWords(a);
  const B = keyWords(b);
  if (A.size === 0 || B.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.6;
}

export function acceptFact(fact: string, existing: string[]): boolean {
  const f = fact.trim();
  if (f.length < 8 || f.length > FACT_MAX_CHARS) return false;
  if (analyzeIntent(f).intent === 'injection') return false;
  if (/\b(ignore|instruction|prompt|system|pretend|you must|always answer|never answer)\b/i.test(f)) return false;
  return !existing.some((e) => similarFacts(f, e));
}
