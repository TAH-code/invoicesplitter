# 💸 Bill Splitter

A tiny full-stack app for splitting shared expenses: add people, log who paid for what, and see who owes whom. Zero dependencies — just Node.

## Run it
```bash
npm start
```
Then open **http://localhost:3000**.

## Test it
```bash
npm test
```

> ⚠️ **One test fails on purpose.** `splitAmount shares always sum back to the original total` is the bug described in **issue #1** (`ISSUES.md`). It's the target of the training session — leave it failing until then.

## How it works
| Part | File |
|---|---|
| Pure calculation logic (the tested core) | `core/split.js` |
| HTTP server + JSON API | `server.js` |
| Frontend (vanilla JS) | `public/` |
| Saved data | `data/expenses.json` |
| Tests | `test/split.test.js` |
| Shared Claude Code permissions | `.claude/settings.json` |

The API: `GET /api/state`, `POST /api/people`, `POST /api/expenses`, `DELETE /api/expenses/:id`.

## Requirements
Node.js 18+ (uses the built-in test runner, so nothing to install).

## Where to go next
- `ISSUES.md` — two ready-to-work issues (one bug, one feature).
- `TRAINEE.md` — the hands-on exercise.
- Idea for later: a "settle-up plan" that turns balances into the fewest payments (who pays whom).
