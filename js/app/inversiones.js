/* =========================================================================
 * app/inversiones.js — Portafolio, operaciones y precios en vivo.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ inversiones
function renderPortfolio() {
  var b = base();
  var res = C.buildPositions(state.investments, rates());
  var pf = C.valuePortfolio(res.positions, state.prices, rates());
  renderIdeas(pf);
  renderExplore();

  $('#pf-value').textContent = fmtMoney(pf.value, b);
  $('#pf-stats').innerHTML = pf.rows.length ?
    stat('Invertido', fmtMoney(pf.cost, b)) +
    stat('Ganancia / pérdida', '<span class="' + trend(pf.pnl) + '">' + fmtSigned(pf.pnl, b) + ' (' + fmtPct(pf.pnlPct) + ')</span>') +
    stat('Cambio 24 h', '<span class="' + trend(pf.dayChange) + '">' + fmtSigned(pf.dayChange, b) + '</span>') +
    stat('Realizada', '<span class="' + trend(pf.realized) + '">' + fmtSigned(pf.realized, b) + '</span>')
    : '<span class="muted">Registra tu primera compra para ver tu portafolio.</span>';

  // --- Distribución por tipo (barra 100 %) ---
  $('#dist-card').classList.toggle('hidden', !pf.rows.length);
  $('#dist-type').innerHTML = pf.byType.length ?
    '<div class="stack" role="img" aria-label="Distribución por tipo de activo">' + pf.byType.map(function (t) {
      return '<span style="width:' + t.weight + '%;background:' + ASSET_COLORS[t.assetType] + '" data-tip="' +
        esc(ASSET_LABELS[t.assetType] + ': ' + fmtMoney(t.value, b) + ' (' + fmtNum(t.weight, 1, 1) + ' %)') + '"></span>';
    }).join('') + '</div>' +
    '<div class="legend">' + pf.byType.map(function (t) {
      return '<span><i style="background:' + ASSET_COLORS[t.assetType] + '"></i>' + ASSET_LABELS[t.assetType] + '<b>' + fmtNum(t.weight, 1, 1) + ' %</b></span>';
    }).join('') + '</div>' : '';

  // --- Por activo (barras de un solo color; más de 8 → «Otros») ---
  var rows = pf.rows.slice(0, 8).map(function (r) { return { label: r.position.ticker, weight: r.weight, value: r.valueBase }; });
  if (pf.rows.length > 8) {
    var rest = pf.rows.slice(8);
    rows.push({ label: 'Otros', weight: C.sum(rest.map(function (r) { return r.weight; })), value: C.sum(rest.map(function (r) { return r.valueBase; })) });
  }
  var maxW = Math.max.apply(null, rows.map(function (r) { return r.weight; }).concat([1]));
  $('#dist-asset').innerHTML = rows.map(function (r) {
    return '<div class="hbar" data-tip="' + esc(r.label + ': ' + fmtMoney(r.value, b)) + '"><span class="lbl">' + esc(r.label) + '</span>' +
      '<span class="track"><span class="fill" style="width:' + (r.weight / maxW * 100) + '%;display:block"></span></span>' +
      '<span class="pct">' + fmtNum(r.weight, 1, 1) + ' %</span></div>';
  }).join('');

  // --- Lista de activos ---
  var lastOk = 0;
  $('#pf-list').innerHTML = pf.rows.length ? pf.rows.map(function (r) {
    var p = r.position, q = r.quote;
    if (q && !q.error && q.time > lastOk) lastOk = q.lastAttempt || q.time;
    var priceLine;
    if (r.hasPrice) {
      var manual = q.source === 'manual';
      var stale = q.error && !manual;
      priceLine = fmtPrice(q.price, q.currency) + ' · ' + esc(manual ? 'Precio manual' : q.source) + ' · ' + fmtTime(manual ? q.time : (q.lastAttempt && !q.error ? q.lastAttempt : q.time)) +
        (q.change24h != null && !manual ? ' · <span class="' + trend(q.change24h) + '">' + fmtPct(q.change24h) + ' 24 h</span>' : '') +
        (stale ? ' <span class="stale" data-tip="' + esc(q.error) + '">Último precio conocido</span>' : '');
    } else {
      priceLine = '<span class="stale"' + (q && q.error ? ' data-tip="' + esc(q.error) + '"' : '') + '>Sin precio · valorado a costo</span>';
    }
    return '<li class="clickable" data-open-asset="' + esc(p.assetType + '|' + p.ticker) + '" tabindex="0" role="button" aria-label="Ver ficha de ' + esc(p.ticker) + '">' +
      assetBadge(p) +
      '<div class="main">' +
      '<div class="asset-row"><span class="title">' + esc(p.ticker) + ' <span class="tag">' + ASSET_LABELS[p.assetType] + '</span></span>' +
      '<span class="val">' + fmtMoney(r.valueBase, b) + '</span></div>' +
      '<div class="asset-row"><span class="sub">' + posQtyText(p) + ' · costo prom. ' + posAvgText(p) + '</span>' +
      (r.hasPrice ? '<span class="pnl ' + trend(r.pnlBase) + '">' + fmtSigned(r.pnlBase, b) + ' · ' + fmtPct(r.pnlPct) + '</span>'
                  : '<span class="pnl muted">costo ' + fmtMoney(p.costBase, b) + '</span>') + '</div>' +
      '<div class="price-line">' + priceLine + '</div></div>' +
      '<div class="row-actions"><button class="mini" data-manual-price="' + esc(p.priceKey) + '" data-cur="' + esc(p.currency) + '" aria-label="Precio manual" title="Ingresar precio manual">' + icon('i-edit') + '</button></div>' +
      '</li>';
  }).join('') : '<li class="empty">Sin posiciones abiertas.</li>';
  $('#pf-updated').textContent = lastOk ? 'Actualizado ' + fmtTime(lastOk) : '';

  renderInvList();
}

function stat(k, v) { return '<div class="stat"><span>' + k + '</span><span>' + v + '</span></div>'; }

function renderInvList() {
  var b = base();
  var ops = state.investments.slice().sort(function (a, c) {
    return a.date < c.date ? 1 : a.date > c.date ? -1 : (c.createdAt || 0) - (a.createdAt || 0);
  });
  $('#inv-list').innerHTML = ops.length ? ops.map(function (o) {
    var total = C.operationTotal(o);
    var buy = o.side === 'compra';
    var editing = $('#inv-form').editId.value === o.id;
    return '<li class="clickable' + (editing ? ' editing' : '') + '" data-edit-inv="' + o.id + '" tabindex="0" role="button" aria-label="Editar operación">' +
      '<span class="avatar ' + (buy ? 'out' : 'in') + '">' + icon(buy ? 'i-out' : 'i-in') + '</span>' +
      '<div class="main"><div class="title">' + (buy ? 'Compra ' : 'Venta ') + esc(o.ticker) + '</div>' +
      '<div class="sub">' + fmtDate(o.date) + ' · ' + opQtyText(o) + ' × ' + opPriceText(o) +
      (o.fee ? ' + com. ' + fmtMoney(o.fee, o.currency) : '') + (o.accountId ? ' · ' + esc(accName(o.accountId)) : '') +
      (o.note ? ' · ' + esc(o.note) : '') + '</div></div>' +
      '<div class="amt">' + (buy ? '−' : '+') + fmtMoney(total, o.currency) +
      (o.currency !== b ? '<div class="sub">≈ ' + fmtMoney(C.toBase(total, o.currency, rates()), b) + '</div>' : '') + '</div></li>';
  }).join('') : '<li class="empty">Aún no hay operaciones.</li>';
}

// ---------- Unidades de las materias primas (gramos, onzas, kilos, litros…) ----------
var UNIT_LABELS = { g: 'Gramos (g)', oz: 'Onzas troy (oz · 31,1 g)', kg: 'Kilos (kg)', lb: 'Libras (lb)', t: 'Toneladas (t)',
  bbl: 'Barriles (bbl · 159 L)', L: 'Litros (L)', gal: 'Galones EE. UU. (gal)', MMBtu: 'MMBtu' };
function unitShort(u) { return C.UNITS[u] ? C.UNITS[u].short : (u || ''); }
function unitOne(u) { return C.UNITS[u] ? C.UNITS[u].one : (u || ''); }
/** Cantidad de una operación con su unidad: «3,5 g» (materias primas) o «0,5 BTC». */
function opQtyText(o) {
  var qu = C.quoteUnit(o.assetType, o.ticker);
  return fmtNum(o.quantity) + ' ' + (qu ? unitShort(o.unit || qu) : o.ticker);
}
/** Precio de una operación por su unidad: «USD 120,00/g». */
function opPriceText(o) {
  var qu = C.quoteUnit(o.assetType, o.ticker);
  return fmtPrice(o.price, o.currency) + (qu ? '/' + unitShort(o.unit || qu) : '');
}
/** Cantidad de una posición en la unidad con que la registras (y en la de la cotización si es otra). */
function posQtyText(p, withTicker) {
  if (!p.quoteUnit) return fmtNum(p.quantity) + (withTicker ? ' ' + p.ticker : ' u.');
  var u = p.unit || p.quoteUnit;
  var txt = fmtNum(C.round(C.unitConvert(p.quantity, p.quoteUnit, u), 6)) + ' ' + unitShort(u);
  return u === p.quoteUnit ? txt : txt + ' (' + fmtNum(p.quantity, 0, 4) + ' ' + unitShort(p.quoteUnit) + ')';
}
/** Costo promedio de una posición por su unidad de registro. */
function posAvgText(p) {
  if (!p.quoteUnit) return fmtPrice(p.avgPrice, p.currency);
  var u = p.unit || p.quoteUnit;
  return fmtPrice(C.pricePerUnit(p.avgPrice, p.quoteUnit, u), p.currency) + '/' + unitShort(u);
}

/** Muestra el selector de unidad solo para materias primas y ajusta los textos de precio y total. */
function syncInvUnits(f) {
  f = f || $('#inv-form');
  var choices = C.unitChoices(f.assetType.value, f.ticker.value);
  var key = choices.join(',');
  $('#inv-unit-wrap').classList.toggle('hidden', choices.length < 2);
  $('#inv-total-wrap').classList.toggle('hidden', !choices.length);
  if (f.unit.dataset.key !== key) {
    f.unit.dataset.key = key;
    var lastU = (state.settings.last.invUnit || {})[f.ticker.value.trim().toUpperCase()];
    var prev = f.unit.value;
    fillSelect(f.unit, choices.map(function (u) { return { value: u, label: UNIT_LABELS[u] || u }; }),
      choices.indexOf(prev) >= 0 ? prev : choices.indexOf(lastU) >= 0 ? lastU : choices[0]);
  }
  var u = choices.length ? f.unit.value : '';
  $('#inv-price-label').textContent = u ? 'Precio por ' + unitOne(u) : 'Precio unitario';
  $('#inv-total-label').textContent = f.side.value === 'venta' ? 'Total recibido' : 'Total pagado';
  return u;
}
var invLiveBusy = {}, invLiveAsked = {};
/** Precio de hoy de la materia prima en la unidad elegida (null si aún no hay cotización). */
function invLiveQuote(f) {
  var qu = C.quoteUnit(f.assetType.value, f.ticker.value);
  if (!qu) return null;
  var t = f.ticker.value.trim().toUpperCase();
  var q = state.prices[C.priceKey('materia', t)];
  var ex = explore.commQuotes[t];
  if (ex && ex.price != null && (!q || q.price == null || (ex.time || 0) > (q.lastAttempt || q.time || 0))) q = ex;
  // Si no la tienes en el portafolio no se actualiza sola: se consulta al abrir el formulario y cada 2 min
  if ((!q || q.price == null || Date.now() - (q.lastAttempt || q.time || 0) > 120000) && !invLiveBusy[t] && Date.now() - (invLiveAsked[t] || 0) > 60000) {
    invLiveBusy[t] = true; invLiveAsked[t] = Date.now();
    Prices.fetchCommodities([t]).then(function (r) {
      if (r[t] && r[t].price != null) { r[t].lastAttempt = Date.now(); explore.commQuotes[t] = r[t]; }
    }).catch(function () {}).then(function () { invLiveBusy[t] = false; updateInvPreview(); });
  }
  if (!q || q.price == null || !isFinite(q.price)) return null;
  var u = f.unit.value || qu;
  var px = C.pricePerUnit(q.price, qu, u);
  var cur = f.currency.value;
  var inCur = q.currency === cur || C.samePeg(q.currency, cur) ? px : C.convert(px, q.currency, cur, rates());
  return { ticker: t, qu: qu, unit: u, quotePrice: q.price, quoteCur: q.currency, price: px, priceCur: inCur, change24h: q.change24h, time: q.lastAttempt || q.time, error: q.error };
}
function renderInvLive(f, qn, pn) {
  var box = $('#inv-live'), lq = invLiveQuote(f);
  if (!lq) {
    var mc = f.assetType.value === 'materia' ? Market.commodity(f.ticker.value) : null;
    box.classList.toggle('hidden', !mc);
    if (mc) box.innerHTML = '<span class="il-main">' + esc(mc.name) + ': buscando la cotización de hoy…</span>';
    return null;
  }
  var mc2 = Market.commodity(lq.ticker), cur = f.currency.value;
  var head = esc(mc2 ? mc2.name : lq.ticker) + ' hoy: <b>' + fmtPrice(lq.priceCur, cur) + '</b> por ' + esc(unitOne(lq.unit));
  var sub = lq.unit !== lq.qu ? fmtPrice(lq.quotePrice, lq.quoteCur) + ' la ' + esc(unitOne(lq.qu)) + ' · ' : '';
  sub += (lq.change24h != null ? '<span class="' + trend(lq.change24h) + '">' + fmtPct(lq.change24h) + ' 24 h</span> · ' : '') +
    (lq.error ? 'último precio conocido · ' : '') + fmtTime(lq.time);
  var val = '';
  if (qn > 0 && f.side.value === 'compra' && pn >= 0) {
    var now = C.round(qn * lq.priceCur, 2), paid = C.round(qn * pn + (num(f.fee.value) || 0), 2), d = C.round(now - paid, 2);
    val = '<span class="il-sub">Con el precio de hoy, ' + esc(fmtNum(qn) + ' ' + unitShort(lq.unit)) + ' valen <b>' + fmtMoney(now, cur) + '</b> · ' +
      '<span class="' + trend(d) + '">' + fmtSigned(d, cur) + (paid > 0 ? ' (' + fmtPct(C.round(d / paid * 100, 2)) + ')' : '') + '</span></span>';
  } else if (qn > 0) {
    val = '<span class="il-sub">Con el precio de hoy, ' + esc(fmtNum(qn) + ' ' + unitShort(lq.unit)) + ' valen <b>' + fmtMoney(C.round(qn * lq.priceCur, 2), cur) + '</b></span>';
  }
  box.classList.remove('hidden');
  box.innerHTML = '<span class="il-main">' + head + '<span class="il-sub">' + sub + '</span>' + val + '</span>' +
    '<button type="button" class="ghost" data-action="inv-use-live">Usar precio de hoy</button>';
  return lq;
}
function updateInvPreview() {
  var f = $('#inv-form');
  var unit = syncInvUnits(f);
  var q = num(f.quantity.value), p = num(f.price.value), fee = num(f.fee.value) || 0;
  renderInvLive(f, q, p);
  if (q > 0 && p >= 0) {
    var op = { side: f.side.value, quantity: q, price: p, fee: fee };
    var total = C.operationTotal(op);
    var txt = (op.side === 'compra' ? 'Total a pagar: ' : 'Total a recibir: ') + fmtMoney(total, f.currency.value) +
      ' (' + fmtNum(q) + (unit ? ' ' + unitShort(unit) : '') + ' × ' + fmtNum(p) + (op.side === 'compra' ? ' + ' : ' − ') + fmtNum(fee) + ')';
    if (f.currency.value !== base()) txt += ' ≈ ' + fmtMoney(C.toBase(total, f.currency.value, rates()), base());
    if (f.accountId.value) txt += (op.side === 'compra' ? ' · se descuenta de ' : ' · se acredita en ') + accName(f.accountId.value);
    var qu = C.quoteUnit(f.assetType.value, f.ticker.value);
    if (qu && unit && unit !== qu) txt += ' · equivale a ' + fmtNum(C.round(C.unitConvert(q, unit, qu), 6)) + ' ' + unitShort(qu);
    $('#inv-preview').textContent = txt;
  } else $('#inv-preview').textContent = unit ? 'Escribe la cantidad en ' + C.UNITS[unit].many + ' y el precio por ' + unitOne(unit) + ' (o el total pagado).' : '';
}
/** «Total pagado»: calcula el precio por unidad; al cambiar la cantidad se recalcula. Escribir el precio lo borra. */
function onInvFormInput(e) {
  var f = $('#inv-form'), n = e.target && e.target.name;
  if (n === 'price') { f.totalPaid.value = ''; delete f.price.dataset.auto; }
  if (n === 'totalPaid' || ((n === 'quantity' || n === 'unit') && f.totalPaid.value.trim())) {
    var q = num(f.quantity.value), t = num(f.totalPaid.value);
    if (q > 0 && t >= 0) { f.price.value = C.round(t / q, 8); delete f.price.dataset.auto; }
  } else if (n === 'unit' && f.price.dataset.auto) {
    var lq = invLiveQuote(f); if (lq) f.price.value = livePriceValue(lq.priceCur);
  }
}
/** Precio de hoy para la casilla: 2 decimales (o 6 si es menor que 1). */
function livePriceValue(v) { return Math.abs(v) >= 1 ? C.round(v, 2) : C.round(v, 6); }
function useInvLivePrice() {
  var f = $('#inv-form'), lq = invLiveQuote(f);
  if (!lq) return;
  f.price.value = livePriceValue(lq.priceCur); f.price.dataset.auto = '1'; f.totalPaid.value = '';
  updateInvPreview();
}

function resetInvForm() {
  var f = $('#inv-form');
  f.editId.value = ''; f.ticker.value = ''; f.quantity.value = ''; f.price.value = ''; f.fee.value = ''; f.note.value = '';
  f.totalPaid.value = ''; delete f.price.dataset.auto;
  f.date.value = S.today();
  $('#inv-form-title').textContent = 'Registrar compra o venta';
  $('[data-action="cancel-inv"]').classList.add('hidden');
  $('[data-action="delete-inv"]').classList.add('hidden');
  renderInvAccountSelect();
  updateInvPreview();
  renderInvList();
}

function onInvSubmit(e) {
  e.preventDefault();
  var f = e.target;
  var ticker = f.ticker.value.trim().toUpperCase();
  var q = num(f.quantity.value), p = num(f.price.value), fee = num(f.fee.value) || 0;
  if (!ticker) { toast('Ingresa el ticker'); f.ticker.focus(); return; }
  if (!(q > 0)) { toast('La cantidad debe ser mayor a 0'); f.quantity.focus(); return; }
  if (f.price.value === '' || !(p >= 0)) { toast('Ingresa el precio'); f.price.focus(); return; }
  if (fee < 0) { toast('La comisión no puede ser negativa'); return; }
  if (!f.date.value) { toast('Elige una fecha'); return; }

  var unit = C.unitChoices(f.assetType.value, ticker).length ? f.unit.value || C.quoteUnit(f.assetType.value, ticker) : null;
  var data = {
    side: f.side.value, assetType: f.assetType.value, ticker: ticker, unit: unit,
    quantity: C.round(q, 8), price: C.round(p, 8), currency: f.currency.value,
    fee: C.round(fee, 2), date: f.date.value, accountId: f.accountId.value || null,
    custodyAccountId: f.custodyAccountId.value && f.custodyAccountId.value !== f.accountId.value ? f.custodyAccountId.value : null,
    note: f.note.value.trim()
  };

  // Ninguna venta puede dejar la posición en negativo
  var existing = f.editId.value ? byId(state.investments, f.editId.value) : null;
  var others = state.investments.filter(function (i) { return !existing || i.id !== existing.id; });
  var probe = Object.assign({}, data, { id: existing ? existing.id : '__nuevo', createdAt: existing ? existing.createdAt : Date.now() });
  var errs = C.buildPositions(others.concat([probe]), rates()).errors;
  if (errs.length) {
    var er = errs[0];
    var eu = er.unit && er.quoteUnit ? function (v) { return fmtNum(C.round(C.unitConvert(v, er.quoteUnit, er.unit), 6)) + ' ' + unitShort(er.unit) + ' de'; } : fmtNum;
    toast('No puedes vender ' + eu(er.wanted) + ' ' + er.ticker + ': solo tienes ' + eu(er.available).replace(/ de$/, '') + ' al ' + fmtDate(er.date));
    return;
  }

  invalidateSnapshots(existing && existing.date < data.date ? existing.date : data.date);
  if (!data.unit) delete data.unit;
  if (existing) { Object.assign(existing, data); if (!data.unit) delete existing.unit; toast('Operación actualizada'); }
  else {
    data.id = S.uid(); data.createdAt = Date.now();
    state.investments.push(data);
    toast((data.side === 'compra' ? 'Compra' : 'Venta') + ' de ' + ticker + ' guardada');
  }
  state.settings.last.invCurrency = data.currency;
  state.settings.last.invAccountId = data.accountId;
  if (data.unit) { state.settings.last.invUnit = Object.assign({}, state.settings.last.invUnit); state.settings.last.invUnit[ticker] = data.unit; }
  resetInvForm();
  persist();
  refreshPrices(false); // trae el precio del activo nuevo
}

function editInv(id) {
  var o = byId(state.investments, id); if (!o) return;
  if (!$('#view-inversiones').classList.contains('active')) showView('inversiones');
  var f = $('#inv-form');
  $('#inv-details').open = true;
  f.editId.value = o.id; f.side.value = o.side; f.assetType.value = o.assetType; f.ticker.value = o.ticker;
  f.quantity.value = o.quantity; f.price.value = o.price; f.currency.value = o.currency;
  f.fee.value = o.fee || ''; f.date.value = o.date; f.note.value = o.note || '';
  f.totalPaid.value = ''; delete f.price.dataset.auto;
  syncInvUnits(f);
  if (o.unit && C.unitChoices(o.assetType, o.ticker).indexOf(o.unit) >= 0) f.unit.value = o.unit;
  else if (C.quoteUnit(o.assetType, o.ticker)) f.unit.value = C.quoteUnit(o.assetType, o.ticker);
  renderInvAccountSelect();
  f.accountId.value = o.accountId || '';
  renderInvAccountSelect();
  f.custodyAccountId.value = o.custodyAccountId || '';
  $('#inv-form-title').textContent = 'Editar operación';
  $('[data-action="cancel-inv"]').classList.remove('hidden');
  $('[data-action="delete-inv"]').classList.remove('hidden');
  updateInvPreview();
  renderInvList();
  $('#inv-details').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openManualPrice(key, cur) {
  var q = state.prices[key];
  var ticker = key.split('|')[1];
  var dlg = $('#price-dialog'), f = $('#price-form');
  $('#price-title').textContent = 'Precio de ' + ticker;
  $('#price-help').textContent = q && q.price != null
    ? 'Precio actual: ' + fmtPrice(q.price, q.currency) + ' (' + (q.source === 'manual' ? 'manual' : q.source) + '). Si la API vuelve a responder, se usará su precio.'
    : 'No hay precio automático para este activo. Ingresa el precio de mercado por unidad.';
  $('#price-cur').textContent = '(' + cur + ')';
  f.price.value = '';
  f.dataset.key = key; f.dataset.cur = cur;
  dlg.showModal();
  f.price.focus();
}

// ================================================================ precios en vivo
var refreshing = false, refreshQueued = false;
async function refreshPrices(manual) {
  // Si ya hay una actualización en curso, se repite al terminar (p. ej., dos compras seguidas de activos nuevos)
  if (refreshing) { refreshQueued = true; return; }
  refreshing = true;
  var btn = $('[data-action="refresh"]');
  btn.classList.add('spinning');
  $('#sync-status').textContent = 'Actualizando…';
  var target = state;
  try {
    var r = await P.refresh(target);
    if (target !== state) return; // los datos cambiaron (p. ej. restauración) mientras se consultaba
    state.settings.lastRefresh = Date.now();
    state.settings.lastRefreshOk = !r.fxError && !r.failed.length;
    recordSnapshot();
    S.save(state);
    renderAll();
    if (manual) {
      var msg = r.updated + ' precio(s) actualizado(s)';
      if (r.failed.length) msg += ' · ' + r.failed.length + ' sin respuesta (se muestra el último conocido)';
      if (r.fxError) msg += ' · tasas sin actualizar';
      toast(msg);
    }
  } catch (e) {
    if (manual) toast('No se pudo actualizar: ' + e.message);
  } finally {
    refreshing = false;
    btn.classList.remove('spinning');
    renderSyncStatus();
    if (refreshQueued) { refreshQueued = false; refreshPrices(false); }
  }
}

function renderSyncStatus() {
  var s = state.settings;
  if (refreshing) return;
  $('#sync-status').textContent = s.lastRefresh ? (s.lastRefreshOk === false ? 'Parcial · ' : 'Precios · ') + fmtTime(s.lastRefresh) : '';
}
