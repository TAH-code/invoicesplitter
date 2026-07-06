const http = require("http");
const fs = require("fs");
const path = require("path");
const { settleUp } = require("./core/split");

const DATA_FILE = path.join(__dirname, "data", "expenses.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { people: [], expenses: [] };
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

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function serveStatic(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { error: "forbidden" });
  fs.readFile(filePath, (err, content) => {
    if (err) return sendJSON(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "text/plain" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  try {
    if (url === "/api/state" && method === "GET") {
      const data = loadData();
      return sendJSON(res, 200, { ...data, balances: settleUp(data.people, data.expenses) });
    }

    if (url === "/api/people" && method === "POST") {
      const { name } = await readBody(req);
      if (!name || !name.trim()) return sendJSON(res, 400, { error: "name is required" });
      const data = loadData();
      if (!data.people.includes(name.trim())) data.people.push(name.trim());
      saveData(data);
      return sendJSON(res, 201, data);
    }

    if (url === "/api/expenses" && method === "POST") {
      const { description, payer, amount, participants } = await readBody(req);
      if (!payer || !amount || !participants || participants.length === 0) {
        return sendJSON(res, 400, { error: "payer, amount and participants are required" });
      }
      const data = loadData();
      const id = data.expenses.length ? Math.max(...data.expenses.map((e) => e.id)) + 1 : 1;
      data.expenses.push({
        id,
        description: description || "",
        payer,
        amount: Number(amount),
        participants,
      });
      saveData(data);
      return sendJSON(res, 201, data);
    }

    if (url.startsWith("/api/expenses/") && method === "DELETE") {
      const id = Number(url.split("/").pop());
      const data = loadData();
      data.expenses = data.expenses.filter((e) => e.id !== id);
      saveData(data);
      return sendJSON(res, 200, data);
    }

    if (url.startsWith("/api/")) return sendJSON(res, 404, { error: "unknown endpoint" });

    return serveStatic(req, res);
  } catch (err) {
    return sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Bill Splitter running at http://localhost:${PORT}`);
});
