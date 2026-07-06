# Issues to create on GitHub

Copy each block into a new GitHub issue (**Issues → New issue**). Note the numbers — the session refers to "issue #1" and "issue #2."

---

## Issue #1 (bug) — Splitting an amount can be off by a penny

**Title:** `Bug: split amounts don't add back up to the total`

**Body:**

When an expense doesn't divide evenly, the per-person shares are each rounded independently, so they don't sum back to the original amount.

**Steps to reproduce**
1. Start the app (`npm start`).
2. Add an expense of **$10** split between **3 people**.
3. Look at "Settle up" — the balances are off by a cent (they sum to $0.01 instead of $0).

**Expected:** the shares always add up to exactly the expense total.

**Where:** `core/split.js` → `splitAmount()`. There's a failing test for this in `test/split.test.js` (`splitAmount shares always sum back to the original total`).

---

## Issue #2 (feature) — Filter the expense list by who paid

**Title:** `Feature: filter expenses by payer`

**Body:**

Add a way to filter the expense list to only show expenses paid by a chosen person.

**Requirements**
- Add a small pure helper in `core/` (e.g. `filterByPayer(expenses, payer)`) with a test in `test/`.
- Add a dropdown above the expense list in the UI to pick a payer (plus an "Everyone" option).
- Selecting a payer filters the list; "Everyone" shows all.

**Follows the project's add-a-feature checklist** (see `.claude/skills/add-feature/`): logic in `core/` → test → wire into `server.js`/`public/` → update README.
