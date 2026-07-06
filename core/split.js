// Pure calculation logic for Bill Splitter.
// No I/O, no DOM — this is what the tests in /test cover.

/**
 * Split a total amount into `n` equal shares (in dollars, rounded to cents).
 *
 * ⚠️ Known bug (issue #1): this rounds each share independently, so the shares
 * don't always add back up to the original total. e.g. splitAmount(10, 3)
 * returns [3.33, 3.33, 3.33] which sums to 9.99, not 10.00.
 */
function splitAmount(total, n) {
  if (n <= 0) throw new Error("n must be a positive number");
  const share = Math.round((total / n) * 100) / 100;
  return Array(n).fill(share);
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
