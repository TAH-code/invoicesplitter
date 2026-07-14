# 💸 Bill Splitter

A tiny full-stack app for splitting shared expenses, Splitwise-style. No setup,
no groups — just type in who's on a bill, itemize it, and the app tracks a
running **pairwise** balance between everyone who's ever shared a bill. Zero
dependencies — just Node.

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
- **Ad-hoc groups** — every bill has its own set of participants, entered fresh.
  The same name (case-insensitively) is treated as the same person across bills.
- **Itemized bills** — each line item is split evenly among its assignees
  (an item with nobody checked is split among everyone). Tax and tip are
  allocated proportionally to each person's share of the items.
- **Grand-total reconciliation** — you enter the receipt total; the form blocks
  saving until items + tax + tip match it (±1¢).
- **Pairwise ledger** — every bill becomes pairwise debts (each non-payer owes
  the payer). Balances are always **derived** by replaying all bills minus all
  settlements, so editing or deleting a bill just recomputes.
- **Partial settle-up** — record a full or partial payment between two people.
- **Multi-currency** — each bill is in its own currency; all balances are shown
  in your configurable **home currency**. Set an exchange rate for each currency
  pair you use in Settings; balances for pairs without a rate are shown at 1:1.
- **Simplify view** — a read-only suggestion of the fewest payments that settle
  everyone.

## How it works
| Part | File |
|---|---|
| Pure calculation logic (the tested core) | `core/split.js` |
| HTTP server + JSON API | `server.js` |
| Frontend (vanilla JS, hash-routed views) | `public/` |
| Saved data | `data/db.json` |
| Tests | `test/split.test.js` |
| Full product spec | `SPEC.md` |

### API
- `GET /api/state` — everything: people, bills, settlements, rates, and derived balances.
- `POST /api/bills`, `PUT /api/bills/:id`, `DELETE /api/bills/:id`
- `POST /api/settlements`, `DELETE /api/settlements/:id`
- `PUT /api/settings` — set the home currency (and optional rate overrides).
- `PUT /api/rates` — set/override a single `FROM->TO` rate.

Bill/settlement writes that need an unknown exchange rate return `409` with a
`needRate` hint; the UI then prompts for a manual rate and retries.

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
