# Bill Splitter — Spec

## Audience
Fully dynamic, ad-hoc groups — Splitwise-style. There is no fixed household or
saved group. Every bill has its own set of participants, entered fresh each
time (roommates one day, a trip group the next, a couple another — same app,
no setup step). People are identified by name; the same name reused across
bills is treated as the same person, and balances accumulate pairwise across
everyone's shared history.

## Scope
Full-featured build (itemized bills, tax/tip allocation, multi-currency,
persistent pairwise ledger with partial settle-up, debt-simplification view).
New web app built on the existing project layout (`core/`, `server.js`,
`public/`).

---

## Core concepts

### Participants
- No persistent "household" or named group entity.
- A bill is created by typing in whoever's participating.
- **Name identity — normalized:** names are matched by trimming surrounding
  whitespace and comparing case-insensitively. `alice`, `Alice `, and `Alice`
  all resolve to the same person. The **first-seen display form** is stored and
  shown thereafter.
- The bill form should suggest/autocomplete already-known names so people
  reuse rather than retype (reduces accidental duplicates on top of
  normalization).

### Bills
A bill has:
- `date`
- `description`
- `currency` (the currency the bill was actually paid in)
- exactly one `payer` (one person who fronted the money; must be a participant)
- a list of **line items**
- a `tax` amount and a `tip` amount (both in the bill's currency)
- a `grandTotal` (entered by the user, used for reconciliation — see below)

Each **line item** has:
- `label`
- `amount` (in the bill's currency)
- a set of `assignees` — the participants who share that item, split **evenly**
  among them.

**Empty item (no assignees):** an item with zero assignees checked is split
**evenly among all participants on the bill**. (It is not blocked, and it does
not fall solely on the payer.)

**Participant on zero items:** allowed. If every item they could be on is
assigned to others, they simply owe nothing (and receive no tax/tip share,
except any share flowing from unassigned "split-among-all" items).

**Grand-total reconciliation:** the user enters the receipt's grand total. On
save, the form validates that `sum(item amounts) + tax + tip` equals the
entered grand total within a small rounding tolerance (±0.01 in the bill's
currency). On mismatch, the save is blocked with a clear message showing the
computed total vs. the entered total, so data-entry mistakes are caught before
they hit the ledger.

**Editing / deleting:** bills can be edited or deleted after creation. See
"Recompute from scratch" below for how that affects balances.

### Splitting logic
Per participant on a bill:
- **Item share:** for each item they're an assignee of (including
  split-among-all items), add `item.amount / number_of_assignees`.
- **Tax + tip share:** tax and tip are allocated **proportionally** to each
  participant's share of the itemized subtotal (not split evenly). A
  participant with 0 itemized subtotal gets 0 tax/tip.
- Each non-payer owes the payer their total share. The payer is owed the sum of
  everyone else's shares.

**Rounding:** round to 2 decimals for display and storage. Leftover cents from
uneven splits go to the payer.

---

## Ledger — pairwise, derived, always in home currency

### Pairwise decomposition
Every bill decomposes into pairwise debts: for each non-payer participant, they
owe the payer their share. That debt is added to the running balance between
that specific pair, regardless of who else was on the bill.
- A `{Alice, Bob}` dinner and a `{Alice, Bob, Carol}` dinner both feed the same
  Alice↔Bob balance; the second also feeds Alice↔Carol and Bob↔Carol.

### Balances are derived, not stored (recompute from scratch)
The source of truth is the list of **bills** plus the list of **settlements**.
Pairwise balances are **always computed by replaying all bills minus all
settlements** — they are never persisted as mutable running totals.
- Editing or deleting a bill simply changes the inputs; balances are recomputed.
- **Consequence (accepted):** editing or deleting an old bill can "reopen" a
  balance that was previously settled. This is the deliberate trade-off for
  always-consistent, simple-to-reason-about balances.

### Currency: always the current home currency
- Home currency is configurable on a settings screen and can be changed at any
  time.
- **Every bill and every settlement is stored in its own native currency**
  (amounts are never rewritten). All balances are computed by converting each
  bill/settlement into the **current** home currency at compute time.
- Therefore, changing the home-currency setting **retroactively re-denominates
  every balance** into the new home currency. There is no per-pair "frozen"
  historical currency — one number per pair, in today's home currency.
- This requires an exchange rate from every used currency → the current home
  currency (see Exchange rates).

### Per-person net
A person's overall "net owed" (at-a-glance) is the sum of their balances across
all pairs they're part of, in the home currency. Positive = net owed to them;
negative = net they owe.

### Settle up — partial allowed
- A settle-up records a payment from one person to another for a pair.
- **Partial payments are supported:** e.g. paying 30 of 50 owed reduces that
  pair's balance by 30. Settling the full outstanding amount zeroes it.
- Each settlement is stored with `{ from, to, amount, currency, date }` in its
  native currency and converted to the current home currency like bills.

### Simplify-debts view (read-only)
In addition to the raw pairwise balances, the app offers a **read-only
"suggested payments to settle everything" view** that minimizes the number of
transfers across all people (e.g. if A owes B and B owes C, suggest A pays C).
- This is a suggestion layer only; the underlying ledger stays strictly
  pairwise and is unchanged by viewing it. Actual settle-ups are still recorded
  against real pairs.

---

## Exchange rates
- Multi-currency bills are supported.
- Rates are fetched server-side via Node's built-in `fetch` from a free,
  no-API-key endpoint (e.g. exchangerate-api.com's open endpoint). **No new npm
  dependency, no secret to manage.**
- Rates (fetched values and manual overrides alike) are **cached on disk**
  alongside the JSON store, keyed by `FROM->TO`.
- **Resolution order** when a conversion is needed:
  1. A **stored rate wins** — a manual override or a previously-fetched value is
     used as-is and is never silently clobbered (so overrides stick and balances
     don't drift on every page load).
  2. No stored rate → **fetch live once** and cache it.
  3. Fetch fails and nothing stored (first-ever use of that pair, or offline) →
     **prompt for a manual rate.**
- **Manual rate entry — both places:**
  - **Inline in the bill form:** if saving a bill needs a rate that isn't
    available, the form surfaces a rate input before the bill can be saved.
  - **Settings overrides table:** an editable table of rates per currency pair
    for setting/correcting rates later. Bill entry uses whatever's stored.
- Because balances reconvert to the current home currency, changing the home
  currency may require rates for pairs never previously converted; the same
  fallback/manual-entry flow applies.

---

## Storage
- A single JSON file on disk (e.g. `data/db.json`). No database dependency;
  fits the project's zero-dependency style.
- Persists:
  - `homeCurrency` setting
  - `bills` (full item/assignee/tax/tip/grandTotal detail, for edit support)
  - `settlements` (from, to, amount, currency, date)
  - people registry (normalized key → first-seen display name)
  - manual/override + last-successfully-fetched rate per currency pair
- Note: pairwise balances are **not** stored — they are derived on read.

---

## Auth
None. Single trusted app, no login, no accounts.

---

## UI / views

**Landing view: Add a Bill** — the most frequent action opens first.

Views:
1. **Add / edit bill (home)** — participant entry (with name autocomplete),
   currency, payer selector, line items with a **checkbox per participant per
   item** for assignees, tax, tip, grand-total field with live reconciliation
   feedback, and an inline manual-rate prompt when required.
2. **Balances dashboard** — per-person net owed and the list of pairwise
   balances (all in home currency), with settle-up (incl. partial) actions;
   plus access to the read-only **simplify** view.
3. **Person detail** — click a person to see their overall net and all their
   pairwise balances in one place.
4. **Pair detail** — click a pairwise balance to see every bill + settlement
   that contributed to it, with settle-up from there.
5. **Settings** — home currency selector and the exchange-rate overrides table.
6. **Bill list (functional)** — a browsable list of bills is included because
   edit/delete require a way to reach a bill; kept low-prominence (not a primary
   landing surface). Bills are also reachable via pair detail.

---

## Architecture / file layout
Follows project conventions (see CLAUDE.md):
- `core/split.js` — pure calculation logic (item shares, proportional tax/tip,
  pairwise decomposition, balance recompute from bills+settlements, per-person
  net, debt-simplification algorithm, rounding with leftover-cents-to-payer).
  Covered by tests in `test/`.
- `server.js` — zero-dependency Node HTTP server: JSON API (CRUD bills,
  settlements, settings, rates), rate fetching/caching via `fetch`, JSON-file
  persistence; also serves the frontend.
- `public/` — vanilla-JS frontend (`index.html`, `app.js`, `style.css`)
  implementing the views above.

---

## Resolved ambiguities (interview decisions)
- **Audience:** ad-hoc / Splitwise-style dynamic groups.
- **Scope:** full-featured, per this spec.
- **Edits & ledger:** recompute balances from scratch (settled balances may
  reopen on edit — accepted).
- **Pair currency:** always the current home currency; historical bills
  reconvert.
- **Settle-up:** partial payments allowed.
- **Empty item:** split evenly among all participants.
- **Grand total:** reconcile items + tax + tip against an entered grand total
  (±0.01 tolerance; block on mismatch).
- **Name identity:** normalize (trim + case-insensitive; store first-seen form)
  with autocomplete of known names.
- **Manual rate:** both inline (bill form) and a settings overrides table.
- **Simplify debts:** offer a read-only simplify view; ledger stays pairwise.
- **Home view:** Add-a-bill.
- **Detail views:** person detail and pair detail (plus a functional bill list
  for edit/delete).

## Out of scope (explicitly not building)
- Per-user login / accounts.
- Multi-payer bills (splitting who fronted the money across >1 payer per bill).
- Receipt photo / OCR import.
- Push notifications / reminders.
- Saved/named groups or a fixed household entity.
