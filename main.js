import Chart from "chart.js";

// Use mutable operations, will be filled from CSV / backend ML
let operations = [];

// Fallback sample operations if CSV/ML is unavailable
const SAMPLE_OPERATIONS = [
  // amount > 0 = доход, < 0 = расход
  { id: 1, category: "Зарплата", title: "Основная работа", amount: 95000, date: "2025-11-01", mandatory: false },
  { id: 2, category: "Обязательные платежи", title: "Аренда квартиры", amount: -40000, date: "2025-11-02", mandatory: true },
  { id: 3, category: "Обязательные платежи", title: "Коммунальные услуги", amount: -8000, date: "2025-11-05", mandatory: true },
  { id: 4, category: "Транспорт", title: "Проездной", amount: -2500, date: "2025-11-06", mandatory: false },
  { id: 5, category: "Питание", title: "Продукты", amount: -12000, date: "2025-11-08", mandatory: false },
  { id: 6, category: "Подработка", title: "Фриланс-проект", amount: 18000, date: "2025-11-10", mandatory: false },
  { id: 7, category: "Развлечения", title: "Кино и кафе", amount: -4500, date: "2025-11-13", mandatory: false },
  { id: 8, category: "Накопления", title: "Перевод в сбережения", amount: -10000, date: "2025-11-15", mandatory: false },
  { id: 9, category: "Зарплата", title: "Бонус", amount: 15000, date: "2025-11-20", mandatory: false },
  { id: 10, category: "Обязательные платежи", title: "Кредит", amount: -7000, date: "2025-11-22", mandatory: true }
];

const els = {
  tableBody: document.getElementById("operations-body"),
  dateFrom: document.getElementById("date-from"),
  dateTo: document.getElementById("date-to"),
  periodList: document.getElementById("period-ops-list"),
  periodSummary: document.getElementById("period-summary"),
  analysis: document.getElementById("analysis-content"),
  chartCanvas: document.getElementById("balance-chart"),
  notifBell: document.getElementById("notif-bell"),
  notifList: document.getElementById("notif-list"),
  analyticsCategory: document.getElementById("analytics-category"),
  categorySearch: document.getElementById("category-search")
};

let balanceChart = null;
let lastCushion = null;
let unreadNotifications = [];

function renderTable() {
  const searchRaw = (els.categorySearch && els.categorySearch.value) ? els.categorySearch.value.toString().trim().toLowerCase() : "";
  // simple normalize: remove non-alphanum and lower
  const normalize = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9а-яё\s]/gi, "").trim();

  els.tableBody.innerHTML = "";
  operations
    .slice()
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .forEach((op) => {
      // filter by category search with fuzzy/substring matching
      if (searchRaw) {
        const nCat = normalize(op.category);
        const nSearch = normalize(searchRaw);
        if (!nCat.includes(nSearch)) {
          // also try splitting words and partial match
          const parts = nSearch.split(/\s+/).filter(Boolean);
          const matched = parts.some(p => nCat.includes(p));
          if (!matched) return;
        }
      }

      const tr = document.createElement("tr");

      // Date
      const tdDate = document.createElement("td");
      tdDate.textContent = op.date ? op.date.split("-").reverse().join(".") : "";
      tr.appendChild(tdDate);

      // Category (editable)
      const tdCat = document.createElement("td");
      tdCat.textContent = op.category || "Без категории";
      tdCat.className = "category-cell";
      tdCat.contentEditable = "true";
      tdCat.addEventListener("blur", () => {
        op.category = tdCat.textContent.trim() || "Без категории";
        updateAnalytics();
      });
      tr.appendChild(tdCat);

      // Withdrawal
      const tdWithdraw = document.createElement("td");
      const w = Number(op.withdrawal || 0);
      tdWithdraw.textContent = w ? `-${Math.abs(w).toLocaleString("ru-RU")} ₽` : "";
      tdWithdraw.className = "amount-cell amount-expense";
      tr.appendChild(tdWithdraw);

      // Deposit
      const tdDeposit = document.createElement("td");
      const d = Number(op.deposit || 0);
      tdDeposit.textContent = d ? `+${Math.abs(d).toLocaleString("ru-RU")} ₽` : "";
      tdDeposit.className = "amount-cell amount-income";
      tr.appendChild(tdDeposit);

      // Balance
      const tdBalance = document.createElement("td");
      const b = Number(op.balance || 0);
      tdBalance.textContent = b !== 0 ? `${b.toLocaleString("ru-RU")} ₽` : "";
      tr.appendChild(tdBalance);

      els.tableBody.appendChild(tr);
    });
}

function initPeriod() {
  if (!operations.length) {
    els.dateFrom.value = "";
    els.dateTo.value = "";
    return;
  }
  const dates = operations.map((o) => o.date).sort();
  const min = dates[0];
  const max = dates[dates.length - 1];
  els.dateFrom.value = min;
  els.dateTo.value = max;
}

function getSelectedCategoryFilter() {
  if (!els.analyticsCategory) return null;
  const v = els.analyticsCategory.value;
  return v && v !== "__all__" ? v : null;
}

function filterByPeriod() {
  const from = els.dateFrom.value || "1900-01-01";
  const to = els.dateTo.value || "9999-12-31";
  const catFilter = getSelectedCategoryFilter();
  return operations.filter((o) => {
    if (!(o.date >= from && o.date <= to)) return false;
    if (catFilter) {
      // simple normalize compare
      return (o.category || "").toString().toLowerCase() === catFilter.toString().toLowerCase();
    }
    return true;
  });
}

function renderPeriodList(periodOps) {
  els.periodList.innerHTML = "";
  if (!periodOps.length) {
    const li = document.createElement("li");
    li.textContent = "За выбранный период операций нет.";
    els.periodList.appendChild(li);
    els.periodSummary.textContent = "";
    return;
  }

  let totalIncome = 0;
  let totalExpense = 0;

  periodOps
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((op) => {
      const li = document.createElement("li");

      const main = document.createElement("div");
      main.className = "period-op-main";

      const title = document.createElement("span");
      title.className = "period-op-title";
      title.textContent = op.title;

      const meta = document.createElement("span");
      meta.className = "period-op-meta";
      meta.textContent = `${op.category} • ${op.date.split("-").reverse().join(".")}${op.mandatory ? " • обязательный" : ""}`;

      main.append(title, meta);

      const amt = document.createElement("span");
      amt.className = "period-op-amount " + (op.amount >= 0 ? "amount-income" : "amount-expense");
      const sign = op.amount > 0 ? "+" : "";
      amt.textContent = `${sign}${op.amount.toLocaleString("ru-RU")} ₽`;

      li.append(main, amt);
      els.periodList.appendChild(li);

      if (op.amount >= 0) totalIncome += op.amount;
      else totalExpense += Math.abs(op.amount);
    });

  const net = totalIncome - totalExpense;
  const netLabel = net >= 0 ? "профицит" : "дефицит";
  els.periodSummary.textContent = `${totalIncome.toLocaleString("ru-RU")} ₽ доходы • ${totalExpense.toLocaleString("ru-RU")} ₽ расходы • ${netLabel} ${Math.abs(net).toLocaleString("ru-RU")} ₽`;
}

function updateChart(periodOps) {
  let income = 0;
  let expenses = 0;
  periodOps.forEach((op) => {
    if (op.amount >= 0) income += op.amount;
    else expenses += Math.abs(op.amount);
  });

  const data = [income, expenses];
  const hasData = income > 0 || expenses > 0;

  if (balanceChart) {
    balanceChart.destroy();
  }

  balanceChart = new Chart(els.chartCanvas, {
    type: "doughnut",
    data: {
      labels: ["Доходы", "Расходы"],
      datasets: [
        {
          data: hasData ? data : [1, 1],
          backgroundColor: ["#2a9d8f", "#e76f51"],
          borderWidth: 0,
          hoverOffset: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            font: { size: 10 }
          }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (!hasData) return "Нет данных";
              const label = ctx.label;
              const value = ctx.raw;
              const total = income + expenses || 1;
              const pct = ((value / total) * 100).toFixed(1);
              return `${label}: ${value.toLocaleString("ru-RU")} ₽ (${pct}%)`;
            }
          }
        }
      },
      cutout: "60%"
    }
  });
}

function computeSummary(periodOps) {
  const totalIncome = periodOps.filter((o) => o.amount > 0).reduce((s, o) => s + o.amount, 0);
  const totalExpense = periodOps.filter((o) => o.amount < 0).reduce((s, o) => s + Math.abs(o.amount), 0);
  const mandatoryExpense = periodOps
    .filter((o) => o.amount < 0 && o.mandatory)
    .reduce((s, o) => s + Math.abs(o.amount), 0);
  const variableExpense = totalExpense - mandatoryExpense;
  const net = totalIncome - totalExpense;

  const months = Math.max(1, Math.round(periodOps.length / 8)); // грубая оценка периода в месяцах
  const avgIncome = totalIncome / months || 0;
  const avgExpense = totalExpense / months || 0;
  const avgMandatory = mandatoryExpense / months || 0;
  const avgVariable = variableExpense / months || 0;

  const savingsRate = avgIncome > 0 ? (1 - avgExpense / avgIncome) : 0; // доля, остающаяся после расходов
  const sustainability =
    savingsRate > 0.3 ? "высокая" : savingsRate > 0.1 ? "средняя" : savingsRate > 0 ? "низкая" : "отрицательная";

  // считаем, что «финансовая подушка» = накопленный профицит за период
  const cushion = net > 0 ? net : 0;
  const monthsCover = avgMandatory > 0 ? cushion / avgMandatory : 0;

  return {
    totalIncome,
    totalExpense,
    mandatoryExpense,
    variableExpense,
    net,
    avgIncome,
    avgExpense,
    avgMandatory,
    avgVariable,
    savingsRate,
    sustainability,
    cushion,
    monthsCover
  };
}

function renderAnalysis(periodOps) {
  const s = computeSummary(periodOps);

  const fmt = (v) => v.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  const fmt1 = (v) => v.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  const pct = (v) => (v * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " %";

  const structureIncomePart = s.totalIncome ? pct(s.totalIncome / (s.totalIncome + s.totalExpense || 1)) : "—";
  const structureExpensePart = s.totalExpense ? pct(s.totalExpense / (s.totalIncome + s.totalExpense || 1)) : "—";
  const mandatoryShare = s.totalExpense ? pct(s.mandatoryExpense / s.totalExpense) : "—";
  const variableShare = s.totalExpense ? pct(s.variableExpense / s.totalExpense) : "—";

  const cushionQuality =
    s.monthsCover >= 6 ? "достаточная на случай потери дохода" : s.monthsCover >= 3 ? "базовая, но требующая наращивания" : "недостаточная";

  const recs = [];

  if (s.savingsRate <= 0) {
    recs.push("Расходы превышают доходы — важно ограничить переменные траты и временно отказаться от необязательных покупок.");
  } else if (s.savingsRate < 0.1) {
    recs.push("Ставка сбережений ниже 10 % — попробуйте зафиксировать автоматический перевод хотя бы 5–10 % дохода в отдельный накопительный счёт.");
  } else {
    recs.push("Вы уже откладываете значимую часть дохода — важно поддерживать текущий уровень сбережений и регулярно индексировать сумму.");
  }

  if (s.variableExpense > s.mandatoryExpense) {
    recs.push("Переменные расходы превышают обязательные — есть потенциал для оптимизации развлечений, питания вне дома и необязательных подписок.");
  } else {
    recs.push("Доля обязательных платежей высока — стоит пересмотреть крупные долговые нагрузки и условия аренды при первой возможности.");
  }

  if (s.monthsCover < 3) {
    recs.push("Цель по «финансовой подушке» — накопить минимум 3–6 месяцев обязательных расходов на отдельном защищённом счёте.");
  } else {
    recs.push("Финансовая подушка уже сформирована — можно часть новых сбережений направлять на долгосрочные цели и инвестиции с учётом риска.");
  }

  // determine chip class for sustainability: mark negative (отрицательная) in red
  const chipClass = s.sustainability === "отрицательная" ? "chip chip-negative" : "chip";

  els.analysis.innerHTML = `
    <div>
      <div class="analysis-block-title">Текущая структура доходов и расходов</div>
      <ul class="analysis-list">
        <li>Доходы за период: <b>${fmt(s.totalIncome)} ₽</b></li>
        <li>Расходы за период: <b>${fmt(s.totalExpense)} ₽</b></li>
        <li>Доходы в структуре: <b>${structureIncomePart}</b>, расходы: <b>${structureExpensePart}</b></li>
        <li>Обязательные расходы: <b>${fmt(s.mandatoryExpense)} ₽</b> (${mandatoryShare})</li>
        <li>Переменные расходы: <b>${fmt(s.variableExpense)} ₽</b> (${variableShare})</li>
      </ul>
    </div>
    <div>
      <div class="analysis-block-title">Устойчивость бюджета</div>
      <div style="margin-bottom:4px;">
        <span class="${chipClass}">
          <span class="chip-dot"></span>
          Устойчивость: <b>${s.sustainability}</b>
        </span>
      </div>
      <ul class="analysis-list">
        <li>Среднемесячный доход: <b>${fmt(s.avgIncome)} ₽</b></li>
        <li>Среднемесячные расходы: <b>${fmt(s.avgExpense)} ₽</b></li>
        <li>Ставка сбережений: <b>${pct(s.savingsRate)}</b></li>
        <li>Фактический результат периода: <b>${s.net >= 0 ? "профицит" : "дефицит"} ${fmt(Math.abs(s.net))} ₽</b></li>
      </ul>
    </div>
    <div>
      <div class="analysis-block-title">Финансовая подушка и рекомендации</div>
      <ul class="analysis-list">
        <li>Оценочный размер подушки: <b>${fmt(s.cushion)} ₽</b></li>
        <li>Покрытие обязательных расходов: <b>${fmt1(s.monthsCover)} мес.</b></li>
        <li>Качество подушки: <b>${cushionQuality}</b></li>
      </ul>
      <ul class="analysis-list">
        ${recs.map((r) => `<li>${r}</li>`).join("")}
      </ul>
    </div>
  `;
}

// New: compute recent balance changes + alerts
function computeNotifications(periodOps) {
  const notes = [];

  // 1) last 10 balance changes (based on date order)
  const sorted = periodOps.slice().sort((a,b) => a.date.localeCompare(b.date));
  const last10 = sorted.slice(-10).map((op, i, arr) => {
    // compute delta using amount (deposit - abs(withdrawal))
    const delta = op.amount || (op.deposit || 0) - Math.abs(op.withdrawal || 0);
    return {
      date: op.date,
      title: op.title || op.category || "Операция",
      delta,
      category: op.category
    };
  }).reverse();

  if (last10.length) {
    notes.push({
      type: "info",
      title: `Последние ${last10.length} изменений баланса`,
      items: last10.map((it) => `${it.date.split("-").reverse().join(".")}: ${it.delta >=0 ? "+" : ""}${it.delta.toLocaleString("ru-RU")} ₽ — ${it.title}`)
    });
  }

  // 2) Approaching category "лимит" heuristic: work per-month because limits обнуляются каждый месяц
  // Determine target month (use date-to if present, otherwise latest operation date)
  let perMonthOps = periodOps.slice();
  if (perMonthOps.length) {
    // pick month-year from the last operation in the selected period
    const latestDate = perMonthOps.map(o=>o.date).sort().slice(-1)[0];
    const ym = latestDate ? latestDate.slice(0,7) : null; // "YYYY-MM"
    if (ym) {
      perMonthOps = perMonthOps.filter(o => o.date && o.date.slice(0,7) === ym);
    }
  }
  const expenses = perMonthOps.filter(o => o.amount < 0);
  const totalExp = expenses.reduce((s,o) => s + Math.abs(o.amount), 0);
  if (totalExp > 0) {
    const byCat = {};
    expenses.forEach(e => {
      const c = e.category || "Прочее";
      byCat[c] = (byCat[c] || 0) + Math.abs(e.amount);
    });
    const heavy = Object.entries(byCat).filter(([cat, sum]) => sum >= 0.8 * totalExp);
    heavy.forEach(([cat, sum]) => {
      notes.push({
        type: "warning",
        title: `Высокая нагрузка по категории за месяц: ${cat}`,
        text: `За текущий месяц категория ${cat} составляет ${(sum/totalExp*100).toFixed(0)}% от месячных расходов — лимиты обнуляются каждый месяц.`
      });
    });
  }

  // 3) Cushion decrease: compare current cushion with lastCushion
  const s = computeSummary(periodOps);
  if (lastCushion !== null && s.cushion < lastCushion) {
    const drop = lastCushion - s.cushion;
    notes.push({
      type: "warning",
      title: `Снижение финансовой подушки`,
      text: `Подушка сократилась на ${drop.toLocaleString("ru-RU")} ₽ по сравнению с предыдущим состоянием.`
    });
  }
  // update saved cushion
  lastCushion = s.cushion;

  // 4) Simple anomaly detection: flag large single withdrawals >= 10 000 ₽, but ignore "Аренда"
  const withdrawals = periodOps.map(o => Math.abs(o.withdrawal || 0)).filter(v=>v>0);
  if (withdrawals.length >= 1) {
    const largeFixed = periodOps.filter(o => Math.abs(o.withdrawal||0) >= 10000 && (o.category || "").toString().trim() !== "Аренда");
    largeFixed.forEach(o => {
      notes.push({
        type: "critical",
        title: "Аномальная транзакция",
        text: `${o.date.split("-").reverse().join(".")}: списание ${Math.abs(o.withdrawal).toLocaleString("ru-RU")} ₽ в категории ${o.category}`
      });
    });
  }

  return notes;
}

function renderNotifications(periodOps) {
  if (!els.notifBell || !els.notifList) return;
  const notes = computeNotifications(periodOps);

  // build list HTML
  els.notifList.innerHTML = "";
  if (!notes.length) {
    const empty = document.createElement("div");
    empty.className = "notif-smalllist";
    empty.textContent = "Уведомлений нет.";
    els.notifList.appendChild(empty);
    // clear unread indicator
    document.querySelector(".notif-wrap")?.classList.remove("has-unread");
    unreadNotifications = [];
    return;
  }

  // Flatten: show top summary items and last10 expanded under first
  notes.forEach((n) => {
    const row = document.createElement("div");
    row.className = "notif-item";
    const left = document.createElement("div");
    left.style.flex = "1";
    const title = document.createElement("div");
    title.className = "notif-title";
    title.textContent = n.title;
    if (n.type === "warning") title.classList.add("notif-type-warning");
    if (n.type === "critical") title.classList.add("notif-type-critical");
    left.appendChild(title);
    if (n.text) {
      const t = document.createElement("div");
      t.className = "notif-meta";
      t.textContent = n.text;
      left.appendChild(t);
    }
    if (n.items && Array.isArray(n.items)) {
      const ul = document.createElement("div");
      ul.className = "notif-smalllist";
      ul.innerHTML = n.items.map(i => `<div>${i}</div>`).join("");
      left.appendChild(ul);
    }
    row.appendChild(left);
    els.notifList.appendChild(row);
  });

  // mark unread
  unreadNotifications = notes;
  document.querySelector(".notif-wrap")?.classList.add("has-unread");
}

// bell toggle
if (els.notifBell && els.notifList) {
  els.notifBell.addEventListener("click", (e) => {
    const wrap = document.querySelector(".notif-wrap");
    const visible = !els.notifList.hasAttribute("hidden");
    if (visible) {
      els.notifList.setAttribute("hidden", "");
      wrap && wrap.classList.remove("has-unread");
      unreadNotifications = [];
    } else {
      els.notifList.removeAttribute("hidden");
      // clear unread
      wrap && wrap.classList.remove("has-unread");
      unreadNotifications = [];
    }
  });
  // close on outside click
  document.addEventListener("click", (ev) => {
    const wrap = document.querySelector(".notif-wrap");
    if (!wrap) return;
    if (!wrap.contains(ev.target)) {
      els.notifList && els.notifList.setAttribute("hidden", "");
    }
  });
}

function updateAnalytics() {
  const periodOps = filterByPeriod();
  renderPeriodList(periodOps);
  updateChart(periodOps);
  renderAnalysis(periodOps);
  renderNotifications(periodOps);
}

function initEvents() {
  els.dateFrom.addEventListener("change", updateAnalytics);
  els.dateTo.addEventListener("change", updateAnalytics);
  if (els.analyticsCategory) {
    els.analyticsCategory.addEventListener("change", () => {
      updateAnalytics();
      renderTable(); // optionally keep table in sync with selected category in analytics
    });
  }
  if (els.categorySearch) {
    els.categorySearch.addEventListener("input", () => {
      // realtime table filtering by category
      renderTable();
    });
  }
}

// Assumes existing interface; only wiring additional CSV upload + analytics logic.
// No structural HTML changes are required.

async function postJson(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// Map ML backend operations to UI operations structure
function mapAnalysisOpsToUiOps(analysisOps) {
  // Keep original withdrawal/deposit/ref_no/balance/date so table can show CSV columns directly
  // Filter out rows without a valid date or without a real category
  return (analysisOps || [])
    .map((op, idx) => {
      const withdrawal = Number(op.withdrawal || 0);
      const deposit = Number(op.deposit || 0);

      // Normalize ISO date using centralized helper (treat part1=day, part2=month, part3=year)
      let rawDate = op.date || "";
      let isoDate = normalizeDateToIso(rawDate);

      const balanceVal = Number(op.balance || 0);

      return {
        id: typeof op.index === "number" ? op.index : idx,
        category: (op.category || "").toString().trim() || "Без категории",
        ref_no: op.ref_no || op.RefNo || "",
        withdrawal: withdrawal,
        deposit: deposit,
        balance: balanceVal,
        date: isoDate || "",
        // keep earlier fields for compatibility
        amount: deposit - Math.abs(withdrawal || 0),
        delta: deposit - Math.abs(withdrawal || 0),
        mandatory: false
      };
    })
    .filter((u) => {
      // Exclude entries missing a date or with no meaningful category.
      if (!u.date) return false;
      const cat = (u.category || "").toString().trim();
      if (!cat || cat === "Без категории") return false;
      return true;
    });
}

// Category translation map: English (and some variants) -> Russian
const CATEGORY_TRANSLATIONS = {
  "salary": "Зарплата",
  "payroll": "Зарплата",
  "wages": "Зарплата",
  "rent": "Аренда",
  "utilities": "Коммунальные услуги",
  "transport": "Транспорт",
  "food": "Питание",
  "groceries": "Питание",
  "dining": "Питание",
  "entertainment": "Развлечения",
  "savings": "Накопления",
  "bonus": "Бонус",
  "credit": "Кредит",
  "loan": "Кредит",
  "freelance": "Подработка",
  "side hustle": "Подработка",
  "obligatory payments": "Обязательные платежи",
  "obligatory": "Обязательные платежи",
  "mandatory": "Обязательные платежи",
  "other": "Прочее",
  "misc": "Прочее",
  "transfer": "Перевод",
  "insurance": "Страхование",
  "shopping": "Шоппинг",
  "shop": "Шоппинг"
};

// Helper to translate category names to Russian (case-insensitive, trims)
function translateCategory(raw) {
  if (!raw && raw !== 0) return "Без категории";
  const s = String(raw).trim();
  if (!s) return "Без категории";
  const key = s.toLowerCase();
  if (CATEGORY_TRANSLATIONS[key]) return CATEGORY_TRANSLATIONS[key];

  // Try to match by keywords (e.g., "salary", "rent", "коммун")
  for (const k in CATEGORY_TRANSLATIONS) {
    if (key.includes(k)) return CATEGORY_TRANSLATIONS[k];
  }

  // If it's already Russian or unknown, return capitalized original (keep Russian as-is)
  // Basic heuristic: if contains Cyrillic, assume Russian and return as-is
  if (/[а-яё]/i.test(s)) return s;

  // Capitalize first letter for unknown English names and keep as-is
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Helper to normalize date strings: part1=day, part2=month, part3=year
function normalizeDateToIso(dateRaw) {
  if (!dateRaw) return "";
  const s = dateRaw.toString().trim();

  // First try explicit DD[.-/]MM[.-/]YYYY or DD[.-/]MM[.-/]YY pattern (treat part1=day)
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = "20" + yyyy;
    return `${yyyy}-${mm}-${dd}`;
  }

  // Fallback: try Date parsing (ISO or other formats)
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return s;
}

// Hidden file input for manual CSV upload, attached once
let csvFileInput = null;

function ensureCsvInput() {
  if (csvFileInput) return csvFileInput;
  csvFileInput = document.createElement("input");
  csvFileInput.type = "file";
  csvFileInput.accept = ".csv,text/csv";
  csvFileInput.style.display = "none";
  csvFileInput.addEventListener("change", handleCsvSelected);
  document.body.appendChild(csvFileInput);
  return csvFileInput;
}

// Public function you can bind to existing UI button:
// e.g. document.getElementById('uploadButton').onclick = startCsvUpload;
export function startCsvUpload() {
  const input = ensureCsvInput();
  input.value = "";
  input.click();
}

// Also expose to global scope without меняя интерфейс
window.startCsvUpload = startCsvUpload;

// Build CSV from current operations array and trigger download
export function downloadOperationsCsv() {
  if (!operations || operations.length === 0) {
    // create empty CSV with headers
    const headers = ["Date", "Category", "Withdrawal", "Deposit", "Balance", "RefNo"];
    const csv = headers.join(",") + "\n";
    const blob = new Blob([new Uint8Array([0xEF,0xBB,0xBF]), csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `operations.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }

  const headers = ["Date", "Category", "Withdrawal", "Deposit", "Balance", "RefNo"];
  const rows = operations.map((op) => {
    const date = op.date || "";
    const category = (op.category || "").toString().replace(/"/g, '""');
    const withdrawal = Number(op.withdrawal || 0);
    const deposit = Number(op.deposit || 0);
    const balance = Number(op.balance || 0);
    const ref = (op.ref_no || "").toString().replace(/"/g, '""');
    // quote fields that may contain commas
    return [
      `"${date}"`,
      `"${category}"`,
      withdrawal,
      deposit,
      balance,
      `"${ref}"`
    ].join(",");
  });

  const csvContent = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([new Uint8Array([0xEF,0xBB,0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `operations.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// expose downloader to global scope for inline onclick
window.downloadOperationsCsv = downloadOperationsCsv;

async function handleCsvSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  try {
    // Read raw bytes and try decoding with UTF-8 first, then fallback to windows-1251 (CP1251)
    const buffer = await file.arrayBuffer();
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch (e) {
      // fallback to cp1251 (windows-1251)
      try {
        text = new TextDecoder("windows-1251").decode(buffer);
      } catch (e2) {
        // last resort: decode as utf-8 permissive
        text = new TextDecoder("utf-8").decode(buffer);
      }
    }

    // Simple CSV parser (handles commas, trims quotes/spaces)
    function parseCsv(text) {
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
      if (!lines.length) return { headers: [], rows: [] };
      const rawHeaders = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1).map((line) => {
        const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        const obj = {};
        rawHeaders.forEach((h, i) => {
          obj[h] = cols[i] !== undefined ? cols[i] : "";
        });
        return obj;
      });
      return { headers: rawHeaders, rows };
    }

    const { rows } = parseCsv(text);

    // Map CSV rows to the same shape expected by mapAnalysisOpsToUiOps
    // Support columns: Date, Category, RefNo, Date.1, Withdrawal, Deposit, Balance
    const mapped = rows
      .map((r, idx) => {
        const withdrawal = Number((r["Withdrawal"] || r["Withdrawal " ] || r["withdrawal"] || "0").toString().replace(/[^0-9\-,.]/g, "").replace(",", ".") || 0);
        const deposit = Number((r["Deposit"] || r["deposit"] || "0").toString().replace(/[^0-9\-,.]/g, "").replace(",", ".") || 0);
        const balanceRaw = (r["Balance"] || r["balance"] || "0").toString().replace(/[^0-9\-,.]/g, "").replace(",", ".") || "0";
        const balanceNum = Number(balanceRaw) || 0;
        const dateRaw = r["Date"] || r["Date.1"] || r["date"] || "";
        // Normalize date to ISO YYYY-MM-DD, treat part1=day, part2=month, part3=year
        let iso = normalizeDateToIso(dateRaw);

        // infer delta: deposit positive, withdrawal negative
        const w = Math.abs(withdrawal || 0);
        const d = Math.abs(deposit || 0);
        const delta = d - w;

        // If Balance column is zero/empty, keep delta as informative balance change in 'balance' field
        const balanceForRow = balanceNum !== 0 ? balanceNum : delta;

        const rawCategory = r["Category"] || r["category"] || r["cat"] || "";
        return {
          index: idx,
          date: iso,
          category: translateCategory(rawCategory),
          ref_no: r["RefNo"] || r["Ref No"] || r["Ref"] || r["ref_no"] || "Операция",
          withdrawal: withdrawal,
          deposit: deposit,
          balance: balanceForRow
        };
      })
      .filter((row) => {
        // Skip rows without date or without meaningful category immediately on CSV parse
        if (!row.date) return false;
        const cat = (row.category || "").toString().trim();
        if (!cat || cat === "Без категории") return false;
        return true;
      });

    // Use client-side parsed CSV to populate operations immediately
    operations = mapAnalysisOpsToUiOps(mapped);

    // populate analytics category selector
    populateAnalyticsCategoryOptions();

    renderTable();
    initPeriod();
    updateAnalytics();

    // Still send CSV to backend for analysis/retraining asynchronously, but don't wait
    postJson("/api/analyze", { csv: text, retrain: true }).catch((err) => {
      console.warn("Backend analyze failed:", err);
    });
  } catch (err) {
    console.error(err);
  }
}

// Initial load: use bundled ci_data.csv via ML backend; fallback to sample operations
async function loadInitialOperationsFromCsv() {
  try {
    const res = await fetch("/ci_data.csv");
    if (!res.ok) throw new Error(`Failed to load ci_data.csv: ${res.status}`);
    // decode response using arrayBuffer + TextDecoder with fallback to windows-1251
    const ab = await res.arrayBuffer();
    let csvText;
    try {
      csvText = new TextDecoder("utf-8", { fatal: true }).decode(ab);
    } catch (e) {
      try {
        csvText = new TextDecoder("windows-1251").decode(ab);
      } catch (e2) {
        csvText = new TextDecoder("utf-8").decode(ab);
      }
    }

    const result = await postJson("/api/analyze", { csv: csvText, retrain: false });
    operations = mapAnalysisOpsToUiOps(result.operations || []);
    // If no operations returned, keep operations empty (no initial sample data)
  } catch (e) {
    console.error(e);
    operations = []; // ensure table is empty on load error
  }
}

// Ensure notifications update after CSV load and init
async function init() {
  initEvents();
  await loadInitialOperationsFromCsv();
  renderTable();
  initPeriod();
  updateAnalytics();
  // initial render of notifications for fallback/sample
  renderNotifications(operations);
}

function populateAnalyticsCategoryOptions() {
  if (!els.analyticsCategory) return;
  // collect unique categories from full operations list (not period-filtered)
  const cats = Array.from(new Set(operations.map(o => (o.category || "Без категории").toString()))).filter(Boolean).sort((a,b) => a.localeCompare(b));
  // preserve current value
  const cur = els.analyticsCategory.value || "__all__";
  els.analyticsCategory.innerHTML = `<option value="__all__">Все категории</option>` + cats.map(c => {
    const val = c;
    const sel = val === cur ? ' selected' : '';
    return `<option value="${val}"${sel}>${c}</option>`;
  }).join("");
}

init();