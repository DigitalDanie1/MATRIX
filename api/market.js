const MAX_SYMBOLS = 120;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.end(JSON.stringify(body));
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function average(values) {
  const nums = values.map(number).filter(Number.isFinite);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function pct(current, base) {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null;
  return Number((((current - base) / base) * 100).toFixed(2));
}

async function fetchJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 MatrixDashboard/1.0" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function yahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const data = await fetchJson(url);
  const result = data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = (quote.close || []).map(number).filter(Number.isFinite);
  const volumes = (quote.volume || []).map(number).filter(Number.isFinite);
  const last = number(meta.regularMarketPrice) ?? closes.at(-1);
  const prev = number(meta.chartPreviousClose) ?? number(meta.previousClose) ?? closes.at(-2) ?? last;
  const high52 = number(meta.fiftyTwoWeekHigh) ?? (closes.length ? Math.max(...closes) : null);
  const ema100 = average(closes.slice(-100));
  const volume = volumes.at(-1) ?? null;
  const avgVolume = average(volumes.slice(-21, -1));

  if (!Number.isFinite(last)) throw new Error("No Yahoo price");

  return {
    last,
    prev,
    changePct: pct(last, prev),
    dist52Pct: high52 ? pct(last, high52) : null,
    volumeRatio: avgVolume && volume ? Number((volume / avgVolume).toFixed(2)) : null,
    aboveEma100: Number.isFinite(ema100) ? last >= ema100 : null,
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
    source: "Yahoo",
  };
}

async function stooqQuote(symbol) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol.toLowerCase() + ".us")}&f=sd2t2ohlcv&h&e=csv`;
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 MatrixDashboard/1.0" } });
  if (!response.ok) throw new Error(`Stooq HTTP ${response.status}`);
  const parts = (await response.text()).trim().split(",");
  const open = number(parts[3]);
  const close = number(parts[6]);
  const volume = number(parts[7]);
  if (!Number.isFinite(close)) throw new Error("No Stooq price");
  return {
    last: close,
    prev: open ?? close,
    changePct: open ? pct(close, open) : 0,
    dist52Pct: null,
    volumeRatio: volume ? Number(Math.max(0.1, volume / 30000000).toFixed(2)) : null,
    aboveEma100: null,
    marketTime: new Date().toISOString(),
    source: "Stooq",
  };
}

async function quote(symbol) {
  try {
    return await yahooQuote(symbol);
  } catch {
    return await stooqQuote(symbol);
  }
}

async function mapLimit(items, limit, mapper) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end();
    return;
  }

  const raw = String(req.query?.symbols || "");
  const symbols = [...new Set(raw.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean))]
    .filter((symbol) => /^[A-Z.]{1,10}$/.test(symbol))
    .slice(0, MAX_SYMBOLS);

  if (!symbols.length) {
    json(res, 400, { error: "symbols query is required", results: {} });
    return;
  }

  const entries = await mapLimit(symbols, 10, async (symbol) => {
    try {
      return [symbol, await quote(symbol)];
    } catch (error) {
      return [symbol, { error: error.message || "quote failed" }];
    }
  });

  json(res, 200, {
    updatedAt: new Date().toISOString(),
    results: Object.fromEntries(entries),
  });
}
