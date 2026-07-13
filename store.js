// Persistence layer for Bill Splitter.
//
// The whole database is a single JSON blob. Two backends, auto-selected:
//   • Vercel Blob (serverless) when BLOB_READ_WRITE_TOKEN is set — the DB JSON
//     is stored as one blob object. @vercel/blob is required lazily so local
//     dev needs no dependency.
//   • A local JSON file (dev / any persistent host) otherwise.

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "data", "db.json");
const BLOB_PATH = "billsplitter-db.json";

const DEFAULT_DB = { homeCurrency: "USD", people: {}, bills: [], settlements: [], rates: {} };

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const useBlob = Boolean(BLOB_TOKEN);

function normalize(db) {
  return {
    homeCurrency: db.homeCurrency || "USD",
    people: db.people || {},
    bills: db.bills || [],
    settlements: db.settlements || [],
    rates: db.rates || {},
  };
}

async function load() {
  if (useBlob) {
    try {
      const { list } = require("@vercel/blob");
      const { blobs } = await list({ prefix: BLOB_PATH, token: BLOB_TOKEN, limit: 1 });
      const b = blobs.find((x) => x.pathname === BLOB_PATH) || blobs[0];
      if (!b) return { ...DEFAULT_DB };
      // Cache-bust so we always read the latest write (Blob is CDN-cached).
      const resp = await fetch(`${b.url}?ts=${Date.now()}`, { cache: "no-store" });
      if (!resp.ok) return { ...DEFAULT_DB };
      return normalize(await resp.json());
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
  if (useBlob) {
    const { put } = require("@vercel/blob");
    await put(BLOB_PATH, value, {
      access: "public",
      token: BLOB_TOKEN,
      addRandomSuffix: false, // stable pathname so we can find it again
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 0, // avoid stale reads after a write
    });
    return;
  }
  // File backend. Best-effort: a read-only serverless FS must not crash requests.
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, value);
  } catch (err) {
    if (["EROFS", "EACCES", "EPERM", "ENOENT"].includes(err.code)) return;
    throw err;
  }
}

module.exports = { load, save, useBlob, DEFAULT_DB };
