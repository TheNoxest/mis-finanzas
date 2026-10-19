/* =========================================================================
 * app/ficha-activo.js — Ficha de activo (gráfico, precio en vivo) y buscador de activos.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ ficha de activo
// Búsqueda, logo, historial, precio en vivo y gráfico con tus compras y ventas.
var asset = null;          // ficha abierta
var lastLiveSave = 0;
var POPULAR = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'USDC'];
var RANGE_LABELS = { mis: 'Mis operaciones', '1D': '1 D', '1S': '1 S', '1M': '1 M', '3M': '3 M', '1A': '1 A', todo: 'Todo' };

function metaKey(type, ticker) { return C.priceKey(type, ticker); }
function meta(type, ticker) { return (state.assetMeta && state.assetMeta[metaKey(type, ticker)]) || null; }
function logoHtml(type, ticker, cls) {
  var m = meta(type, ticker);
  var initials = esc(String(ticker).slice(0, 4));
  // Sin logo guardado: para cripto se prueba el repositorio de iconos; si falla, iniciales.
  var src = m && m.logo ? m.logo : (type === 'cripto' ? 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + String(ticker).toLowerCase() + '.png' : null);
  return '<span class="' + cls + '">' + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'' + initials + '\'))">' : initials) + '</span>';
}
function assetBadge(p) {
  var m = meta(p.assetType, p.ticker);
  return m && m.logo ? logoHtml(p.assetType, p.ticker, 'asset-badge has-logo')
    : '<span class="asset-badge" style="--type-color:' + ASSET_COLORS[p.assetType] + '">' + esc(p.ticker.slice(0, 4)) + '</span>';
}
function quoteCurrency(type, ticker) {
  if (type === 'cripto' || type === 'accion' || type === 'etf') return 'USD';
  if (type === 'divisa') return base();
  var op = state.investments.filter(function (o) { return o.assetType === type && o.ticker === ticker; })[0];
  return op ? op.currency : base();
}

/** Abre la ficha de un activo (cripto, acción, ETF, divisa u otro). */
function openAsset(type, ticker) {
  type = ASSET_LABELS[type] ? type : 'cripto';
  ticker = String(ticker).trim().toUpperCase().replace(/USDT$/, '') || 'BTC';
  closeAsset();
  var ops = state.investments.filter(function (o) { return o.assetType === type && o.ticker.toUpperCase() === ticker; });
  var q = state.prices[C.priceKey(type, ticker)];
  asset = {
    type: type, ticker: ticker, quoteCur: quoteCurrency(type, ticker), hasOps: ops.length > 0,
    range: ops.length ? 'mis' : (type === 'cripto' ? '1M' : 'mis'), points: [], loadId: 0,
    price: q && q.price != null ? q.price : null, change24h: q ? q.change24h : null, priceTime: q ? (q.lastAttempt || q.time) : null,
    status: 'connecting', chart: null, lastChart: 0
  };
  // Mostrar la vista (pestaña Inversiones activa)
  $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-activo'); });
  $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.view === 'inversiones'); });
  $('#settings-btn').classList.remove('active');
  var hash = '#activo/' + type + '/' + encodeURIComponent(ticker);
  if (location.hash !== hash) history.replaceState(null, '', hash);
  window.scrollTo(0, 0);
  hideSearch();

  renderAssetHeader();
  renderAssetRanges();
  renderAssetPosition();
  loadAssetMeta();
  loadAssetHistory();
  startLive();
  loadAssetInsights();
}

function closeAsset() {
  if (!asset) return;
  if (asset.conn) asset.conn.close();
  asset = null;
  S.save(state);
}

async function loadAssetMeta() {
  var a = asset, key = metaKey(a.type, a.ticker);
  state.assetMeta = state.assetMeta || {};
  var cached = state.assetMeta[key];
  if (cached && Date.now() - (cached.at || 0) < 7 * 86400000) return;
  var m;
  if (a.type === 'cripto') m = await Market.fetchCryptoMeta(a.ticker);
  else if (a.type === 'accion' || a.type === 'etf') m = await Market.fetchStockMeta(a.ticker, state.settings.finnhubKey);
  else m = { name: a.type === 'divisa' ? 'Divisa ' + a.ticker : a.ticker };
  state.assetMeta[key] = Object.assign({}, m, { at: Date.now() });
  S.save(state);
  if (asset === a) renderAssetHeader();
}

function renderAssetHeader() {
  var a = asset; if (!a) return;
  var m = meta(a.type, a.ticker) || {};
  $('#ad-logo').innerHTML = m.logo
    ? '<img src="' + esc(m.logo) + '" alt="" onerror="this.parentNode.textContent=\'' + esc(a.ticker.slice(0, 4)) + '\'">'
    : esc(a.ticker.slice(0, 4));
  $('#ad-name').textContent = m.name && m.name.toUpperCase() !== a.ticker ? m.name : a.ticker;
  $('#ad-sub').textContent = a.ticker + (a.type === 'cripto' ? '/USDT · Binance' : '') + ' · ' + ASSET_LABELS[a.type] + (m.exchange ? ' · ' + m.exchange : '');
  renderAssetPrice(null);
}

function renderAssetPrice(prev) {
  var a = asset; if (!a) return;
  var el = $('#ad-price');
  el.textContent = a.price != null ? fmtPrice(a.price, a.quoteCur) : '—';
  if (prev != null && a.price !== prev) {
    el.classList.remove('tick-up', 'tick-down');
    void el.offsetWidth; // reinicia la animación
    el.classList.add(a.price > prev ? 'tick-up' : 'tick-down');
    clearTimeout(renderAssetPrice._t);
    renderAssetPrice._t = setTimeout(function () { el.classList.remove('tick-up', 'tick-down'); }, 350);
  }
  $('#ad-change').innerHTML = a.change24h != null && isFinite(a.change24h)
    ? '<span class="' + trend(a.change24h) + '">' + fmtPct(a.change24h) + '</span> <span class="muted small">24 h</span>' : '';
  var st = $('#ad-live');
  var labels = {
    live: ['on', 'En vivo · Binance · ' + (a.priceTime ? new Date(a.priceTime).toLocaleTimeString(LOCALE) : '')],
    polling: ['on', 'Actualizando ' + (a.type === 'cripto' ? 'cada 5 s' : 'cada 15 s') + ' · ' + (a.priceTime ? new Date(a.priceTime).toLocaleTimeString(LOCALE) : '')],
    connecting: ['warn', 'Conectando…'],
    offline: ['', a.offlineMsg || (a.price != null ? 'Sin conexión · último precio ' + fmtTime(a.priceTime) : 'Sin conexión')],
    manual: ['', a.price != null ? 'Precio manual · ' + fmtTime(a.priceTime) : 'Sin precio: ingrésalo en «Mis activos»']
  };
  var l = labels[a.status] || labels.offline;
  st.innerHTML = '<span class="live-dot ' + l[0] + '"></span>' + esc(l[1]);
}

function startLive() {
  var a = asset;
  var onTick = function (t) {
    if (asset !== a) return;
    var prev = a.price;
    a.price = t.price; a.priceTime = t.time || Date.now();
    if (t.change24h != null && isFinite(t.change24h)) a.change24h = t.change24h;
    if (isFinite(t.volume)) a.volume = t.volume;
    renderAssetPrice(prev);
    updateLivePoint();
    saveLivePrice(a);
  };
  var onStatus = function (st, msg) { if (asset !== a) return; a.status = st; a.offlineMsg = msg || null; renderAssetPrice(null); };
  if (a.type === 'cripto') a.conn = Market.liveCrypto(a.ticker, onTick, onStatus);
  else if (a.type === 'accion' || a.type === 'etf') {
    if (state.settings.finnhubKey) a.conn = Market.liveStock(a.ticker, state.settings.finnhubKey, onTick, onStatus);
    else { a.status = 'offline'; a.offlineMsg = 'Para el precio en vivo de acciones añade tu API key de Finnhub en Ajustes'; renderAssetPrice(null); }
  } else if (a.type === 'divisa') {
    var r = rates()[a.ticker];
    a.price = r > 0 ? r : null; a.status = r > 0 ? 'manual' : 'offline'; a.priceTime = state.settings.ratesUpdatedAt;
    a.offlineMsg = 'Tasa de cambio actual de ' + a.ticker; renderAssetPrice(null);
  } else { a.status = 'manual'; renderAssetPrice(null); }
}

/** Si tienes el activo, el precio en vivo también actualiza tu portafolio (se guarda como máximo cada 30 s). */
function saveLivePrice(a) {
  var key = C.priceKey(a.type, a.ticker);
  if (!state.investments.some(function (o) { return C.priceKey(o.assetType, o.ticker) === key; })) return;
  var prev = state.prices[key] || {};
  state.prices[key] = Object.assign({}, prev, { price: a.price, currency: a.quoteCur, change24h: a.change24h, time: a.priceTime, lastAttempt: Date.now(),
    source: a.type === 'cripto' ? 'Binance' : 'Finnhub', error: null });
  if (Date.now() - lastLiveSave > 30000) { lastLiveSave = Date.now(); S.save(state); }
}

function renderAssetRanges() {
  var a = asset;
  var ranges = (a.type === 'cripto' ? ['1D', '1S', '1M', '3M', '1A', 'todo'] : []);
  if (a.hasOps) ranges.unshift('mis');
  $('#ad-ranges').innerHTML = ranges.map(function (r) {
    return '<button type="button" data-asset-range="' + r + '" aria-pressed="' + (a.range === r) + '">' + RANGE_LABELS[r] + '</button>';
  }).join('');
}

function firstOpTime(a) {
  var m = C.opMarkers(state.investments, a.type, a.ticker, rates(), a.quoteCur);
  return m.length ? m[0].t : null;
}

async function loadAssetHistory() {
  var a = asset; if (!a) return;
  var id = ++a.loadId;
  $('#ad-chart').innerHTML = '<p class="muted">Cargando historial…</p>';
  $('#ad-chart-note').textContent = '';
  try {
    if (a.type === 'cripto') {
      var plan = C.klinePlan(a.range, Date.now(), firstOpTime(a));
      a.interval = plan.interval;
      a.points = await Market.fetchKlines(a.ticker, plan.interval, plan);
    } else if (a.type === 'accion' || a.type === 'etf') {
      var from = (firstOpTime(a) || Date.now() - 90 * 86400000) - 7 * 86400000;
      a.interval = '1d';
      a.points = await Market.fetchStockCandles(a.ticker, state.settings.finnhubKey, from, Date.now());
    } else {
      a.points = [];
      throw new Error('No hay historial público para este tipo de activo');
    }
    if (asset !== a || id !== a.loadId) return;
    a.historyError = null;
  } catch (e) {
    if (asset !== a || id !== a.loadId) return;
    a.points = []; a.historyError = e.message;
  }
  renderAssetChart();
  renderAssetPosition();
}

/** Mueve el último punto del gráfico al precio en vivo (cada 5 s, y nunca mientras lo exploras). */
function updateLivePoint() {
  var a = asset;
  if (!a || !a.points.length || a.price == null) return;
  var last = a.points[a.points.length - 1];
  a.points[a.points.length - 1] = [Math.max(last[0], a.priceTime || Date.now()), a.price];
  if (Date.now() - a.lastChart > 5000 && !(a.chart && a.chart.isHovering())) renderAssetChart();
}

function opTipHtml(m) {
  var o = m.op, total = C.operationTotal(o);
  return '<b>' + (o.side === 'compra' ? '▲ Compra' : '▼ Venta') + ' · ' + fmtDate(o.date) + '</b>' +
    '<div class="row"><span>Cantidad</span><span>' + fmtNum(o.quantity) + ' ' + esc(o.ticker) + '</span></div>' +
    '<div class="row"><span>Precio</span><span>' + fmtPrice(o.price, o.currency) + '</span></div>' +
    (o.fee ? '<div class="row"><span>Comisión</span><span>' + fmtMoney(o.fee, o.currency) + '</span></div>' : '') +
    '<div class="row"><span>' + (o.side === 'compra' ? 'Pagaste' : 'Recibiste') + '</span><span>' + fmtMoney(total, o.currency) + '</span></div>' +
    (m.converted ? '<div class="small">Precio convertido a ' + esc(asset.quoteCur) + ' con la tasa actual</div>' : '');
}

function renderAssetChart() {
  var a = asset; if (!a) return;
  a.lastChart = Date.now();
  var all = C.opMarkers(state.investments, a.type, a.ticker, rates(), a.quoteCur);
  var pts = a.points;
  var t0 = pts.length ? pts[0][0] : 0, t1 = pts.length ? pts[pts.length - 1][0] : 0;
  var slack = 86400000; // una operación (sin hora) cae dentro del día
  var shown = all.filter(function (m) { return m.t >= t0 - slack && m.t <= t1 + slack; })
    .map(function (m) { return { t: Math.min(Math.max(m.t, t0), t1), y: m.y, kind: m.kind, html: opTipHtml(m) }; });
  var hidden = all.length - shown.length;

  var pos = C.buildPositions(state.investments.filter(function (o) { return o.assetType === a.type && o.ticker.toUpperCase() === a.ticker; }), rates()).positions[0];
  var ref = null;
  if (pos && pos.quantity > 0) {
    var avg = C.convert(pos.avgPrice, pos.currency, a.quoteCur, rates());
    if (pos.currency === a.quoteCur) avg = pos.avgPrice;
    if (isFinite(avg)) ref = { y: avg, label: 'Tu costo promedio ' + fmtPrice(avg, a.quoteCur) };
  }

  var COLORS_A = { price: 'var(--s1)', buy: 'var(--s3)', sell: 'var(--s2)' };
  $('#ad-legend').innerHTML = '<span><i class="line-key" style="background:' + COLORS_A.price + '"></i>Precio (' + esc(a.quoteCur) + ')</span>' +
    (all.some(function (m) { return m.kind === 'compra'; }) ? '<span><i class="tri up" style="--tri:' + COLORS_A.buy + '"></i>Compra</span>' : '') +
    (all.some(function (m) { return m.kind === 'venta'; }) ? '<span><i class="tri down" style="--tri:' + COLORS_A.sell + '"></i>Venta</span>' : '') +
    (ref ? '<span><i class="dash"></i>Tu costo promedio</span>' : '');

  if (!pts.length) {
    $('#ad-chart').innerHTML = '<p class="muted">' + esc(a.historyError || 'Sin historial disponible.') + '</p>';
    $('#ad-stats').innerHTML = '';
    $('#ad-chart-note').textContent = all.length ? 'Tus operaciones de ' + a.ticker + ' están en la lista de abajo.' : '';
    return;
  }
  var span = t1 - t0;
  var xFormat = function (t) {
    var d = new Date(t);
    if (span <= 2 * 86400000) return d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
    if (span <= 120 * 86400000) return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
    return d.toLocaleDateString(LOCALE, { month: 'short', year: '2-digit' });
  };
  var fine = /m$|h$/.test(a.interval || '');
  a.chart = Charts.price($('#ad-chart'), {
    points: pts, markers: shown, ref: ref, color: COLORS_A.price, buyColor: COLORS_A.buy, sellColor: COLORS_A.sell,
    xFormat: xFormat, yFormat: function (v) { return fmtCompactPrice(v); },
    ariaLabel: 'Precio histórico de ' + a.ticker + ' con tus operaciones',
    tooltip: function (i) {
      var d = new Date(pts[i][0]);
      return '<b>' + (fine ? d.toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })) +
        '</b><div class="row"><span>Precio</span><span>' + fmtPrice(pts[i][1], a.quoteCur) + '</span></div>';
    }
  });
  $('#ad-chart-note').textContent = hidden > 0 ? hidden + ' operación(es) fuera de este rango: elige «Mis operaciones» para verlas todas.' : '';

  var vals = pts.map(function (p) { return p[1]; });
  var chg = C.round((vals[vals.length - 1] / vals[0] - 1) * 100, 2);
  $('#ad-stats').innerHTML = stat('Cambio en el rango', '<span class="' + trend(chg) + '">' + fmtPct(chg) + '</span>') +
    stat('Máximo', fmtPrice(Math.max.apply(null, vals), a.quoteCur)) + stat('Mínimo', fmtPrice(Math.min.apply(null, vals), a.quoteCur)) +
    (a.volume ? stat('Volumen 24 h', fmtMoney(a.volume, a.quoteCur)) : '');
}

function fmtCompactPrice(v) {
  var a = Math.abs(v);
  if (a >= 1e6) return fmtNum(v / 1e6, 0, 2) + ' M';
  if (a >= 1e4) return fmtNum(v / 1e3, 0, 1) + ' k';
  return fmtNum(v, 0, a >= 100 ? 0 : a >= 1 ? 2 : 6);
}

function renderAssetPosition() {
  var a = asset; if (!a) return;
  var b = base();
  var ops = state.investments.filter(function (o) { return o.assetType === a.type && o.ticker.toUpperCase() === a.ticker; })
    .sort(function (x, y) { return x.date < y.date ? 1 : x.date > y.date ? -1 : (y.createdAt || 0) - (x.createdAt || 0); });
  var actions = '<div class="btn-row" style="margin-top:12px"><button type="button" class="primary" data-asset-op="compra">Registrar compra</button>' +
    (ops.length ? '<button type="button" data-asset-op="venta">Registrar venta</button>' : '') + '</div>';
  if (!ops.length) {
    $('#ad-position').innerHTML = '<h2>Mi posición</h2><p class="muted" style="margin:0">Todavía no has operado ' + esc(a.ticker) + '.</p>' + actions;
    return;
  }
  var pos = C.buildPositions(ops, rates()).positions[0];
  var valueBase = a.price != null ? C.toBase(C.round(pos.quantity * a.price, 2), a.quoteCur, rates()) : NaN;
  var pnl = isFinite(valueBase) ? C.round(valueBase - pos.costBase, 2) : NaN;
  var pnlPct = isFinite(pnl) && pos.costBase > 0 ? C.round(pnl / pos.costBase * 100, 2) : NaN;
  $('#ad-position').innerHTML = '<h2>Mi posición</h2>' +
    '<div class="stat-row">' +
    stat('Cantidad', fmtNum(pos.quantity) + ' ' + esc(a.ticker)) +
    stat('Costo promedio', pos.quantity > 0 ? fmtPrice(pos.avgPrice, pos.currency) : '—') +
    stat('Valor actual', pos.quantity > 0 && isFinite(valueBase) ? fmtMoney(valueBase, b) : '—') +
    (pos.quantity > 0 && isFinite(pnl) ? stat('Ganancia / pérdida', '<span class="' + trend(pnl) + '">' + fmtSigned(pnl, b) + ' (' + fmtPct(pnlPct) + ')</span>') : '') +
    (pos.realized ? stat('Realizada', '<span class="' + trend(pos.realizedBase) + '">' + fmtSigned(pos.realizedBase, b) + '</span>') : '') +
    '</div>' +
    '<h3>Mis operaciones <span class="muted small" style="text-transform:none;letter-spacing:0">· toca una para editarla</span></h3><ul class="list">' + ops.map(function (o) {
      var buy = o.side === 'compra', total = C.operationTotal(o);
      return '<li class="clickable" data-edit-inv="' + o.id + '" tabindex="0" role="button"><span class="avatar ' + (buy ? 'out' : 'in') + '">' + icon(buy ? 'i-out' : 'i-in') + '</span>' +
        '<div class="main"><div class="title">' + (buy ? '▲ Compra' : '▼ Venta') + '</div><div class="sub">' + fmtDate(o.date) + ' · ' + fmtNum(o.quantity) + ' × ' + fmtPrice(o.price, o.currency) + '</div></div>' +
        '<div class="amt">' + (buy ? '−' : '+') + fmtMoney(total, o.currency) + '</div></li>';
    }).join('') + '</ul>' + actions;
}

/** Ir a registrar una operación con el activo ya elegido (y el precio en vivo si la moneda coincide). */
function prefillOperation(side) {
  var a = asset; if (!a) return;
  var price = a.price, quote = a.quoteCur, type = a.type, ticker = a.ticker;
  showView('inversiones');
  resetInvForm();
  var f = $('#inv-form');
  $('#inv-details').open = true;
  f.side.value = side; f.assetType.value = type; f.ticker.value = ticker;
  if (price != null && f.currency.value === quote) f.price.value = C.round(price, 8);
  renderInvAccountSelect(); updateInvPreview();
  $('#inv-details').scrollIntoView({ behavior: 'smooth', block: 'start' });
  f.quantity.focus({ preventScroll: true });
}

// ---------- Buscador ----------
var cryptoList = null, searchSel = -1, stockTimer = null, lastQuery = '';

function hideSearch() {
  var r = $('#search-results');
  if (!r) return;
  r.classList.add('hidden');
  $('#asset-search').setAttribute('aria-expanded', 'false');
  searchSel = -1;
}

function searchItem(it) {
  return '<li role="option" data-open-asset="' + esc(it.type + '|' + it.ticker) + '">' + logoHtml(it.type, it.ticker, 'mini-logo') +
    '<div class="r-main"><div class="r-t">' + esc(it.ticker) + '</div><div class="r-s">' + esc(it.sub) + '</div></div>' +
    (it.price != null ? '<span class="r-p">' + fmtPrice(it.price, 'USD') + '</span>' : '') + '</li>';
}

async function runSearch() {
  var input = $('#asset-search'), q = input.value.trim().toUpperCase();
  lastQuery = q;
  var loading = false;
  if (!cryptoList || cryptoList.loading) {
    loading = true;
    if (!cryptoList) {
      cryptoList = []; cryptoList.loading = true;
      Market.listCryptoSymbols().then(function (l) {
        cryptoList = l;
        // Volver a buscar con lo que haya escrito ahora, si el buscador sigue abierto
        if (!$('#search-results').classList.contains('hidden')) runSearch();
      });
    }
  }
  var held = {};
  state.investments.forEach(function (o) { held[o.assetType + '|' + o.ticker.toUpperCase()] = { type: o.assetType, ticker: o.ticker.toUpperCase() }; });
  var mine = Object.keys(held).map(function (k) { return held[k]; }).filter(function (h) { return !q || h.ticker.indexOf(q) !== -1; })
    .map(function (h) { var m = meta(h.type, h.ticker); return { type: h.type, ticker: h.ticker, sub: (m && m.name && m.name !== h.ticker ? m.name + ' · ' : '') + ASSET_LABELS[h.type] + ' · en tu cartera' }; });
  var byTicker = {}; (cryptoList || []).forEach(function (c) { byTicker[c.ticker] = c; });
  var cryptos;
  if (!q) cryptos = POPULAR.filter(function (t) { return byTicker[t] || !cryptoList.length; }).map(function (t) { return byTicker[t] || { ticker: t }; });
  else {
    // Coincidencia exacta primero; luego las que empiezan igual y las que lo contienen, por volumen negociado
    var byVol = function (a, b) { return (b.volume || 0) - (a.volume || 0); };
    var exact = cryptoList.filter(function (c) { return c.ticker === q; });
    var starts = cryptoList.filter(function (c) { return c.ticker !== q && c.ticker.indexOf(q) === 0; }).sort(byVol);
    var has = cryptoList.filter(function (c) { return c.ticker.indexOf(q) > 0; }).sort(byVol);
    cryptos = exact.concat(starts, has).slice(0, 8);
  }
  cryptos = cryptos.filter(function (c) { return !held['cripto|' + c.ticker]; }).map(function (c) {
    var m = meta('cripto', c.ticker);
    return { type: 'cripto', ticker: c.ticker, sub: (m && m.name && m.name !== c.ticker ? m.name + ' · ' : '') + 'Cripto · Binance', price: c.price };
  });
  var html = '';
  if (mine.length) html += '<li class="grp" role="presentation">En tu cartera</li>' + mine.map(searchItem).join('');
  if (cryptos.length) html += '<li class="grp" role="presentation">' + (q ? 'Cripto' : 'Cripto populares') + '</li>' + cryptos.map(searchItem).join('');
  html += '<li class="grp hidden" role="presentation" id="stock-grp">Acciones y ETF (Finnhub)</li>';
  if (loading) html = '<li class="grp" role="presentation">Cargando lista de Binance…</li>' + html;
  else if (!html.replace(/<li class="grp hidden"[^]*$/, '')) html = '<li class="grp" role="presentation">Sin resultados para «' + esc(q) + '»</li>' + html;
  var list = $('#search-results');
  list.innerHTML = html;
  list.classList.remove('hidden');
  input.setAttribute('aria-expanded', 'true');
  searchSel = -1;

  // Acciones y ETF (si hay API key), con espera para no saturar
  clearTimeout(stockTimer);
  if (q && state.settings.finnhubKey) {
    stockTimer = setTimeout(async function () {
      var res = await Market.searchStocks(q, state.settings.finnhubKey);
      if (lastQuery !== q || !res.length) return;
      var g = $('#stock-grp'); if (!g) return;
      g.classList.remove('hidden');
      g.insertAdjacentHTML('afterend', res.filter(function (r) { return !held[r.assetType + '|' + r.ticker]; })
        .map(function (r) { return searchItem({ type: r.assetType, ticker: r.ticker, sub: r.name + ' · ' + ASSET_LABELS[r.assetType] }); }).join(''));
    }, 400);
  }
}

function moveSearchSel(delta) {
  var items = $$('#search-results li[data-open-asset]');
  if (!items.length) return;
  searchSel = (searchSel + delta + items.length) % items.length;
  items.forEach(function (li, i) { li.setAttribute('aria-selected', i === searchSel ? 'true' : 'false'); });
  items[searchSel].scrollIntoView({ block: 'nearest' });
}

function openFromSearch() {
  var items = $$('#search-results li[data-open-asset]');
  var q = $('#asset-search').value.trim().toUpperCase();
  var pick = items[searchSel] || items[0];
  if (pick) { var p = pick.dataset.openAsset.split('|'); $('#asset-search').value = ''; openAsset(p[0], p[1]); }
  else if (q) { $('#asset-search').value = ''; openAsset('cripto', q); }
}
