# Cypress E2E Testing Guide

## Running tests

| Command | When to use |
|---|---|
| `npm run dev` then `npm run cy:open` | Manual testing — interactive UI with time-travel debugger |
| `npm run cy:run` | Headless run, dev server must already be running |
| `npm run cy:e2e` | Headless run, starts and stops the dev server automatically |

> **macOS sandbox note:** All `cy:*` scripts are prefixed with `env -u ELECTRON_RUN_AS_NODE`. This is required because the Claude Code sandbox sets that env var, which makes the Cypress Electron binary run as plain Node.js instead of a browser. Never remove this prefix.

## Project layout

```
cypress/
  e2e/           ← spec files (*.cy.ts)
  support/
    commands.ts  ← custom commands (cy.login, etc.)
    e2e.ts       ← global setup, imports commands
cypress.config.ts
cypress.env.json ← local secrets (gitignored)
```

Specs go in `cypress/e2e/`. One file per feature area is the convention (`auth.cy.ts`, `watchlist.cy.ts`, etc.).

## Credentials and environment variables

Local credentials live in `cypress.env.json` (never commit this):

```json
{
  "TEST_EMAIL": "cypress_e2e_runner@sigmatrade.ai",
  "TEST_PASSWORD": "..."
}
```

In CI they come from GitHub repository secrets as `CYPRESS_TEST_EMAIL` and `CYPRESS_TEST_PASSWORD`. Cypress automatically strips the `CYPRESS_` prefix, so inside tests you always read them as:

```ts
const email = Cypress.env('TEST_EMAIL') as string;
const password = Cypress.env('TEST_PASSWORD') as string;
```

## Authentication

Use `cy.login()` at the top of any describe block that requires an authenticated user:

```ts
describe('Some authenticated feature', () => {
  beforeEach(() => cy.login(email, password));

  it('does something on the dashboard', () => {
    cy.visit('/dashboard');
    // ...
  });
});
```

`cy.login()` is defined in `cypress/support/commands.ts`. It uses `cy.session()` which:
- Runs the login flow once and caches cookies/localStorage in memory
- Restores the cached session on subsequent `beforeEach` calls instead of re-logging in
- Validates the cached session before restoring it — if Supabase has invalidated the token (e.g. after a sign-out test), it automatically re-runs the login flow
- Persists the session across spec files (`cacheAcrossSpecs: true`) so the first test in a new spec doesn't pay the login cost

For tests that must run **unauthenticated**, clear state in `beforeEach`:

```ts
beforeEach(() => {
  cy.request({ method: 'POST', url: '/api/auth/signout', failOnStatusCode: false });
  cy.clearAllCookies();
  cy.clearLocalStorage();
  cy.clearAllSessionStorage();
});
```

The `cy.request` call invalidates the token server-side. The clears handle the browser side.

## Middleware and route guard

The route guard lives in `src/middleware.ts` (must be inside `src/` — root-level middleware is silently ignored by Next.js 15 when a `src/app/` directory is used). It redirects:

- Unauthenticated requests to any route → `/login`
- Authenticated requests to `/login` → `/dashboard`

When writing route guard tests, always include the unauthenticated `beforeEach` cleanup above.

## Sign-out

Sign-out is a server-side form POST, not a client-side JS call. This is because Supabase session cookies are `HttpOnly` and cannot be cleared by browser JS. The selector for the sign-out button is:

```ts
cy.get('form[action="/api/auth/signout"] button').click();
```

## Anatomy of a spec file

```ts
// Resolve credentials once at the top of the file
const email = Cypress.env('TEST_EMAIL') as string;
const password = Cypress.env('TEST_PASSWORD') as string;

describe('Feature name — unauthenticated', () => {
  beforeEach(() => {
    cy.request({ method: 'POST', url: '/api/auth/signout', failOnStatusCode: false });
    cy.clearAllCookies();
    cy.clearLocalStorage();
    cy.clearAllSessionStorage();
  });

  it('redirects to /login', () => {
    cy.visit('/some-protected-route');
    cy.url().should('include', '/login');
  });
});

describe('Feature name — authenticated', () => {
  beforeEach(() => cy.login(email, password));

  it('loads correctly', () => {
    cy.visit('/dashboard');
    // assertions...
  });
});
```

## Selector conventions

Prefer selectors that survive CSS/layout changes:

| What to select | Preferred selector |
|---|---|
| Inputs | `input[type="email"]`, `input[type="password"]` |
| Submit buttons | `button[type="submit"]` |
| Buttons with labels | `[aria-label="Profile menu"]` |
| Sign-out form | `form[action="/api/auth/signout"] button` |
| Text content | `cy.contains('Sign in')` |

Avoid class-based selectors (`.btn-primary`) — they break when Tailwind classes change.

## What to test

Test user-visible behaviour, not implementation details.

**Good candidates:**
- Page loads and shows the right content for the current auth state
- Form validation (disabled button, error messages, no layout jump on error)
- Navigation flows (login → dashboard, sign-out → login, protected route → login)
- Critical happy paths (successful login, sign-out)

**Avoid:**
- Testing that a specific CSS class is applied
- Testing internal state or React component props
- Testing things covered by unit tests (pure functions, utilities)

## CI

Cypress runs on every push and pull request via `.github/workflows/ci.yml`. The `cypress` job:
- Runs after the `build` job succeeds
- Uses `cypress-io/github-action@v6` which builds the app, starts it with `npm start`, waits for port 3000, then runs all specs
- All required secrets (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `CYPRESS_TEST_EMAIL`, `CYPRESS_TEST_PASSWORD`) must be set as **repository secrets** in GitHub

Failures in CI upload screenshots as artifacts automatically via the official action.

## Adding a new custom command

1. Add the implementation to `cypress/support/commands.ts`
2. Add the TypeScript signature to the `Cypress.Chainable` interface in the same file

```ts
// In the global declaration block:
interface Chainable {
  login(email: string, password: string): Chainable<void>;
  myNewCommand(arg: string): Chainable<void>;  // ← add here
}

// Then implement:
Cypress.Commands.add('myNewCommand', (arg: string) => {
  // ...
});
```
