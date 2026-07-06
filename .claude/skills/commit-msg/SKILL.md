---
name: commit-msg
description: Use when the user asks to write, format, or improve a git commit message. Produces Conventional Commits format.
---

# Commit Message Writer

When asked to write a commit message:
1. Use Conventional Commits: `type(scope): short summary` in the imperative mood.
   Types: feat, fix, refactor, docs, chore, test, perf, build, ci.
2. Keep the summary line under 60 characters.
3. Add a blank line, then 1-3 bullet points explaining what changed and why.
4. If it is a breaking change, add a `BREAKING CHANGE:` footer.
