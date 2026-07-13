// Persistence layer for Bill Splitter.
//
// The whole database is a single JSON blob. Two backends, auto-selected:
//   • Upstash Redis (Vercel / serverless) when KV_REST_API_URL is set — talked
//     to over its REST API with the built-in `fetch`, so NO npm dependency.
//   • A local JSON file (dev / any persistent host) otherwise.

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data", "db.json");
const KEY = "billsplitter:db";

const DEFAULT_DB = { homeCurrency: "USD", people: {}, bills: [], settlements: [], rates: {} };

// Accept either Vercel KV or raw Upstash env var names.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);

function normalize(db) {
  return {
    homeCurrency: db.homeCurrency || "USD",
    people: db.people || {},
    bills: db.bills || [],
    settlements: db.settlements || [],
    rates: db.rates || {},
  };
}

async function redisCommand(command) {
  const resp = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!resp.ok) throw new Error(`Redis ${command[0]} failed: ${resp.status}`);
  return resp.json(); // { result: ... }
}

async function load() {
  if (useRedis) {
    try {
      const { result } = await redisCommand(["GET", KEY]);
      if (!result) return { ...DEFAULT_DB };
      return normalize(JSON.parse(result));
    } catch {
      return { ...DEFAULT_DB };
    }
  }
  try {
    return normalize(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
  } catch {
    return { ...DEFAULT_DB };
  }
}

async function save(db) {
  const value = JSON.stringify(normalize(db), null, 2);
  if (useRedis) {
    await redisCommand(["SET", KEY, value]);
    return;
  }
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, value);
}

module.exports = { load, save, useRedis, DEFAULT_DB };
