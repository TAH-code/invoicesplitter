const { test } = require("node:test");
const assert = require("node:assert");
const { splitAmount, settleUp } = require("../core/split");

test("splitAmount divides evenly when it can", () => {
  assert.deepStrictEqual(splitAmount(10, 2), [5, 5]);
});

test("splitAmount shares always sum back to the original total", () => {
  const shares = splitAmount(10, 3);
  const total = shares.reduce((a, b) => a + b, 0);
  assert.strictEqual(Math.round(total * 100) / 100, 10);
});

test("settleUp: the payer is owed by the others (even split)", () => {
  const balances = settleUp(
    ["Sam", "Alex"],
    [{ id: 1, description: "Lunch", payer: "Sam", amount: 20, participants: ["Sam", "Alex"] }]
  );
  assert.strictEqual(balances.Sam, 10);
  assert.strictEqual(balances.Alex, -10);
});

test("settleUp: balances net to zero with even splits", () => {
  const balances = settleUp(
    ["Sam", "Alex", "Jordan"],
    [{ id: 1, description: "Pizza", payer: "Sam", amount: 30, participants: ["Sam", "Alex", "Jordan"] }]
  );
  const sum = Object.values(balances).reduce((a, b) => a + b, 0);
  assert.strictEqual(Math.round(sum * 100) / 100, 0);
});
