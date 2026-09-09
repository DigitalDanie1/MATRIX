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
    .map(s => s.trim().toUpperCase())
    .filter(Boolean))]
    .slice(0, 35);

  if (!symbols.length) return res.status(400).json({ error: 'symbols required' });

  const results = {};
  await Promise.all(symbols.map(async symbol => {
    results[symbol] = await getFundamentals(symbol);
  }));

  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200');
  return res.status(200).json({ at: Date.now(), source: 'Nasdaq public summary', results });
};

async function getFundamentals(symbol) {
  if (!/^[A-Z.]{1,8}$/.test(symbol)) return { error: 'US symbol only' };
  try {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=stocks`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 InvestmentMatrix/1.0',
        'Origin': 'https://www.nasdaq.com',
        'Referer': `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}`
      }
    });
    const data = await response.json();
    const summary = data && data.data && data.data.summaryData;
    if (!response.ok || !summary) throw new Error('No fundamentals data');

    const target = money(summary.OneYrTarget && summary.OneYrTarget.value);
    const previousClose = money(summary.PreviousClose && summary.PreviousClose.value);
    const marketCapRaw = numberValue(summary.MarketCap && summary.MarketCap.value);
    const marketCap = formatLargeNumber(marketCapRaw);
    const yieldPct = percent(summary.Yield && summary.Yield.value);
    const targetUpsidePct = target && previousClose ? ((target / previousClose) - 1) * 100 : null;

    return {
      target,
      previousClose,
      targetUpsidePct,
      marketCap,
      marketCapRaw,
      yieldPct,
      exchange: value(summary.Exchange),
      sector: value(summary.Sector),
      industry: value(summary.Industry),
      analystOpinion: target ? '1Y target consensus' : null
    };
  } catch (err) {
    return { error: err.message || 'Fundamentals data error' };
  }
}

function value(field) {
  return field && field.value && field.value !== 'N/A' ? field.value : null;
}

function money(text) {
  const raw = value({ value: text });
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function numberValue(text) {
  const raw = value({ value: text });
  if (!raw) return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function formatLargeNumber(n) {
  if (!Number.isFinite(n)) return null;
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return String(Math.round(n));
}

function percent(text) {
  const raw = value({ value: text });
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
