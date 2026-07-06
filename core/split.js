// Pure calculation logic for Bill Splitter.
// No I/O, no DOM — this is what the tests in /test cover.

/**
 * Split a total amount into `n` near-equal shares (in dollars, rounded to
 * cents) that always sum back to the total. Works in integer cents: each
 * share gets the base amount, and the leftover cents are distributed one
 * each to the first shares. e.g. splitAmount(10, 3) -> [3.34, 3.33, 3.33].
 */
function splitAmount(total, n) {
  if (n <= 0) throw new Error("n must be a positive number");
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100);
}

/**
 * Given a list of people and expenses, return each person's net balance
 * (what they paid minus what they owe), in dollars.
 *   positive  -> they are owed money
 *   negative  -> they owe money
 *
 * Each expense is: { payer, amount, participants: [names] } and is split
 * equally among its participants.
 */
function settleUp(people, expenses) {
  const balance = {};
  for (const p of people) balance[p] = 0;

  for (const e of expenses) {
    const shares = splitAmount(e.amount, e.participants.length);
    e.participants.forEach((name, i) => {
      if (!(name in balance)) balance[name] = 0;
      balance[name] -= shares[i];
    });
    if (!(e.payer in balance)) balance[e.payer] = 0;
    balance[e.payer] += e.amount;
  }

  for (const name of Object.keys(balance)) {
    balance[name] = Math.round(balance[name] * 100) / 100;
  }
  return balance;
}

module.exports = { splitAmount, settleUp };
