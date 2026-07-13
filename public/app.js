const app = document.getElementById("app");

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

function fmt(n, cur) {
  const currency = cur || (state && state.homeCurrency) || "USD";
  return `${currency} ${Number(n).toFixed(2)}`;
}

function toast(msg, isError) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (isError ? " error" : "");
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 3500);
}

function keyOf(name) {
  return String(name).trim().toLowerCase();
}

function nav(hash) {
  location.hash = hash;
}

// When the server asks for a manual rate (409), collect it and merge into body.
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
  document.getElementById("home-cur").textContent = `Home: ${state.homeCurrency}`;
  render();
}

function render() {
  const { name, args } = parseRoute();
  document.querySelectorAll("#nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === name);
  });
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
  return {
    id: bill.id,
    date: bill.date,
    description: bill.description,
    currency: bill.currency,
    payer: bill.payer,
    participants: [...bill.participants],
    items: bill.items.map((it) => ({
      label: it.label,
      amount: String(it.amount),
      assignees: [...it.assignees],
    })),
    tax: String(bill.tax || ""),
    tip: String(bill.tip || ""),
    grandTotal: String(bill.grandTotal || ""),
  };
}

// Read the current DOM values back into `form` before a structural re-render.
function syncForm() {
  if (!form) return;
  const val = (id) => (document.getElementById(id) ? document.getElementById(id).value : "");
  form.description = val("f-desc");
  form.date = val("f-date");
  form.currency = (val("f-currency") || form.currency).toUpperCase();
  form.tax = val("f-tax");
  form.tip = val("f-tip");
  form.grandTotal = val("f-grandtotal");
  const payerEl = document.getElementById("f-payer");
  if (payerEl) form.payer = payerEl.value;
  form.items.forEach((it, i) => {
    const l = document.getElementById(`item-label-${i}`);
    const a = document.getElementById(`item-amount-${i}`);
    if (l) it.label = l.value;
    if (a) it.amount = a.value;
  });
}

function computedTotal() {
  const items = form.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  return items + (Number(form.tax) || 0) + (Number(form.tip) || 0);
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
  const total = computedTotal();
  const gt = Number(form.grandTotal) || 0;
  const reconciled = Math.abs(total - gt) <= 0.01;

  app.innerHTML = `
    <h1>${isEdit ? "Edit bill" : "Add a bill"}</h1>
    <section class="card">
      <div class="grid2">
        <label>Description
          <input id="f-desc" value="${esc(form.description)}" placeholder="Dinner at Luigi's" />
        </label>
        <label>Date
          <input id="f-date" type="date" value="${esc(form.date)}" />
        </label>
        <label>Currency
          <input id="f-currency" value="${esc(form.currency)}" maxlength="3" style="text-transform:uppercase" />
        </label>
        <label>Paid by
          <select id="f-payer">
            <option value="">— choose payer —</option>
            ${form.participants
              .map((p) => `<option ${keyOf(p) === keyOf(form.payer) ? "selected" : ""}>${esc(p)}</option>`)
              .join("")}
          </select>
        </label>
      </div>

      <h2>Participants</h2>
      <div class="chips">
        ${
          form.participants.map((p) => `<span class="chip">${esc(p)}<button class="chip-x" data-remove-participant="${esc(p)}">✕</button></span>`).join("") ||
          "<em class='muted'>Add the people on this bill.</em>"
        }
      </div>
      <div class="row">
        <input id="new-participant" list="known-people" placeholder="Add a person…" />
        <datalist id="known-people">
          ${people.map((p) => `<option value="${esc(p)}"></option>`).join("")}
        </datalist>
        <button id="add-participant" type="button">Add</button>
      </div>

      <h2>Items</h2>
      <table class="items">
        <thead>
          <tr>
            <th>Item</th><th class="num">Amount</th>
            ${form.participants.map((p) => `<th class="who" title="${esc(p)}">${esc(p)}</th>`).join("")}
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
      <p class="hint">An item with no one checked is split evenly among all participants.</p>
      <button id="add-item" type="button" class="ghost">+ Add item</button>

      <div class="grid2" style="margin-top:1rem">
        <label>Tax
          <input id="f-tax" type="number" min="0" step="0.01" value="${esc(form.tax)}" placeholder="0.00" />
        </label>
        <label>Tip
          <input id="f-tip" type="number" min="0" step="0.01" value="${esc(form.tip)}" placeholder="0.00" />
        </label>
        <label>Grand total (from receipt)
          <input id="f-grandtotal" type="number" min="0" step="0.01" value="${esc(form.grandTotal)}" placeholder="0.00" />
        </label>
      </div>

      <div class="reconcile ${reconciled ? "ok" : "bad"}">
        Items + tax + tip = <strong>${fmt(total, form.currency)}</strong>
        · Grand total = <strong>${fmt(gt, form.currency)}</strong>
        ${reconciled ? "✓ matches" : "✗ does not match — adjust before saving"}
      </div>

      <div class="actions">
        <button id="save-bill" type="button" ${reconciled ? "" : "disabled"}>${isEdit ? "Save changes" : "Add bill"}</button>
        ${isEdit ? `<button id="cancel-edit" type="button" class="ghost">Cancel</button>` : ""}
      </div>
    </section>
  `;

  wireAddView();
}

function wireAddView() {
  const recompute = () => {
    syncForm();
    renderAdd(form.id); // re-render to update reconcile + payer options
  };

  document.getElementById("add-participant").onclick = () => {
    const input = document.getElementById("new-participant");
    const name = input.value.trim();
    if (name && !form.participants.some((p) => keyOf(p) === keyOf(name))) {
      syncForm();
      form.participants.push(name);
      renderAdd(form.id);
    }
  };
  document.getElementById("new-participant").onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("add-participant").click();
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

  document.getElementById("add-item").onclick = () => {
    syncForm();
    form.items.push({ label: "", amount: "", assignees: [] });
    renderAdd(form.id);
  };

  document.querySelectorAll("[data-remove-item]").forEach((btn) => {
    btn.onclick = () => {
      syncForm();
      const i = Number(btn.dataset.removeItem);
      form.items.splice(i, 1);
      if (form.items.length === 0) form.items.push({ label: "", amount: "", assignees: [] });
      renderAdd(form.id);
    };
  });

  document.querySelectorAll('input[type="checkbox"][data-item]').forEach((cb) => {
    cb.onchange = () => {
      syncForm();
      const i = Number(cb.dataset.item);
      const who = cb.dataset.who;
      const item = form.items[i];
      if (cb.checked) {
        if (!item.assignees.some((a) => keyOf(a) === keyOf(who))) item.assignees.push(who);
      } else {
        item.assignees = item.assignees.filter((a) => keyOf(a) !== keyOf(who));
      }
    };
  });

  // Live reconcile feedback as amounts/tax/tip/total change.
  ["f-tax", "f-tip", "f-grandtotal"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.oninput = recompute;
  });
  form.items.forEach((_, i) => {
    const a = document.getElementById(`item-amount-${i}`);
    if (a) a.oninput = recompute;
  });

  const cancel = document.getElementById("cancel-edit");
  if (cancel) cancel.onclick = () => nav("#/bills");

  document.getElementById("save-bill").onclick = async () => {
    syncForm();
    const payload = {
      date: form.date,
      description: form.description,
      currency: form.currency,
      payer: form.payer,
      participants: form.participants,
      items: form.items
        .filter((it) => it.label.trim() || Number(it.amount) > 0)
        .map((it) => ({ label: it.label, amount: Number(it.amount) || 0, assignees: it.assignees })),
      tax: Number(form.tax) || 0,
      tip: Number(form.tip) || 0,
      grandTotal: Number(form.grandTotal) || 0,
    };
    const isEdit = form.id != null;
    const res = await submitWithRate(
      isEdit ? "PUT" : "POST",
      isEdit ? `/api/bills/${form.id}` : "/api/bills",
      payload
    );
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
              <button class="settle-btn" data-from="${esc(p.debtor)}" data-to="${esc(p.creditor)}" data-amt="${p.amount}">Settle up</button>
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

function missingRatesBanner(missingRates) {
  if (!missingRates || !missingRates.length) return "";
  return `<div class="banner warn">
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
  submitWithRate("POST", "/api/settlements", {
    from,
    to,
    amount: amt,
    currency: state.homeCurrency,
  }).then((res) => {
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
    <p class="hint">Suggested payments that settle everyone with the fewest transfers. This is a
    read-only suggestion — your pairwise balances are unchanged.</p>
    <section class="card">
      ${
        !anyDebt
          ? "<em class='muted'>Everyone's settled up. 🎉</em>"
          : simplified.length
          ? `<ul class="pairlist">${simplified
              .map(
                (t) =>
                  `<li><span><strong>${esc(t.from)}</strong> pays <strong>${esc(t.to)}</strong></span><span class="amt">${fmt(t.amount)}</span></li>`
              )
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
  const settlements = state.settlements.filter((s) => {
    const pairKeys = [keyOf(s.from), keyOf(s.to)].sort();
    return pairKeys[0] === [ka, kb].sort()[0] && pairKeys[1] === [ka, kb].sort()[1];
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
  app.innerHTML = `
    <h1>Settings</h1>
    <section class="card">
      <h2>Home currency</h2>
      <p class="hint">All balances are shown in this currency. Changing it re-converts every balance.</p>
      <div class="row">
        <input id="set-home" value="${esc(state.homeCurrency)}" maxlength="3" style="text-transform:uppercase" />
        <button id="save-home" type="button">Save</button>
      </div>
    </section>

    <section class="card">
      <h2>Exchange rates</h2>
      <p class="hint">1 unit of FROM = N units of TO. Fetched automatically when possible; override here.</p>
      ${
        rateEntries.length
          ? `<ul class="feed">${rateEntries
              .map(([pair, rate]) => `<li><span>${esc(pair.replace("->", " → "))}</span><span class="amt">${Number(rate).toFixed(4)}</span></li>`)
              .join("")}</ul>`
          : "<em class='muted'>No rates stored yet.</em>"
      }
      <div class="grid2" style="margin-top:1rem">
        <label>From<input id="rate-from" maxlength="3" placeholder="EUR" style="text-transform:uppercase" /></label>
        <label>To<input id="rate-to" maxlength="3" placeholder="USD" style="text-transform:uppercase" /></label>
        <label>Rate<input id="rate-val" type="number" min="0" step="0.0001" placeholder="1.08" /></label>
      </div>
      <button id="save-rate" type="button">Set rate</button>
    </section>
  `;

  document.getElementById("save-home").onclick = async () => {
    const homeCurrency = document.getElementById("set-home").value.trim().toUpperCase();
    if (!homeCurrency) return;
    const res = await api("PUT", "/api/settings", { homeCurrency });
    if (res.ok) {
      state = res.data;
      document.getElementById("home-cur").textContent = `Home: ${state.homeCurrency}`;
      toast("Home currency updated.");
      render();
    }
  };

  document.getElementById("save-rate").onclick = async () => {
    const from = document.getElementById("rate-from").value.trim().toUpperCase();
    const to = document.getElementById("rate-to").value.trim().toUpperCase();
    const rate = Number(document.getElementById("rate-val").value);
    if (!from || !to || !(rate > 0)) return toast("Enter from, to and a positive rate.", true);
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
