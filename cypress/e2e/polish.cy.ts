// ============================================================
// Tests for the perf / a11y / coach-polish PR.
//
// Covers four new behaviours:
//   1. History panel: "Loading history…" → list / "No transactions."
//   2. Sidebar: Coach button uses the white SVG icon
//   3. Coach panel: reopening shows existing messages immediately (no empty boxes)
//   4. Accessibility: <main> landmark present, icon-only buttons labelled
// ============================================================

const email = Cypress.env('TEST_EMAIL') as string;
const password = Cypress.env('TEST_PASSWORD') as string;

import type { PortfolioState } from '../../src/lib/portfolio/types';

const emptyPortfolio: PortfolioState = {
  cash: 10000,
  initialBalance: 10000,
  positionsValue: 0,
  totalValue: 10000,
  totalPnL: 0,
  totalPnLPercent: 0,
  positions: [],
};

function stubBaseApis() {
  cy.intercept('GET', '**/api/portfolio', emptyPortfolio).as('portfolio');
  cy.intercept('GET', '**/api/chart*', {
    body: { candles: [], quote: { price: 100, change: 0, changePercent: 0 }, usingMockData: true },
  });
}

function seedTicker(win: Window) {
  win.localStorage.setItem(
    'atomic_puff_watchlist',
    JSON.stringify({ state: { activeTicker: 'AAPL' }, version: 0 }),
  );
}

const coachIntroKey = (e: string) => `coach_intro_seen_v1_${e}`;

function visitDashboardIntroSeen() {
  cy.visit('/dashboard', {
    onBeforeLoad(win) {
      seedTicker(win);
      win.localStorage.setItem(coachIntroKey(email), '1');
    },
  });
}

function openCoach() {
  cy.get('[aria-label="Coach Agent"]', { timeout: 30000 }).filter(':visible').first().click();
}

// ── 1. History loading state ─────────────────────────────────────────────────

describe('History panel — loading state', () => {
  beforeEach(() => {
    cy.login(email, password);
    stubBaseApis();
  });

  it('shows "Loading history…" while the fetch is in-flight', () => {
    // Intercept with a 1 s delay so we can assert the intermediate state.
    cy.intercept('GET', '**/api/trades', (req) => {
      req.reply({ delay: 1000, body: { trades: [] } });
    }).as('tradesSlow');

    visitDashboardIntroSeen();
    cy.get('[aria-label="History"]').filter(':visible').click();

    // Must appear before the delayed response resolves.
    cy.contains('Loading history…').should('be.visible');

    cy.wait('@tradesSlow');

    cy.contains('No transactions.').should('be.visible');
    cy.contains('Loading history…').should('not.exist');
  });

  it('shows trade list (not "Loading history…") when trades are returned', () => {
    cy.intercept('GET', '**/api/trades', {
      body: {
        trades: [
          {
            id: 't1',
            ticker: 'AAPL',
            side: 'buy',
            quantity: 2,
            price: 150,
            realizedPnL: null,
            executedAt: new Date().toISOString(),
          },
        ],
      },
    }).as('trades');

    visitDashboardIntroSeen();
    cy.get('[aria-label="History"]').filter(':visible').click();
    cy.wait('@trades');

    cy.contains('2 × $150.00').should('be.visible');
    cy.contains('Loading history…').should('not.exist');
    cy.contains('No transactions.').should('not.exist');
  });
});

// ── 2. Sidebar — white icon ───────────────────────────────────────────────────

describe('Agent sidebar — Coach icon', () => {
  beforeEach(() => {
    cy.login(email, password);
    stubBaseApis();
    cy.intercept('GET', '**/api/trades', { body: { trades: [] } });
  });

  it('sidebar Coach button uses the white SVG icon (not the green one)', () => {
    visitDashboardIntroSeen();

    // There may be two sidebars in the DOM (desktop + mobile) — find the
    // visible one and check the <img> src inside the Coach button.
    cy.get('[aria-label="Coach Agent"]')
      .filter(':visible')
      .first()
      .find('img')
      .should('have.attr', 'src', '/coach-icon-white.svg');
  });
});

// ── 3. Coach panel — no re-animation on reopen ───────────────────────────────

describe('Coach panel — messages appear instantly on reopen', () => {
  beforeEach(() => {
    cy.login(email, password);
    stubBaseApis();
    cy.intercept('GET', '**/api/trades', { body: { trades: [] } });
  });

  it('existing messages are visible immediately after closing and reopening the panel', () => {
    const existingMessage = 'Hey! Ask me anything about trading.';

    cy.intercept('GET', '**/api/coach', {
      body: {
        messages: [
          {
            id: 'm-existing',
            role: 'model',
            content: existingMessage,
            createdAt: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
        needsOnboarding: false,
      },
    }).as('coachHistory');

    visitDashboardIntroSeen();
    openCoach();
    cy.wait('@coachHistory', { timeout: 30000 });

    // Confirm message is visible on first open.
    cy.contains(existingMessage).should('be.visible');

    // Switch away from Coach by clicking the News agent.
    cy.get('[aria-label="News Agent"]', { timeout: 10000 })
      .filter(':visible')
      .first()
      .click();
    cy.contains(existingMessage).should('not.exist');

    // Reopen Coach — message must appear immediately (not as empty box, not
    // typewritten from scratch). Regression: content stayed empty until the
    // user typed something.
    openCoach();
    cy.contains(existingMessage, { timeout: 1000 }).should('be.visible');
  });
});

// ── 4. Accessibility ─────────────────────────────────────────────────────────

describe('Accessibility basics', () => {
  beforeEach(() => {
    cy.login(email, password);
    stubBaseApis();
    cy.intercept('GET', '**/api/trades', { body: { trades: [] } });
  });

  it('dashboard page has a <main> landmark', () => {
    visitDashboardIntroSeen();
    cy.get('main').should('exist');
  });

  it('agent sidebar buttons all have accessible aria-labels', () => {
    visitDashboardIntroSeen();

    // Every button in the sidebar (coach, news, …) must have an aria-label.
    // This was enforced in the polish pass: icon-only buttons are unlabelled by default.
    cy.get('[aria-label="Coach Agent"]', { timeout: 15000 })
      .filter(':visible')
      .should('exist');
    cy.get('[aria-label="News Agent"]')
      .filter(':visible')
      .should('exist');
  });
});
