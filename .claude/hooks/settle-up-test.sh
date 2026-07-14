#!/usr/bin/env bash
# Settle-Up Test Bell — a PostToolUse hook.
# When an Edit/Write touches core/ or test/, run the unit tests and report the
# result with the app's own ledger metaphor: green = "everyone's settled up",
# red = "the bill doesn't reconcile".
set -u

input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_response.filePath // empty')

# Only fire for the tested calculation core and its tests.
case "$file" in
  */core/*.js | */test/*.js | core/*.js | test/*.js) ;;
  *) exit 0 ;;
esac

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
out=$(cd "$dir" && npm test 2>&1)

pass=$(printf '%s\n' "$out" | grep -E '^# pass ' | tail -1 | grep -oE '[0-9]+')
fail=$(printf '%s\n' "$out" | grep -E '^# fail ' | tail -1 | grep -oE '[0-9]+')
pass=${pass:-0}
fail=${fail:-0}
total=$((pass + fail))

if [ "$total" -gt 0 ] && [ "$fail" -eq 0 ]; then
  msg="🎉 Everyone's settled up! (${pass}/${total} green)"
else
  msg="⚠️ The bill doesn't reconcile: ${fail} test(s) owe you a fix"
fi

jq -cn --arg m "$msg" '{systemMessage: $m, suppressOutput: true}'
