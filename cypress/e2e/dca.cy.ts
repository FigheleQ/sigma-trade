// ============================================================
// DCA — cykliczny zakup „za X$ co tydzień" (features/dca.md).
//
// Testujemy przepływy widoczne dla usera w zakładce „DCA": pusty stan, lista
// planów, tworzenie, walidacja/błąd backendu i usuwanie. Wszystkie odpowiedzi
// backendu stubowane przez cy.intercept — testy deterministyczne, nie tykają
// bazy ani crona (żaden realny plan nie powstaje, żaden zakup nie idzie).
// ============================================================
const email = Cypress.env('TEST_EMAIL') as string;
const password = Cypress.env('TEST_PASSWORD') as string;

import type { DcaPlan, PortfolioState } from '../../src/lib/portfolio/types';

const portfolio = (overrides: Partial<PortfolioState> = {}): PortfolioState => ({
  cash: 10000,
  initialBalance: 10000,
  positionsValue: 0,
  totalValue: 10000,
  totalPnL: 0,
  totalPnLPercent: 0,
  positions: [],
  ...overrides,
});

// Bazowy plan DCA; nadpisujemy tylko to, czego dotyczy dany test.
const plan = (overrides: Partial<DcaPlan> = {}): DcaPlan => ({
  id: 'p1',
  ticker: 'AAPL',
  amountUsd: 100,
  carryUsd: 0,
  status: 'active',
  nextRunAt: new Date('2026-07-01T15:00:00Z').toISOString(),
  lastRunAt: null,
  createdAt: new Date('2026-06-24T15:00:00Z').toISOString(),
  ...overrides,
});

const QUOTE = { price: 100, change: 1, changePercent: 1, high: 101, low: 99, open: 99.5 };

function stubBase() {
  cy.intercept('GET', '**/api/chart*', {
    statusCode: 200,
    body: { candles: [], quote: QUOTE, usingMockData: true },
  }).as('chart');
  cy.intercept('GET', '**/api/portfolio', portfolio()).as('portfolio');
}

// Wymuszamy aktywny ticker AAPL niezależnie od stanu watchlisty konta runnera.
function seedTicker(win: Window) {
  win.localStorage.setItem(
    'atomic_puff_watchlist',
    JSON.stringify({ state: { activeTicker: 'AAPL' }, version: 0 }),
  );
}

function openDcaTab() {
  cy.visit('/dashboard', { onBeforeLoad: seedTicker });
  // <MarketView /> renderuje się dwa razy (desktop + mobile) — klikamy widoczny.
  cy.get('[aria-label="DCA"]').filter(':visible').first().click();
}

// Widoczna instancja panelu DCA. Scopujemy do niej wszystkie zapytania, bo
// DashboardClient renderuje MarketView dwukrotnie (desktop + mobile), a „AAPL"
// występuje też w watchliście — bez scope cy.contains łapie ukryte duplikaty.
function dcaPanel() {
  return cy.get('[data-cy="dca-panel"]').filter(':visible').first();
}

describe('DCA — cykliczny zakup', () => {
  beforeEach(() => cy.login(email, password));

  // 1) Pusty stan — brak planów.
  it('pokazuje pusty stan, gdy nie ma planów', () => {
    cy.intercept('GET', '**/api/dca', { statusCode: 200, body: { plans: [] } }).as('dca');
    stubBase();

    openDcaTab();
    cy.wait('@dca');

    dcaPanel().contains('Brak planów DCA').should('be.visible');
  });

  // 2) Lista planów — ticker, kwota tygodniowa i przeniesiona reszta.
  it('pokazuje istniejący plan z kwotą/tydzień i resztą (carry)', () => {
    cy.intercept('GET', '**/api/dca', {
      statusCode: 200,
      body: { plans: [plan({ ticker: 'AAPL', amountUsd: 100, carryUsd: 40 })] },
    }).as('dca');
    stubBase();

    openDcaTab();
    cy.wait('@dca');

    dcaPanel().within(() => {
      cy.contains('AAPL').should('be.visible');
      cy.contains('$100.00/tydz.').should('be.visible');
      cy.contains('reszta $40.00').should('be.visible'); // carry_usd > 0
    });
  });

  // 3) Utworzenie planu — wysyła ticker + kwotę i pokazuje potwierdzenie.
  it('tworzy nowy plan i pokazuje potwierdzenie', () => {
    cy.intercept('GET', '**/api/dca', { statusCode: 200, body: { plans: [] } }).as('dcaList');
    cy.intercept('POST', '**/api/dca', {
      statusCode: 200,
      body: { plan: plan({ id: 'new', ticker: 'MSFT', amountUsd: 250 }) },
    }).as('dcaCreate');
    stubBase();

    openDcaTab();
    cy.wait('@dcaList');

    dcaPanel().within(() => {
      cy.get('input[placeholder="TICKER"]').clear().type('MSFT');
      cy.get('input[type="number"]').clear().type('250');
      cy.contains('button', 'Dodaj plan').click();
    });

    cy.wait('@dcaCreate').its('request.body').should('deep.equal', {
      ticker: 'MSFT',
      amountUsd: 250,
    });

    dcaPanel().within(() => {
      cy.contains('Dodano plan: MSFT za $250.00/tydz.').should('be.visible');
      cy.contains('$250.00/tydz.').should('be.visible'); // plan dopisany do listy
    });
  });

  // 4) Błąd backendu (np. nieznany ticker) wraca jako komunikat, nie crash.
  it('pokazuje błąd, gdy backend odrzuci plan', () => {
    cy.intercept('GET', '**/api/dca', { statusCode: 200, body: { plans: [] } }).as('dcaList');
    cy.intercept('POST', '**/api/dca', {
      statusCode: 400,
      body: { error: 'Nieznany ticker: ZZZZ' },
    }).as('dcaCreate');
    stubBase();

    openDcaTab();
    cy.wait('@dcaList');

    dcaPanel().within(() => {
      cy.get('input[placeholder="TICKER"]').clear().type('ZZZZ');
      cy.get('input[type="number"]').clear().type('100');
      cy.contains('button', 'Dodaj plan').click();
    });
    cy.wait('@dcaCreate');

    dcaPanel().contains('Nieznany ticker: ZZZZ').should('be.visible');
  });

  // 5) Usuwanie planu — znika z listy (usunięcie optymistyczne).
  it('usuwa plan z listy', () => {
    cy.intercept('GET', '**/api/dca', {
      statusCode: 200,
      body: { plans: [plan({ id: 'p1', ticker: 'AAPL', amountUsd: 100 })] },
    }).as('dca');
    cy.intercept('DELETE', '**/api/dca*', { statusCode: 200, body: { ok: true } }).as('dcaDelete');
    stubBase();

    openDcaTab();
    cy.wait('@dca');

    dcaPanel().within(() => {
      cy.contains('AAPL').should('be.visible');
      cy.get('[aria-label="Usuń plan"]').click();
    });
    cy.wait('@dcaDelete');

    // Plan zniknął z widocznego panelu (usunięcie optymistyczne).
    dcaPanel().should('not.contain', '$100.00/tydz.');
  });
});
