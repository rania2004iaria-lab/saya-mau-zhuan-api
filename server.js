const http = require('http');
const fetch = require('node-fetch');

const PORT = process.env.PORT || 3001;

const IDX_STOCKS = {
  'BBCA': 'BBCA.JK', 'BBRI': 'BBRI.JK', 'BMRI': 'BMRI.JK',
  'BBNI': 'BBNI.JK', 'BRIS': 'BRIS.JK',
  'TLKM': 'TLKM.JK', 'GOTO': 'GOTO.JK', 'EMTK': 'EMTK.JK', 'DNET': 'DNET.JK',
  'UNVR': 'UNVR.JK', 'ICBP': 'ICBP.JK', 'INDF': 'INDF.JK', 'MYOR': 'MYOR.JK',
  'ADRO': 'ADRO.JK', 'ITMG': 'ITMG.JK', 'BSSR': 'BSSR.JK', 'HRUM': 'HRUM.JK',
  'PGAS': 'PGAS.JK', 'AKRA': 'AKRA.JK', 'MEDC': 'MEDC.JK',
  'BSDE': 'BSDE.JK', 'CTRA': 'CTRA.JK', 'SMRA': 'SMRA.JK',
  'ASII': 'ASII.JK', 'AUTO': 'AUTO.JK'
};

const IHSG_SYMBOL = '^JKSE';
const TIMEOUT_MS = 10000;

async function yahooFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(function() { controller.abort(); }, TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) throw new Error('Yahoo Finance HTTP ' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getQuote(symbol) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?interval=1d&range=2d';
  const data = await yahooFetch(url);
  const result = data.chart.result[0];
  const meta = result.meta;
  const quotes = result.indicators.quote[0];
  const closes = quotes.close.filter(function(c) { return c !== null; });
  const previousClose = closes.length >= 2 ? closes[closes.length - 2] : meta.previousClose;
  const currentPrice = meta.regularMarketPrice;
  return {
    symbol: symbol,
    name: meta.shortName || meta.longName || symbol,
    price: currentPrice,
    previousClose: previousClose,
    change: currentPrice - previousClose,
    changePercent: ((currentPrice - previousClose) / previousClose) * 100,
    dayHigh: meta.regularMarketDayHigh,
    dayLow: meta.regularMarketDayLow,
    volume: meta.regularMarketVolume
  };
}

async function getChart(symbol, range, interval) {
  range = range || '1d';
  interval = interval || '1d';
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?interval=' + interval + '&range=' + range;
  const data = await yahooFetch(url);
  const result = data.chart.result[0];
  const timestamps = result.timestamp || [];
  const ohlvc = result.indicators.quote[0];
  return timestamps.map(function(ts, i) {
    return {
      date: new Date(ts * 1000).toISOString(),
      open: ohlvc.open[i],
      high: ohlvc.high[i],
      low: ohlvc.low[i],
      close: ohlvc.close[i],
      volume: ohlvc.volume[i]
    };
  }).filter(function(q) { return q.close !== null; });
}

function sendJSON(res, data, statusCode) {
  statusCode = statusCode || 200;
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function sendError(res, message, statusCode) {
  statusCode = statusCode || 500;
  sendJSON(res, { success: false, error: message }, statusCode);
}

const server = http.createServer(async function(req, res) {
  const url = new URL(req.url, 'http://' + req.headers.host);
  const path = url.pathname;
  const params = url.searchParams;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  try {
    if (path === '/api/health') {
      sendJSON(res, { status: 'ok', service: 'Saya Mau 赚钱 API', timestamp: new Date().toISOString() });

    } else if (path === '/api/ihsg') {
      const quote = await getQuote(IHSG_SYMBOL);
      quote.lastUpdate = new Date().toISOString();
      sendJSON(res, { success: true, data: quote });

    } else if (path === '/api/ihsg/history') {
      const history = await getChart(IHSG_SYMBOL, '7d', '1d');
      sendJSON(res, { success: true, data: history });

    } else if (path.startsWith('/api/chart/')) {
      const symbol = path.split('/api/chart/')[1];
      const range = params.get('range') || '1mo';
      const interval = params.get('interval') || '1d';
      const yahooSymbol = IDX_STOCKS[symbol.toUpperCase()] || (symbol.toUpperCase() + '.JK');
      const history = await getChart(yahooSymbol, range, interval);
      sendJSON(res, { success: true, data: history });

    } else if (path.startsWith('/api/quote/')) {
      const symbol = path.split('/api/quote/')[1];
      const yahooSymbol = IDX_STOCKS[symbol.toUpperCase()] || (symbol.toUpperCase() + '.JK');
      const quote = await getQuote(yahooSymbol);
      quote.lastUpdate = new Date().toISOString();
      sendJSON(res, { success: true, data: quote });

    } else if (path === '/api/quotes') {
      const symbols = Object.entries(IDX_STOCKS);
      const results = [];
      for (let i = 0; i < symbols.length; i += 5) {
        const batch = symbols.slice(i, i + 5);
        const batchResults = await Promise.allSettled(
          batch.map(async function(entry) {
            const code = entry[0];
            const yahooSymbol = entry[1];
            const quote = await getQuote(yahooSymbol);
            quote.symbol = code;
            return quote;
          })
        );
        batchResults.forEach(function(r) {
          if (r.status === 'fulfilled') results.push(r.value);
        });
        if (i + 5 < symbols.length) await new Promise(function(r) { setTimeout(r, 500); });
      }
      sendJSON(res, { success: true, data: results });

    } else {
      sendError(res, 'Not found', 404);
    }
  } catch (e) {
    console.error('API Error:', e.message);
    sendError(res, e.message);
  }
});

server.listen(PORT, function() {
  console.log('Saya Mau 赚钱 API running on port ' + PORT);
});
