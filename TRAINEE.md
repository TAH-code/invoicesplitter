# 🧑‍💻 Trainee exercise — Bill Splitter

You'll fix a real bug and open a real pull request on **your own copy** of this project, using Claude Code.

## 1. Get your own copy
- On the repo's GitHub page, click **Use this template → Create a new repository** (this makes it *yours*, with its own history).
- Then clone it and open a terminal in the folder:
  ```bash
  git clone https://github.com/<your-username>/bill-splitter.git
  cd bill-splitter
  ```

## 2. See it run and see the bug
```bash
npm start      # open http://localhost:3000, add "$10 split 3 ways", watch the balances go off by a cent
```
Stop the server (Ctrl+C), then:
```bash
npm test       # one test fails on purpose — that's the bug
```

## 3. Fix issue #1 with Claude
```bash
claude
```
Then ask, in plain English:
> Read issue #1 and fix it. Run the tests when you're done.

Watch Claude find the bug in `core/split.js`, fix the rounding, and the failing test go green.

## 4. Commit and open a pull request
> Create a branch, commit the fix with a clear message, push, and open a pull request describing the fix.

Check your GitHub repo — your PR should be there, with the test now passing.

## 5. Stretch — issue #2 (the feature)
> Implement issue #2 on a new branch, then open a second pull request.

---

**Done when:** the failing test passes, and you've opened at least one PR on your own repo.
