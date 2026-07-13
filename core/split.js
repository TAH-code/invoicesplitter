// Pure calculation logic for Bill Splitter.
// No I/O, no DOM — this is what the tests in /test cover.
//
// Data shapes (see SPEC.md):
//   bill = {
//     id, date, description, currency, payer,
//     participants: [displayName, ...],
//     items: [{ label, amount, assignees: [displayName, ...] }, ...],
//     tax, tip, grandTotal
//   }
//   settlement = { id, from, to, amount, currency, date }
//   rates = { "EUR->USD": 1.08, ... }   // 1 unit of FROM = N units of TO
//   state = { bills, settlements, rates, homeCurrency }

const CENT = 0.01;

/** Round to 2 decimals (cents). */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Normalized identity key for a person's name: trimmed + case-insensitive. */
function nameKey(name) {
  return String(name == null ? "" : name).trim().toLowerCase();
}

/**
 * Split `total` into `n` equal shares (dollars, rounded to cents) that always
 * sum back to `total`. Any leftover cents are spread one-per-share across the
 * first shares, so e.g. splitAmount(10, 3) -> [3.34, 3.33, 3.33] (sums to 10).
 */
function splitAmount(total, n) {
  if (n <= 0) throw new Error("n must be a positive number");
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / n);
  let remainder = totalCents - base * n; // cents to hand out one at a time
  const shares = [];
  for (let i = 0; i < n; i++) {
    const cents = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    shares.push(cents / 100);
  }
  return shares;
}

/**
 * Reconcile a bill: does sum(items) + tax + tip equal the entered grandTotal
 * (within a 1-cent tolerance)? Returns { ok, computedTotal, grandTotal }.
 */
function reconcileBill(bill) {
  const itemsTotal = (bill.items || []).reduce((s, it) => s + Number(it.amount || 0), 0);
  const computedTotal = round2(itemsTotal + Number(bill.tax || 0) + Number(bill.tip || 0));
  const grandTotal = round2(Number(bill.grandTotal || 0));
  return { ok: Math.abs(computedTotal - grandTotal) <= CENT + 1e-9, computedTotal, grandTotal };
}

/**
 * Compute each participant's share of a single bill, in the bill's currency.
 * Returns { [displayName]: shareAmount } rounded to cents.
 *
 * - Each item is split evenly among its assignees; an item with no assignees
 *   is split evenly among all participants.
 * - Tax + tip are allocated proportionally to each person's itemized subtotal
 *   (if the subtotal is 0 but tax/tip exist, they split evenly).
 * - Leftover cents from rounding are absorbed by the payer (the payer's share
 *   is whatever remains after the others' rounded shares).
 */
function computeBillShares(bill) {
  const participants = bill.participants || [];
  const subtotal = {}; // display -> itemized subtotal
  for (const p of participants) subtotal[p] = 0;

  let itemizedTotal = 0;
  for (const item of bill.items || []) {
    const amount = Number(item.amount || 0);
    itemizedTotal += amount;
    const assignees = item.assignees && item.assignees.length ? item.assignees : participants;
    if (!assignees.length) continue;
    const per = amount / assignees.length;
    for (const a of assignees) {
      if (!(a in subtotal)) subtotal[a] = 0;
      subtotal[a] += per;
    }
  }

  const taxTip = Number(bill.tax || 0) + Number(bill.tip || 0);
  const raw = {}; // display -> unrounded total share
  for (const p of Object.keys(subtotal)) {
    let taxTipShare = 0;
    if (taxTip !== 0) {
      taxTipShare = itemizedTotal > 0
        ? (subtotal[p] / itemizedTotal) * taxTip
        : taxTip / (participants.length || 1);
    }
    raw[p] = subtotal[p] + taxTipShare;
  }

  // Round non-payers; the payer absorbs the leftover cents.
  const total = round2(itemizedTotal + taxTip);
  const shares = {};
  let othersSum = 0;
  for (const p of Object.keys(raw)) {
    if (nameKey(p) === nameKey(bill.payer)) continue;
    shares[p] = round2(raw[p]);
    othersSum += shares[p];
  }
  if (bill.payer != null) shares[bill.payer] = round2(total - othersSum);
  return shares;
}

/**
 * Decompose a bill into pairwise debts (in the bill's currency): every
 * non-payer owes the payer their share. Returns [{ from, to, amount }].
 */
function billPairwiseDebts(bill) {
  const shares = computeBillShares(bill);
  const debts = [];
  for (const [person, amount] of Object.entries(shares)) {
    if (nameKey(person) === nameKey(bill.payer)) continue;
    if (round2(amount) === 0) continue;
    debts.push({ from: person, to: bill.payer, amount: round2(amount) });
  }
  return debts;
}

/**
 * Look up a conversion rate FROM -> TO. Returns a number or null if unknown.
 * Handles identity and inverse (uses 1/rate if only the reverse pair exists).
 */
function getRate(rates, from, to) {
  if (from === to) return 1;
  const direct = rates && rates[`${from}->${to}`];
  if (typeof direct === "number" && direct > 0) return direct;
  const inverse = rates && rates[`${to}->${from}`];
  if (typeof inverse === "number" && inverse > 0) return 1 / inverse;
  return null;
}

/**
 * Compute all pairwise balances and per-person net, converted to the home
 * currency. Balances are DERIVED (replay bills minus settlements) — nothing is
 * stored. Amounts whose rate is unknown are converted at 1:1 as a placeholder
 * and the missing pair is reported in `missingRates`.
 *
 * Returns {
 *   pairs: [{ debtor, creditor, amount }],   // amount > 0, in home currency
 *   perPerson: { [name]: net },              // + = owed to them, - = they owe
 *   missingRates: [{ from, to }],
 * }
 */
function computeBalances({ bills = [], settlements = [], rates = {}, homeCurrency }) {
  const pairs = {}; // key -> { a, b, amount }  (amount = net a owes b)
  const missing = {};
  const seen = new Set();

  const conv = (amount, from) => {
    const to = homeCurrency;
    const r = getRate(rates, from, to);
    if (r == null) {
      missing[`${from}->${to}`] = { from, to };
      return amount; // placeholder 1:1
    }
    return amount * r;
  };

  const addPair = (from, to, amount) => {
    seen.add(from);
    seen.add(to);
    const kf = nameKey(from);
    const kt = nameKey(to);
    if (kf === kt) return;
    if (kf < kt) {
      const key = `${kf}|${kt}`;
      if (!pairs[key]) pairs[key] = { a: from, b: to, amount: 0 };
      pairs[key].amount += amount;
    } else {
      const key = `${kt}|${kf}`;
      if (!pairs[key]) pairs[key] = { a: to, b: from, amount: 0 };
      pairs[key].amount -= amount;
    }
  };

  for (const bill of bills) {
    for (const d of billPairwiseDebts(bill)) {
      addPair(d.from, d.to, conv(d.amount, bill.currency));
    }
  }
  // A settlement (from pays to) reduces what `from` owes `to`: apply as reverse.
  for (const s of settlements) {
    addPair(s.to, s.from, conv(Number(s.amount || 0), s.currency || homeCurrency));
  }

  const perPerson = {};
  for (const name of seen) perPerson[name] = 0;

  const out = [];
  for (const { a, b, amount } of Object.values(pairs)) {
    const net = round2(amount);
    if (net === 0) continue;
    const debtor = net > 0 ? a : b;
    const creditor = net > 0 ? b : a;
    const amt = Math.abs(net);
    out.push({ debtor, creditor, amount: amt });
    perPerson[debtor] = round2(perPerson[debtor] - amt);
    perPerson[creditor] = round2(perPerson[creditor] + amt);
  }

  return {
    pairs: out.sort((x, y) => y.amount - x.amount),
    perPerson,
    missingRates: Object.values(missing),
  };
}

/**
 * Given per-person net balances, suggest the fewest transfers that settle
 * everyone (classic min-cash-flow greedy). Read-only — does not touch the
 * ledger. Returns [{ from, to, amount }].
 */
function simplifyDebts(perPerson) {
  const debtors = []; // owe money (net < 0)
  const creditors = []; // owed money (net > 0)
  for (const [name, net] of Object.entries(perPerson)) {
    const v = round2(net);
    if (v < 0) debtors.push({ name, amount: -v });
    else if (v > 0) creditors.push({ name, amount: v });
  }
  // Stable order so output is deterministic.
  debtors.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  creditors.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    const amount = round2(pay);
    if (amount > 0) {
      transfers.push({ from: debtors[i].name, to: creditors[j].name, amount });
    }
    debtors[i].amount = round2(debtors[i].amount - pay);
    creditors[j].amount = round2(creditors[j].amount - pay);
    if (debtors[i].amount <= 0) i++;
    if (creditors[j].amount <= 0) j++;
  }
  return transfers;
}

module.exports = {
  round2,
  nameKey,
  splitAmount,
  reconcileBill,
  computeBillShares,
  billPairwiseDebts,
  getRate,
  computeBalances,
  simplifyDebts,
};
