const form = document.getElementById("predict-form");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const submitBtn = document.getElementById("submit-btn");
const tickerLabel = document.getElementById("ticker-label");
const companyNameEl = document.getElementById("company-name");
const lastPriceEl = document.getElementById("last-price");
const comparisonBody = document.getElementById("comparison-body");
const nextDayBadges = document.getElementById("next-day-badges");
const backtestDateInput = document.getElementById("backtest-date");
const backtestBtn = document.getElementById("backtest-btn");
const backtestStatusEl = document.getElementById("backtest-status");
const backtestResultEl = document.getElementById("backtest-result");
const backtestBody = document.getElementById("backtest-body");
const gafamCompareBtn = document.getElementById("gafam-compare-btn");
const gafamCompareSection = document.getElementById("gafam-compare-section");
const gafamCompareStatus = document.getElementById("gafam-compare-status");
const gafamPeriodSelect = document.getElementById("gafam-period");

const ALGO_COLORS = {
  lstm: "#f472b6",
  linear: "#facc15",
  moving_average: "#34d399",
};
const FALLBACK_COLORS = ["#a78bfa", "#fb923c", "#22d3ee"];
const ZOOM_HISTORY_DAYS = 7;

const GAFAM_COLORS = {
  GOOGL: "#4285f4",
  AAPL: "#a1a1aa",
  META: "#0866ff",
  AMZN: "#ff9900",
  MSFT: "#7fba00",
};

let chartInstance = null;
let zoomChartInstance = null;
let backtestChartInstance = null;
let gafamChartInstance = null;

backtestDateInput.max = new Date().toISOString().slice(0, 10);

document.querySelectorAll(".quick-pick").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById("ticker").value = btn.dataset.ticker;
    form.requestSubmit();
  });
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const ticker = document.getElementById("ticker").value.trim();
  const days = parseInt(document.getElementById("days").value, 10);
  const algorithms = Array.from(
    document.querySelectorAll('input[name="algorithm"]:checked')
  ).map((el) => el.value);

  if (algorithms.length === 0) {
    statusEl.textContent = "アルゴリズムを1つ以上選択してください。";
    statusEl.classList.add("error");
    return;
  }

  statusEl.textContent = "予測中です…（モデルを学習しています。数十秒かかる場合があります）";
  statusEl.classList.remove("error");
  resultEl.classList.add("hidden");
  submitBtn.disabled = true;

  try {
    const res = await fetch("/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, days_ahead: days, algorithms }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "予測に失敗しました。");
    }

    statusEl.textContent = "";
    renderResult(data);
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add("error");
  } finally {
    submitBtn.disabled = false;
  }
});

function algoColor(key, index) {
  return ALGO_COLORS[key] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function renderResult(data) {
  companyNameEl.textContent = data.company_name;
  tickerLabel.textContent = data.ticker;
  lastPriceEl.textContent = `最新終値: ${data.last_actual_price}`;
  resultEl.classList.remove("hidden");

  const algoKeys = Object.keys(data.predictions);

  renderMainChart(data, algoKeys);
  renderZoomChart(data, algoKeys);
  renderNextDayBadges(data, algoKeys);
  renderComparisonTable(data, algoKeys);
}

function renderMainChart(data, algoKeys) {
  const historyLabels = data.history_dates;
  const futureLabels = data.future_dates;
  const labels = [...historyLabels, ...futureLabels];

  const historyData = [...data.history_prices, ...Array(futureLabels.length).fill(null)];
  const bridgeValue = data.history_prices[data.history_prices.length - 1];

  const datasets = [
    {
      label: "実績",
      data: historyData,
      borderColor: "#38bdf8",
      backgroundColor: "transparent",
      pointRadius: 0,
      tension: 0.1,
    },
  ];

  algoKeys.forEach((key, index) => {
    const pred = data.predictions[key];
    const futureData = [
      ...Array(historyLabels.length - 1).fill(null),
      bridgeValue,
      ...pred.future_prices,
    ];
    datasets.push({
      label: pred.label,
      data: futureData,
      borderColor: algoColor(key, index),
      borderDash: [6, 4],
      backgroundColor: "transparent",
      pointRadius: 0,
      tension: 0.1,
    });
  });

  const ctx = document.getElementById("chart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { color: "#94a3b8", maxTicksLimit: 12 }, grid: { color: "#334155" } },
        y: { ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
      },
      plugins: { legend: { labels: { color: "#e2e8f0" } } },
    },
  });
}

function renderZoomChart(data, algoKeys) {
  const zoomCount = Math.min(ZOOM_HISTORY_DAYS, data.history_dates.length);
  const zoomHistoryLabels = data.history_dates.slice(-zoomCount);
  const zoomHistoryPrices = data.history_prices.slice(-zoomCount);
  const futureLabels = data.future_dates;
  const labels = [...zoomHistoryLabels, ...futureLabels];

  const historyData = [...zoomHistoryPrices, ...Array(futureLabels.length).fill(null)];
  const historyPointRadius = [
    ...Array(zoomCount - 1).fill(0),
    3,
    ...Array(futureLabels.length).fill(0),
  ];
  const bridgeValue = zoomHistoryPrices[zoomHistoryPrices.length - 1];

  const datasets = [
    {
      label: "実績",
      data: historyData,
      borderColor: "#38bdf8",
      backgroundColor: "#38bdf8",
      pointRadius: historyPointRadius,
      tension: 0.1,
    },
  ];

  algoKeys.forEach((key, index) => {
    const pred = data.predictions[key];
    const color = algoColor(key, index);
    const futureData = [
      ...Array(zoomCount - 1).fill(null),
      bridgeValue,
      ...pred.future_prices,
    ];
    // Highlight the very next trading day's prediction (one day ahead) with a larger point.
    const pointRadius = [
      ...Array(zoomCount - 1).fill(0),
      3,
      7,
      ...Array(Math.max(pred.future_prices.length - 1, 0)).fill(3),
    ];

    datasets.push({
      label: pred.label,
      data: futureData,
      borderColor: color,
      backgroundColor: color,
      borderDash: [6, 4],
      pointRadius,
      tension: 0.1,
    });
  });

  const ctx = document.getElementById("chart-zoom").getContext("2d");
  if (zoomChartInstance) zoomChartInstance.destroy();

  zoomChartInstance = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
        y: { ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
      },
      plugins: { legend: { labels: { color: "#e2e8f0" } } },
    },
  });
}

function renderNextDayBadges(data, algoKeys) {
  nextDayBadges.innerHTML = "";
  const nextDayLabel = data.future_dates[0];

  algoKeys.forEach((key, index) => {
    const pred = data.predictions[key];
    const color = algoColor(key, index);
    const nextPrice = pred.future_prices[0];
    const change = ((nextPrice - data.last_actual_price) / data.last_actual_price) * 100;
    const changeClass = change >= 0 ? "positive" : "negative";

    const badge = document.createElement("div");
    badge.className = "next-day-badge";
    badge.style.borderColor = color;
    badge.innerHTML = `
      <span class="badge-label" style="color:${color}">${pred.label}</span>
      <span class="badge-date">${nextDayLabel}</span>
      <span class="badge-price">${nextPrice.toFixed(2)}</span>
      <span class="badge-change ${changeClass}">${change >= 0 ? "+" : ""}${change.toFixed(2)}%</span>
    `;
    nextDayBadges.appendChild(badge);
  });
}

function renderComparisonTable(data, algoKeys) {
  comparisonBody.innerHTML = "";

  algoKeys.forEach((key, index) => {
    const pred = data.predictions[key];
    const color = algoColor(key, index);
    const finalPrice = pred.future_prices[pred.future_prices.length - 1];
    const change = ((finalPrice - data.last_actual_price) / data.last_actual_price) * 100;
    const changeClass = change >= 0 ? "positive" : "negative";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="legend-dot" style="background:${color}"></span>${pred.label}</td>
      <td>${finalPrice.toFixed(2)}</td>
      <td class="${changeClass}">${change >= 0 ? "+" : ""}${change.toFixed(2)}%</td>
    `;
    comparisonBody.appendChild(row);
  });
}

backtestBtn.addEventListener("click", async () => {
  const ticker = document.getElementById("ticker").value.trim();
  const days = parseInt(document.getElementById("days").value, 10);
  const targetDate = backtestDateInput.value;
  const algorithms = Array.from(
    document.querySelectorAll('input[name="algorithm"]:checked')
  ).map((el) => el.value);

  if (!ticker) {
    backtestStatusEl.textContent = "銘柄コードを入力してください。";
    backtestStatusEl.classList.add("error");
    return;
  }
  if (!targetDate) {
    backtestStatusEl.textContent = "検証する日付を選択してください。";
    backtestStatusEl.classList.add("error");
    return;
  }
  if (algorithms.length === 0) {
    backtestStatusEl.textContent = "アルゴリズムを1つ以上選択してください。";
    backtestStatusEl.classList.add("error");
    return;
  }

  backtestStatusEl.textContent = "検証中です…";
  backtestStatusEl.classList.remove("error");
  backtestResultEl.classList.add("hidden");
  backtestBtn.disabled = true;

  try {
    const res = await fetch("/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, target_date: targetDate, days_ahead: days, algorithms }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "検証に失敗しました。");
    }

    backtestStatusEl.textContent = "";
    renderBacktestResult(data);
  } catch (err) {
    backtestStatusEl.textContent = err.message;
    backtestStatusEl.classList.add("error");
  } finally {
    backtestBtn.disabled = false;
  }
});

function renderBacktestResult(data) {
  backtestResultEl.classList.remove("hidden");
  const algoKeys = Object.keys(data.predictions);

  const contextLabels = data.context_dates;
  const predictionLabels = data.prediction_dates;
  const labels = [...contextLabels, ...predictionLabels];

  const actualData = [...data.context_prices, ...data.actual_prices];
  const actualPointRadius = [
    ...Array(contextLabels.length).fill(0),
    ...Array(predictionLabels.length).fill(3),
  ];

  const bridgeValue = data.context_prices[data.context_prices.length - 1];

  const datasets = [
    {
      label: "実際の価格",
      data: actualData,
      borderColor: "#38bdf8",
      backgroundColor: "#38bdf8",
      pointRadius: actualPointRadius,
      tension: 0.1,
    },
  ];

  backtestBody.innerHTML = "";

  algoKeys.forEach((key, index) => {
    const pred = data.predictions[key];
    const color = algoColor(key, index);
    const predictedData = [
      ...Array(contextLabels.length - 1).fill(null),
      bridgeValue,
      ...pred.predicted_prices,
    ];

    datasets.push({
      label: `${pred.label}（予測）`,
      data: predictedData,
      borderColor: color,
      backgroundColor: color,
      borderDash: [6, 4],
      pointRadius: [
        ...Array(contextLabels.length - 1).fill(0),
        3,
        ...Array(pred.predicted_prices.length).fill(3),
      ],
      tension: 0.1,
    });

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="legend-dot" style="background:${color}"></span>${pred.label}</td>
      <td>${pred.final_predicted.toFixed(2)}</td>
      <td>${pred.final_actual.toFixed(2)}</td>
      <td>${pred.deviation >= 0 ? "+" : ""}${pred.deviation.toFixed(2)}</td>
      <td>${pred.deviation_pct >= 0 ? "+" : ""}${pred.deviation_pct.toFixed(2)}%</td>
    `;
    backtestBody.appendChild(row);
  });

  const ctx = document.getElementById("chart-backtest").getContext("2d");
  if (backtestChartInstance) backtestChartInstance.destroy();

  backtestChartInstance = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { color: "#94a3b8", maxTicksLimit: 12 }, grid: { color: "#334155" } },
        y: { ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
      },
      plugins: { legend: { labels: { color: "#e2e8f0" } } },
    },
  });
}

gafamCompareBtn.addEventListener("click", () => {
  const isHidden = gafamCompareSection.classList.contains("hidden");
  if (isHidden) {
    gafamCompareSection.classList.remove("hidden");
    loadGafamComparison();
  } else {
    gafamCompareSection.classList.add("hidden");
  }
});

gafamPeriodSelect.addEventListener("change", () => {
  if (!gafamCompareSection.classList.contains("hidden")) {
    loadGafamComparison();
  }
});

async function loadGafamComparison() {
  gafamCompareStatus.textContent = "GAFAMのデータを取得中です…";
  gafamCompareStatus.classList.remove("error");

  try {
    const period = gafamPeriodSelect.value;
    const res = await fetch(`/gafam-comparison?period=${encodeURIComponent(period)}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "GAFAM比較データの取得に失敗しました。");
    }

    gafamCompareStatus.textContent = "";
    renderGafamChart(data);
  } catch (err) {
    gafamCompareStatus.textContent = err.message;
    gafamCompareStatus.classList.add("error");
  }
}

function renderGafamChart(data) {
  const tickers = Object.keys(data.series);
  const datasets = tickers.map((ticker) => {
    const s = data.series[ticker];
    return {
      label: `${s.label} (${ticker})`,
      data: s.normalized_prices,
      borderColor: GAFAM_COLORS[ticker] || "#e2e8f0",
      backgroundColor: "transparent",
      pointRadius: 0,
      tension: 0.1,
    };
  });

  const ctx = document.getElementById("chart-gafam").getContext("2d");
  if (gafamChartInstance) gafamChartInstance.destroy();

  gafamChartInstance = new Chart(ctx, {
    type: "line",
    data: { labels: data.dates, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { color: "#94a3b8", maxTicksLimit: 12 }, grid: { color: "#334155" } },
        y: {
          ticks: { color: "#94a3b8", callback: (v) => v.toFixed(0) },
          grid: { color: "#334155" },
          title: { display: true, text: "起点=100として指数化", color: "#94a3b8" },
        },
      },
      plugins: { legend: { labels: { color: "#e2e8f0" } } },
    },
  });
}
