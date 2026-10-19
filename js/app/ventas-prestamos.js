/* =========================================================================
 * app/ventas-prestamos.js — Ventas y préstamos (tarjeta de cobros/pagos compartida).
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ ventas y préstamos
var payRef = null;   // { kind: 'sale' | 'loan', id } cuyo cobro o pago se registra en la tarjeta compartida
var PERIOD_NAME = { diario: 'día', semanal: 'semana', quincenal: 'quincena', mensual: 'mes', bimestral: '2 meses', trimestral: '3 meses', semestral: '6 meses', anual: 'año' };
var STATUS_TAG = { pagada: '<span class="tag ok">Pagada</span>', parcial: '<span class="tag">Parcial</span>', vencida: '<span class="tag danger">Vencida</span>', pendiente: '<span class="tag">Pendiente</span>' };

/** Abre la tarjeta de cobros (venta) o pagos (préstamo). stay: quedarse en Por cobrar / Por pagar. */
function openRef(kind, id, opts) {
  opts = opts || {};
  var rec = kind === 'sale' ? byId(state.sales, id) : byId(state.loans, id);
  if (!rec) return;
  var home = kind === 'sale' ? 'ventas' : 'prestamos';
  if (!opts.stay && accTab !== home) showView('cuentas/' + home);
  if (accTab === 'cobrar' || accTab === 'pagar') resetDebtForm();
  payFx = null; payRef = { kind: kind, id: id };
  placePayCard(accTab === 'cobrar' || accTab === 'pagar' ? 'acc-panel-deudas' : 'acc-panel-' + accTab);
  $('#pay-form').dataset.debt = '';
  renderThirdParty();
  $('#debt-payments').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function loanTermsText(l) {
  var it = l.interest || {}, per = PERIOD_NAME[l.period] || 'mes';
  var i = it.mode === 'porcentaje' ? fmtNum(it.value, 0, 4) + ' %' + (it.basis === 'total' ? ' en total' : ' por ' + per + (it.method === 'frances' ? ' sobre saldo' : ''))
    : it.mode === 'fijo' ? fmtMoney(it.value, l.currency) + (it.basis === 'total' ? ' en total' : ' por cuota') : 'sin interés';
  return l.installments + (Number(l.installments) === 1 ? ' cuota' : ' cuotas') + ' · cada ' + per + ' · ' + i;
}
function planTable(rows, cur, withStatus) {
  // Compacta para el móvil: la moneda va en el encabezado y las celdas solo llevan el número
  var nm = function (v) { return privacy ? MASK : fmtNum(v, 2, 2); };
  var sd = function (iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0].slice(2); };
  return '<table class="dtable loan-plan-table"><thead><tr><th>#</th><th>Fecha</th><th>Capital</th><th>Interés</th><th>Cuota ' + esc(cur) + '</th>' + (withStatus ? '<th>Estado</th>' : '') + '</tr></thead><tbody>' +
    rows.map(function (r) {
      return '<tr><td>' + r.n + '</td><td>' + sd(r.date) + '</td><td>' + nm(r.capital) + '</td><td>' + nm(r.interest) + '</td><td><b>' + nm(r.total) + '</b></td>' +
        (withStatus ? '<td>' + (r.status === 'parcial' ? '<span class="tag">Falta ' + nm(r.due) + '</span>' : STATUS_TAG[r.status]) + '</td>' : '') + '</tr>';
    }).join('') + '</tbody></table>';
}
function renderRefPayments() {
  var card = $('#debt-payments'), pf = $('#pay-form'), today = S.today();
  var sale = payRef.kind === 'sale', rec = sale ? byId(state.sales, payRef.id) : byId(state.loans, payRef.id);
  var panelOk = accTab === 'cobrar' || accTab === 'pagar' || accTab === (sale ? 'ventas' : 'prestamos');
  if (!rec || !panelOk) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  var cur = rec.currency, html = '', st, inflow, list = (rec.payments || []).slice().sort(function (a, b2) { return a.date < b2.date ? 1 : -1; });
  if (sale) {
    st = C.saleBalance(rec); inflow = true;
    $('#pay-title').textContent = 'Cobro de la venta' + (rec.client ? ' a ' + rec.client : '');
    setPayEdit('sale-edit', rec.id, 'Editar venta');
    html = '<li class="sub pay-note" style="border:0;padding:4px 0 2px">Venta del ' + fmtDate(rec.date) + (rec.concept ? ': ' + esc(rec.concept) : '') + ' · <b>' + fmtMoney(st.total, cur) + '</b>' +
      (rec.mode === 'contado' ? ' · de contado' : rec.dueDate ? ' · vence ' + fmtDate(rec.dueDate) : '') + '</li>' +
      '<li class="sub pay-note" style="border:0;padding:2px 0 8px">Cobrado ' + fmtMoney(st.paid, cur) + ' de ' + fmtMoney(st.total, cur) + ' · pendiente <b>' + fmtMoney(st.pending, cur) + '</b></li>';
  } else {
    st = C.loanStatus(rec, today); inflow = rec.kind !== 'recibido';
    $('#pay-title').textContent = (inflow ? 'Préstamo a ' : 'Préstamo de ') + (rec.person || '');
    setPayEdit('loan-edit', rec.id, 'Editar préstamo');
    html = '<li class="sub pay-note" style="border:0;padding:4px 0 2px">' + (inflow ? 'Prestaste ' : 'Te prestaron ') + '<b>' + fmtMoney(st.principal, cur) + '</b> el ' + fmtDate(rec.date) +
      ' · ' + esc(loanTermsText(rec)) + ' · intereses ' + fmtMoney(st.interest, cur) + ' · total ' + fmtMoney(st.total, cur) + '</li>' +
      '<li class="sub pay-note" style="border:0;padding:2px 0 4px">' + (inflow ? 'Te pagó ' : 'Pagaste ') + fmtMoney(st.paid, cur) + ' de ' + fmtMoney(st.total, cur) +
      ' · pendiente <b>' + fmtMoney(st.pending, cur) + '</b> · capital pendiente ' + fmtMoney(st.capitalPending, cur) +
      (st.overdue > 0 ? ' · <span class="down">vencido ' + fmtMoney(st.overdue, cur) + '</span>' : '') +
      (st.next ? '<br>Próxima: cuota ' + st.next.n + ' de ' + st.rows.length + ' · ' + fmtDate(st.next.date) + ' · <b>' + fmtMoney(st.next.amount, cur) + '</b>' : '') + '</li>' +
      '<li class="plan-wrap"><details class="table-toggle"' + (st.rows.length <= 12 ? ' open' : '') + '><summary>Plan de cuotas (' + st.paidCount + ' de ' + st.rows.length + ' pagadas)</summary>' +
      '<div class="table-wrap">' + planTable(st.rows, cur, true) + '</div></details></li>';
  }
  var pct = st.total > 0 ? Math.min(100, st.paid / st.total * 100) : 0;
  $('#pay-progress').innerHTML = '<span style="width:' + pct + '%"></span>';
  $('#pay-list').innerHTML = html + list.map(function (pm) {
    return '<li><span class="avatar ' + (inflow ? 'in' : 'out') + '">' + icon(inflow ? 'i-in' : 'i-out') + '</span><div class="main"><div class="title">' + fmtMoney(pm.amount, cur) + '</div>' +
      '<div class="sub">' + fmtDate(pm.date) + ' · ' + payAccText(pm, cur) + (pm.note ? ' · ' + esc(pm.note) : '') + '</div></div>' +
      '<div class="row-actions"><button class="mini" data-rcpt="' + (sale ? 'sale' : 'loan') + '|' + rec.id + '|' + pm.id + '" aria-label="Recibo">' + icon('i-doc') + '</button><button class="mini" data-del-ref-pay="' + pm.id + '" aria-label="Eliminar">' + icon('i-x') + '</button></div></li>';
  }).join('');
  setPayTools(sale ? 'sale' : 'loan', rec.id, inflow && st.pending > 0);
  var closed = st.status === 'pagada' || (sale && rec.mode === 'contado');
  pf.classList.toggle('hidden', closed);
  $('#pay-acc-label').textContent = inflow ? 'Entra en' : 'Sale de';
  $('#pay-submit').textContent = sale ? 'Registrar cobro' : inflow ? 'Registrar pago recibido' : 'Registrar pago';
  if (pf.dataset.debt !== payRef.kind + ':' + rec.id) {
    pf.dataset.debt = payRef.kind + ':' + rec.id;
    pf.amount.value = !sale && st.next ? st.next.amount : st.pending; pf.date.value = today; pf.note.value = '';
    fillSelect(pf.accountId, accountsFor(cur, 'Sin cuenta'), (sale ? state.settings.last.saleAccountId : rec.accountId) || '');
    pf.dataset.cur = cur; mixReset(payMix);
  }
}
function refPay(f) {
  var sale = payRef.kind === 'sale', rec = sale ? byId(state.sales, payRef.id) : byId(state.loans, payRef.id);
  if (!rec) return;
  var st = sale ? C.saleBalance(rec) : C.loanStatus(rec, S.today());
  var amt = num(f.amount.value);
  if (!(amt > 0)) { toast('Ingresa un monto mayor a 0'); return; }
  if (amt > st.pending + 0.001) { toast('Supera lo pendiente (' + fmtMoney(st.pending, rec.currency) + ')'); return; }
  if (!f.date.value) { toast('Elige la fecha'); return; }
  var tg = payTarget(f);
  if (tg.error) { toast(tg.error); return; }
  var nid = S.uid();
  rec.payments = (rec.payments || []).concat([withSplits({ id: nid, date: f.date.value, amount: C.round(amt, 2), accountId: tg.accountId, note: f.note.value.trim(), createdAt: Date.now() }, tg)]);
  if (sale) state.settings.last.saleAccountId = tg.accountId;
  invalidateSnapshots(f.date.value);
  f.dataset.debt = '';
  var ns = sale ? C.saleBalance(rec) : C.loanStatus(rec, S.today());
  var interest = 0;
  if (!sale) { var sp = C.loanPaymentSplit(rec); interest = sp.length ? sp[sp.length - 1].interest : 0; }
  toastAction(ns.status === 'pagada' ? (sale ? '¡Venta cobrada!' : '¡Préstamo saldado!') :
    (sale ? 'Cobro registrado' : 'Pago registrado') + (interest > 0 ? ' (intereses ' + fmtMoney(interest, rec.currency) + ')' : '') + ' · pendiente ' + fmtMoney(ns.pending, rec.currency), 'Recibo', function () { openReceipt(sale ? 'sale' : 'loan', rec.id, nid); });
  persist();
}
function deleteRefPay(pid) {
  var rec = payRef && (payRef.kind === 'sale' ? byId(state.sales, payRef.id) : byId(state.loans, payRef.id));
  if (!rec || !confirm('¿Eliminar este registro?')) return;
  var pm = byId(rec.payments || [], pid); if (pm) invalidateSnapshots(pm.date);
  rec.payments = (rec.payments || []).filter(function (x) { return x.id !== pid; });
  $('#pay-form').dataset.debt = ''; persist(); toast('Eliminado');
}

// ---- Ventas
function saleCategoryOptions() {
  var cats = state.categories.filter(function (c) { return c.type === 'ingreso'; });
  var hasVentas = cats.some(function (c) { return Voice.norm(c.name) === 'ventas'; });
  return (hasVentas ? [] : [{ value: '', label: 'Ventas' }]).concat(cats.map(function (c) { return { value: c.id, label: c.name }; }));
}
function ventasCategoryId() {
  var c = state.categories.filter(function (x) { return x.type === 'ingreso' && Voice.norm(x.name) === 'ventas'; })[0];
  if (c) return c.id;
  var n = { id: S.uid(), name: 'Ventas', type: 'ingreso' };
  state.categories.push(n);
  return n.id;
}
function saleMode() { var r = $('#sale-form').querySelector('input[name="mode"]:checked'); return r ? r.value : 'contado'; }
function renderSaleAccounts() {
  var f = $('#sale-form');
  fillSelect(f.accountId, accountsFor(f.currency.value, 'Ninguna (no la registro)'), f.accountId.value || state.settings.last.saleAccountId || '');
  fillSelect(f.downAccountId, accountsFor(f.currency.value, 'Ninguna (no la registro)'), f.downAccountId.value || state.settings.last.saleAccountId || '');
}
function syncSaleForm() {
  var f = $('#sale-form'), credit = saleMode() === 'credito';
  $$('.only-contado', f).forEach(function (el) { el.classList.toggle('hidden', credit); });
  $$('.only-credito', f).forEach(function (el) { el.classList.toggle('hidden', !credit); });
  var existing = f.editId.value ? byId(state.sales, f.editId.value) : null;
  if (existing) $$('.only-credito', f).forEach(function (el) { if (el.querySelector('[name="downPayment"], [name="downAccountId"]')) el.classList.add('hidden'); });
  var q = f.quantity.value.trim() ? num(f.quantity.value) : 1, pr = num(f.unitPrice.value), cur = f.currency.value;
  var total = q > 0 && pr > 0 ? C.round(q * pr, 2) : 0, down = num(f.downPayment.value) || 0;
  $('#sale-preview').innerHTML = total > 0
    ? '<div class="quote-row"><span>Total de la venta</span><b>' + fmtMoney(total, cur) + '</b></div>' +
      (q !== 1 ? '<div class="quote-row muted"><span>' + fmtNum(q, 0, 4) + ' × ' + fmtMoney(pr, cur) + '</span><span></span></div>' : '') +
      (credit ? '<div class="quote-row"><span>Queda por cobrar</span><b>' + fmtMoney(Math.max(0, C.round(total - (existing ? C.saleBalance(Object.assign({}, existing, { amount: total })).paid : down), 2)), cur) + '</b></div>' : '') +
      '<div class="quote-row muted"><span>Cuenta como ingreso</span><span>' + esc(f.categoryId.selectedOptions[0] ? f.categoryId.selectedOptions[0].text : 'Ventas') + ' · ' + fmtDate(f.date.value || S.today()) + '</span></div>'
    : '<span class="muted small">Escribe el precio (y la cantidad si son varias unidades).</span>';
}
function resetSaleForm() {
  var f = $('#sale-form'), last = state.settings.last;
  f.reset(); f.editId.value = '';
  fillSelect(f.currency, currencyOptions(), last.saleCurrency || base());
  fillSelect(f.categoryId, saleCategoryOptions(), last.saleCategoryId || (saleCategoryOptions().filter(function (o) { return o.label === 'Ventas'; })[0] || {}).value || '');
  f.date.value = S.today(); f.quantity.value = '1';
  renderSaleAccounts();
  mixReset(saleMix);
  $('#sale-form-title').textContent = 'Nueva venta';
  $('[data-action="cancel-sale"]').classList.add('hidden');
  $('[data-action="delete-sale"]').classList.add('hidden'); rcptFormBtn('sale', false);
  syncSaleForm();
}
function editSale(id) {
  var sv = byId(state.sales, id); if (!sv) return;
  if (accTab !== 'ventas') showView('cuentas/ventas');
  payRef = null; payFx = null; $('#debt-payments').classList.add('hidden');
  var f = $('#sale-form');
  resetSaleForm();
  f.editId.value = sv.id;
  f.querySelector('input[name="mode"][value="' + (sv.mode === 'credito' ? 'credito' : 'contado') + '"]').checked = true;
  f.client.value = sv.client || ''; f.concept.value = sv.concept || '';
  f.quantity.value = sv.quantity != null ? sv.quantity : 1; f.unitPrice.value = sv.unitPrice != null ? sv.unitPrice : sv.amount;
  fillSelect(f.currency, currencyOptions(), sv.currency); f.currency.disabled = (sv.payments || []).length > 0;
  f.date.value = sv.date; f.dueDate.value = sv.dueDate || ''; f.note.value = sv.note || '';
  fillSelect(f.categoryId, saleCategoryOptions(), sv.categoryId || '');
  renderSaleAccounts(); f.accountId.value = sv.accountId || '';
  mixSet(saleMix, sv.mode === 'contado' ? sv.splits : null);
  $('#sale-form-title').textContent = 'Editar venta';
  $('[data-action="cancel-sale"]').classList.remove('hidden');
  $('[data-action="delete-sale"]').classList.remove('hidden'); rcptFormBtn('sale', true);
  syncSaleForm();
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function onSaleSubmit(e) {
  e.preventDefault();
  var f = e.target, mode = saleMode();
  var q = f.quantity.value.trim() ? num(f.quantity.value) : 1, pr = num(f.unitPrice.value);
  if (!(q > 0)) { toast('Revisa la cantidad'); f.quantity.focus(); return; }
  if (!(pr > 0)) { toast('Escribe el precio'); f.unitPrice.focus(); return; }
  if (!f.date.value) { toast('Elige la fecha'); return; }
  if (mode === 'credito' && !f.client.value.trim()) { toast('Indica a quién le vendiste (para saber quién te debe)'); f.client.focus(); return; }
  var amount = C.round(q * pr, 2), existing = f.editId.value ? byId(state.sales, f.editId.value) : null;
  var paidBefore = existing ? C.sum((existing.payments || []).map(function (p) { return p.amount; })) : 0;
  if (existing && mode === 'contado' && paidBefore > 0) { toast('Esta venta ya tiene cobros registrados: déjala «por cobrar»'); return; }
  if (existing && amount < paidBefore) { toast('El total no puede ser menor a lo ya cobrado (' + fmtMoney(paidBefore, existing.currency) + ')'); return; }
  var down = !existing && mode === 'credito' ? (num(f.downPayment.value) || 0) : 0;
  if (down < 0 || down > amount) { toast('El abono inicial no puede superar el total'); return; }
  var mxS = mode === 'contado' ? mixRead(saleMix) : null;
  if (mxS && mxS.error) { toast(mxS.error); return; }
  var data = { date: f.date.value, client: f.client.value.trim(), concept: f.concept.value.trim(), quantity: C.round(q, 6), unitPrice: C.round(pr, 8),
    amount: amount, currency: existing && (existing.payments || []).length ? existing.currency : f.currency.value,
    categoryId: f.categoryId.value || ventasCategoryId(), mode: mode,
    accountId: mode === 'contado' ? (mxS ? mxS.accountId : (f.accountId.value || null)) : null, splits: mxS ? mxS.splits : null,
    dueDate: mode === 'credito' ? (f.dueDate.value || null) : null, note: f.note.value.trim() };
  invalidateSnapshots(existing && existing.date < data.date ? existing.date : data.date);
  var last = state.settings.last;
  last.saleCurrency = data.currency; last.saleCategoryId = data.categoryId;
  if (mode === 'contado') last.saleAccountId = data.accountId;
  if (existing) { Object.assign(existing, data); toast('Venta actualizada'); }
  else {
    data.id = S.uid(); data.createdAt = Date.now();
    data.payments = down > 0 ? [{ id: S.uid(), date: data.date, amount: C.round(down, 2), accountId: f.downAccountId.value || null, note: 'Abono inicial', createdAt: Date.now() }] : [];
    state.sales.push(data);
    toastAction((mode === 'contado' ? 'Venta de contado: ' : 'Venta por cobrar: ') + fmtMoney(amount, data.currency) + (mode === 'credito' ? ' · queda en «Por cobrar»' : ''),
      'Comprobante', function () { openReceipt('sale', data.id); });
  }
  resetSaleForm();
  persist();
}
function renderSales() {
  if (accTab !== 'ventas') return;
  var b = base(), ym = thisMonth(), today = S.today();
  var inMonth = function (x, m) { return x.date.slice(0, 7) === m; };
  var toB = function (v, c) { var r = C.toBase(v, c, rates()); return isNaN(r) ? 0 : r; };
  var month = state.sales.filter(function (x) { return inMonth(x, ym); });
  var tot = C.sum(month.map(function (x) { return toB(x.amount, x.currency); }));
  var cash = C.sum(month.filter(function (x) { return x.mode === 'contado'; }).map(function (x) { return toB(x.amount, x.currency); }));
  var pendAll = C.sum(state.sales.map(function (x) { var bl = C.saleBalance(x); return toB(bl.pending, x.currency); }));
  $('#sale-month-name').textContent = new Date(ym + '-15T12:00').toLocaleDateString(LOCALE, { month: 'long' });
  $('#sale-total').textContent = fmtMoney(tot, b);
  $('#sale-stats').innerHTML = stat('Ventas', String(month.length)) + stat('De contado', fmtMoney(cash, b)) + stat('A crédito', fmtMoney(C.round(tot - cash, 2), b)) +
    stat('Por cobrar (todas)', '<span class="' + (pendAll > 0 ? 'down' : '') + '">' + fmtMoney(pendAll, b) + '</span>');
  var fm = $('#sale-month').value;
  var list = state.sales.filter(function (x) { return !fm || inMonth(x, fm); })
    .sort(function (a, c) { return a.date < c.date ? 1 : a.date > c.date ? -1 : (c.createdAt || 0) - (a.createdAt || 0); });
  var lt = C.sum(list.map(function (x) { return toB(x.amount, x.currency); }));
  var lp = C.sum(list.map(function (x) { return toB(C.saleBalance(x).pending, x.currency); }));
  $('#sale-totals').innerHTML = '<span>Total <b>' + fmtMoney(lt, b) + '</b></span><span>Por cobrar <b>' + fmtMoney(lp, b) + '</b></span><span>' + list.length + ' venta(s)</span>';
  var editing = $('#sale-form').editId.value;
  $('#sale-list').innerHTML = list.length ? list.map(function (x) {
    var bl = C.saleBalance(x), credit = x.mode === 'credito';
    var overdue = credit && bl.pending > 0 && x.dueDate && x.dueDate < today;
    var tag = !credit ? '<span class="tag ok-soft">Contado</span>' : bl.status === 'pagada' ? '<span class="tag ok">Cobrada</span>'
      : '<span class="tag ' + (overdue ? 'danger' : 'warn') + '">' + (overdue ? 'Vencida · ' : 'Falta cobrar ') + fmtMoney(bl.pending, x.currency) + '</span>';
    var attr = credit ? 'data-pay-ref="sale|' + x.id + '"' : 'data-edit-sale="' + x.id + '"';
    var on = editing === x.id || (payRef && payRef.id === x.id);
    return '<li class="clickable' + (on ? ' editing' : '') + '" ' + attr + ' tabindex="0" role="button">' +
      '<span class="avatar in">' + icon('i-in') + '</span>' +
      '<div class="main"><div class="title">' + esc(x.client || x.concept || 'Venta') + ' ' + tag + '</div>' +
      '<div class="sub">' + fmtDate(x.date) + (x.client && x.concept ? ' · ' + esc(x.concept) : '') + (x.quantity && x.quantity !== 1 ? ' · ' + fmtNum(x.quantity, 0, 4) + ' × ' + fmtMoney(x.unitPrice, x.currency) : '') +
      (credit && x.dueDate && bl.pending > 0 ? ' · vence ' + fmtDate(x.dueDate) : '') + '</div></div>' +
      '<div class="amt up">+' + fmtMoney(x.amount, x.currency) + (x.currency !== b ? '<div class="sub">≈ ' + fmtMoney(toB(x.amount, x.currency), b) + '</div>' : '') + '</div></li>';
  }).join('') : '<li class="empty">Sin ventas en este periodo.</li>';
  renderDebtPayments();
}

// ---- Préstamos
function loanKind() { var r = $('#loan-form').querySelector('input[name="kind"]:checked'); return r ? r.value : 'otorgado'; }
function renderLoanAccounts() {
  var f = $('#loan-form');
  fillSelect(f.accountId, accountsFor(f.currency.value, 'Ninguna (no la registro)'), f.accountId.value || state.settings.last.loanAccountId || '');
}
function loanDraft() {
  var f = $('#loan-form');
  return {
    kind: loanKind(), person: f.person.value.trim(), principal: C.round(num(f.principal.value) || 0, 2), currency: f.currency.value, date: f.date.value || S.today(),
    accountId: f.accountId.value || null, installments: Math.floor(num(f.installments.value) || 0), period: f.period.value, firstDue: f.firstDue.value || null,
    interest: { mode: f.intMode.value, value: f.intMode.value === 'ninguno' ? 0 : C.round(num(f.intValue.value) || 0, 6),
      basis: f.intBasis.value, method: f.intMode.value === 'porcentaje' && f.intBasis.value === 'periodo' ? f.intMethod.value : 'simple' },
    note: f.note.value.trim()
  };
}
function syncLoanForm() {
  var f = $('#loan-form'), give = loanKind() === 'otorgado', mode = f.intMode.value;
  $('#loan-person-label').textContent = give ? '¿A quién le prestaste?' : '¿Quién te prestó?';
  $('#loan-acc-label').textContent = give ? 'Sale de' : 'Entra en';
  $$('.int-only', f).forEach(function (el) { el.classList.toggle('hidden', mode === 'ninguno'); });
  $('.int-method', f).classList.toggle('hidden', !(mode === 'porcentaje' && f.intBasis.value === 'periodo'));
  $('#loan-int-label').textContent = mode === 'fijo' ? 'Monto (' + f.currency.value + ')' : 'Porcentaje (%)';
  var d = loanDraft(), cur = d.currency;
  $('#loan-first-hint').textContent = '(vacío = ' + fmtDate(C.addPeriod(d.date, d.period, 1)) + ')';
  if (!(d.principal > 0) || !(d.installments >= 1)) {
    $('#loan-quote').innerHTML = '<span class="muted small">Escribe el monto y el número de cuotas para ver el plan.</span>'; $('#loan-plan').innerHTML = ''; return;
  }
  var sc = C.loanSchedule(d), r = sc.rows, same = r.every(function (x) { return x.total === r[0].total; });
  $('#loan-quote').innerHTML =
    '<div class="quote-row"><span>' + r.length + (r.length === 1 ? ' cuota' : ' cuotas') + ' · cada ' + (PERIOD_NAME[d.period] || 'mes') + '</span><b>' +
      (same || r.length === 1 ? fmtMoney(r[0].total, cur) : fmtMoney(r[0].total, cur) + ' … ' + fmtMoney(r[r.length - 1].total, cur)) + '</b></div>' +
    '<div class="quote-row muted"><span>Primera cuota · última</span><span>' + fmtDate(r[0].date) + ' · ' + fmtDate(r[r.length - 1].date) + '</span></div>' +
    '<div class="quote-row"><span>Intereses</span><b class="' + (sc.interest > 0 ? (give ? 'up' : 'down') : '') + '">' + fmtMoney(sc.interest, cur) + '</b></div>' +
    '<div class="quote-row"><span>' + (give ? 'Te devolverán en total' : 'Devolverás en total') + '</span><b>' + fmtMoney(sc.total, cur) + '</b></div>';
  $('#loan-plan').innerHTML = planTable(r, cur, false);
}
function resetLoanForm() {
  var f = $('#loan-form'), last = state.settings.last;
  f.reset(); f.editId.value = '';
  fillSelect(f.currency, currencyOptions(), last.loanCurrency || base());
  f.currency.disabled = false;
  f.date.value = S.today(); f.installments.value = '1'; f.period.value = 'mensual';
  renderLoanAccounts();
  mixReset(loanMix);
  $('#loan-form-title').textContent = 'Nuevo préstamo';
  $('#loan-edit-hint').classList.add('hidden');
  $('[data-action="cancel-loan"]').classList.add('hidden');
  $('[data-action="delete-loan"]').classList.add('hidden'); rcptFormBtn('loan', false);
  syncLoanForm();
}
function editLoan(id) {
  var l = byId(state.loans, id); if (!l) return;
  if (accTab !== 'prestamos') showView('cuentas/prestamos');
  payRef = null; payFx = null; $('#debt-payments').classList.add('hidden');
  var f = $('#loan-form');
  resetLoanForm();
  f.editId.value = l.id;
  f.querySelector('input[name="kind"][value="' + (l.kind === 'recibido' ? 'recibido' : 'otorgado') + '"]').checked = true;
  f.person.value = l.person || ''; f.principal.value = l.principal;
  fillSelect(f.currency, currencyOptions(), l.currency); f.currency.disabled = (l.payments || []).length > 0;
  f.date.value = l.date; renderLoanAccounts(); f.accountId.value = l.accountId || '';
  mixSet(loanMix, l.splits);
  var it = l.interest || {};
  f.intMode.value = it.mode || 'ninguno'; f.intValue.value = it.value || ''; f.intBasis.value = it.basis || 'periodo'; f.intMethod.value = it.method || 'simple';
  f.installments.value = l.installments; f.period.value = l.period || 'mensual'; f.firstDue.value = l.firstDue || ''; f.note.value = l.note || '';
  $('#loan-form-title').textContent = 'Editar préstamo';
  var np = (l.payments || []).length, hint = $('#loan-edit-hint');
  hint.textContent = np ? 'Tiene ' + np + (np === 1 ? ' pago registrado: se conserva y se aplica' : ' pagos registrados: se conservan y se aplican') + ' al plan con los datos nuevos.'
    : 'Corrige lo que necesites y pulsa Guardar: el plan de cuotas se recalcula.';
  hint.classList.remove('hidden');
  $('[data-action="cancel-loan"]').classList.remove('hidden');
  $('[data-action="delete-loan"]').classList.remove('hidden'); rcptFormBtn('loan', true);
  syncLoanForm();
  renderLoans();
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function onLoanSubmit(e) {
  e.preventDefault();
  var f = e.target, d = loanDraft();
  if (!d.person) { toast(d.kind === 'otorgado' ? 'Indica a quién le prestaste' : 'Indica quién te prestó'); f.person.focus(); return; }
  if (!(d.principal > 0)) { toast('Escribe el monto prestado'); f.principal.focus(); return; }
  if (!(d.installments >= 1 && d.installments <= 600)) { toast('El número de cuotas debe estar entre 1 y 600'); f.installments.focus(); return; }
  if (d.interest.mode !== 'ninguno' && !(d.interest.value > 0)) { toast('Escribe el ' + (d.interest.mode === 'fijo' ? 'monto' : 'porcentaje') + ' de interés o elige «Sin interés»'); f.intValue.focus(); return; }
  if (d.firstDue && d.firstDue < d.date) { toast('La primera cuota no puede ser antes de la fecha del préstamo'); return; }
  var mxL = mixRead(loanMix);
  if (mxL && mxL.error) { toast(mxL.error); return; }
  if (mxL) d.accountId = mxL.accountId;
  d.splits = mxL ? mxL.splits : null;   // capital repartido entre varias cuentas
  var existing = f.editId.value ? byId(state.loans, f.editId.value) : null;
  if (existing) {
    var paid = C.sum((existing.payments || []).map(function (p) { return p.amount; }));
    var newTotal = C.loanSchedule(d).total;
    if (paid > newTotal + 0.001) { toast('Ya se pagó ' + fmtMoney(paid, existing.currency) + ', más que el nuevo total'); return; }
    if (existing.payments && existing.payments.length) d.currency = existing.currency;
  }
  invalidateSnapshots(existing && existing.date < d.date ? existing.date : d.date);
  var last = state.settings.last;
  last.loanCurrency = d.currency; last.loanAccountId = d.accountId;
  if (existing) { Object.assign(existing, d); toast('Préstamo actualizado'); }
  else {
    d.id = S.uid(); d.createdAt = Date.now(); d.payments = [];
    state.loans.push(d);
    var sc = C.loanSchedule(d);
    toastAction('Préstamo guardado · ' + sc.rows.length + ' cuota(s) · total ' + fmtMoney(sc.total, d.currency), 'Comprobante', function () { openReceipt('loan', d.id); });
  }
  resetLoanForm();
  persist();
}
function renderLoans() {
  if (accTab !== 'prestamos') return;
  var b = base(), today = S.today(), yr = today.slice(0, 4);
  var toB = function (v, c) { var r = C.toBase(v, c, rates()); return isNaN(r) ? 0 : r; };
  var all = state.loans.map(function (l) { return { l: l, st: C.loanStatus(l, today) }; });
  var give = all.filter(function (x) { return x.l.kind !== 'recibido'; }), owe = all.filter(function (x) { return x.l.kind === 'recibido'; });
  var capOf = function (list) { return C.sum(list.map(function (x) { return toB(x.st.capitalPending, x.l.currency); })); };
  var intYear = function (list) {
    return C.sum(list.map(function (x) { return C.sum(C.loanPaymentSplit(x.l).filter(function (s) { return s.payment.date.slice(0, 4) === yr; }).map(function (s) { return toB(s.interest, x.l.currency); })); }));
  };
  var overdue = C.sum(all.map(function (x) { return toB(x.st.overdue, x.l.currency); }));
  $('#loan-total').textContent = fmtMoney(capOf(give), b);
  $('#loan-stats').innerHTML = stat('Debes (capital)', fmtMoney(capOf(owe), b)) + stat('Intereses cobrados ' + yr, '<span class="up">' + fmtMoney(intYear(give), b) + '</span>') +
    stat('Intereses pagados ' + yr, fmtMoney(intYear(owe), b)) + stat('Vencido', '<span class="' + (overdue > 0 ? 'down' : '') + '">' + fmtMoney(overdue, b) + '</span>');
  var filter = document.querySelector('input[name="loan-filter"]:checked').value;
  var list = all.filter(function (x) { return filter === 'all' || (filter === 'paid' ? x.st.status === 'pagada' : x.st.status !== 'pagada'); })
    .sort(function (a, c) { return (a.st.next ? a.st.next.date : '9999') < (c.st.next ? c.st.next.date : '9999') ? -1 : 1; });
  $('#loan-list').innerHTML = list.length ? list.map(function (x) {
    var l = x.l, st = x.st, gv = l.kind !== 'recibido';
    var tag = st.status === 'pagada' ? '<span class="tag ok">Pagado</span>' : st.overdue > 0 ? '<span class="tag danger">Vencido ' + fmtMoney(st.overdue, l.currency) + '</span>'
      : st.next && st.next.date <= C.addDays(today, 7) ? '<span class="tag warn">Cuota el ' + fmtDate(st.next.date) + '</span>' : '';
    var on = (!!payRef && payRef.id === l.id) || $('#loan-form').editId.value === l.id;
    return '<li class="clickable' + (on ? ' editing' : '') + '" data-pay-ref="loan|' + l.id + '" tabindex="0" role="button">' +
      '<span class="avatar ' + (gv ? 'out' : 'in') + '">' + initials(l.person) + '</span>' +
      '<div class="main"><div class="title">' + esc(l.person || 'Sin nombre') + ' <span class="tag info">' + (gv ? 'Presté' : 'Me prestaron') + '</span> ' + tag + '</div>' +
      '<div class="sub">' + fmtMoney(st.principal, l.currency) + ' · ' + esc(loanTermsText(l)) + (st.next ? ' · cuota ' + st.next.n + ' de ' + st.rows.length + ' el ' + fmtDate(st.next.date) + ' por ' + fmtMoney(st.next.amount, l.currency) : '') + '</div></div>' +
      '<div class="amt">' + fmtMoney(st.status === 'pagada' ? st.total : st.pending, l.currency) + '<div class="sub">' + (st.status === 'pagada' ? 'total' : 'pendiente') + '</div></div></li>';
  }).join('') : '<li class="empty">' + (filter === 'open' ? 'No hay préstamos activos. Registra uno abajo.' : 'Sin registros.') + '</li>';
  renderDebtPayments();
}
