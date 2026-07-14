const { test } = require("node:test");
const assert = require("node:assert");
const {
  round2,
  nameKey,
  splitAmount,
  reconcileBill,
  computeBillShares,
  billPairwiseDebts,
  getRate,
  computeBalances,
  netPosition,
  simplifyDebts,
} = require("../core/split");

// ---- splitAmount ---------------------------------------------------------

test("splitAmount divides evenly when it can", () => {
  assert.deepStrictEqual(splitAmount(10, 2), [5, 5]);
});

test("splitAmount shares always sum back to the original total", () => {
  const shares = splitAmount(10, 3);
  const total = shares.reduce((a, b) => a + b, 0);
  assert.strictEqual(round2(total), 10);
  assert.deepStrictEqual(shares, [3.34, 3.33, 3.33]);
});

test("splitAmount throws on non-positive n", () => {
  assert.throws(() => splitAmount(10, 0));
});

// ---- nameKey -------------------------------------------------------------

test("nameKey normalizes whitespace and case", () => {
  assert.strictEqual(nameKey("  Alice "), "alice");
  assert.strictEqual(nameKey("ALICE"), nameKey("alice"));
});

// ---- reconcileBill -------------------------------------------------------

test("reconcileBill passes when items + tax + tip equal grandTotal", () => {
  const r = reconcileBill({
    items: [{ amount: 20 }, { amount: 10 }],
    tax: 3,
    tip: 5,
    grandTotal: 38,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.computedTotal, 38);
});

test("reconcileBill fails when totals disagree beyond a cent", () => {
  const r = reconcileBill({ items: [{ amount: 20 }], tax: 0, tip: 0, grandTotal: 25 });
  assert.strictEqual(r.ok, false);
});

test("reconcileBill tolerates a one-cent rounding difference", () => {
  const r = reconcileBill({ items: [{ amount: 10 }], tax: 0, tip: 0, grandTotal: 10.01 });
  assert.strictEqual(r.ok, true);
});

// ---- computeBillShares ---------------------------------------------------

test("computeBillShares splits an item evenly among its assignees", () => {
  const shares = computeBillShares({
    currency: "USD",
    payer: "Alice",
    participants: ["Alice", "Bob"],
    items: [{ label: "Pizza", amount: 20, assignees: ["Alice", "Bob"] }],
    tax: 0,
    tip: 0,
    grandTotal: 20,
  });
  assert.strictEqual(shares.Alice, 10);
  assert.strictEqual(shares.Bob, 10);
});

test("computeBillShares allocates tax/tip proportionally to itemized subtotal", () => {
  // Alice items 30, Bob items 10 (subtotal 40); tax+tip = 8 -> 6 / 2.
  const shares = computeBillShares({
    currency: "USD",
    payer: "Alice",
    participants: ["Alice", "Bob"],
    items: [
      { label: "Steak", amount: 30, assignees: ["Alice"] },
      { label: "Salad", amount: 10, assignees: ["Bob"] },
    ],
    tax: 4,
    tip: 4,
    grandTotal: 48,
  });
  assert.strictEqual(shares.Bob, 12); // 10 + (10/40)*8
  assert.strictEqual(shares.Alice, 36); // remainder (payer absorbs)
});

test("computeBillShares splits an unassigned item among all participants", () => {
  const shares = computeBillShares({
    currency: "USD",
    payer: "Alice",
    participants: ["Alice", "Bob", "Carol"],
    items: [{ label: "Shared", amount: 30, assignees: [] }],
    tax: 0,
    tip: 0,
    grandTotal: 30,
  });
  assert.strictEqual(shares.Bob, 10);
  assert.strictEqual(shares.Carol, 10);
  assert.strictEqual(shares.Alice, 10);
});

test("computeBillShares gives a zero-item participant nothing", () => {
  const shares = computeBillShares({
    currency: "USD",
    payer: "Alice",
    participants: ["Alice", "Bob", "Carol"],
    items: [{ label: "Beer", amount: 20, assignees: ["Alice", "Bob"] }],
    tax: 0,
    tip: 0,
    grandTotal: 20,
  });
  assert.strictEqual(shares.Carol, 0);
});

test("computeBillShares: payer absorbs leftover cents so shares sum to total", () => {
  const shares = computeBillShares({
    currency: "USD",
    payer: "Alice",
    participants: ["Alice", "Bob", "Carol"],
    items: [{ label: "Split", amount: 10, assignees: ["Alice", "Bob", "Carol"] }],
    tax: 0,
    tip: 0,
    grandTotal: 10,
  });
  const sum = round2(shares.Alice + shares.Bob + shares.Carol);
  assert.strictEqual(sum, 10);
});

// ---- billPairwiseDebts ---------------------------------------------------

test("billPairwiseDebts: every non-payer owes the payer their share", () => {
  const debts = billPairwiseDebts({
    currency: "USD",
    payer: "Alice",
    participants: ["Alice", "Bob"],
    items: [{ label: "Lunch", amount: 20, assignees: ["Alice", "Bob"] }],
    tax: 0,
    tip: 0,
    grandTotal: 20,
  });
  assert.deepStrictEqual(debts, [{ from: "Bob", to: "Alice", amount: 10 }]);
});

// ---- getRate -------------------------------------------------------------

test("getRate handles identity, direct, and inverse", () => {
  const rates = { "EUR->USD": 1.1 };
  assert.strictEqual(getRate(rates, "USD", "USD"), 1);
  assert.strictEqual(getRate(rates, "EUR", "USD"), 1.1);
  assert.strictEqual(round2(getRate(rates, "USD", "EUR")), 0.91);
  assert.strictEqual(getRate(rates, "GBP", "USD"), null);
});

// ---- computeBalances -----------------------------------------------------

test("computeBalances: single bill yields one pairwise debt", () => {
  const { pairs, perPerson } = computeBalances({
    homeCurrency: "USD",
    rates: {},
    settlements: [],
    bills: [
      {
        id: 1,
        currency: "USD",
        payer: "Alice",
        participants: ["Alice", "Bob"],
        items: [{ label: "Lunch", amount: 20, assignees: ["Alice", "Bob"] }],
        tax: 0,
        tip: 0,
        grandTotal: 20,
      },
    ],
  });
  assert.deepStrictEqual(pairs, [{ debtor: "Bob", creditor: "Alice", amount: 10 }]);
  assert.strictEqual(perPerson.Alice, 10);
  assert.strictEqual(perPerson.Bob, -10);
});

test("computeBalances: bills across different groups feed shared pairs", () => {
  const mkBill = (id, participants) => ({
    id,
    currency: "USD",
    payer: "Alice",
    participants,
    items: [{ label: "Meal", amount: 10 * participants.length, assignees: participants }],
    tax: 0,
    tip: 0,
    grandTotal: 10 * participants.length,
  });
  const { pairs } = computeBalances({
    homeCurrency: "USD",
    rates: {},
    settlements: [],
    bills: [mkBill(1, ["Alice", "Bob"]), mkBill(2, ["Alice", "Bob", "Carol"])],
  });
  const ab = pairs.find((p) => p.debtor === "Bob" && p.creditor === "Alice");
  const ac = pairs.find((p) => p.debtor === "Carol" && p.creditor === "Alice");
  assert.strictEqual(ab.amount, 20); // $10 from each bill
  assert.strictEqual(ac.amount, 10);
});

test("computeBalances: a settlement reduces the pair balance", () => {
  const bill = {
    id: 1,
    currency: "USD",
    payer: "Alice",
    participants: ["Alice", "Bob"],
    items: [{ label: "Lunch", amount: 20, assignees: ["Alice", "Bob"] }],
    tax: 0,
    tip: 0,
    grandTotal: 20,
  };
  const { pairs } = computeBalances({
    homeCurrency: "USD",
    rates: {},
    bills: [bill],
    settlements: [{ id: 1, from: "Bob", to: "Alice", amount: 4, currency: "USD" }],
  });
  assert.deepStrictEqual(pairs, [{ debtor: "Bob", creditor: "Alice", amount: 6 }]);
});

test("computeBalances: settling in full zeroes the pair", () => {
  const bill = {
    id: 1,
    currency: "USD",
    payer: "Alice",
    participants: ["Alice", "Bob"],
    items: [{ label: "Lunch", amount: 20, assignees: ["Alice", "Bob"] }],
    tax: 0,
    tip: 0,
    grandTotal: 20,
  };
  const { pairs } = computeBalances({
    homeCurrency: "USD",
    rates: {},
    bills: [bill],
    settlements: [{ id: 1, from: "Bob", to: "Alice", amount: 10, currency: "USD" }],
  });
  assert.deepStrictEqual(pairs, []);
});

test("computeBalances: converts foreign currency to home currency", () => {
  const { pairs } = computeBalances({
    homeCurrency: "USD",
    rates: { "EUR->USD": 1.1 },
    settlements: [],
    bills: [
      {
        id: 1,
        currency: "EUR",
        payer: "Alice",
        participants: ["Alice", "Bob"],
        items: [{ label: "Lunch", amount: 20, assignees: ["Alice", "Bob"] }],
        tax: 0,
        tip: 0,
        grandTotal: 20,
      },
    ],
  });
  assert.deepStrictEqual(pairs, [{ debtor: "Bob", creditor: "Alice", amount: 11 }]); // 10 EUR * 1.1
});

test("computeBalances: reports missing rates and falls back to 1:1", () => {
  const { pairs, missingRates } = computeBalances({
    homeCurrency: "USD",
    rates: {},
    settlements: [],
    bills: [
      {
        id: 1,
        currency: "GBP",
        payer: "Alice",
        participants: ["Alice", "Bob"],
        items: [{ label: "Lunch", amount: 20, assignees: ["Alice", "Bob"] }],
        tax: 0,
        tip: 0,
        grandTotal: 20,
      },
    ],
  });
  assert.deepStrictEqual(missingRates, [{ from: "GBP", to: "USD" }]);
  assert.strictEqual(pairs[0].amount, 10); // 1:1 placeholder
});

test("computeBalances: names are matched case-insensitively across bills", () => {
  const mk = (payer, other) => ({
    id: 1,
    currency: "USD",
    payer,
    participants: [payer, other],
    items: [{ label: "x", amount: 20, assignees: [payer, other] }],
    tax: 0,
    tip: 0,
    grandTotal: 20,
  });
  const { pairs } = computeBalances({
    homeCurrency: "USD",
    rates: {},
    settlements: [],
    bills: [mk("Alice", "Bob"), mk("alice", "bob")],
  });
  // Same two people despite case differences -> one merged pair of $20.
  assert.strictEqual(pairs.length, 1);
  assert.strictEqual(pairs[0].amount, 20);
});

// ---- simplifyDebts -------------------------------------------------------

test("simplifyDebts collapses a chain A->B->C into A->C", () => {
  // A owes 10 (net -10), C is owed 10 (net +10), B is even.
  const transfers = simplifyDebts({ A: -10, B: 0, C: 10 });
  assert.deepStrictEqual(transfers, [{ from: "A", to: "C", amount: 10 }]);
});

test("simplifyDebts balances multiple debtors and creditors", () => {
  const transfers = simplifyDebts({ A: -30, B: -10, C: 25, D: 15 });
  const paid = {};
  const got = {};
  for (const t of transfers) {
    paid[t.from] = round2((paid[t.from] || 0) + t.amount);
    got[t.to] = round2((got[t.to] || 0) + t.amount);
  }
  assert.strictEqual(paid.A, 30);
  assert.strictEqual(paid.B, 10);
  assert.strictEqual(got.C, 25);
  assert.strictEqual(got.D, 15);
});

// ---- netPosition ---------------------------------------------------------

test("netPosition: positive net reads as owed", () => {
  assert.deepStrictEqual(netPosition({ Ana: 42.5, Bob: -42.5 }, "Ana"), {
    net: 42.5,
    status: "owed",
    amount: 42.5,
  });
});

test("netPosition: negative net reads as owes with positive amount", () => {
  assert.deepStrictEqual(netPosition({ Ana: 42.5, Bob: -42.5 }, "Bob"), {
    net: -42.5,
    status: "owes",
    amount: 42.5,
  });
});

test("netPosition: matches names case- and whitespace-insensitively", () => {
  assert.strictEqual(netPosition({ Ana: 10 }, "  ana ").status, "owed");
});

test("netPosition: sub-cent balances and unknown names read as settled", () => {
  assert.deepStrictEqual(netPosition({ Ana: 0.004 }, "Ana"), { net: 0, status: "settled", amount: 0 });
  assert.deepStrictEqual(netPosition({ Ana: 10 }, "Zoe"), { net: 0, status: "settled", amount: 0 });
  assert.strictEqual(netPosition({}, "Ana").status, "settled");
});
