# Dana's Residency — Rental Management (Next.js + cPanel bridge)

```
Next.js (Vercel) ──HTTPS + X-API-Key──▶ database.php (cPanel) ──▶ your existing MySQL DB
```

Vercel never touches MySQL directly. `database.php` is the only thing that does, and it's written
against your **existing** `rxtdhqwu_house_rental_db` database exactly as exported — no new tables,
no renamed columns. See `database-bridge/NOTES.md` for the full column reference.

## 1. cPanel side — nothing to run, just upload

You do **not** need to run any SQL. Just:

1. Upload `database-bridge/database.php` and `.htaccess` into a folder on your cPanel hosting
   (e.g. `public_html/api/database.php`).
2. Copy `database-bridge/config.php.example` → `config.php`, fill in your real `DB_SERVER`,
   `DB_USER`, `DB_PASS`, `DB_NAME`, and a generated `API_KEY` (`openssl rand -hex 32`). Upload it
   next to `database.php` — or, better, one directory above `public_html` (see the comment at the
   top of `database.php` for the one-line path change that requires).
3. Confirm HTTPS is enforced (the `.htaccess` forces it).

That's it — your rooms, tenants, invoices, rent, water readings, `bbilt` payment log, expenses,
and admin accounts are all read/written in place.

## 2. Next.js app — local dev

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:
- `DB_BRIDGE_URL` — the live URL to `database.php` on your cPanel domain
- `DB_BRIDGE_API_KEY` — same value as `API_KEY` in `config.php`
- `NEXTAUTH_SECRET` — `openssl rand -base64 32`
- `NEXTAUTH_URL` — `http://localhost:3000` locally
- `CRON_SECRET` — any long random string (used once deployed)

```bash
npm run dev
```

Log in with one of your existing `master_contral` usernames and its current password — the first
successful login for each account silently upgrades that account's password from MD5 to bcrypt
(see `lib/auth.ts`). Nothing else changes about how login works.

## 3. Deploy to Vercel

Push to a git provider, import into Vercel, add the same env vars from `.env.local` (with
`NEXTAUTH_URL` set to your production URL), and deploy. `vercel.json` defines three cron jobs, all
once-daily so they work on the free Hobby plan: invoice generation (1st), balance close-out
(25th), and a webhook safety-net (`process-webhooks`, daily). Real-time payment reconciliation
does **not** depend on that cron — see §4 below.

## 4. How the money actually moves (as you described it)

1. **1st of the month**: `/api/cron/generate-invoices` runs. One invoice per occupied room:
   `total_amount = monthly_rent + this month's water balance ± last month's carried balance_sheet
   entry` (a stored `+10` reduces this month's total by 10; a stored `-10` increases it by 10).
2. **Reconciling a payment happens immediately, inline in the webhook request itself**
   (`app/api/webhooks/kcb/route.ts`). Storing the raw payload into `webhook_queue` is already
   handled by your existing separate integration — this app doesn't duplicate that write. This
   route just reconciles the payment from the request body the moment it arrives.
   `/api/cron/process-webhooks` still runs once a day (Vercel Hobby plan only allows daily cron
   schedules) purely as a catch-up pass over whatever's sitting in `webhook_queue` with
   `processed = 0` — anything the other integration stored that never reached this route, or where
   reconciliation here failed.
3. **Reconciling a single payment** (`reconcileWebhookPayload` in `lib/invoice-service.ts`):
   - Parse `businessKey` (e.g. `"8043043#M3"`) → room number is whatever's after `#` → look up
     that room's `room_id`.
   - **Amount ≥ KES 5,000** → treated as rent. Applied straight to that room's open invoice for
     the current month: `amount_paid`, `mpesa_code`, `number` get updated, and `status` flips
     `pending → paid` once `amount_paid >= total_amount`.
   - **Amount < KES 5,000** → treated as a water top-up, and the `invoice` row is **not** touched
     at all. Instead: look for an existing `bbilt` row for that room created this month — if one
     exists, add to its `amount_paid` and refresh the mpesa fields; if none exists, insert a new
     one (using the room's water `amount_due` for this month as the target `amount`, if a reading
     exists).
4. **25th of the month**: `/api/cron/close-month` runs. For every invoice generated this month —
   paid or not — it writes/updates that invoice's `balance_sheet` row as `amount_paid -
   total_amount`. This is exactly what step 1 reads next month, so whatever's still outstanding
   (or overpaid) on the 25th is what carries forward.
5. **Dashboard "payments this month"**: sums both payment paths (rent landed on
   `invoice.amount_paid`, water landed on `bbilt.amount_paid`) from the 1st — but the window resets
   to start from the 25th instead, so the figure drops back toward 0 right when the 25th begins,
   per your description, rather than continuing to include the whole month.

## 5. KCB/M-Pesa webhook

Point KCB at `https://<your-domain>/api/webhooks/kcb` (in addition to wherever it already points
for `webhook_queue` storage — this route doesn't replace that, it just reconciles). Your
`webhook_queue` dump shows the real payload shape — the fields we need live at
`requestPayload.additionalData.notificationData.{businessKey, transactionAmt, transactionID,
debitMSISDN}` — and both this route and `lib/invoice-service.ts#processWebhookQueue` unwrap that
automatically. `businessKey` is `"<key>#<room_number>"`, matched against `rooms.room_number`.

**Still worth double-checking against KCB's actual API docs:** the exact ack JSON we return
(`messageID`, `originatorConversationID`, `statusCode`) is inferred from your webhook payload's
`header` block, not from an official KCB spec — confirm it before relying on it in production.

---

## What this rebuild changed vs. the original PHP app, and why

- **SQL injection**: impossible by construction — `database.php` only runs prepared statements
  from an explicit action whitelist; nothing in Next.js ever builds SQL.
- **Passwords**: `master_contral` stays MD5-compatible on read, but every account silently
  upgrades to bcrypt on its next successful login (`lib/auth.ts`). No forced reset, no manual SQL.
- **Auth**: every mutating server action calls `requireSession()`; the whole `(dashboard)` route
  group is also covered by `middleware.ts`. Invoice overrides and admin-user changes additionally
  re-check the current admin's password before running (`verifyCurrentUserPassword`).
- **Water billing**: `area_multipliers` is treated as the single current-rate row your schema
  actually has — there's no dated rate history to preserve, so none was invented.
- **Invoice carry-forward**: read directly from `balance_sheet` (written automatically whenever an
  invoice's status becomes `'paid'`, as `balance = amount_paid - total_amount`), matching the
  convention already present in your data. No new columns added to `invoice`.
- **Webhook reconciliation**: implements your ≥5,000 (rent, applied to `invoice`) / <5,000 (water,
  applied to `bbilt` with find-or-create semantics) split exactly as you described — see §4 above.
  The earlier draft of this rebuild used a single consolidated pipeline with no amount threshold;
  that's been replaced with this rule.
- **25th-of-month close-out**: a new, dedicated cron (`/api/cron/close-month`) that didn't exist
  in the earlier draft — writes `balance_sheet` for every invoice in the month, not just paid
  ones, so unpaid balances correctly carry forward too.
- **Invoice generation**: a real cron job (`/api/cron/generate-invoices`) instead of a side effect
  of loading a page. Idempotent — blocked once invoices exist for a month — and manual
  regeneration is limited to the 1st–15th, matching the original's window.
- **Room ordering**: rooms sort by floor (ground → first → second → third → fourth → other), which
  is a real structural fact about the building; tenants sort by plain `room_number ASC` with no
  hardcoded room-name list.
- **`payments`, `mpesa_payments`, `rent_balances`, `rent_payments`**: confirmed empty/unused, left
  completely untouched.
- **No new tables added.** An audit log for financial overrides was considered and deliberately
  left out to avoid touching your schema — see `database-bridge/NOTES.md` if you want it added
  later; it's a single additive `CREATE TABLE IF NOT EXISTS` away.

## Open questions (my best-effort interpretation — confirm before fully relying on them)

- **`invoice.status = 'waiting'`**: your schema still allows this enum value, but nothing in this
  rebuild ever sets it anymore — per your description, payments are a straight `pending → paid`
  flip once the invoice is covered. If something elsewhere still relies on `'waiting'` being set,
  say so.
- **KCB webhook ack contract** — see §5 above.

## Project structure

```
app/
  (auth)/login/
  (dashboard)/
    dashboard/          counts + recent bbilt payments
    rooms/ tenants/ rent/  CRUD, each with actions.ts
    water-billing/       current rate + meter readings
    invoices/             generation + password-gated overrides
    expenses/             expense logging (expenses table)
    settings/users/       master_contral admin CRUD
  api/
    auth/[...nextauth]/
    webhooks/kcb/          reconciles a payment inline (doesn't write webhook_queue — that's external)
    cron/generate-invoices/
    cron/close-month/       25th-of-month balance_sheet close-out
    cron/process-webhooks/
lib/
  db-bridge.ts           typed client, one method per database.php action
  invoice-service.ts     water billing math, invoice generation, webhook reconciliation
  auth.ts                 NextAuth + MD5→bcrypt auto-upgrade + password re-auth
  validations.ts           Zod schemas
components/ui/             small local component kit
database-bridge/
  database.php             the only file that talks to MySQL — matches your real schema
  NOTES.md                  column reference + what was deliberately left alone
  config.php.example        copy to config.php with real credentials (never commit it)
```
