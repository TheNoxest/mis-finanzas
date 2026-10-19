/* =========================================================================
 * app/cuentas.js — Mis cuentas (lista y formulario).
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ cuentas
function renderAccounts() {
  var b = base();
  var ym = thisMonth();
  var list = C.accountBalances(state, monthRange(ym));
  var total = C.sum(list.map(function (a) { return isNaN(a.balanceBase) ? 0 : a.balanceBase; }));
  var month = C.summarizeTransactions(flows(), rates(), monthRange(ym));
  $('#acc-total').textContent = fmtMoney(total, b);
  $('#acc-month').innerHTML = 'Este mes: <span class="up">+' + fmtMoney(month.income, b) + '</span> ingresos · −' + fmtMoney(month.expense, b) + ' gastos';

  $('#acc-grid').innerHTML = list.length ? list.map(function (a) {
    var acc = a.account;
    var h = C.accountHoldings(state, acc.id);
    var assets = h.portfolio.rows.length
      ? '<div class="acc-assets">' + h.portfolio.rows.slice(0, 4).map(function (r) { return logoHtml(r.position.assetType, r.position.ticker, 'mini-logo'); }).join('') +
        '<span>Activos <b>' + fmtMoney(h.portfolio.value, b) + '</b> · Total <b>' + fmtMoney(h.total, b) + '</b></span></div>' : '';
    return '<div class="acc-card clickable-card" data-open-account="' + acc.id + '" tabindex="0" role="button" aria-label="Abrir ' + esc(acc.name) + '">' +
      '<div class="acc-top"><span class="avatar">' + icon(KIND_ICONS[acc.kind] || 'i-wallet') + '</span>' +
      '<div class="main"><div class="acc-name">' + esc(acc.name) + '</div><div class="acc-kind">' + esc(S.ACCOUNT_KINDS[acc.kind] || '') + ' · ' + esc(acc.currency) + '</div></div></div>' +
      '<div class="acc-balance ' + (a.balance < 0 ? 'down' : '') + '">' + fmtMoney(a.balance, acc.currency) +
      (acc.currency !== b ? '<small>≈ ' + fmtMoney(a.balanceBase, b) + '</small>' : '<small>Saldo actual</small>') + '</div>' +
      assets +
      '<div class="acc-flow"><span>Entró este mes <b class="up">+' + fmtMoney(a.inflow, acc.currency) + '</b></span>' +
      '<span>Salió <b>−' + fmtMoney(a.outflow, acc.currency) + '</b></span></div>' +
      '<div class="acc-actions"><button type="button" data-open-account="' + acc.id + '">Abrir</button>' +
      '<button type="button" data-edit-acc="' + acc.id + '">Editar</button></div>' +
      '</div>';
  }).join('') : '<div class="card muted">Todavía no tienes cuentas. Crea la primera abajo: tu banco, tu efectivo o tu billetera digital.</div>';
}

function resetAccForm() {
  var f = $('#acc-form');
  f.reset(); f.editId.value = '';
  f.currency.value = base(); f.currency.disabled = false;
  $('#acc-form-title').textContent = 'Nueva cuenta';
  $('[data-action="cancel-acc"]').classList.add('hidden');
  $('[data-action="delete-acc"]').classList.add('hidden');
}

function editAcc(id) {
  var a = account(id); if (!a) return;
  if (!$('#view-cuentas').classList.contains('active') || accTab !== 'cuentas') showView('cuentas');
  var f = $('#acc-form');
  f.editId.value = a.id; f.label.value = a.name; f.kind.value = a.kind; f.currency.value = a.currency;
  f.initialBalance.value = a.initialBalance || '';
  var used = accountInUse(a.id);
  f.currency.disabled = used; // no se cambia la moneda de una cuenta con movimientos
  $('#acc-form-title').textContent = 'Editar cuenta';
  $('[data-action="cancel-acc"]').classList.remove('hidden');
  var del = $('[data-action="delete-acc"]');
  del.classList.remove('hidden');
  del.disabled = used;
  del.title = used ? 'Tiene movimientos: no se puede eliminar' : '';
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  f.label.focus();
}

async function onAccSubmit(e) {
  e.preventDefault();
  var f = e.target;
  var name = f.label.value.trim();
  if (!name) { toast('Ponle un nombre a la cuenta'); f.label.focus(); return; }
  var initial = f.initialBalance.value === '' ? 0 : num(f.initialBalance.value);
  if (!isFinite(initial)) { toast('Saldo inicial inválido'); return; }
  var data = { name: name, kind: f.kind.value, currency: f.currency.value, initialBalance: C.round(initial, 2) };
  // Moneda nueva: se añade y se conecta a su tasa antes de guardar
  if (!(Number(rates()[data.currency]) > 0) && data.currency !== base()) {
    toast('Conectando la tasa de ' + data.currency + '…');
    if (!(await ensureCurrency(data.currency))) {
      toast('No pude obtener la tasa de ' + data.currency + '. Revisa tu conexión o añádela a mano en Ajustes.');
      return;
    }
  }
  if (f.editId.value) {
    var a = account(f.editId.value);
    if (accountInUse(a.id)) data.currency = a.currency;
    if (a.initialBalance !== data.initialBalance) state.snapshots = {}; // cambia todo el historial
    Object.assign(a, data);
    toast('Cuenta actualizada');
  } else {
    data.id = S.uid(); data.createdAt = Date.now();
    state.accounts.push(data);
    toast('Cuenta «' + name + '» creada');
  }
  resetAccForm();
  persist();
}
