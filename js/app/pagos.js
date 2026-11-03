/* =========================================================================
 * app/pagos.js — Historial de cobros y pagos (Movimientos → «Cobros y pagos») y la ventana para editar
 * un pago desde cualquier lugar (botón ✎). Cálculos en Calc.paymentRows / paymentFilter.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

var pgLimit = 150;
var PG_SECTION = { cambio: 'Cambio', intermediacion: 'Intermediación', venta: 'Venta', prestamo: 'Préstamo', deuda: 'Deuda' };
var PG_CREATION = { cambio: ['Recibido en el cambio', 'Entregado en el cambio'], venta: ['Venta de contado', ''], prestamo_dado: ['', 'Préstamo entregado'],
  prestamo_recibido: ['Préstamo recibido', ''], deuda_cobrar: ['', 'Dinero prestado (deuda)'], deuda_pagar: ['Dinero recibido (deuda)', ''] };

function pgFilters() {
  return { from: $('#pg-from').value, to: $('#pg-to').value, person: $('#pg-person').value.trim(), section: $('#pg-section').value, dir: $('#pg-dir').value,
    accountId: $('#pg-account').value, min: $('#pg-min').value.trim() === '' ? '' : num($('#pg-min').value), max: $('#pg-max').value.trim() === '' ? '' : num($('#pg-max').value) };
}
function pgView() {
  var rows = C.paymentRows(C.ledger(state), $('#pg-created').checked);
  return C.ledgerSort(C.paymentFilter(rows, pgFilters()), $('#pg-sort').value);
}
function pgTitle(r) {
  if (r.atCreation) { var c = PG_CREATION[r.kind]; return (c && c[r.dir === 'in' ? 0 : 1]) || (LG_KIND[r.kind] || [r.kind])[0]; }
  return (LG_KIND[r.kind] || [r.kind])[0];
}
/** «Pedro → Banco Bs (VES 3,650.00)» si entra; «Zelle → Pedro» si sale. */
function pgFlow(r) {
  var who = '<b>' + esc(r.person || 'Cliente') + '</b>';
  var accs = r.parts.length ? r.parts.map(function (p) {
    var a = account(p.accountId), cur = p.currency || (a ? a.currency : r.currency);
    return '<b>' + esc(a ? a.name : 'Cuenta eliminada') + '</b>' + (r.parts.length > 1 || p.currency || (a && !C.samePeg(a.currency, r.currency)) ? ' (' + fmtMoney(Math.abs(p.amount), cur) + ')' : '');
  }).join(' + ') : '<span class="muted">sin cuenta</span>';
  return r.dir === 'in' ? who + ' → ' + accs : accs + ' → ' + who;
}
function pgRowHtml(r, showDate) {
  var inn = r.dir === 'in', ref = r.ref.kind + '|' + r.ref.id + '|' + (r.ref.pay || '');
  var sub = [r.concept, r.kind === 'cobro_prestamo' || r.kind === 'pago_prestamo' ? (r.extra.interest > 0 ? 'incluye intereses ' + fmtMoney(r.extra.interest, r.currency) : '') : '', r.note]
    .filter(Boolean).join(' · ');
  return '<li class="clickable lg-row pg-row" data-lg="' + esc(ref) + '" tabindex="0" role="button">' +
    '<span class="avatar ' + (inn ? 'in' : 'out') + '">' + icon(inn ? 'i-in' : 'i-out') + '</span>' +
    '<div class="main"><div class="title">' + esc(pgTitle(r)) + ' <span class="tag info">' + esc(PG_SECTION[r.section] || r.section) + '</span>' + (r.atCreation ? ' <span class="tag">al crear</span>' : '') + '</div>' +
    '<div class="sub pg-flow">' + pgFlow(r) + '</div>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>' +
    '<div class="amt"><span class="' + (inn ? 'up' : '') + '">' + (inn ? '+' : '−') + fmtMoney(r.amount, r.currency) + '</span>' +
    (showDate ? '<div class="sub">' + fmtDate(r.date) + '</div>' : '') +
    (r.editable ? '<button type="button" class="mini pg-edit" data-pay-edit="' + esc(ref) + '" aria-label="Editar este pago">' + icon('i-edit') + '</button>' : '') + '</div></li>';
}
function renderPayHistory() {
  var b = base(), list = pgView(), sort = $('#pg-sort').value, byDay = sort === 'fecha' || sort === 'fecha_asc';
  fillSelect($('#pg-account'), [{ value: '', label: 'Todas las cuentas' }].concat(state.accounts.map(function (a) { return { value: a.id, label: a.name + ' · ' + a.currency }; })), $('#pg-account').value);
  // En la moneda de la operación (lo que se abonó), no en la de la cuenta: así un cobro en Bs suma su valor en dólares
  var toB = function (r) { var x = C.toBase(r.amount, r.currency, rates()); return isNaN(x) ? 0 : x; };
  var inn = C.sum(list.filter(function (r) { return r.dir === 'in'; }).map(toB)), out = C.sum(list.filter(function (r) { return r.dir === 'out'; }).map(toB));
  var f = pgFilters(), active = f.from || f.to || f.person || f.section || f.dir || f.accountId || f.min !== '' || f.max !== '';
  $('#pg-totals').innerHTML = '<span>' + list.length + ' registro(s)</span><span>Entró <b class="up">+' + fmtMoney(inn, b) + '</b></span><span>Salió <b>−' + fmtMoney(out, b) + '</b></span>' +
    '<span>Neto <b class="' + trend(inn - out) + '">' + fmtSigned(C.round(inn - out, 2), b) + '</b></span>';
  $('[data-action="pg-clear"]').classList.toggle('hidden', !active);
  var nf = [f.from || f.to, f.section, f.dir, f.accountId, f.min !== '' || f.max !== '', $('#pg-created').checked].filter(Boolean).length;
  $('#pg-fcount').textContent = nf ? '(' + nf + ' activo' + (nf > 1 ? 's' : '') + ')' : '';
  var html = '', day = null;
  list.slice(0, pgLimit).forEach(function (r) {
    if (byDay && r.date !== day) {
      day = r.date;
      html += '<li class="lg-day"><span>' + esc(new Date(day + 'T12:00').toLocaleDateString(LOCALE, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })) + '</span><span></span></li>';
    }
    html += pgRowHtml(r, !byDay);
  });
  $('#pg-list').innerHTML = html || '<li class="empty">No hay cobros ni pagos con estos filtros.</li>';
  $('#pg-more').classList.toggle('hidden', list.length <= pgLimit);
  $('#pg-more').textContent = 'Ver más (' + (list.length - pgLimit) + ' restantes)';
}
function clearPayFilters() {
  ['#pg-from', '#pg-to', '#pg-person', '#pg-min', '#pg-max'].forEach(function (s) { $(s).value = ''; });
  ['#pg-section', '#pg-dir', '#pg-account'].forEach(function (s) { $(s).value = ''; });
  pgLimit = 150; renderPayHistory();
}
function exportPaymentsCSV() {
  var rows = pgView().map(function (r) {
    return [r.date, pgTitle(r), PG_SECTION[r.section] || r.section, r.person, r.dir === 'in' ? 'entra' : 'sale', r.amount, r.currency,
      r.parts.map(function (p) { var a = account(p.accountId); return (a ? a.name : 'Cuenta eliminada') + ' ' + Math.abs(p.amount) + ' ' + (p.currency || (a ? a.currency : r.currency)); }).join(' | '),
      r.concept, r.note];
  });
  S.download('cobros_y_pagos_' + S.today() + '.csv', S.toCSV(['fecha', 'tipo', 'apartado', 'cliente', 'direccion', 'monto', 'moneda', 'cuentas', 'concepto', 'nota'], rows), 'text/csv');
}

// ================================================================ editar un pago (ventana)
var peRef = null;   // { kind, id, pay } del pago abierto en la ventana
/** Busca el pago y su operación: lista, total de lo que se debe, moneda, sentido y cuentas permitidas. */
function payLookup(kind, id, pay) {
  var rec, list, total, cur, inn, who, title, accs, conv = false, holder, field;
  if (kind === 'broker') {
    rec = byId(state.brokerages || [], id); if (!rec) return null;
    var role = String(pay).split(':')[0], pid = String(pay).split(':')[1];
    var lg = C.brokerLegs(rec).filter(function (l) { return l.role === role; })[0];
    if (!lg || !rec.legs || !rec.legs[role]) return null;
    holder = rec.legs[role]; field = 'payments'; pay = pid;
    total = lg.total; cur = lg.currency; inn = lg.dir === 'in'; who = lg.person; title = brLegTitle(lg).replace(/<[^>]+>/g, '');
  } else if (kind === 'fx') {
    rec = byId(state.exchanges, id); var st = rec && C.exchangeSettlement(rec); if (!st) return null;
    holder = rec; field = 'settlements'; total = st.total; cur = st.currency; inn = st.side === 'in'; who = rec.client;
    title = (inn ? 'Cobro del cambio de ' : 'Entrega del cambio a ') + (rec.client || 'cliente');
  } else if (kind === 'sale') {
    rec = byId(state.sales, id); if (!rec) return null;
    holder = rec; field = 'payments'; total = C.saleBalance(rec).total; cur = rec.currency; inn = true; who = rec.client;
    title = 'Cobro de la venta' + (rec.client ? ' a ' + rec.client : '');
  } else if (kind === 'loan') {
    rec = byId(state.loans, id); if (!rec) return null;
    holder = rec; field = 'payments'; total = C.loanStatus(rec, S.today()).total; cur = rec.currency; inn = rec.kind !== 'recibido'; who = rec.person;
    title = (inn ? 'Pago recibido de ' : 'Pago a ') + (rec.person || '');
  } else if (kind === 'debt') {
    rec = byId(state.debts, id); if (!rec) return null;
    holder = rec; field = 'payments'; total = Number(rec.amount); cur = rec.currency; inn = rec.kind === 'cobrar'; who = rec.person;
    title = (inn ? 'Abono recibido de ' : 'Abono a ') + (rec.person || '');
  } else return null;
  var pm = byId(holder[field] || [], pay); if (!pm) return null;
  accs = payAccountsAll(cur, 'Sin cuenta');   // cualquier cuenta: si es de otra moneda se pide lo que se movió en ella
  conv = true;
  var others = C.sum((holder[field] || []).filter(function (x) { return x !== pm; }).map(function (x) { return x.amount; }));
  return { kind: kind, rec: rec, holder: holder, field: field, pm: pm, total: total, max: C.round(total - others, 2), cur: cur, inn: inn, who: who || '', title: title, accs: accs, conv: conv };
}
function openPayEdit(kind, id, pay) {
  var L = payLookup(kind, id, pay);
  if (!L) { toast('No se encontró el pago'); return; }
  peRef = { kind: kind, id: id, pay: pay };
  var f = $('#pe-form'), pm = L.pm, mixed = !!(pm.splits && pm.splits.length > 1);
  $('#pe-title').textContent = 'Editar ' + (L.inn ? 'cobro' : 'pago');
  $('#pe-sub').textContent = L.title + ' · total ' + fmtMoney(L.total, L.cur) + ' · este registro puede ser de hasta ' + fmtMoney(L.max, L.cur);
  f.date.value = pm.date; f.amount.value = pm.amount; f.note.value = pm.note || '';
  $('#pe-cur').textContent = L.cur;
  $('#pe-acc-label').textContent = L.inn ? 'Entra en' : 'Sale de';
  fillSelect(f.accountId, L.accs, pm.accountId || '');
  f.accAmount.value = pm.accAmount || '';
  f.dataset.convTouched = pm.accAmount ? '1' : '';
  f.amount.disabled = f.accountId.disabled = mixed;
  $('#pe-mixed').classList.toggle('hidden', !mixed);
  if (mixed) $('#pe-mixed').textContent = 'Pago repartido: ' + payAccText(pm, L.cur).replace(/<[^>]+>/g, '') + '. Para cambiar el monto o el reparto, elimínalo y regístralo de nuevo.';
  syncPeConv();
  var dlg = $('#pe-dialog');
  if (!dlg.open) dlg.showModal();
}
/** Préstamos: si la cuenta es de otra moneda, pide el monto en esa moneda (como al registrar el pago). */
function syncPeConv() {
  var f = $('#pe-form'), L = peRef && payLookup(peRef.kind, peRef.id, peRef.pay), a = account(f.accountId.value);
  var show = !!(L && L.conv && a && !C.samePeg(a.currency, L.cur) && !f.accountId.disabled);
  $('#pe-conv').classList.toggle('hidden', !show);
  if (!show) return;
  $('#pe-conv-label').textContent = 'Monto en ' + a.currency + ' (lo que se movió en ' + a.name + ')';
  var amt = num(f.amount.value);
  if (!f.dataset.convTouched) { var v = C.convert(amt, L.cur, a.currency, rates()); f.accAmount.value = v > 0 ? C.round(v, 2) : ''; }
  var acc = num(f.accAmount.value);
  $('#pe-conv-hint').textContent = amt > 0 && acc > 0 ? 'Tasa: 1 ' + L.cur + ' = ' + fmtNum(acc / amt, 0, 4) + ' ' + a.currency : 'Escribe cuánto se movió en ' + a.currency + '.';
}
function savePayEdit() {
  var L = peRef && payLookup(peRef.kind, peRef.id, peRef.pay); if (!L) return;
  var f = $('#pe-form'), pm = L.pm, mixed = !!(pm.splits && pm.splits.length > 1);
  var amt = mixed ? pm.amount : num(f.amount.value);
  if (!(amt > 0)) { toast('Ingresa un monto mayor a 0'); f.amount.focus(); return; }
  if (amt > L.max + 0.001) { toast('Supera lo que se debe: como máximo ' + fmtMoney(L.max, L.cur)); f.amount.focus(); return; }
  if (!f.date.value) { toast('Elige la fecha'); return; }
  var convOn = !$('#pe-conv').classList.contains('hidden'), acc = num(f.accAmount.value);
  if (convOn && !(acc > 0)) { toast('Escribe el monto en la moneda de la cuenta'); f.accAmount.focus(); return; }
  invalidateSnapshots(pm.date < f.date.value ? pm.date : f.date.value);
  pm.date = f.date.value; pm.note = f.note.value.trim();
  if (!mixed) {
    pm.amount = C.round(amt, 2); pm.accountId = f.accountId.value || null;
    if (convOn) { pm.accAmount = C.round(acc, 2); pm.accCurrency = account(pm.accountId).currency; }
    else { delete pm.accAmount; delete pm.accCurrency; }
  }
  afterPayChange(L);
  $('#pe-dialog').close(); peRef = null;
  $('#pay-form').dataset.debt = '';
  persist(); toast('Pago actualizado');
}
function deletePayEdit() {
  var L = peRef && payLookup(peRef.kind, peRef.id, peRef.pay); if (!L || !confirm('¿Eliminar este registro? Los saldos se recalculan.')) return;
  invalidateSnapshots(L.pm.date);
  L.holder[L.field] = (L.holder[L.field] || []).filter(function (x) { return x !== L.pm; });
  afterPayChange(L);
  $('#pe-dialog').close(); peRef = null;
  $('#pay-form').dataset.debt = '';
  persist(); toast('Eliminado');
}
/** Un cambio pendiente pasa a completado (o vuelve a pendiente) según lo que quede por cobrar/entregar. */
function afterPayChange(L) {
  if (L.kind !== 'fx') return;
  var x = L.rec, st = C.exchangeSettlement(x);
  if (!st) return;
  x.settleSide = st.side;
  if (st.pending > 0) x.status = st.side === 'in' ? 'pendiente_cobro' : 'pendiente_entrega';
  else x.status = 'completada';
  if (!(x.settlements || []).length && x.status !== 'completada') delete x.settleSide;
}

// ---- Eventos (el HTML ya existe al cargar)
(function bindPayHistory() {
  var t;
  ['#pg-from', '#pg-to', '#pg-section', '#pg-dir', '#pg-account', '#pg-sort', '#pg-created'].forEach(function (s) { $(s).addEventListener('change', function () { pgLimit = 150; renderPayHistory(); }); });
  ['#pg-person', '#pg-min', '#pg-max'].forEach(function (s) { $(s).addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { pgLimit = 150; renderPayHistory(); }, 150); }); });
  $('#pg-person').addEventListener('change', function () { pgLimit = 150; renderPayHistory(); });
  var f = $('#pe-form');
  f.addEventListener('submit', function (e) { e.preventDefault(); savePayEdit(); });
  f.addEventListener('input', function (e) { if (e.target.name === 'accAmount') { f.dataset.convTouched = '1'; syncPeConv(); } else if (e.target.name === 'amount') syncPeConv(); });
  f.addEventListener('change', function (e) { if (e.target.name === 'accountId') { f.dataset.convTouched = ''; syncPeConv(); } });
  $('#pe-dialog').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    e.stopPropagation();
    if (b.dataset.pe === 'cancel') { $('#pe-dialog').close(); peRef = null; }
    else if (b.dataset.pe === 'delete') deletePayEdit();
    else if (b.dataset.pe === 'open') { var r = peRef; $('#pe-dialog').close(); peRef = null; if (r) openLedgerRow(r.kind, r.id, r.pay); }
  });
})();
