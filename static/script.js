const form = document.getElementById("predict-form");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const submitBtn = document.getElementById("submit-btn");
const tickerLabel = document.getElementById("ticker-label");
const companyNameEl = document.getElementById("company-name");
const lastPriceEl = document.getElementById("last-price");
const comparisonBody = document.getElementById("comparison-body");
const nextDayBadges = document.getElementById("next-day-badges");

const ALGO_COLORS = {
  lstm: "#f472b6",
  linear: "#facc15",
  moving_average: "#34d399",
};
const FALLBACK_COLORS = ["#a78bfa", "#fb923c", "#22d3ee"];
const ZOOM_HISTORY_DAYS = 7;

let chartInstance = null;
let zoomChartInstance = null;

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
