// ============================================================
// DCA — egzekucja zakupu przez cron (INTEGRACJA, nie stub).
//
// W odróżnieniu od dca.cy.ts (stuby UI) ten spec uderza w PRAWDZIWY endpoint
// crona GET /api/dca/run i weryfikuje operację zakupu end-to-end: tworzy plan
// due-teraz, odpala skan i sprawdza, że cron przetworzył NASZ plan.
//
// Z natury niedeterministyczny (realna baza, Finnhub, godziny sesji US):
//   • rynek otwarty → plan wykonany: lastRunAt ustawione, nextRunAt przesunięty,
//     pozycja tickera rośnie (potem odkupujemy, by przywrócić stan konta),
//   • rynek zamknięty → cron ODRACZA: deferred, plan nietknięty (lastRunAt null).
//
// Wymaga `CRON_SECRET` w .env.local (cypress.config.ts wczytuje go do Cypress.env;
// Next używa tego samego pliku dla apki + SUPABASE_SERVICE_ROLE_KEY). Bez sekretu
// test sam się pomija.
// ============================================================
export {}; // moduł — izoluje stałe top-level (email/password) od innych speców

const email = Cypress.env('TEST_EMAIL') as string;
const password = Cypress.env('TEST_PASSWORD') as string;
const CRON_SECRET = Cypress.env('CRON_SECRET') as string | undefined;

// Tani ticker → budżet $100 wystarcza na ≥1 całą akcję (floor(budget/price) ≥ 1).
const TICKER = 'F';
const AMOUNT = 100;

interface Position {
  ticker: string;
  quantity: number;
}

function ownedQty(positions: Position[]): number {
  return positions.find((p) => p.ticker === TICKER)?.quantity ?? 0;
}

describe('DCA — egzekucja zakupu przez cron (integracja)', () => {
  beforeEach(() => cy.login(email, password));

  it('cron przetwarza due-plan: kupuje (rynek otwarty) albo odracza (zamknięty)', function () {
    // Brak skonfigurowanego sekretu crona — nie ma czego testować.
    // (skip rzutowane na () => void, by jawny return zakończył blok bez
    //  oznaczania reszty testu jako „unreachable" — Mocha typuje skip jako never.)
    if (!CRON_SECRET) {
      (this.skip as () => void)();
      return;
    }

    const before = { qty: 0 };
    let planId = '';

    // 1) Stan pozycji przed (do policzenia delty i odkupu).
    cy.request('GET', '/api/portfolio').then((res) => {
      before.qty = ownedQty(res.body.positions);
    });

    // 2) Utwórz plan — next_run_at = teraz, więc jest od razu „due".
    cy.request('POST', '/api/dca', { ticker: TICKER, amountUsd: AMOUNT }).then((res) => {
      expect(res.status).to.eq(200);
      planId = res.body.plan.id as string;
      expect(res.body.plan.ticker).to.eq(TICKER);
    });

    // 3) Odpal skan crona z autoryzacją Bearer.
    cy.request({
      method: 'GET',
      url: '/api/dca/run',
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    }).then((res) => {
      expect(res.status).to.eq(200);

      if (res.body.deferred) {
        // ── Rynek zamknięty: nic nie kupiono, plan nietknięty ──
        expect(res.body.ran).to.eq(0);
        cy.request('GET', '/api/dca').then((list) => {
          const mine = (list.body.plans as Array<{ id: string; lastRunAt: string | null }>).find(
            (p) => p.id === planId,
          );
          expect(mine, 'plan nadal istnieje').to.not.equal(undefined);
          expect(mine!.lastRunAt, 'plan nieprzetworzony przy zamkniętym rynku').to.equal(null);
        });
      } else {
        // ── Rynek otwarty: nasz due-plan został przetworzony ──
        expect(res.body.ran).to.be.greaterThan(0);

        cy.request('GET', '/api/dca').then((list) => {
          const mine = (
            list.body.plans as Array<{ id: string; lastRunAt: string | null; nextRunAt: string }>
          ).find((p) => p.id === planId);
          expect(mine, 'plan przetworzony przez cron').to.not.equal(undefined);
          expect(mine!.lastRunAt, 'lastRunAt ustawione po egzekucji').to.not.equal(null);
          // next_run_at przesunięty w przyszłość (kadencja tygodniowa, +7 dni).
          expect(new Date(mine!.nextRunAt).getTime()).to.be.greaterThan(Date.now());
        });

        // Operacja zakupu: pozycja tickera urosła; odkup, by przywrócić konto.
        cy.request('GET', '/api/portfolio').then((res2) => {
          const delta = ownedQty(res2.body.positions) - before.qty;
          expect(delta, 'kupiono ≥1 całą akcję za budżet').to.be.greaterThan(0);
          cy.request('POST', '/api/orders', { ticker: TICKER, side: 'sell', quantity: delta });
        });
      }
    });

    // 4) Sprzątanie — usuń plan testowy (po wszystkich powyższych komendach).
    cy.then(() => {
      cy.request('DELETE', `/api/dca?id=${encodeURIComponent(planId)}`);
    });
  });
});
