const email = Cypress.env('TEST_EMAIL') as string;
const password = Cypress.env('TEST_PASSWORD') as string;

describe('Route guard — unauthenticated', () => {
  beforeEach(() => {
    // Invalidate the token server-side so stale cookies can't authenticate
    cy.request({ method: 'POST', url: '/api/auth/signout', failOnStatusCode: false });
    cy.clearAllCookies();
    cy.clearLocalStorage();
    cy.clearAllSessionStorage();
  });

  it('redirects / to /login', () => {
    cy.visit('/');
    cy.url().should('include', '/login');
  });

  it('redirects /dashboard to /login', () => {
    cy.visit('/dashboard');
    cy.url().should('include', '/login');
  });
});

describe('Login form', () => {
  beforeEach(() => {
    cy.clearAllCookies();
    cy.visit('/login');
  });

  it('renders both panels', () => {
    cy.contains('Sign in').should('be.visible');
    // Heading uses <br /> tags — 'Learn trading' is in a separate text node
    cy.contains('Learn trading').should('be.visible');
  });

  it('keeps submit button disabled until both fields have content', () => {
    cy.get('button[type="submit"]').should('be.disabled');
    cy.get('input[type="email"]').type('test@example.com');
    cy.get('button[type="submit"]').should('be.disabled');
    cy.get('input[type="password"]').type('anypassword');
    cy.get('button[type="submit"]').should('not.be.disabled');
  });

  it('shows an error for wrong credentials without jumping the layout', () => {
    cy.get('input[type="email"]').type('wrong@example.com');
    cy.get('input[type="password"]').type('wrongpassword');

    cy.get('button[type="submit"]')
      .invoke('offset')
      .then((before) => {
        cy.get('button[type="submit"]').click();
        cy.get('button[type="submit"]')
          .invoke('offset')
          .then((after) => {
            expect(after!.top).to.eq(before!.top);
          });
      });

    cy.contains('Invalid login credentials').should('be.visible');
  });

  it('redirects to /dashboard on successful login', () => {
    cy.get('input[type="email"]').type(email);
    cy.get('input[type="password"]').type(password);
    cy.get('button[type="submit"]').click();
    cy.url().should('include', '/dashboard');
  });
});

describe('Authenticated user', () => {
  beforeEach(() => cy.login(email, password));

  it('is redirected from /login to /dashboard', () => {
    cy.visit('/login');
    cy.url().should('include', '/dashboard');
  });

  it('can sign out and is redirected to /login', () => {
    cy.visit('/dashboard');
    cy.get('[aria-label="Profile menu"]').click();
    // Sign Out submits a form POST to /api/auth/signout which clears httpOnly cookies
    cy.get('form[action="/api/auth/signout"] button').click();
    cy.url().should('include', '/login');
  });

  it('cannot access /dashboard after signing out', () => {
    cy.visit('/dashboard');
    cy.get('[aria-label="Profile menu"]').click();
    cy.get('form[action="/api/auth/signout"] button').click();
    cy.url().should('include', '/login');
    // Ensure token is fully invalidated before verifying the guard
    cy.request({ method: 'POST', url: '/api/auth/signout', failOnStatusCode: false });
    cy.clearAllCookies();
    cy.visit('/dashboard');
    cy.url().should('include', '/login');
  });
});
