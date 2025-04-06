// ================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ================================
async function postJson(url, data) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  return await resp.json();
}

function startCsvUpload() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.onchange = handleCsvSelected;
  input.click();
}

function parseCsvText(text) {
  const rows = text.split("\n").map(r => r.split(","));
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(cells => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ? cells[i].trim() : "";
    });
    return obj;
  });
}

// ================================
// ХРАНИЛИЩЕ ОПЕРАЦИЙ
// ================================
let operations = [];

// ================================
// ОТРИСОВКА ТАБЛИЦЫ
// ================================
function renderTable() {
  const body = document.getElementById("operations-body");
  body.innerHTML = "";

  operations.forEach(op => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${op.date}</td>
      <td>${op.category}</td>
      <td>${op.withdrawal || ""}</td>
      <td>${op.deposit || ""}</td>
      <td>${op.balance || ""}</td>
    `;
    body.appendChild(tr);
  });

  updateAnalytics();
}

// ================================
// ПРЕОБРАЗОВАНИЕ CSV → ОПЕРАЦИЙ
// ================================
function mapRowToOp(row, id) {
  return {
    id,
    date: row["Date"] || row["Date.1"] || "",
    category: row["Category"] || "",
    withdrawal: parseFloat(row["Withdrawal"] || 0),
    deposit: parseFloat(row["Deposit"] || 0),
    balance: parseFloat(row["Balance"] || 0),
    ref_no: row["RefNo"] || ""
  };
}

// ================================
// ОТРИСОВКА ГРАФИКА + АНАЛИТИКИ
// ================================
let balanceChart = null;

function updateAnalytics() {
  updateCategoryFilter();
  updateBalanceChart();
  updatePeriodOps();
}

function updateCategoryFilter() {
  const select = document.getElementById("analytics-category");
  const categories = [...new Set(operations.map(o => o.category))];

  select.innerHTML = `<option value="__all__">Все категории</option>`;
  categories.forEach(cat => {
    if (!cat) return;
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
}

function updateBalanceChart() {
  const ctx = document.getElementById("balance-chart");
  const labels = operations.map(o => o.date);
  const data = operations.map(o => o.balance);

  if (balanceChart) balanceChart.destroy();

  balanceChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Баланс",
        data
      }]
    },
    options: { responsive: true }
  });
}

function updatePeriodOps() {
  const list = document.getElementById("period-ops-list");
  const summary = document.getElementById("period-summary");

  list.innerHTML = "";
  if (!operations.length) return;

  let totalDeposit = 0;
  let totalWithdrawal = 0;

  operations.forEach(op => {
    totalDeposit += op.deposit;
    totalWithdrawal += op.withdrawal;

    const li = document.createElement("li");
    li.textContent = `${op.date}: ${op.category} (+${op.deposit}, -${op.withdrawal})`;
    list.appendChild(li);
  });

  summary.textContent = `
    +${totalDeposit.toFixed(2)} / -${totalWithdrawal.toFixed(2)}
  `;
}

// ================================
// ОБРАБОТКА ЗАГРУЖЕННОГО CSV
// ================================
async function handleCsvSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const text = await file.text();

  // 1) Парсим CSV
  const parsed = parseCsvText(text);
  operations = parsed.map((row, idx) => mapRowToOp(row, idx));

  // 2) Отобразить без категорий
  renderTable();

  // 3) Дополнить категории через МЛ-модель
  postJson("/api/predict_category_csv", { csv: text, retrain: false })
    .then(result => {
      const predicted = result.rows || [];

      predicted.forEach((p, i) => {
        if (!operations[i].category || operations[i].category.trim() === "") {
          operations[i].category = p.category || p.Category;
        }
      });

      renderTable();
    })
    .catch(err => {
      console.warn("ML error:", err);
    });
}

// ================================
// ВАЖНО: НИЧЕГО НЕ ЗАГРУЖАТЬ АВТОМАТИЧЕСКИ
// ================================

// РАНЬШЕ БЫЛО:
// loadInitialOperationsFromCsv();

// ТЕПЕРЬ НЕТ.
// Данные загружаются ТОЛЬКО через кнопку.

