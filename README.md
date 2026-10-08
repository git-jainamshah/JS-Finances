# Jainam Finance

A private personal finance dashboard for Scotiabank, RBC and American Express. Includes interactive spending charts, income and savings metrics, transaction search, cash-flow scenarios, read-only Plaid connectivity, and a sign-in gate backed by Better Auth.

## Local development

Requires Node.js 24.

```sh
npm ci
cp .env.example .env  # skip if your configured .env already exists
# Fill the variables described below in .env
npm run setup
npm start
```

Open **http://localhost:4317**. Sign in with the owner account created by setup. There is no public registration. Use **Account security → Update your password** to change the password; this requires the current password and invalidates all other sessions. Sign out is in the header. Local development uses SQLite in `.data/` unless DATABASE_URL is supplied.

The configured local owner account has already been created in this workspace. Its credentials are not included in this repository. A fresh checkout requires its own initial setup.

## Deploy to Vercel

1. Import this GitHub repository into Vercel. Framework preset: **Other**. Node.js: **24.x**. The included `vercel.json` defines the function, build command and routing.
2. Attach a **private PostgreSQL database**, for example Neon through the Vercel Marketplace. Use its pooled connection string and provider-required TLS settings in `DATABASE_URL`.
3. Choose your production domain and set these **Production** environment variables before deploying:

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Exact HTTPS origin, e.g. `https://your-project.vercel.app`, no trailing slash. This is an allowlist, not a value inferred from request headers. |
| `OWNER_EMAIL` | Your sign-in email address. |
| `BETTER_AUTH_SECRET` | Random secret of at least 32 characters for authentication and CSRF. |
| `DATA_ENCRYPTION_KEY` | 32 random bytes encoded as base64; encrypts stored Plaid access tokens. Keep it stable and back it up securely. |
| `DATABASE_URL` | Your PostgreSQL connection string. |
| `INITIAL_PASSWORD` | Your chosen initial password (12–128 characters), supplied only for the first setup. |
| `PLAID_ENV` | `sandbox` for test banks or `production` for live bank accounts. |
| `PLAID_CLIENT_ID` | Plaid client ID; optional until you're ready to connect banks. |
| `PLAID_SECRET` | Matching Plaid environment secret; optional initially. |
| `PLAID_REDIRECT_URI` | If required by the institution, register this exact HTTPS URI in Plaid. Usually your app's root URL with trailing slash. |

Generate `BETTER_AUTH_SECRET` and `DATA_ENCRYPTION_KEY` independently with a password manager or `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Enter secret values only in your local environment or Vercel's environment settings, never in source files, commit messages or chat.

4. Deploy. `npm run setup` creates/migrates tables and seeds the owner only if no user exists. Repeat builds **never overwrite an existing password**. A mismatched owner causes setup to fail rather than creating another user.
5. Sign in and verify the dashboard. Remove `INITIAL_PASSWORD` from Vercel after the first successful setup; subsequent builds do not need it. Change the initial password using Account security.
6. Link each institution through Plaid when ready. Verify authentication and connection behaviour on the actual deployed domain before relying on it.

Production startup fails closed without an HTTPS APP_URL, authentication secret, owner email, encryption key and PostgreSQL. It never falls back to ephemeral SQLite on Vercel. All dashboard assets and data routes pass through the authenticated function; only the login screen, its stylesheet/script and a small allowlist of auth endpoints are public. Do not move `web/` into `public/`, which would bypass this protection.

Preview deployments need their **own database, secrets, owner and exact APP_URL**. Do not give arbitrary preview branches access to the production database. Domain changes also require updating APP_URL and Plaid's registered redirect URI. The repository prepares deployment, but does not provision your database or supply hosted credentials.

## Authentication and storage

- Better Auth handles password hashing, persisted sessions and login throttling. Session cookies are HTTP-only and SameSite=Lax; HTTPS deployments use Secure cookies.
- Sessions last up to 12 hours and are checked against the database for every protected request; cookie caching is disabled so revocation takes effect immediately.
- Public signup, email changes, password-reset and other account-management endpoints are blocked. The initial owner is seeded only by the setup script, never by a public endpoint.
- Password updates require the current password and force revocation of other sessions, even if a client requests otherwise.
- Mutation endpoints require the exact configured Origin and JSON content type. Plaid mutations additionally require a per-session CSRF token.
- PostgreSQL stores authentication state, rate limits and cached financial records. Plaid access tokens use AES-256-GCM encryption with the environment-provided key. Financial records themselves are not application-encrypted; use your database provider's encryption, access controls and backups.
- `.env*`, `.data/` and `.vercel/` are excluded from Git. The local SQLite directory has restrictive permissions. The app never serves arbitrary filesystem paths.
- The application is **single owner**. Keep OWNER_EMAIL stable. There is no password-recovery email flow; losing the password requires an administrator recovery procedure against the database. Do not set a new INITIAL_PASSWORD expecting it to overwrite an existing password.

The dashboard uses Google Fonts for typography and loads Plaid Link when connecting. It does not transmit financial data to an AI provider by itself.

## Plaid setup

Set your Plaid credentials privately in `.env` locally or the Vercel environment for hosting. Restart or redeploy after changes. Live Trial connections use `PLAID_ENV=production` and the matching production secret.

Click **Connect account** and complete the consent/sign-in flow yourself for each institution. The app requests only Transactions and reads account metadata/cached balances through `/accounts/get`. It has no payment or transfer endpoints. It asks for up to 730 days of history, subject to institution availability. Amex Canada and exact account coverage require verification in live Link.

After connecting, use **Sync accounts**. Initial transaction history may take time; retry later if empty. Sync downloads the latest data Plaid already has and does not force a real-time bank refresh. **Reconnect** restores a connection requiring authentication. OAuth resumes in the same browser tab.

Demo data, sandbox connections and production connections stay separate. Local connected data is not automatically migrated into the hosted database: reconnect banks in the hosted app, or arrange a deliberate migration that preserves the encryption key. Disconnect/revocation currently uses Plaid/bank consent controls; deleting local data does not revoke the upstream connection.

## Financial calculations

- Posted CAD transactions only; pending and foreign-currency transactions are excluded from metrics. No FX conversion.
- Positive Plaid amounts are outflows. Only INCOME categories count as income; other negative amounts are refunds unless categorized as transfers.
- Recognized transfers and credit-card payments are excluded to avoid double counting. Non-card loan payments currently count as outflows including principal.
- Savings rate is income less net spending, divided by income; it is not a comprehensive wealth measure.
- Categories can be wrong. Review low-confidence records and reconcile with statements. This version has no manual category editor or CSV importer.
- Projections start with CAD depository balances and use average income/spending over the prior three complete calendar months. Each step represents a 30-day month. They require some data in each month but cannot prove completeness. They exclude transfer effects, debt settlement, interest and investment returns; they are scenarios, not bill-due-date forecasts. Account filters affect projections.
- Insights are rule-based observations, not personalized investment or tax advice.

## Read-only VS Code agent adapter

`agent.mjs` offers `finance_summary`, `finance_accounts`, and `finance_transactions`. It requires the running local dashboard **and authentication**. It has no write, payment, transfer, sync or arbitrary SQL tools. It does not receive Plaid credentials.

For VS Code MCP clients supporting the `servers` format, copy `mcp.example.json` to `.vscode/mcp.json`. It prompts for `FINANCE_EMAIL` and a masked `FINANCE_PASSWORD`; do not hardcode passwords. Other clients may require a different configuration format. A password change invalidates the adapter's session; update the password in your client and restart the adapter.

`FINANCE_DATA_MODE=demo` uses sample data; `live` reads the running server's current Plaid environment. Enabling the adapter shares its tool results with your chosen AI agent; cloud-backed agents can send those results to their model provider. Transaction descriptions are untrusted data and must never be treated as instructions. The adapter currently connects only to localhost; no hosted API-key bypass exists.

## Validation

```sh
npm run check
npm test
# While the local app is running:
npm run test:smoke
```

The auth integration test uses a temporary database and a separate local port, with random test credentials. It verifies unauthenticated page/API blocking, private file protection, disabled registration, wrong-password rejection, session cookies, CSRF, password changes, forced session revocation, non-resetting owner setup, logout and rate limiting. Finance tests cover refunds, transfers, credit-card repayments, pending/foreign-currency exclusions, sync changes and demo integrity.

Live Plaid linking, OAuth return, PostgreSQL connectivity and Vercel deployment must still be verified with the supplied production services. Sync is manual; no scheduler or webhooks are installed.

## References

[Better Auth](https://better-auth.com/docs/installation) · [Plaid Transactions](https://plaid.com/docs/api/products/transactions/) · [Plaid Link](https://plaid.com/docs/api/link/) · [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js)
