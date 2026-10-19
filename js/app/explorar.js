/* =========================================================================
 * app/explorar.js — Explorar activos, sugeridos y datos/noticias de la ficha de activo.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ explorar activos y sugeridos
var explore = { tab: 'cripto', cryptos: null, risks: {}, loading: false, error: null, etfQuotes: {}, at: 0 };
var RISK_TEXT = {
  1: 'Se mueve muy poco: pensado para dinero que no quieres arriesgar.',
  2: 'Movimientos pequeños; en momentos malos puede caer algo, pero poco.',
  3: 'Sube y baja con los mercados: en una crisis puede caer un 20–35 %.',
  4: 'Movimientos fuertes: caídas del 30–50 % son posibles.',
  5: 'Muy volátil: puede perder más de la mitad de su valor en pocos meses.'
};
function riskBadge(level, ref) {
  if (!level) return '<span class="risk">Riesgo —</span>';
  return '<span class="risk r' + level + '" title="Riesgo ' + esc(Insights.RISK_LABELS[level].toLowerCase()) + (ref ? ' (referencia histórica)' : '') + '">Riesgo ' +
    esc(Insights.RISK_LABELS[level].toLowerCase()) + '</span>';
}
function etfInfo(t) { return Insights.ETF_CATALOG.filter(function (x) { return x.ticker === t; })[0] || null; }
function assetRisk(type, ticker) {
  if (type === 'cripto') { var r = explore.risks[ticker]; return r ? { level: r.level, stats: r } : null; }
  var e = etfInfo(ticker); return e ? { level: e.risk, ref: true } : null;
}
function profileType() { return state.profile ? state.profile.type : null; }

function renderIdeas(pf) {
  var type = profileType();
  $('#ideas-profile').textContent = type ? 'Perfil ' + Advisor.PROFILES[type].label.toLowerCase() : '';
  var list = Insights.ideas(pf, type);
  var html = list.map(function (i) {
    return '<div class="idea"><div class="t">' + esc(i.title) + '</div><div class="w">' + esc(i.why) + '</div><div class="idea-chips">' +
      i.items.map(function (it) {
        var rk = assetRisk(it.assetType, it.ticker);
        return '<span class="idea-chip" role="button" tabindex="0" data-open-asset="' + esc(it.assetType + '|' + it.ticker) + '">' +
          (it.assetType === 'cripto' ? logoHtml(it.assetType, it.ticker, 'mini-logo') : '') + esc(it.ticker) + (rk ? ' ' + riskBadge(rk.level, rk.ref) : '') + '</span>';
      }).join('') + '</div></div>';
  }).join('');
  if (!type) html += '<p class="hint" style="margin:8px 0 0">Haz el test de perfil (Consejos) para ajustar las sugerencias a cuánto riesgo toleras.</p>';
  $('#ideas-body').innerHTML = html || '<p class="muted small" style="margin:0">Tu portafolio ya está diversificado según estas reglas. Explora más abajo si quieres investigar otros activos.</p>';
}

function renderExplore() {
  var list = $('#explore-list'); if (!list) return;
  var type = profileType(), max = type ? Insights.PROFILE_MAX_RISK[type] : null;
  $('#ex-fit-wrap').classList.toggle('hidden', !type);
  if (type) $('#ex-fit-label').textContent = 'Solo los que encajan con mi perfil ' + Advisor.PROFILES[type].label.toLowerCase() + ' (riesgo hasta «' + Insights.RISK_LABELS[max].toLowerCase() + '»)';
  var onlyFit = type && $('#ex-fit').checked;
  var fit = function (lvl) { return lvl ? lvl <= max : null; };
  var fitTag = function (lvl) { return type && lvl ? '<span class="fit-tag">' + (fit(lvl) ? '✓ Encaja con tu perfil' : 'Más riesgo que tu perfil') + '</span>' : ''; };
  var key = state.settings.finnhubKey;
  if (explore.tab === 'cripto') {
    if (!explore.cryptos) {
      list.innerHTML = '<li class="empty">' + (explore.error ? 'No se pudo cargar la lista (' + esc(explore.error) + '). <button type="button" class="link" data-action="explore-retry">Reintentar</button>' : 'Cargando las criptos principales…') + '</li>';
      $('#explore-note').textContent = '';
      return;
    }
    var rows = explore.cryptos.filter(function (c) { var r = explore.risks[c.ticker]; return !onlyFit || !r || fit(r.level); });
    list.innerHTML = rows.map(function (c) {
      var r = explore.risks[c.ticker], q = state.prices[C.priceKey('cripto', c.ticker)];
      var price = q && q.price != null && !q.error ? q.price : c.price, ch = q && q.change24h != null && !q.error ? q.change24h : c.change24h;
      return '<li data-open-asset="cripto|' + esc(c.ticker) + '" tabindex="0" role="button" aria-label="Ver ' + esc(c.name) + '">' +
        '<span class="mini-logo">' + (c.logo ? '<img src="' + esc(c.logo) + '" alt="" loading="lazy">' : esc(c.ticker.slice(0, 4))) + '</span>' +
        '<div class="main"><div class="title">' + esc(c.name) + '</div><div class="sub">' + esc(c.ticker) + (c.rank ? ' · #' + c.rank + ' por capitalización' : '') + '</div>' +
        '<div style="margin-top:4px">' + (r ? riskBadge(r.level) + ' ' + fitTag(r.level) : '<span class="risk">Calculando riesgo…</span>') + '</div></div>' +
        '<div class="ex-right"><span class="ex-price">' + (price != null ? fmtPrice(price, 'USD') : '—') + '</span>' +
        (ch != null ? '<span class="small ' + trend(ch) + '">' + fmtPct(C.round(ch, 2)) + ' 24 h</span>' : '') + '</div></li>';
    }).join('') || '<li class="empty">Ninguna cripto de la lista encaja con tu perfil.</li>';
    $('#explore-note').textContent = 'Las ' + explore.cryptos.length + ' criptos de mayor capitalización (sin estables) que puedes seguir en Binance. Riesgo calculado con 1 año de cierres diarios. Toca una para ver su historial, datos y noticias.';
  } else {
    var etfs = Insights.ETF_CATALOG.filter(function (e) { return !onlyFit || fit(e.risk); });
    list.innerHTML = etfs.map(function (e) {
      var q = explore.etfQuotes[e.ticker] || state.prices[C.priceKey('etf', e.ticker)];
      return '<li data-open-asset="etf|' + esc(e.ticker) + '" tabindex="0" role="button" aria-label="Ver ' + esc(e.name) + '">' +
        '<span class="mini-logo">' + esc(e.ticker) + '</span>' +
        '<div class="main"><div class="title">' + esc(e.ticker) + ' · ' + esc(e.group) + '</div><div class="sub">' + esc(e.name) + '</div>' +
        '<div class="small muted" style="margin-top:2px">' + esc(e.about) + '</div>' +
        '<div style="margin-top:4px">' + riskBadge(e.risk, true) + ' ' + fitTag(e.risk) + '</div></div>' +
        '<div class="ex-right"><span class="ex-price">' + (q && q.price != null && !q.error ? fmtPrice(q.price, 'USD') : '') + '</span>' +
        (q && q.change24h != null && !q.error ? '<span class="small ' + trend(q.change24h) + '">' + fmtPct(C.round(q.change24h, 2)) + ' 24 h</span>' : '') + '</div></li>';
    }).join('') || '<li class="empty">Ninguno de la lista encaja con tu perfil.</li>';
    $('#explore-note').textContent = 'Fondos muy conocidos de distintos tipos, como punto de partida para investigar. El riesgo es el típico de su historia (referencia).' +
      (key ? '' : ' Para ver precios, datos y noticias de ETF y acciones añade tu API key gratuita de Finnhub en Ajustes.');
  }
}

/** Carga la lista de criptos y su riesgo (poco a poco) y los precios de los ETF. */
async function loadExplore(force) {
  if (explore.loading || (!force && explore.cryptos && Date.now() - explore.at < 30 * 60000)) return;
  explore.loading = true; explore.error = null;
  try {
    explore.cryptos = await Market.fetchTopCryptos(12);
    explore.at = Date.now();
  } catch (e) { explore.error = e.message; }
  renderExplore();
  var key = state.settings.finnhubKey;
  if (key) Prices.fetchStocks(Insights.ETF_CATALOG.map(function (e) { return e.ticker; }), key).then(function (q) { explore.etfQuotes = q || {}; renderExplore(); }).catch(function () {});
  var queue = (explore.cryptos || []).map(function (c) { return c.ticker; });
  ['BTC', 'ETH'].forEach(function (t) { if (queue.indexOf(t) === -1) queue.push(t); });
  var worker = async function () {
    while (queue.length) {
      var t = queue.shift();
      try { var st = await Market.fetchRisk(t); if (st) explore.risks[t] = st; } catch (e) { /* sin riesgo para ese activo */ }
      renderExplore();
      renderIdeas(C.valuePortfolio(C.buildPositions(state.investments, rates()).positions, state.prices, rates()));
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  explore.loading = false;
}

// ---- Ficha de activo: riesgo, datos clave y noticias
async function loadAssetInsights() {
  var a = asset; if (!a) return;
  ['#ad-risk', '#ad-info', '#ad-news'].forEach(function (s) { $(s).classList.add('hidden'); $(s).innerHTML = ''; });
  var market = a.type === 'cripto' || a.type === 'etf' || a.type === 'accion';
  if (!market) return;
  var key = state.settings.finnhubKey;
  // Riesgo
  if (a.type === 'cripto') {
    renderAssetRisk(a, null, true);
    Market.fetchRisk(a.ticker).then(function (st) { if (st) explore.risks[a.ticker] = st; renderAssetRisk(a, st, false); })
      .catch(function () { renderAssetRisk(a, null, false); });
  } else renderAssetRisk(a, null, false);
  // Datos clave
  if (a.type === 'cripto') {
    $('#ad-info').classList.remove('hidden'); $('#ad-info').innerHTML = '<h2>Datos clave</h2><p class="muted small">Cargando…</p>';
    Market.fetchCoinInfo(a.ticker).then(function (inf) { renderAssetInfo(a, inf); })
      .catch(function (e) { if (asset === a) $('#ad-info').innerHTML = '<h2>Datos clave</h2><p class="muted small">No disponibles ahora (' + esc(e.message) + ').</p>'; });
  } else if (key) {
    $('#ad-info').classList.remove('hidden'); $('#ad-info').innerHTML = '<h2>Datos clave</h2><p class="muted small">Cargando…</p>';
    Market.fetchStockInfo(a.ticker, key).then(function (inf) { renderAssetInfo(a, inf); if (a.type === 'accion' && inf.beta != null) renderAssetRisk(a, null, false, inf); })
      .catch(function (e) { if (asset === a) $('#ad-info').innerHTML = '<h2>Datos clave</h2><p class="muted small">No disponibles ahora (' + esc(e.message) + ').</p>'; });
  }
  // Noticias
  var m = meta(a.type, a.ticker) || {};
  var listed = (explore.cryptos || []).filter(function (c) { return c.ticker === a.ticker; })[0] || etfInfo(a.ticker);
  var name = m.name && m.name.toUpperCase() !== a.ticker ? m.name : listed ? listed.name : a.ticker;
  var more = '<p style="margin:10px 0 0"><a href="' + esc(Market.newsSearchUrl(name + (a.type === 'cripto' ? ' cripto' : ''))) + '" target="_blank" rel="noopener noreferrer">Ver más noticias de ' + esc(name) + ' en Google Noticias ↗</a></p>';
  $('#ad-news').classList.remove('hidden');
  if (!key) { $('#ad-news').innerHTML = '<h2>Noticias</h2><p class="muted small">Para ver aquí las noticias recientes añade tu API key gratuita de Finnhub en Ajustes.</p>' + more; return; }
  $('#ad-news').innerHTML = '<h2>Noticias</h2><p class="muted small">Cargando…</p>';
  Market.fetchNews(a.type, a.ticker, name, key).then(function (n) {
    if (asset !== a) return;
    $('#ad-news').innerHTML = '<h2>Noticias</h2>' + (n.general && n.items.length ? '<p class="hint" style="margin-top:0">No hay noticias recientes que mencionen ' + esc(a.ticker) + ': estas son las últimas del mercado cripto.</p>' : '') +
      (n.items.length ? '<ul class="news-list">' + n.items.map(function (it) {
        return '<li><a href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">' + esc(it.headline) + '</a>' +
          '<div class="sub">' + esc(it.source) + (it.datetime ? ' · ' + fmtTime(it.datetime) : '') + '</div></li>';
      }).join('') + '</ul>' : '<p class="muted small">Sin noticias en los últimos 30 días.</p>') + more;
  }).catch(function (e) { if (asset === a) $('#ad-news').innerHTML = '<h2>Noticias</h2><p class="muted small">No se pudieron cargar (' + esc(e.message) + ').</p>' + more; });
}

function renderAssetRisk(a, st, loading, stockInfo) {
  if (asset !== a) return;
  var box = $('#ad-risk'), type = profileType();
  var lvl = st ? st.level : null, ref = false;
  if (!st && a.type !== 'cripto') { var e = etfInfo(a.ticker); if (e) { lvl = e.risk; ref = true; } }
  if (!lvl && stockInfo && stockInfo.beta != null) { lvl = stockInfo.beta < 0.8 ? 3 : stockInfo.beta <= 1.3 ? 4 : 5; ref = true; }
  if (!lvl && !loading) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  if (loading) { box.innerHTML = '<h2>Riesgo</h2><p class="muted small">Calculando con el historial de 1 año…</p>'; return; }
  var max = type ? Insights.PROFILE_MAX_RISK[type] : null;
  box.innerHTML = '<div class="risk-head"><h2 style="margin:0">Riesgo</h2>' + riskBadge(lvl, ref) + '</div>' +
    '<p class="rec-why" style="margin:8px 0 0">' + esc(RISK_TEXT[lvl]) + '</p>' +
    (st ? '<div class="kv-grid">' +
      '<div><span>Volatilidad anual</span><b>' + fmtNum(st.volatility, 0, 1) + ' %</b></div>' +
      '<div><span>Peor caída (12 meses)</span><b class="' + trend(st.maxDrawdown) + '">' + fmtPct(st.maxDrawdown) + '</b></div>' +
      '<div><span>Rendimiento 12 meses</span><b class="' + trend(st.return) + '">' + fmtPct(st.return) + '</b></div>' +
      '<div><span>Datos</span><b>' + st.points + ' cierres diarios</b></div></div>' : '') +
    (ref ? '<p class="hint" style="margin:8px 0 0">' + (stockInfo && stockInfo.beta != null && !etfInfo(a.ticker) ? 'Estimado con la beta (' + fmtNum(stockInfo.beta, 0, 2) + '): cuánto se mueve frente al mercado.' : 'Nivel de referencia según su comportamiento histórico típico.') + '</p>' : '') +
    (type ? '<p class="small" style="margin:8px 0 0">' + (lvl <= max ? '✓ Encaja con tu perfil ' + esc(Advisor.PROFILES[type].label.toLowerCase()) :
      'Supera el riesgo sugerido para tu perfil ' + esc(Advisor.PROFILES[type].label.toLowerCase()) + ' (hasta «' + esc(Insights.RISK_LABELS[max].toLowerCase()) + '»): si lo tienes, que pese poco en tu portafolio') + '.</p>' : '') +
    '<p class="hint" style="margin:8px 0 0">El riesgo pasado no garantiza el futuro. No es una recomendación.</p>';
}

function renderAssetInfo(a, inf) {
  if (asset !== a || !inf) return;
  var usd = function (v) { return v == null ? '—' : fmtMoney(v, 'USD'); };
  // Cifras grandes legibles: 308,1 mil M (miles de millones), 9,8 M, 950 k
  var big = function (v) { return v == null ? '—' : privacy ? 'USD ' + MASK : 'USD ' + (Math.abs(v) >= 1e9 ? fmtNum(v / 1e9, 0, 1) + ' mil M' : fmtCompact(v)); };
  var n = function (v) { return v == null ? '—' : Math.abs(v) >= 1e9 ? fmtNum(v / 1e9, 0, 2) + ' mil M' : Math.abs(v) >= 1e6 ? fmtNum(v / 1e6, 0, 1) + ' M' : fmtNum(v, 0, 0); };
  var pc = function (v) { return v == null ? '—' : '<span class="' + trend(v) + '">' + fmtPct(v) + '</span>'; };
  var items = [];
  if (a.type === 'cripto') {
    items = [['Puesto por capitalización', inf.rank ? '#' + inf.rank : '—'], ['Capitalización', big(inf.marketCap)], ['Volumen 24 h', big(inf.volume24h)],
      ['Máximo histórico', usd(inf.ath) + (inf.athDate ? ' <span class="muted small">(' + fmtDate(inf.athDate) + ')</span>' : '')],
      ['Distancia al máximo', pc(inf.athChange)],
      ['En circulación', n(inf.circulating) + (inf.maxSupply ? ' de ' + n(inf.maxSupply) + ' máx.' : ' (sin máximo)')],
      ['Cambio 7 días', pc(inf.change7d)], ['Cambio 30 días', pc(inf.change30d)], ['Cambio 1 año', pc(inf.change1y)]];
  } else {
    items = [['Sector', esc(inf.industry || '—')], ['País', esc(inf.country || '—')], ['Capitalización', big(inf.marketCap)],
      ['Máximo 52 semanas', usd(inf.high52)], ['Mínimo 52 semanas', usd(inf.low52)],
      ['Rendimiento 52 semanas', pc(inf.ret52)],
      ['Beta (vs. mercado)', inf.beta == null ? '—' : fmtNum(inf.beta, 0, 2)], ['PER', inf.pe == null ? '—' : fmtNum(inf.pe, 0, 1)],
      ['Rentabilidad por dividendo', inf.dividendYield == null ? '—' : fmtNum(inf.dividendYield, 0, 2) + ' %']];
  }
  var e = a.type === 'etf' ? etfInfo(a.ticker) : null;
  $('#ad-info').classList.remove('hidden');
  $('#ad-info').innerHTML = '<h2>Datos clave</h2>' +
    (inf.description ? '<p class="rec-why" style="margin:4px 0 0">' + esc(inf.description) + '</p>' : e ? '<p class="rec-why" style="margin:4px 0 0">' + esc(e.about) + '</p>' : '') +
    (inf.categories && inf.categories.length ? '<p class="small muted" style="margin:6px 0 0">' + inf.categories.map(esc).join(' · ') + '</p>' : '') +
    '<div class="kv-grid">' + items.map(function (x) { return '<div><span>' + x[0] + '</span><b>' + x[1] + '</b></div>'; }).join('') + '</div>' +
    '<p class="hint" style="margin:8px 0 0">Fuente: ' + esc(inf.source) + (inf.homepage ? ' · <a href="' + esc(inf.homepage) + '" target="_blank" rel="noopener noreferrer">web oficial ↗</a>' : '') + '</p>';
}

/** Foto diaria del patrimonio (valor de mercado) para la serie histórica. */
function recordSnapshot() {
  if (!state.accounts.length && !state.investments.length) return;
  var nw = C.netWorth(state, S.today());
  state.snapshots[S.today()] = { cash: nw.cash, invested: nw.invested, terceros: C.round(nw.receivable - nw.payable, 2), total: nw.total, at: Date.now() };
}
/** Un cambio con fecha pasada invalida los registros diarios desde esa fecha. */
function invalidateSnapshots(fromDate) {
  if (!fromDate) return;
  Object.keys(state.snapshots).forEach(function (d) { if (d >= fromDate && d !== S.today()) delete state.snapshots[d]; });
}
