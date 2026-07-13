const { test } = require("node:test");
const assert = require("node:assert");
const { CURRENCIES, meta, symbolOf, formatMoney } = require("../core/currencies");

test("CURRENCIES includes the common majors", () => {
  const codes = CURRENCIES.map((c) => c.code);
  for (const code of ["USD", "EUR", "GBP", "JPY", "INR"]) {
    assert.ok(codes.includes(code), `expected ${code}`);
  }
});

test("symbolOf returns a symbol for known codes and the code for unknown", () => {
  assert.strictEqual(symbolOf("USD"), "$");
  assert.strictEqual(symbolOf("EUR"), "€");
  assert.strictEqual(symbolOf("XYZ"), "XYZ");
  assert.strictEqual(symbolOf("usd"), "$"); // case-insensitive
});

test("formatMoney places prefix symbols and formats to cents", () => {
  assert.strictEqual(formatMoney(12.5, "USD"), "$12.50");
  assert.strictEqual(formatMoney(1200, "GBP"), "£1200.00");
});

test("formatMoney places suffix symbols for krona-style currencies", () => {
  assert.strictEqual(formatMoney(99, "SEK"), "99.00 kr");
});

test("formatMoney handles negatives and unknown codes", () => {
  assert.strictEqual(formatMoney(-5, "USD"), "-$5.00");
  assert.strictEqual(formatMoney(5, "ABC"), "5.00 ABC");
});

test("meta returns null for unknown codes", () => {
  assert.strictEqual(meta("NOPE"), null);
  assert.strictEqual(meta("USD").name, "US Dollar");
});
