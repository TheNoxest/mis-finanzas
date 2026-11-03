/* =========================================================================
 * app/intermediacion.js — Intermediación: compro a un cliente y le vendo a otro (p. ej. en bolívares);
 * la ganancia es la diferencia de tasas, en dólares. Cálculos en Calc.brokerQuote / brokerLegs / brokerStatus.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

var BR_LEG_DONE = { asset_in: 'Ya lo recibí', asset_out: 'Ya lo entregué', pay_in: 'Ya lo cobré', pay_out: 'Ya lo pagué' };

function fxKind() { var r = document.querySelector('input[name="fx-kind"]:checked'); return r ? r.value : 'normal'; }
/** Muestra el formulario de cambio normal o el de intermediación. */
function setFxKind(kind) {
  $('#fk-' + kind).checked = true;
  $('#fx-form').classList.toggle('hidden', kind !== 'normal');
  $('#br-form').classList.toggle('hidden', kind !== 'broker');
}
function brMode() { var r = $('#br-form').querySelector('input[name="mode"]:checked'); return r ? r.value : 'directo'; }

/** Texto de un movimiento: «Cobras a Yorman», «Pagas a Ximena»… */
function brLegTitle(lg) {
  var who = esc(lg.person || 'cliente');
  if (lg.role === 'diff') return lg.dir === 'in' ? who + ' te paga la diferencia' : 'Le pagas la diferencia a ' + who;
  return { asset_in: 'Recibes de ', asset_out: 'Entregas a ', pay_in: 'Cobras a ', pay_out: 'Pagas a ' }[lg.role] + who;
}
function brDoneLabel(lg) { return lg.role === 'diff' ? (lg.dir === 'in' ? 'Ya la recibí' : 'Ya la pagué') : BR_LEG_DONE[lg.role]; }
/** Cuentas posibles para un movimiento: las de esa moneda (o de igual valor: USD = USDT). */
function brAccounts(cur, exact) {
  return [{ value: '', label: 'Ninguna (no la registro)' }].concat(state.accounts.filter(function (a) { return exact ? a.currency === cur : C.samePeg(a.currency, cur); })
    .map(function (a) { return { value: a.id, label: a.name + ' · ' + a.currency }; }));
}

/** Lo escrito en el formulario como registro (sin guardar). */
function brDraft() {
  var f = $('#br-form'), editing = f.editId.value ? byId(state.brokerages, f.editId.value) : null;
  var d = { date: f.date.value, asset: f.asset.value, amount: num(f.amount.value), payCurrency: f.payCurrency.value,
    seller: f.seller.value.trim(), buyRate: num(f.buyRate.value), buyer: f.buyer.value.trim(), sellRate: num(f.sellRate.value),
    profitRate: num(f.profitRate.value), mode: brMode(), note: f.note.value.trim() };
  var dsel = $('[data-leg-acc="diff"]'), dacc = dsel && dsel.value ? account(dsel.value) : null;
  d.diffCurrency = dacc ? dacc.currency : d.payCurrency;
  if (dacc && !C.samePeg(dacc.currency, d.payCurrency) && C.samePeg(dacc.currency, d.asset)) d.diffCurrency = d.asset;
  d.legs = editing ? editing.legs || {} : {};
  return d;
}

function syncBrForm(changed) {
  var f = $('#br-form'), d = brDraft();
  // Tasa para la ganancia: se sugiere la más alta mientras no la cambies a mano
  var sug = C.brokerQuote(d).suggestedRate;
  if (!f.dataset.prTouched && (changed === 'buyRate' || changed === 'sellRate' || changed === 'init')) { f.profitRate.value = sug > 0 ? sug : ''; d.profitRate = sug; }
  var q = C.brokerQuote(d), pc = d.payCurrency, ac = d.asset;
  $$('#br-form .br-rate-label').forEach(function (s) { s.textContent = 'Tasa (' + pc + ' por ' + ac + ')'; });
  $('#br-pr-hint').textContent = q.suggestedRate > 0 ? '(sugerida: la más alta, ' + fmtNum(q.suggestedRate, 0, 4) + ')' : '';
  var ok = d.amount > 0 && d.buyRate > 0 && d.sellRate > 0;
  $('#br-quote').innerHTML = ok ? 'Le pagas a ' + esc(d.seller || 'quien vende') + ': <b>' + fmtMoney(q.cost, pc) + '</b><br>' +
    esc(d.buyer || 'Quien compra') + ' te paga: <b>' + fmtMoney(q.revenue, pc) + '</b><br>Diferencia: <b class="' + trend(q.diff) + '">' + fmtSigned(q.diff, pc) + '</b>' : '';
  $('#br-profit-box').innerHTML = ok && q.profitRate > 0 ? '<div class="k">' + (q.profit < 0 ? 'Pérdida' : 'Ganancia') + ' en ' + ac + '</div><div class="v ' + trend(q.profit) + '">' + fmtSigned(q.profit, ac) + '</div>' +
    '<div class="sub">' + fmtMoney(Math.abs(q.diff), pc) + ' ÷ ' + fmtNum(q.profitRate, 0, 4) + '</div>' : '';
  $('#br-mode-hint').textContent = d.mode === 'directo'
    ? 'Los clientes se pagan entre ellos y a ti solo te llega (o pagas) la diferencia. Elige la cuenta: en ' + pc + ' o en ' + ac + '.'
    : 'Recibes y pagas todo tú: elige la cuenta de cada movimiento y marca lo que ya se hizo. Lo que no marques queda en Por cobrar / Por pagar.';
  renderBrLegsForm(d);
}

/** Filas de los movimientos (cuenta + «ya se hizo») según el modo. Conserva lo elegido al redibujar. */
function renderBrLegsForm(d) {
  var box = $('#br-legs'), keep = {};
  $$('#br-legs [data-leg-acc]').forEach(function (s) { keep[s.dataset.legAcc] = { acc: s.value, done: ($('[data-leg-done="' + s.dataset.legAcc + '"]') || {}).checked }; });
  var editing = !!$('#br-form').editId.value;
  // En directo se muestra la diferencia aunque la cuenta elegida cambie la moneda
  var legs = C.brokerLegs(d);
  if (!legs.length) { box.innerHTML = d.amount > 0 && d.buyRate > 0 && d.sellRate > 0 ? '<p class="hint">Sin diferencia: no hay dinero que mover para ti.</p>' : ''; return; }
  box.innerHTML = legs.map(function (lg) {
    var k = keep[lg.role], stored = (d.legs[lg.role] || {});
    var acc = k ? k.acc : (stored.accountId || (state.settings.last['br_' + lg.role] || ''));
    var done = k ? k.done : (editing ? lg.status === 'pagada' : true);
    var paidTxt = editing && lg.paid > 0 && lg.status !== 'pagada' ? ' <span class="tag">' + (lg.dir === 'in' ? 'Cobrado ' : 'Pagado ') + fmtMoney(lg.paid, lg.currency) + '</span>' : '';
    var opts = lg.role === 'diff' ? brAccounts(d.payCurrency, true).concat(brAccounts(d.asset).slice(1)) : brAccounts(lg.currency, lg.role === 'pay_in' || lg.role === 'pay_out');
    return '<div class="br-leg" data-role="' + lg.role + '"><div class="br-leg-head"><span class="avatar ' + (lg.dir === 'in' ? 'in' : 'out') + '">' + icon(lg.dir === 'in' ? 'i-in' : 'i-out') + '</span>' +
      '<b>' + brLegTitle(lg) + '</b><span class="br-leg-amt">' + fmtMoney(lg.total, lg.currency) + paidTxt + '</span></div><div class="grid">' +
      '<label class="span2">' + (lg.dir === 'in' ? 'Entra en' : 'Sale de') + '<select data-leg-acc="' + lg.role + '">' +
      opts.map(function (o) { return '<option value="' + esc(o.value) + '"' + (o.value === acc ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select></label>' +
      '<label class="check span2"><input type="checkbox" data-leg-done="' + lg.role + '"' + (done ? ' checked' : '') + '> ' + brDoneLabel(lg) + '</label></div></div>';
  }).join('');
  if (legs.some(function (lg) { return lg.currency === d.payCurrency; }) && !state.accounts.some(function (a) { return a.currency === d.payCurrency; })) {
    box.innerHTML += '<p class="warning">No tienes cuentas en ' + esc(d.payCurrency) + '. Si el dinero pasa por ti, créala en Cuentas → Mis cuentas (moneda ' + esc(d.payCurrency) + ').</p>';
  }
}

function brCurrencyOptions(exclude) {
  return accountCurrencyOptions().filter(function (o) { return o.value !== exclude; });
}
function resetBrForm() {
  var f = $('#br-form'), last = state.settings.last;
  f.editId.value = ''; f.reset();
  f.date.value = S.today();
  fillSelect(f.asset, currencyOptions().filter(function (o) { return C.pegOf(o.value) === 'USD' || o.value === 'EUR'; }), last.brAsset || 'USD');
  fillSelect(f.payCurrency, brCurrencyOptions(f.asset.value), last.brPayCurrency || 'VES');
  $('#bm-' + (last.brMode || 'directo')).checked = true;
  delete f.dataset.prTouched;
  $('#br-form-title').textContent = 'Nueva intermediación';
  $('[data-action="delete-br"]').classList.add('hidden');
  $('[data-action="cancel-br"]').classList.add('hidden');
  rcptFormBtn('broker', false);
  $('#br-legs').innerHTML = '';
  syncBrForm('init');
}
function editBroker(id) {
  var bk = byId(state.brokerages, id); if (!bk) return;
  if (accTab !== 'cambios') showView('cuentas/cambios');
  payRef = null; $('#debt-payments').classList.add('hidden');
  setFxKind('broker');
  var f = $('#br-form');
  f.editId.value = bk.id; f.date.value = bk.date; f.amount.value = bk.amount;
  fillSelect(f.asset, currencyOptions().filter(function (o) { return C.pegOf(o.value) === 'USD' || o.value === 'EUR'; }).concat(
    currencies().indexOf(bk.asset) < 0 ? [{ value: bk.asset, label: bk.asset }] : []), bk.asset);
  fillSelect(f.payCurrency, brCurrencyOptions(bk.asset), bk.payCurrency);
  f.seller.value = bk.seller || ''; f.buyRate.value = bk.buyRate; f.buyer.value = bk.buyer || ''; f.sellRate.value = bk.sellRate;
  f.profitRate.value = bk.profitRate || ''; f.dataset.prTouched = '1'; f.note.value = bk.note || '';
  $('#bm-' + (bk.mode || 'directo')).checked = true;
  $('#br-form-title').textContent = 'Editar intermediación';
  $('[data-action="delete-br"]').classList.remove('hidden');
  $('[data-action="cancel-br"]').classList.remove('hidden');
  rcptFormBtn('broker', true);
  $('#br-legs').innerHTML = '';
  syncBrForm();
  // La cuenta de la diferencia define su moneda: se elige la guardada
  var dl = bk.legs && bk.legs.diff, ds = $('[data-leg-acc="diff"]');
  if (dl && ds) { ds.value = dl.accountId || ''; syncBrForm(); }
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function onBrSubmit(e) {
  e.preventDefault();
  var f = e.target, d = brDraft(), today = S.today();
  if (!d.seller) { toast('Escribe quién te vende'); f.seller.focus(); return; }
  if (!d.buyer) { toast('Escribe quién te compra'); f.buyer.focus(); return; }
  if (!(d.amount > 0)) { toast('Ingresa el monto'); f.amount.focus(); return; }
  if (!(d.buyRate > 0) || !(d.sellRate > 0)) { toast('Escribe las dos tasas'); return; }
  if (!d.date) { toast('Elige la fecha'); return; }
  if (d.asset === d.payCurrency) { toast('Elige monedas distintas'); return; }
  if (!(d.profitRate > 0)) d.profitRate = C.brokerQuote(d).suggestedRate;
  var old = f.editId.value ? byId(state.brokerages, f.editId.value) : null, oldLegs = (old && old.legs) || {};
  // Cambiar el modo o la moneda de la diferencia descarta lo registrado en esos movimientos
  var drop = Object.keys(oldLegs).filter(function (r) {
    var has = (oldLegs[r].payments || []).length;
    return has && ((d.mode === 'directo') !== (r === 'diff') || (r === 'diff' && old.diffCurrency && old.diffCurrency !== d.diffCurrency));
  });
  if (drop.length && !confirm('Cambiaste cómo se mueve el dinero: se borran los cobros/pagos registrados antes en esta operación. ¿Continuar?')) return;
  var calc = C.brokerLegs(Object.assign({}, d, { legs: oldLegs })), legs = {}, warn = '';
  calc.forEach(function (lg) {
    var accSel = $('[data-leg-acc="' + lg.role + '"]'), doneEl = $('[data-leg-done="' + lg.role + '"]');
    var acc = accSel ? accSel.value || null : null, done = doneEl ? doneEl.checked : false;
    var prev = drop.indexOf(lg.role) >= 0 ? {} : (oldLegs[lg.role] || {});
    var pays = (prev.payments || []).map(function (p) { return Object.assign({}, p); });
    // Si cambió la cuenta, lo registrado con la anterior pasa a la nueva
    if (prev.accountId && acc && prev.accountId !== acc) pays.forEach(function (p) { if (!(p.splits && p.splits.length) && p.accountId === prev.accountId) p.accountId = acc; });
    var paid = C.sum(pays.map(function (p) { return p.amount; })), pending = C.round(lg.total - paid, 2);
    if (done && pending > 0) pays.push({ id: S.uid(), date: pays.length ? today : d.date, amount: pending, accountId: acc, note: '', createdAt: Date.now() });
    else if (!done && pays.length && pending <= 0) {
      if (pays.length === 1) pays = [];
      else warn = 'Algunos movimientos tienen varios pagos: bórralos desde la tarjeta de la operación.';
    }
    legs[lg.role] = { accountId: acc, payments: pays };
    state.settings.last['br_' + lg.role] = acc || '';
  });
  var data = { date: d.date, asset: d.asset, amount: C.round(d.amount, 2), payCurrency: d.payCurrency, seller: d.seller, buyRate: d.buyRate,
    buyer: d.buyer, sellRate: d.sellRate, profitRate: d.profitRate, mode: d.mode, diffCurrency: d.mode === 'directo' ? d.diffCurrency : null,
    legs: legs, note: d.note };
  invalidateSnapshots(old && old.date < data.date ? old.date : data.date);
  var rec;
  if (old) { Object.assign(old, data); rec = old; }
  else { rec = Object.assign({ id: S.uid(), createdAt: Date.now() }, data); state.brokerages = state.brokerages || []; state.brokerages.push(rec); }
  var last = state.settings.last; last.brAsset = d.asset; last.brPayCurrency = d.payCurrency; last.brMode = d.mode;
  var st = C.brokerStatus(rec), q = st.quote;
  resetBrForm();
  persist();
  if (warn) toast(warn);
  else toastAction((old ? 'Intermediación actualizada' : 'Intermediación guardada') + ' · ' + (st.status === 'completada' ? (q.profit < 0 ? 'pérdida ' : 'ganancia ') : 'prevista ') +
    fmtSigned(q.profit, rec.asset), 'Ver', function () { openRef('broker', rec.id); });
}

// ---- Tarjeta de la operación: movimientos, cobros y pagos (usa la tarjeta compartida #debt-payments)
function brLegOf(st, role) {
  return st.legs.filter(function (l) { return l.role === role; })[0] || st.legs.filter(function (l) { return l.pending > 0; })[0] || st.legs[0] || null;
}
function brStatusTag(st) {
  if (st.status === 'completada') return '';
  var open = st.legs.filter(function (l) { return l.pending > 0; });
  if (open.length === 1) return '<span class="tag warn">' + (open[0].dir === 'in' ? 'Falta cobrar ' : open[0].role === 'asset_out' ? 'Falta entregar ' : 'Falta pagar ') + fmtMoney(open[0].pending, open[0].currency) + '</span>';
  return '<span class="tag warn">' + open.length + ' movimientos pendientes</span>';
}
function renderBrokerPayments() {
  var card = $('#debt-payments'), pf = $('#pay-form'), bk = byId(state.brokerages || [], payRef.id);
  if (!bk || ['cobrar', 'pagar', 'cambios'].indexOf(accTab) < 0) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  var st = C.brokerStatus(bk), q = st.quote, lg = brLegOf(st, payRef.leg), b = base();
  if (lg) payRef.leg = lg.role;
  $('#pay-title').textContent = 'Intermediación ' + (bk.seller || '') + ' → ' + (bk.buyer || '');
  setPayEdit('br-edit', bk.id, 'Editar intermediación');
  var head = '<li class="sub pay-note" style="border:0;padding:4px 0 2px">' + fmtDate(bk.date) + ' · <b>' + fmtMoney(bk.amount, bk.asset) + '</b> · compra a ' + fmtNum(bk.buyRate, 0, 4) +
    ' y venta a ' + fmtNum(bk.sellRate, 0, 4) + ' ' + esc(bk.payCurrency) + ' · ' + (bk.mode === 'directo' ? 'directo entre clientes' : 'todo pasa por ti') + '</li>' +
    '<li class="sub pay-note" style="border:0;padding:2px 0 8px">' + (st.status === 'completada' ? (q.profit < 0 ? 'Pérdida ' : 'Ganancia ') : 'Ganancia prevista ') +
    '<b class="' + (st.status === 'completada' ? trend(q.profit) : '') + '">' + fmtSigned(q.profit, bk.asset) + '</b> (' + fmtSigned(q.diff, bk.payCurrency) + ' ÷ ' + fmtNum(q.profitRate, 0, 4) + ')' +
    (st.status === 'completada' ? ' · <span class="tag ok">Completada</span>' : '') + '</li>';
  var legsHtml = st.legs.map(function (l) {
    var tag = l.status === 'pagada' ? '<span class="tag ok">Hecho</span>' : l.status === 'parcial' ? '<span class="tag">Parcial</span>' : '<span class="tag warn">Pendiente</span>';
    return '<li class="clickable br-leg-row' + (lg && l.role === lg.role ? ' editing' : '') + '" data-br-leg="' + l.role + '" tabindex="0" role="button">' +
      '<span class="avatar ' + (l.dir === 'in' ? 'in' : 'out') + '">' + icon(l.dir === 'in' ? 'i-in' : 'i-out') + '</span>' +
      '<div class="main"><div class="title">' + brLegTitle(l) + ' ' + tag + '</div><div class="sub">' + (l.dir === 'in' ? 'Cobrado ' : 'Pagado ') + fmtMoney(l.paid, l.currency) + ' de ' + fmtMoney(l.total, l.currency) + '</div></div>' +
      '<div class="amt">' + fmtMoney(l.pending, l.currency) + '<div class="sub">pendiente</div></div></li>';
  }).join('');
  var pays = lg ? lg.payments.slice().sort(function (a, c) { return a.date < c.date ? 1 : -1; }) : [];
  $('#pay-progress').innerHTML = '<span style="width:' + (lg && lg.total > 0 ? Math.min(100, lg.paid / lg.total * 100) : 100) + '%"></span>';
  $('#pay-list').innerHTML = head + legsHtml + (lg && pays.length ? '<li class="sub pay-note" style="border:0;padding:10px 0 2px"><b>' + brLegTitle(lg) + '</b> · registros</li>' : '') +
    pays.map(function (pm) {
      return '<li><span class="avatar ' + (lg.dir === 'in' ? 'in' : 'out') + '">' + icon(lg.dir === 'in' ? 'i-in' : 'i-out') + '</span><div class="main"><div class="title">' + fmtMoney(pm.amount, lg.currency) + '</div>' +
        '<div class="sub">' + fmtDate(pm.date) + ' · ' + payAccText(pm, lg.currency) + (pm.note ? ' · ' + esc(pm.note) : '') + '</div></div>' +
        '<div class="row-actions"><button class="mini" data-pay-edit="broker|' + bk.id + '|' + lg.role + ':' + pm.id + '" aria-label="Editar">' + icon('i-edit') + '</button><button class="mini" data-rcpt="broker|' + bk.id + '|' + pm.id + '" aria-label="Recibo">' + icon('i-doc') + '</button><button class="mini" data-del-ref-pay="' + pm.id + '" aria-label="Eliminar">' + icon('i-x') + '</button></div></li>';
    }).join('');
  setPayTools('broker', bk.id, !!lg && lg.dir === 'in' && lg.pending > 0);
  pf.classList.toggle('hidden', !lg || lg.status === 'pagada');
  if (!lg) return;
  $('#pay-acc-label').textContent = lg.dir === 'in' ? 'Entra en' : 'Sale de';
  $('#pay-submit').textContent = lg.dir === 'in' ? (lg.role === 'asset_in' ? 'Registrar lo recibido' : 'Registrar cobro') : lg.role === 'asset_out' ? 'Registrar entrega' : 'Registrar pago';
  var key = 'broker:' + bk.id + ':' + lg.role;
  if (pf.dataset.debt !== key) {
    pf.dataset.debt = key;
    pf.amount.value = lg.pending; pf.date.value = S.today(); pf.note.value = '';
    fillSelect(pf.accountId, payAccountsAll(lg.currency, 'Sin cuenta'), lg.accountId || '');
    pf.dataset.cur = lg.currency; mixReset(payMix); pf.accAmount.value = ''; delete pf.dataset.convTouched;
  }
}
function brokerPay(f) {
  var bk = byId(state.brokerages || [], payRef.id); if (!bk) return;
  var st = C.brokerStatus(bk), lg = brLegOf(st, payRef.leg); if (!lg) return;
  var amt = num(f.amount.value);
  if (!(amt > 0)) { toast('Ingresa un monto mayor a 0'); return; }
  if (amt > lg.pending + 0.001) { toast('Supera lo pendiente (' + fmtMoney(lg.pending, lg.currency) + ')'); return; }
  if (!f.date.value) { toast('Elige la fecha'); return; }
  var tg = payTarget(f);
  if (tg.error) { toast(tg.error); return; }
  var cv = payConv(f);
  if (cv && cv.error) { toast(cv.error); f.accAmount.focus(); return; }
  bk.legs = bk.legs || {};
  var leg = bk.legs[lg.role] = bk.legs[lg.role] || { accountId: tg.accountId, payments: [] };
  var nid = S.uid();
  leg.payments = (leg.payments || []).concat([applyConv(withSplits({ id: nid, date: f.date.value, amount: C.round(amt, 2), accountId: tg.accountId, note: f.note.value.trim(), createdAt: Date.now() }, tg), cv)]);
  invalidateSnapshots(f.date.value);
  f.dataset.debt = '';
  var ns = C.brokerStatus(bk), nl = brLegOf(ns, lg.role);
  // Si este movimiento quedó saldado, la tarjeta pasa al siguiente pendiente
  if (nl.status === 'pagada') { var nxt = ns.legs.filter(function (l) { return l.pending > 0; })[0]; if (nxt) payRef.leg = nxt.role; }
  toastAction(ns.status === 'completada' ? '¡Intermediación completada! ' + (ns.quote.profit < 0 ? 'Pérdida ' : 'Ganancia ') + fmtSigned(ns.quote.profit, bk.asset)
    : 'Registrado · pendiente ' + fmtMoney(nl.pending, nl.currency), 'Recibo', function () { openReceipt('broker', bk.id, nid); });
  persist();
}
function brokerDeletePay(pid) {
  var bk = byId(state.brokerages || [], payRef.id); if (!bk || !confirm('¿Eliminar este registro?')) return;
  Object.keys(bk.legs || {}).forEach(function (r) {
    var leg = bk.legs[r], pm = byId(leg.payments || [], pid);
    if (pm) { invalidateSnapshots(pm.date); leg.payments = leg.payments.filter(function (x) { return x.id !== pid; }); }
  });
  $('#pay-form').dataset.debt = ''; persist(); toast('Eliminado');
}
function deleteBroker() {
  var bk = byId(state.brokerages || [], $('#br-form').editId.value);
  if (!bk || !confirm('¿Eliminar esta intermediación y sus cobros/pagos? Los saldos de las cuentas se recalculan.')) return;
  invalidateSnapshots(bk.date);
  state.brokerages = state.brokerages.filter(function (x) { return x !== bk; });
  payRef = null; resetBrForm(); persist(); toast('Intermediación eliminada');
}

/** Fila de una intermediación en el historial de Cambios. */
function brokerRowHtml(bk) {
  var st = C.brokerStatus(bk), q = st.quote, done = st.status === 'completada', b = base();
  var pb = C.toBase(q.profit, bk.asset, rates());
  return '<li class="clickable' + (payRef && payRef.kind === 'broker' && payRef.id === bk.id ? ' editing' : '') + '" data-open-br="' + bk.id + '" tabindex="0" role="button">' +
    '<span class="avatar tr">' + icon('i-swap') + '</span>' +
    '<div class="main"><div class="title">' + esc(bk.seller || '?') + ' → ' + esc(bk.buyer || '?') + ' <span class="tag info">Intermediación</span> ' + brStatusTag(st) + '</div>' +
    '<div class="sub">' + fmtDate(bk.date) + ' · ' + fmtMoney(bk.amount, bk.asset) + ' · ' + fmtNum(bk.buyRate, 0, 4) + ' → ' + fmtNum(bk.sellRate, 0, 4) + ' ' + esc(bk.payCurrency) + '</div></div>' +
    '<div class="amt"><span class="' + (done ? trend(pb) : 'muted') + '">' + fmtSigned(isNaN(pb) ? q.profit : pb, isNaN(pb) ? bk.asset : b) + '</span>' +
    '<div class="sub">' + (done ? 'ganancia' : 'prevista') + '</div></div></li>';
}

// ---- Eventos del formulario (el HTML ya existe al cargar)
(function bindBroker() {
  var f = $('#br-form');
  $$('input[name="fx-kind"]').forEach(function (r) { r.addEventListener('change', function () { setFxKind(r.value); if (r.value === 'broker' && !f.editId.value) resetBrForm(); }); });
  f.addEventListener('input', function (e) {
    var n = e.target.name;
    if (n === 'profitRate') f.dataset.prTouched = '1';
    if (['amount', 'buyRate', 'sellRate', 'profitRate', 'seller', 'buyer'].indexOf(n) >= 0) syncBrForm(n);
  });
  f.addEventListener('change', function (e) {
    var n = e.target.name;
    if (n === 'asset') { fillSelect(f.payCurrency, brCurrencyOptions(f.asset.value), f.payCurrency.value === f.asset.value ? 'VES' : f.payCurrency.value); }
    if (n === 'asset' || n === 'payCurrency' || n === 'mode' || e.target.dataset.legAcc === 'diff') syncBrForm(n || 'leg');
  });
  f.addEventListener('submit', onBrSubmit);
})();
