# Bill Splitter — project conventions for Claude

## What this is
A tiny full-stack expense splitter with three parts:
- `server.js` — a zero-dependency Node HTTP server (API + serves the frontend)
- `public/` — a vanilla-JS frontend (`index.html`, `app.js`, `style.css`)
- `core/split.js` — the pure calculation logic that the tests in `test/` cover

## Git conventions
- Branch naming: `feat/short-description`, `fix/issue-number-description`
- Commits: Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`)
- Never commit directly to `main`; always use a feature branch
- Run `npm test` before every commit; don't commit failing tests

## How we add a feature here
1. Put pure logic in `core/` and cover it with a test in `test/`.
2. Wire it into the API in `server.js` and the UI in `public/`.
3. Update the README if user-facing behavior changes.

## Run / test
- `npm start` → http://localhost:3000
- `npm test` → runs the unit tests (Node's built-in runner, no install needed)
