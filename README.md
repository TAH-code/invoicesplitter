# 💸 BillMe

A tiny full-stack app for splitting shared expenses, Splitwise-style. No
setup, no groups — add people, log an expense and who it's split between, and
the app tracks a running **pairwise** balance between everyone who's ever
shared an expense. Zero dependencies — just Node.

## Run it
```bash
npm start
```
Then open **http://localhost:3000**.

## Test it
```bash
npm test
```

## What it does
- **One page** — add people, log an expense (description, who paid, amount,
  who it's split between), see everyone's balance and the expense feed, all
  in one view. The same name (case-insensitively) is treated as the same
  person across expenses.
- **Even split only** — each expense is split evenly among the people checked
  under "Split between" (defaults to everyone).
- **Pairwise ledger** — every expense becomes pairwise debts (each non-payer
  owes the payer). Balances are always **derived** by replaying all expenses,
  so deleting one just recomputes.
- **Settle Up summary** — a card per person showing whether they're owed
  money, owe money, or are settled up.

The pure calculation core (`core/split.js`) still supports itemized bills,
tax/tip, multi-currency and debt-simplification — the API and tests exercise
that surface — but this UI intentionally sticks to the simple, single-page
flow above.

## How it works
| Part | File |
|---|---|
| Pure calculation logic (the tested core) | `core/split.js` |
| HTTP server + JSON API | `server.js` |
| Frontend (single-page vanilla JS) | `public/` |
| Saved data | `data/db.json` |
| Tests | `test/split.test.js` |
| Full product spec | `SPEC.md` |

### API
- `GET /api/state` — everything: people, bills, settlements, rates, and derived balances.
- `POST /api/people` — register a person with no expense yet.
- `POST /api/bills`, `PUT /api/bills/:id`, `DELETE /api/bills/:id`
- `POST /api/settlements`, `DELETE /api/settlements/:id`
- `PUT /api/settings` — set the home currency (and optional rate overrides).
- `PUT /api/rates` — set/override a single `FROM->TO` rate.

Bill/settlement writes that need an unknown exchange rate return `409` with a
`needRate` hint (not triggered by the current UI, which always posts in the
home currency).

## Requirements
Node.js 18+ (uses the built-in test runner, so nothing to install).

## Deploy
The app runs anywhere Node does. Persistence is auto-detected (`store.js`):
- **Local / persistent hosts** — reads/writes `data/db.json`.
- **Vercel / serverless** — if `BLOB_READ_WRITE_TOKEN` is set, the whole DB is
  stored as a single JSON object in Vercel Blob (`@vercel/blob`).

On Vercel, all requests are routed to a single function (`api/index.js` → the
shared request handler) per `vercel.json`. Add the Vercel Blob integration so
`BLOB_READ_WRITE_TOKEN` is present, or data won't persist.
