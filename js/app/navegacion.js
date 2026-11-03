/* =========================================================================
 * app/navegacion.js — Barra de abajo por tareas (Inicio · Movimientos · Operaciones · Clientes · Patrimonio),
 * subpestañas de cada sección, formularios plegados con su botón «＋ Nuevo…» y el «+» con todos los tipos.
 * Las pantallas (y sus direcciones #cuentas/cambios, #inversiones…) son las mismas: aquí solo se decide
 * a qué sección pertenece cada una.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

var SECTIONS = {
  operaciones: [['cuentas/cambios', 'Cambios'], ['cuentas/ventas', 'Ventas'], ['cuentas/prestamos', 'Préstamos'], ['cuentas/cobrar', 'Pendientes']],
  patrimonio: [['cuentas', 'Cuentas'], ['inversiones', 'Inversiones'], ['analisis', 'Análisis'], ['consejos', 'Consejos']]
};
/** Sección de la barra de abajo a la que pertenece una pantalla (null = Ajustes). */
function sectionOf(view, tab) {
  if (view === 'inicio' || view === 'movimientos') return view;
  if (view === 'cuentas') return tab === 'clientes' ? 'clientes' : tab === 'cuentas' ? 'patrimonio' : 'operaciones';
  if (view === 'cuenta' || view === 'activo' || view === 'inversiones' || view === 'analisis' || view === 'consejos') return 'patrimonio';
  return null;
}
/** Subpestaña resaltada dentro de su sección (Por pagar comparte «Pendientes» con Por cobrar). */
function subKey(view, tab) {
  if (view === 'cuentas') return tab === 'cuentas' ? 'cuentas' : 'cuentas/' + (tab === 'pagar' ? 'cobrar' : tab);
  if (view === 'cuenta') return 'cuentas';
  if (view === 'activo') return 'inversiones';
  return view;
}
/** Marca la sección en la barra de abajo y dibuja sus subpestañas; la barra recuerda la última subpestaña usada. */
function setSection(view, tab) {
  var sec = sectionOf(view, tab), key = subKey(view, tab), items = SECTIONS[sec], nav = $('#subnav');
  $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === sec); });
  nav.classList.toggle('hidden', !items);
  if (!items) return;
  nav.innerHTML = items.map(function (i) { return '<button type="button" role="tab" data-goto="' + i[0] + '" aria-selected="' + (i[0] === key) + '">' + i[1] + '</button>'; }).join('');
  if (items.some(function (i) { return i[0] === key; })) {
    $('#tabs [data-tab="' + sec + '"]').dataset.view = key;
    setUiPref('last_' + sec, key);
  }
}

// ---- Formularios plegados: la lista queda a la vista y el formulario se abre con «＋ Nuevo…», al editar o desde el «+»
var FG_GROUPS = ['tx', 'acc', 'debt', 'fx', 'sale', 'loan'];
function fgOpen(g, noScroll) {
  $$('[data-fgroup="' + g + '"]').forEach(function (el) { el.classList.remove('fg-closed'); });
  $$('[data-fbar="' + g + '"]').forEach(function (el) { el.classList.add('hidden'); });
  if (g === 'fx') setFxKind(fxKind());
  if (!noScroll) {
    var f = $$('[data-fgroup="' + g + '"]').filter(function (el) { return !el.classList.contains('hidden'); })[0];
    if (f) setTimeout(function () { f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 0);
  }
}
function fgClose(g) {
  $$('[data-fgroup="' + g + '"]').forEach(function (el) { el.classList.add('fg-closed'); });
  $$('[data-fbar="' + g + '"]').forEach(function (el) { el.classList.remove('hidden'); });
}
function fgCloseAll() { FG_GROUPS.forEach(fgClose); }

// Editar una operación abre su formulario (las funciones de edición se envuelven: se buscan por nombre al llamarlas)
[['editTx', 'tx'], ['editAcc', 'acc'], ['editDebt', 'debt'], ['editFx', 'fx'], ['editBroker', 'fx'], ['editSale', 'sale'], ['editLoan', 'loan']].forEach(function (p) {
  var orig = window[p[0]];
  if (typeof orig !== 'function') return;
  window[p[0]] = function () { fgOpen(p[1], true); return orig.apply(this, arguments); };
});
// «＋ Cambio» desde la ficha de un cliente
(function () {
  var orig = window.personNew, G = { cambio: 'fx', venta: 'sale', prestamo: 'loan', deuda: 'debt' };
  if (typeof orig === 'function') window.personNew = function (kind) { if (G[kind]) fgOpen(G[kind], true); if (kind === 'cambio') setFxKind('normal'); return orig.apply(this, arguments); };
})();
// Guardar con éxito (hubo persist durante el envío) pliega el formulario otra vez; Movimientos queda abierto para seguir registrando
var persistN = 0;
(function () { var orig = window.persist; window.persist = function () { persistN++; return orig.apply(this, arguments); }; })();
document.addEventListener('submit', function (e) { e.target.__pn = persistN; }, true);
document.addEventListener('submit', function (e) {
  var f = e.target, g = f.dataset && f.dataset.fgroup;
  if (!g || g === 'tx' || persistN <= (f.__pn || 0)) return;
  if (!(f.editId && f.editId.value)) fgClose(g);
});

// Botones «＋ Nuevo…», «Cancelar» y los tipos del «+»
var FG_CANCEL = { 'cancel-tx': 'tx', 'cancel-acc': 'acc', 'cancel-debt': 'debt', 'cancel-fx': 'fx', 'cancel-br': 'fx', 'cancel-sale': 'sale', 'cancel-loan': 'loan' };
function focusFirst(sel) { setTimeout(function () { var el = $(sel); if (el) el.focus({ preventScroll: true }); }, 60); }
function quickGo(kind) {
  closeQuick();
  if (kind === 'transfer') {
    showView('movimientos'); fgOpen('tx');
    var tf = $('#tx-form'); tf.type.value = 'transferencia'; renderCategorySelect(); syncTxForm(); focusFirst('#tx-form [name="amount"]');
  } else if (kind === 'exchange' || kind === 'broker') {
    showView('cuentas/cambios'); setFxKind(kind === 'broker' ? 'broker' : 'normal');
    if (kind === 'broker' && !$('#br-form').editId.value) resetBrForm();
    fgOpen('fx'); focusFirst(kind === 'broker' ? '#br-form [name="amount"]' : '#fx-form [name="client"]');
  } else if (kind === 'sale') { showView('cuentas/ventas'); fgOpen('sale'); focusFirst('#sale-form [name="client"]'); }
  else if (kind === 'loan') { showView('cuentas/prestamos'); fgOpen('loan'); focusFirst('#loan-form [name="person"]'); }
  else if (kind === 'debt') { showView('cuentas/cobrar'); fgOpen('debt'); focusFirst('#debt-form [name="person"]'); }
  else if (kind === 'collect') showView('cuentas/cobrar');
}
document.addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (!b) return;
  if (b.dataset.fgOpen) {
    var g = b.dataset.fgOpen;
    if (g === 'fx') { setFxKind(b.dataset.kind || 'normal'); if (b.dataset.kind === 'broker' && !$('#br-form').editId.value) resetBrForm(); }
    fgOpen(g);
    focusFirst({ tx: '#tx-form [name="amount"]', acc: '#acc-form [name="label"]', debt: '#debt-form [name="person"]', fx: b.dataset.kind === 'broker' ? '#br-form [name="amount"]' : '#fx-form [name="client"]',
      sale: '#sale-form [name="client"]', loan: '#loan-form [name="person"]' }[g]);
    return;
  }
  if (b.dataset.quick) { quickGo(b.dataset.quick); return; }
  if (FG_CANCEL[b.dataset.action]) fgClose(FG_CANCEL[b.dataset.action]);
});

// La barra de abajo abre la última subpestaña usada de cada sección
(function () {
  ['operaciones', 'patrimonio'].forEach(function (s) {
    var k = uiPrefs()['last_' + s], btn = $('#tabs [data-tab="' + s + '"]');
    if (btn && k && SECTIONS[s].some(function (i) { return i[0] === k; })) btn.dataset.view = k;
  });
})();
