declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      login(email: string, password: string): Chainable<void>;
    }
  }
}

Cypress.Commands.add('login', (email: string, password: string) => {
  cy.session(
    [email, password],
    () => {
      cy.visit('/login');
      // Two paths:
      // A) Middleware redirected to /dashboard (Supabase token auto-refreshed) — nothing to do.
      // B) Still on /login — fill the form.
      cy.url().then((url) => {
        if (!url.includes('/login')) return;

        // On a cold dev-server start, React may hydrate AFTER Cypress has already
        // typed into the inputs. When that happens, React reconcile resets the
        // controlled inputs back to empty state, leaving canSubmit = false.
        // Fix: type once (may be lost to hydration), then clear+retype so the second
        // pass always lands on a fully-hydrated form with wired-up onChange handlers.
        cy.get('input[type="email"]', { timeout: 15000 }).should('be.visible').type(email);
        cy.get('input[type="password"]').type(password);
        cy.get('input[type="email"]').clear().type(email);
        cy.get('input[type="password"]').clear().type(password);
        cy.get('button[type="submit"]', { timeout: 5000 }).should('not.be.disabled').click();
      });
      cy.url().should('include', '/dashboard');
      cy.url().should('include', '/dashboard');
    },
    {
      cacheAcrossSpecs: true,
      validate() {
        // If /dashboard redirects to /login, the session is stale — trigger re-login
        cy.request({ url: '/dashboard', followRedirect: false, failOnStatusCode: false })
          .its('status')
          .should('eq', 200);
      },
    },
  );
});

export {};
