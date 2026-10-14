/* =========================================================================
 * prices.js — Cotizaciones en vivo desde APIs públicas gratuitas.
 *
 *  Cripto  → Binance (sin API key). Par TICKER/USDT; USDT se trata como USD.
 *            Se usa data-api.binance.vision (solo datos de mercado) y, si
 *            falla, api.binance.com.
 *  Acciones/ETF → Finnhub (API key gratuita en finnhub.io). Plan gratuito:
 *            bolsas de EE. UU., cotización en USD.
 *  Divisas → open.er-api.com (sin key, 160+ monedas) con respaldo en
 *            Frankfurter (BCE).
 *  Otros   → precio manual.
 *
 * Si una consulta falla se conserva el último precio conocido y su hora,
 * y se anota el error para mostrarlo en la interfaz.
 * ========================================================================= */
(function (root) {
  'use strict';

  var C = root.Calc;
  var BINANCE_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
  var STABLECOINS = { USDT: 1, USDC: 1, FDUSD: 1, DAI: 1, TUSD: 1, BUSD: 1 };

  function getJSON(url, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function (e) {
        throw new Error(e.name === 'AbortError' ? 'tiempo de espera agotado' : (e.message === 'Failed to fetch' ? 'sin conexión o bloqueado' : e.message));
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  // ---------------------------------------------------------------- cripto
  function binanceSymbol(ticker) {
    var t = ticker.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /USDT$/.test(t) && t !== 'USDT' ? t : t + 'USDT';
  }

  function parseBinance(row) {
    return {
      price: Number(row.lastPrice), currency: 'USD', change24h: Number(row.priceChangePercent),
      time: Number(row.closeTime) || Date.now(), source: 'Binance'
    };
  }

  /** Devuelve { TICKER: cotización | {error} } */
  async function fetchCrypto(tickers) {
    var out = {}, pending = {};
    tickers.forEach(function (t) {
      if (STABLECOINS[t]) out[t] = { price: 1, currency: 'USD', change24h: 0, time: Date.now(), source: 'Estable (1 USD)' };
      else pending[binanceSymbol(t)] = t;
    });
    var symbols = Object.keys(pending);
    if (!symbols.length) return out;

    // 1) Una sola consulta con todos los símbolos.
    for (var h = 0; h < BINANCE_HOSTS.length; h++) {
      try {
        var url = BINANCE_HOSTS[h] + '/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(symbols));
        var rows = await getJSON(url);
        rows.forEach(function (r) { out[pending[r.symbol]] = parseBinance(r); });
        return out;
      } catch (e) { /* probar siguiente host o modo individual */ }
    }
    // 2) Un símbolo inválido hace fallar la consulta completa: probar uno a uno.
    await Promise.all(symbols.map(async function (sym) {
      var lastErr;
      for (var i = 0; i < BINANCE_HOSTS.length; i++) {
        try {
          var row = await getJSON(BINANCE_HOSTS[i] + '/api/v3/ticker/24hr?symbol=' + sym);
          out[pending[sym]] = parseBinance(row);
          return;
        } catch (e) { lastErr = e; }
      }
      out[pending[sym]] = { error: /^HTTP 400/.test(lastErr.message) ? 'Binance no reconoce el par ' + sym : 'Binance no respondió (' + lastErr.message + ')' };
    }));
    return out;
  }

  /** Cierres diarios de los últimos 30 días → { ret30, vol30, maxDrawdown } o null si falla. */
  async function fetchCryptoHistory(ticker) {
    var sym = binanceSymbol(ticker);
    for (var i = 0; i < BINANCE_HOSTS.length; i++) {
      try {
        var rows = await getJSON(BINANCE_HOSTS[i] + '/api/v3/klines?symbol=' + sym + '&interval=1d&limit=31');
        return C.priceStats(rows.map(function (k) { return k[4]; })); // k[4] = cierre
      } catch (e) { /* siguiente host */ }
    }
    return null;
  }

  // ---------------------------------------------------------------- acciones / ETF
  async function fetchStocks(tickers, key) {
    var out = {};
    if (!key) {
      tickers.forEach(function (t) { out[t] = { error: 'Falta la API key de Finnhub (Ajustes)' }; });
      return out;
    }
    // Secuencial para respetar el límite gratuito (60 consultas/minuto).
    for (var i = 0; i < tickers.length; i++) {
      var t = tickers[i];
      try {
        var q = await getJSON('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(t) + '&token=' + encodeURIComponent(key));
        if (!q || !(q.c > 0)) throw new Error('Finnhub no tiene cotización para ' + t);
        out[t] = { price: Number(q.c), currency: 'USD', change24h: Number(q.dp) || 0, time: q.t ? q.t * 1000 : Date.now(), source: 'Finnhub' };
      } catch (e) {
        out[t] = { error: e.message === 'HTTP 401' ? 'API key de Finnhub inválida' : e.message };
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- divisas
  /** Devuelve { rates: {CUR: valor de 1 CUR en base}, source, time } */
  async function fetchFx(base, codes) {
    codes = codes.filter(function (c) { return c !== base; });
    if (!codes.length) return { rates: {}, source: '', time: Date.now() };
    var res = {};
    try {
      var d = await getJSON('https://open.er-api.com/v6/latest/' + encodeURIComponent(base));
      if (d.result !== 'success') throw new Error('respuesta inválida');
      codes.forEach(function (c) { if (d.rates[c] > 0) res[c] = C.round(1 / d.rates[c], 10); });
      return { rates: res, source: 'ExchangeRate-API', time: (d.time_last_update_unix || Date.now() / 1000) * 1000 };
    } catch (e1) {
      try {
        var f = await getJSON('https://api.frankfurter.dev/v1/latest?base=' + encodeURIComponent(base) + '&symbols=' + codes.join(','));
        codes.forEach(function (c) { if (f.rates[c] > 0) res[c] = C.round(1 / f.rates[c], 10); });
        return { rates: res, source: 'Frankfurter (BCE)', time: Date.parse(f.date) || Date.now() };
      } catch (e2) {
        throw new Error('No se pudieron obtener tasas de cambio (' + e1.message + ')');
      }
    }
  }

  /**
   * Tasas en vivo desde Binance usando el par con USDT (1 USDT = 1 USD):
   *  EURUSDT = 1.12  → 1 EUR = 1.12 USD ;  USDTMXN = 18.4 → 1 MXN = 1/18.4 USD
   * Devuelve { CUR: dólares por 1 CUR }. Las monedas sin par se recuerdan 6 h para no reintentar.
   */
  var noLivePair = {};
  async function fetchFxLive(codes) {
    var out = {};
    await Promise.all(codes.map(async function (c) {
      if (c === 'USD' || STABLECOINS[c]) { out[c] = 1; return; }
      if (noLivePair[c] && Date.now() - noLivePair[c] < 6 * 3600 * 1000) return;
      var tries = [[c + 'USDT', false], ['USDT' + c, true]];
      for (var i = 0; i < tries.length; i++) {
        for (var h = 0; h < BINANCE_HOSTS.length; h++) {
          try {
            var d = await getJSON(BINANCE_HOSTS[h] + '/api/v3/ticker/price?symbol=' + tries[i][0], 6000);
            var p = Number(d.price);
            if (p > 0) { out[c] = tries[i][1] ? 1 / p : p; return; }
          } catch (e) {
            if (/HTTP 400/.test(e.message)) break; // el par no existe: probar el inverso
          }
        }
      }
      noLivePair[c] = Date.now();
    }));
    return out;
  }

  /**
   * Actualiza las tasas no fijadas a mano: primero en vivo (Binance), y las que no tengan par,
   * con la API diaria. Anota la fuente de cada una en settings.rateSources.
   */
  async function refreshRates(s, codes) {
    var base = s.baseCurrency, now = Date.now();
    s.rateSources = s.rateSources || {};
    var live = await fetchFxLive(codes.concat([base]));
    var usdPerBase = (base === 'USD' || STABLECOINS[base]) ? 1 : live[base];
    var pending = [];
    codes.forEach(function (c) {
      if (c === base) return;
      if (usdPerBase > 0 && live[c] > 0) {
        s.rates[c] = C.round(live[c] / usdPerBase, 10);
        s.rateSources[c] = { source: 'Binance', live: true, at: now };
      } else pending.push(c);
    });
    if (pending.length) {
      var fx = await fetchFx(base, pending); // lanza error si fallan ambas APIs
      Object.keys(fx.rates).forEach(function (c) {
        s.rates[c] = fx.rates[c];
        s.rateSources[c] = { source: fx.source, live: false, at: fx.time };
      });
    }
    s.ratesUpdatedAt = now;
  }

  // ---------------------------------------------------------------- orquestación
  /**
   * Actualiza tasas y precios dentro de `state` (lo modifica).
   * Devuelve { updated, failed: [{ticker, error}], fxError }.
   */
  async function refresh(state) {
    var s = state.settings, base = s.baseCurrency;
    var positions = C.buildPositions(state.investments, s.rates).positions.filter(function (p) { return p.quantity > 0; });
    var byType = { cripto: [], accion: [], etf: [], divisa: [] };
    positions.forEach(function (p) {
      if (byType[p.assetType] && byType[p.assetType].indexOf(p.ticker) === -1) byType[p.assetType].push(p.ticker);
    });
    var result = { updated: 0, failed: [], fxError: null };

    // 1) Tasas de cambio (se respetan las fijadas a mano).
    var needUsd = byType.cripto.length || byType.accion.length || byType.etf.length;
    var codes = Object.keys(s.rates).filter(function (c) { return !s.rateLocks[c]; });
    if (needUsd && codes.indexOf('USD') === -1 && !s.rates.USD) codes.push('USD');
    byType.divisa.forEach(function (c) { if (codes.indexOf(c) === -1 && !s.rates[c]) codes.push(c); });
    if (s.autoFx || (needUsd && !s.rates.USD)) {
      try {
        await refreshRates(s, (s.autoFx ? codes : ['USD']).filter(function (c) { return !s.rateLocks[c]; }));
      } catch (e) { result.fxError = e.message; }
    }
    // Monedas estables (USDT, USDC…) como moneda de cuenta: valen lo mismo que el dólar
    Object.keys(s.rates).forEach(function (c) {
      if (STABLECOINS[c] && !s.rateLocks[c] && Number(s.rates.USD) > 0) s.rates[c] = s.rates.USD;
    });

    // 2) Precios por tipo de activo.
    var batches = await Promise.all([
      fetchCrypto(byType.cripto).then(function (r) { return ['cripto', r]; }),
      fetchStocks(byType.accion.concat(byType.etf.filter(function (t) { return byType.accion.indexOf(t) === -1; })), s.finnhubKey)
        .then(function (r) { return ['bolsa', r]; })
    ]);
    var now = Date.now();
    function store(assetType, ticker, q) {
      var key = C.priceKey(assetType, ticker);
      var prev = state.prices[key];
      if (q && !q.error) {
        state.prices[key] = Object.assign({}, q, { lastAttempt: now, error: null });
        if (prev && prev.history) { state.prices[key].history = prev.history; state.prices[key].historyAt = prev.historyAt; }
        result.updated++;
      } else {
        // Conservar el último precio conocido; anotar el error.
        state.prices[key] = Object.assign({ price: null }, prev || {}, { lastAttempt: now, error: q ? q.error : 'sin respuesta' });
        // Un activo con precio manual no cuenta como fallo: el usuario ya lo valoró.
        if (!prev || prev.source !== 'manual') result.failed.push({ ticker: ticker, error: state.prices[key].error });
      }
    }
    byType.cripto.forEach(function (t) { store('cripto', t, batches[0][1][t]); });

    // Historial de 30 días de cripto (para recomendaciones). Se renueva cada 6 h.
    await Promise.all(byType.cripto.map(async function (t) {
      var p = state.prices[C.priceKey('cripto', t)];
      if (!p || p.error || STABLECOINS[t] || (p.historyAt && now - p.historyAt < 6 * 3600 * 1000)) return;
      var h = await fetchCryptoHistory(t);
      if (h) { p.history = h; p.historyAt = now; }
    }));

    byType.accion.forEach(function (t) { store('accion', t, batches[1][1][t]); });
    byType.etf.forEach(function (t) { store('etf', t, batches[1][1][t]); });

    // 3) Divisas como activo: precio = tasa a la base.
    byType.divisa.forEach(function (t) {
      var r = s.rates[t];
      store('divisa', t, r > 0 ? { price: r, currency: base, change24h: null, time: s.ratesUpdatedAt || now, source: 'Tasa de cambio' }
                               : { error: 'Sin tasa para ' + t });
    });

    return result;
  }

  root.Prices = { refresh: refresh, refreshRates: refreshRates, fetchFxLive: fetchFxLive, fetchCrypto: fetchCrypto, fetchCryptoHistory: fetchCryptoHistory, fetchStocks: fetchStocks, fetchFx: fetchFx, binanceSymbol: binanceSymbol };

  // =========================================================================
  // Market — datos para la ficha de un activo: búsqueda, historial, logo y
  // precio en vivo.
  // =========================================================================
  var cryptoList = null, cryptoListAt = 0;

  /**
   * Criptos con par USDT que se negociaron en las últimas 24 h en Binance (se cachea 1 h).
   * Así se excluyen pares retirados (p. ej. tokens apalancados antiguos) que aún aparecen con un precio viejo.
   */
  async function listCryptoSymbols() {
    if (cryptoList && Date.now() - cryptoListAt < 3600 * 1000) return cryptoList;
    for (var i = 0; i < BINANCE_HOSTS.length; i++) {
      try {
        var rows = await getJSON(BINANCE_HOSTS[i] + '/api/v3/ticker/24hr?type=MINI', 15000);
        var fresh = Date.now() - 24 * 3600 * 1000;
        var seen = {};
        rows.forEach(function (r) {
          var m = /^([A-Z0-9]+)USDT$/.exec(r.symbol);
          if (m && Number(r.lastPrice) > 0 && Number(r.closeTime) > fresh) seen[m[1]] = { price: Number(r.lastPrice), volume: Number(r.quoteVolume) || 0 };
        });
        cryptoList = Object.keys(seen).sort().map(function (t) { return { ticker: t, price: seen[t].price, volume: seen[t].volume }; });
        cryptoListAt = Date.now();
        return cryptoList;
      } catch (e) { /* siguiente host */ }
    }
    return cryptoList || [];
  }

  /** Velas de Binance → [[tiempo de cierre ms, precio de cierre]] */
  async function fetchKlines(ticker, interval, opts) {
    opts = opts || {};
    var sym = binanceSymbol(ticker);
    var q = '/api/v3/klines?symbol=' + sym + '&interval=' + interval + '&limit=' + (opts.limit || 500) +
      (opts.startTime ? '&startTime=' + Math.floor(opts.startTime) : '');
    var lastErr;
    for (var i = 0; i < BINANCE_HOSTS.length; i++) {
      try {
        var rows = await getJSON(BINANCE_HOSTS[i] + q, 12000);
        return rows.map(function (k) { return [Math.min(Number(k[6]), Date.now()), Number(k[4])]; });
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('sin datos');
  }

  /** Nombre y logo de una cripto (CoinGecko; respaldo: repositorio de iconos). */
  async function fetchCryptoMeta(ticker) {
    var t = ticker.toUpperCase();
    var fallback = { name: t, logo: 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + t.toLowerCase() + '.png' };
    try {
      var d = await getJSON('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(t), 8000);
      // Varias monedas pueden compartir símbolo: se toma la de mayor capitalización.
      var coins = (d.coins || []).filter(function (c) { return String(c.symbol).toUpperCase() === t; })
        .sort(function (a, b) { return (a.market_cap_rank || 1e9) - (b.market_cap_rank || 1e9); });
      if (coins.length) return { name: coins[0].name, logo: coins[0].large || coins[0].thumb || fallback.logo, source: 'CoinGecko' };
    } catch (e) { /* respaldo */ }
    return fallback;
  }

  /** Nombre y logo de una acción/ETF (Finnhub, requiere key). */
  async function fetchStockMeta(ticker, key) {
    if (!key) return { name: ticker };
    try {
      var d = await getJSON('https://finnhub.io/api/v1/stock/profile2?symbol=' + encodeURIComponent(ticker) + '&token=' + encodeURIComponent(key));
      return { name: d.name || ticker, logo: d.logo || null, exchange: d.exchange, currency: d.currency, source: 'Finnhub' };
    } catch (e) { return { name: ticker }; }
  }

  /** Búsqueda de acciones/ETF en Finnhub. */
  async function searchStocks(query, key) {
    if (!key || !query) return [];
    try {
      var d = await getJSON('https://finnhub.io/api/v1/search?q=' + encodeURIComponent(query) + '&token=' + encodeURIComponent(key));
      return (d.result || []).filter(function (r) { return r.symbol && r.symbol.indexOf('.') === -1; }).slice(0, 8).map(function (r) {
        return { ticker: r.symbol, name: r.description, assetType: /ETP|ETF/i.test(r.type) ? 'etf' : 'accion' };
      });
    } catch (e) { return []; }
  }

  /** Historial diario de acciones (Finnhub; en el plan gratuito suele no estar disponible). */
  async function fetchStockCandles(ticker, key, fromMs, toMs) {
    if (!key) throw new Error('Falta la API key de Finnhub');
    var d;
    try {
      d = await getJSON('https://finnhub.io/api/v1/stock/candle?symbol=' + encodeURIComponent(ticker) + '&resolution=D&from=' +
        Math.floor(fromMs / 1000) + '&to=' + Math.floor(toMs / 1000) + '&token=' + encodeURIComponent(key));
    } catch (e) {
      throw new Error(/HTTP 40[13]/.test(e.message) ? 'El historial de acciones no está incluido en el plan gratuito de Finnhub' : e.message);
    }
    if (!d || d.s !== 'ok') throw new Error('Sin historial para ' + ticker);
    return d.t.map(function (t, i) { return [t * 1000, d.c[i]]; });
  }

  /**
   * Precio en vivo de una cripto por WebSocket (Binance @ticker).
   * onTick({price, change24h, high, low, volume, time}) · onStatus('live'|'connecting'|'polling'|'offline')
   * Si el WebSocket falla se reintenta con espera creciente y, mientras tanto, se consulta por REST cada 5 s.
   */
  function liveCrypto(ticker, onTick, onStatus) {
    var sym = binanceSymbol(ticker).toLowerCase();
    var urls = ['wss://data-stream.binance.vision/ws/' + sym + '@ticker', 'wss://stream.binance.com:9443/ws/' + sym + '@ticker'];
    var ws = null, closed = false, attempt = 0, pollTimer = null, retryTimer = null, watchdog = null, gotData = false;

    function emit(c, P, h, l, q, E) {
      onTick({ price: Number(c), change24h: Number(P), high: Number(h), low: Number(l), volume: Number(q), time: Number(E) || Date.now() });
    }
    function poll() {
      if (closed) return;
      fetchCrypto([ticker]).then(function (r) {
        var x = r[ticker];
        if (x && !x.error) { emit(x.price, x.change24h, NaN, NaN, NaN, x.time); onStatus('polling'); }
        else onStatus('offline');
      });
    }
    function startPolling() { if (!pollTimer) { poll(); pollTimer = setInterval(poll, 5000); } }
    function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
    function connect() {
      if (closed) return;
      onStatus('connecting');
      try { ws = new WebSocket(urls[attempt % urls.length]); } catch (e) { scheduleRetry(); return; }
      // "En vivo" solo cuando llega el primer precio; si en 12 s no llega nada, se consulta por REST.
      ws.onopen = function () {
        attempt = 0;
        clearTimeout(watchdog);
        watchdog = setTimeout(function () { if (!gotData) startPolling(); }, 12000);
      };
      ws.onmessage = function (m) {
        try {
          var d = JSON.parse(m.data);
          if (!gotData) { gotData = true; stopPolling(); clearTimeout(watchdog); }
          emit(d.c, d.P, d.h, d.l, d.q, d.E);
          onStatus('live');
        } catch (e) { /* mensaje inválido */ }
      };
      ws.onclose = function () { if (!closed) scheduleRetry(); };
      ws.onerror = function () { try { ws.close(); } catch (e) { /* ya cerrado */ } };
    }
    function scheduleRetry() {
      gotData = false;
      startPolling();
      attempt++;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, Math.min(30000, 2000 * attempt));
    }
    poll();     // precio inmediato por REST mientras se abre el WebSocket
    connect();
    return { close: function () { closed = true; stopPolling(); clearTimeout(retryTimer); clearTimeout(watchdog); if (ws) try { ws.close(); } catch (e) { /* nada */ } } };
  }

  /** Precio "en vivo" de una acción: consulta a Finnhub cada 15 s (límite gratuito: 60/min). */
  function liveStock(ticker, key, onTick, onStatus) {
    var closed = false;
    function poll() {
      if (closed) return;
      fetchStocks([ticker], key).then(function (r) {
        var x = r[ticker];
        if (closed) return;
        if (x && !x.error) { onTick({ price: x.price, change24h: x.change24h, time: x.time }); onStatus('polling'); }
        else onStatus('offline', x && x.error);
      });
    }
    poll();
    var timer = setInterval(poll, 15000);
    return { close: function () { closed = true; clearInterval(timer); } };
  }

  // =========================================================================
  // Explorar activos: listas, riesgo, ficha financiera y noticias.
  // Se guardan en una caché propia de este dispositivo (no se sincroniza).
  // =========================================================================
  var MKT_KEY = 'misFinanzas.market';
  function cacheAll() { try { return JSON.parse(root.localStorage.getItem(MKT_KEY)) || {}; } catch (e) { return {}; } }
  function cacheGet(k, maxAge) { var c = cacheAll()[k]; return c && Date.now() - c.at < maxAge ? c.data : null; }
  function cacheSet(k, data) {
    var all = cacheAll(); all[k] = { at: Date.now(), data: data };
    // Limpieza: se quitan entradas de más de 2 días
    Object.keys(all).forEach(function (x) { if (Date.now() - all[x].at > 2 * 86400000) delete all[x]; });
    try { root.localStorage.setItem(MKT_KEY, JSON.stringify(all)); } catch (e) { /* sin espacio: se ignora */ }
  }

  /** Criptos de mayor capitalización (CoinGecko) que se pueden seguir en Binance. Caché 30 min. */
  async function fetchTopCryptos(n) {
    var hit = cacheGet('top', 30 * 60000);
    if (hit) return hit;
    var markets = await getJSON('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=40&page=1', 12000);
    var bin = (await listCryptoSymbols()).map(function (x) { return x.ticker; });
    var list = root.Insights.pickCryptos(markets, bin, n || 12);
    if (list.length) cacheSet('top', list);
    return list;
  }

  /** Riesgo con 1 año de cierres diarios de Binance. Caché 12 h. */
  async function fetchRisk(ticker) {
    var k = 'risk|' + ticker.toUpperCase();
    var hit = cacheGet(k, 12 * 3600000);
    if (hit) return hit;
    var rows = await fetchKlines(ticker, '1d', { limit: 366 });
    var st = root.Insights.riskStats(rows.map(function (r) { return r[1]; }), 365);
    if (st) cacheSet(k, st);
    return st;
  }

  /** Id de CoinGecko de un símbolo (el de mayor capitalización). */
  async function coinId(ticker) {
    var t = ticker.toUpperCase(), k = 'cgid|' + t, hit = cacheGet(k, 7 * 86400000);
    if (hit) return hit;
    var d = await getJSON('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(t), 8000);
    var c = (d.coins || []).filter(function (x) { return String(x.symbol).toUpperCase() === t; })
      .sort(function (a, b) { return (a.market_cap_rank || 1e9) - (b.market_cap_rank || 1e9); })[0];
    if (!c) throw new Error('CoinGecko no reconoce ' + t);
    cacheSet(k, c.id);
    return c.id;
  }
  function firstSentences(html, n) {
    var txt = String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    var parts = txt.match(/[^.!?]+[.!?]+/g) || (txt ? [txt] : []);
    return parts.slice(0, n || 2).join(' ').trim();
  }
  /** Datos clave de una cripto (CoinGecko). Caché 6 h. */
  async function fetchCoinInfo(ticker) {
    var k = 'cinfo|' + ticker.toUpperCase(), hit = cacheGet(k, 6 * 3600000);
    if (hit) return hit;
    var id = await coinId(ticker);
    var d = await getJSON('https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(id) +
      '?localization=true&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false', 12000);
    var m = d.market_data || {}, usd = function (o) { return o && o.usd != null ? Number(o.usd) : null; };
    var info = {
      id: id, name: d.name, rank: d.market_cap_rank || null,
      marketCap: usd(m.market_cap), volume24h: usd(m.total_volume),
      ath: usd(m.ath), athChange: m.ath_change_percentage ? Number(m.ath_change_percentage.usd) : null,
      athDate: m.ath_date && m.ath_date.usd ? String(m.ath_date.usd).slice(0, 10) : null,
      circulating: m.circulating_supply || null, maxSupply: m.max_supply || null, totalSupply: m.total_supply || null,
      change7d: m.price_change_percentage_7d != null ? Number(m.price_change_percentage_7d) : null,
      change30d: m.price_change_percentage_30d != null ? Number(m.price_change_percentage_30d) : null,
      change1y: m.price_change_percentage_1y != null ? Number(m.price_change_percentage_1y) : null,
      categories: (d.categories || []).filter(Boolean).slice(0, 3),
      description: firstSentences((d.description || {}).es || (d.description || {}).en, 2),
      homepage: d.links && d.links.homepage ? d.links.homepage.filter(Boolean)[0] || null : null,
      source: 'CoinGecko'
    };
    cacheSet(k, info);
    return info;
  }

  /** Datos clave de una acción/ETF (Finnhub: perfil + métricas). Caché 6 h. */
  async function fetchStockInfo(ticker, key) {
    if (!key) throw new Error('Falta la API key de Finnhub');
    var k = 'sinfo|' + ticker.toUpperCase(), hit = cacheGet(k, 6 * 3600000);
    if (hit) return hit;
    var tk = encodeURIComponent(ticker), tok = encodeURIComponent(key);
    var res = await Promise.all([
      getJSON('https://finnhub.io/api/v1/stock/profile2?symbol=' + tk + '&token=' + tok).catch(function () { return {}; }),
      getJSON('https://finnhub.io/api/v1/stock/metric?symbol=' + tk + '&metric=all&token=' + tok).catch(function () { return {}; })
    ]);
    var p = res[0] || {}, mt = (res[1] && res[1].metric) || {};
    var num = function (v) { return v == null || !isFinite(v) ? null : Number(v); };
    var info = {
      name: p.name || ticker, industry: p.finnhubIndustry || null, country: p.country || null, exchange: p.exchange || null,
      marketCap: num(p.marketCapitalization) != null ? num(p.marketCapitalization) * 1e6 : null, ipo: p.ipo || null, weburl: p.weburl || null,
      high52: num(mt['52WeekHigh']), low52: num(mt['52WeekLow']), beta: num(mt.beta),
      pe: num(mt.peTTM != null ? mt.peTTM : mt.peBasicExclExtraTTM), dividendYield: num(mt.dividendYieldIndicatedAnnual),
      ret52: num(mt['52WeekPriceReturnDaily']), source: 'Finnhub'
    };
    cacheSet(k, info);
    return info;
  }

  /**
   * Noticias (Finnhub, con la API key gratuita). Acciones/ETF: noticias de la empresa (30 días).
   * Cripto: noticias cripto generales que mencionan el activo; si ninguna lo menciona, las más recientes.
   * Devuelve { items:[{headline, source, url, datetime, summary}], general:bool }
   */
  async function fetchNews(type, ticker, name, key) {
    if (!key) throw new Error('Falta la API key de Finnhub');
    var k = 'news|' + type + '|' + ticker.toUpperCase(), hit = cacheGet(k, 30 * 60000);
    if (hit) return hit;
    var tok = encodeURIComponent(key), out;
    var clean = function (list) {
      return (list || []).filter(function (n) { return n && n.headline && /^https?:\/\//.test(n.url || ''); }).map(function (n) {
        return { headline: n.headline, source: n.source || '', url: n.url, datetime: (n.datetime || 0) * 1000, summary: firstSentences(n.summary, 1) };
      });
    };
    if (type === 'cripto') {
      var all = clean(await getJSON('https://finnhub.io/api/v1/news?category=crypto&token=' + tok, 10000));
      var words = [ticker.toLowerCase()].concat(name && name.toLowerCase() !== ticker.toLowerCase() ? [name.toLowerCase()] : []);
      var mine = all.filter(function (n) {
        var t = (n.headline + ' ' + n.summary).toLowerCase();
        return words.some(function (w) { return new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(t); });
      });
      out = { items: (mine.length ? mine : all).slice(0, 6), general: !mine.length };
    } else {
      var to = new Date(), from = new Date(Date.now() - 30 * 86400000);
      var iso = function (d) { return d.toISOString().slice(0, 10); };
      out = { items: clean(await getJSON('https://finnhub.io/api/v1/company-news?symbol=' + encodeURIComponent(ticker) + '&from=' + iso(from) + '&to=' + iso(to) + '&token=' + tok, 10000)).slice(0, 6), general: false };
    }
    cacheSet(k, out);
    return out;
  }
  /** Enlace a Google Noticias (siempre disponible, sin clave). */
  function newsSearchUrl(q) { return 'https://news.google.com/search?q=' + encodeURIComponent(q) + '&hl=es-419&gl=US&ceid=US:es-419'; }

  root.Market = {
    listCryptoSymbols: listCryptoSymbols, fetchKlines: fetchKlines, fetchCryptoMeta: fetchCryptoMeta,
    fetchStockMeta: fetchStockMeta, searchStocks: searchStocks, fetchStockCandles: fetchStockCandles,
    liveCrypto: liveCrypto, liveStock: liveStock,
    fetchTopCryptos: fetchTopCryptos, fetchRisk: fetchRisk, fetchCoinInfo: fetchCoinInfo, fetchStockInfo: fetchStockInfo,
    fetchNews: fetchNews, newsSearchUrl: newsSearchUrl
  };
})(this);
