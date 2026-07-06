const app = document.getElementById("app");

async function getState() {
  const res = await fetch("/api/state");
  return res.json();
}

async function post(url, body) {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function removeExpense(id) {
  await fetch(`/api/expenses/${id}`, { method: "DELETE" });
}

function money(n) {
  return `$${Number(n).toFixed(2)}`;
}

function render(state) {
  const { people, expenses, balances } = state;

  app.innerHTML = `
    <h1>💸 Bill Splitter</h1>

    <section class="card">
      <h2>People</h2>
      <div class="people">
        ${people.map((p) => `<span class="chip">${p}</span>`).join("") || "<em>No one yet</em>"}
      </div>
      <div class="row">
        <input id="person-name" placeholder="Add a person…" />
        <button id="add-person">Add</button>
      </div>
    </section>

    <section class="card">
      <h2>Add an expense</h2>
      <input id="exp-desc" placeholder="Description (e.g. Dinner)" />
      <div class="row">
        <label>Paid by
          <select id="exp-payer">${people.map((p) => `<option>${p}</option>`).join("")}</select>
        </label>
        <label>Amount
          <input id="exp-amount" type="number" min="0" step="0.01" placeholder="0.00" />
        </label>
      </div>
      <div class="split-for">
        <span>Split between:</span>
        ${people
          .map(
            (p) =>
              `<label class="check"><input type="checkbox" class="participant" value="${p}" checked /> ${p}</label>`
          )
          .join("")}
      </div>
      <button id="add-expense">Add expense</button>
    </section>

    <section class="card">
      <h2>Expenses</h2>
      <ul class="expenses">
        ${
          expenses
            .map(
              (e) => `
          <li>
            <span><strong>${e.description || "(no description)"}</strong> — ${money(e.amount)} paid by ${e.payer}</span>
            <span class="muted">split ${e.participants.length} ways</span>
            <button class="del" data-id="${e.id}" title="Remove">✕</button>
          </li>`
            )
            .join("") || "<em>No expenses yet</em>"
        }
      </ul>
    </section>

    <section class="card settle">
      <h2>Settle up</h2>
      <ul>
        ${Object.entries(balances)
          .map(([name, bal]) => {
            const cls = bal > 0 ? "owed" : bal < 0 ? "owes" : "even";
            const label =
              bal > 0 ? `is owed ${money(bal)}` : bal < 0 ? `owes ${money(-bal)}` : "is settled up";
            return `<li class="${cls}"><strong>${name}</strong> ${label}</li>`;
          })
          .join("")}
      </ul>
    </section>
  `;

  document.getElementById("add-person").onclick = async () => {
    const input = document.getElementById("person-name");
    if (input.value.trim()) {
      await post("/api/people", { name: input.value.trim() });
      refresh();
    }
  };

  document.getElementById("add-expense").onclick = async () => {
    const description = document.getElementById("exp-desc").value;
    const payer = document.getElementById("exp-payer").value;
    const amount = document.getElementById("exp-amount").value;
    const participants = [...document.querySelectorAll(".participant:checked")].map((c) => c.value);
    if (payer && amount && participants.length) {
      await post("/api/expenses", { description, payer, amount, participants });
      refresh();
    }
  };

  document.querySelectorAll(".del").forEach((btn) => {
    btn.onclick = async () => {
      await removeExpense(Number(btn.dataset.id));
      refresh();
    };
  });
}

async function refresh() {
  render(await getState());
}

refresh();
