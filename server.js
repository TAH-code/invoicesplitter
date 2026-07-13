const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  nameKey,
  reconcileBill,
  computeBalances,
  simplifyDebts,
} = require("./core/split");

const DATA_FILE = path.join(__dirname, "data", "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

// Free, no-API-key rate endpoint. Returns { rates: { USD: 1.08, ... } } for base.
const RATE_URL = (base) => `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;

function loadData() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      homeCurrency: data.homeCurrency || "USD",
      people: data.people || {}, // normalizedKey -> display name
      bills: data.bills || [],
      settlements: data.settlements || [],
      rates: data.rates || {}, // "FROM->TO" -> number (last fetched or manual override)
    };
  } catch {
    return { homeCurrency: "USD", people: {}, bills: [], settlements: [], rates: {} };
  }
}

function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Register a name (normalized identity), returning the canonical display form.
function canonical(data, name) {
  const key = nameKey(name);
  if (!key) return null;
  if (!data.people[key]) data.people[key] = String(name).trim();
  return data.people[key];
}

/**
 * Ensure a FROM->TO rate is available in data.rates. A stored rate (a manual
 * override or a previously-fetched value) always wins and is never clobbered;
 * we only fetch live when no stored rate exists for the pair. Returns the rate
 * number, or null if it can't be resolved (offline / unknown currency and no
 * stored value) — the caller then prompts for a manual rate.
 */
async function ensureRate(data, from, to) {
  if (from === to) return 1;
  const key = `${from}->${to}`;
  if (typeof data.rates[key] === "number" && data.rates[key] > 0) return data.rates[key];
  const inv = data.rates[`${to}->${from}`];
  if (typeof inv === "number" && inv > 0) return 1 / inv;
  // Nothing stored — fetch live once and cache it.
  try {
    const resp = await fetch(RATE_URL(from));
    if (resp.ok) {
      const json = await resp.json();
      const rate = json && json.rates && json.rates[to];
      if (typeof rate === "number" && rate > 0) {
        data.rates[key] = rate;
        return rate;
      }
    }
  } catch {
    // ignore — offline / fetch failed
  }
  return null;
}

// Currencies used by bills/settlements that must convert to the home currency.
function usedCurrencies(data) {
  const set = new Set();
  for (const b of data.bills) if (b.currency) set.add(b.currency);
  for (const s of data.settlements) if (s.currency) set.add(s.currency);
  set.delete(data.homeCurrency);
  return [...set];
}

async function buildState(data) {
  // Best-effort: make sure every used currency has a rate to the home currency.
  for (const cur of usedCurrencies(data)) {
    await ensureRate(data, cur, data.homeCurrency);
  }
  saveData(data); // persist any freshly fetched rates
  const balances = computeBalances(data);
  balances.simplified = simplifyDebts(balances.perPerson);
  return {
    homeCurrency: data.homeCurrency,
    people: Object.values(data.people).sort((a, b) => a.localeCompare(b)),
    bills: data.bills,
    settlements: data.settlements,
    rates: data.rates,
    balances,
  };
}

function nextId(list) {
  return list.length ? Math.max(...list.map((x) => x.id)) + 1 : 1;
}

// Normalize + validate an incoming bill; registers people. Returns { bill, error }.
function buildBill(data, body, id) {
  const participants = (body.participants || []).map((n) => canonical(data, n)).filter(Boolean);
  const uniqueParticipants = [...new Map(participants.map((p) => [nameKey(p), p])).values()];
  if (uniqueParticipants.length === 0) return { error: "at least one participant is required" };

  const payer = body.payer ? canonical(data, body.payer) : null;
  if (!payer || !uniqueParticipants.some((p) => nameKey(p) === nameKey(payer))) {
    return { error: "payer must be one of the participants" };
  }

  const items = (body.items || []).map((it) => ({
    label: String(it.label || "").trim(),
    amount: Number(it.amount || 0),
    assignees: (it.assignees || [])
      .map((n) => canonical(data, n))
      .filter((n) => uniqueParticipants.some((p) => nameKey(p) === nameKey(n))),
  }));
  if (items.length === 0) return { error: "at least one line item is required" };
  for (const it of items) {
    if (!(it.amount >= 0)) return { error: "each item needs a non-negative amount" };
  }

  const bill = {
    id,
    date: body.date || new Date().toISOString().slice(0, 10),
    description: String(body.description || "").trim(),
    currency: (body.currency || data.homeCurrency).toUpperCase(),
    payer,
    participants: uniqueParticipants,
    items,
    tax: Number(body.tax || 0),
    tip: Number(body.tip || 0),
    grandTotal: Number(body.grandTotal || 0),
  };

  const rec = reconcileBill(bill);
  if (!rec.ok) {
    return {
      error: `items + tax + tip = ${rec.computedTotal.toFixed(2)} does not match grand total ${rec.grandTotal.toFixed(2)}`,
    };
  }
  return { bill };
}

// Apply any manual rate overrides sent with a request.
function applyManualRates(data, manualRates) {
  if (!manualRates) return;
  for (const [pair, rate] of Object.entries(manualRates)) {
    const r = Number(rate);
    if (r > 0) data.rates[pair] = r;
  }
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function serveStatic(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { error: "forbidden" });
  fs.readFile(filePath, (err, content) => {
    if (err) return sendJSON(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "text/plain" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const url = req.url.split("?")[0];
  try {
    if (url === "/api/state" && method === "GET") {
      const data = loadData();
      return sendJSON(res, 200, await buildState(data));
    }

    // Home currency + rate overrides
    if (url === "/api/settings" && method === "PUT") {
      const body = await readBody(req);
      const data = loadData();
      if (body.homeCurrency) data.homeCurrency = String(body.homeCurrency).toUpperCase();
      applyManualRates(data, body.rates);
      saveData(data);
      return sendJSON(res, 200, await buildState(data));
    }

    if (url === "/api/rates" && method === "PUT") {
      const { from, to, rate } = await readBody(req);
      if (!from || !to || !(Number(rate) > 0)) {
        return sendJSON(res, 400, { error: "from, to and a positive rate are required" });
      }
      const data = loadData();
      data.rates[`${String(from).toUpperCase()}->${String(to).toUpperCase()}`] = Number(rate);
      saveData(data);
      return sendJSON(res, 200, await buildState(data));
    }

    // Bills
    if (url === "/api/bills" && method === "POST") {
      const body = await readBody(req);
      const data = loadData();
      applyManualRates(data, body.manualRates);
      const { bill, error } = buildBill(data, body, nextId(data.bills));
      if (error) return sendJSON(res, 400, { error });
      // Ensure we can convert this bill; if not, ask the client for a manual rate.
      const rate = await ensureRate(data, bill.currency, data.homeCurrency);
      if (rate == null) {
        return sendJSON(res, 409, {
          error: "exchange rate needed",
          needRate: { from: bill.currency, to: data.homeCurrency },
        });
      }
      data.bills.push(bill);
      saveData(data);
      return sendJSON(res, 201, await buildState(data));
    }

    if (url.startsWith("/api/bills/") && method === "PUT") {
      const id = Number(url.split("/").pop());
      const body = await readBody(req);
      const data = loadData();
      const idx = data.bills.findIndex((b) => b.id === id);
      if (idx === -1) return sendJSON(res, 404, { error: "bill not found" });
      applyManualRates(data, body.manualRates);
      const { bill, error } = buildBill(data, body, id);
      if (error) return sendJSON(res, 400, { error });
      const rate = await ensureRate(data, bill.currency, data.homeCurrency);
      if (rate == null) {
        return sendJSON(res, 409, {
          error: "exchange rate needed",
          needRate: { from: bill.currency, to: data.homeCurrency },
        });
      }
      data.bills[idx] = bill;
      saveData(data);
      return sendJSON(res, 200, await buildState(data));
    }

    if (url.startsWith("/api/bills/") && method === "DELETE") {
      const id = Number(url.split("/").pop());
      const data = loadData();
      data.bills = data.bills.filter((b) => b.id !== id);
      saveData(data);
      return sendJSON(res, 200, await buildState(data));
    }

    // Settlements
    if (url === "/api/settlements" && method === "POST") {
      const body = await readBody(req);
      const data = loadData();
      applyManualRates(data, body.manualRates);
      const from = canonical(data, body.from);
      const to = canonical(data, body.to);
      const amount = Number(body.amount);
      if (!from || !to || nameKey(from) === nameKey(to) || !(amount > 0)) {
        return sendJSON(res, 400, { error: "from, to (distinct) and a positive amount are required" });
      }
      const currency = (body.currency || data.homeCurrency).toUpperCase();
      const rate = await ensureRate(data, currency, data.homeCurrency);
      if (rate == null) {
        return sendJSON(res, 409, {
          error: "exchange rate needed",
          needRate: { from: currency, to: data.homeCurrency },
        });
      }
      data.settlements.push({
        id: nextId(data.settlements),
        from,
        to,
        amount,
        currency,
        date: body.date || new Date().toISOString().slice(0, 10),
      });
      saveData(data);
      return sendJSON(res, 201, await buildState(data));
    }

    if (url.startsWith("/api/settlements/") && method === "DELETE") {
      const id = Number(url.split("/").pop());
      const data = loadData();
      data.settlements = data.settlements.filter((s) => s.id !== id);
      saveData(data);
      return sendJSON(res, 200, await buildState(data));
    }

    if (url.startsWith("/api/")) return sendJSON(res, 404, { error: "unknown endpoint" });

    // Serve the shared pure-logic modules so the browser reuses the same math.
    if (url.startsWith("/core/") && method === "GET") {
      const coreDir = path.join(__dirname, "core");
      const filePath = path.join(__dirname, path.normalize(url));
      if (!filePath.startsWith(coreDir)) return sendJSON(res, 403, { error: "forbidden" });
      return fs.readFile(filePath, (err, content) => {
        if (err) return sendJSON(res, 404, { error: "not found" });
        res.writeHead(200, { "Content-Type": "text/javascript" });
        res.end(content);
      });
    }

    return serveStatic(req, res);
  } catch (err) {
    return sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Bill Splitter running at http://localhost:${PORT}`);
});
