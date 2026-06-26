// ============================================================
// Portfel (paper trading) — 5 najważniejszych przepływów z portfolio.md.
//
// Wszystkie odpowiedzi backendu są stubowane przez cy.intercept, dzięki czemu
// testy są deterministyczne i niezależne od:
//   - cen na żywo z Finnhub (i godzin sesji giełdowej),
//   - realnego salda współdzielonego konta testowego.
// Nie modyfikują też bazy — żaden prawdziwy order nie jest składany.
// ============================================================
const email = Cypress.env('TEST_EMAIL') as string;
const password = Cypress.env('TEST_PASSWORD') as string;

import type { PortfolioState } from '../../src/lib/portfolio/types';

// Bazowy stan portfela; nadpisujemy tylko to, czego dotyczy dany test.
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

// Cena z /api/chart trafia do quoteCache → OrderPanel używa jej do podglądu kosztu.
const QUOTE = { price: 100, change: 1, changePercent: 1, high: 101, low: 99, open: 99.5 };

function stubChart() {
  cy.intercept('GET', '**/api/chart*', {
    statusCode: 200,
    body: { candles: [], quote: QUOTE, usingMockData: true },
  }).as('chart');
}

// Wymuszamy aktywny ticker AAPL niezależnie od stanu watchlisty konta runnera.
// (zustand persist robi płytki merge, więc sekcje zostają domyślne.)
function seedTicker(win: Window) {
  win.localStorage.setItem(
    'atomic_puff_watchlist',
    JSON.stringify({ state: { activeTicker: 'AAPL' }, version: 0 }),
  );
}

function visitDashboard() {
  cy.visit('/dashboard', { onBeforeLoad: seedTicker });
}

describe('Portfel — paper trading', () => {
  beforeEach(() => cy.login(email, password));

  // 1) TopBar zawsze pokazuje stan portfela (Sekcja 5 — TopBar).
  it('pokazuje w TopBarze total value, P/L i dostępny cash', () => {
    cy.intercept(
      'GET',
      '**/api/portfolio',
      portfolio({ cash: 12000, totalValue: 98420, totalPnL: 1420, totalPnLPercent: 1.2 }),
    ).as('portfolio');
    stubChart();

    visitDashboard();
    cy.wait('@portfolio');

    cy.contains('Portfolio').should('be.visible');
    cy.contains('$98,420.00').should('be.visible');
    cy.contains('+1.20%').should('be.visible');
    cy.contains('$12,000.00').should('be.visible');
  });

  // 2) Zakładka „Pozycje" — otwarte pozycje z ilością, avg entry, ceną i P/L %.
  it('zakładka Pozycje pokazuje otwartą pozycję z P/L %', () => {
    cy.intercept(
      'GET',
      '**/api/portfolio',
      portfolio({
        cash: 8350,
        positions: [
          {
            ticker: 'AAPL',
            quantity: 10,
            avgEntryPrice: 150,
            currentPrice: 165,
            marketValue: 1650,
            unrealizedPnL: 150,
            unrealizedPnLPercent: 10,
          },
        ],
      }),
    ).as('portfolio');
    stubChart();

    visitDashboard();
    // <MarketView /> renderuje się dwa razy (layout desktop + mobile),
    // więc pasek ikon jest w DOM podwójnie — klikamy tylko widoczny.
    cy.get('[aria-label="Positions"]').filter(':visible').click();

    cy.contains('10 × $150.00').should('be.visible'); // ilość × avg entry
    cy.contains('$165.00').should('be.visible'); // cena aktualna
    cy.contains('+10.00%').should('be.visible'); // unrealized P/L %
  });

  // 3) Zakładka „Historia" — niezmienny ledger buy/sell + realized P/L.
  it('zakładka Historia pokazuje log buy/sell z realized P/L', () => {
    cy.intercept('GET', '**/api/portfolio', portfolio()).as('portfolio');
    cy.intercept('GET', '**/api/trades', {
      statusCode: 200,
      body: {
        trades: [
          {
            id: 't1',
            ticker: 'AAPL',
            side: 'buy',
            quantity: 10,
            price: 150,
            realizedPnL: null,
            executedAt: new Date().toISOString(),
          },
          {
            id: 't2',
            ticker: 'AAPL',
            side: 'sell',
            quantity: 5,
            price: 165,
            realizedPnL: 75,
            executedAt: new Date().toISOString(),
          },
        ],
      },
    }).as('trades');
    stubChart();

    visitDashboard();
    cy.get('[aria-label="History"]').filter(':visible').click();
    cy.wait('@trades');

    cy.contains('Buy').should('be.visible');
    cy.contains('Sell').should('be.visible');
    cy.contains('5 × $165.00').should('be.visible'); // wpis sprzedaży
    cy.contains('+$75.00').should('be.visible'); // realized P/L
  });

  // 4) Udane kupno — KUP otwiera modal; egzekucja po kliknięciu confirm (Sekcja 2).
  it('składa udane zlecenie kupna i pokazuje potwierdzenie egzekucji', () => {
    cy.intercept('GET', '**/api/portfolio', portfolio({ cash: 10000 })).as('portfolio');
    cy.intercept('GET', '**/api/trades', { body: { trades: [] } });
    cy.intercept('GET', '**/api/lots', { body: { lots: [] } });
    stubChart();
    cy.intercept('POST', '**/api/orders', {
      statusCode: 200,
      body: {
        ok: true,
        side: 'buy',
        ticker: 'AAPL',
        quantity: 1,
        executionPrice: 100,
        realizedPnL: null,
        portfolio: portfolio({ cash: 9900 }),
      },
    }).as('order');

    visitDashboard();
    cy.wait('@chart'); // cena dotarła do OrderPanel

    // Click Buy → modal opens → confirm places order
    cy.contains('button', 'Buy').filter(':visible').should('not.be.disabled').click();
    cy.contains('Buy AAPL').should('be.visible');
    cy.contains('button', 'Buy 1 × AAPL').click();
    cy.wait('@order');

    cy.get('[data-cy="snackbar"][data-visible="true"]')
      .should('contain.text', 'Bought 1× AAPL @ $100.00');
  });

  // 5) Walidacja (Sekcja 7) — bez środków przycisk confirm w modalu jest disabled;
  //    bez pozycji przycisk Sprzedaj jest disabled.
  it('blokuje kupno przy braku środków i sprzedaż przy braku pozycji', () => {
    // Cash $50, cena $100 → koszt > cash; brak pozycji → nic do sprzedania.
    cy.intercept('GET', '**/api/portfolio', portfolio({ cash: 50, positions: [] })).as(
      'portfolio',
    );
    cy.intercept('GET', '**/api/trades', { body: { trades: [] } });
    cy.intercept('GET', '**/api/lots', { body: { lots: [] } });
    stubChart();

    visitDashboard();
    cy.wait('@chart');
    cy.wait('@portfolio');

    // Buy opens modal — cash validation is inside (confirm disabled)
    cy.contains('button', 'Buy').filter(':visible').click();
    cy.contains('insufficient funds').should('be.visible');
    cy.contains('button', 'Buy 1 × AAPL').should('be.disabled');
    // Close modal by clicking backdrop
    cy.get('body').click(0, 0);
    cy.contains('Buy AAPL').should('not.exist');

    // Sell still disabled — no open position
    cy.contains('button', 'Sell').filter(':visible').should('be.disabled');
  });
});
