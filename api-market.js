import yahooFinance from "yahoo-finance2";

const MAX_SYMBOLS = 80;

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function avg(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function pct(current, base) {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null;
  return Number((((current - base) / base) * 100).toFixed(2));
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

async function quote(symbol) {
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - 1);
  const chart = await yahooFinance.chart(symbol, { period1, interval: "1d" });
  const result = chart?.quotes || [];
  const closes = result.map((item) => numberOrNull(item.close)).filter(Number.isFinite);
  const volumes = result.map((item) => numberOrNull(item.volume)).filter(Number.isFinite);
  const last = closes.at(-1);
  const prev = closes.at(-2) ?? last;
  const high52 = closes.length ? Math.max(...closes) : null;
  const ema100 = avg(closes.slice(-100));
  const volume = volumes.at(-1) ?? null;
  const avgVolume = avg(volumes.slice(-21, -1));

  if (!Number.isFinite(last)) throw new Error("No price");

  return {
    last,
    prev,
    changePct: pct(last, prev),
    dist52Pct: high52 ? pct(last, high52) : null,
    volumeRatio: avgVolume && volume ? Number((volume / avgVolume).toFixed(2)) : null,
    aboveEma100: Number.isFinite(ema100) ? last >= ema100 : null,
    marketTime: result.at(-1)?.date ? new Date(result.at(-1).date).toISOString() : new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  const symbols = [...new Set(String(req.query.symbols || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => /^[A-Z.]{1,10}$/.test(item)))]
    .slice(0, MAX_SYMBOLS);

  if (!symbols.length) {
    res.status(400).json({ error: "symbols query is required", results: {} });
    return;
  }

  const entries = await mapLimit(symbols, 8, async (symbol) => {
    try {
      return [symbol, await quote(symbol)];
    } catch (error) {
      return [symbol, { error: error.message || "quote failed" }];
    }
  });

  res.status(200).json({
    source: "Yahoo Finance",
    updatedAt: new Date().toISOString(),
    results: Object.fromEntries(entries),
  });
}
