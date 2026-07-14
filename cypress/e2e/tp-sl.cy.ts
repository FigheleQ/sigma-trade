// ============================================================
// TP/SL — loty pozycji z Take Profit i Stop Loss.
//
// Pokrywa zmiany wprowadzone przez feat/take-profit-stop-loss:
//   • BuyModal — toggle'e TP/SL, wartości domyślne, blokada inputów,
//     poprawny kontrakt zapytania POST /api/orders dla każdej kombinacji,
//   • SellModal — sprzedaż całości i częściowa (ilość),
//   • wybór lotu (PositionsPanel) → „Close lot" wysyła lotId, „All" nie.
//
// Uwaga: dashboard renderuje DWA MarketView (layout desktop + mobile); w danym
// breakpoincie widoczny jest tylko jeden, więc wszystkie selektory celują w
// widoczny egzemplarz przez helper `el()` (`:visible`).
//
// Odpowiedzi backendu są stubowane przez cy.intercept — testy są deterministyczne
// i weryfikują to, co UI WYSYŁA, niezależnie od bazy i cen live.
// ============================================================
import type { PortfolioState, PositionLot, Position } from '../../src/lib/portfolio/types';

const email = Cypress.env('TEST_EMAIL') as string;
const password = Cypress.env('TEST_PASSWORD') as string;

// Celuje w widoczny egzemplarz (desktop layout przy viewport 1280).
const el = (dataCy: string) => cy.get(`[data-cy="${dataCy}"]:visible`);

// ── Helpers danych ───────────────────────────────────────────

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

const makePosition = (overrides: Partial<Position> = {}): Position => ({
  ticker: 'AAPL',
  quantity: 2,
  avgEntryPrice: PRICE,
  currentPrice: PRICE,
  marketValue: PRICE * 2,
  unrealizedPnL: 0,
  unrealizedPnLPercent: 0,
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

// Odpowiedź /api/orders — stub jednego zlecenia; body ustala test.
function stubOrder(body: Record<string, unknown>) {
  cy.intercept('POST', '**/api/orders', (req) => req.reply({ statusCode: 200, body })).as('order');
}

function seedTicker(win: Window) {
  win.localStorage.setItem(
    'atomic_puff_watchlist',
    JSON.stringify({ state: { activeTicker: 'AAPL' }, version: 0 }),
  );
}

function visitDashboard() {
  cy.visit('/dashboard', { onBeforeLoad: seedTicker });
  cy.wait('@chart');
}

// Scenariusz „mam N akcji AAPL w jednym locie".
function stubHolding(shares: number, lot: Partial<PositionLot> = {}) {
  stubPortfolio(portfolio({
    cash: 9_800,
    positions: [makePosition({ quantity: shares, marketValue: PRICE * shares })],
  }));
  stubLots([makeLot({ id: 'lot-1', quantity: shares, ...lot })]);
  stubTrades();
  stubChart();
}

const BUY_OK = {
  ok: true, side: 'buy', ticker: 'AAPL', quantity: 1,
  executionPrice: PRICE, realizedPnL: null, portfolio: portfolio({ cash: 9_900 }),
};

// Otwiera zakładkę Positions i zaznacza lot (przełącza OrderPanel w tryb „Close lot / All").
function selectLot(lotId: string, ticker = 'AAPL') {
  cy.get('[aria-label="Positions"]:visible').click();
  cy.wait('@lots');
  cy.get(`[data-cy="pos-ticker-${ticker}"]:visible`).click();
  cy.get(`[data-cy="pos-lot-${lotId}"]:visible`).click();
}

// ── Testy ─────────────────────────────────────────────────────

describe('TP/SL — zakup z Take Profit / Stop Loss', () => {
  beforeEach(() => cy.login(email, password));

  it('wysyła takeProfit i stopLoss gdy oba toggle są włączone + pokazuje snackbar', () => {
    stubPortfolio(portfolio({ cash: 10_000 }));
    stubLots([]);
    stubTrades();
    stubChart();
    stubOrder(BUY_OK);

    visitDashboard();
    el('buy-btn').click();
    cy.contains('Buy AAPL').should('be.visible');

    el('tp-toggle').click();
    el('tp-input').clear().type('105');
    el('sl-toggle').click();
    el('sl-input').clear().type('95');

    el('buy-confirm').click();
    cy.wait('@order').then(({ request }) => {
      const body = request.body as Record<string, unknown>;
      expect(body.side).to.equal('buy');
      expect(body.takeProfit).to.equal(105);
      expect(body.stopLoss).to.equal(95);
    });

    cy.get('[data-cy="snackbar"][data-visible="true"]')
      .should('contain.text', 'Bought 1× AAPL @ $100.00');
  });

  it('nie wysyła TP ani SL gdy oba toggle są wyłączone (domyślnie)', () => {
    stubPortfolio(portfolio({ cash: 10_000 }));
    stubLots([]);
    stubTrades();
    stubChart();
    stubOrder(BUY_OK);

    visitDashboard();
    el('buy-btn').click();
    el('buy-confirm').click();

    cy.wait('@order').then(({ request }) => {
      const body = request.body as Record<string, unknown>;
      expect(body.side).to.equal('buy');
      expect(body.quantity).to.equal(1);
      expect(body).to.not.have.property('takeProfit');
      expect(body).to.not.have.property('stopLoss');
    });
  });

  it('wysyła sam takeProfit gdy włączony jest tylko TP', () => {
    stubPortfolio(portfolio({ cash: 10_000 }));
    stubLots([]);
    stubTrades();
    stubChart();
    stubOrder(BUY_OK);

    visitDashboard();
    el('buy-btn').click();
    el('tp-toggle').click();
    el('tp-input').clear().type('110');
    el('buy-confirm').click();

    cy.wait('@order').then(({ request }) => {
      const body = request.body as Record<string, unknown>;
      expect(body.takeProfit).to.equal(110);
      expect(body).to.not.have.property('stopLoss');
    });
  });

  it('wysyła sam stopLoss gdy włączony jest tylko SL', () => {
    stubPortfolio(portfolio({ cash: 10_000 }));
    stubLots([]);
    stubTrades();
    stubChart();
    stubOrder(BUY_OK);

    visitDashboard();
    el('buy-btn').click();
    el('sl-toggle').click();
    el('sl-input').clear().type('90');
    el('buy-confirm').click();

    cy.wait('@order').then(({ request }) => {
      const body = request.body as Record<string, unknown>;
      expect(body.stopLoss).to.equal(90);
      expect(body).to.not.have.property('takeProfit');
    });
  });

  it('domyślnie proponuje TP=105.00 / SL=97.00 i blokuje inputy do czasu włączenia', () => {
    stubPortfolio(portfolio({ cash: 10_000 }));
    stubLots([]);
    stubTrades();
    stubChart();

    visitDashboard();
    el('buy-btn').click();

    // Wartości domyślne: price*1.05 oraz price*0.97
    el('tp-input').should('have.value', '105.00').and('be.disabled');
    el('sl-input').should('have.value', '97.00').and('be.disabled');

    // Po włączeniu toggle input staje się edytowalny (SL nadal zablokowany)
    el('tp-toggle').click();
    el('tp-input').should('not.be.disabled');
    el('sl-input').should('be.disabled');
  });
});

describe('TP/SL — sprzedaż lotów', () => {
  beforeEach(() => cy.login(email, password));

  it('Sell bez zaznaczonego lotu zamyka całą pozycję (bez lotId)', () => {
    stubHolding(2);
    stubOrder({
      ok: true, side: 'sell', ticker: 'AAPL', quantity: 2,
      executionPrice: PRICE, realizedPnL: 0, portfolio: portfolio({ cash: 10_000, positions: [] }),
    });

    visitDashboard();
    cy.wait('@portfolio');

    el('sell-btn').click();
    el('sell-confirm').click();

    cy.wait('@order').then(({ request }) => {
      const body = request.body as Record<string, unknown>;
      expect(body.side).to.equal('sell');
      expect(body.quantity).to.equal(2);
      expect(body).to.not.have.property('lotId');
    });

    cy.get('[data-cy="snackbar"][data-visible="true"]').should('contain.text', 'Sold 2× AAPL');
  });

  it('sprzedaż częściowa wysyła wybraną ilość, mniejszą niż stan posiadania', () => {
    // 3 akcje → zmniejszamy ilość do 2 stepperem
    stubHolding(3);
    stubOrder({
      ok: true, side: 'sell', ticker: 'AAPL', quantity: 2,
      executionPrice: PRICE, realizedPnL: 0, portfolio: portfolio({ cash: 9_900, positions: [makePosition({ quantity: 1 })] }),
    });

    visitDashboard();
    cy.wait('@portfolio');

    el('sell-btn').click();
    el('sell-qty').should('have.value', '3'); // domyślnie cały stan
    el('sell-dec').click();                    // 3 → 2
    el('sell-qty').should('have.value', '2');
    el('sell-confirm').click();

    cy.wait('@order').then(({ request }) => {
      const body = request.body as Record<string, unknown>;
      expect(body.quantity).to.equal(2);
      expect(body).to.not.have.property('lotId');
    });
  });

  it('„Close lot" po zaznaczeniu lotu wysyła jego lotId i pokazuje P/L', () => {
    stubHolding(2, { takeProfit: 120, stopLoss: 90 });
    stubOrder({
      ok: true, side: 'sell', ticker: 'AAPL', quantity: 2,
      executionPrice: PRICE, realizedPnL: 5, portfolio: portfolio({ cash: 10_000, positions: [] }),
    });

    visitDashboard();
    cy.wait('@portfolio');

    selectLot('lot-1');
    el('close-lot-btn').click();

    cy.wait('@order').then(({ request }) => {
      const body = request.body as Record<string, unknown>;
      expect(body.side).to.equal('sell');
      expect(body.lotId).to.equal('lot-1');
    });

    cy.get('[data-cy="snackbar"][data-visible="true"]').should('contain.text', 'P/L');
  });

  it('„All" przy zaznaczonym locie sprzedaje całą pozycję bez lotId', () => {
    stubHolding(2);
    stubOrder({
      ok: true, side: 'sell', ticker: 'AAPL', quantity: 2,
      executionPrice: PRICE, realizedPnL: 0, portfolio: portfolio({ cash: 10_000, positions: [] }),
    });

    visitDashboard();
    cy.wait('@portfolio');

    selectLot('lot-1');
    el('sell-all-btn').click();

    cy.wait('@order').then(({ request }) => {
      const body = request.body as Record<string, unknown>;
      expect(body.side).to.equal('sell');
      expect(body.quantity).to.equal(2);
      expect(body).to.not.have.property('lotId');
    });
  });
});
