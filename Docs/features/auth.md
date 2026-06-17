# Authentication

Email + password login via Supabase. Accounts are provisioned in the Supabase dashboard — there is no self-registration flow in the app.

## Stack

- `@supabase/supabase-js` — Supabase JS client
- `@supabase/ssr` — Cookie-based session helpers for Next.js App Router

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Both need the `NEXT_PUBLIC_` prefix so they are available in browser code. The publishable key is safe to expose publicly.

## Key files

| File | Role |
|---|---|
| `src/lib/supabase/client.ts` | `createBrowserClient` — used in Client Components |
| `src/lib/supabase/server.ts` | `createServerClient` with cookie store — used in Server Components |
| `src/middleware.ts` | Route guard — runs on every request before rendering |
| `src/app/login/LoginForm.tsx` | Login UI (Client Component) |
| `src/app/login/page.tsx` | Login route (Server Component wrapper) |

## How it works

### Route guard (middleware)

`src/middleware.ts` intercepts every non-static request. It must live inside `src/` when the project uses a `src/app/` directory structure — placing it at the project root is silently ignored by Next.js 15. It creates a Supabase server client that can read and refresh session cookies, then calls `supabase.auth.getUser()`:

- Unauthenticated + not on `/login` → redirect to `/login`
- Authenticated + on `/login` → redirect to `/dashboard`
- Otherwise → pass through (and forward any refreshed session cookies)

### Login flow

1. User submits email + password in `LoginForm`.
2. `supabase.auth.signInWithPassword()` is called on the browser client.
3. On success, Supabase sets a session cookie; `router.push('/dashboard')` navigates the user in.
4. On error, the error message is shown inline.

### User in the dashboard

`dashboard/page.tsx` (Server Component) calls `supabase.auth.getUser()` server-side and passes `user.email` down to `DashboardClient` → `ProfileButton`. This avoids any client-side session fetch on the main layout.

### Sign out

`ProfileButton` submits a form POST to `/api/auth/signout`. The server-side route handler calls `supabase.auth.signOut()` via the server client, which clears the `httpOnly` session cookies that browser-side JS cannot touch, then redirects to `/login`. The middleware blocks re-entry until the user logs in again.
