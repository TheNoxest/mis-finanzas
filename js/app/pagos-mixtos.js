/* =========================================================================
 * app/pagos-mixtos.js — Pagos mixtos: repartir un monto entre varias cuentas.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ pagos mixtos (varias cuentas)
var payMix = null, fxInMix = null, fxOutMix = null, saleMix = null, txMix = null, loanMix = null, debtMix = null;
/** Cuentas para una parte del pago en `cur`: la misma moneda o una de igual valor (USD ↔ USDT). */
function mixAccountOptions(cur) {
  return [{ value: '', label: 'Elige la cuenta' }].concat(state.accounts.filter(function (ac) { return C.samePeg(ac.currency, cur); })
    .map(function (ac) { return { value: ac.id, label: ac.name + (ac.currency !== cur ? ' (' + ac.currency + ')' : '') }; }));
}
/**
 * Añade «Dividir entre varias cuentas» bajo el selector de cuenta `sel`.
 * opts: { total: () => monto a repartir, currency: () => moneda }
 */
function mixInit(sel, opts) {
  var lab = sel.closest('label'), box = document.createElement('div');
  box.className = 'mix-box span2' + ['only-contado', 'only-flow'].filter(function (k) { return lab.classList.contains(k); }).map(function (k) { return ' ' + k; }).join('');
  box.innerHTML = '<button type="button" class="link small mix-on" data-mix="on">＋ Dividir entre varias cuentas</button>' +
    '<div class="mix-panel hidden"><div class="mix-head"><span class="mix-title"></span>' +
    '<button type="button" class="link small" data-mix="off">Una sola cuenta</button></div>' +
    '<div class="mix-rows"></div>' +
    '<div class="mix-foot"><button type="button" class="link small" data-mix="add">＋ Otra cuenta</button><span class="mix-status" role="status"></span></div></div>';
  lab.after(box);
  var m = { sel: sel, lab: lab, box: box, opts: opts, on: false, touched: false };
  box._mix = m;
  return m;
}
function mixLabel(m) {
  var span = m.lab.querySelector('span');
  return (span ? span.textContent : (m.lab.firstChild && m.lab.firstChild.nodeValue) || '').trim();
}
function mixRow(m, accId, amount) {
  var row = document.createElement('div');
  row.className = 'mix-row';
  row.innerHTML = '<select aria-label="Cuenta"></select><input type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="Monto">' +
    '<button type="button" class="mini" data-mix="del" aria-label="Quitar">' + icon('i-x') + '</button>';
  fillSelect(row.querySelector('select'), mixAccountOptions(m.opts.currency()), accId || '');
  if (amount) row.querySelector('input').value = amount;
  m.box.querySelector('.mix-rows').appendChild(row);
  return row;
}
function mixRows(m) {
  return $$('.mix-row', m.box).map(function (r) { return { row: r, accountId: r.querySelector('select').value, amount: num(r.querySelector('input').value) || 0 }; });
}
function mixShow(m) {
  m.lab.classList.toggle('mix-hide', m.on);
  m.box.querySelector('.mix-on').classList.toggle('hidden', m.on);
  m.box.querySelector('.mix-panel').classList.toggle('hidden', !m.on);
  if (!m.on) m.box.querySelector('.mix-rows').innerHTML = '';
}
function mixOn(m) {
  if (!m || m.on) return;
  var cur = m.opts.currency(), first = m.sel.value;
  var other = state.accounts.filter(function (ac) { return C.samePeg(ac.currency, cur) && ac.id !== first; })[0];
  m.on = true; m.touched = false;
  m.box.querySelector('.mix-rows').innerHTML = '';
  mixRow(m, first, 0); var r2 = mixRow(m, other ? other.id : '', 0);
  mixShow(m); mixSync(m);
  r2.querySelector('input').focus();
}
/** Vuelve a una sola cuenta: la de la primera parte con cuenta. */
function mixOff(m) {
  if (!m || !m.on) return;
  var keep = mixRows(m).filter(function (r) { return r.accountId; })[0];
  if (keep) m.sel.value = keep.accountId;
  m.on = false; mixShow(m);
}
function mixReset(m) { if (m) { m.on = false; mixShow(m); } }
/** Muestra un reparto guardado (2 o más cuentas); si no hay, una sola cuenta. */
function mixSet(m, splits) {
  if (!m) return;
  mixReset(m);
  if (!splits || splits.length < 2) return;
  m.on = true; m.touched = true;
  splits.forEach(function (s) { mixRow(m, s.accountId, s.amount); });
  mixShow(m); mixSync(m);
}
/** Opciones de cuenta según la moneda actual (al cambiar la moneda del formulario). */
function mixRefill(m) {
  if (!m || !m.on) return;
  $$('.mix-row select', m.box).forEach(function (s) { fillSelect(s, mixAccountOptions(m.opts.currency()), s.value); });
}
/** La primera parte se queda con lo que falte hasta que la escribas a mano; muestra cuánto falta repartir. */
function mixSync(m) {
  if (!m || !m.on) return;
  var total = C.round(m.opts.total() || 0, 2), rows = mixRows(m), cur = m.opts.currency();
  if (!m.touched && rows.length) {
    var rest = C.round(total - C.sum(rows.slice(1).map(function (r) { return r.amount; })), 2);
    rows[0].row.querySelector('input').value = rest > 0 ? rest : '';
    rows[0].amount = rest > 0 ? rest : 0;
  }
  var ck = C.checkSplits(rows, total), n2 = function (v) { return fmtNum(v, 2, 2) + ' ' + cur; };
  m.box.querySelector('.mix-title').textContent = mixLabel(m) + ' · total ' + n2(total);
  var st = m.box.querySelector('.mix-status');
  st.className = 'mix-status ' + (ck.error ? 'down' : 'up');
  st.textContent = ck.error === 'cuenta' ? 'Elige la cuenta de cada monto' : ck.remaining > 0 ? 'Falta repartir ' + n2(ck.remaining)
    : ck.remaining < 0 ? 'Te pasas por ' + n2(-ck.remaining) : '✓ Repartido';
}
/** Para guardar: null (una sola cuenta: usar el selector) · { accountId, splits } · { error }. */
function mixRead(m) {
  if (!m || !m.on) return null;
  var ck = C.checkSplits(mixRows(m), C.round(m.opts.total() || 0, 2)), cur = m.opts.currency();
  if (ck.error === 'cuenta') return { error: 'Pago mixto: elige la cuenta de cada monto' };
  if (ck.error) return { error: 'Pago mixto: ' + (ck.remaining > 0 ? 'falta repartir ' : 'el reparto se pasa por ') + fmtNum(Math.abs(ck.remaining), 2, 2) + ' ' + cur };
  return { accountId: ck.list.length ? ck.list[0].accountId : null, splits: ck.mixed ? ck.list : null };
}
/** Cuenta(s) del pago que se registra en la tarjeta de cobros/pagos. */
function payTarget(f) {
  var mx = mixRead(payMix);
  return mx || { accountId: f.accountId.value || null, splits: null };
}
function withSplits(obj, t) { if (t.splits) obj.splits = t.splits; return obj; }
/** «Zelle» o, si fue mixto, «Zelle USD 60.00 + Efectivo USD 40.00». */
function payAccText(pm, cur) {
  var list = C.paySplits(pm);
  if (!list.length) return 'sin cuenta';
  if (list.length === 1) return esc(accName(list[0].accountId));
  return list.map(function (s) { var ac = account(s.accountId); return esc(accName(s.accountId)) + ' ' + fmtMoney(s.amount, ac ? ac.currency : cur); }).join(' + ');
}
function bindMix() {
  var pf = $('#pay-form'), fx = $('#fx-form'), sf = $('#sale-form'), tf = $('#tx-form'), lf = $('#loan-form'), dfm = $('#debt-form');
  payMix = mixInit(pf.accountId, { total: function () { return num(pf.amount.value); }, currency: function () { return pf.dataset.cur || base(); } });
  fxInMix = mixInit(fx.inAccountId, { total: function () { return C.exchangeQuote(fxDraft(), rates()).received; }, currency: function () { return fx.inCurrency.value; } });
  fxOutMix = mixInit(fx.outAccountId, { total: function () { return num(fx.delivered.value); }, currency: function () { return fx.outCurrency.value; } });
  saleMix = mixInit(sf.accountId, { total: function () { return C.round((sf.quantity.value.trim() ? num(sf.quantity.value) : 1) * num(sf.unitPrice.value), 2); }, currency: function () { return sf.currency.value; } });
  txMix = mixInit(tf.accountId, { total: function () { return parseAmount(tf.amount.value) || 0; },
    currency: function () { return (account(tf.accountId.value) || {}).currency || base(); } });
  loanMix = mixInit(lf.accountId, { total: function () { return num(lf.principal.value) || 0; }, currency: function () { return lf.currency.value; } });
  debtMix = mixInit(dfm.accountId, { total: function () { return num(dfm.amount.value) || 0; }, currency: function () { return dfm.currency.value; } });
  var all = [payMix, fxInMix, fxOutMix, saleMix, txMix, loanMix, debtMix];
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-mix]'); if (!b) return;
    var m = b.closest('.mix-box')._mix, act = b.dataset.mix;
    if (act === 'on') mixOn(m);
    else if (act === 'off') mixOff(m);
    else if (act === 'add') {
      var ck = C.checkSplits(mixRows(m), m.opts.total() || 0);
      m.touched = true;
      var r = mixRow(m, '', ck.remaining > 0 ? ck.remaining : 0); mixSync(m); r.querySelector('select').focus();
    } else if (act === 'del') {
      b.closest('.mix-row').remove();
      if (mixRows(m).length < 2) mixOff(m); else mixSync(m);
    }
  });
  [pf, fx, sf, tf, lf, dfm].forEach(function (form) {
    form.addEventListener('input', function (e) {
      var row = e.target.closest('.mix-row');
      all.forEach(function (m) {
        if (m.box.parentNode && form.contains(m.box)) {
          if (row && m.box.contains(row) && e.target.tagName === 'INPUT' && row === m.box.querySelector('.mix-row')) m.touched = true;
          mixSync(m);
        }
      });
    });
    form.addEventListener('change', function (e) {
      all.forEach(function (m) {
        if (!form.contains(m.box)) return;
        if (/currency/i.test(e.target.name || '')) mixRefill(m);
        mixSync(m);
      });
    });
  });
}
