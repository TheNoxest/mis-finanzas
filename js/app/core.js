/* =========================================================================
 * app/core.js — Base de la interfaz: estado, formatos, búsquedas, navegación y selectores. Se carga PRIMERO.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';


var C = window.Calc, S = window.Store, P = window.Prices;
var state = S.load();

var $ = function (s, el) { return (el || document).querySelector(s); };
var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

var ASSET_LABELS = { accion: 'Acción', etf: 'ETF', cripto: 'Cripto', divisa: 'Divisa', otro: 'Otro' };
// Color fijo por tipo de activo (sigue a la entidad, nunca al ranking).
var ASSET_COLORS = { accion: 'var(--s1)', etf: 'var(--s2)', cripto: 'var(--s3)', divisa: 'var(--s4)', otro: 'var(--s5)' };
var KIND_ICONS = { banco: 'i-bank', efectivo: 'i-cash', billetera: 'i-phone', broker: 'i-chart', ahorro: 'i-piggy', otro: 'i-wallet' };
var LOCALE = (navigator.language || 'es').toLowerCase().indexOf('es') === 0 ? navigator.language : 'es';
var REFRESH_MS = 2 * 60 * 1000;

// ================================================================ formato
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmtNum(v, minDp, maxDp) {
  return Number(v).toLocaleString(LOCALE, { minimumFractionDigits: minDp || 0, maximumFractionDigits: maxDp == null ? 8 : maxDp });
}
var UI_KEY = 'misFinanzas.ui';   // preferencias de este dispositivo (no se sincronizan)
function uiPrefs() { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; } }
function setUiPref(k, v) { var p = uiPrefs(); p[k] = v; try { localStorage.setItem(UI_KEY, JSON.stringify(p)); } catch (e) { /* sin almacenamiento */ } }
var privacy = !!(uiPrefs().privacyOnOpen || uiPrefs().privacy);
var MASK = '••••';
function fmtMoney(v, cur) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  if (privacy) return cur + ' ' + MASK;
  try {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  } catch (e) { // códigos no ISO (p. ej. USDT)
    return fmtNum(v, 2, 2) + ' ' + cur;
  }
}
/** Precio unitario: más decimales para valores pequeños (cripto). */
function fmtPrice(v, cur) {
  if (v == null || isNaN(v)) return '—';
  var dp = Math.abs(v) >= 1 ? 2 : Math.abs(v) >= 0.01 ? 4 : 8;
  try {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: dp }).format(v);
  } catch (e) { return fmtNum(v, 2, dp) + ' ' + cur; }
}
/** Con signo explícito, para que ganancia/pérdida no dependa solo del color. */
function fmtSigned(v, cur) { return (v > 0 ? '+' : v < 0 ? '−' : '') + fmtMoney(Math.abs(v), cur); }
function fmtPct(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v), 2, 2) + ' %'; }
function trend(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
function fmtDate(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function fmtTime(ms) {
  if (!ms) return '';
  var d = new Date(ms), now = new Date();
  var t = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? t : d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit' }) + ' ' + t;
}
function icon(id) { return '<svg class="ic"><use href="#' + id + '"/></svg>'; }
var base = function () { return state.settings.baseCurrency; };
var rates = function () { return state.settings.rates; };

function toast(msg) {
  var t = $('#toast');
  t.textContent = msg;
  t.classList.remove('actionable');
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
}
/** Aviso con un botón (p. ej. «Deshacer»); se mantiene 6 s. */
function toastAction(msg, label, fn) {
  var t = $('#toast');
  t.innerHTML = '<span>' + esc(msg) + '</span><button type="button" class="toast-btn">' + esc(label) + '</button>';
  t.classList.add('show', 'actionable');
  t.querySelector('.toast-btn').onclick = function () { t.classList.remove('show', 'actionable'); clearTimeout(toast._t); fn(); };
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.classList.remove('show', 'actionable'); }, 6000);
}

// ================================================================ lookups
function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
function catName(id) {
  if (id === '__cambios') return 'Cambios de divisa';
  if (id === '__comisiones') return 'Comisiones de transferencia';
  if (id === '__ventas') return 'Ventas';
  if (id === '__intereses') return 'Intereses de préstamos';
  if (id === '__intereses_pag') return 'Intereses pagados';
  var c = byId(state.categories, id); return c ? c.name : 'Sin categoría';
}
/** Movimientos para informes: los tuyos + ganancia de cambios de divisas completados. */
function flows() { return C.flowTransactions(state); }
function methodName(id) { var m = byId(state.methods, id); return m ? m.name : ''; }
function account(id) { return byId(state.accounts, id); }
function accName(id) { var a = account(id); return a ? a.name : 'Cuenta eliminada'; }
var CORE = ['USD', 'USDT', 'EUR'];
/** Monedas que se pueden elegir al abrir una cuenta (se añaden solas a las tasas al usarlas). */
var CURRENCY_CATALOG = [
  ['USD', 'Dólar estadounidense'], ['USDT', 'Tether (1 USD)'], ['EUR', 'Euro'], ['USDC', 'USD Coin (1 USD)'],
  ['GBP', 'Libra esterlina'], ['CAD', 'Dólar canadiense'], ['CHF', 'Franco suizo'], ['MXN', 'Peso mexicano'],
  ['COP', 'Peso colombiano'], ['ARS', 'Peso argentino'], ['BRL', 'Real brasileño'], ['CLP', 'Peso chileno'],
  ['PEN', 'Sol peruano'], ['VES', 'Bolívar venezolano'], ['DOP', 'Peso dominicano'], ['UYU', 'Peso uruguayo'],
  ['TRY', 'Lira turca'], ['JPY', 'Yen japonés'], ['CNY', 'Yuan chino']
];
function accountCurrencyOptions() {
  var names = {}; CURRENCY_CATALOG.forEach(function (c) { names[c[0]] = c[1]; });
  var codes = currencies().slice();
  CURRENCY_CATALOG.forEach(function (c) { if (codes.indexOf(c[0]) === -1) codes.push(c[0]); });
  return codes.map(function (c) { return { value: c, label: c + (names[c] ? ' · ' + names[c] : '') }; });
}
/**
 * Garantiza que una moneda tenga tasa: USDT/USDC = USD; las demás se conectan a las tasas automáticas
 * (en vivo si Binance tiene par). Devuelve true si quedó disponible.
 */
async function ensureCurrency(code) {
  var r = rates();
  if (Number(r[code]) > 0 || code === base()) return true;
  if (C.PEGGED[code]) {
    if (!(C.rateOf(r, 'USD') > 0)) { try { await P.refreshRates(state.settings, ['USD']); } catch (e) { /* sin conexión */ } }
    if (C.rateOf(r, 'USD') > 0) { r[code] = C.rateOf(r, 'USD'); return true; }
    return false;
  }
  try { await P.refreshRates(state.settings, [code]); } catch (e) { /* sin conexión */ }
  return Number(r[code]) > 0;
}
function currencies() {
  var b = base();
  var rank = function (c) { return c === b ? -1 : CORE.indexOf(c) !== -1 ? CORE.indexOf(c) : 99; };
  return Object.keys(rates()).sort(function (a, c) { return rank(a) - rank(c) || a.localeCompare(c); });
}
function currencyInUse(code) {
  return state.accounts.some(function (a) { return a.currency === code; }) ||
         state.investments.some(function (i) { return i.currency === code; }) ||
         state.debts.some(function (d) { return d.currency === code; }) ||
         state.exchanges.some(function (x) { return x.inCurrency === code || x.outCurrency === code; });
}
function accountInUse(id) {
  var spl = function (r) { return (r.splits || []).some(function (s) { return s.accountId === id; }); };
  return state.transactions.some(function (t) { return t.accountId === id || t.fromAccountId === id || t.toAccountId === id || spl(t); }) ||
         state.investments.some(function (i) { return i.accountId === id; }) ||
         state.debts.some(function (d) { return d.accountId === id || spl(d) || paysUse(d.payments, id); }) ||
         (state.sales || []).some(function (sv) { return C.splitAmount(C.splitsOf(sv.splits, sv.accountId, sv.amount), id) || sv.accountId === id || paysUse(sv.payments, id); }) ||
         (state.loans || []).some(function (l) { return l.accountId === id || spl(l) || paysUse(l.payments, id); }) ||
         state.exchanges.some(function (x) {
           return C.fxSplits(x, 'in').concat(C.fxSplits(x, 'out')).some(function (s) { return s.accountId === id; }) ||
             x.inAccountId === id || x.outAccountId === id || paysUse(x.settlements, id) || (x.costs || []).some(function (c) { return c.accountId === id; });
         });
}
function paysUse(list, id) {
  return (list || []).some(function (p) { return p.accountId === id || C.paySplits(p).some(function (s) { return s.accountId === id; }); });
}
function monthRange(ym) {
  var p = ym.split('-').map(Number);
  var lastDay = new Date(p[0], p[1], 0).getDate();
  return { from: ym + '-01', to: ym + '-' + String(lastDay).padStart(2, '0') };
}
function thisMonth() { return S.today().slice(0, 7); }

function persist() { S.save(state); renderAll(); maybeAutoBackup(); }
var lastAutoCheck = 0;
function maybeAutoBackup() {
  if (!window.Backups || Date.now() - lastAutoCheck < 600000) return;
  lastAutoCheck = Date.now();
  Backups.auto(state).then(renderVersionsCard);
}
/** Copia preventiva antes de un cambio grande (no bloquea si IndexedDB no está disponible). */
function safetyBackup(reason) {
  if (!window.Backups) return Promise.resolve();
  return Backups.save(state, reason).catch(function () { /* sin IndexedDB */ });
}
/** Reemplaza todos los datos por otros (restauración): copia previa, marca todo como reciente y guarda. */
async function replaceState(newState, reason, msg) {
  await safetyBackup('antes de ' + reason);
  state = S.touchAll(S.normalize(newState));
  resetTxForm(); resetInvForm(); resetAccForm();
  persist();
  toast(msg);
  if (Sync.config().enabled) Sync.syncNow();
}

// ================================================================ navegación
var VIEWS = ['inicio', 'movimientos', 'cuentas', 'inversiones', 'analisis', 'consejos', 'ajustes', 'cuenta'];
function showView(name) {
  var parts = String(name || '').split('/');
  if (parts[0] === 'activo') {
    if (parts[1] && parts[2]) { openAsset(decodeURIComponent(parts[1]), decodeURIComponent(parts[2])); return; }
    name = 'inversiones';
  }
  if (parts[0] === 'cuenta') {
    if (parts[1] && account(decodeURIComponent(parts[1]))) { openAccount(decodeURIComponent(parts[1])); return; }
    name = 'cuentas';
  }
  currentAccountId = null;
  closeAsset();
  if (parts[0] === 'cuentas') { accTab = ['cobrar', 'pagar', 'cambios', 'ventas', 'prestamos', 'clientes'].indexOf(parts[1]) !== -1 ? parts[1] : 'cuentas'; name = 'cuentas'; }
  if (VIEWS.indexOf(name) === -1) name = 'inicio';
  $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
  $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
  $('#settings-btn').classList.toggle('active', name === 'ajustes');
  Charts.hideTip();
  if (name === 'analisis') setTimeout(renderAnalysis, 0); // necesita el ancho visible
  if (name === 'inversiones') loadExplore(false);
  if (name === 'ajustes') { cloudVersions = null; renderVersionsCard(); }
  if (name === 'cuentas') setAccTab(accTab);
  var h = '#' + name + (name === 'cuentas' && accTab !== 'cuentas' ? '/' + accTab : '');
  if (location.hash !== h) history.replaceState(null, '', h);
  window.scrollTo(0, 0);
  if (name === 'movimientos' && !$('#tx-form').editId.value && window.matchMedia('(pointer: fine)').matches) {
    setTimeout(function () { $('#tx-form').amount.focus(); }, 0);
  }
}

// ================================================================ selects
function fillSelect(sel, options, value) {
  var prev = value !== undefined ? value : sel.value;
  sel.innerHTML = options.map(function (o) {
    return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>';
  }).join('');
  if (options.some(function (o) { return o.value === prev; })) sel.value = prev;
}
function currencyOptions() { return currencies().map(function (c) { return { value: c, label: c }; }); }
function accountOptions() {
  return state.accounts.map(function (a) { return { value: a.id, label: a.name + ' · ' + a.currency }; });
}

function renderSelects() {
  var last = state.settings.last;
  var tf = $('#tx-form'), inv = $('#inv-form'), af = $('#acc-form');
  var accOpts = accountOptions();
  fillSelect(tf.accountId, accOpts, tf.accountId.value || last.accountId);
  fillSelect(tf.fromAccountId, accOpts, tf.fromAccountId.value || last.fromAccountId);
  fillSelect(tf.toAccountId, accOpts, tf.toAccountId.value || last.toAccountId);
  if (tf.toAccountId.value === tf.fromAccountId.value && accOpts.length > 1) {
    tf.toAccountId.value = accOpts.filter(function (o) { return o.value !== tf.fromAccountId.value; })[0].value;
  }
  fillSelect(tf.methodId, [{ value: '', label: '—' }].concat(state.methods.map(function (m) { return { value: m.id, label: m.name }; })),
    tf.methodId.value || last.methodId || '');
  renderCategorySelect();
  fillSelect(inv.currency, currencyOptions(), inv.currency.value || last.invCurrency || base());
  renderInvAccountSelect();
  fillSelect(af.currency, accountCurrencyOptions(), af.currency.value || base());
  fillSelect(af.kind, Object.keys(S.ACCOUNT_KINDS).map(function (k) { return { value: k, label: S.ACCOUNT_KINDS[k] }; }));
  fillSelect($('#base-select'), currencyOptions(), base());
  fillSelect($('#f-account'), [{ value: '', label: 'Todas las cuentas' }].concat(accOpts));

  // Filtros del análisis
  var catSel = $('#a-category'), prevCat = catSel.value;
  catSel.innerHTML = '<option value="">Todas las categorías</option>' + ['ingreso', 'egreso'].map(function (type) {
    return '<optgroup label="' + (type === 'ingreso' ? 'Ingresos' : 'Gastos') + '">' + state.categories.filter(function (c) { return c.type === type; })
      .map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</optgroup>';
  }).join('');
  if (byId(state.categories, prevCat)) catSel.value = prevCat;
  fillSelect($('#a-account'), [{ value: '', label: 'Todas las cuentas' }].concat(accOpts));

  var tickers = {};
  state.investments.forEach(function (i) { tickers[i.ticker] = true; });
  $('#ticker-list').innerHTML = Object.keys(tickers).sort().map(function (t) { return '<option value="' + esc(t) + '">'; }).join('');
}

function renderCategorySelect() {
  var tf = $('#tx-form');
  var type = tf.type.value;
  if (type === 'transferencia') return;
  var prev = tf.categoryId.value;
  var opts = state.categories.filter(function (c) { return c.type === type; })
    .map(function (c) { return { value: c.id, label: c.name }; });
  fillSelect(tf.categoryId, opts, opts.some(function (o) { return o.value === prev; }) ? prev : state.settings.last['cat_' + type]);
}

/** En inversiones solo se ofrecen cuentas en la misma moneda (cálculo exacto). */
function renderInvAccountSelect() {
  var f = $('#inv-form');
  var cur = f.currency.value;
  var opts = [{ value: '', label: 'Ninguna (no descontar)' }].concat(state.accounts
    .filter(function (a) { return a.currency === cur; })
    .map(function (a) { return { value: a.id, label: a.name }; }));
  var prev = f.accountId.value || state.settings.last.invAccountId;
  fillSelect(f.accountId, opts, opts.some(function (o) { return o.value === prev; }) ? prev : '');
  $('#inv-acc-label').textContent = f.side.value === 'venta' ? 'Cobrado en' : 'Pagado desde';
  // Custodia: por defecto, la misma cuenta de pago (p. ej., lo comprado en Binance queda en Binance)
  var cust = [{ value: '', label: f.accountId.value ? 'La misma cuenta (' + accName(f.accountId.value) + ')' : 'Sin especificar' }]
    .concat(state.accounts.filter(function (a) { return a.id !== f.accountId.value; }).map(function (a) { return { value: a.id, label: a.name + ' · ' + a.currency }; }));
  fillSelect(f.custodyAccountId, cust, f.custodyAccountId.value);
}
