# Jainam Finance

A private personal finance dashboard for Scotiabank, RBC and American Express. Pages: Overview (customizable cards), Spending, Recurring (bills, subscriptions and newly repeating charges), Loans & IOUs, Projections (plain-language what-if planning), Transactions (saved views, recategorizing with rules), Chat (ask questions about your finances, powered by Claude) and Settings. Read-only Plaid connectivity and a sign-in gate backed by Better Auth.

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

1. Import this GitHub repository into Vercel. Framework preset: **Other**. Node.js: **24.x**. The included `vercel.json` defines the function, `npm run build` command and routing. If you previously overrode the Build Command in Vercel, change it from `npm run setup` to `npm run build` or remove that override.
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
| `PLAID_ENV` | Optional default view: `sandbox` or `production`. The dashboard can switch between both. |
| `PLAID_CLIENT_ID` | Optional compatibility fallback. Prefer saving credentials in the authenticated Plaid settings screen. |
| `PLAID_SECRET` | Optional compatibility fallback for the environment selected by `PLAID_ENV`. |
| `PLAID_REDIRECT_URI` | Optional override for the Production OAuth return URL. Defaults to `APP_URL` with a trailing slash; register that exact HTTPS URI in Plaid. |
| `PLAID_LINK_CUSTOMIZATION` | Optional Production Link customization name. Defaults to `jainam_finances_prod`. |
| `ANTHROPIC_API_KEY` | Optional. Enables the Chat page. Without it, Chat shows a setup message and nothing is sent anywhere. |
| `ANTHROPIC_MODEL` | Optional model for Chat. Defaults to `claude-haiku-5-5` (lowest cost, roughly under $0.01 per question). Use `claude-sonnet-5-5` or `claude-opus-5-5` for better answers at higher cost. |

Generate `BETTER_AUTH_SECRET` and `DATA_ENCRYPTION_KEY` independently with a password manager or `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Enter secret values only in your local environment or Vercel's environment settings, never in source files, commit messages or chat.

4. Deploy. `npm run build` validates the application without requiring credentials. If configuration is incomplete, it skips database setup and the deployed app returns a locked **503 Setup required** page. Set the variables listed above for the correct Vercel environment and redeploy. Once configuration is complete, the build runs `scripts/setup.mjs`, which creates/migrates tables and seeds the owner only if no user exists. Repeat builds **never overwrite an existing password**. A mismatched owner causes setup to fail rather than creating another user.
5. Sign in and verify the dashboard. Remove `INITIAL_PASSWORD` from Vercel after the first successful setup; subsequent builds do not need it. Change the initial password using Account security.
6. Link each institution through Plaid when ready. Verify authentication and connection behaviour on the actual deployed domain before relying on it.

Production requests fail closed with HTTP 503 without an HTTPS APP_URL, authentication secret, owner email, encryption key and PostgreSQL. A successful code build alone does not mean the dashboard is configured or ready for financial data. It never falls back to ephemeral SQLite on Vercel. All dashboard assets and data routes pass through the authenticated function; only the login screen, its stylesheet/script and a small allowlist of auth endpoints are public. Do not move `web/` into `public/`, which would bypass this protection.

### Testing branches before merging (one-time setup)

Every branch pushed to GitHub gets a Vercel preview at `https://js-finances-git-<branch>-<team>.vercel.app` (Vercel shortens long branch names, so use the **Preview** link in the Vercel bot's comment on the pull request). Previews work out their own address, so they never need `APP_URL`. Set this up once:

1. **Database:** install the **Neon** integration (Vercel → Integrations, or Storage → your Neon database) and turn on *Create a database branch for preview deployments*. Each preview then gets its own copy of the production database, and `DATABASE_URL` is filled in automatically. Previews never write to production data.
2. **Variables:** in Project Settings → Environment Variables, add these once with environment **Preview** and *all branches*: `OWNER_EMAIL` and `DATA_ENCRYPTION_KEY` (same values as Production, so the copied data and Plaid connections still decrypt), `BETTER_AUTH_SECRET` (a different random value from Production), and optionally `ANTHROPIC_API_KEY`.

After that, every new branch just works: push, open the preview link, sign in with your normal password. Preview links stay behind Vercel's login as well as the app's own sign-in. Domain changes also require updating APP_URL and Plaid's registered redirect URI. The repository prepares deployment, but does not provision your database or supply hosted credentials.

### If your first deploy failed with “APP_URL is required”

Pull the latest commit and redeploy with the build command `npm run build`. The earlier command ran database setup unconditionally. `.env not found` is normal on Vercel: local secrets are intentionally excluded. Set `APP_URL` to your exact production origin (for example `https://your-project.vercel.app`, without a trailing slash), configure the other variables in the table, and redeploy again to initialize the database. Do not upload `.env` or commit credentials. No secret or initial password is supplied by this repository.

## Authentication and storage

- Better Auth handles password hashing, persisted sessions and login throttling. Session cookies are HTTP-only and SameSite=Lax; HTTPS deployments use Secure cookies.
- Sessions last up to 12 hours and are checked against the database for every protected request; cookie caching is disabled so revocation takes effect immediately.
- Public signup, email changes, password-reset and other account-management endpoints are blocked. The initial owner is seeded only by the setup script, never by a public endpoint.
- Password updates require the current password and force revocation of other sessions, even if a client requests otherwise.
- Mutation endpoints require the exact configured Origin and JSON content type. Plaid mutations additionally require a per-session CSRF token.
- PostgreSQL stores authentication state, rate limits and cached financial records. Plaid access tokens use AES-256-GCM encryption with the environment-provided key. Financial records themselves are not application-encrypted; use your database provider's encryption, access controls and backups.
- `.env*`, `.data/` and `.vercel/` are excluded from Git. The local SQLite directory has restrictive permissions. The app never serves arbitrary filesystem paths.
- The application is **single owner**. Keep OWNER_EMAIL stable. There is no password-recovery email flow; losing the password requires an administrator recovery procedure against the database. Do not set a new INITIAL_PASSWORD expecting it to overwrite an existing password.

The dashboard uses Google Fonts for typography, loads bank logos from Google's website-icon service, and loads Plaid Link when connecting.

**Chat and your data.** When you ask a question on the Chat page, the server sends Anthropic's Claude API a summary of your data (account balances, monthly totals by category, budgets, detected bills, your category rules and the loans you added) plus the transactions returned by searches the model runs. Nothing is sent unless you ask a question and `ANTHROPIC_API_KEY` is set. Transaction descriptions are treated as untrusted data in the prompt. Chat uses Anthropic's server-side refusal fallback (`fallbacks: "default"`), which can retry a declined answer on another Claude model.

**Chat history.** Every conversation is saved automatically to the `chat_conversations` table (created automatically) and listed under History on the Chat page, where you can reopen or delete it. Sample-data and connected-account conversations are kept separately.

**Workspace data.** Loans & IOUs, budgets, category rules, saved views, dashboard layout, pinned answers and chat history are stored as JSON in the `app_state` table of the same database (created automatically). Sample-data mode and connected-accounts mode keep separate copies.

## Plaid setup

Sign in and open **Plaid settings** to save Sandbox and Production credentials independently. Before saving, the server tests the values against that environment's Plaid API. A successful configuration is encrypted with `DATA_ENCRYPTION_KEY`, locked in the interface, and can only be replaced through **Update configuration**. Saved values are never returned to the browser. Validation failures preserve the current configuration and show Plaid's error code, message, and request ID when available. `PLAID_CLIENT_ID` and `PLAID_SECRET` remain supported as a fallback for the environment selected by `PLAID_ENV`.

Use the Sandbox and Production controls in the header to keep test Items and live Items separate. Plaid access tokens, accounts, transactions, connection status, linking and syncing are scoped to the selected environment. Sandbox Items cannot be promoted into Production; connect the live institutions again after Plaid grants Production access.

Click **Connect account** and complete the consent/sign-in flow yourself for each institution. The app requests only Transactions and reads account metadata/cached balances through `/accounts/get`. It has no payment or transfer endpoints. It asks for up to 730 days of history, subject to institution availability. Amex Canada and exact account coverage require verification in live Link.

After connecting, use **Sync accounts**. Initial transaction history may take time; retry later if empty. Sync downloads the latest data Plaid already has and does not force a real-time bank refresh. **Reconnect** restores a connection requiring authentication. OAuth resumes in the same browser tab.

Demo data, sandbox connections and production connections stay separate. Local connected data is not automatically migrated into the hosted database: reconnect banks in the hosted app, or arrange a deliberate migration that preserves the encryption key. Disconnect/revocation currently uses Plaid/bank consent controls; deleting local data does not revoke the upstream connection.

## Importing statements (banks Plaid can't connect)

Some banks block Plaid (for example RBC's newer sign-in verification). For those, open **Settings → Connections → Import statements** and upload the bank's monthly PDF statements, or a ZIP of them (ZIPs inside ZIPs and macOS metadata are handled).

- Supported today: **RBC credit card statements** (Visa/Mastercard PDFs from RBC Online Banking).
- Each statement is parsed on the server and only saved if its transactions add up exactly to the statement's opening and closing balances.
- Transactions are keyed by RBC's reference numbers, so uploading the same or overlapping statements never creates duplicates. A reissued card (new last four digits) stays one account.
- Only parsed transactions, statement totals and the latest balance/limit are stored (table `imported_accounts`); the PDFs are not kept.
- Imported accounts appear everywhere like connected ones (balances, spending, recurring, projections, transactions, chat). Categories come from how Plaid labels the same merchant at your other banks, then a keyword list; anything else shows as "Needs review" and can be fixed with category rules.
- Card payments on the statement are treated as transfers, so paying the card from another bank isn't counted twice.
- Imports are saved under the Plaid environment you're viewing (Production or Sandbox). Use **Remove** on the imported account to delete it.

## Loans, IOUs and savings goals

The Loans & IOUs page tracks four kinds of items, stored in your workspace data (`loans` and `goals`):

- **Loans you're paying back** and **money you lent**. Every field can be edited. A balance you type counts from that day, and later payments reduce it.
- **Payment matching** (`loans.mjs`). The **Name on bank statements** field (who actually takes the payment, e.g. `UPGRADE INC`) is the main signal. When it is filled in, the loan title and lender are ignored, since they are often only for your reference. Matching then uses the monthly amount and, least of all, the day of the month. Transactions are read newest first, so the last 12 months decide the ranking. Description variants from the same lender are grouped into one match. Up to three likely matches are shown. **Check other records** goes through weaker and older candidates three at a time. Nothing is linked until you click **Yes, link these**. When a lender is linked by name, new description variants count automatically. **Not this** hides a suggestion, and you can unlink a single transaction from the payment history. Editing a loan asks whether to **find new matching transactions** (this clears links and hidden matches but keeps payments you recorded yourself) or **keep current**. Changing a matching field selects "find new" by default.
- **Repay someday** covers money with no payment schedule, for example family help. It is not counted as debt. With a "repay by" month, it shows how much to set aside each month.
- **Savings goals** have a target, an amount already saved and an optional date. You can add savings as you go.

- **Example payment.** If matching misses a loan, click **Show an example payment** and pick one transaction you know is a payment. Its description, amount and day become extra signals for the search across all accounts and cards. It is only an example, so you still confirm the matches it finds. Lender payments that banks label "card payment" or "transfer" now qualify when the name matches. Once confirmed, they count as **Loan payments** in your spending, so cash flow isn't understated.
- **Lines of credit** (bank accounts recognised as lines of credit, e.g. ScotiaLine) appear automatically. For each one the page shows the average paid in, drawn and interest per month over the last 6 months, whether the balance is going down, and the monthly payment needed to clear it in 12, 24 or 36 months. The rate is estimated from interest charges, and you can edit it.
- **Debt & stability plan** (the "Debt plan" filter, also at the bottom of "All"). It combines income, spending, cards, lines of credit, loans, goals and cash into ranked steps: close any monthly shortfall (with specific category cuts), pay the highest-rate debt first, stop drawing on lines of credit, keep credit use under 30%, and build a buffer. It also shows a debt-free date for minimums, +$100, +$250 and +$500 a month. Card rates default to 20.99% until you enter the real ones. Chat receives the same summary.

Repay-someday items and goals also appear in the **Plans & goals** card on Overview and in the **Your plans** section on Projections, which compares the monthly amount needed with what you usually keep. Chat sees them too.

## Financial calculations

- Posted CAD transactions only; pending and foreign-currency transactions are excluded from metrics. No FX conversion.
- Positive Plaid amounts are outflows. Only INCOME categories count as income; other negative amounts are refunds unless categorized as transfers.
- Recognized transfers and credit-card payments are excluded to avoid double counting. Non-card loan payments currently count as outflows including principal.
- Savings rate is income less net spending, divided by income; it is not a comprehensive wealth measure.
- Categories can be wrong. Review low-confidence records and reconcile with statements. Recategorize from Transactions (optionally as a rule). PDF statement import is available for RBC credit cards.
- Projections start with CAD depository balances and use average income/spending over the prior three complete calendar months. Each step represents a 30-day month. They require some data in each month but cannot prove completeness. They exclude transfer effects, debt settlement, interest and investment returns; they are scenarios, not bill-due-date forecasts. Account filters affect projections.
- Insights are rule-based observations, not personalized investment or tax advice.

## Read-only VS Code agent adapter

`agent.mjs` offers `finance_summary`, `finance_accounts`, and `finance_transactions`. It requires the running local dashboard **and authentication**. It has no write, payment, transfer, sync or arbitrary SQL tools. It does not receive Plaid credentials.

For VS Code MCP clients supporting the `servers` format, copy `mcp.example.json` to `.vscode/mcp.json`. It prompts for `FINANCE_EMAIL` and a masked `FINANCE_PASSWORD`; do not hardcode passwords. Other clients may require a different configuration format. A password change invalidates the adapter's session; update the password in your client and restart the adapter.

`FINANCE_DATA_MODE=demo` uses sample data; `live` reads the running server's current Plaid environment. Enabling the adapter shares its tool results with your chosen AI agent; cloud-backed agents can send those results to their model provider. Transaction descriptions are untrusted data and must never be treated as instructions. The adapter currently connects only to localhost; no hosted API-key bypass exists.

## Rolling back

Every change ships through GitHub, so earlier versions stay retrievable:

- **Fastest:** in Vercel, open **Deployments**, pick the last good deployment and choose **Instant Rollback** (or **Promote to Production**).
- **In Git:** the last pre-redesign commit on `main` is `1c8eca3` (you can tag it with `git tag pre-redesign-v1 1c8eca3 && git push origin pre-redesign-v1`). To restore it, revert the merge commit on `main` (`git revert -m 1 <merge-sha>`) and push; Vercel redeploys automatically. The new `app_state` table is ignored by older versions, so rolling back is safe.

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
