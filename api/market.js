module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const symbols = [...new Set(String(req.query.symbols || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean))]
    .slice(0, 40);

  if (!symbols.length) {
    return res.status(400).json({ error: 'symbols required' });
  }

  const results = {};
  await Promise.all(symbols.map(async symbol => {
    results[symbol] = await getMarketSnapshot(symbol);
  }));

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
  return res.status(200).json({ at: Date.now(), results });
};

async function getMarketSnapshot(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 InvestmentMatrix/1.0' }
    });
    const data = await response.json();
    const result = data.chart && data.chart.result && data.chart.result[0];
    if (!response.ok || !result) {
      const message = data.chart && data.chart.error && data.chart.error.description;
      throw new Error(message || 'No chart data');
    }

    const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
    const rawCloses = (quote && quote.close) || [];
    const closes = compactNumbers(rawCloses);
    const highs = compactNumbers((quote && quote.high) || []);
    if (closes.length < 2 || highs.length < 2) throw new Error('Not enough data');

    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const high52 = Math.max(...highs);
    const ema100 = ema(closes, 100);

    return {
      last,
      prev,
      changePct: prev ? ((last - prev) / prev) * 100 : null,
      high52,
      dist52Pct: high52 ? ((last / high52) - 1) * 100 : null,
      ema100,
      aboveEma100: ema100 == null ? null : last >= ema100,
      distEmaPct: ema100 == null ? null : ((last / ema100) - 1) * 100,
      history: sampleHistory(rawCloses, result.timestamp || []),
      currency: (result.meta && result.meta.currency) || '',
      marketTime: (result.meta && result.meta.regularMarketTime) || null
    };
  } catch (err) {
    return { error: err.message || 'Market data error' };
  }
}

function compactNumbers(values) {
  return values.filter(v => Number.isFinite(v));
}

function sampleHistory(closes, timestamps) {
  const rows = [];
  for (let i = 0; i < closes.length; i++) {
    if (Number.isFinite(closes[i])) rows.push({ t: timestamps[i] || i, c: closes[i] });
  }
  return rows.slice(-120);
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < values.length; i++) {
    current = values[i] * k + current * (1 - k);
  }
  return current;
}
