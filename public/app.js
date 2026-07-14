const app = document.getElementById("app");
const C = window.Currencies;
const Split = window.Split;

// ---- global state --------------------------------------------------------

let state = null; // latest /api/state payload
let form = null; // in-progress add/edit bill form model

async function getState() {
  const res = await fetch("/api/state");
  return res.json();
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { ok: res.ok, status: res.status, data };
}

// ---- helpers -------------------------------------------------------------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const keyOf = (n) => Split.nameKey(n);

function fmt(n, cur) {
  return C.formatMoney(n, cur || (state && state.homeCurrency) || "USD");
}

function currencyOptions(selected) {
  const sel = String(selected || "").toUpperCase();
  let opts = C.CURRENCIES.map(
    (c) => `<option value="${c.code}" ${c.code === sel ? "selected" : ""}>${c.code} · ${esc(c.name)} (${esc(c.symbol)})</option>`
  );
  if (sel && !C.meta(sel)) opts = [`<option value="${esc(sel)}" selected>${esc(sel)}</option>`, ...opts];
  return opts.join("");
}

function toast(msg, isError) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (isError ? " error" : "");
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 3500);
}

function nav(hash) {
  location.hash = hash;
}

// ---- "you" identity (per-device) -----------------------------------------

const YOU_KEY = "billsplitter:you";

function getYou() {
  try {
    return localStorage.getItem(YOU_KEY) || "";
  } catch {
    return "";
  }
}

function setYou(name) {
  try {
    if (name) localStorage.setItem(YOU_KEY, name);
    else localStorage.removeItem(YOU_KEY);
  } catch {
    /* storage unavailable — banner just won't persist */
  }
}

// Personal net-position banner shown above every view. Lives outside #app so it
// survives the per-view re-renders; call it from render().
function renderYouBanner() {
  const el = document.getElementById("you-banner");
  if (!el || !state) return;
  const people = state.people || [];
  const you = getYou();
  const match = you && people.find((p) => keyOf(p) === keyOf(you));

  if (!people.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;

  if (!match) {
    el.className = "you-banner unset";
    el.innerHTML = `👤 <a href="#/settings">Tell us who you are</a> to see your overall balance here.`;
    return;
  }

  const { status, amount } = Split.netPosition(state.balances.perPerson, match);
  const line =
    status === "owed"
      ? `you're owed <strong>${fmt(amount)}</strong> overall`
      : status === "owes"
      ? `you owe <strong>${fmt(amount)}</strong> overall`
      : `you're all settled up`;
  el.className = `you-banner ${status}`;
  el.innerHTML = `👤 <span class="you-name">${esc(match)}</span> — ${line}`;
}

// When the server asks for a manual rate (409), collect it and retry.
async function submitWithRate(method, url, body) {
  let manualRates = { ...(body.manualRates || {}) };
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await api(method, url, { ...body, manualRates });
    if (res.ok) return res;
    if (res.status === 409 && res.data.needRate) {
      const { from, to } = res.data.needRate;
      const input = prompt(`No exchange rate for ${from} → ${to}. Enter 1 ${from} = ? ${to}`);
      const rate = Number(input);
      if (!(rate > 0)) {
        toast("Rate required to save.", true);
        return res;
      }
      manualRates[`${from}->${to}`] = rate;
      continue;
    }
    toast(res.data.error || "Something went wrong.", true);
    return res;
  }
  toast("Could not resolve exchange rate.", true);
  return { ok: false };
}

// ---- routing -------------------------------------------------------------

function parseRoute() {
  const raw = (location.hash || "#/add").replace(/^#\/?/, "");
  const parts = raw.split("/").map(decodeURIComponent);
  return { name: parts[0] || "add", args: parts.slice(1) };
}

async function refresh() {
  state = await getState();
  document.getElementById("home-cur").textContent = `Home: ${state.homeCurrency} (${C.symbolOf(state.homeCurrency)})`;
  render();
}

function render() {
  const { name, args } = parseRoute();
  document.querySelectorAll("#nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === name);
  });
  renderYouBanner();
  switch (name) {
    case "balances":
      return renderBalances();
    case "simplify":
      return renderSimplify();
    case "bills":
      return renderBills();
    case "settings":
      return renderSettings();
    case "person":
      return renderPerson(args[0]);
    case "pair":
      return renderPair(args[0], args[1]);
    case "edit":
      return renderAdd(Number(args[0]));
    case "add":
    default:
      return renderAdd(null);
  }
}

// ---- add / edit bill -----------------------------------------------------

function blankForm() {
  return {
    id: null,
    mode: "even",
    date: new Date().toISOString().slice(0, 10),
    description: "",
    currency: (state && state.homeCurrency) || "USD",
    payer: "",
    participants: [],
    items: [{ label: "", amount: "", assignees: [] }],
    tax: "",
    tip: "",
    grandTotal: "",
  };
}

function formFromBill(bill) {
  const single = bill.items.length === 1;
  const even =
    single &&
    Number(bill.tax || 0) === 0 &&
    Number(bill.tip || 0) === 0 &&
    (!bill.items[0].assignees.length ||
      bill.items[0].assignees.length === bill.participants.length) &&
    Split.round2(bill.items[0].amount) === Split.round2(bill.grandTotal);
  return {
    id: bill.id,
    mode: even ? "even" : "itemize",
    date: bill.date,
    description: bill.description,
    currency: bill.currency,
    payer: bill.payer,
    participants: [...bill.participants],
    items: bill.items.map((it) => ({ label: it.label, amount: String(it.amount), assignees: [...it.assignees] })),
    tax: bill.tax ? String(bill.tax) : "",
    tip: bill.tip ? String(bill.tip) : "",
    grandTotal: bill.grandTotal ? String(bill.grandTotal) : "",
  };
}

// Build a core-shaped bill from the current form (used for preview + save).
function formToBill(f) {
  if (f.mode === "even") {
    const amount = Number(f.items[0].amount) || 0;
    return {
      date: f.date,
      description: f.description,
      currency: (f.currency || "USD").toUpperCase(),
      payer: f.payer,
      participants: f.participants,
      items: [{ label: f.description || "Whole bill", amount, assignees: [] }],
      tax: 0,
      tip: 0,
      grandTotal: amount,
    };
  }
  const items = f.items
    .filter((it) => it.label.trim() || Number(it.amount) > 0)
    .map((it) => ({ label: it.label, amount: Number(it.amount) || 0, assignees: it.assignees }));
  const tax = Number(f.tax) || 0;
  const tip = Number(f.tip) || 0;
  return {
    date: f.date,
    description: f.description,
    currency: (f.currency || "USD").toUpperCase(),
    payer: f.payer,
    participants: f.participants,
    items,
    tax,
    tip,
    grandTotal: Number(f.grandTotal) || 0,
  };
}

function itemsSubtotal(f) {
  return f.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
}

// Read DOM inputs back into `form` before a structural re-render / save.
function syncForm() {
  if (!form) return;
  const val = (id) => {
    const e = document.getElementById(id);
    return e ? e.value : undefined;
  };
  const desc = val("f-desc");
  if (desc !== undefined) form.description = desc;
  const date = val("f-date");
  if (date !== undefined) form.date = date;
  const cur = val("f-currency");
  if (cur !== undefined) form.currency = cur.toUpperCase();
  const payer = val("f-payer");
  if (payer !== undefined) form.payer = payer;

  if (form.mode === "even") {
    const t = val("f-total");
    if (t !== undefined) form.items[0].amount = t;
  } else {
    const tax = val("f-tax");
    if (tax !== undefined) form.tax = tax;
    const tip = val("f-tip");
    if (tip !== undefined) form.tip = tip;
    const gt = val("f-grandtotal");
    if (gt !== undefined) form.grandTotal = gt;
    form.items.forEach((it, i) => {
      const l = val(`item-label-${i}`);
      const a = val(`item-amount-${i}`);
      if (l !== undefined) it.label = l;
      if (a !== undefined) it.amount = a;
    });
  }
}

function renderAdd(editId) {
  if (editId != null) {
    const bill = state.bills.find((b) => b.id === editId);
    if (!bill) return nav("#/bills");
    if (!form || form.id !== editId) form = formFromBill(bill);
  } else if (!form || form.id != null) {
    form = blankForm();
  }

  const people = state.people;
  const isEdit = form.id != null;
  const even = form.mode === "even";

  app.innerHTML = `
    <h1>${isEdit ? "Edit bill" : "Add a bill"}</h1>
    <p class="hint">${even ? "Split a total evenly among everyone." : "Itemize the receipt and assign each line."}</p>

    <section class="card">
      <div class="segmented" role="tablist">
        <button type="button" class="seg ${even ? "on" : ""}" data-mode="even">⚡ Split evenly</button>
        <button type="button" class="seg ${even ? "" : "on"}" data-mode="itemize">🧾 Itemize</button>
      </div>

      <div class="grid2" style="margin-top:1rem">
        <label>Description
          <input id="f-desc" value="${esc(form.description)}" placeholder="Dinner at Luigi's" />
        </label>
        <label>Date
          <input id="f-date" type="date" value="${esc(form.date)}" />
        </label>
        <label>Currency
          <select id="f-currency">${currencyOptions(form.currency)}</select>
        </label>
        <label>Paid by
          <select id="f-payer">
            <option value="">— choose payer —</option>
            ${form.participants.map((p) => `<option ${keyOf(p) === keyOf(form.payer) ? "selected" : ""}>${esc(p)}</option>`).join("")}
          </select>
        </label>
      </div>

      <h2>Who's splitting</h2>
      <div class="chips">
        ${
          form.participants.map((p) => `<span class="chip">${esc(p)}<button class="chip-x" data-remove-participant="${esc(p)}" type="button">✕</button></span>`).join("") ||
          "<em class='muted'>Add the people on this bill.</em>"
        }
      </div>
      <div class="row">
        <input id="new-participant" list="known-people" placeholder="Add a person…" />
        <datalist id="known-people">${people.map((p) => `<option value="${esc(p)}"></option>`).join("")}</datalist>
        <button id="add-participant" type="button" class="ghost">Add</button>
      </div>

      ${even ? evenSection() : itemizeSection()}
    </section>

    <section class="card preview-card">
      <h2>Split preview</h2>
      <div id="preview">${previewHTML()}</div>
    </section>

    <div class="actions">
      <button id="save-bill" type="button">${isEdit ? "Save changes" : "Add bill"}</button>
      ${isEdit ? `<button id="cancel-edit" type="button" class="ghost">Cancel</button>` : `<button id="reset-bill" type="button" class="ghost">Clear</button>`}
    </div>
  `;

  wireAddView();
  refreshSaveState();
}

function evenSection() {
  return `
    <h2>Total amount</h2>
    <div class="total-row">
      <span class="cur-badge">${esc(C.symbolOf(form.currency))}</span>
      <input id="f-total" type="number" min="0" step="0.01" value="${esc(form.items[0].amount)}" placeholder="0.00" class="big-amount" />
    </div>
    <p class="hint">Split equally among everyone above. Switch to <strong>Itemize</strong> for uneven splits, tax or tip.</p>
  `;
}

function itemizeSection() {
  const sub = itemsSubtotal(form);
  return `
    <h2>Items</h2>
    <div class="table-scroll">
    <table class="items">
      <thead>
        <tr>
          <th>Item</th><th class="num">Amount</th>
          ${form.participants.map((p) => `<th class="who" title="${esc(p)}">${esc(p.slice(0, 6))}</th>`).join("")}
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${form.items
          .map(
            (it, i) => `
          <tr>
            <td><input id="item-label-${i}" value="${esc(it.label)}" placeholder="Item ${i + 1}" /></td>
            <td class="num"><input id="item-amount-${i}" type="number" min="0" step="0.01" value="${esc(it.amount)}" placeholder="0.00" /></td>
            ${form.participants
              .map(
                (p) =>
                  `<td class="who"><input type="checkbox" data-item="${i}" data-who="${esc(p)}" ${
                    it.assignees.some((a) => keyOf(a) === keyOf(p)) ? "checked" : ""
                  } /></td>`
              )
              .join("")}
            <td><button class="del" type="button" data-remove-item="${i}" title="Remove item">✕</button></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
    </div>
    <p class="hint">Leave an item's boxes unchecked to split it among everyone.</p>
    <button id="add-item" type="button" class="ghost">+ Add item</button>

    <h2>Tax &amp; tip</h2>
    <div class="grid2">
      <label>Tax
        <input id="f-tax" type="number" min="0" step="0.01" value="${esc(form.tax)}" placeholder="0.00" />
      </label>
      <label>Tip
        <input id="f-tip" type="number" min="0" step="0.01" value="${esc(form.tip)}" placeholder="0.00" />
      </label>
    </div>
    <div class="tip-quick">
      <span class="muted">Quick tip:</span>
      ${[0, 10, 15, 18, 20].map((p) => `<button type="button" class="pill-btn" data-tip="${p}">${p === 0 ? "None" : p + "%"}</button>`).join("")}
      <span class="muted">of ${fmt(sub, form.currency)}</span>
    </div>

    <h2>Grand total</h2>
    <div class="row">
      <label style="flex:1">Receipt grand total
        <input id="f-grandtotal" type="number" min="0" step="0.01" value="${esc(form.grandTotal)}" placeholder="0.00" />
      </label>
      <button id="auto-total" type="button" class="ghost" title="Set to items + tax + tip">= Auto</button>
    </div>
    <div id="reconcile-bar"></div>
  `;
}

function previewHTML() {
  if (!form.participants.length || !form.payer) {
    return `<p class="hint">Add people and choose who paid to see who owes what.</p>`;
  }
  const bill = formToBill(form);
  let shares;
  try {
    shares = Split.computeBillShares(bill);
  } catch {
    return `<p class="hint">Enter amounts to preview.</p>`;
  }
  const cur = bill.currency;
  const home = state.homeCurrency;
  const rate = Split.getRate(state.rates, cur, home);
  const rows = form.participants
    .map((p) => {
      const amt = shares[p] || 0;
      const isPayer = keyOf(p) === keyOf(form.payer);
      const conv = cur !== home && rate != null ? ` <span class="muted">≈ ${fmt(amt * rate, home)}</span>` : "";
      return `<li>
        <span>${esc(p)} ${isPayer ? '<em class="tag">paid</em>' : ""}</span>
        <span class="amt">${fmt(amt, cur)}${conv}</span>
      </li>`;
    })
    .join("");
  const total = bill.items.reduce((s, it) => s + it.amount, 0) + bill.tax + bill.tip;
  return `<ul class="preview">${rows}</ul>
    <div class="preview-total"><span>Total</span><span class="amt">${fmt(total, cur)}</span></div>`;
}

function reconcileBarHTML() {
  if (form.mode === "even") return "";
  const bill = formToBill(form);
  const rec = Split.reconcileBill(bill);
  const cls = rec.ok ? "ok" : "bad";
  return `<div class="reconcile ${cls}">
    Items + tax + tip = <strong>${fmt(rec.computedTotal, form.currency)}</strong> ·
    Grand total = <strong>${fmt(rec.grandTotal, form.currency)}</strong>
    ${rec.ok ? "✓ matches" : "✗ tap “= Auto” or adjust"}
  </div>`;
}

function canSave() {
  if (!form.participants.length || !form.payer) return false;
  const bill = formToBill(form);
  if (!bill.items.length) return false;
  if (form.mode === "itemize" && !Split.reconcileBill(bill).ok) return false;
  const total = bill.items.reduce((s, it) => s + it.amount, 0) + bill.tax + bill.tip;
  return total > 0;
}

// Update the live bits in place (no full re-render) for smooth typing.
function live() {
  syncForm();
  const prev = document.getElementById("preview");
  if (prev) prev.innerHTML = previewHTML();
  const bar = document.getElementById("reconcile-bar");
  if (bar) bar.innerHTML = reconcileBarHTML();
  refreshSaveState();
}

function refreshSaveState() {
  const btn = document.getElementById("save-bill");
  if (btn) btn.disabled = !canSave();
  const bar = document.getElementById("reconcile-bar");
  if (bar && !bar.innerHTML) bar.innerHTML = reconcileBarHTML();
}

function wireAddView() {
  document.querySelectorAll(".seg").forEach((btn) => {
    btn.onclick = () => {
      syncForm();
      form.mode = btn.dataset.mode;
      if (form.mode === "even" && form.items.length !== 1) {
        // collapse to a single even item, seeding total from the current sum
        const amt = itemsSubtotal(form);
        form.items = [{ label: "", amount: amt ? String(amt) : "", assignees: [] }];
        form.tax = "";
        form.tip = "";
      }
      renderAdd(form.id);
    };
  });

  const addP = document.getElementById("add-participant");
  if (addP)
    addP.onclick = () => {
      const input = document.getElementById("new-participant");
      const name = input.value.trim();
      if (name && !form.participants.some((p) => keyOf(p) === keyOf(name))) {
        syncForm();
        form.participants.push(name);
        renderAdd(form.id);
      }
    };
  const newP = document.getElementById("new-participant");
  if (newP)
    newP.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addP.click();
      }
    };

  document.querySelectorAll("[data-remove-participant]").forEach((btn) => {
    btn.onclick = () => {
      syncForm();
      const name = btn.dataset.removeParticipant;
      form.participants = form.participants.filter((p) => keyOf(p) !== keyOf(name));
      form.items.forEach((it) => (it.assignees = it.assignees.filter((a) => keyOf(a) !== keyOf(name))));
      if (keyOf(form.payer) === keyOf(name)) form.payer = "";
      renderAdd(form.id);
    };
  });

  const addItem = document.getElementById("add-item");
  if (addItem)
    addItem.onclick = () => {
      syncForm();
      form.items.push({ label: "", amount: "", assignees: [] });
      renderAdd(form.id);
    };

  document.querySelectorAll("[data-remove-item]").forEach((btn) => {
    btn.onclick = () => {
      syncForm();
      form.items.splice(Number(btn.dataset.removeItem), 1);
      if (form.items.length === 0) form.items.push({ label: "", amount: "", assignees: [] });
      renderAdd(form.id);
    };
  });

  document.querySelectorAll('input[type="checkbox"][data-item]').forEach((cb) => {
    cb.onchange = () => {
      const i = Number(cb.dataset.item);
      const who = cb.dataset.who;
      const item = form.items[i];
      if (cb.checked) {
        if (!item.assignees.some((a) => keyOf(a) === keyOf(who))) item.assignees.push(who);
      } else {
        item.assignees = item.assignees.filter((a) => keyOf(a) !== keyOf(who));
      }
      live();
    };
  });

  document.querySelectorAll("[data-tip]").forEach((btn) => {
    btn.onclick = () => {
      syncForm();
      const pct = Number(btn.dataset.tip);
      form.tip = pct === 0 ? "" : String(Split.round2(itemsSubtotal(form) * (pct / 100)));
      renderAdd(form.id);
    };
  });

  const auto = document.getElementById("auto-total");
  if (auto)
    auto.onclick = () => {
      syncForm();
      const bill = formToBill(form);
      form.grandTotal = String(Split.round2(bill.items.reduce((s, it) => s + it.amount, 0) + bill.tax + bill.tip));
      renderAdd(form.id);
    };

  // Live-update inputs
  ["f-desc", "f-currency", "f-payer", "f-total", "f-tax", "f-tip", "f-grandtotal"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.oninput = live;
      el.onchange = live;
    }
  });
  form.items.forEach((_, i) => {
    ["item-label-" + i, "item-amount-" + i].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.oninput = live;
    });
  });

  const cancel = document.getElementById("cancel-edit");
  if (cancel) cancel.onclick = () => nav("#/bills");
  const reset = document.getElementById("reset-bill");
  if (reset)
    reset.onclick = () => {
      form = blankForm();
      renderAdd(null);
    };

  document.getElementById("save-bill").onclick = async () => {
    syncForm();
    if (!canSave()) return toast("Add people, a payer, amounts, and a matching total.", true);
    const bill = formToBill(form);
    const isEdit = form.id != null;
    const res = await submitWithRate(isEdit ? "PUT" : "POST", isEdit ? `/api/bills/${form.id}` : "/api/bills", bill);
    if (res.ok) {
      state = res.data;
      form = null;
      toast(isEdit ? "Bill updated." : "Bill added.");
      nav("#/balances");
    }
  };
}

// ---- balances dashboard --------------------------------------------------

function renderBalances() {
  const { perPerson, pairs, missingRates } = state.balances;
  const people = Object.entries(perPerson).sort((a, b) => b[1] - a[1]);

  app.innerHTML = `
    <h1>Balances</h1>
    ${missingRatesBanner(missingRates)}
    ${statRow(people, pairs)}
    <section class="card">
      <h2>Who's up / down</h2>
      ${
        people.length
          ? `<ul class="netlist">${people
              .map(([name, net]) => {
                const cls = net > 0.005 ? "owed" : net < -0.005 ? "owes" : "even";
                const label = net > 0.005 ? `is owed ${fmt(net)}` : net < -0.005 ? `owes ${fmt(-net)}` : "settled up";
                return `<li class="${cls}"><a href="#/person/${encodeURIComponent(name)}">${esc(name)}</a> <span>${label}</span></li>`;
              })
              .join("")}</ul>`
          : "<em class='muted'>No balances yet — add a bill.</em>"
      }
    </section>

    <section class="card">
      <h2>Who owes whom</h2>
      ${
        pairs.length
          ? `<ul class="pairlist">${pairs
              .map(
                (p) => `
            <li>
              <a href="#/pair/${encodeURIComponent(p.debtor)}/${encodeURIComponent(p.creditor)}">
                <strong>${esc(p.debtor)}</strong> owes <strong>${esc(p.creditor)}</strong>
              </a>
              <span class="amt">${fmt(p.amount)}</span>
              <button class="settle-btn" data-from="${esc(p.debtor)}" data-to="${esc(p.creditor)}" data-amt="${p.amount}">Settle</button>
            </li>`
              )
              .join("")}</ul>`
          : "<em class='muted'>Everyone's settled up. 🎉</em>"
      }
    </section>
  `;

  document.querySelectorAll(".settle-btn").forEach((btn) => {
    btn.onclick = () => openSettle(btn.dataset.from, btn.dataset.to, Number(btn.dataset.amt));
  });
}

function statRow(people, pairs) {
  const owedTotal = pairs.reduce((s, p) => s + p.amount, 0);
  return `<div class="stats">
    <div class="stat"><span class="stat-label">People</span><span class="stat-val">${people.length}</span></div>
    <div class="stat"><span class="stat-label">Open debts</span><span class="stat-val">${pairs.length}</span></div>
    <div class="stat"><span class="stat-label">In motion</span><span class="stat-val">${fmt(owedTotal)}</span></div>
  </div>`;
}

function missingRatesBanner(missingRates) {
  if (!missingRates || !missingRates.length) return "";
  return `<div class="banner">
    ⚠️ Missing exchange rates (shown at 1:1 until set):
    ${missingRates.map((m) => `${esc(m.from)}→${esc(m.to)}`).join(", ")}.
    <a href="#/settings">Set rates in Settings</a>.
  </div>`;
}

// ---- settle-up (partial allowed) -----------------------------------------

function openSettle(from, to, outstanding) {
  const amount = prompt(
    `Record a payment from ${from} to ${to}.\nOutstanding: ${fmt(outstanding)}\nEnter amount (in ${state.homeCurrency}):`,
    outstanding.toFixed(2)
  );
  if (amount == null) return;
  const amt = Number(amount);
  if (!(amt > 0)) return toast("Enter a positive amount.", true);
  submitWithRate("POST", "/api/settlements", { from, to, amount: amt, currency: state.homeCurrency }).then((res) => {
    if (res.ok) {
      state = res.data;
      toast("Settlement recorded.");
      render();
    }
  });
}

// ---- simplify view -------------------------------------------------------

function renderSimplify() {
  const { simplified, perPerson } = state.balances;
  const anyDebt = Object.values(perPerson).some((v) => Math.abs(v) > 0.005);
  app.innerHTML = `
    <h1>Simplify debts</h1>
    <p class="hint">The fewest payments that settle everyone. A read-only suggestion — your
    pairwise balances are unchanged.</p>
    <section class="card">
      ${
        !anyDebt
          ? "<em class='muted'>Everyone's settled up. 🎉</em>"
          : simplified.length
          ? `<ul class="pairlist">${simplified
              .map((t) => `<li><span><strong>${esc(t.from)}</strong> pays <strong>${esc(t.to)}</strong></span><span class="amt">${fmt(t.amount)}</span></li>`)
              .join("")}</ul>`
          : "<em class='muted'>Nothing to simplify.</em>"
      }
    </section>
  `;
}

// ---- person detail -------------------------------------------------------

function renderPerson(name) {
  const key = keyOf(name);
  const display = state.people.find((p) => keyOf(p) === key) || name;
  const net = state.balances.perPerson[display] ?? 0;
  const involved = state.balances.pairs.filter((p) => keyOf(p.debtor) === key || keyOf(p.creditor) === key);

  app.innerHTML = `
    <h1>${esc(display)}</h1>
    <p class="big ${net > 0.005 ? "owed" : net < -0.005 ? "owes" : "even"}">
      ${net > 0.005 ? `is owed ${fmt(net)}` : net < -0.005 ? `owes ${fmt(-net)}` : "is all settled up"}
    </p>
    <section class="card">
      <h2>Balances with others</h2>
      ${
        involved.length
          ? `<ul class="pairlist">${involved
              .map((p) => {
                const other = keyOf(p.debtor) === key ? p.creditor : p.debtor;
                const owes = keyOf(p.debtor) === key;
                return `<li>
                  <a href="#/pair/${encodeURIComponent(p.debtor)}/${encodeURIComponent(p.creditor)}">
                    ${owes ? `owes <strong>${esc(other)}</strong>` : `<strong>${esc(other)}</strong> owes them`}
                  </a>
                  <span class="amt">${fmt(p.amount)}</span>
                </li>`;
              })
              .join("")}</ul>`
          : "<em class='muted'>No open balances.</em>"
      }
    </section>
    <p><a href="#/balances">← Back to balances</a></p>
  `;
}

// ---- pair detail ---------------------------------------------------------

function renderPair(a, b) {
  const ka = keyOf(a);
  const kb = keyOf(b);
  const dispA = state.people.find((p) => keyOf(p) === ka) || a;
  const dispB = state.people.find((p) => keyOf(p) === kb) || b;

  const pair = state.balances.pairs.find(
    (p) => (keyOf(p.debtor) === ka && keyOf(p.creditor) === kb) || (keyOf(p.debtor) === kb && keyOf(p.creditor) === ka)
  );

  const bills = state.bills.filter((bill) => {
    const ks = bill.participants.map(keyOf);
    return ks.includes(ka) && ks.includes(kb);
  });
  const sortedPair = [ka, kb].sort();
  const settlements = state.settlements.filter((s) => {
    const pk = [keyOf(s.from), keyOf(s.to)].sort();
    return pk[0] === sortedPair[0] && pk[1] === sortedPair[1];
  });

  let headline = `${esc(dispA)} and ${esc(dispB)} are settled up`;
  let outstanding = 0;
  let debtor = dispA;
  let creditor = dispB;
  if (pair) {
    outstanding = pair.amount;
    debtor = pair.debtor;
    creditor = pair.creditor;
    headline = `<strong>${esc(pair.debtor)}</strong> owes <strong>${esc(pair.creditor)}</strong> ${fmt(pair.amount)}`;
  }

  app.innerHTML = `
    <h1>${esc(dispA)} ⇄ ${esc(dispB)}</h1>
    <p class="big">${headline}</p>
    ${pair ? `<button id="pair-settle">Settle up</button>` : ""}

    <section class="card">
      <h2>Shared bills</h2>
      ${
        bills.length
          ? `<ul class="feed">${bills
              .map(
                (bill) => `<li>
                  <span><strong>${esc(bill.description || "(no description)")}</strong>
                  <span class="muted">${esc(bill.date)} · paid by ${esc(bill.payer)}</span></span>
                  <span class="amt">${fmt(bill.grandTotal, bill.currency)}</span>
                  <a class="mini" href="#/edit/${bill.id}">edit</a>
                </li>`
              )
              .join("")}</ul>`
          : "<em class='muted'>No shared bills.</em>"
      }
    </section>

    <section class="card">
      <h2>Settlements</h2>
      ${
        settlements.length
          ? `<ul class="feed">${settlements
              .map(
                (s) => `<li>
                  <span><strong>${esc(s.from)}</strong> paid <strong>${esc(s.to)}</strong>
                  <span class="muted">${esc(s.date)}</span></span>
                  <span class="amt">${fmt(s.amount, s.currency)}</span>
                  <button class="del" data-settlement="${s.id}" title="Remove settlement">✕</button>
                </li>`
              )
              .join("")}</ul>`
          : "<em class='muted'>No settlements yet.</em>"
      }
    </section>
    <p><a href="#/balances">← Back to balances</a></p>
  `;

  const settleBtn = document.getElementById("pair-settle");
  if (settleBtn) settleBtn.onclick = () => openSettle(debtor, creditor, outstanding);

  document.querySelectorAll("[data-settlement]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Remove this settlement?")) return;
      const res = await api("DELETE", `/api/settlements/${btn.dataset.settlement}`);
      if (res.ok) {
        state = res.data;
        toast("Settlement removed.");
        render();
      }
    };
  });
}

// ---- bill list -----------------------------------------------------------

function renderBills() {
  const bills = [...state.bills].sort((a, b) => (a.date < b.date ? 1 : -1));
  app.innerHTML = `
    <h1>Bills</h1>
    <section class="card">
      ${
        bills.length
          ? `<ul class="feed">${bills
              .map(
                (bill) => `<li>
                  <span><strong>${esc(bill.description || "(no description)")}</strong>
                  <span class="muted">${esc(bill.date)} · paid by ${esc(bill.payer)} · ${bill.participants.length} people</span></span>
                  <span class="amt">${fmt(bill.grandTotal, bill.currency)}</span>
                  <a class="mini" href="#/edit/${bill.id}">edit</a>
                  <button class="del" data-bill="${bill.id}" title="Delete bill">✕</button>
                </li>`
              )
              .join("")}</ul>`
          : "<em class='muted'>No bills yet. <a href='#/add'>Add one</a>.</em>"
      }
    </section>
  `;

  document.querySelectorAll("[data-bill]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Delete this bill? Balances will be recomputed.")) return;
      const res = await api("DELETE", `/api/bills/${btn.dataset.bill}`);
      if (res.ok) {
        state = res.data;
        toast("Bill deleted.");
        render();
      }
    };
  });
}

// ---- settings ------------------------------------------------------------

function renderSettings() {
  const rateEntries = Object.entries(state.rates).sort((a, b) => a[0].localeCompare(b[0]));
  const you = getYou();
  app.innerHTML = `
    <h1>Settings</h1>
    <section class="card">
      <h2>Who are you?</h2>
      <p class="hint">Pick yourself to see your overall balance at the top of every page. Saved on this device only.</p>
      <div class="row">
        <select id="set-you" style="flex:1">
          <option value="">— not set —</option>
          ${state.people
            .map((p) => `<option ${keyOf(p) === keyOf(you) ? "selected" : ""}>${esc(p)}</option>`)
            .join("")}
        </select>
        <button id="save-you" type="button">Save</button>
      </div>
    </section>

    <section class="card">
      <h2>Home currency</h2>
      <p class="hint">All balances are shown in this currency. Changing it re-converts every balance.</p>
      <div class="row">
        <select id="set-home" style="flex:1">${currencyOptions(state.homeCurrency)}</select>
        <button id="save-home" type="button">Save</button>
      </div>
    </section>

    <section class="card">
      <h2>Exchange rates</h2>
      <p class="hint">1 unit of FROM = N units of TO. Set a rate for each currency pair you use.</p>
      ${
        rateEntries.length
          ? `<ul class="feed">${rateEntries
              .map(([pair, rate]) => `<li><span>${esc(pair.replace("->", " → "))}</span><span class="amt">${Number(rate).toFixed(4)}</span></li>`)
              .join("")}</ul>`
          : "<em class='muted'>No rates stored yet.</em>"
      }
      <div class="grid2" style="margin-top:1rem">
        <label>From<select id="rate-from">${currencyOptions(state.homeCurrency)}</select></label>
        <label>To<select id="rate-to">${currencyOptions(state.homeCurrency)}</select></label>
        <label>Rate<input id="rate-val" type="number" min="0" step="0.0001" placeholder="1.08" /></label>
      </div>
      <button id="save-rate" type="button">Set rate</button>
    </section>
  `;

  document.getElementById("save-you").onclick = () => {
    setYou(document.getElementById("set-you").value);
    renderYouBanner();
    toast("Saved who you are on this device.");
  };

  document.getElementById("save-home").onclick = async () => {
    const homeCurrency = document.getElementById("set-home").value.trim().toUpperCase();
    if (!homeCurrency) return;
    const res = await api("PUT", "/api/settings", { homeCurrency });
    if (res.ok) {
      state = res.data;
      document.getElementById("home-cur").textContent = `Home: ${state.homeCurrency} (${C.symbolOf(state.homeCurrency)})`;
      toast("Home currency updated.");
      render();
    }
  };

  document.getElementById("save-rate").onclick = async () => {
    const from = document.getElementById("rate-from").value.trim().toUpperCase();
    const to = document.getElementById("rate-to").value.trim().toUpperCase();
    const rate = Number(document.getElementById("rate-val").value);
    if (!from || !to || from === to || !(rate > 0)) return toast("Pick two different currencies and a positive rate.", true);
    const res = await api("PUT", "/api/rates", { from, to, rate });
    if (res.ok) {
      state = res.data;
      toast("Rate saved.");
      render();
    }
  };
}

// ---- boot ----------------------------------------------------------------

window.addEventListener("hashchange", render);
refresh();
