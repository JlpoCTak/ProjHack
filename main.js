// main.js
import Chart from "chart.js";

let operations = [];

const SAMPLE_OPERATIONS = [
  { id: 1, category: "Зарплата", title: "Основная работа", amount: 95000, date: "2025-11-01", mandatory: false },
  { id: 2, category: "Обязательные платежи", title: "Аренда квартиры", amount: -40000, date: "2025-11-02", mandatory: true },
  { id: 3, category: "Обязательные платежи", title: "Коммунальные услуги", amount: -8000, date: "2025-11-05", mandatory: true }
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

function normalize(s){ return (s||"").toString().toLowerCase().replace(/[^a-z0-9а-яё\s]/gi,"").trim(); }

function renderTable() {
  const searchRaw = (els.categorySearch && els.categorySearch.value) ? els.categorySearch.value.toString().trim().toLowerCase() : "";
  els.tableBody.innerHTML = "";
  operations
    .slice()
    .sort((a,b) => (a.date||"").localeCompare(b.date||""))
    .forEach((op) => {
      if (searchRaw) {
        const nCat = normalize(op.category);
        const nSearch = normalize(searchRaw);
        if (!nCat.includes(nSearch) && !nCat.split(/\s+/).some(p=>p.includes(nSearch))) return;
      }
      const tr = document.createElement("tr");
      const tdDate = document.createElement("td");
      tdDate.textContent = op.date ? op.date.split("-").reverse().join(".") : "";
      tr.appendChild(tdDate);

      const tdCat = document.createElement("td");
      tdCat.textContent = op.category || "Без категории";
      tdCat.className = "category-cell";
      tdCat.contentEditable = "true";
      tdCat.addEventListener("blur", () => {
        op.category = tdCat.textContent.trim() || "Без категории";
        populateAnalyticsCategoryOptions();
        updateAnalytics();
      });
      tr.appendChild(tdCat);

      const tdWithdraw = document.createElement("td");
      const w = Number(op.withdrawal || 0);
      tdWithdraw.textContent = w ? `-${Math.abs(w).toLocaleString("ru-RU")} ₽` : "";
      tdWithdraw.className = "amount-cell amount-expense";
      tr.appendChild(tdWithdraw);

      const tdDeposit = document.createElement("td");
      const d = Number(op.deposit || 0);
      tdDeposit.textContent = d ? `+${Math.abs(d).toLocaleString("ru-RU")} ₽` : "";
      tdDeposit.className = "amount-cell amount-income";
      tr.appendChild(tdDeposit);

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
  const dates = operations.map(o => o.date).filter(Boolean).sort();
  if (!dates.length) { els.dateFrom.value = ""; els.dateTo.value = ""; return; }
  els.dateFrom.value = dates[0];
  els.dateTo.value = dates[dates.length-1];
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
    if (catFilter) return (o.category||"").toString().toLowerCase() === catFilter.toString().toLowerCase();
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
  let totalIncome=0, totalExpense=0;
  periodOps.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(op=>{
    const li = document.createElement("li");
    const main = document.createElement("div"); main.className="period-op-main";
    const title = document.createElement("span"); title.className="period-op-title"; title.textContent = op.title || op.ref_no || op.category;
    const meta = document.createElement("span"); meta.className="period-op-meta";
    meta.textContent = `${op.category} • ${op.date.split("-").reverse().join(".")}${op.mandatory?" • обязательный":""}`;
    main.append(title, meta);
    const amt = document.createElement("span"); amt.className = "period-op-amount " + (op.amount >= 0 ? "amount-income":"amount-expense");
    const sign = op.amount > 0 ? "+" : "";
    amt.textContent = `${sign}${(op.amount|| (op.deposit - Math.abs(op.withdrawal||0))).toLocaleString("ru-RU")} ₽`;
    li.append(main, amt);
    els.periodList.appendChild(li);
    if ((op.amount|| (op.deposit - Math.abs(op.withdrawal||0))) >= 0) totalIncome += (op.amount|| (op.deposit - Math.abs(op.withdrawal||0)));
    else totalExpense += Math.abs(op.amount|| (op.deposit - Math.abs(op.withdrawal||0)));
  });
  const net = totalIncome - totalExpense;
  const netLabel = net>=0 ? "профицит" : "дефицит";
  els.periodSummary.textContent = `${totalIncome.toLocaleString("ru-RU")} ₽ доходы • ${totalExpense.toLocaleString("ru-RU")} ₽ расходы • ${netLabel} ${Math.abs(net).toLocaleString("ru-RU")} ₽`;
}

let lastCushionLocal = null;
function computeSummary(periodOps){
  const totalIncome = periodOps.filter(o=> (o.amount|| (o.deposit - Math.abs(o.withdrawal||0))) > 0).reduce((s,o)=>s + (o.amount|| (o.deposit - Math.abs(o.withdrawal||0))), 0);
  const totalExpense = periodOps.filter(o=> (o.amount|| (o.deposit - Math.abs(o.withdrawal||0))) < 0).reduce((s,o)=>s + Math.abs(o.amount|| (o.deposit - Math.abs(o.withdrawal||0))), 0);
  const mandatoryExpense = periodOps.filter(o=> o.amount < 0 && o.mandatory).reduce((s,o)=>s + Math.abs(o.amount),0);
  const variableExpense = totalExpense - mandatoryExpense;
  const net = totalIncome - totalExpense;
  const months = Math.max(1, Math.round(periodOps.length/8));
  const avgIncome = totalIncome/months || 0;
  const avgExpense = totalExpense/months || 0;
  const avgMandatory = mandatoryExpense/months || 0;
  const savingsRate = avgIncome > 0 ? (1 - avgExpense/avgIncome) : 0;
  const sustainability = savingsRate > 0.3 ? "высокая" : savingsRate > 0.1 ? "средняя" : savingsRate > 0 ? "низкая" : "отрицательная";
  const cushion = net > 0 ? net : 0;
  const monthsCover = avgMandatory > 0 ? cushion/avgMandatory : 0;
  return {
    totalIncome, totalExpense, mandatoryExpense, variableExpense, net,
    avgIncome, avgExpense, avgMandatory, avgVariable: variableExpense,
    savingsRate, sustainability, cushion, monthsCover
  };
}

let balanceChartInstance = null;
function updateChart(periodOps){
  let income=0, expenses=0;
  periodOps.forEach(op=>{
    const a = op.amount ?? (op.deposit - Math.abs(op.withdrawal||0));
    if (a >= 0) income += a; else expenses += Math.abs(a);
  });
  const data = [income, expenses];
  const hasData = income > 0 || expenses > 0;
  if (balanceChartInstance) balanceChartInstance.destroy();
  balanceChartInstance = new Chart(els.chartCanvas, {
    type: "doughnut",
    data: {
      labels: ["Доходы", "Расходы"],
      datasets: [{ data: hasData ? data : [1,1], backgroundColor: ["#2a9d8f","#e76f51"], borderWidth:0, hoverOffset:4 }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth:10, boxHeight:10, font:{size:10} } },
        tooltip: { callbacks: { label: (ctx) => {
          if (!hasData) return "Нет данных";
          const val = ctx.raw; const total = income+expenses||1; const pct = ((val/total)*100).toFixed(1);
          return `${ctx.label}: ${val.toLocaleString("ru-RU")} ₽ (${pct}%)`;
        } } }
      },
      cutout: "60%"
    }
  });
}

function renderAnalysis(periodOps) {
  const s = computeSummary(periodOps);
  const fmt = v => v.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  const fmt1 = v => v.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  const pct = v => (v*100).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " %";
  const structureIncomePart = s.totalIncome ? pct(s.totalIncome/(s.totalIncome+s.totalExpense||1)) : "—";
  const structureExpensePart = s.totalExpense ? pct(s.totalExpense/(s.totalIncome+s.totalExpense||1)) : "—";
  const mandatoryShare = s.totalExpense ? pct(s.mandatoryExpense/s.totalExpense) : "—";
  const variableShare = s.totalExpense ? pct(s.variableExpense/s.totalExpense) : "—";
  const cushionQuality = s.monthsCover >= 6 ? "достаточная на случай потери дохода" : s.monthsCover >= 3 ? "базовая, но требующая наращивания" : "недостаточная";
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
        <span class="${chipClass}"><span class="chip-dot"></span> Устойчивость: <b>${s.sustainability}</b></span>
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
        ${(function(){
          const recs=[];
          if (s.savingsRate <= 0) recs.push("Расходы превышают доходы — ограничьте переменные траты.");
          else if (s.savingsRate < 0.1) recs.push("Ставка сбережений ниже 10 % — попробуйте откладывать 5–10 % дохода.");
          else recs.push("Хорошая ставка сбережений — поддерживайте её.");
          if (s.variableExpense > s.mandatoryExpense) recs.push("Большая доля переменных расходов — оптимизируйте развлечения и шоппинг.");
          if (s.monthsCover < 3) recs.push("Накопите подушку минимум 3–6 месяцев обязательных расходов.");
          return recs.map(r => `<li>${r}</li>`).join("");
        })()}
      </ul>
    </div>
  `;
}

function computeNotifications(periodOps){
  const notes = [];
  const sorted = periodOps.slice().sort((a,b)=>a.date.localeCompare(b.date));
  const last10 = sorted.slice(-10).map(op=>{
    const delta = op.amount ?? (op.deposit - Math.abs(op.withdrawal||0));
    return { date: op.date, title: op.title || op.ref_no || op.category, delta, category: op.category };
  }).reverse();
  if (last10.length) notes.push({ type:"info", title:`Последние ${last10.length} изменений баланса`, items: last10.map(it=>`${it.date.split("-").reverse().join(".")}: ${it.delta>=0?"+":""}${it.delta.toLocaleString("ru-RU")} ₽ — ${it.title}`) });

  // monthly heavy categories
  let perMonthOps = periodOps.slice();
  if (perMonthOps.length) {
    const latestDate = perMonthOps.map(o=>o.date).sort().slice(-1)[0];
    const ym = latestDate ? latestDate.slice(0,7) : null;
    if (ym) perMonthOps = perMonthOps.filter(o => o.date && o.date.slice(0,7) === ym);
  }
  const expenses = perMonthOps.filter(o => (o.amount ?? (o.deposit - Math.abs(o.withdrawal||0))) < 0);
  const totalExp = expenses.reduce((s,o) => s + Math.abs(o.amount ?? (o.deposit - Math.abs(o.withdrawal||0))), 0);
  if (totalExp > 0) {
    const byCat = {};
    expenses.forEach(e => { const c = e.category || "Прочее"; byCat[c] = (byCat[c]||0) + Math.abs(e.amount ?? (e.deposit - Math.abs(e.withdrawal||0))); });
    Object.entries(byCat).filter(([cat,sum]) => sum >= 0.8*totalExp).forEach(([cat,sum])=>{
      notes.push({ type:"warning", title:`Высокая нагрузка по категории: ${cat}`, text:`Категория ${cat} составляет ${(sum/totalExp*100).toFixed(0)}% расходов за месяц.` });
    });
  }

  // cushion compare
  const s = computeSummary(periodOps);
  if (lastCushionLocal !== null && s.cushion < lastCushionLocal) {
    const drop = lastCushionLocal - s.cushion;
    notes.push({ type:"warning", title:"Снижение финансовой подушки", text:`Подушка уменьшилась на ${drop.toLocaleString("ru-RU")} ₽` });
  }
  lastCushionLocal = s.cushion;

  // anomalies
  const large = periodOps.filter(o => Math.abs(o.withdrawal||0) >= 10000 && (o.category||"").toString().trim() !== "Аренда");
  large.forEach(o => notes.push({ type:"critical", title:"Аномальная транзакция", text:`${o.date.split("-").reverse().join(".")}: списание ${Math.abs(o.withdrawal).toLocaleString("ru-RU")} ₽ в категории ${o.category}` }));

  return notes;
}

function renderNotifications(periodOps){
  if (!els.notifBell || !els.notifList) return;
  const notes = computeNotifications(periodOps);
  els.notifList.innerHTML = "";
  if (!notes.length) {
    const empty = document.createElement("div"); empty.className="notif-smalllist"; empty.textContent="Уведомлений нет.";
    els.notifList.appendChild(empty);
    document.querySelector(".notif-wrap")?.classList.remove("has-unread");
    unreadNotifications=[];
    return;
  }
  notes.forEach(n=>{
    const row = document.createElement("div"); row.className="notif-item";
    const left = document.createElement("div"); left.style.flex="1";
    const title = document.createElement("div"); title.className="notif-title"; title.textContent = n.title;
    if (n.type === "warning") title.classList.add("notif-type-warning");
    if (n.type === "critical") title.classList.add("notif-type-critical");
    left.appendChild(title);
    if (n.text) { const t = document.createElement("div"); t.className="notif-meta"; t.textContent = n.text; left.appendChild(t); }
    if (n.items) { const list = document.createElement("div"); list.className="notif-smalllist"; list.innerHTML = n.items.map(i=>`<div>${i}</div>`).join(""); left.appendChild(list); }
    row.appendChild(left);
    els.notifList.appendChild(row);
  });
  unreadNotifications = notes;
  document.querySelector(".notif-wrap")?.classList.add("has-unread");
}

// events
function initEvents(){
  els.dateFrom.addEventListener("change", updateAnalytics);
  els.dateTo.addEventListener("change", updateAnalytics);
  if (els.analyticsCategory) els.analyticsCategory.addEventListener("change", ()=>{ updateAnalytics(); renderTable(); });
  if (els.categorySearch) els.categorySearch.addEventListener("input", ()=> renderTable());
  if (els.notifBell && els.notifList) {
    els.notifBell.addEventListener("click", () => {
      const wrap = document.querySelector(".notif-wrap");
      if (els.notifList.hasAttribute("hidden")) { els.notifList.removeAttribute("hidden"); wrap && wrap.classList.remove("has-unread"); unreadNotifications=[]; }
      else { els.notifList.setAttribute("hidden",""); }
    });
    document.addEventListener("click",(ev)=>{ const wrap=document.querySelector(".notif-wrap"); if (!wrap) return; if (!wrap.contains(ev.target)) els.notifList && els.notifList.setAttribute("hidden",""); });
  }
}

function updateAnalytics(){
  const periodOps = filterByPeriod();
  renderPeriodList(periodOps);
  updateChart(periodOps);
  renderAnalysis(periodOps);
  renderNotifications(periodOps);
}

async function postJson(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=>"");
    let body = {};
    try { body = JSON.parse(txt); } catch(e) { body = { error: txt || res.status }; }
    throw new Error(body.error || `Request failed ${res.status}`);
  }
  return res.json();
}

// map server rows -> ui ops
function mapAnalysisOpsToUiOps(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r, idx) => {
    const withdrawal = Number(r.withdrawal || r.Withdrawal || 0) || 0;
    const deposit = Number(r.deposit || r.Deposit || 0) || 0;
    const balance = Number(r.balance || r.Balance || (deposit - Math.abs(withdrawal))) || 0;
    const dateRaw = r.date || r.Date || r["Date.1"] || "";
    const iso = normalizeDateToIso(dateRaw) || "";
    return {
      id: r.index ?? idx,
      category: (r.category || r.Category || "Без категории").toString(),
      ref_no: r.ref_no || r.RefNo || "",
      withdrawal: withdrawal,
      deposit: deposit,
      balance: balance,
      date: iso,
      amount: deposit - Math.abs(withdrawal||0),
      title: r.title || r.ref_no || r.ref || ""
    };
  }).filter(u => u.date); // keep only with date (server should provide date)
}

function normalizeDateToIso(dateRaw) {
  if (!dateRaw) return "";
  const s = dateRaw.toString().trim();
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
  if (m) {
    let dd = m[1].padStart(2,"0"), mm = m[2].padStart(2,"0"), yyyy = m[3];
    if (yyyy.length === 2) yyyy = "20"+yyyy;
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0,10);
  return s;
}

// Hidden file input
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

export function startCsvUpload() {
  const input = ensureCsvInput();
  input.value = "";
  input.click();
}
window.startCsvUpload = startCsvUpload;

export function downloadOperationsCsv() {
  if (!operations || operations.length === 0) {
    const headers = ["Date","Category","Withdrawal","Deposit","Balance","RefNo"];
    const csv = headers.join(",") + "\n";
    const blob = new Blob([new Uint8Array([0xEF,0xBB,0xBF]), csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `operations.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    return;
  }
  const headers = ["Date","Category","Withdrawal","Deposit","Balance","RefNo"];
  const rows = operations.map(op => {
    const date = op.date || "";
    const category = (op.category||"").toString().replace(/"/g,'""');
    const withdrawal = Number(op.withdrawal || 0);
    const deposit = Number(op.deposit || 0);
    const balance = Number(op.balance || 0);
    const ref = (op.ref_no || "").toString().replace(/"/g,'""');
    return [`"${date}"`, `"${category}"`, withdrawal, deposit, balance, `"${ref}"`].join(",");
  });
  const csvContent = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([new Uint8Array([0xEF,0xBB,0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `operations.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
window.downloadOperationsCsv = downloadOperationsCsv;

async function handleCsvSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
    catch(e) {
      try { text = new TextDecoder("windows-1251").decode(buffer); }
      catch(e2) { text = new TextDecoder("utf-8").decode(buffer); }
    }

    // send raw CSV to prediction endpoint — сервер вернёт строки с заполненной Category
    try {
      const result = await postJson("/api/predict_category_csv", { csv: text });
      if (result && Array.isArray(result.rows)) {
        operations = mapAnalysisOpsToUiOps(result.rows);
        populateAnalyticsCategoryOptions();
        renderTable();
        initPeriod();
        updateAnalytics();
        return;
      } else {
        console.warn("Unexpected response from /api/predict_category_csv", result);
      }
    } catch (err) {
      console.warn("predict_category_csv failed:", err);
      // fallthrough -> try local parsing (best-effort)
    }

    // Fallback: minimal client-side parse (if server failed)
    function parseCsv(text) {
      const lines = text.split(/\r?\n/).filter(l=>l.trim()!=="");
      if (!lines.length) return { headers: [], rows: [] };
      const rawHeaders = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g,""));
      const rows = lines.slice(1).map(line => {
        const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g,""));
        const obj = {}; rawHeaders.forEach((h,i)=> obj[h] = cols[i] !== undefined ? cols[i] : "");
        return obj;
      });
      return { headers: rawHeaders, rows };
    }
    const parsed = parseCsv(text);
    // map parsed rows to operations (best-effort)
    operations = parsed.rows.map((r, idx) => {
      const withdrawal = Number((r["Withdrawal"]||r["withdrawal"]||"0").toString().replace(/[^0-9\-,.]/g,"").replace(",","."))||0;
      const deposit = Number((r["Deposit"]||r["deposit"]||"0").toString().replace(/[^0-9\-,.]/g,"").replace(",","."))||0;
      const balanceRaw = (r["Balance"]||"0").toString().replace(/[^0-9\-,.]/g,"").replace(",",".")||"0";
      const balance = Number(balanceRaw) || (deposit - Math.abs(withdrawal));
      const dateRaw = r["Date"] || r["Date.1"] || r["date"] || "";
      return {
        id: idx,
        date: normalizeDateToIso(dateRaw),
        category: r["Category"] ? r["Category"] : "Без категории",
        ref_no: r["RefNo"] || r["Ref"] || "",
        withdrawal, deposit, balance,
        amount: deposit - Math.abs(withdrawal||0)
      };
    }).filter(u => u.date);
    populateAnalyticsCategoryOptions();
    renderTable();
    initPeriod();
    updateAnalytics();

  } catch (err) {
    console.error(err);
  }
}

async function loadInitialOperationsFromCsv() {
  try {
    const res = await fetch("/ci_data.csv");
    if (!res.ok) throw new Error(`Failed to load ci_data.csv: ${res.status}`);
    const ab = await res.arrayBuffer();
    let csvText;
    try { csvText = new TextDecoder("utf-8", { fatal: true }).decode(ab); }
    catch(e) { try { csvText = new TextDecoder("windows-1251").decode(ab); } catch(e2) { csvText = new TextDecoder("utf-8").decode(ab); } }

    // use prediction endpoint so categories are filled as on real upload
    try {
      const result = await postJson("/api/predict_category_csv", { csv: csvText });
      if (result && Array.isArray(result.rows)) {
        operations = mapAnalysisOpsToUiOps(result.rows);
      } else {
        operations = [];
      }
    } catch (err) {
      console.warn("Initial predict failed:", err);
      operations = [];
    }
  } catch (e) {
    console.error(e);
    operations = [];
  }
}

function populateAnalyticsCategoryOptions() {
  if (!els.analyticsCategory) return;
  const cats = Array.from(new Set(operations.map(o => (o.category || "Без категории").toString()))).filter(Boolean).sort((a,b)=>a.localeCompare(b));
  const cur = els.analyticsCategory.value || "__all__";
  els.analyticsCategory.innerHTML = `<option value="__all__">Все категории</option>` + cats.map(c => {
    const sel = c === cur ? " selected" : "";
    return `<option value="${c}"${sel}>${c}</option>`;
  }).join("");
}

async function init() {
  initEvents();
  await loadInitialOperationsFromCsv();
  renderTable();
  initPeriod();
  updateAnalytics();
  renderNotifications(operations);
}

init();
