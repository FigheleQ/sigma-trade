import { defineConfig } from 'cypress';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
    setupNodeEvents(_on, config) {
      const env = loadEnvLocal();
      // Jawnie ustawiony Cypress.env (np. cypress.env.json) ma pierwszeństwo.
      config.env.CRON_SECRET = config.env.CRON_SECRET ?? env.CRON_SECRET;
      return config;
    },
  },
});
