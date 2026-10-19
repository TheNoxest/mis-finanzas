/* =========================================================================
 * app/movimientos.js — Movimientos (ingresos, gastos, transferencias) e historial completo.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ movimientos
function sortedTx() {
  return state.transactions.slice().sort(function (a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0);
  });
}

function txItem(t, withActions) {
  var b = base(), right, title, sub, av;
  if (t.type === 'transferencia') {
    av = '<span class="avatar tr">' + icon('i-swap') + '</span>';
    title = 'Transferencia';
    sub = fmtDate(t.date) + ' · ' + esc(accName(t.fromAccountId)) + ' → ' + esc(accName(t.toAccountId));
    var fee = C.transferFee(t);
    right = fmtMoney(t.amount, t.currency) +
      (t.toCurrency && (t.toCurrency !== t.currency || fee) ? '<div class="sub">→ ' + fmtMoney(t.toAmount, t.toCurrency) + '</div>' : '') +
      (fee ? '<div class="sub">' + (fee > 0 ? 'comisión −' : 'extra +') + fmtMoney(Math.abs(fee), t.toCurrency) + '</div>' : '');
  } else {
    var isIn = t.type === 'ingreso';
    av = '<span class="avatar ' + (isIn ? 'in' : 'out') + '">' + icon(isIn ? 'i-in' : 'i-out') + '</span>';
    title = esc(catName(t.categoryId));
    var m = methodName(t.methodId);
    sub = fmtDate(t.date) + ' · ' + (t.splits && t.splits.length > 1 ? payAccText(t, t.currency) : esc(accName(t.accountId))) + (m ? ' · ' + esc(m) : '');
    right = '<span class="' + (isIn ? 'up' : '') + '">' + (isIn ? '+' : '−') + fmtMoney(t.amount, t.currency) + '</span>' +
      (t.currency !== b ? '<div class="sub">≈ ' + fmtMoney(C.toBase(t.amount, t.currency, rates()), b) + '</div>' : '');
  }
  if (t.note) sub += ' · ' + esc(t.note);
  // Toda la fila es editable (sin botones que compitan por espacio en móvil)
  var editing = $('#tx-form').editId.value === t.id;
  return '<li class="clickable' + (editing ? ' editing' : '') + '" data-edit-tx="' + t.id + '" tabindex="0" role="button" aria-label="Editar movimiento">' + av +
    '<div class="main"><div class="title">' + title + '</div><div class="sub">' + sub + '</div></div>' +
    '<div class="amt">' + right + '</div></li>';
}

// ================================================================ historial completo (todas las operaciones)
var LG_KIND = {
  ingreso: ['Ingreso', 'i-in', 'in'], egreso: ['Gasto', 'i-out', 'out'], transferencia: ['Transferencia', 'i-swap', 'tr'],
  compra: ['Compra de inversión', 'i-chart', 'out'], venta_inv: ['Venta de inversión', 'i-chart', 'in'],
  cambio: ['Cambio', 'i-swap', 'tr'], cobro_cambio: ['Cobro de cambio', 'i-in', 'in'], entrega_cambio: ['Entrega de cambio', 'i-out', 'out'],
  venta: ['Venta', 'i-in', 'in'], cobro_venta: ['Cobro de venta', 'i-in', 'in'],
  prestamo_dado: ['Préstamo dado', 'i-out', 'out'], prestamo_recibido: ['Préstamo recibido', 'i-in', 'in'],
  cobro_prestamo: ['Pago recibido de préstamo', 'i-in', 'in'], pago_prestamo: ['Pago de préstamo', 'i-out', 'out'],
  deuda_cobrar: ['Por cobrar (deuda)', 'i-doc', 'tr'], deuda_pagar: ['Por pagar (deuda)', 'i-doc', 'tr'],
  abono_recibido: ['Abono recibido', 'i-in', 'in'], abono_pagado: ['Abono pagado', 'i-out', 'out']
};
var LG_ISSUE = { duplicado: 'Posible duplicado', sin_cuenta: 'No mueve ninguna cuenta', cuenta_borrada: 'Cuenta eliminada',
  misma_cuenta: 'Transferencia a la misma cuenta', moneda: 'Moneda distinta a la de la cuenta', futuro: 'Fecha futura', cero: 'Monto cero',
  cuenta_distinta: 'Cuenta distinta a la del cambio' };
var LG_STATUS = { falta_cobrar: ['warn', 'Falta cobrar'], falta_entregar: ['warn', 'Falta entregar'], por_cobrar: ['warn', 'Por cobrar'],
  cobrada: ['ok', 'Cobrada'], contado: ['ok-soft', 'Contado'], activo: ['', 'Activo'], pagado: ['ok', 'Pagado'], pendiente: ['warn', 'Pendiente'], saldada: ['ok', 'Saldada'] };
var lgLimit = 200;
function histScope() { var r = document.querySelector('input[name="hist-scope"]:checked'); return r ? r.value : 'tx'; }
function lgConcept(r) {
  var e = r.extra || {};
  if (r.kind === 'ingreso' || r.kind === 'egreso') return catName(r.categoryId);
  if (r.kind === 'transferencia') return accName(e.from) + ' → ' + accName(e.to) + (e.toCurrency && e.toCurrency !== r.currency ? ' (' + fmtMoney(e.toAmount, e.toCurrency) + ')' : '');
  if (r.kind === 'compra' || r.kind === 'venta_inv') return r.concept + ' · ' + fmtNum(e.quantity) + ' × ' + fmtPrice(e.price, r.currency);
  if (r.kind === 'cambio') return fmtMoney(e.received, e.inCurrency) + ' → ' + fmtMoney(e.delivered, e.outCurrency) + ' · ganancia ' + fmtSigned(e.profit, base());
  if ((r.kind === 'cobro_prestamo' || r.kind === 'pago_prestamo') && e.interest > 0) return 'incluye intereses ' + fmtMoney(e.interest, r.currency);
  return r.concept || '';
}
function lgNames(r) { return [LG_KIND[r.kind] ? LG_KIND[r.kind][0] : r.kind, lgConcept(r), r.parts.map(function (p) { return accName(p.accountId); }).join(' '), r.currency].join(' '); }
function lgPartsText(r) {
  if (!r.parts.length) {
    var why = r.kind === 'venta' ? 'A crédito: el dinero entra con cada cobro'
      : r.kind === 'cambio' && r.status ? 'El dinero se mueve con cada cobro o entrega'
      : r.kind === 'deuda_cobrar' || r.kind === 'deuda_pagar' ? 'Solo registro: no salió ni entró dinero al crearla'
      : 'No mueve ninguna cuenta';
    return '<span class="muted">' + why + '</span>';
  }
  return r.parts.map(function (p) {
    var a = account(p.accountId);
    return esc(a ? a.name : 'Cuenta eliminada') + ' <b class="' + trend(p.amount) + '">' + (p.amount > 0 ? '+' : '−') + fmtMoney(Math.abs(p.amount), a ? a.currency : r.currency) + '</b>';
  }).join(' · ');
}
function lgRowHtml(r, issues, showDate) {
  var k = LG_KIND[r.kind] || [r.kind, 'i-doc', 'tr'], st = r.status && LG_STATUS[r.status];
  var neutral = r.kind === 'transferencia' || r.kind === 'cambio' || !r.parts.length;
  var amt = neutral ? '<span class="muted">' + fmtMoney(r.amount, r.currency) + '</span>'
    : '<span class="' + trend(r.netBase) + '">' + (r.netBase > 0 ? '+' : r.netBase < 0 ? '−' : '') + fmtMoney(r.amount, r.currency) + '</span>';
  var ref = r.ref.kind + '|' + r.ref.id + '|' + (r.ref.pay || '');
  var concept = lgConcept(r), note = r.note && r.note !== concept ? r.note : '';
  return '<li class="clickable lg-row' + (issues.length ? ' has-issue' : '') + '" data-lg="' + esc(ref) + '" tabindex="0" role="button">' +
    '<span class="avatar ' + k[2] + '">' + icon(k[1]) + '</span>' +
    '<div class="main"><div class="title">' + esc(k[0]) + (r.person ? ' · ' + esc(r.person) : '') + (st ? ' <span class="tag ' + st[0] + '">' + st[1] + '</span>' : '') + '</div>' +
    (concept || note ? '<div class="sub">' + esc(concept) + (concept && note ? ' · ' : '') + esc(note) + '</div>' : '') +
    '<div class="sub lg-acc">' + lgPartsText(r) + '</div>' +
    (issues.length ? '<div class="lg-flags">' + issues.map(function (c) { return '<span class="tag danger">⚠ ' + esc(LG_ISSUE[c] || c) + '</span>'; }).join('') + '</div>' : '') +
    '</div><div class="amt">' + amt + (showDate ? '<div class="sub">' + fmtDate(r.date) + '</div>' : '') + '</div></li>';
}
function ledgerView() {
  var rows = C.ledger(state), issues = C.ledgerIssues(rows, state, S.today());
  var ym = $('#lg-month').value, r = ym ? monthRange(ym) : {};
  var opts = { from: r.from, to: r.to, group: $('#lg-group').value, accountId: $('#lg-account').value, q: $('#lg-q').value, issues: issues };
  var base0 = C.ledgerFilter(rows, opts, lgNames);
  var withIssues = base0.filter(function (x) { return issues[x.key] && issues[x.key].length; });
  var list = $('#lg-issues').checked ? withIssues : base0;
  return { list: C.ledgerSort(list, $('#lg-sort').value), issues: issues, issueCount: withIssues.length, allIssues: Object.keys(issues).length };
}
function renderLedger() {
  var b = base(), v = ledgerView(), sort = $('#lg-sort').value, byDay = sort === 'fecha' || sort === 'fecha_asc';
  fillSelect($('#lg-account'), [{ value: '', label: 'Todas las cuentas' }].concat(state.accounts.map(function (a) { return { value: a.id, label: a.name + ' · ' + a.currency }; })));
  $('#lg-issues-label').textContent = 'Solo con avisos (' + v.issueCount + (v.allIssues !== v.issueCount ? ' aquí · ' + v.allIssues + ' en total' : '') + ')';
  var inflow = C.sum(v.list.map(function (x) { return x.netBase > 0 ? x.netBase : 0; })), outflow = C.sum(v.list.map(function (x) { return x.netBase < 0 ? -x.netBase : 0; }));
  $('#lg-totals').innerHTML = '<span>' + v.list.length + ' operación(es)</span><span>Entró a cuentas <b class="up">+' + fmtMoney(inflow, b) + '</b></span>' +
    '<span>Salió <b>−' + fmtMoney(outflow, b) + '</b></span><span>Neto <b class="' + trend(inflow - outflow) + '">' + fmtSigned(C.round(inflow - outflow, 2), b) + '</b></span>' +
    (v.issueCount ? '<span class="down">⚠ ' + v.issueCount + ' con avisos</span>' : '');
  var shown = v.list.slice(0, lgLimit), html = '', day = null;
  shown.forEach(function (x) {
    if (byDay && x.date !== day) {
      day = x.date;
      var net = C.sum(v.list.filter(function (y) { return y.date === day; }).map(function (y) { return y.netBase; }));
      html += '<li class="lg-day"><span>' + esc(new Date(day + 'T12:00').toLocaleDateString(LOCALE, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })) +
        '</span><span class="' + trend(net) + '">' + (net ? fmtSigned(net, b) : '') + '</span></li>';
    }
    html += lgRowHtml(x, v.issues[x.key] || [], !byDay);
  });
  $('#lg-list').innerHTML = html || '<li class="empty">No hay operaciones con estos filtros.</li>';
  $('#lg-more').classList.toggle('hidden', v.list.length <= lgLimit);
  $('#lg-more').textContent = 'Ver más (' + (v.list.length - lgLimit) + ' restantes)';
}
function openLedgerRow(kind, id, pay) {
  if (kind === 'tx') editTx(id);
  else if (kind === 'inv') { showView('inversiones'); editInv(id); }
  else if (kind === 'fx') { var x = byId(state.exchanges, id), st = x && C.exchangeSettlement(x); if (pay || (st && st.status !== 'pagada')) openFxSettle(id); else editFx(id); }
  else if (kind === 'sale') { var sv = byId(state.sales, id); if (pay || (sv && sv.mode === 'credito')) openRef('sale', id); else editSale(id); }
  else if (kind === 'loan') openRef('loan', id);
  else if (kind === 'debt') editDebt(id);
}
function exportLedgerCSV() {
  var v = ledgerView();
  var rows = v.list.map(function (x) {
    return [x.date, (LG_KIND[x.kind] || [x.kind])[0], x.person, lgConcept(x), x.note, x.amount, x.currency,
      x.parts.map(function (p) { return accName(p.accountId) + ' ' + p.amount; }).join(' | '), x.netBase,
      x.status && LG_STATUS[x.status] ? LG_STATUS[x.status][1] : '', (v.issues[x.key] || []).map(function (c) { return LG_ISSUE[c] || c; }).join(' | ')];
  });
  S.download('historial_' + S.today() + '.csv', S.toCSV(['fecha', 'tipo', 'cliente', 'concepto', 'nota', 'monto', 'moneda', 'cuentas', 'neto_' + base(), 'estado', 'avisos'], rows), 'text/csv');
}

function renderTxList() {
  var all = histScope() === 'all';
  $('#hist-all').classList.toggle('hidden', !all);
  $('#hist-tx').classList.toggle('hidden', all);
  if (all) { renderLedger(); return; }
  var ym = $('#f-month').value, type = $('#f-type').value, acc = $('#f-account').value;
  var range = ym ? monthRange(ym) : {};
  var list = sortedTx().filter(function (t) {
    if (type && t.type !== type) return false;
    if (ym && (t.date < range.from || t.date > range.to)) return false;
    if (acc && t.accountId !== acc && t.fromAccountId !== acc && t.toAccountId !== acc && !(t.splits || []).some(function (s) { return s.accountId === acc; })) return false;
    return true;
  });
  var s = C.summarizeTransactions(list, rates(), { accountId: acc || null });   // con cuenta: solo su parte de los gastos mixtos
  var b = base();
  $('#tx-totals').innerHTML =
    '<span>Ingresos <b class="up">+' + fmtMoney(s.income, b) + '</b></span>' +
    '<span>Gastos <b>−' + fmtMoney(s.expense, b) + '</b></span>' +
    '<span>Neto <b class="' + trend(s.net) + '">' + fmtSigned(s.net, b) + '</b></span>' +
    '<span>' + list.length + ' movimiento(s)</span>';
  $('#tx-list').innerHTML = list.length ? list.map(function (t) { return txItem(t, true); }).join('')
    : '<li class="empty">No hay movimientos con estos filtros.</li>';
}

/** Muestra/oculta campos según el tipo y actualiza la moneda visible. */
function syncTxForm() {
  var f = $('#tx-form');
  var isTr = f.type.value === 'transferencia';
  $$('.only-flow', f).forEach(function (el) { el.classList.toggle('hidden', isTr); });
  $$('.only-transfer', f).forEach(function (el) { el.classList.toggle('hidden', !isTr); });
  var from = account(isTr ? f.fromAccountId.value : f.accountId.value);
  var to = account(f.toAccountId.value);
  $('#tx-cur').textContent = from ? from.currency : '';
  // «Monto recibido» siempre en transferencias: entre monedas distintas para la tasa real,
  // y en la misma moneda (o USDT ↔ USD) para anotar la comisión si llegó menos.
  var fx = isTr && from && to && from.id !== to.id;
  var peg = fx && C.samePeg(from.currency, to.currency);
  $('.only-fx', f).classList.toggle('hidden', !fx);
  $('#to-cur').textContent = to ? '(' + to.currency + ')' + (peg ? ' · opcional' : '') : '';
  $('#tx-submit').textContent = f.editId.value ? 'Actualizar' : isTr ? 'Transferir' : f.type.value === 'ingreso' ? 'Guardar ingreso' : 'Guardar gasto';

  // Vista previa: conversión a la moneda base o estimación de la transferencia
  var amt = parseAmount(f.amount.value), txt = '';
  f.toAmount.placeholder = amt > 0 && fx ? String(C.convert(amt, from.currency, to.currency, rates())) : '';
  if (amt > 0 && from) {
    if (peg) {
      var got = parseAmount(f.toAmount.value), fee = C.round(amt - got, 2);
      var same = from.currency === to.currency ? '' : '1 ' + from.currency + ' = 1 ' + to.currency + '. ';
      if (!(got > 0)) txt = same + 'Llegan ' + fmtMoney(amt, to.currency) + '. Si te cobraron comisión, escribe en «Monto recibido» lo que realmente llegó.';
      else if (fee > 0) txt = same + 'Comisión: ' + fmtMoney(fee, to.currency) + ' — se cuenta como gasto en «Comisiones de transferencia».';
      else if (fee < 0) txt = same + 'Llegó ' + fmtMoney(-fee, to.currency) + ' más de lo enviado — se cuenta como ingreso.';
      else txt = same + 'Sin comisión.';
    } else if (fx) {
      var est = C.convert(amt, from.currency, to.currency, rates());
      txt = 'Si lo dejas vacío se usará la tasa actual: ' + fmtMoney(est, to.currency) + '. Escribe lo que realmente llegó.';
    } else if (!isTr && from.currency !== base()) {
      txt = '≈ ' + fmtMoney(C.toBase(amt, from.currency, rates()), base()) + ' (tasa ' + fmtNum(rates()[from.currency], 0, 10) + ')';
    }
    if (isTr && from.id === (to && to.id)) txt = 'Elige dos cuentas distintas.';
  }
  $('#tx-preview').textContent = txt;
}

function resetTxForm() {
  var f = $('#tx-form');
  f.editId.value = ''; f.amount.value = ''; f.note.value = ''; f.toAmount.value = '';
  mixReset(txMix);
  f.date.value = S.today();
  $('[data-action="cancel-tx"]').classList.add('hidden');
  $('[data-action="delete-tx"]').classList.add('hidden');
  syncTxForm();
  renderTxList();
}

function onTxSubmit(e) {
  e.preventDefault();
  var f = e.target;
  var amount = parseAmount(f.amount.value);
  var type = f.type.value;
  if (!(amount > 0)) { toast('Ingresa un monto mayor a 0'); f.amount.focus(); return; }
  if (!f.date.value) { toast('Elige una fecha'); return; }
  if (!state.accounts.length) { toast('Primero crea una cuenta'); showView('cuentas'); return; }

  var data;
  if (type === 'transferencia') {
    var from = account(f.fromAccountId.value), to = account(f.toAccountId.value);
    if (!from || !to || from.id === to.id) { toast('Elige dos cuentas distintas'); return; }
    // Vacío → lo mismo (misma moneda o USDT = USD) o la tasa actual; escrito → lo que realmente llegó
    var toAmount = parseAmount(f.toAmount.value);
    if (f.toAmount.value.trim() && !(toAmount > 0)) { toast('Revisa el monto recibido'); f.toAmount.focus(); return; }
    if (!(toAmount > 0)) toAmount = C.convert(amount, from.currency, to.currency, rates());
    if (!(toAmount > 0)) { toast('Indica el monto recibido en ' + to.currency); return; }
    if (C.samePeg(from.currency, to.currency) && toAmount > amount * 1.5 && !confirm('Llegan ' + fmtMoney(toAmount, to.currency) + ' pero enviaste ' + fmtMoney(amount, from.currency) + '. ¿Es correcto?')) return;
    data = { type: type, date: f.date.value, amount: C.round(amount, 2), currency: from.currency,
      fromAccountId: from.id, toAccountId: to.id, toAmount: C.round(toAmount, 2), toCurrency: to.currency, note: f.note.value.trim() };
    state.settings.last.fromAccountId = from.id; state.settings.last.toAccountId = to.id;
  } else {
    var mxT = mixRead(txMix);
    if (mxT && mxT.error) { toast(mxT.error); return; }
    var acc = account(mxT ? mxT.accountId : f.accountId.value);
    if (!acc) { toast('Elige una cuenta'); return; }
    if (!f.categoryId.value) { toast('Crea una categoría primero (Ajustes)'); return; }
    data = { type: type, date: f.date.value, amount: C.round(amount, 2), currency: acc.currency, accountId: acc.id,
      categoryId: f.categoryId.value, methodId: f.methodId.value, note: f.note.value.trim() };
    if (mxT && mxT.splits) data.splits = mxT.splits;   // gasto o ingreso repartido entre varias cuentas
    var last = state.settings.last;
    last.accountId = acc.id; last.methodId = data.methodId; last['cat_' + type] = data.categoryId;
  }

  var prevTx = f.editId.value ? byId(state.transactions, f.editId.value) : null;
  invalidateSnapshots(prevTx && prevTx.date < data.date ? prevTx.date : data.date);
  if (f.editId.value) {
    var t = byId(state.transactions, f.editId.value);
    // Limpiar campos del tipo anterior antes de asignar los nuevos
    ['accountId', 'categoryId', 'methodId', 'fromAccountId', 'toAccountId', 'toAmount', 'toCurrency', 'splits'].forEach(function (k) { delete t[k]; });
    Object.assign(t, data);
    toast('Movimiento actualizado');
  } else {
    data.id = S.uid(); data.createdAt = Date.now();
    state.transactions.push(data);
    var trFee = C.transferFee(data);
    toast(type === 'transferencia' ? 'Transferencia registrada' + (trFee > 0 ? ' · comisión ' + fmtMoney(trFee, data.toCurrency) : '') :
      (type === 'ingreso' ? 'Ingreso' : 'Gasto') + ' guardado: ' + fmtMoney(data.amount, data.currency));
  }
  resetTxForm();
  persist();
  if (window.matchMedia('(pointer: fine)').matches) f.amount.focus();
}

function editTx(id) {
  var t = byId(state.transactions, id); if (!t) return;
  showView('movimientos');
  var f = $('#tx-form');
  f.type.value = t.type;
  renderCategorySelect();
  f.editId.value = t.id; f.amount.value = t.amount; f.date.value = t.date; f.note.value = t.note || '';
  if (t.type === 'transferencia') {
    f.fromAccountId.value = t.fromAccountId; f.toAccountId.value = t.toAccountId;
    f.toAmount.value = t.toCurrency !== t.currency || C.transferFee(t) ? t.toAmount : '';
    mixReset(txMix);
  } else {
    f.accountId.value = t.accountId; f.categoryId.value = t.categoryId; f.methodId.value = t.methodId || '';
    mixSet(txMix, t.splits);
  }
  $('[data-action="cancel-tx"]').classList.remove('hidden');
  $('[data-action="delete-tx"]').classList.remove('hidden');
  syncTxForm();
  renderTxList();
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  f.amount.focus({ preventScroll: true });
}
