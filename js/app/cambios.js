/* =========================================================================
 * app/cambios.js — Cambios de divisas (formulario, tasa, comisión, historial).
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ---------- Cambios de divisas ----------
// ---- Tasa del cambio ----
// Internamente siempre se guarda "1 [recibes] = tasa [entregas]". En pantalla se muestra en la forma
// habitual: la moneda que no es dólar cotizada en dólares (1 EUR = 1.12 USD), con opción de invertirla.
function usdLike(c) { return C.pegOf(c) === 'USD'; }
function marketRate(from, to) { var r = C.marketRate(from, to, rates()); return isFinite(r) ? r : NaN; }
function defaultRateInv(inCur, outCur) { return usdLike(inCur) && !usdLike(outCur); }
function rateInv() { return $('#fx-form').dataset.rateInv === '1'; }
/** Tasa efectiva (1 recibes = ? entregas) a partir de lo escrito. */
function effectiveRate() {
  var v = num($('#fx-form').rate.value);
  if (!(v > 0)) return 0;
  return rateInv() ? 1 / v : v;
}
/** Muestra una tasa efectiva en la orientación actual. */
function showRate(eff) {
  var f = $('#fx-form');
  f.rate.value = eff > 0 ? C.round(rateInv() ? 1 / eff : eff, 6) : '';
}
function setMarketRate() {
  var f = $('#fx-form');
  f.dataset.rateInv = defaultRateInv(f.inCurrency.value, f.outCurrency.value) ? '1' : '';
  showRate(marketRate(f.inCurrency.value, f.outCurrency.value));
  delete f.dataset.rateTouched;
}
function rateSourceText(cur) {
  if (usdLike(cur)) return '';
  var src = (state.settings.rateSources || {})[cur];
  if (state.settings.rateLocks[cur]) return 'tasa fijada a mano';
  return src ? src.source + (src.live ? ' en vivo · ' + fmtTime(src.at) : ' · diaria') : '';
}

function fxCostRow(cost) {
  cost = cost || {};
  var cur = cost.currency || $('#fx-form').inCurrency.value || base();
  var div = document.createElement('div');
  div.className = 'cost-row';
  div.innerHTML = '<label>Concepto<input data-c="concept" maxlength="60" placeholder="Ej.: comisión de red" value="' + esc(cost.concept || '') + '"></label>' +
    '<label>Monto<input data-c="amount" type="text" inputmode="decimal" autocomplete="off" value="' + (cost.amount != null ? cost.amount : '') + '"></label>' +
    '<label>Moneda<select data-c="currency"></select></label>' +
    '<label>Sale de<select data-c="accountId"></select></label>' +
    '<button type="button" class="mini c-del" data-action="del-cost" aria-label="Quitar costo">' + icon('i-x') + '</button>';
  fillSelect(div.querySelector('[data-c="currency"]'), currencyOptions(), cur);
  fillSelect(div.querySelector('[data-c="accountId"]'), accountsFor(cur, 'Ninguna'), cost.accountId || '');
  $('#fx-costs').appendChild(div);
}
function gatherCosts() {
  return $$('#fx-costs .cost-row').map(function (r) {
    var g = function (k) { return r.querySelector('[data-c="' + k + '"]').value; };
    return { concept: g('concept').trim(), amount: C.round(num(g('amount')) || 0, 2), currency: g('currency'), accountId: g('accountId') || null };
  }).filter(function (c) { return c.amount > 0; });
}

function fxDraft() {
  var f = $('#fx-form');
  return {
    amount: num(f.amount.value) || 0, inCurrency: f.inCurrency.value, outCurrency: f.outCurrency.value, rate: effectiveRate(),
    commission: { mode: f.comMode.value, value: num(f.comValue.value) || 0, currency: f.comCurrency.value, charge: f.comCharge.value }
  };
}

function snapshotRates(curs, prev) {
  var r = Object.assign({}, prev && prev.rates);
  curs.forEach(function (c) { if (c && r[c] == null && rates()[c] != null) r[c] = rates()[c]; });
  return { base: prev && prev.base ? prev.base : base(), rates: r };
}

/** Recalcula la cotización y la ganancia mientras escribes. */
var FX_RECALC = { amount: 1, rate: 1, comMode: 1, comValue: 1, comCharge: 1, comCurrency: 1, inCurrency: 1, outCurrency: 1 };
function syncFxForm(changed) {
  var f = $('#fx-form');
  if (changed === 'inCurrency' || changed === 'outCurrency') {
    // Monedas iguales en valor (USD/USDT) o sin tasa tocada: tasa de mercado en la orientación habitual
    if (!f.dataset.rateTouched || usdLike(f.inCurrency.value) && usdLike(f.outCurrency.value)) setMarketRate();
    fillSelect(f.inAccountId, accountsFor(f.inCurrency.value, 'Ninguna (no la registro)'), f.inAccountId.value);
    fillSelect(f.outAccountId, accountsFor(f.outCurrency.value, 'Ninguna (no la registro)'), f.outAccountId.value);
  }
  if (changed === 'rate') f.dataset.rateTouched = '1';
  // Cualquier cambio en monto, tasa o comisión vuelve a calcular lo que entregas
  if (FX_RECALC[changed]) delete f.dataset.deliveredTouched;
  if (changed === 'delivered') f.dataset.deliveredTouched = '1';
  var fijo = f.comMode.value === 'fijo';
  $('#fx-com-cur').classList.toggle('hidden', !fijo);
  $('#fx-com-label').textContent = fijo ? 'Monto' : 'Porcentaje (%)';
  var inC = f.inCurrency.value, outC = f.outCurrency.value;
  $('#fx-rate-label').textContent = rateInv() ? '1 ' + outC + ' = ? ' + inC : '1 ' + inC + ' = ? ' + outC;

  // Tasa de mercado de referencia y aviso si la escrita se aleja (p. ej., si está invertida)
  var mkt = marketRate(inC, outC), eff = effectiveRate();
  var help = '';
  if (mkt > 0 && !(usdLike(inC) && usdLike(outC))) {
    var shown = rateInv() ? '1 ' + outC + ' = ' + fmtNum(1 / mkt, 0, 4) + ' ' + inC : '1 ' + inC + ' = ' + fmtNum(mkt, 0, 4) + ' ' + outC;
    var src = rateSourceText(C.pegOf(inC) === 'USD' ? outC : inC);
    help = 'Mercado: ' + shown + (src ? ' · ' + esc(src) : '');
    if (eff > 0) {
      var dev = C.round((eff / mkt - 1) * 100, 2);
      if (Math.abs(dev) > 3) {
        var looksInverted = Math.abs(1 / eff / mkt - 1) <= 0.05;
        help += '<div class="warning" style="margin:6px 0 0">' + (looksInverted
          ? 'Esta tasa parece <b>invertida</b>: entregarías ' + fmtPct(dev) + ' respecto al mercado.'
          : 'Esta tasa se aleja un <b>' + fmtPct(dev) + '</b> del mercado: revisa que sea la acordada.') +
          ' <button type="button" class="link" data-action="fx-market-rate">Usar tasa de mercado</button></div>';
      }
    }
  } else if (usdLike(inC) && usdLike(outC)) {
    help = '1 USD = 1 USDT: no hay diferencia de tasa entre estas monedas.';
  }
  $('#fx-rate-help').innerHTML = help + (usdLike(inC) && usdLike(outC) ? '' : ' <button type="button" class="link" data-action="flip-rate">⇄ Invertir tasa</button>');

  var x = fxDraft();
  var q = C.exchangeQuote(x, rates());
  if (!f.dataset.deliveredTouched) f.delivered.value = x.amount > 0 && x.rate > 0 ? q.delivered : '';
  $('#fx-deliver-hint').innerHTML = f.dataset.deliveredTouched
    ? '(ajustado a mano · <button type="button" class="link" data-action="fx-recalc">↺ recalcular</button>)' : '(se calcula solo)';
  var delivered = num(f.delivered.value) || 0;
  if (!(x.amount > 0)) { $('#fx-quote').innerHTML = '<span class="muted">Escribe el monto para ver el cálculo.</span>'; $('#fx-profit-box').innerHTML = ''; return; }
  var comTxt = x.commission.mode === 'porcentaje'
    ? fmtNum(x.commission.value, 0, 4) + ' % × ' + fmtMoney(x.amount, inC) + ' = ' + fmtMoney(q.commission, inC)
    : fmtMoney(q.commission, inC) + (x.commission.currency && x.commission.currency !== inC ? ' (' + fmtMoney(x.commission.value, x.commission.currency) + ')' : '');
  $('#fx-quote').innerHTML =
    kv('El cliente envía', fmtMoney(q.received, inC) + (x.commission.charge === 'aparte' ? ' <span class="muted small">(monto + comisión)</span>' : '')) +
    kv('Tu comisión', comTxt + (x.commission.charge === 'aparte' ? ' · aparte' : ' · descontada')) +
    kv('Se convierte', fmtMoney(q.net, inC) + (usdLike(inC) && usdLike(outC) && x.rate === 1 ? ' (1:1)' : ' × ' + fmtNum(x.rate, 0, 6))) +
    kv('Entregas', fmtMoney(delivered, outC));
  var costs = gatherCosts();
  var curs = [x.inCurrency, x.outCurrency].concat(costs.map(function (c) { return c.currency; }));
  var draft = { received: q.received, delivered: delivered, commissionAmount: q.commission, inCurrency: x.inCurrency, outCurrency: x.outCurrency,
    costs: costs, snapshot: snapshotRates(curs, f.editId.value ? (byId(state.exchanges, f.editId.value) || {}).snapshot : null) };
  var pr = C.exchangeProfit(draft, rates());
  var b = base();
  $('#fx-profit-box').innerHTML =
    kv('Comisión cobrada', '+' + fmtMoney(pr.commission, b)) +
    kv('Diferencial de tasa', '<span class="' + trend(pr.spread) + '">' + fmtSigned(pr.spread, b) + '</span>') +
    kv('Costos que pagas', (pr.costs ? '−' : '') + fmtMoney(pr.costs, b)) +
    '<div class="kv total"><span>Ganancia neta</span><span class="' + trend(pr.profit) + '">' + fmtSigned(pr.profit, b) + '</span></div>';
}

function resetFxForm() {
  var f = $('#fx-form'), last = state.settings.last;
  f.reset(); f.editId.value = '';
  delete f.dataset.rateTouched; delete f.dataset.deliveredTouched;
  $('#fx-costs').innerHTML = '';
  var curs = currencyOptions();
  fillSelect(f.inCurrency, curs, last.fxIn || base());
  var defOut = last.fxOut || (rates().USDT ? 'USDT' : curs.filter(function (c) { return c.value !== f.inCurrency.value; }).map(function (c) { return c.value; })[0] || base());
  fillSelect(f.outCurrency, curs, defOut);
  fillSelect(f.comCurrency, curs, rates().USD ? 'USD' : base());
  f.comMode.value = last.fxComMode || 'porcentaje';
  f.comCharge.value = last.fxComCharge || 'descontada';
  f.comValue.value = last.fxComValue != null ? last.fxComValue : '';
  f.date.value = S.today();
  f.status.value = 'completada';
  fillSelect(f.inAccountId, accountsFor(f.inCurrency.value, 'Ninguna (no la registro)'), last.fxInAcc || '');
  fillSelect(f.outAccountId, accountsFor(f.outCurrency.value, 'Ninguna (no la registro)'), last.fxOutAcc || '');
  mixReset(fxInMix); mixReset(fxOutMix);
  setMarketRate();
  $('#fx-form-title').textContent = 'Nuevo cambio';
  $('#fx-settle-hint').classList.add('hidden');
  $('[data-action="cancel-fx"]').classList.add('hidden');
  $('[data-action="delete-fx"]').classList.add('hidden'); rcptFormBtn('fx', false);
  syncFxForm();
}

function editFx(id) {
  var x = byId(state.exchanges, id); if (!x) return;
  if (accTab !== 'cambios') showView('cuentas/cambios');
  var f = $('#fx-form');
  resetFxForm();
  f.editId.value = x.id; f.client.value = x.client || ''; f.date.value = x.date; f.status.value = x.status;
  f.amount.value = x.amount;
  fillSelect(f.inCurrency, currencyOptions(), x.inCurrency); fillSelect(f.outCurrency, currencyOptions(), x.outCurrency);
  fillSelect(f.inAccountId, accountsFor(x.inCurrency, 'Ninguna (no la registro)'), x.inAccountId || '');
  fillSelect(f.outAccountId, accountsFor(x.outCurrency, 'Ninguna (no la registro)'), x.outAccountId || '');
  f.dataset.rateInv = (x.rateInv != null ? x.rateInv : defaultRateInv(x.inCurrency, x.outCurrency)) ? '1' : '';
  showRate(x.rate); f.dataset.rateTouched = '1';
  f.comMode.value = x.commission.mode; f.comValue.value = x.commission.value; f.comCharge.value = x.commission.charge;
  if (x.commission.currency) fillSelect(f.comCurrency, currencyOptions(), x.commission.currency);
  f.delivered.value = x.delivered; f.dataset.deliveredTouched = '1';
  mixSet(fxInMix, x.inSplits); mixSet(fxOutMix, x.outSplits);
  f.note.value = x.note || '';
  (x.costs || []).forEach(fxCostRow);
  $('#fx-form-title').textContent = 'Editar cambio';
  var st = C.exchangeSettlement(x), hint = $('#fx-settle-hint');
  if (st && (st.status !== 'pagada' || (x.settlements || []).length)) {
    hint.innerHTML = (st.side === 'in' ? 'Cobrado ' : 'Entregado ') + fmtMoney(st.paid, st.currency) + ' de ' + fmtMoney(st.total, st.currency) +
      (st.pending > 0 ? ' · pendiente <b>' + fmtMoney(st.pending, st.currency) + '</b>. ' : '. ') +
      '<button type="button" class="link small" data-action="fx-settle" data-id="' + x.id + '">' + (st.pending > 0 ? (st.side === 'in' ? 'Registrar cobro →' : 'Registrar entrega →') : 'Ver registros →') + '</button>' +
      ((x.settlements || []).length ? '<br><span class="small">El estado se calcula con lo cobrado o entregado.</span>' : '');
    var sideAcc = st.side === 'in' ? x.inAccountId : x.outAccountId;
    var sets = x.settlements || [];
    if (sets.length) hint.innerHTML += '<br><span class="small">' + sets.map(function (z) {
      return (st.side === 'in' ? 'Cobro ' : 'Entrega ') + fmtMoney(z.amount, st.currency) + ' el ' + fmtDate(z.date) + ' · ' + payAccText(z, st.currency);
    }).join('<br>') + '</span>';
    var wrong = sets.filter(function (z) { return !(z.splits && z.splits.length) && z.accountId !== sideAcc; });   // los mixtos son a propósito
    if (sideAcc && wrong.length) {
      hint.innerHTML += '<br><b>Ojo:</b> ' + (wrong.length === sets.length ? 'los registros usan' : wrong.length + ' registro(s) usan') + ' otra cuenta que «' +
        (st.side === 'in' ? 'Entra en' : 'Sale de') + ': ' + esc(accName(sideAcc)) + '». ' +
        '<button type="button" class="link small" data-action="fx-fix-settle-acc" data-id="' + x.id + '">Usar ' + esc(accName(sideAcc)) + ' en todos</button>';
    }
    hint.classList.remove('hidden');
  } else hint.classList.add('hidden');
  $('[data-action="cancel-fx"]').classList.remove('hidden');
  $('[data-action="delete-fx"]').classList.remove('hidden'); rcptFormBtn('fx', true);
  syncFxForm();
  renderExchanges();
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function onFxSubmit(e) {
  e.preventDefault();
  var f = e.target, x = fxDraft();
  var q = C.exchangeQuote(x, rates());
  var delivered = num(f.delivered.value);
  if (!(x.amount > 0)) { toast('Ingresa el monto a cambiar'); f.amount.focus(); return; }
  if (!(x.rate > 0)) { toast('Ingresa la tasa de cambio'); f.rate.focus(); return; }
  if (!(q.commission >= 0) || q.commission >= x.amount) { toast('Revisa la comisión: debe ser menor al monto'); f.comValue.focus(); return; }
  if (!(delivered > 0)) { toast('Indica el monto a entregar'); f.delivered.focus(); return; }
  if (!f.date.value) { toast('Elige la fecha'); return; }
  var costs = gatherCosts();
  var mxIn = mixRead(fxInMix), mxOut = mixRead(fxOutMix);
  if (mxIn && mxIn.error) { toast('Entra en · ' + mxIn.error); return; }
  if (mxOut && mxOut.error) { toast('Sale de · ' + mxOut.error); return; }
  var existing = f.editId.value ? byId(state.exchanges, f.editId.value) : null;
  var curs = [x.inCurrency, x.outCurrency, x.commission.currency].concat(costs.map(function (c) { return c.currency; }));
  var data = {
    date: f.date.value, client: f.client.value.trim(), status: f.status.value,
    amount: C.round(x.amount, 2), inCurrency: x.inCurrency, outCurrency: x.outCurrency, rate: C.round(x.rate, 10), rateInv: rateInv(),
    commission: { mode: x.commission.mode, value: x.commission.value, currency: x.commission.mode === 'fijo' ? x.commission.currency : null, charge: x.commission.charge },
    commissionAmount: q.commission, received: q.received, delivered: C.round(delivered, 2),
    inAccountId: mxIn ? mxIn.accountId : (f.inAccountId.value || null), outAccountId: mxOut ? mxOut.accountId : (f.outAccountId.value || null),
    inSplits: mxIn ? mxIn.splits : null, outSplits: mxOut ? mxOut.splits : null,
    costs: costs, note: f.note.value.trim(),
    snapshot: snapshotRates(curs, existing ? existing.snapshot : null) // tasas fijadas al registrar: la ganancia no cambia después
  };
  invalidateSnapshots(existing && existing.date < data.date ? existing.date : data.date);
  // Con cobros/entregas registrados, el estado sale de lo pendiente (no del selector)
  if (existing && (existing.settlements || []).length) {
    var side = existing.settleSide || (existing.status === 'pendiente_cobro' ? 'in' : 'out');
    // Si cambiaste la cuenta de ese lado, los registros que usaban la cuenta anterior pasan a la nueva
    var oldAcc = side === 'in' ? existing.inAccountId : existing.outAccountId, newAcc = side === 'in' ? data.inAccountId : data.outAccountId;
    if (newAcc && oldAcc !== newAcc) existing.settlements.forEach(function (z) { if (!(z.splits && z.splits.length) && (!z.accountId || z.accountId === oldAcc)) z.accountId = newAcc; });
    var probe = Object.assign({}, existing, data, { status: 'completada', settleSide: side });
    var pst = C.exchangeSettlement(probe);
    // Elegiste «Completado» pero falta algo: se registra lo que falta (hoy, en la cuenta del formulario)
    if (pst.pending > 0 && data.status === 'completada' &&
        confirm('Falta ' + (side === 'in' ? 'cobrar ' : 'entregar ') + fmtMoney(pst.pending, pst.currency) + '. ¿Darlo por ' + (side === 'in' ? 'cobrado en ' : 'entregado desde ') +
          (newAcc ? '«' + accName(newAcc) + '»' : '(sin cuenta)') + ' con fecha de hoy?')) {
      existing.settlements.push({ id: S.uid(), date: S.today(), amount: pst.pending, accountId: newAcc || null, note: 'Completado al editar', createdAt: Date.now() });
      pst = C.exchangeSettlement(Object.assign({}, existing, data, { status: 'completada', settleSide: side }));
    }
    data.status = pst.pending > 0 ? (side === 'in' ? 'pendiente_cobro' : 'pendiente_entrega') : 'completada';
    data.settleSide = side;
  }
  if (existing) { Object.assign(existing, data); toast('Cambio actualizado'); }
  else {
    data.id = S.uid(); data.createdAt = Date.now();
    state.exchanges.push(data);
    var pr = C.exchangeProfit(data, rates()).profit;
    toastAction('Cambio guardado · ganancia ' + fmtSigned(pr, base()), 'Comprobante', function () { openReceipt('fx', data.id); });
  }
  var last = state.settings.last;
  last.fxIn = data.inCurrency; last.fxOut = data.outCurrency; last.fxInAcc = data.inAccountId; last.fxOutAcc = data.outAccountId;
  last.fxComMode = data.commission.mode; last.fxComValue = data.commission.value; last.fxComCharge = data.commission.charge;
  resetFxForm();
  persist();
}

var FX_STATUS = { completada: '', pendiente_entrega: '<span class="tag warn">Falta entregar</span>', pendiente_cobro: '<span class="tag warn">Falta cobrar</span>' };
function fxStatusTag(x) {
  var st = C.exchangeSettlement(x);
  if (!st || st.status === 'pagada') return FX_STATUS[x.status] || '';
  return '<span class="tag warn">' + (st.side === 'in' ? 'Falta cobrar ' : 'Falta entregar ') + fmtMoney(st.pending, st.currency) + '</span>';
}

function renderExchanges() {
  if (accTab !== 'cambios') return;
  var b = base(), ym = thisMonth();
  var month = state.exchanges.filter(function (x) { return x.date.slice(0, 7) === ym && x.status === 'completada'; });
  var stats = function (list) {
    var pr = list.map(function (x) { return C.exchangeProfit(x, rates()); });
    return { n: list.length, profit: C.sum(pr.map(function (p) { return p.profit; })), volume: C.sum(pr.map(function (p) { return p.received; })),
      com: C.sum(pr.map(function (p) { return p.commission; })), costs: C.sum(pr.map(function (p) { return p.costs; })) };
  };
  var m = stats(month);
  $('#fx-month-name').textContent = new Date(ym + '-15T12:00').toLocaleDateString(LOCALE, { month: 'long' });
  $('#fx-profit').innerHTML = '<span class="' + trend(m.profit) + '">' + fmtSigned(m.profit, b) + '</span>';
  $('#fx-stats').innerHTML = stat('Operaciones', String(m.n)) + stat('Volumen', fmtMoney(m.volume, b)) +
    stat('Comisiones', fmtMoney(m.com, b)) + stat('Costos pagados', fmtMoney(m.costs, b));

  var fm = $('#fx-month').value;
  var list = state.exchanges.filter(function (x) { return !fm || x.date.slice(0, 7) === fm; })
    .sort(function (a, c) { return a.date < c.date ? 1 : a.date > c.date ? -1 : (c.createdAt || 0) - (a.createdAt || 0); });
  var fs = stats(list.filter(function (x) { return x.status === 'completada'; }));
  var pend = list.filter(function (x) { return x.status !== 'completada'; }).length;
  $('#fx-totals').innerHTML = '<span>Ganancia <b class="' + trend(fs.profit) + '">' + fmtSigned(fs.profit, b) + '</b></span><span>Comisiones <b>' + fmtMoney(fs.com, b) + '</b></span>' +
    '<span>Costos <b>' + fmtMoney(fs.costs, b) + '</b></span><span>' + list.length + ' cambio(s)' + (pend ? ' · ' + pend + ' pendiente(s)' : '') + '</span>';
  var editing = $('#fx-form').editId.value;
  $('#fx-list').innerHTML = list.length ? list.map(function (x) {
    var pr = C.exchangeProfit(x, rates());
    return '<li class="clickable' + (editing === x.id ? ' editing' : '') + '" data-open-fx="' + x.id + '" tabindex="0" role="button">' +
      '<span class="avatar tr">' + icon('i-swap') + '</span>' +
      '<div class="main"><div class="title">' + esc(x.client || 'Cliente') + ' ' + fxStatusTag(x) + '</div>' +
      '<div class="sub">' + fmtDate(x.date) + ' · ' + fmtMoney(x.received, x.inCurrency) + ' → ' + fmtMoney(x.delivered, x.outCurrency) +
      ' · comisión ' + fmtMoney(x.commissionAmount, x.inCurrency) + ((x.costs || []).length ? ' · costos ' + fmtMoney(pr.costs, b) : '') + '</div></div>' +
      '<div class="amt"><span class="' + (x.status === 'completada' ? trend(pr.profit) : 'muted') + '">' + fmtSigned(pr.profit, b) + '</span>' +
      '<div class="sub">' + (x.status === 'completada' ? 'ganancia' : 'prevista') + '</div></div></li>';
  }).join('') : '<li class="empty">Sin cambios en este periodo.</li>';
}

/** Mantiene al día las listas de monedas y cuentas (p. ej. al añadir USDT o una cuenta nueva). */
function refreshThirdPartySelects() {
  var f = $('#fx-form'), cur = currencyOptions();
  ['inCurrency', 'outCurrency', 'comCurrency'].forEach(function (n) { fillSelect(f[n], cur, f[n].value); });
  fillSelect(f.inAccountId, accountsFor(f.inCurrency.value, 'Ninguna (no la registro)'), f.inAccountId.value);
  fillSelect(f.outAccountId, accountsFor(f.outCurrency.value, 'Ninguna (no la registro)'), f.outAccountId.value);
  $$('#fx-costs .cost-row').forEach(function (r) {
    var c = r.querySelector('[data-c="currency"]'), a = r.querySelector('[data-c="accountId"]');
    fillSelect(c, cur, c.value); fillSelect(a, accountsFor(c.value, 'Ninguna'), a.value);
  });
  var df = $('#debt-form');
  fillSelect(df.currency, cur, df.currency.value);
  renderDebtAccountSelect();
}

function renderThirdParty() {
  refreshThirdPartySelects();
  renderPeople();
  renderDebts();
  renderExchanges();
  renderSales();
  renderLoans();
  renderClients();
}
