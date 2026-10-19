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
      '<div class="asset-row"><span class="sub">' + fmtNum(p.quantity) + ' u. · costo prom. ' + fmtPrice(p.avgPrice, p.currency) + '</span>' +
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
      '<div class="sub">' + fmtDate(o.date) + ' · ' + fmtNum(o.quantity) + ' × ' + fmtPrice(o.price, o.currency) +
      (o.fee ? ' + com. ' + fmtMoney(o.fee, o.currency) : '') + (o.accountId ? ' · ' + esc(accName(o.accountId)) : '') +
      (o.note ? ' · ' + esc(o.note) : '') + '</div></div>' +
      '<div class="amt">' + (buy ? '−' : '+') + fmtMoney(total, o.currency) +
      (o.currency !== b ? '<div class="sub">≈ ' + fmtMoney(C.toBase(total, o.currency, rates()), b) + '</div>' : '') + '</div></li>';
  }).join('') : '<li class="empty">Aún no hay operaciones.</li>';
}

function updateInvPreview() {
  var f = $('#inv-form');
  var q = num(f.quantity.value), p = num(f.price.value), fee = num(f.fee.value) || 0;
  if (q > 0 && p >= 0) {
    var op = { side: f.side.value, quantity: q, price: p, fee: fee };
    var total = C.operationTotal(op);
    var txt = (op.side === 'compra' ? 'Total a pagar: ' : 'Total a recibir: ') + fmtMoney(total, f.currency.value) +
      ' (' + fmtNum(q) + ' × ' + fmtNum(p) + (op.side === 'compra' ? ' + ' : ' − ') + fmtNum(fee) + ')';
    if (f.currency.value !== base()) txt += ' ≈ ' + fmtMoney(C.toBase(total, f.currency.value, rates()), base());
    if (f.accountId.value) txt += (op.side === 'compra' ? ' · se descuenta de ' : ' · se acredita en ') + accName(f.accountId.value);
    $('#inv-preview').textContent = txt;
  } else $('#inv-preview').textContent = '';
}

function resetInvForm() {
  var f = $('#inv-form');
  f.editId.value = ''; f.ticker.value = ''; f.quantity.value = ''; f.price.value = ''; f.fee.value = ''; f.note.value = '';
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

  var data = {
    side: f.side.value, assetType: f.assetType.value, ticker: ticker,
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
    toast('No puedes vender ' + fmtNum(er.wanted) + ' ' + er.ticker + ': solo tienes ' + fmtNum(er.available) + ' al ' + fmtDate(er.date));
    return;
  }

  invalidateSnapshots(existing && existing.date < data.date ? existing.date : data.date);
  if (existing) { Object.assign(existing, data); toast('Operación actualizada'); }
  else {
    data.id = S.uid(); data.createdAt = Date.now();
    state.investments.push(data);
    toast((data.side === 'compra' ? 'Compra' : 'Venta') + ' de ' + ticker + ' guardada');
  }
  state.settings.last.invCurrency = data.currency;
  state.settings.last.invAccountId = data.accountId;
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
