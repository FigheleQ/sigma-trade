// ============================================================
// TP/SL — loty pozycji z Take Profit i Stop Loss.
//
// Wszystkie odpowiedzi backendu są stubowane przez cy.intercept.
// Testy są deterministyczne i niezależne od cen live oraz bazy.
// ============================================================
import type { PortfolioState, PositionLot } from '../../src/lib/portfolio/types';

const email = Cypress.env('TEST_EMAIL') as string;
const password = Cypress.env('TEST_PASSWORD') as string;

// ── Helpers ──────────────────────────────────────────────────

const PRICE = 100;
const QUOTE = { price: PRICE, change: 0, changePercent: 0, high: 101, low: 99, open: 99.5 };

const portfolio = (overrides: Partial<PortfolioState> = {}): PortfolioState => ({
  cash: 10_000,
  initialBalance: 10_000,
  positionsValue: 0,
  totalValue: 10_000,
  totalPnL: 0,
  totalPnLPercent: 0,
  positions: [],
  ...overrides,
});

const makeLot = (overrides: Partial<PositionLot> = {}): PositionLot => ({
  id: 'lot-1',
  ticker: 'AAPL',
  quantity: 1,
  entryPrice: PRICE,
  takeProfit: null,
  stopLoss: null,
  status: 'open',
  openedAt: new Date().toISOString(),
  closedAt: null,
  closePrice: null,
  closeReason: null,
  ...overrides,
});

function stubChart() {
  cy.intercept('GET', '**/api/chart*', {
    statusCode: 200,
    body: { candles: [], quote: QUOTE, usingMockData: true },
  }).as('chart');
}

function stubLots(lots: PositionLot[]) {
  cy.intercept('GET', '**/api/lots', { statusCode: 200, body: { lots } }).as('lots');
}

function stubPortfolio(state: PortfolioState) {
  cy.intercept('GET', '**/api/portfolio', { statusCode: 200, body: state }).as('portfolio');
}

function stubTrades() {
  cy.intercept('GET', '**/api/trades', { statusCode: 200, body: { trades: [] } }).as('trades');
}

function seedTicker(win: Window) {
  win.localStorage.setItem(
    'atomic_puff_watchlist',
    JSON.stringify({ state: { activeTicker: 'AAPL' }, version: 0 }),
  );
}

function visitDashboard() {
  cy.visit('/dashboard', { onBeforeLoad: seedTicker });
}

// ── Testy ─────────────────────────────────────────────────────

describe('TP/SL — loty pozycji', () => {
  beforeEach(() => cy.login(email, password));

  // ── 1. Kupno z TP i SL ────────────────────────────────────
  it('kupno z włączonym TP i SL wysyła poprawne wartości i pokazuje snackbar', () => {
    stubPortfolio(portfolio({ cash: 10_000 }));
    stubLots([]);
    stubTrades();
    stubChart();

    cy.intercept('POST', '**/api/orders', (req) => {
      req.reply({
        statusCode: 200,
        body: {
          ok: true,
          side: 'buy',
          ticker: 'AAPL',
          quantity: 1,
          executionPrice: PRICE,
          realizedPnL: null,
          portfolio: portfolio({ cash: 9_900 }),
        },
      });
    }).as('order');

    visitDashboard();
    cy.wait('@chart');

    // Otwórz modal zakupu
    cy.contains('button', 'Buy').filter(':visible').click();
    cy.contains('Buy AAPL').should('be.visible');

    // Włącz toggle Take Profit i zmień wartość
    cy.contains('Take Profit')
      .closest('div')
      .find('button')
      .first()
      .click();
    cy.get('input[type="number"]').filter(':visible').eq(1)
      .clear()
      .type('105');

    // Włącz toggle Stop Loss i zmień wartość
    cy.contains('Stop Loss')
      .closest('div')
      .find('button')
      .first()
      .click();
    cy.get('input[type="number"]').filter(':visible').eq(2)
      .clear()
      .type('95');

    // Potwierdź zakup
    cy.contains('button', 'Buy 1 × AAPL').click();
    cy.wait('@order').then((interception) => {
      const body = interception.request.body as Record<string, unknown>;
      expect(body.takeProfit).to.equal(105);
      expect(body.stopLoss).to.equal(95);
      expect(body.side).to.equal('buy');
    });

    cy.get('[data-cy="snackbar"][data-visible="true"]')
      .should('contain.text', 'Bought 1× AAPL @ $100.00');
  });

  // ── 2. Zamknięcie wszystkich lotów (Sprzedaj) ─────────────
  it('Sprzedaj zamyka wszystkie loty bez lotId i czyści pozycję', () => {
    const lot1 = makeLot({ id: 'lot-1', quantity: 1 });
    const lot2 = makeLot({ id: 'lot-2', quantity: 1 });

    stubPortfolio(
      portfolio({
        cash: 9_800,
        positions: [{
          ticker: 'AAPL',
          quantity: 2,
          avgEntryPrice: PRICE,
          currentPrice: PRICE,
          marketValue: 200,
          unrealizedPnL: 0,
          unrealizedPnLPercent: 0,
        }],
      }),
    );
    stubLots([lot1, lot2]);
    stubTrades();
    stubChart();

    cy.intercept('POST', '**/api/orders', (req) => {
      req.reply({
        statusCode: 200,
        body: {
          ok: true,
          side: 'sell',
          ticker: 'AAPL',
          quantity: 2,
          executionPrice: PRICE,
          realizedPnL: 0,
          portfolio: portfolio({ cash: 10_000, positions: [] }),
        },
      });
    }).as('order');

    visitDashboard();
    cy.wait('@chart');

    // Żaden lot nie jest zaznaczony — przycisk „Sell" sprzedaje wszystko
    cy.contains('button', 'Sell').filter(':visible').click();

    cy.wait('@order').then((interception) => {
      const body = interception.request.body as Record<string, unknown>;
      expect(body.lotId).to.be.undefined;
      expect(body.side).to.equal('sell');
    });

    cy.get('[data-cy="snackbar"][data-visible="true"]')
      .should('contain.text', 'Sold 2× AAPL');
  });
});
