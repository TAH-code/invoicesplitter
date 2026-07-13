// Shared currency reference + money formatting.
// Pure and dependency-free; works in Node (require) and the browser (window.Currencies).

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.Currencies = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // A curated, everyday list. `pre` = symbol goes before the amount.
  const CURRENCIES = [
    { code: "USD", symbol: "$", name: "US Dollar", pre: true },
    { code: "EUR", symbol: "€", name: "Euro", pre: true },
    { code: "GBP", symbol: "£", name: "British Pound", pre: true },
    { code: "JPY", symbol: "¥", name: "Japanese Yen", pre: true },
    { code: "CNY", symbol: "¥", name: "Chinese Yuan", pre: true },
    { code: "CAD", symbol: "C$", name: "Canadian Dollar", pre: true },
    { code: "AUD", symbol: "A$", name: "Australian Dollar", pre: true },
    { code: "CHF", symbol: "CHF", name: "Swiss Franc", pre: true },
    { code: "INR", symbol: "₹", name: "Indian Rupee", pre: true },
    { code: "MXN", symbol: "MX$", name: "Mexican Peso", pre: true },
    { code: "BRL", symbol: "R$", name: "Brazilian Real", pre: true },
    { code: "ZAR", symbol: "R", name: "South African Rand", pre: true },
    { code: "SGD", symbol: "S$", name: "Singapore Dollar", pre: true },
    { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar", pre: true },
    { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar", pre: true },
    { code: "SEK", symbol: "kr", name: "Swedish Krona", pre: false },
    { code: "NOK", symbol: "kr", name: "Norwegian Krone", pre: false },
    { code: "DKK", symbol: "kr", name: "Danish Krone", pre: false },
    { code: "PLN", symbol: "zł", name: "Polish Zloty", pre: false },
    { code: "AED", symbol: "د.إ", name: "UAE Dirham", pre: true },
    { code: "SAR", symbol: "﷼", name: "Saudi Riyal", pre: true },
    { code: "TRY", symbol: "₺", name: "Turkish Lira", pre: true },
    { code: "KRW", symbol: "₩", name: "South Korean Won", pre: true },
    { code: "THB", symbol: "฿", name: "Thai Baht", pre: true },
    { code: "MYR", symbol: "RM", name: "Malaysian Ringgit", pre: true },
    { code: "PHP", symbol: "₱", name: "Philippine Peso", pre: true },
    { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah", pre: true },
    { code: "VND", symbol: "₫", name: "Vietnamese Dong", pre: false },
    { code: "RUB", symbol: "₽", name: "Russian Ruble", pre: false },
    { code: "ILS", symbol: "₪", name: "Israeli Shekel", pre: true },
    { code: "EGP", symbol: "E£", name: "Egyptian Pound", pre: true },
    { code: "NGN", symbol: "₦", name: "Nigerian Naira", pre: true },
    { code: "KES", symbol: "KSh", name: "Kenyan Shilling", pre: true },
  ];

  const BY_CODE = {};
  for (const c of CURRENCIES) BY_CODE[c.code] = c;

  function meta(code) {
    return BY_CODE[String(code || "").toUpperCase()] || null;
  }

  function symbolOf(code) {
    const m = meta(code);
    return m ? m.symbol : String(code || "").toUpperCase();
  }

  /**
   * Format an amount in a given currency, e.g. formatMoney(12.5, "USD") -> "$12.50".
   * Unknown codes fall back to "12.50 XYZ". Negatives keep the sign outside the symbol.
   */
  function formatMoney(amount, code) {
    const n = Number(amount) || 0;
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n).toFixed(2);
    const m = meta(code);
    if (!m) return `${sign}${abs} ${String(code || "").toUpperCase()}`;
    return m.pre ? `${sign}${m.symbol}${abs}` : `${sign}${abs} ${m.symbol}`;
  }

  return { CURRENCIES, meta, symbolOf, formatMoney };
});
