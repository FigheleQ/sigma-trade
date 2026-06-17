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
      cy.get('input[type="email"]').type(email);
      cy.get('input[type="password"]').type(password);
      cy.get('button[type="submit"]').click();
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
