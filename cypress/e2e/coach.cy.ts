// ============================================================
// Coach (onboarding chatbot) — Agent A. Trzy kluczowe przepływy.
//
// Backend stubowany przez cy.intercept → testy deterministyczne, bez
// realnych wywołań Gemini i bez dotykania bazy (coach_messages).
// ============================================================
const email = Cypress.env('TEST_EMAIL') as string;
const password = Cypress.env('TEST_PASSWORD') as string;

import type { PortfolioState } from '../../src/lib/portfolio/types';

const portfolio: PortfolioState = {
  cash: 10000,
  initialBalance: 10000,
  positionsValue: 0,
  totalValue: 10000,
  totalPnL: 0,
  totalPnLPercent: 0,
  positions: [],
};

// Tło dashboardu — żeby reszta UI się zamontowała bez sieci.
function stubDashboard() {
  cy.intercept('GET', '**/api/portfolio', portfolio).as('portfolio');
  cy.intercept('GET', '**/api/chart*', {
    statusCode: 200,
    body: { candles: [], quote: { price: 100, change: 0, changePercent: 0 }, usingMockData: true },
  });
}

// Otwiera panel Coacha (klikamy widoczną ikonę — sidebar jest w DOM 2×).
// Dłuższy timeout: w dev pierwsze wejście na /dashboard kompiluje route
// i chunk CoachPanel on-demand, więc ikona/panel mogą pojawić się > 4 s.
function openCoach() {
  cy.get('[aria-label="Coach Agent"]', { timeout: 30000 }).filter(':visible').first().click();
}

// Wchodzi na dashboard z już „widzianym" powitaniem Coacha — popup nie
// przykrywa UI w testach samego czatu.
// Klucz per-user — musi pasować do coachIntroKey() w DashboardClient.tsx
const coachIntroKey = (e: string) => `coach_intro_seen_v1_${e}`;
function visitDashboardIntroSeen() {
  cy.visit('/dashboard', {
    onBeforeLoad(win) {
      win.localStorage.setItem(coachIntroKey(email), '1');
    },
  });
}

describe('Coach — onboarding chatbot', () => {
  beforeEach(() => {
    cy.login(email, password);
    stubDashboard();
  });

  // 1) Pierwsze logowanie → powitanie i pierwsze pytanie onboardingu.
  it('przy pierwszym wejściu wita i zadaje pierwsze pytanie onboardingu', () => {
    cy.intercept('GET', '**/api/coach', {
      statusCode: 200,
      body: { messages: [], needsOnboarding: true, isLegacyAccount: false },
    }).as('coachHistory');

    // Kickoff onboardingu (init woła POST z zaczepką).
    cy.intercept('POST', '**/api/coach', {
      statusCode: 200,
      body: {
        reply: 'Welcome to Sigma Trade! What is your experience level with investing?',
        onboardingComplete: false,
        strategy: null,
      },
    }).as('coachKickoff');

    visitDashboardIntroSeen();
    openCoach();

    // Hojny timeout — pierwszy spec po starcie serwera dev płaci cold-compile.
    cy.wait('@coachHistory', { timeout: 30000 });
    cy.wait('@coachKickoff', { timeout: 30000 });
    cy.contains('Welcome to Sigma Trade!', { timeout: 15000 }).should('be.visible');
    cy.contains('What is your experience level').should('be.visible');
  });

  // 2) Wysłanie wiadomości → odpowiedź bota dopisana do wątku.
  it('dopisuje odpowiedź bota po wysłaniu wiadomości', () => {
    // Istniejący user, onboarding już zrobiony → brak kickoffu.
    cy.intercept('GET', '**/api/coach', {
      statusCode: 200,
      body: {
        messages: [
          {
            id: 'm1',
            role: 'model',
            content: 'Hey! Ask me anything about trading.',
            createdAt: new Date().toISOString(),
          },
        ],
        needsOnboarding: false,
        isLegacyAccount: false,
      },
    }).as('coachHistory');

    cy.intercept('POST', '**/api/coach', {
      statusCode: 200,
      body: {
        reply: 'Diversification means spreading risk across assets.',
        onboardingComplete: false,
        strategy: null,
      },
    }).as('coachReply');

    visitDashboardIntroSeen();
    openCoach();
    cy.wait('@coachHistory');

    cy.get('[aria-label="Message your coach"]')
      .filter(':visible')
      .first()
      .type('What is diversification?');
    cy.get('[aria-label="Send message"]').filter(':visible').first().click();

    cy.wait('@coachReply');
    cy.contains('What is diversification?').should('be.visible'); // bąbel usera
    cy.contains('Diversification means spreading risk').should('be.visible'); // odpowiedź bota
  });

  // 3) Po onboardingu → sekcja rekomendacji (stub /api/strategy/recommendations).
  it('po zakończeniu onboardingu pokazuje rekomendacje od warstwy C', () => {
    cy.intercept('GET', '**/api/coach', {
      statusCode: 200,
      body: {
        messages: [
          {
            id: 'm1',
            role: 'model',
            content: 'Last question — what budget? ($10k / $50k / $100k)',
            createdAt: new Date().toISOString(),
          },
        ],
        needsOnboarding: true,
        isLegacyAccount: false,
      },
    }).as('coachHistory');

    // Odpowiedź domyka onboarding i zwraca profil.
    cy.intercept('POST', '**/api/coach', {
      statusCode: 200,
      body: {
        reply: 'Great, you are all set! Here are some ideas to start with.',
        onboardingComplete: true,
        strategy: { level: 'beginner', risk: 'low', budget: 10000, interests: ['Technology'] },
      },
    }).as('coachReply');

    // C zwraca rekomendacje dla profilu.
    cy.intercept('POST', '**/api/strategy/recommendations', {
      statusCode: 200,
      body: {
        recommendations: [
          { ticker: 'AAPL', reason: 'Stable mega-cap for a cautious start.', suggestedWeight: 0.5 },
          { ticker: 'MSFT', reason: 'Low-volatility blue chip.', suggestedWeight: 0.5 },
        ],
      },
    }).as('recommendations');
    cy.intercept('POST', '**/api/strategy', { statusCode: 200, body: { ok: true } });

    visitDashboardIntroSeen();
    openCoach();
    cy.wait('@coachHistory');

    cy.get('[aria-label="Message your coach"]').filter(':visible').first().type('$10k please');
    cy.get('[aria-label="Send message"]').filter(':visible').first().click();

    cy.wait('@coachReply');
    cy.wait('@recommendations');

    // Zawężamy do panelu rekomendacji — 'AAPL' występuje też na watchliście
    // (ukryty mobilny drawer), więc gołe cy.contains('AAPL') łapałoby zły element.
    cy.get('[data-testid="coach-recommendations"]')
      .filter(':visible')
      .first()
      .within(() => {
        cy.contains('Recommended for you').should('be.visible');
        cy.contains('AAPL').should('be.visible');
        cy.contains('Stable mega-cap').should('be.visible');
      });
  });

  // 4) Pierwsze uruchomienie funkcji → powitalny popup (desktop); CTA otwiera Coacha.
  it('przy pierwszym uruchomieniu pokazuje powitalny popup i otwiera Coacha z CTA', () => {
    cy.intercept('GET', '**/api/coach', {
      statusCode: 200,
      body: { messages: [], needsOnboarding: true, isLegacyAccount: false },
    }).as('coachHistory');
    cy.intercept('POST', '**/api/coach', {
      statusCode: 200,
      body: {
        reply: 'Welcome to Sigma Trade! What is your experience level?',
        onboardingComplete: false,
        strategy: null,
      },
    }).as('coachKickoff');

    // Ustawiamy flagę opt-in — bez niej Cypress globalnie blokuje popup
    // (żeby nie przeszkadzał w testach DCA/portfolio z main).
    cy.visit('/dashboard', {
      onBeforeLoad(win) {
        win.localStorage.setItem('cypress_show_coach_intro', '1');
      },
    });

    cy.contains('Meet Coach', { timeout: 30000 }).should('be.visible');
    cy.contains('button', 'Meet your coach').click();

    // Popup znika, panel Coacha startuje onboarding.
    cy.contains('Meet Coach').should('not.exist');
    cy.wait('@coachKickoff', { timeout: 30000 });
    cy.contains('Welcome to Sigma Trade!').should('be.visible');
  });

  // 5) Reset czatu i pamięci → kasuje wątek (DELETE) i restartuje onboarding.
  it('reset czyści pamięć i zaczyna onboarding od nowa', () => {
    let cleared = false;
    // GET zwraca stary wątek, dopóki nie skasujemy — potem pusty + onboarding.
    cy.intercept('GET', '**/api/coach', (req) => {
      req.reply(
        cleared
          ? { messages: [], needsOnboarding: true, isLegacyAccount: false }
          : {
              messages: [
                {
                  id: 'm1',
                  role: 'model',
                  content: 'Old conversation here.',
                  createdAt: new Date().toISOString(),
                },
              ],
              needsOnboarding: false,
              isLegacyAccount: false,
            },
      );
    }).as('coachHistory');

    cy.intercept('DELETE', '**/api/coach', (req) => {
      cleared = true;
      req.reply({ ok: true });
    }).as('coachDelete');

    cy.intercept('POST', '**/api/coach', {
      statusCode: 200,
      body: {
        reply: "Welcome back! Let's start fresh — what is your experience level?",
        onboardingComplete: false,
        strategy: null,
      },
    }).as('coachKickoff');

    cy.on('window:confirm', () => true); // potwierdź destrukcyjny reset

    visitDashboardIntroSeen();
    openCoach();
    cy.wait('@coachHistory');
    cy.contains('Old conversation here.').should('be.visible');

    cy.get('[aria-label="Reset chat and memory"]').filter(':visible').first().click();
    cy.wait('@coachDelete');
    cy.wait('@coachKickoff', { timeout: 30000 });

    cy.contains('Old conversation here.').should('not.exist');
    cy.contains('Welcome back!').should('be.visible');
  });
});
