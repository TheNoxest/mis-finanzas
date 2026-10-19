/* =========================================================================
 * app/ficha-cuenta.js — Ficha de una cuenta.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ ficha de cuenta
var currentAccountId = null;

function openAccount(id) {
  var a = account(id);
  if (!a) { showView('cuentas'); return; }
  closeAsset();
  currentAccountId = id;
  $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-cuenta'); });
  $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.view === 'cuentas'); });
  $('#settings-btn').classList.remove('active');
  var h = '#cuenta/' + id;
  if (location.hash !== h) history.replaceState(null, '', h);
  window.scrollTo(0, 0);
  renderAccountView();
}

/** Todo lo que movió dinero o activos de una cuenta, del más reciente al más antiguo. */
function accountMoves(id) {
  var out = [];
  var push = function (date, title, sub, amount, extra) { out.push({ date: date, title: title, sub: sub, amount: amount, extra: extra || '' }); };
  var mine = function (pm) { return C.splitAmount(C.paySplits(pm), id); };   // parte de esta cuenta (pagos mixtos)
  var mixNote = function (pm, txt) { return pm.splits && pm.splits.length > 1 ? (txt ? txt + ' · ' : '') + 'pago mixto' : txt; };
  var ai, ao, as;
  (state.sales || []).forEach(function (sv) {
    if (sv.mode === 'contado' && (as = C.splitAmount(C.splitsOf(sv.splits, sv.accountId, sv.amount), id))) push(sv.date, 'Venta' + (sv.client ? ' · ' + sv.client : ''), mixNote(sv, sv.concept || ''), as);
    (sv.payments || []).forEach(function (pm) { var v = mine(pm); if (v) push(pm.date, 'Cobro de venta' + (sv.client ? ' · ' + sv.client : ''), mixNote(pm, sv.concept || ''), v); });
  });
  (state.loans || []).forEach(function (l) {
    var rec = l.kind === 'recibido';
    var lp = C.splitAmount(C.splitsOf(l.splits, l.accountId, l.principal), id);
    if (lp) push(l.date, (rec ? 'Préstamo de ' : 'Préstamo a ') + (l.person || ''), mixNote(l, ''), rec ? lp : -lp);
    (l.payments || []).forEach(function (pm) { var v = mine(pm); if (v) push(pm.date, (rec ? 'Pago de préstamo a ' : 'Pago recibido de ') + (l.person || ''), mixNote(pm, pm.note || ''), rec ? -v : v); });
  });
  state.transactions.forEach(function (t) {
    if (t.type === 'transferencia') {
      if (t.fromAccountId === id) push(t.date, 'Transferencia a ' + accName(t.toAccountId), t.note || '', -t.amount);
      if (t.toAccountId === id) push(t.date, 'Transferencia de ' + accName(t.fromAccountId), t.note || '', Number(t.toAmount));
    } else {
      var tp = C.splitAmount(C.splitsOf(t.splits, t.accountId, t.amount), id);
      if (tp) push(t.date, catName(t.categoryId), mixNote(t, t.note || ''), t.type === 'ingreso' ? tp : -tp);
    }
  });
  state.investments.forEach(function (o) {
    var buy = o.side === 'compra', total = C.operationTotal(o);
    var qty = fmtNum(o.quantity) + ' ' + o.ticker;
    if (o.accountId === id) push(o.date, (buy ? 'Compra ' : 'Venta ') + o.ticker, qty + ' × ' + fmtPrice(o.price, o.currency) + (o.custodyAccountId ? ' · guardado en ' + accName(o.custodyAccountId) : ''), buy ? -total : total);
    else if (o.custodyAccountId === id) push(o.date, (buy ? 'Entra ' : 'Sale ') + o.ticker, 'Pagado desde ' + accName(o.accountId), null, (buy ? '+' : '−') + qty);
  });
  state.exchanges.forEach(function (x) {
    var xs = C.exchangeSettlement(x);
    (x.settlements || []).forEach(function (s) {
      var v = mine(s);
      if (v && xs) push(s.date, xs.side === 'in' ? 'Cobro de cambio · ' + (x.client || 'cliente') : 'Entrega de cambio · ' + (x.client || 'cliente'), mixNote(s, s.note || ''), xs.side === 'in' ? v : -v);
    });
    if (xs && xs.side === 'in') { /* lo recibido entra con cada cobro */ }
    else if (x.status !== 'pendiente_cobro' && (ai = C.splitAmount(C.fxSplits(x, 'in'), id))) push(x.date, 'Cambio · recibido de ' + (x.client || 'cliente'), fmtMoney(x.received, x.inCurrency) + ' → ' + fmtMoney(x.delivered, x.outCurrency) + ((x.inSplits || []).length > 1 ? ' · pago mixto' : ''), ai);
    if (xs && xs.side === 'out') { /* lo entregado sale con cada entrega */ }
    else if (x.status !== 'pendiente_entrega' && (ao = C.splitAmount(C.fxSplits(x, 'out'), id))) push(x.date, 'Cambio · entregado a ' + (x.client || 'cliente'), fmtMoney(x.received, x.inCurrency) + ' → ' + fmtMoney(x.delivered, x.outCurrency) + ((x.outSplits || []).length > 1 ? ' · pago mixto' : ''), -ao);
    (x.costs || []).forEach(function (c) { if (c.accountId === id) push(x.date, 'Costo de cambio', c.concept || '', -c.amount); });
  });
  state.debts.forEach(function (d) {
    var c = d.kind === 'cobrar';
    var dp = C.splitAmount(C.splitsOf(d.splits, d.accountId, d.amount), id);
    if (dp) push(d.date, (c ? 'Préstamo a ' : 'Préstamo de ') + d.person, mixNote(d, d.concept || ''), c ? -dp : dp);
    (d.payments || []).forEach(function (pm) { var v = mine(pm); if (v) push(pm.date, (c ? 'Cobro de ' : 'Pago a ') + d.person, mixNote(pm, d.concept || ''), c ? v : -v); });
  });
  return out.sort(function (a, c) { return a.date < c.date ? 1 : a.date > c.date ? -1 : 0; });
}

function renderAccountView() {
  if (!currentAccountId || !$('#view-cuenta').classList.contains('active')) return;
  var acc = account(currentAccountId);
  if (!acc) { currentAccountId = null; showView('cuentas'); return; }
  var b = base(), h = C.accountHoldings(state, acc.id), pf = h.portfolio;
  $('#ac-icon').innerHTML = icon(KIND_ICONS[acc.kind] || 'i-wallet');
  $('#ac-name').textContent = acc.name;
  $('#ac-sub').textContent = (S.ACCOUNT_KINDS[acc.kind] || '') + ' · moneda ' + acc.currency;
  $('#ac-total').textContent = fmtMoney(h.total, b);
  $('#ac-stats').innerHTML = stat(acc.currency + ' disponible', fmtMoney(h.cash, acc.currency) + (acc.currency !== b ? ' <span class="muted small">≈ ' + fmtMoney(h.cashBase, b) + '</span>' : '')) +
    (pf.rows.length ? stat('En activos', fmtMoney(pf.value, b)) +
      stat('Ganancia / pérdida', '<span class="' + trend(pf.pnl) + '">' + fmtSigned(pf.pnl, b) + ' (' + fmtPct(pf.pnlPct) + ')</span>') : '');
  $('#ac-actions').innerHTML = '<button type="button" class="primary" data-action="ac-buy">Comprar activo</button>' +
    '<button type="button" data-action="ac-move">Registrar movimiento</button>' +
    '<button type="button" data-edit-acc="' + acc.id + '">Editar cuenta</button>';

  // Activos en la cuenta: saldo disponible + cada posición, con su peso en el total (un solo color)
  var items = [{ label: acc.currency + ' disponible', value: h.cashBase, cash: true }].concat(pf.rows.map(function (r) { return { label: r.position.ticker, value: r.valueBase, row: r }; }));
  var tot = h.total > 0 ? h.total : 1;
  var maxW = Math.max.apply(null, items.map(function (i) { return Math.max(0, i.value); }).concat([1]));
  $('#ac-dist').innerHTML = pf.rows.length ? '<div class="hbars">' + items.map(function (i) {
    var w = C.round(Math.max(0, i.value) / tot * 100, 1);
    return '<div class="hbar" data-tip="' + esc(i.label + ': ' + fmtMoney(i.value, b)) + '"><span class="lbl">' + esc(i.cash ? acc.currency : i.label) + '</span>' +
      '<span class="track"><span class="fill" style="width:' + (Math.max(0, i.value) / maxW * 100) + '%;display:block"></span></span><span class="pct">' + fmtNum(w, 1, 1) + ' %</span></div>';
  }).join('') + '</div>' : '';
  var cashRow = '<li><span class="asset-badge" style="--type-color:var(--muted)">' + esc(acc.currency.slice(0, 4)) + '</span>' +
    '<div class="main"><div class="asset-row"><span class="title">' + esc(acc.currency) + ' <span class="tag">Disponible</span></span><span class="val">' + fmtMoney(h.cash, acc.currency) + '</span></div>' +
    '<div class="asset-row"><span class="sub">Saldo de la cuenta</span>' + (acc.currency !== b ? '<span class="pnl muted">≈ ' + fmtMoney(h.cashBase, b) + '</span>' : '') + '</div></div></li>';
  $('#ac-holdings').innerHTML = cashRow + pf.rows.map(function (r) {
    var p = r.position, q = r.quote;
    return '<li class="clickable" data-open-asset="' + esc(p.assetType + '|' + p.ticker) + '" tabindex="0" role="button">' + assetBadge(p) +
      '<div class="main"><div class="asset-row"><span class="title">' + esc(p.ticker) + ' <span class="tag">' + ASSET_LABELS[p.assetType] + '</span></span>' +
      '<span class="val">' + fmtMoney(r.valueBase, b) + '</span></div>' +
      '<div class="asset-row"><span class="sub">' + fmtNum(p.quantity) + ' ' + esc(p.ticker) + (r.hasPrice && q ? ' · ' + fmtPrice(q.price, q.currency) : ' · sin precio') + '</span>' +
      (r.hasPrice ? '<span class="pnl ' + trend(r.pnlBase) + '">' + fmtSigned(r.pnlBase, b) + ' · ' + fmtPct(r.pnlPct) + '</span>' : '') + '</div>' +
      '<div class="price-line">' + fmtNum(C.round(r.valueBase / tot * 100, 1), 1, 1) + ' % de la cuenta</div></div></li>';
  }).join('');
  $('#ac-holdings-note').textContent = pf.rows.length ? '' :
    'Aún no hay activos guardados en esta cuenta. Al comprar, elige esta cuenta en «Pagado desde» o «Guardado en».';
  if (h.errors.length) $('#ac-holdings-note').textContent = 'Hay ventas de ' + h.errors.map(function (e) { return e.ticker; }).join(', ') + ' mayores a lo guardado en esta cuenta: revisa «Guardado en» en esas operaciones.';

  var moves = accountMoves(acc.id);
  $('#ac-moves').innerHTML = moves.length ? moves.slice(0, 25).map(function (m) {
    var amt = m.amount == null ? '<span class="muted">' + esc(m.extra) + '</span>'
      : '<span class="' + (m.amount > 0 ? 'up' : '') + '">' + (m.amount > 0 ? '+' : '−') + fmtMoney(Math.abs(m.amount), acc.currency) + '</span>';
    return '<li><span class="avatar ' + (m.amount == null ? 'tr' : m.amount > 0 ? 'in' : 'out') + '">' + icon(m.amount == null ? 'i-swap' : m.amount > 0 ? 'i-in' : 'i-out') + '</span>' +
      '<div class="main"><div class="title">' + esc(m.title) + '</div><div class="sub">' + fmtDate(m.date) + (m.sub ? ' · ' + esc(m.sub) : '') + '</div></div>' +
      '<div class="amt">' + amt + '</div></li>';
  }).join('') + (moves.length > 25 ? '<li class="empty">Mostrando los 25 más recientes de ' + moves.length + '.</li>' : '')
    : '<li class="empty">Sin movimientos todavía.</li>';
}

/** Comprar un activo desde esta cuenta: el formulario queda con su moneda y la cuenta elegidas. */
function buyFromAccount() {
  var acc = account(currentAccountId); if (!acc) return;
  showView('inversiones');
  resetInvForm();
  var f = $('#inv-form');
  $('#inv-details').open = true;
  f.side.value = 'compra';
  if (acc.kind === 'broker' || C.pegOf(acc.currency) === 'USD') f.assetType.value = 'cripto';
  fillSelect(f.currency, currencyOptions(), acc.currency);
  renderInvAccountSelect(); f.accountId.value = acc.id; renderInvAccountSelect();
  updateInvPreview();
  $('#inv-details').scrollIntoView({ behavior: 'smooth', block: 'start' });
  f.ticker.focus({ preventScroll: true });
}
