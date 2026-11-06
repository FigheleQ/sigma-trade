import { defineConfig } from 'cypress';
import { readFileSync } from 'fs';
import { resolve } from 'path';
// Czyste moduły AI v2 (bez I/O, bez aliasu @/) — testowane deterministycznie
// w Node przez cy.task, bez dodatkowego runnera unit testów.
import { analyzeIntent, nextAbuseState, templateReply, type GuardSlot } from './src/lib/ai/guard';
import { parseSlotsLocally, mergeSlots, missingSlots, completeStrategy, type SlotState, type RequiredSlot } from './src/lib/coach/slots';
import { buildPortfolioPlan, checkPlan, planToRecommendations } from './src/lib/strategy/allocate';
import type { UserStrategy } from './src/lib/coach/types';

// Cypress (Node) — w odróżnieniu od Next — nie wczytuje .env.local samo.
// Parsujemy go ręcznie (bez dodatkowej zależności) i przekazujemy wybrane
// klucze do Cypress.env, żeby spec integracyjny (dca-run.cy.ts) miał CRON_SECRET
// z .env.local — bez duplikowania sekretu w cypress.env.json.
function loadEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(__dirname, '.env.local'), 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue; // pomija komentarze (#...) i puste linie
      let val = m[2];
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      out[m[1]] = val;
    }
    return out;
  } catch {
    return {}; // brak .env.local → spec sam się pominie (brak CRON_SECRET)
  }
}

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    viewportWidth: 1280,
    viewportHeight: 720,
    setupNodeEvents(on, config) {
      on('task', {
        // Gate: klasyfikacja wiadomości + szablon odpowiedzi.
        'guard:classify'({ text, awaitingSlot }: { text: string; awaitingSlot?: GuardSlot | null }) {
          const a = analyzeIntent(text, { awaitingSlot: awaitingSlot ?? null });
          return { ...a, template: templateReply(a.intent === 'injection' ? 'injection' : 'off_topic', { awaitingSlot: awaitingSlot ?? null }) };
        },
        // Budżet nadużyć: sekwencja off-topic (true) / w temacie (false).
        'guard:abuse'({ sequence, maxStreak, windowMs }: { sequence: boolean[]; maxStreak: number; windowMs: number }) {
          let state = { streak: 0, lockedUntil: null as number | null };
          const now = 1_000_000;
          return sequence.map((offTopic, i) => {
            state = nextAbuseState(state, offTopic, now + i, { maxStreak, windowMs });
            return { streak: state.streak, locked: state.lockedUntil != null && state.lockedUntil > now + i };
          });
        },
        // Sloty: kolejne odpowiedzi usera → stan + czy profil domknięty (kod, nie model).
        'slots:run'({ answers }: { answers: string[] }) {
          let slots: SlotState = {};
          const steps = answers.map((answer) => {
            const awaited: RequiredSlot | null = missingSlots(slots)[0] ?? null;
            slots = mergeSlots(slots, parseSlotsLocally(answer, awaited));
            return { awaited, missing: missingSlots(slots) };
          });
          return { steps, strategy: completeStrategy(slots) };
        },
        // Silnik: plan + kontrola inwariantów.
        'plan:build'({ strategy, positions, prices }: { strategy: UserStrategy; positions: string[]; prices?: Record<string, number> }) {
          const ctx = { positions, prices };
          const plan = buildPortfolioPlan(strategy, ctx);
          return {
            check: checkPlan(plan, ctx),
            coreShare: plan.limits.coreShare,
            items: plan.items.map((i) => ({
              ticker: i.entry.ticker,
              role: i.role,
              category: i.category.key,
              sector: i.entry.sector,
              risk: i.entry.risk,
              weight: i.weight,
              shares: i.shares ?? null,
              themeException: i.themeException === true,
            })),
            recommendations: planToRecommendations(plan),
          };
        },
      });
      const env = loadEnvLocal();
      // Jawnie ustawiony Cypress.env (np. cypress.env.json) ma pierwszeństwo.
      config.env.CRON_SECRET = config.env.CRON_SECRET ?? env.CRON_SECRET;
      return config;
    },
  },
});
