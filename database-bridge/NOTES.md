# No schema.sql here — you already have one

`database.php` in this folder is written against your existing
`rxtdhqwu_house_rental_db` database exactly as you exported it. Nothing in
this rebuild creates, renames, or migrates a single table. You do **not**
need to run any SQL against your database to use this bridge.

The only genuinely new thing, and it's optional: your `master_contral`
passwords are stored as MD5 hashes. `lib/auth.ts` on the Next.js side
handles this itself (verifies the old MD5 hash on login, then silently
rewrites that row to a bcrypt hash via the existing `updateUser` action) —
no manual SQL step needed for that either.

If you ever want an audit trail of who marked what paid, that would need one
small additive table (`audit_log`) that doesn't exist today. This rebuild
does NOT add it, to avoid touching your schema at all — the invoice/user
override actions still require the admin's password to be re-entered before
they run, same protection as before, just without a persistent log. Say the
word if you want that table added later; it's one `CREATE TABLE IF NOT
EXISTS` and nothing else changes.

## Column names this bridge relies on (for reference — matches your dump)

- `rooms(room_id, room_number, floor_number)`
- `tenants(tenant_id, room_id NOT NULL, tenant_name, phone_number, ID_number)`
- `tenant_admission(admission_id, tenant_id, admission_date)`
- `rent_amounts(rent_id, room_id, monthly_rent)` — no UNIQUE on room_id, so
  the bridge does a check-then-write instead of `ON DUPLICATE KEY UPDATE`
- `area_multipliers(multiplier_id, cost_per_unit)` — treated as a single
  settings row (your schema has no effective-date history for this)
- `areas(area_id, room_id, month, area_type, units_used)`
- `area_balances(balance_id, area_id, amount_due, amount_paid)`
- `invoice(invoice_id, invoice_month, status['pending'|'paid'|'waiting'], room_id, tenant_id NULLABLE, monthly_rent, area_balance, total_amount, created_at, mpesa_code, number, amount_paid, updated_at)`
- `balance_sheet(id, invoice_id, balance, created_at, status)` — written
  automatically whenever an invoice's status becomes 'paid'; `balance =
  amount_paid - total_amount`, matching your existing data
- `bbilt(id, room_number, amount, amount_paid, mpesa_number, mpesa_code, created_at)`
  — the live payment log; `payments`, `mpesa_payments`, `rent_balances`,
  `rent_payments` are untouched (empty in your dump)
- `master_contral(id, username, password)`
- `expenses(expense_id, expense_name, amount, expense_date)`
- `webhook_queue(id, request_data, processed, created_at, processed_at)`
