---
name: add-feature
description: Use when adding a new feature or capability to this project — a new endpoint, UI control, or calculation. Enforces the project's add-a-feature checklist.
---

# Add a Feature to Bill Splitter

When adding a feature, follow this order so the codebase stays consistent:

1. **Logic first.** Put any pure calculation as a small function in `core/` — no I/O, no DOM.
2. **Test it.** Add a test in `test/` following the style in `test/split.test.js`, and run `npm test`.
3. **Wire it up.** Add the API route in `server.js` if needed, then the UI in `public/app.js` and `public/style.css`.
4. **Document it.** Update `README.md` if user-facing behavior changed.
5. **Keep it small** and make sure `npm test` passes before finishing.
