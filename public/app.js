const app = document.getElementById("app");
const C = window.Currencies;
const Split = window.Split;

// ---- global state --------------------------------------------------------

let state = null; // latest /api/state payload
let splitBetween = null; // Set of names currently checked in the expense form

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

const AVATAR_COLORS = ["--avatar-1", "--avatar-2", "--avatar-3", "--avatar-4", "--avatar-5", "--avatar-6"];

function avatarColor(name) {
  const idx = (state.people || []).findIndex((p) => keyOf(p) === keyOf(name));
  const i = idx === -1 ? 0 : idx % AVATAR_COLORS.length;
  return `var(${AVATAR_COLORS[i]})`;
}

function avatar(name, size) {
  const initial = esc(String(name || "?").trim().charAt(0).toUpperCase());
  return `<span class="avatar${size === "lg" ? " lg" : ""}" style="background:${avatarColor(name)}">${initial}</span>`;
}

function toast(msg, isError) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (isError ? " error" : "");
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 3500);
}

// ---- header: person pills -------------------------------------------------

function renderHeaderPeople() {
  const el = document.getElementById("header-people");
  el.innerHTML = (state.people || [])
    .map((p) => `<span class="person-pill">${avatar(p)} ${esc(p)}</span>`)
    .join("");
}

// ---- settle up -------------------------------------------------------------

function renderSettleUp() {
  const people = state.people || [];
  if (!people.length) {
    return `<section class="settle-up">
      <div class="settle-up-title">Settle up</div>
      <p class="settle-empty">Add people and an expense to see balances.</p>
    </section>`;
  }
  const cards = people
    .map((p) => {
      const { status, amount } = Split.netPosition(state.balances.perPerson, p);
      const label = status === "owed" ? "is owed" : status === "owes" ? "owes" : "settled up";
      return `<div class="settle-card">
        <div class="settle-who">${avatar(p)} ${esc(p)}</div>
        <div class="settle-amt ${status}">${fmt(amount)}</div>
        <div class="settle-label">${label}</div>
      </div>`;
    })
    .join("");
  return `<section class="settle-up">
    <div class="settle-up-title">Settle up</div>
    <div class="settle-grid">${cards}</div>
  </section>`;
}

// ---- add an expense --------------------------------------------------------

function renderAddExpense() {
  const people = state.people || [];
  if (splitBetween == null) splitBetween = new Set(people.map(keyOf));

  const chips = people
    .map(
      (p) => `<label class="split-chip">
        <input type="checkbox" data-split="${esc(p)}" ${splitBetween.has(keyOf(p)) ? "checked" : ""} />
        ${esc(p)}
      </label>`
    )
    .join("");

  return `<section class="card">
    <h2>Add an expense</h2>
    <input id="f-desc" placeholder="What was it for? (e.g. Dinner)" />
    <div class="field-row">
      <label>Paid by
        <select id="f-payer">
          ${people.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("") || `<option value="">— add people first —</option>`}
        </select>
      </label>
      <label>Amount
        <input id="f-amount" type="number" min="0" step="0.01" placeholder="0.00" />
      </label>
    </div>
    <div class="split-label">Split between</div>
    <div class="chips">${chips || "<em class='empty'>Add people below to split with them.</em>"}</div>
    <button id="add-expense" type="button">Add expense</button>
  </section>`;
}

// ---- people & expenses columns ---------------------------------------------

function renderPeopleCard() {
  const people = state.people || [];
  return `<section class="card">
    <h2>People</h2>
    <ul class="people-list">
      ${people.map((p) => `<li>${avatar(p)} ${esc(p)}</li>`).join("") || "<li class='empty'>No one yet.</li>"}
    </ul>
    <div class="add-person-row">
      <input id="new-person" placeholder="Add a person" />
      <button id="add-person" type="button" class="ghost">Add</button>
    </div>
  </section>`;
}

function renderExpensesCard() {
  const bills = [...state.bills].sort((a, b) => (a.id < b.id ? 1 : -1));
  return `<section class="card">
    <h2>Expenses</h2>
    <ul class="expense-list">
      ${
        bills
          .map((bill) => {
            const ways = (bill.items[0] && bill.items[0].assignees.length) || bill.participants.length;
            return `<li>
              <div class="expense-info">
                <div class="expense-desc">${esc(bill.description || "(no description)")}</div>
                <div class="expense-meta">${esc(bill.payer)} paid · split ${ways} way${ways === 1 ? "" : "s"}</div>
              </div>
              <span class="expense-amt">${fmt(bill.grandTotal, bill.currency)}</span>
              <button class="del" data-bill="${bill.id}" title="Delete expense">✕</button>
            </li>`;
          })
          .join("") || "<li class='empty'>No expenses yet.</li>"
      }
    </ul>
  </section>`;
}

// ---- main render ------------------------------------------------------------

function render() {
  renderHeaderPeople();
  app.innerHTML = `
    ${renderSettleUp()}
    ${renderAddExpense()}
    <div class="columns">
      ${renderPeopleCard()}
      ${renderExpensesCard()}
    </div>
  `;
  wireApp();
}

function wireApp() {
  document.querySelectorAll("[data-split]").forEach((cb) => {
    cb.onchange = () => {
      const key = keyOf(cb.dataset.split);
      if (cb.checked) splitBetween.add(key);
      else splitBetween.delete(key);
    };
  });

  const addExpense = document.getElementById("add-expense");
  if (addExpense) {
    addExpense.onclick = async () => {
      const description = document.getElementById("f-desc").value.trim();
      const payer = document.getElementById("f-payer").value;
      const amount = Number(document.getElementById("f-amount").value);
      const checked = state.people.filter((p) => splitBetween.has(keyOf(p)));

      if (!payer) return toast("Add a person and choose who paid.", true);
      if (!(amount > 0)) return toast("Enter an amount greater than 0.", true);
      if (!checked.length) return toast("Choose at least one person to split between.", true);

      const participants = checked.some((p) => keyOf(p) === keyOf(payer)) ? checked : [...checked, payer];

      const bill = {
        date: new Date().toISOString().slice(0, 10),
        description,
        currency: state.homeCurrency,
        payer,
        participants,
        items: [{ label: description || "Expense", amount, assignees: checked }],
        tax: 0,
        tip: 0,
        grandTotal: amount,
      };

      const res = await api("POST", "/api/bills", bill);
      if (res.ok) {
        state = res.data;
        splitBetween = null;
        toast("Expense added.");
        render();
      } else {
        toast(res.data.error || "Could not add expense.", true);
      }
    };
  }

  document.querySelectorAll("[data-bill]").forEach((btn) => {
    btn.onclick = async () => {
      const res = await api("DELETE", `/api/bills/${btn.dataset.bill}`);
      if (res.ok) {
        state = res.data;
        toast("Expense deleted.");
        render();
      }
    };
  });

  const addPersonBtn = document.getElementById("add-person");
  const newPersonInput = document.getElementById("new-person");
  if (addPersonBtn) {
    addPersonBtn.onclick = async () => {
      const name = newPersonInput.value.trim();
      if (!name) return;
      const res = await api("POST", "/api/people", { name });
      if (res.ok) {
        state = res.data;
        if (splitBetween) splitBetween.add(keyOf(name));
        toast("Person added.");
        render();
      } else {
        toast(res.data.error || "Could not add person.", true);
      }
    };
  }
  if (newPersonInput) {
    newPersonInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addPersonBtn.click();
      }
    };
  }
}

// ---- boot ----------------------------------------------------------------

async function refresh() {
  state = await getState();
  render();
}

refresh();
