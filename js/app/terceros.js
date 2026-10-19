/* =========================================================================
 * app/terceros.js — Pestañas de Cuentas, Por cobrar / Por pagar, cobros de cambios y CSV.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ terceros
// Cuentas por cobrar / por pagar y cambios de divisas a terceros.
var accTab = 'cuentas';
var STABLE = { USDT: 1, USDC: 1 };

function setAccTab(tab) {
  if (tab !== accTab) { payFx = null; payRef = null; }
  accTab = tab;
  $$('#acc-tabs button, .subtabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.accTab === tab ? 'true' : 'false'); });
  $('#acc-panel-cuentas').classList.toggle('hidden', tab !== 'cuentas');
  $('#acc-panel-deudas').classList.toggle('hidden', tab !== 'cobrar' && tab !== 'pagar');
  $('#acc-panel-cambios').classList.toggle('hidden', tab !== 'cambios');
  $('#acc-panel-ventas').classList.toggle('hidden', tab !== 'ventas');
  $('#acc-panel-prestamos').classList.toggle('hidden', tab !== 'prestamos');
  $('#acc-panel-clientes').classList.toggle('hidden', tab !== 'clientes');
  if (tab === 'clientes') renderClients();
  if (tab === 'ventas') renderSales();
  if (tab === 'prestamos') renderLoans();
  if (tab === 'cobrar' || tab === 'pagar') { if ($('#debt-form').dataset.kind !== tab) resetDebtForm(); renderDebts(); }
  if (tab === 'cambios') renderExchanges();
}

function accountsFor(cur, noneLabel) {
  return [{ value: '', label: noneLabel }].concat(state.accounts.filter(function (a) { return a.currency === cur; })
    .map(function (a) { return { value: a.id, label: a.name }; }));
}
function initials(name) { return esc(String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase()); }

// ---------- Por cobrar / por pagar ----------
function dueTag(it) {
  if (it.status === 'pagada') return '<span class="tag ok">Saldada</span>';
  var t = it.source === 'cambio' ? '<span class="tag info">Cambio</span> ' : it.source === 'venta' ? '<span class="tag info">Venta</span> ' : it.source === 'prestamo' ? '<span class="tag info">Préstamo</span> ' : '';
  if (it.overdue) return t + '<span class="tag danger">Vencida hace ' + Math.abs(it.daysToDue) + ' d</span>';
  if (it.daysToDue === 0) return t + '<span class="tag warn">Vence hoy</span>';
  if (it.daysToDue != null && it.daysToDue <= 7) return t + '<span class="tag warn">Vence en ' + it.daysToDue + ' d</span>';
  if (it.status === 'parcial') return t + '<span class="tag">Parcial</span>';
  return t;
}

function renderDebts() {
  if (accTab !== 'cobrar' && accTab !== 'pagar') return;
  var kind = accTab, b = base(), today = S.today();
  var tp = C.thirdParty(state, today);
  var all = kind === 'cobrar' ? tp.receivables : tp.payables;
  var open = all.filter(function (i) { return i.status !== 'pagada'; });
  var overdue = open.filter(function (i) { return i.overdue; });
  $('#debt-eyebrow').textContent = kind === 'cobrar' ? 'Te deben' : 'Debes';
  $('#debt-total').textContent = fmtMoney(kind === 'cobrar' ? tp.receivableBase : tp.payableBase, b);
  $('#debt-sub').innerHTML = open.length
    ? open.length + ' pendiente(s)' + (overdue.length ? ' · <span class="down">' + overdue.length + ' vencida(s) por ' + fmtMoney(C.sum(overdue.map(function (i) { return i.pendingBase || 0; })), b) + '</span>' : '')
    : 'Nada pendiente';
  var filter = document.querySelector('input[name="debt-filter"]:checked').value;
  var q = $('#debt-search').value.trim(), found = q ? C.searchItems(all, q) : all;
  var inFilter = function (i) { return filter === 'all' || (filter === 'paid' ? i.status === 'pagada' : i.status !== 'pagada'); };
  var list = found.filter(inFilter)
    .sort(function (a, c) {
      if (a.overdue !== c.overdue) return a.overdue ? -1 : 1;
      var da = a.dueDate || '9999', dc = c.dueDate || '9999';
      return da < dc ? -1 : da > dc ? 1 : (a.date < c.date ? 1 : -1);
    });
  $('#debt-list-title').textContent = filter === 'paid' ? 'Saldadas' : filter === 'all' ? 'Todas' : 'Pendientes';
  var info = $('#debt-search-info'), others = found.length - list.length;
  info.classList.toggle('hidden', !q);
  if (q) {
    var pend = C.sum(list.filter(function (i) { return i.status !== 'pagada'; }).map(function (i) { return i.pendingBase || 0; }));
    info.innerHTML = plural(list.length, 'resultado', 'resultados') + (pend > 0 ? ' · pendiente ' + fmtMoney(pend, b) : '') +
      (others > 0 ? ' · <button type="button" class="link small" data-action="debt-search-all">' + others + ' más en otras listas</button>' : '');
  }
  var editing = $('#debt-form').editId.value;
  $('#debt-list').innerHTML = list.length ? list.map(function (it) {
    var attr = it.source === 'cambio' ? 'data-settle-fx="' + it.id + '"' : it.source === 'venta' ? 'data-pay-ref="sale|' + it.id + '"'
      : it.source === 'prestamo' ? 'data-pay-ref="loan|' + it.id + '"' : 'data-open-debt="' + it.id + '"';
    var isEditing = it.source === 'cambio' ? payFx === it.id : (it.source === 'venta' || it.source === 'prestamo') ? !!payRef && payRef.id === it.id : editing === it.id;
    return '<li class="clickable' + (isEditing ? ' editing' : '') + '" ' + attr + ' tabindex="0" role="button">' +
      '<span class="avatar">' + initials(it.person) + '</span>' +
      '<div class="main"><div class="title">' + esc(it.person || 'Sin nombre') + ' ' + dueTag(it) + '</div>' +
      '<div class="sub">' + esc(it.concept || '—') + ' · ' + fmtDate(it.date) + (it.dueDate ? ' · vence ' + fmtDate(it.dueDate) : '') +
      (it.paid > 0 ? ' · abonado ' + fmtMoney(it.paid, it.currency) + ' de ' + fmtMoney(it.total, it.currency) : '') +
      (it.source === 'prestamo' && it.next ? ' · cuota ' + it.next.n + ' de ' + it.installments : '') + '</div></div>' +
      '<div class="amt">' + fmtMoney(it.status === 'pagada' ? it.total : it.pending, it.currency) +
      (it.source === 'prestamo' && it.status !== 'pagada' ? '<div class="sub">capital ' + fmtMoney(it.capitalPending, it.currency) + '</div>'
        : it.currency !== b && it.status !== 'pagada' ? '<div class="sub">≈ ' + fmtMoney(it.pendingBase, b) + '</div>' : '') + '</div></li>';
  }).join('') : q ? '<li class="empty">Nada coincide con «' + esc(q) + '». Prueba con el nombre, el concepto, un monto (150, &gt;100) o una fecha (15/10).</li>'
    : '<li class="empty">' + (filter === 'open' ? (kind === 'cobrar' ? 'Nadie te debe nada. Registra abajo un préstamo o una venta a crédito.' : 'No debes nada. Registra abajo una deuda o compra a crédito.') : 'Sin registros.') + '</li>';
  renderDebtPayments();
}

function debtLabels(kind) {
  var c = kind === 'cobrar';
  $('#debt-form-title').textContent = ($('#debt-form').editId.value ? 'Editar' : 'Nueva') + (c ? ' cuenta por cobrar' : ' cuenta por pagar');
  $('#debt-person-label').textContent = c ? '¿Quién te debe?' : '¿A quién le debes?';
  $('#debt-acc-label').textContent = c ? '¿Le prestaste dinero? Salió de' : '¿Te prestaron dinero? Entró en';
  $('#debt-hint').textContent = c ? 'Si elegiste una cuenta, el préstamo sale de su saldo. Cada abono que te hagan entra en la cuenta que indiques.'
    : 'Si elegiste una cuenta, el dinero prestado entra en su saldo. Cada pago que hagas sale de la cuenta que indiques.';
}

function renderDebtAccountSelect() {
  var f = $('#debt-form'), kind = f.dataset.kind;
  var none = kind === 'cobrar' ? 'No salió dinero (venta, servicio…)' : 'No entró dinero (compra a crédito…)';
  fillSelect(f.accountId, accountsFor(f.currency.value, none), f.accountId.value);
}

/** La tarjeta de cobros/pagos es una sola: se coloca en la sección que la usa. */
function placePayCard(panelId) {
  var card = $('#debt-payments'), anchor = $('#' + panelId + ' [data-pay-anchor]');
  if (anchor && card.previousElementSibling !== anchor) anchor.after(card);
}
function resetDebtForm() {
  var f = $('#debt-form');
  payFx = null; payRef = null;
  placePayCard('acc-panel-deudas');
  f.reset(); f.editId.value = '';
  f.dataset.kind = accTab === 'pagar' ? 'pagar' : 'cobrar';
  fillSelect(f.currency, currencyOptions(), state.settings.last.debtCurrency || base());
  f.currency.disabled = false;
  f.date.value = S.today();
  renderDebtAccountSelect();
  mixReset(debtMix);
  debtLabels(f.dataset.kind);
  $('[data-action="cancel-debt"]').classList.add('hidden');
  $('[data-action="delete-debt"]').classList.add('hidden'); rcptFormBtn('debt', false);
  $('#debt-payments').classList.add('hidden');
}

function editDebt(id) {
  var d = byId(state.debts, id); if (!d) return;
  if (accTab !== d.kind) { showView('cuentas/' + d.kind); }
  payFx = null; payRef = null; placePayCard('acc-panel-deudas');
  var f = $('#debt-form');
  f.dataset.kind = d.kind;
  f.editId.value = d.id; f.person.value = d.person || ''; f.concept.value = d.concept || '';
  f.amount.value = d.amount; fillSelect(f.currency, currencyOptions(), d.currency);
  f.currency.disabled = (d.payments || []).length > 0; // con abonos no se cambia la moneda
  f.date.value = d.date; f.dueDate.value = d.dueDate || ''; f.note.value = d.note || '';
  renderDebtAccountSelect(); f.accountId.value = d.accountId || '';
  mixSet(debtMix, d.splits);
  debtLabels(d.kind);
  $('[data-action="cancel-debt"]').classList.remove('hidden');
  $('[data-action="delete-debt"]').classList.remove('hidden'); rcptFormBtn('debt', true);
  renderDebts();
  $('#debt-payments').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Cobro / entrega de un cambio pendiente (misma tarjeta que los abonos de deudas)
var payFx = null;   // id del cambio cuyo cobro o entrega se está registrando
function openFxSettle(id) {
  var x = byId(state.exchanges, id), st = x && C.exchangeSettlement(x);
  if (!st) { editFx(id); return; }
  var kind = st.side === 'in' ? 'cobrar' : 'pagar';
  if (accTab !== kind) showView('cuentas/' + kind);
  resetDebtForm();
  payFx = id; $('#pay-form').dataset.debt = '';
  placePayCard('acc-panel-deudas');
  renderDebts();
  $('#debt-payments').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderFxPayments() {
  var card = $('#debt-payments'), x = byId(state.exchanges, payFx), st = x && C.exchangeSettlement(x);
  if (!st || (st.side === 'in') !== (accTab === 'cobrar')) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  var c = st.side === 'in', cur = st.currency;
  var pct = st.total > 0 ? Math.min(100, st.paid / st.total * 100) : 0;
  $('#pay-title').textContent = (c ? 'Cobro del cambio de ' : 'Entrega del cambio a ') + (x.client || 'cliente');
  setPayEdit('fx-open-edit', x.id, 'Editar cambio');
  setPayTools('fx', x.id, c && st.pending > 0);
  $('#pay-progress').innerHTML = '<span style="width:' + pct + '%"></span>';
  var sets = (x.settlements || []).slice().sort(function (a, b2) { return a.date < b2.date ? 1 : -1; });
  $('#pay-list').innerHTML = '<li class="sub pay-note" style="border:0;padding:4px 0 2px">Cambio del ' + fmtDate(x.date) + ': ' + (c ? 'el cliente te paga ' : 'le entregas ') +
    '<b>' + fmtMoney(st.total, cur) + '</b> (' + fmtMoney(x.received, x.inCurrency) + ' → ' + fmtMoney(x.delivered, x.outCurrency) + ') · ' +
    '</li>' +
    '<li class="sub pay-note" style="border:0;padding:2px 0 8px">' + (c ? 'Cobrado ' : 'Entregado ') + fmtMoney(st.paid, cur) + ' de ' + fmtMoney(st.total, cur) +
    ' · pendiente <b>' + fmtMoney(st.pending, cur) + '</b></li>' +
    sets.map(function (pm) {
      return '<li><span class="avatar ' + (c ? 'in' : 'out') + '">' + icon(c ? 'i-in' : 'i-out') + '</span><div class="main"><div class="title">' + fmtMoney(pm.amount, cur) + '</div>' +
        '<div class="sub">' + fmtDate(pm.date) + ' · ' + payAccText(pm, cur) + (pm.note ? ' · ' + esc(pm.note) : '') + '</div></div>' +
        '<div class="row-actions"><button class="mini" data-rcpt="fx|' + x.id + '|' + pm.id + '" aria-label="Recibo">' + icon('i-doc') + '</button><button class="mini" data-del-settle="' + pm.id + '" aria-label="Eliminar">' + icon('i-x') + '</button></div></li>';
    }).join('');
  var pf = $('#pay-form');
  pf.classList.toggle('hidden', st.status === 'pagada');
  $('#pay-acc-label').textContent = c ? 'Entra en' : 'Sale de';
  $('#pay-submit').textContent = c ? 'Registrar cobro' : 'Registrar entrega';
  if (pf.dataset.debt !== 'fx:' + x.id) {
    pf.dataset.debt = 'fx:' + x.id;
    pf.amount.value = st.pending; pf.date.value = S.today(); pf.note.value = '';
    fillSelect(pf.accountId, accountsFor(cur, 'Sin cuenta'), (c ? x.inAccountId : x.outAccountId) || '');
    pf.dataset.cur = cur; mixReset(payMix);
  }
}
/** Registra un cobro (o entrega) del cambio; si queda saldado, el cambio pasa a «completado». */
function settleFx(f) {
  var x = byId(state.exchanges, payFx), st = x && C.exchangeSettlement(x);
  if (!st) return;
  var amt = num(f.amount.value);
  if (!(amt > 0)) { toast('Ingresa un monto mayor a 0'); return; }
  if (amt > st.pending + 0.001) { toast('Supera lo pendiente (' + fmtMoney(st.pending, st.currency) + ')'); return; }
  if (!f.date.value) { toast('Elige la fecha'); return; }
  var tg = payTarget(f);
  if (tg.error) { toast(tg.error); return; }
  x.settleSide = st.side;
  var nid = S.uid();
  x.settlements = (x.settlements || []).concat([withSplits({ id: nid, date: f.date.value, amount: C.round(amt, 2), accountId: tg.accountId, note: f.note.value.trim(), createdAt: Date.now() }, tg)]);
  var ns = C.exchangeSettlement(x);
  if (ns.status === 'pagada') x.status = 'completada';
  invalidateSnapshots(f.date.value);
  f.dataset.debt = '';
  toastAction(ns.status === 'pagada' ? (st.side === 'in' ? '¡Cobrado! El cambio queda completado.' : '¡Entregado! El cambio queda completado.')
    : (st.side === 'in' ? 'Cobro registrado' : 'Entrega registrada') + ' · pendiente ' + fmtMoney(ns.pending, ns.currency), 'Recibo', function () { openReceipt('fx', x.id, nid); });
  persist();
}
function deleteSettlement(sid) {
  var x = byId(state.exchanges, payFx); if (!x || !confirm('¿Eliminar este registro?')) return;
  var pm = byId(x.settlements || [], sid); if (pm) invalidateSnapshots(pm.date);
  x.settlements = (x.settlements || []).filter(function (s) { return s.id !== sid; });
  var st = C.exchangeSettlement(x);
  if (st && st.pending > 0) x.status = st.side === 'in' ? 'pendiente_cobro' : 'pendiente_entrega';
  if (!x.settlements.length && x.status !== 'completada') delete x.settleSide;
  $('#pay-form').dataset.debt = ''; persist(); toast('Eliminado');
}

/** Botón visible «Editar …» en la cabecera de la tarjeta de cobros/pagos (antes era un enlace diminuto dentro del texto). */
function setPayEdit(action, id, label) {
  var b = $('#pay-edit');
  if (!action) { b.classList.add('hidden'); return; }
  b.dataset.action = action; b.dataset.id = id;
  b.querySelector('span').textContent = label;
  b.classList.remove('hidden');
}
function renderDebtPayments() {
  setPayEdit(null); setPayTools(null);
  if (payFx) { renderFxPayments(); return; }
  if (payRef) { renderRefPayments(); return; }
  if (accTab !== 'cobrar' && accTab !== 'pagar') { $('#debt-payments').classList.add('hidden'); return; }
  var f = $('#debt-form'), card = $('#debt-payments');
  var d = f.editId.value ? byId(state.debts, f.editId.value) : null;
  if (!d) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  var bal = C.debtBalance(d), c = d.kind === 'cobrar';
  var pct = d.amount > 0 ? Math.min(100, bal.paid / d.amount * 100) : 0;
  $('#pay-title').textContent = (c ? 'Cobros de ' : 'Pagos a ') + (d.person || '');
  setPayTools('debt', d.id, c && bal.pending > 0);
  $('#pay-progress').innerHTML = '<span style="width:' + pct + '%"></span>';
  var pays = (d.payments || []).slice().sort(function (a, b2) { return a.date < b2.date ? 1 : -1; });
  $('#pay-list').innerHTML = '<li class="sub" style="border:0;padding:4px 0 8px">' + (c ? 'Cobrado ' : 'Pagado ') + fmtMoney(bal.paid, d.currency) + ' de ' + fmtMoney(d.amount, d.currency) +
    ' · pendiente <b>' + fmtMoney(bal.pending, d.currency) + '</b></li>' +
    pays.map(function (pm) {
      return '<li><span class="avatar ' + (c ? 'in' : 'out') + '">' + icon(c ? 'i-in' : 'i-out') + '</span><div class="main"><div class="title">' + fmtMoney(pm.amount, d.currency) + '</div>' +
        '<div class="sub">' + fmtDate(pm.date) + ' · ' + payAccText(pm, d.currency) + (pm.note ? ' · ' + esc(pm.note) : '') + '</div></div>' +
        '<div class="row-actions"><button class="mini" data-rcpt="debt|' + d.id + '|' + pm.id + '" aria-label="Recibo">' + icon('i-doc') + '</button><button class="mini" data-del-pay="' + pm.id + '" aria-label="Eliminar abono">' + icon('i-x') + '</button></div></li>';
    }).join('');
  var pf = $('#pay-form');
  pf.classList.toggle('hidden', bal.status === 'pagada');
  $('#pay-acc-label').textContent = c ? 'Entra en' : 'Sale de';
  $('#pay-submit').textContent = c ? 'Registrar cobro' : 'Registrar pago';
  if (pf.dataset.debt !== d.id) {
    pf.dataset.debt = d.id;
    pf.amount.value = bal.pending; pf.date.value = S.today(); pf.note.value = '';
    fillSelect(pf.accountId, accountsFor(d.currency, 'Sin cuenta'), d.accountId || '');
    pf.dataset.cur = d.currency; mixReset(payMix);
  }
}

function onDebtSubmit(e) {
  e.preventDefault();
  var f = e.target, kind = f.dataset.kind;
  var amount = num(f.amount.value);
  if (!f.person.value.trim()) { toast('Indica el nombre de la persona'); f.person.focus(); return; }
  if (!(amount > 0)) { toast('Ingresa un monto mayor a 0'); f.amount.focus(); return; }
  if (!f.date.value) { toast('Elige la fecha'); return; }
  if (f.dueDate.value && f.dueDate.value < f.date.value) { toast('El vencimiento no puede ser anterior a la fecha'); return; }
  var existing = f.editId.value ? byId(state.debts, f.editId.value) : null;
  if (existing && amount < C.debtBalance(existing).paid) { toast('El monto no puede ser menor a lo ya abonado'); return; }
  var mxD = mixRead(debtMix);
  if (mxD && mxD.error) { toast(mxD.error); return; }
  var data = { kind: kind, person: f.person.value.trim(), concept: f.concept.value.trim(), amount: C.round(amount, 2),
    currency: existing && (existing.payments || []).length ? existing.currency : f.currency.value,
    date: f.date.value, dueDate: f.dueDate.value || null, accountId: mxD ? mxD.accountId : (f.accountId.value || null), splits: mxD ? mxD.splits : null,
    note: f.note.value.trim() };
  invalidateSnapshots(existing && existing.date < data.date ? existing.date : data.date);
  if (existing) { Object.assign(existing, data); toast('Actualizado'); }
  else {
    data.id = S.uid(); data.createdAt = Date.now(); data.payments = [];
    state.debts.push(data);
    toastAction((kind === 'cobrar' ? 'Por cobrar: ' : 'Por pagar: ') + data.person + ' · ' + fmtMoney(data.amount, data.currency), 'Comprobante', function () { openReceipt('debt', data.id); });
  }
  state.settings.last.debtCurrency = data.currency;
  resetDebtForm();
  persist();
}

function onPaySubmit(e) {
  e.preventDefault();
  if (payFx) { settleFx(e.target); return; }
  if (payRef) { refPay(e.target); return; }
  var f = e.target, d = byId(state.debts, $('#debt-form').editId.value);
  if (!d) return;
  var amt = num(f.amount.value), bal = C.debtBalance(d);
  if (!(amt > 0)) { toast('Ingresa un monto mayor a 0'); return; }
  if (amt > bal.pending + 0.001) { toast('El abono supera lo pendiente (' + fmtMoney(bal.pending, d.currency) + ')'); return; }
  if (!f.date.value) { toast('Elige la fecha'); return; }
  d.payments = d.payments || [];
  var tg = payTarget(f);
  if (tg.error) { toast(tg.error); return; }
  var nid = S.uid();
  d.payments.push(withSplits({ id: nid, date: f.date.value, amount: C.round(amt, 2), accountId: tg.accountId, note: f.note.value.trim(), createdAt: Date.now() }, tg));
  invalidateSnapshots(f.date.value);
  f.dataset.debt = '';
  var nb = C.debtBalance(d);
  toastAction(nb.status === 'pagada' ? '¡Saldada! ' + (d.kind === 'cobrar' ? 'Cobraste todo.' : 'Pagaste todo.') : 'Abono registrado · pendiente ' + fmtMoney(nb.pending, d.currency),
    'Recibo', function () { openReceipt('debt', d.id, nid); });
  persist();
}

// ---------- Exportar ----------
function exportDebtsCSV() {
  var rows = state.debts.map(function (d) {
    var bl = C.debtBalance(d);
    return [d.kind === 'cobrar' ? 'por cobrar' : 'por pagar', d.person, d.concept || '', d.date, d.dueDate || '', d.amount, d.currency, bl.paid, bl.pending,
      bl.status, d.accountId ? accName(d.accountId) : '', (d.payments || []).map(function (p) { return p.date + ' ' + p.amount; }).join(' | '), d.note || ''];
  });
  S.download('por_cobrar_pagar_' + S.today() + '.csv', S.toCSV(['tipo', 'persona', 'concepto', 'fecha', 'vence', 'monto', 'moneda', 'abonado', 'pendiente', 'estado', 'cuenta_inicial', 'abonos', 'nota'], rows), 'text/csv');
}
function splitsText(list) {
  return list.map(function (s) { return accName(s.accountId) + (list.length > 1 ? ' ' + s.amount : ''); }).join(' + ');
}
function exportFxCSV() {
  var b = base();
  var rows = state.exchanges.slice().sort(function (a, c) { return a.date < c.date ? -1 : 1; }).map(function (x) {
    var pr = C.exchangeProfit(x, rates());
    return [x.date, x.client || '', x.status, x.amount, x.inCurrency, x.received, splitsText(C.fxSplits(x, 'in')), x.rate, x.delivered, x.outCurrency,
      splitsText(C.fxSplits(x, 'out')), x.commission.mode, x.commission.value, x.commissionAmount, x.commission.charge,
      (x.costs || []).map(function (c) { return (c.concept || 'costo') + ' ' + c.amount + ' ' + c.currency; }).join(' | '), pr.commission, pr.spread, pr.costs, pr.profit, b, x.note || ''];
  });
  S.download('cambios_divisas_' + S.today() + '.csv', S.toCSV(['fecha', 'cliente', 'estado', 'monto_a_cambiar', 'moneda_recibida', 'recibido', 'cuenta_entrada', 'tasa', 'entregado', 'moneda_entregada',
    'cuenta_salida', 'tipo_comision', 'valor_comision', 'comision', 'cobro_comision', 'costos', 'comision_base', 'diferencial_base', 'costos_base', 'ganancia_base', 'moneda_base', 'nota'], rows), 'text/csv');
}
