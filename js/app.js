/* =========================================================================
 * app.js — Interfaz: renderizado, formularios y eventos.
 * Depende de Calc (calc.js), Store (store.js) y Prices (prices.js).
 * ========================================================================= */
(function () {
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

  // ================================================================ inicio
  function renderHome() {
    var b = base();
    var nw = C.netWorth(state, S.today());
    var pf = nw.portfolio;
    var ym = thisMonth();
    var month = C.summarizeTransactions(flows(), rates(), monthRange(ym));
    var top = C.totalsByCategory(flows(), rates(), 'egreso', monthRange(ym))[0];

    $('#hero-total').textContent = fmtMoney(nw.total, b);
    $('#hero-cash').textContent = fmtMoney(nw.cash, b);
    $('#hero-inv').textContent = fmtMoney(nw.invested, b);
    var third = [];
    if (nw.receivable > 0) third.push('<button type="button" data-goto="cuentas/cobrar">Te deben <b>' + fmtMoney(nw.receivable, b) + '</b></button>');
    if (nw.payable > 0) third.push('<button type="button" data-goto="cuentas/pagar">Debes <b>' + fmtMoney(nw.payable, b) + '</b></button>');
    $('#hero-third').innerHTML = third.join('<span aria-hidden="true">·</span>');
    $('#hero-third').classList.toggle('hidden', !third.length);
    $('#month-name').textContent = new Date(ym + '-15T12:00').toLocaleDateString(LOCALE, { month: 'long' });

    $('#t-expense').textContent = fmtMoney(month.expense, b);
    $('#t-month').innerHTML =
      kv('Ingresos', fmtMoney(month.income, b)) +
      kv('Ahorro neto', '<span class="' + trend(month.net) + '">' + fmtSigned(month.net, b) + '</span>' +
        (month.income > 0 ? ' <span class="muted">(' + fmtNum(month.savingsRate, 0, 1) + ' %)</span>' : '')) +
      kv('Mayor gasto', top ? esc(catName(top.categoryId)) + ' · ' + fmtMoney(top.total, b) : '—');

    if (pf.rows.length) {
      $('#t-pnl').innerHTML = '<span class="' + trend(pf.pnl) + '">' + fmtSigned(pf.pnl, b) + '</span> <span class="small ' + trend(pf.pnl) + '">' + fmtPct(pf.pnlPct) + '</span>';
      $('#t-inv').innerHTML =
        kv('Valor actual', fmtMoney(pf.value, b)) +
        kv('Cambio 24 h', '<span class="' + trend(pf.dayChange) + '">' + fmtSigned(pf.dayChange, b) + '</span>') +
        kv('Ganancia realizada', '<span class="' + trend(pf.realized) + '">' + fmtSigned(pf.realized, b) + '</span>');
    } else {
      $('#t-pnl').textContent = '—';
      $('#t-inv').innerHTML = '<div class="muted small">Aún no registras inversiones.</div>';
    }

    $('#home-accounts').innerHTML = nw.accounts.length ? nw.accounts.slice()
      .sort(function (a, c) { return (c.balanceBase || 0) - (a.balanceBase || 0); }).slice(0, 5)
      .map(function (a) {
        return '<li><span class="avatar">' + icon(KIND_ICONS[a.account.kind] || 'i-wallet') + '</span>' +
          '<div class="main"><div class="title">' + esc(a.account.name) + '</div><div class="sub">' + esc(S.ACCOUNT_KINDS[a.account.kind] || '') + '</div></div>' +
          '<div class="amt">' + fmtMoney(a.balance, a.account.currency) +
          (a.account.currency !== b ? '<div class="sub">≈ ' + fmtMoney(a.balanceBase, b) + '</div>' : '') + '</div></li>';
      }).join('') : '<li class="empty">Crea tu primera cuenta en la pestaña Cuentas.</li>';

    var recent = sortedTx().slice(0, 5);
    $('#recent').innerHTML = recent.length ? recent.map(function (t) { return txItem(t, false); }).join('')
      : '<li class="empty">Aún no hay movimientos. Registra el primero o carga datos de ejemplo en Ajustes.</li>';

    renderWarnings(pf);
    renderMonthSummary();
  }

  // ================================================================ resumen mensual
  function monthNameOf(ym) { return new Date(ym + '-15T12:00').toLocaleDateString(LOCALE, { month: 'long' }); }
  function summaryHelpers() {
    return { money: function (v) { return fmtMoney(v, base()); }, pct: function (v) { return fmtNum(C.round(v, 1), 0, 1) + ' %'; },
      monthName: monthNameOf, cat: catName };
  }
  function summaryHtml(ym, opts) {
    opts = opts || {};
    var s = Insights.monthlySummary(state, ym, S.today());
    if (!s.hasData) return '';
    var lines = Insights.summarySentences(s, summaryHelpers());
    var name = monthNameOf(ym);
    return '<div class="card summary-card"><div class="card-head"><h2>' + esc(opts.title || ('Resumen de ' + name)) + '</h2>' +
      (opts.dismiss ? '<button type="button" class="link small" data-action="summary-dismiss" data-month="' + ym + '">Ocultar</button>' : '') + '</div>' +
      '<ul class="summary-lines">' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></div>';
  }
  /** En Inicio: los primeros 7 días de cada mes, el resumen del mes anterior (hasta que lo ocultes). */
  function renderMonthSummary() {
    var box = $('#month-summary'), today = S.today();
    var prev = Insights.prevMonth(today.slice(0, 7));
    var show = Number(today.slice(8)) <= 7 && state.settings.summarySeen !== prev;
    box.innerHTML = show ? summaryHtml(prev, { dismiss: true }) : '';
  }

  function kv(k, v) { return '<div class="kv"><span>' + k + '</span><span>' + v + '</span></div>'; }

  function renderWarnings(pf) {
    var warn = [];
    var all = C.summarizeTransactions(flows(), rates());
    if (all.missingRates.length) warn.push('Faltan tasas de cambio para: ' + all.missingRates.join(', ') + '. Añádelas en Ajustes.');
    C.buildPositions(state.investments, rates()).errors.forEach(function (e) {
      warn.push('La venta de ' + e.wanted + ' ' + e.ticker + ' del ' + fmtDate(e.date) + ' supera lo disponible (' + e.available + ').');
    });
    if (pf.unpriced) warn.push(pf.unpriced + ' activo(s) sin precio: se valoran a costo. Revisa «Mis activos».');
    $('#warnings').innerHTML = warn.map(function (w) { return '<div class="warning">' + esc(w) + '</div>'; }).join('');
  }

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

  function renderTxList() {
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

  // ================================================================ inversiones
  function renderPortfolio() {
    var b = base();
    var res = C.buildPositions(state.investments, rates());
    var pf = C.valuePortfolio(res.positions, state.prices, rates());
    renderIdeas(pf);
    renderExplore();

    $('#pf-value').textContent = fmtMoney(pf.value, b);
    $('#pf-stats').innerHTML = pf.rows.length ?
      stat('Invertido', fmtMoney(pf.cost, b)) +
      stat('Ganancia / pérdida', '<span class="' + trend(pf.pnl) + '">' + fmtSigned(pf.pnl, b) + ' (' + fmtPct(pf.pnlPct) + ')</span>') +
      stat('Cambio 24 h', '<span class="' + trend(pf.dayChange) + '">' + fmtSigned(pf.dayChange, b) + '</span>') +
      stat('Realizada', '<span class="' + trend(pf.realized) + '">' + fmtSigned(pf.realized, b) + '</span>')
      : '<span class="muted">Registra tu primera compra para ver tu portafolio.</span>';

    // --- Distribución por tipo (barra 100 %) ---
    $('#dist-card').classList.toggle('hidden', !pf.rows.length);
    $('#dist-type').innerHTML = pf.byType.length ?
      '<div class="stack" role="img" aria-label="Distribución por tipo de activo">' + pf.byType.map(function (t) {
        return '<span style="width:' + t.weight + '%;background:' + ASSET_COLORS[t.assetType] + '" data-tip="' +
          esc(ASSET_LABELS[t.assetType] + ': ' + fmtMoney(t.value, b) + ' (' + fmtNum(t.weight, 1, 1) + ' %)') + '"></span>';
      }).join('') + '</div>' +
      '<div class="legend">' + pf.byType.map(function (t) {
        return '<span><i style="background:' + ASSET_COLORS[t.assetType] + '"></i>' + ASSET_LABELS[t.assetType] + '<b>' + fmtNum(t.weight, 1, 1) + ' %</b></span>';
      }).join('') + '</div>' : '';

    // --- Por activo (barras de un solo color; más de 8 → «Otros») ---
    var rows = pf.rows.slice(0, 8).map(function (r) { return { label: r.position.ticker, weight: r.weight, value: r.valueBase }; });
    if (pf.rows.length > 8) {
      var rest = pf.rows.slice(8);
      rows.push({ label: 'Otros', weight: C.sum(rest.map(function (r) { return r.weight; })), value: C.sum(rest.map(function (r) { return r.valueBase; })) });
    }
    var maxW = Math.max.apply(null, rows.map(function (r) { return r.weight; }).concat([1]));
    $('#dist-asset').innerHTML = rows.map(function (r) {
      return '<div class="hbar" data-tip="' + esc(r.label + ': ' + fmtMoney(r.value, b)) + '"><span class="lbl">' + esc(r.label) + '</span>' +
        '<span class="track"><span class="fill" style="width:' + (r.weight / maxW * 100) + '%;display:block"></span></span>' +
        '<span class="pct">' + fmtNum(r.weight, 1, 1) + ' %</span></div>';
    }).join('');

    // --- Lista de activos ---
    var lastOk = 0;
    $('#pf-list').innerHTML = pf.rows.length ? pf.rows.map(function (r) {
      var p = r.position, q = r.quote;
      if (q && !q.error && q.time > lastOk) lastOk = q.lastAttempt || q.time;
      var priceLine;
      if (r.hasPrice) {
        var manual = q.source === 'manual';
        var stale = q.error && !manual;
        priceLine = fmtPrice(q.price, q.currency) + ' · ' + esc(manual ? 'Precio manual' : q.source) + ' · ' + fmtTime(manual ? q.time : (q.lastAttempt && !q.error ? q.lastAttempt : q.time)) +
          (q.change24h != null && !manual ? ' · <span class="' + trend(q.change24h) + '">' + fmtPct(q.change24h) + ' 24 h</span>' : '') +
          (stale ? ' <span class="stale" data-tip="' + esc(q.error) + '">Último precio conocido</span>' : '');
      } else {
        priceLine = '<span class="stale"' + (q && q.error ? ' data-tip="' + esc(q.error) + '"' : '') + '>Sin precio · valorado a costo</span>';
      }
      return '<li class="clickable" data-open-asset="' + esc(p.assetType + '|' + p.ticker) + '" tabindex="0" role="button" aria-label="Ver ficha de ' + esc(p.ticker) + '">' +
        assetBadge(p) +
        '<div class="main">' +
        '<div class="asset-row"><span class="title">' + esc(p.ticker) + ' <span class="tag">' + ASSET_LABELS[p.assetType] + '</span></span>' +
        '<span class="val">' + fmtMoney(r.valueBase, b) + '</span></div>' +
        '<div class="asset-row"><span class="sub">' + fmtNum(p.quantity) + ' u. · costo prom. ' + fmtPrice(p.avgPrice, p.currency) + '</span>' +
        (r.hasPrice ? '<span class="pnl ' + trend(r.pnlBase) + '">' + fmtSigned(r.pnlBase, b) + ' · ' + fmtPct(r.pnlPct) + '</span>'
                    : '<span class="pnl muted">costo ' + fmtMoney(p.costBase, b) + '</span>') + '</div>' +
        '<div class="price-line">' + priceLine + '</div></div>' +
        '<div class="row-actions"><button class="mini" data-manual-price="' + esc(p.priceKey) + '" data-cur="' + esc(p.currency) + '" aria-label="Precio manual" title="Ingresar precio manual">' + icon('i-edit') + '</button></div>' +
        '</li>';
    }).join('') : '<li class="empty">Sin posiciones abiertas.</li>';
    $('#pf-updated').textContent = lastOk ? 'Actualizado ' + fmtTime(lastOk) : '';

    renderInvList();
  }

  function stat(k, v) { return '<div class="stat"><span>' + k + '</span><span>' + v + '</span></div>'; }

  function renderInvList() {
    var b = base();
    var ops = state.investments.slice().sort(function (a, c) {
      return a.date < c.date ? 1 : a.date > c.date ? -1 : (c.createdAt || 0) - (a.createdAt || 0);
    });
    $('#inv-list').innerHTML = ops.length ? ops.map(function (o) {
      var total = C.operationTotal(o);
      var buy = o.side === 'compra';
      var editing = $('#inv-form').editId.value === o.id;
      return '<li class="clickable' + (editing ? ' editing' : '') + '" data-edit-inv="' + o.id + '" tabindex="0" role="button" aria-label="Editar operación">' +
        '<span class="avatar ' + (buy ? 'out' : 'in') + '">' + icon(buy ? 'i-out' : 'i-in') + '</span>' +
        '<div class="main"><div class="title">' + (buy ? 'Compra ' : 'Venta ') + esc(o.ticker) + '</div>' +
        '<div class="sub">' + fmtDate(o.date) + ' · ' + fmtNum(o.quantity) + ' × ' + fmtPrice(o.price, o.currency) +
        (o.fee ? ' + com. ' + fmtMoney(o.fee, o.currency) : '') + (o.accountId ? ' · ' + esc(accName(o.accountId)) : '') +
        (o.note ? ' · ' + esc(o.note) : '') + '</div></div>' +
        '<div class="amt">' + (buy ? '−' : '+') + fmtMoney(total, o.currency) +
        (o.currency !== b ? '<div class="sub">≈ ' + fmtMoney(C.toBase(total, o.currency, rates()), b) + '</div>' : '') + '</div></li>';
    }).join('') : '<li class="empty">Aún no hay operaciones.</li>';
  }

  function updateInvPreview() {
    var f = $('#inv-form');
    var q = num(f.quantity.value), p = num(f.price.value), fee = num(f.fee.value) || 0;
    if (q > 0 && p >= 0) {
      var op = { side: f.side.value, quantity: q, price: p, fee: fee };
      var total = C.operationTotal(op);
      var txt = (op.side === 'compra' ? 'Total a pagar: ' : 'Total a recibir: ') + fmtMoney(total, f.currency.value) +
        ' (' + fmtNum(q) + ' × ' + fmtNum(p) + (op.side === 'compra' ? ' + ' : ' − ') + fmtNum(fee) + ')';
      if (f.currency.value !== base()) txt += ' ≈ ' + fmtMoney(C.toBase(total, f.currency.value, rates()), base());
      if (f.accountId.value) txt += (op.side === 'compra' ? ' · se descuenta de ' : ' · se acredita en ') + accName(f.accountId.value);
      $('#inv-preview').textContent = txt;
    } else $('#inv-preview').textContent = '';
  }

  function resetInvForm() {
    var f = $('#inv-form');
    f.editId.value = ''; f.ticker.value = ''; f.quantity.value = ''; f.price.value = ''; f.fee.value = ''; f.note.value = '';
    f.date.value = S.today();
    $('#inv-form-title').textContent = 'Registrar compra o venta';
    $('[data-action="cancel-inv"]').classList.add('hidden');
    $('[data-action="delete-inv"]').classList.add('hidden');
    renderInvAccountSelect();
    updateInvPreview();
    renderInvList();
  }

  function onInvSubmit(e) {
    e.preventDefault();
    var f = e.target;
    var ticker = f.ticker.value.trim().toUpperCase();
    var q = num(f.quantity.value), p = num(f.price.value), fee = num(f.fee.value) || 0;
    if (!ticker) { toast('Ingresa el ticker'); f.ticker.focus(); return; }
    if (!(q > 0)) { toast('La cantidad debe ser mayor a 0'); f.quantity.focus(); return; }
    if (f.price.value === '' || !(p >= 0)) { toast('Ingresa el precio'); f.price.focus(); return; }
    if (fee < 0) { toast('La comisión no puede ser negativa'); return; }
    if (!f.date.value) { toast('Elige una fecha'); return; }

    var data = {
      side: f.side.value, assetType: f.assetType.value, ticker: ticker,
      quantity: C.round(q, 8), price: C.round(p, 8), currency: f.currency.value,
      fee: C.round(fee, 2), date: f.date.value, accountId: f.accountId.value || null,
      custodyAccountId: f.custodyAccountId.value && f.custodyAccountId.value !== f.accountId.value ? f.custodyAccountId.value : null,
      note: f.note.value.trim()
    };

    // Ninguna venta puede dejar la posición en negativo
    var existing = f.editId.value ? byId(state.investments, f.editId.value) : null;
    var others = state.investments.filter(function (i) { return !existing || i.id !== existing.id; });
    var probe = Object.assign({}, data, { id: existing ? existing.id : '__nuevo', createdAt: existing ? existing.createdAt : Date.now() });
    var errs = C.buildPositions(others.concat([probe]), rates()).errors;
    if (errs.length) {
      var er = errs[0];
      toast('No puedes vender ' + fmtNum(er.wanted) + ' ' + er.ticker + ': solo tienes ' + fmtNum(er.available) + ' al ' + fmtDate(er.date));
      return;
    }

    invalidateSnapshots(existing && existing.date < data.date ? existing.date : data.date);
    if (existing) { Object.assign(existing, data); toast('Operación actualizada'); }
    else {
      data.id = S.uid(); data.createdAt = Date.now();
      state.investments.push(data);
      toast((data.side === 'compra' ? 'Compra' : 'Venta') + ' de ' + ticker + ' guardada');
    }
    state.settings.last.invCurrency = data.currency;
    state.settings.last.invAccountId = data.accountId;
    resetInvForm();
    persist();
    refreshPrices(false); // trae el precio del activo nuevo
  }

  function editInv(id) {
    var o = byId(state.investments, id); if (!o) return;
    if (!$('#view-inversiones').classList.contains('active')) showView('inversiones');
    var f = $('#inv-form');
    $('#inv-details').open = true;
    f.editId.value = o.id; f.side.value = o.side; f.assetType.value = o.assetType; f.ticker.value = o.ticker;
    f.quantity.value = o.quantity; f.price.value = o.price; f.currency.value = o.currency;
    f.fee.value = o.fee || ''; f.date.value = o.date; f.note.value = o.note || '';
    renderInvAccountSelect();
    f.accountId.value = o.accountId || '';
    renderInvAccountSelect();
    f.custodyAccountId.value = o.custodyAccountId || '';
    $('#inv-form-title').textContent = 'Editar operación';
    $('[data-action="cancel-inv"]').classList.remove('hidden');
    $('[data-action="delete-inv"]').classList.remove('hidden');
    updateInvPreview();
    renderInvList();
    $('#inv-details').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openManualPrice(key, cur) {
    var q = state.prices[key];
    var ticker = key.split('|')[1];
    var dlg = $('#price-dialog'), f = $('#price-form');
    $('#price-title').textContent = 'Precio de ' + ticker;
    $('#price-help').textContent = q && q.price != null
      ? 'Precio actual: ' + fmtPrice(q.price, q.currency) + ' (' + (q.source === 'manual' ? 'manual' : q.source) + '). Si la API vuelve a responder, se usará su precio.'
      : 'No hay precio automático para este activo. Ingresa el precio de mercado por unidad.';
    $('#price-cur').textContent = '(' + cur + ')';
    f.price.value = '';
    f.dataset.key = key; f.dataset.cur = cur;
    dlg.showModal();
    f.price.focus();
  }

  // ================================================================ precios en vivo
  var refreshing = false, refreshQueued = false;
  async function refreshPrices(manual) {
    // Si ya hay una actualización en curso, se repite al terminar (p. ej., dos compras seguidas de activos nuevos)
    if (refreshing) { refreshQueued = true; return; }
    refreshing = true;
    var btn = $('[data-action="refresh"]');
    btn.classList.add('spinning');
    $('#sync-status').textContent = 'Actualizando…';
    var target = state;
    try {
      var r = await P.refresh(target);
      if (target !== state) return; // los datos cambiaron (p. ej. restauración) mientras se consultaba
      state.settings.lastRefresh = Date.now();
      state.settings.lastRefreshOk = !r.fxError && !r.failed.length;
      recordSnapshot();
      S.save(state);
      renderAll();
      if (manual) {
        var msg = r.updated + ' precio(s) actualizado(s)';
        if (r.failed.length) msg += ' · ' + r.failed.length + ' sin respuesta (se muestra el último conocido)';
        if (r.fxError) msg += ' · tasas sin actualizar';
        toast(msg);
      }
    } catch (e) {
      if (manual) toast('No se pudo actualizar: ' + e.message);
    } finally {
      refreshing = false;
      btn.classList.remove('spinning');
      renderSyncStatus();
      if (refreshQueued) { refreshQueued = false; refreshPrices(false); }
    }
  }

  function renderSyncStatus() {
    var s = state.settings;
    if (refreshing) return;
    $('#sync-status').textContent = s.lastRefresh ? (s.lastRefreshOk === false ? 'Parcial · ' : 'Precios · ') + fmtTime(s.lastRefresh) : '';
  }

  // ================================================================ ajustes
  function renderSettings() {
    var b = base(), s = state.settings;
    fillReceiptSettings();
    $('#auto-fx').checked = s.autoFx;
    $('#fx-info').textContent = (s.ratesUpdatedAt ? 'Última actualización: ' + fmtTime(s.ratesUpdatedAt) + '. ' : '') +
      'Las tasas «Auto» se actualizan cada 2 minutos: en vivo desde Binance cuando hay par con USDT y, si no, con la tasa diaria. ' +
      'USDT y USDC valen siempre 1 USD. Si escribes una tasa a mano queda fija («Manual»).';

    $('#rates-list').innerHTML = currencies().map(function (c) {
      var isBase = c === b, used = currencyInUse(c), locked = !!s.rateLocks[c];
      var pegged = !isBase && C.PEGGED[c] && C.PEGGED[c] === b;
      var pegToOther = !isBase && C.PEGGED[c] && !pegged;
      var src = (s.rateSources || {})[c];
      var srcTxt = isBase ? 'Moneda base' : C.PEGGED[c] ? 'Fija: 1 ' + c + ' = 1 ' + C.PEGGED[c] :
        locked ? 'Manual (no se actualiza)' : src ? src.source + (src.live ? ' · en vivo · ' + fmtTime(src.at) : ' · diaria · ' + fmtTime(src.at)) : 'Auto · pendiente de actualizar';
      var r = C.rateOf(rates(), c);
      var inv = !isBase && r > 0 ? '1 ' + b + ' = ' + fmtNum(1 / r, 0, 6) + ' ' + c : '';
      return '<li class="rate-row"><div class="main"><div class="title">1 ' + esc(c) + ' =</div><div class="sub">' + esc(srcTxt) + '</div></div>' +
        (pegged || pegToOther
          ? '<span class="rate-fixed">' + fmtNum(r, 0, 6) + '</span>'
          : '<input type="text" inputmode="decimal" autocomplete="off" value="' + C.round(r, 8) + '" data-rate="' + esc(c) + '" style="max-width:130px"' + (isBase ? ' disabled' : '') + ' aria-label="Tasa ' + esc(c) + '" title="' + esc(inv) + '">') +
        '<span class="muted">' + esc(b) + '</span>' +
        (isBase ? '<span class="tag">Base</span>' : C.PEGGED[c] ? '<span class="tag ok">1:1</span>' :
          '<button type="button" class="chip" data-lock="' + esc(c) + '" title="' + (locked ? 'Fijada a mano: no se actualiza sola. Clic para volver a automática.' : 'Se actualiza sola. Clic para fijarla.') + '">' + (locked ? 'Manual' : 'Auto') + '</button>') +
        '<button class="mini" data-del-cur="' + esc(c) + '"' + (isBase || used ? ' disabled title="' + (isBase ? 'Es la moneda base' : 'En uso') + '"' : '') + ' aria-label="Eliminar">' + icon('i-x') + '</button></li>';
    }).join('');

    var key = s.finnhubKey;
    $('#finnhub-info').textContent = key ? 'Key guardada (termina en …' + key.slice(-4) + ').' : 'Sin key: acciones y ETF usarán precio manual.';

    ['ingreso', 'egreso'].forEach(function (type) {
      $('#cat-' + type).innerHTML = state.categories.filter(function (c) { return c.type === type; }).map(function (c) {
        var n = state.transactions.filter(function (t) { return t.categoryId === c.id; }).length;
        return '<li><input value="' + esc(c.name) + '" data-rename-cat="' + c.id + '" aria-label="Nombre">' +
          '<small class="muted">' + n + '</small>' +
          '<button class="mini" data-del-cat="' + c.id + '"' + (n ? ' disabled title="Tiene movimientos"' : '') + ' aria-label="Eliminar">' + icon('i-x') + '</button></li>';
      }).join('');
    });

    $('#methods-list').innerHTML = state.methods.map(function (m) {
      var n = state.transactions.filter(function (t) { return t.methodId === m.id; }).length;
      return '<li><input value="' + esc(m.name) + '" data-rename-method="' + m.id + '" aria-label="Nombre">' +
        '<small class="muted">' + n + '</small>' +
        '<button class="mini" data-del-method="' + m.id + '"' + (n ? ' disabled title="Tiene movimientos"' : '') + ' aria-label="Eliminar">' + icon('i-x') + '</button></li>';
    }).join('');
  }

  function changeBase(newBase) {
    if (newBase === base()) return;
    state.settings.rates = C.rebaseRates(rates(), newBase);
    state.settings.baseCurrency = newBase;
    persist();
    toast('Moneda base: ' + newBase + '. Tasas recalculadas.');
  }

  // ================================================================ export / datos
  function exportTxCSV() {
    var b = base();
    var rows = sortedTx().reverse().map(function (t) {
      var tr = t.type === 'transferencia';
      return [t.date, t.type, t.amount, t.currency, tr ? accName(t.fromAccountId) : splitsText(C.splitsOf(t.splits, t.accountId, t.amount)),
        tr ? accName(t.toAccountId) : '', tr ? t.toAmount : '', tr ? t.toCurrency : '',
        rates()[t.currency], C.toBase(t.amount, t.currency, rates()), b,
        tr ? '' : catName(t.categoryId), tr ? '' : methodName(t.methodId), t.note || ''];
    });
    S.download('movimientos_' + S.today() + '.csv', S.toCSV(['fecha', 'tipo', 'monto', 'moneda', 'cuenta', 'cuenta_destino', 'monto_destino',
      'moneda_destino', 'tasa_a_base', 'monto_base', 'moneda_base', 'categoria', 'metodo_pago', 'nota'], rows), 'text/csv');
  }

  function exportAccCSV() {
    var b = base();
    var rows = C.accountBalances(state).map(function (a) {
      var acc = a.account;
      return [acc.name, S.ACCOUNT_KINDS[acc.kind] || acc.kind, acc.currency, acc.initialBalance || 0, a.balance, rates()[acc.currency], a.balanceBase, b];
    });
    S.download('cuentas_' + S.today() + '.csv', S.toCSV(['cuenta', 'tipo', 'moneda', 'saldo_inicial', 'saldo_actual', 'tasa_a_base', 'saldo_base', 'moneda_base'], rows), 'text/csv');
  }

  function exportInvCSV() {
    var b = base();
    var rows = state.investments.slice().sort(function (a, c) { return a.date < c.date ? -1 : a.date > c.date ? 1 : 0; }).map(function (o) {
      var total = C.operationTotal(o);
      return [o.date, o.side, ASSET_LABELS[o.assetType], o.ticker, o.quantity, o.price, o.currency, o.fee || 0,
        total, o.accountId ? accName(o.accountId) : '', rates()[o.currency], C.toBase(total, o.currency, rates()), b, o.note || ''];
    });
    S.download('inversiones_' + S.today() + '.csv', S.toCSV(['fecha', 'operacion', 'tipo_activo', 'ticker', 'cantidad', 'precio', 'moneda', 'comision',
      'total', 'cuenta', 'tasa_a_base', 'total_base', 'moneda_base', 'nota'], rows), 'text/csv');
  }

  /** Datos de ejemplo: 6 meses de historia. El mes actual coincide con tests/index.html. */
  async function loadSample() {
    await safetyBackup('antes de cargar datos de ejemplo');
    if ((state.transactions.length || state.investments.length) &&
        !confirm('Esto reemplazará tus datos actuales por datos de ejemplo. ¿Continuar?')) return;
    var s = S.defaults();
    s.settings.rates = { USD: 1, EUR: 1.10, MXN: 0.05 };
    s.settings.finnhubKey = state.settings.finnhubKey; // conservar la key si ya existía
    s.profile = state.profile;                         // y el perfil de inversor
    var cat = function (n) { return s.categories.filter(function (c) { return c.name === n; })[0].id; };
    var met = function (n) { return s.methods.filter(function (m) { return m.name === n; })[0].id; };
    var acc = function (name, kind, cur, initial) {
      var a = { id: S.uid(), name: name, kind: kind, currency: cur, initialBalance: initial, createdAt: Date.now() };
      s.accounts.push(a); return a.id;
    };
    s.accounts = [];
    var A = acc('Banco principal', 'banco', 'USD', 10000);
    var B = acc('Efectivo', 'efectivo', 'USD', 300);
    var Ce = acc('Cuenta en euros', 'banco', 'EUR', 0);
    var D = acc('Pesos MXN', 'efectivo', 'MXN', 5000);
    var n = 0, today = S.today();
    var ymAgo = function (k) { var d = new Date(today.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); };
    var tx = function (type, date, amount, cur, accId, c, m, note) {
      if (date > today) return;
      s.transactions.push({ id: S.uid(), createdAt: ++n, type: type, date: date, amount: amount, currency: cur, accountId: accId, categoryId: cat(c), methodId: met(m), note: note });
    };
    var tr = function (date, from, to, amount, cur, toAmount, toCur, note) {
      if (date > today) return;
      s.transactions.push({ id: S.uid(), createdAt: ++n, type: 'transferencia', date: date, amount: amount, currency: cur, fromAccountId: from, toAccountId: to, toAmount: toAmount, toCurrency: toCur, note: note });
    };
    var inv = function (side, type, ticker, q, p, cur, fee, date, accId) {
      s.investments.push({ id: S.uid(), createdAt: ++n, side: side, assetType: type, ticker: ticker, quantity: q, price: p, currency: cur, fee: fee, date: date, accountId: accId, note: '' });
    };
    // Meses anteriores (k = 5 … 1): ingresos y gastos recurrentes
    var food = [320, 280, 350, 300, 310], fun = [60, 120, 45, 80, 150], extra = [0, 0, 400, 0, 0];
    for (var k = 5; k >= 1; k--) {
      var m = ymAgo(k), i = 5 - k;
      tx('ingreso', m + '-01', 2800, 'USD', A, 'Salario', 'Transferencia', '');
      tx('egreso', m + '-02', 1200, 'USD', A, 'Vivienda', 'Transferencia', 'Alquiler');
      tx('egreso', m + '-08', food[i], 'USD', A, 'Comida', 'Débito', 'Supermercado');
      tx('egreso', m + '-10', 95, 'USD', A, 'Servicios', 'Débito', 'Luz e internet');
      tx('egreso', m + '-15', fun[i], 'USD', A, 'Ocio', 'Crédito', '');
      if (extra[i]) tx('ingreso', m + '-20', extra[i], 'EUR', Ce, 'Freelance', 'Transferencia', 'Diseño');
    }
    // Mes actual (mismos datos que las pruebas)
    var cm = today.slice(0, 7);
    tx('ingreso', cm + '-01', 3000, 'USD', A, 'Salario', 'Transferencia', '');
    tx('ingreso', cm + '-03', 500, 'EUR', Ce, 'Freelance', 'Transferencia', 'Proyecto web');
    tx('egreso', cm + '-02', 1200, 'USD', A, 'Vivienda', 'Transferencia', 'Alquiler');
    tx('egreso', cm + '-04', 2000, 'MXN', D, 'Comida', 'Efectivo', 'Mercado');
    tx('egreso', cm + '-05', 45.5, 'EUR', Ce, 'Transporte', 'Débito', 'Tren');
    tr(cm + '-02', A, B, 200, 'USD', 200, 'USD', 'Retiro cajero');
    tr(cm + '-03', A, Ce, 1100, 'USD', 1000, 'EUR', 'Cambio a euros');
    tx('egreso', cm + '-06', 35, 'USD', B, 'Ocio', 'Efectivo', 'Cine');
    // Inversiones repartidas en el tiempo
    inv('compra', 'accion', 'AAPL', 10, 150, 'USD', 1, ymAgo(4) + '-12', A);
    inv('compra', 'accion', 'AAPL', 5, 160, 'USD', 1, ymAgo(2) + '-12', A);
    inv('compra', 'cripto', 'BTC', 0.05, 60000, 'USD', 5, ymAgo(1) + '-18', A);
    inv('venta', 'accion', 'AAPL', 6, 170, 'USD', 1, cm + '-04', A);
    inv('compra', 'etf', 'VWCE', 10, 100, 'EUR', 2, cm + '-05', Ce);
    s.investments = s.investments.filter(function (o) { return o.date <= today; });
    var t0 = Date.now();
    s.prices = {
      'accion|AAPL': { price: 200, currency: 'USD', change24h: null, time: t0, source: 'manual' },
      'cripto|BTC': { price: 70000, currency: 'USD', change24h: 2, time: t0, source: 'Ejemplo' },
      'etf|VWCE': { price: 110, currency: 'EUR', change24h: null, time: t0, source: 'manual' }
    };
    state = s;
    resetTxForm(); resetInvForm(); resetAccForm();
    persist();
    toast('Datos de ejemplo cargados (6 meses)');
  }

  function restoreBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = S.normalize(JSON.parse(reader.result));
        if (!confirm('Se reemplazarán tus datos por los de la copia (' + data.accounts.length + ' cuentas, ' + data.transactions.length + ' movimientos, ' + data.investments.length + ' operaciones). ¿Continuar?')) return;
        replaceState(data, 'restaurar una copia', 'Copia restaurada');
      } catch (e) { alert('El archivo no es una copia válida: ' + e.message); }
    };
    reader.readAsText(file);
  }

  // ================================================================ análisis
  // Color fijo por concepto en todos los gráficos (pares adyacentes de la paleta validada).
  var COLORS = { income: 'var(--s1)', expense: 'var(--s2)', cash: 'var(--s3)', invested: 'var(--s4)', net: 'var(--ink-2)', total: 'var(--ink)', savings: 'var(--muted)' };

  /** Eje Y abreviado y consistente: 950 · 1,5 k · 2 M */
  function fmtCompact(v) {
    if (privacy) return '•••';
    var a = Math.abs(v);
    if (a >= 1e6) return fmtNum(v / 1e6, 0, 1) + ' M';
    if (a >= 1e3) return fmtNum(v / 1e3, 0, 1) + ' k';
    return fmtNum(v, 0, 0);
  }
  function fmtLong(iso) { return new Date(iso + 'T12:00').toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }); }
  function fmtShortDate(iso) { return new Date(iso + 'T12:00').toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }); }
  function monthLabel(ym, withYear) {
    var d = new Date(ym + '-15T12:00');
    return d.toLocaleDateString(LOCALE, { month: 'short' }).replace('.', '') + (withYear ? ' ' + ym.slice(2, 4) : '');
  }
  function monthLong(ym) { return new Date(ym + '-15T12:00').toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }); }
  function tipHtml(title, rows) {
    return '<b>' + esc(title) + '</b>' + rows.map(function (r) {
      return '<div class="row"><span>' + (r[0] ? '<i class="sw" style="background:' + r[0] + '"></i>' : '') + esc(r[1]) + '</span><span>' + r[2] + '</span></div>';
    }).join('');
  }
  function table(head, rows, foot) {
    return '<table class="dtable"><thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody>' +
      (foot ? '<tfoot><tr>' + foot.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr></tfoot>' : '') + '</table>';
  }
  function legendHtml(items) {
    return items.map(function (it) {
      return '<span>' + (it.line ? '<i class="line-key" style="background:' + it.color + '"></i>' : '<i style="background:' + it.color + '"></i>') +
        esc(it.label) + (it.value ? '<b>' + it.value + '</b>' : '') + '</span>';
    }).join('');
  }
  function deltaText(cur, prev, isPct) {
    if (prev == null || (!isPct && !prev)) return 'Sin datos del periodo anterior';
    if (isPct) { var pp = C.round(cur - prev, 1); return (pp > 0 ? '+' : pp < 0 ? '−' : '') + fmtNum(Math.abs(pp), 0, 1) + ' pp vs. periodo anterior'; }
    var ch = C.round((cur - prev) / Math.abs(prev) * 100, 1);
    return (ch > 0 ? '▲ +' : ch < 0 ? '▼ −' : '') + fmtNum(Math.abs(ch), 0, 1) + ' % vs. periodo anterior';
  }

  /** Rango de fechas según el filtro de periodo. */
  function analysisRange() {
    var today = S.today(), ym = today.slice(0, 7), sel = $('#a-range').value;
    var monthsAgo = function (n) {
      var d = new Date(ym + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - n);
      return d.toISOString().slice(0, 10);
    };
    // `back`: meses a desplazar para comparar con el mismo tramo anterior
    if (sel === 'mes') return { from: ym + '-01', to: today, back: 1 };
    if (sel === '3m') return { from: monthsAgo(2), to: today, back: 3 };
    if (sel === '12m') return { from: monthsAgo(11), to: today, back: 12 };
    if (sel === 'anio') return { from: today.slice(0, 4) + '-01-01', to: today, back: 12 };
    if (sel === 'todo') {
      var first = today;
      state.transactions.concat(state.investments).forEach(function (x) { if (x.date < first) first = x.date; });
      return { from: first.slice(0, 7) + '-01', to: today };
    }
    if (sel === 'custom') {
      var f = $('#a-from').value || monthsAgo(5), t = $('#a-to').value || today;
      return f <= t ? { from: f, to: t } : { from: t, to: f };
    }
    return { from: monthsAgo(5), to: today, back: 6 }; // 6m por defecto
  }

  function renderAnalysis() {
    if (!$('#view-analisis').classList.contains('active')) return;
    var b = base();
    var r = analysisRange();
    var cat = $('#a-category').value, acc = $('#a-account').value, asset = $('#a-asset').value;
    var opts = { from: r.from, to: r.to, categoryId: cat, accountId: acc };
    var prevR = r.back ? C.previousByMonths(r.from, r.to, r.back) : C.previousPeriod(r.from, r.to);

    // Estado visual de filtros
    var isCustom = $('#a-range').value === 'custom';
    $('#a-from').classList.toggle('hidden', !isCustom);
    $('#a-to').classList.toggle('hidden', !isCustom);
    if (isCustom && !$('#a-from').value) { $('#a-from').value = r.from; $('#a-to').value = r.to; }
    [['#a-category', cat], ['#a-account', acc], ['#a-asset', asset]].forEach(function (x) { $(x[0]).classList.toggle('active-filter', !!x[1]); });
    $('#a-clear').classList.toggle('hidden', !(cat || acc || asset));
    var filt = [];
    if (cat) filt.push(catName(cat));
    if (acc) filt.push(accName(acc));
    if (asset) filt.push(ASSET_LABELS[asset]);
    $('#a-range-label').textContent = fmtLong(r.from) + ' – ' + fmtLong(r.to) + (filt.length ? ' · ' + filt.join(' · ') : '') +
      ' · comparado con ' + fmtLong(prevR.from) + ' – ' + fmtLong(prevR.to);

    // --- Indicadores ---
    var s = C.summarizeTransactions(flows(), rates(), opts);
    var ps = C.summarizeTransactions(flows(), rates(), { from: prevR.from, to: prevR.to, categoryId: cat, accountId: acc });
    var tile = function (k, v, d) { return '<div class="stat-tile"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d">' + d + '</div></div>'; };
    $('#a-kpis').innerHTML =
      tile('Ingresos', fmtMoney(s.income, b), deltaText(s.income, ps.income)) +
      tile('Gastos', fmtMoney(s.expense, b), deltaText(s.expense, ps.expense)) +
      tile('Neto', '<span class="' + trend(s.net) + '">' + fmtSigned(s.net, b) + '</span>', deltaText(s.net, ps.net)) +
      tile('Tasa de ahorro', s.income > 0 ? fmtNum(s.savingsRate, 0, 1) + ' %' : '—',
        s.income > 0 && ps.income > 0 ? deltaText(s.savingsRate, ps.savingsRate, true) : (s.income > 0 ? 'Sin datos del periodo anterior' : 'Sin ingresos en el periodo'));

    // --- Flujo de caja mensual ---
    var cf = C.monthlyCashflow(flows(), rates(), opts);
    var multiYear = cf.length && cf[0].month.slice(0, 4) !== cf[cf.length - 1].month.slice(0, 4);
    $('#cf-legend').innerHTML = legendHtml([
      { label: 'Ingresos', color: COLORS.income, value: fmtMoney(s.income, b) },
      { label: 'Gastos', color: COLORS.expense, value: fmtMoney(s.expense, b) },
      { label: 'Neto', color: COLORS.net, line: true, value: fmtSigned(s.net, b) }
    ]);
    Charts.bars($('#cf-chart'), {
      labels: cf.map(function (m) { return monthLabel(m.month, multiYear); }),
      series: [
        { label: 'Ingresos', color: COLORS.income, values: cf.map(function (m) { return m.income; }) },
        { label: 'Gastos', color: COLORS.expense, values: cf.map(function (m) { return m.expense; }) }
      ],
      line: { label: 'Neto', color: COLORS.net, values: cf.map(function (m) { return m.net; }) },
      yFormat: fmtCompact, ariaLabel: 'Ingresos y gastos por mes',
      tooltip: function (i) {
        var m = cf[i];
        return tipHtml(monthLong(m.month), [
          [COLORS.income, 'Ingresos', fmtMoney(m.income, b)], [COLORS.expense, 'Gastos', fmtMoney(m.expense, b)],
          [COLORS.net, 'Neto', fmtSigned(m.net, b)], ['', 'Ahorro', m.savingsRate == null ? '—' : fmtNum(m.savingsRate, 0, 1) + ' %']]);
      }
    });
    $('#cf-table').innerHTML = table(['Mes', 'Ingresos', 'Gastos', 'Neto', 'Ahorro'],
      cf.map(function (m) { return [monthLong(m.month), fmtMoney(m.income, b), fmtMoney(m.expense, b), fmtSigned(m.net, b), m.savingsRate == null ? '—' : fmtNum(m.savingsRate, 0, 1) + ' %']; }),
      ['Total', fmtMoney(s.income, b), fmtMoney(s.expense, b), fmtSigned(s.net, b), s.income > 0 ? fmtNum(s.savingsRate, 0, 1) + ' %' : '—']);

    // --- Por categoría (no se filtra por categoría: se resalta la elegida) ---
    var ctype = document.querySelector('input[name="cat-type"]:checked').value;
    var bd = C.categoryBreakdown(flows(), rates(), ctype, { from: r.from, to: r.to, accountId: acc, prev: prevR });
    var color = ctype === 'egreso' ? COLORS.expense : COLORS.income;
    $('#cat-title').textContent = ctype === 'egreso' ? 'Gasto por categoría' : 'Ingreso por categoría';
    $('#cat-sub').textContent = bd.rows.length ? 'Total ' + fmtMoney(bd.total, b) + ' · ' + deltaText(bd.total, bd.prevTotal) : '';
    var top = bd.rows.slice(0, 8);
    if (bd.rows.length > 8) {
      var rest = bd.rows.slice(8);
      top.push({ categoryId: null, label: 'Otras (' + rest.length + ')', total: C.sum(rest.map(function (x) { return x.total; })),
        share: C.sum(rest.map(function (x) { return x.share; })), prev: C.sum(rest.map(function (x) { return x.prev; })), change: null });
    }
    var max = Math.max.apply(null, top.map(function (x) { return x.total; }).concat([1]));
    $('#cat-bars').innerHTML = top.length ? top.map(function (x) {
      var ch = x.change == null ? (x.prev ? '' : (x.categoryId ? 'nuevo en este periodo' : '')) :
        (x.change > 0 ? '▲ +' : x.change < 0 ? '▼ −' : '') + fmtNum(Math.abs(x.change), 0, 1) + ' % vs. anterior';
      return '<div class="catbar' + (cat && x.categoryId === cat ? ' selected' : '') + '" data-tip="' +
        esc((x.label || catName(x.categoryId)) + ': ' + fmtMoney(x.total, b) + ' (antes ' + fmtMoney(x.prev, b) + ')') + '">' +
        '<div class="top"><span class="name">' + esc(x.label || catName(x.categoryId)) + '</span><span class="amt">' + fmtMoney(x.total, b) + '</span></div>' +
        '<div class="track"><div class="fill" style="width:' + (x.total / max * 100) + '%;background:' + color + (cat && x.categoryId !== cat ? ';opacity:.35' : '') + '"></div></div>' +
        '<div class="meta"><span>' + fmtNum(x.share, 1, 1) + ' % del total</span><span>' + ch + '</span></div></div>';
    }).join('') : '<p class="muted">Sin ' + (ctype === 'egreso' ? 'gastos' : 'ingresos') + ' en este periodo.</p>';

    // --- Tasa de ahorro ---
    if (cat) {
      $('#sr-chart').innerHTML = '<p class="muted">La tasa de ahorro necesita todos los ingresos y gastos: quita el filtro de categoría para verla.</p>';
      $('#sr-table').innerHTML = '';
    } else {
      Charts.bars($('#sr-chart'), {
        labels: cf.map(function (m) { return monthLabel(m.month, multiYear); }),
        series: [{ label: 'Tasa de ahorro', color: COLORS.savings, values: cf.map(function (m) { return m.savingsRate; }) }],
        yFormat: function (v) { return fmtNum(v, 0, 0) + ' %'; }, height: 190, yWidth: 48, ariaLabel: 'Tasa de ahorro por mes',
        tooltip: function (i) {
          var m = cf[i];
          return tipHtml(monthLong(m.month), [['', 'Tasa de ahorro', m.savingsRate == null ? 'sin ingresos' : fmtNum(m.savingsRate, 0, 1) + ' %'], ['', 'Ahorrado', fmtSigned(m.net, b)]]);
        }
      });
      $('#sr-table').innerHTML = table(['Mes', 'Ingresos', 'Neto', 'Tasa'],
        cf.map(function (m) { return [monthLong(m.month), fmtMoney(m.income, b), fmtSigned(m.net, b), m.savingsRate == null ? '—' : fmtNum(m.savingsRate, 0, 1) + ' %']; }));
    }

    // --- Evolución del patrimonio ---
    // Punto base: el día anterior al inicio, para que el cambio incluya todo lo ocurrido en el rango
    var dates = [C.addDays(r.from, -1)].concat(C.seriesDates(r.from, r.to));
    var nw = C.netWorthSeries(state, dates, { today: S.today(), accountId: acc, assetType: asset });
    var last = nw[nw.length - 1], first = nw[0];
    var series = [{ label: acc ? accName(acc) : 'Patrimonio', color: COLORS.total, values: nw.map(function (x) { return x.total; }), area: true, width: 2.5 }];
    if (!acc) {
      series.push({ label: 'Cuentas', color: COLORS.cash, values: nw.map(function (x) { return x.cash; }) });
      series.push({ label: asset ? 'Inversiones · ' + ASSET_LABELS[asset] : 'Inversiones', color: COLORS.invested, values: nw.map(function (x) { return x.invested; }) });
    }
    $('#nw-legend').innerHTML = legendHtml(series.map(function (sr) { return { label: sr.label, color: sr.color, line: true, value: fmtMoney(sr.values[sr.values.length - 1], b) }; }));
    var srcLabel = { costo: 'inversiones a costo', mercado: 'valor de mercado', registro: 'registro diario (mercado)' };
    Charts.lines($('#nw-chart'), {
      x: dates, series: series, yFormat: fmtCompact, ariaLabel: 'Evolución del patrimonio',
      xFormat: function (d) { return dates.length > 92 || C.daysBetween(r.from, r.to) > 92 ? monthLabel(d.slice(0, 7), multiYear) : fmtShortDate(d); },
      tooltip: function (i) {
        var x = nw[i];
        return tipHtml((i === 0 ? 'Antes del periodo · ' : '') + fmtLong(x.date), series.map(function (sr) { return [sr.color, sr.label, fmtMoney(sr.values[i], b)]; })
          .concat([['', 'Fuente', srcLabel[x.source]]]));
      }
    });
    var diff = C.round(last.total - first.total, 2);
    $('#nw-note').innerHTML = 'Cambio en el periodo: <b class="' + trend(diff) + '">' + fmtSigned(diff, b) + '</b>' +
      (first.total ? ' (' + fmtPct(C.round(diff / Math.abs(first.total) * 100, 2)) + ')' : '') +
      '. Hoy las inversiones se valoran a precio de mercado; en fechas pasadas a costo, salvo los días con registro diario (la app guarda uno cada día que la abres). Saldos convertidos con las tasas actuales.';
    var tableRows = nw.filter(function (x, i) { return dates.length <= 35 || i === 0 || i === nw.length - 1 || C.addDays(x.date, 1).slice(8) === '01'; });
    $('#nw-table').innerHTML = table(['Fecha', 'Cuentas', 'Inversiones', 'Total', 'Fuente'],
      tableRows.map(function (x) { return [fmtLong(x.date), fmtMoney(x.cash, b), fmtMoney(x.invested, b), fmtMoney(x.total, b), srcLabel[x.source]]; }));

    // --- Rendimiento por activo ---
    var ops = asset ? state.investments.filter(function (o) { return o.assetType === asset; }) : state.investments;
    var pos = C.buildPositions(ops, rates()).positions;
    var pf = C.valuePortfolio(pos, state.prices, rates());
    $('#perf-table').innerHTML = pf.rows.length ? table(['Activo', 'Valor', 'Costo', 'G/P', 'G/P %', 'Peso'],
      pf.rows.map(function (x) {
        return [esc(x.position.ticker) + ' <span class="tag">' + ASSET_LABELS[x.position.assetType] + '</span>', fmtMoney(x.valueBase, b), fmtMoney(x.position.costBase, b),
          x.hasPrice ? '<span class="' + trend(x.pnlBase) + '">' + fmtSigned(x.pnlBase, b) + '</span>' : 'sin precio',
          x.hasPrice ? '<span class="' + trend(x.pnlPct) + '">' + fmtPct(x.pnlPct) + '</span>' : '—', fmtNum(x.weight, 1, 1) + ' %'];
      }),
      ['Total', fmtMoney(pf.value, b), fmtMoney(pf.cost, b), '<span class="' + trend(pf.pnl) + '">' + fmtSigned(pf.pnl, b) + '</span>', '<span class="' + trend(pf.pnlPct) + '">' + fmtPct(pf.pnlPct) + '</span>', '100 %'])
      : '<p class="muted">Sin posiciones abiertas' + (asset ? ' de tipo ' + ASSET_LABELS[asset] : '') + '.</p>';
    var inRangeOps = ops.filter(function (o) { return o.date >= r.from && o.date <= r.to; });
    var sumSide = function (side) { return C.sum(inRangeOps.filter(function (o) { return o.side === side; }).map(function (o) { return C.toBase(C.operationTotal(o), o.currency, rates()); })); };
    var fees = C.sum(inRangeOps.map(function (o) { return C.toBase(o.fee || 0, o.currency, rates()); }));
    $('#perf-ops').innerHTML = 'En el periodo: compras ' + fmtMoney(sumSide('compra'), b) + ' · ventas ' + fmtMoney(sumSide('venta'), b) +
      ' · comisiones ' + fmtMoney(fees, b) + ' · ganancia realizada total <span class="' + trend(pf.realized) + '">' + fmtSigned(pf.realized, b) + '</span>.';

    renderProjection();
    renderYearReport();
  }

  // ================================================================ proyección de patrimonio
  var PROJ = [{ rate: 2, label: 'Conservador', color: 'var(--s3)' }, { rate: 5, label: 'Moderado', color: 'var(--s1)' }, { rate: 8, label: 'Optimista', color: 'var(--s4)' }];
  function projDefaults() {
    var avg = Advisor.monthlyAverages(state, S.today(), 6);
    return { start: C.netWorth(state, S.today()).total, saving: avg ? C.round(avg.income - avg.expense, 2) : 0, avg: avg };
  }
  function renderProjection() {
    var b = base(), d = projDefaults();
    var si = $('#proj-start'), sv = $('#proj-saving');
    si.placeholder = String(d.start); sv.placeholder = String(d.saving);
    var start = si.value.trim() ? C.parseAmount(si.value.replace('-', '')) * (/^-/.test(si.value.trim()) ? -1 : 1) : d.start;
    var saving = sv.value.trim() ? C.parseAmount(sv.value.replace('-', '')) * (/^-/.test(sv.value.trim()) ? -1 : 1) : d.saving;
    if (!isFinite(start)) start = d.start;
    if (!isFinite(saving)) saving = d.saving;
    $('#proj-sub').innerHTML = 'A este ritmo: parte de tu patrimonio actual (' + fmtMoney(d.start, b) + ') y ahorra ' + fmtMoney(d.saving, b) + ' al mes' +
      (d.avg ? ' (promedio de ' + d.avg.months.length + (d.avg.months.length === 1 ? ' mes' : ' meses') + ' con datos)' : '') + '. Puedes cambiar ambos valores.';
    var sc = Insights.projection(start, saving, PROJ.map(function (p) { return p.rate; }), 10);
    var today = S.today(), dates = [];
    for (var y = 0; y <= 10; y++) dates.push((Number(today.slice(0, 4)) + y) + today.slice(4));
    var series = sc.map(function (s, i) { return { label: PROJ[i].label + ' ' + PROJ[i].rate + ' %', color: PROJ[i].color, values: s.values, width: i === 1 ? 2.5 : 2 }; });
    $('#proj-legend').innerHTML = legendHtml(series.map(function (s) { return { label: s.label, color: s.color, line: true, value: fmtMoney(s.values[10], b) }; }));
    Charts.lines($('#proj-chart'), {
      x: dates, series: series, yFormat: fmtCompact, ariaLabel: 'Proyección de patrimonio a 10 años',
      xFormat: function (dd) { return 'Año ' + (Number(dd.slice(0, 4)) - Number(today.slice(0, 4))); },
      tooltip: function (i) { return tipHtml(i === 0 ? 'Hoy' : 'En ' + i + (i === 1 ? ' año' : ' años'), series.map(function (s) { return [s.color, s.label, fmtMoney(s.values[i], b)]; })); }
    });
    var put = function (yrs) { return C.round(start + saving * 12 * yrs, 2); };
    $('#proj-table').innerHTML = table(['En', 'Aportas', 'Conservador', 'Moderado', 'Optimista'], [1, 5, 10].map(function (yrs) {
      return [yrs + (yrs === 1 ? ' año' : ' años'), fmtMoney(put(yrs), b)].concat(sc.map(function (s) { return '<b>' + fmtMoney(s.values[yrs], b) + '</b>'; }));
    }));
  }

  // ================================================================ resumen anual (impuestos)
  var ASSET_TYPE_NAMES = { accion: 'Acción', etf: 'ETF', cripto: 'Cripto', divisa: 'Divisa', otro: 'Otro' };
  function renderYearReport() {
    var b = base(), sel = $('#year-sel');
    var years = Insights.annualReport(state, S.today().slice(0, 4)).years;
    if (years.indexOf(S.today().slice(0, 4)) === -1) years.unshift(S.today().slice(0, 4));
    fillSelect(sel, years.map(function (y) { return { value: y, label: y }; }), sel.value || S.today().slice(0, 4));
    var r = Insights.annualReport(state, sel.value);
    var tile = function (k, v, dd) { return '<div class="stat-tile"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d">' + dd + '</div></div>'; };
    $('#year-kpis').innerHTML =
      tile('Ingresos', fmtMoney(r.income, b), 'incluye ganancia de cambios') +
      tile('Gastos', fmtMoney(r.expense, b), 'neto ' + fmtSigned(r.net, b)) +
      tile('Ganancia en cambios', '<span class="' + trend(r.fx.profit) + '">' + fmtSigned(r.fx.profit, b) + '</span>', r.fx.count + ' cambio(s)') +
      tile('Ventas de inversiones', '<span class="' + trend(r.salesNet) + '">' + fmtSigned(r.salesNet, b) + '</span>', r.sales.length + ' venta(s)');
    var catRows = function (list, total) {
      return list.length ? table(['Categoría', 'Total', '%'], list.map(function (x) {
        return [esc(catName(x.categoryId)), fmtMoney(x.total, b), fmtNum(total > 0 ? C.round(x.total / total * 100, 1) : 0, 0, 1) + ' %'];
      }), ['Total', fmtMoney(total, b), '100 %']) : '<p class="muted small">Sin registros en ' + r.year + '.</p>';
    };
    $('#year-inc').innerHTML = catRows(r.incomeByCat, r.income);
    $('#year-exp').innerHTML = catRows(r.expenseByCat, r.expense);
    $('#year-fx').innerHTML = r.fx.count
      ? r.fx.count + ' cambio(s) completado(s): recibiste ' + fmtMoney(r.fx.received, b) + ', comisiones cobradas ' + fmtMoney(r.fx.commission, b) +
        ', costos pagados ' + fmtMoney(r.fx.costs, b) + ' → ganancia <b class="' + trend(r.fx.profit) + '">' + fmtSigned(r.fx.profit, b) + '</b> (ya incluida en ingresos).'
      : 'Sin cambios completados en ' + r.year + '.';
    $('#year-sales').innerHTML = r.sales.length ? table(['Fecha', 'Activo', 'Cantidad', 'Venta', 'Costo', 'Comisión', 'Resultado'], r.sales.map(function (x) {
      return [fmtDate(x.date), esc(x.ticker) + ' <span class="tag">' + ASSET_TYPE_NAMES[x.assetType] + '</span>', fmtNum(x.quantity, 0, 8),
        fmtMoney(x.proceeds, x.currency), fmtMoney(x.cost, x.currency), fmtMoney(x.fee, x.currency), '<span class="' + trend(x.gain) + '">' + fmtSigned(x.gain, x.currency) + '</span>'];
    }), ['Total', '', '', '', '', '', '<span class="' + trend(r.salesNet) + '">' + fmtSigned(r.salesNet, b) + '</span>']) : '<p class="muted small">Sin ventas en ' + r.year + '.</p>';
    $('#year-note').innerHTML = 'Ganancias ' + fmtMoney(r.salesGains, b) + ' · pérdidas ' + fmtMoney(r.salesLosses, b) + ' · comisiones de inversión pagadas ' + fmtMoney(r.invFees, b) +
      '. Costo de lo vendido = costo promedio ponderado de tus compras (si tu país exige FIFO, avísame y lo añado). Montos en ' + b + ' con las tasas actuales.';
  }
  function exportYearCSV() {
    var r = Insights.annualReport(state, $('#year-sel').value), b = base(), rows = [];
    rows.push(['resumen', 'ingresos', '', r.income, b]); rows.push(['resumen', 'gastos', '', r.expense, b]); rows.push(['resumen', 'neto', '', r.net, b]);
    r.incomeByCat.forEach(function (x) { rows.push(['ingreso', catName(x.categoryId), '', x.total, b]); });
    r.expenseByCat.forEach(function (x) { rows.push(['gasto', catName(x.categoryId), '', x.total, b]); });
    rows.push(['cambios', 'ganancia (' + r.fx.count + ' cambios)', '', r.fx.profit, b]);
    rows.push(['cambios', 'comisiones cobradas', '', r.fx.commission, b]);
    r.sales.forEach(function (x) { rows.push(['venta', x.ticker + ' ' + x.quantity + ' (venta ' + x.proceeds + ', costo ' + x.cost + ', comisión ' + x.fee + ')', x.date, x.gain, x.currency]); });
    rows.push(['inversiones', 'comisiones pagadas', '', r.invFees, b]);
    S.download('resumen_' + r.year + '.csv', S.toCSV(['seccion', 'concepto', 'fecha', 'monto', 'moneda'], rows), 'text/csv');
  }

  // ================================================================ explorar activos y sugeridos
  var explore = { tab: 'cripto', cryptos: null, risks: {}, loading: false, error: null, etfQuotes: {}, at: 0 };
  var RISK_TEXT = {
    1: 'Se mueve muy poco: pensado para dinero que no quieres arriesgar.',
    2: 'Movimientos pequeños; en momentos malos puede caer algo, pero poco.',
    3: 'Sube y baja con los mercados: en una crisis puede caer un 20–35 %.',
    4: 'Movimientos fuertes: caídas del 30–50 % son posibles.',
    5: 'Muy volátil: puede perder más de la mitad de su valor en pocos meses.'
  };
  function riskBadge(level, ref) {
    if (!level) return '<span class="risk">Riesgo —</span>';
    return '<span class="risk r' + level + '" title="Riesgo ' + esc(Insights.RISK_LABELS[level].toLowerCase()) + (ref ? ' (referencia histórica)' : '') + '">Riesgo ' +
      esc(Insights.RISK_LABELS[level].toLowerCase()) + '</span>';
  }
  function etfInfo(t) { return Insights.ETF_CATALOG.filter(function (x) { return x.ticker === t; })[0] || null; }
  function assetRisk(type, ticker) {
    if (type === 'cripto') { var r = explore.risks[ticker]; return r ? { level: r.level, stats: r } : null; }
    var e = etfInfo(ticker); return e ? { level: e.risk, ref: true } : null;
  }
  function profileType() { return state.profile ? state.profile.type : null; }

  function renderIdeas(pf) {
    var type = profileType();
    $('#ideas-profile').textContent = type ? 'Perfil ' + Advisor.PROFILES[type].label.toLowerCase() : '';
    var list = Insights.ideas(pf, type);
    var html = list.map(function (i) {
      return '<div class="idea"><div class="t">' + esc(i.title) + '</div><div class="w">' + esc(i.why) + '</div><div class="idea-chips">' +
        i.items.map(function (it) {
          var rk = assetRisk(it.assetType, it.ticker);
          return '<span class="idea-chip" role="button" tabindex="0" data-open-asset="' + esc(it.assetType + '|' + it.ticker) + '">' +
            (it.assetType === 'cripto' ? logoHtml(it.assetType, it.ticker, 'mini-logo') : '') + esc(it.ticker) + (rk ? ' ' + riskBadge(rk.level, rk.ref) : '') + '</span>';
        }).join('') + '</div></div>';
    }).join('');
    if (!type) html += '<p class="hint" style="margin:8px 0 0">Haz el test de perfil (Consejos) para ajustar las sugerencias a cuánto riesgo toleras.</p>';
    $('#ideas-body').innerHTML = html || '<p class="muted small" style="margin:0">Tu portafolio ya está diversificado según estas reglas. Explora más abajo si quieres investigar otros activos.</p>';
  }

  function renderExplore() {
    var list = $('#explore-list'); if (!list) return;
    var type = profileType(), max = type ? Insights.PROFILE_MAX_RISK[type] : null;
    $('#ex-fit-wrap').classList.toggle('hidden', !type);
    if (type) $('#ex-fit-label').textContent = 'Solo los que encajan con mi perfil ' + Advisor.PROFILES[type].label.toLowerCase() + ' (riesgo hasta «' + Insights.RISK_LABELS[max].toLowerCase() + '»)';
    var onlyFit = type && $('#ex-fit').checked;
    var fit = function (lvl) { return lvl ? lvl <= max : null; };
    var fitTag = function (lvl) { return type && lvl ? '<span class="fit-tag">' + (fit(lvl) ? '✓ Encaja con tu perfil' : 'Más riesgo que tu perfil') + '</span>' : ''; };
    var key = state.settings.finnhubKey;
    if (explore.tab === 'cripto') {
      if (!explore.cryptos) {
        list.innerHTML = '<li class="empty">' + (explore.error ? 'No se pudo cargar la lista (' + esc(explore.error) + '). <button type="button" class="link" data-action="explore-retry">Reintentar</button>' : 'Cargando las criptos principales…') + '</li>';
        $('#explore-note').textContent = '';
        return;
      }
      var rows = explore.cryptos.filter(function (c) { var r = explore.risks[c.ticker]; return !onlyFit || !r || fit(r.level); });
      list.innerHTML = rows.map(function (c) {
        var r = explore.risks[c.ticker], q = state.prices[C.priceKey('cripto', c.ticker)];
        var price = q && q.price != null && !q.error ? q.price : c.price, ch = q && q.change24h != null && !q.error ? q.change24h : c.change24h;
        return '<li data-open-asset="cripto|' + esc(c.ticker) + '" tabindex="0" role="button" aria-label="Ver ' + esc(c.name) + '">' +
          '<span class="mini-logo">' + (c.logo ? '<img src="' + esc(c.logo) + '" alt="" loading="lazy">' : esc(c.ticker.slice(0, 4))) + '</span>' +
          '<div class="main"><div class="title">' + esc(c.name) + '</div><div class="sub">' + esc(c.ticker) + (c.rank ? ' · #' + c.rank + ' por capitalización' : '') + '</div>' +
          '<div style="margin-top:4px">' + (r ? riskBadge(r.level) + ' ' + fitTag(r.level) : '<span class="risk">Calculando riesgo…</span>') + '</div></div>' +
          '<div class="ex-right"><span class="ex-price">' + (price != null ? fmtPrice(price, 'USD') : '—') + '</span>' +
          (ch != null ? '<span class="small ' + trend(ch) + '">' + fmtPct(C.round(ch, 2)) + ' 24 h</span>' : '') + '</div></li>';
      }).join('') || '<li class="empty">Ninguna cripto de la lista encaja con tu perfil.</li>';
      $('#explore-note').textContent = 'Las ' + explore.cryptos.length + ' criptos de mayor capitalización (sin estables) que puedes seguir en Binance. Riesgo calculado con 1 año de cierres diarios. Toca una para ver su historial, datos y noticias.';
    } else {
      var etfs = Insights.ETF_CATALOG.filter(function (e) { return !onlyFit || fit(e.risk); });
      list.innerHTML = etfs.map(function (e) {
        var q = explore.etfQuotes[e.ticker] || state.prices[C.priceKey('etf', e.ticker)];
        return '<li data-open-asset="etf|' + esc(e.ticker) + '" tabindex="0" role="button" aria-label="Ver ' + esc(e.name) + '">' +
          '<span class="mini-logo">' + esc(e.ticker) + '</span>' +
          '<div class="main"><div class="title">' + esc(e.ticker) + ' · ' + esc(e.group) + '</div><div class="sub">' + esc(e.name) + '</div>' +
          '<div class="small muted" style="margin-top:2px">' + esc(e.about) + '</div>' +
          '<div style="margin-top:4px">' + riskBadge(e.risk, true) + ' ' + fitTag(e.risk) + '</div></div>' +
          '<div class="ex-right"><span class="ex-price">' + (q && q.price != null && !q.error ? fmtPrice(q.price, 'USD') : '') + '</span>' +
          (q && q.change24h != null && !q.error ? '<span class="small ' + trend(q.change24h) + '">' + fmtPct(C.round(q.change24h, 2)) + ' 24 h</span>' : '') + '</div></li>';
      }).join('') || '<li class="empty">Ninguno de la lista encaja con tu perfil.</li>';
      $('#explore-note').textContent = 'Fondos muy conocidos de distintos tipos, como punto de partida para investigar. El riesgo es el típico de su historia (referencia).' +
        (key ? '' : ' Para ver precios, datos y noticias de ETF y acciones añade tu API key gratuita de Finnhub en Ajustes.');
    }
  }

  /** Carga la lista de criptos y su riesgo (poco a poco) y los precios de los ETF. */
  async function loadExplore(force) {
    if (explore.loading || (!force && explore.cryptos && Date.now() - explore.at < 30 * 60000)) return;
    explore.loading = true; explore.error = null;
    try {
      explore.cryptos = await Market.fetchTopCryptos(12);
      explore.at = Date.now();
    } catch (e) { explore.error = e.message; }
    renderExplore();
    var key = state.settings.finnhubKey;
    if (key) Prices.fetchStocks(Insights.ETF_CATALOG.map(function (e) { return e.ticker; }), key).then(function (q) { explore.etfQuotes = q || {}; renderExplore(); }).catch(function () {});
    var queue = (explore.cryptos || []).map(function (c) { return c.ticker; });
    ['BTC', 'ETH'].forEach(function (t) { if (queue.indexOf(t) === -1) queue.push(t); });
    var worker = async function () {
      while (queue.length) {
        var t = queue.shift();
        try { var st = await Market.fetchRisk(t); if (st) explore.risks[t] = st; } catch (e) { /* sin riesgo para ese activo */ }
        renderExplore();
        renderIdeas(C.valuePortfolio(C.buildPositions(state.investments, rates()).positions, state.prices, rates()));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    explore.loading = false;
  }

  // ---- Ficha de activo: riesgo, datos clave y noticias
  async function loadAssetInsights() {
    var a = asset; if (!a) return;
    ['#ad-risk', '#ad-info', '#ad-news'].forEach(function (s) { $(s).classList.add('hidden'); $(s).innerHTML = ''; });
    var market = a.type === 'cripto' || a.type === 'etf' || a.type === 'accion';
    if (!market) return;
    var key = state.settings.finnhubKey;
    // Riesgo
    if (a.type === 'cripto') {
      renderAssetRisk(a, null, true);
      Market.fetchRisk(a.ticker).then(function (st) { if (st) explore.risks[a.ticker] = st; renderAssetRisk(a, st, false); })
        .catch(function () { renderAssetRisk(a, null, false); });
    } else renderAssetRisk(a, null, false);
    // Datos clave
    if (a.type === 'cripto') {
      $('#ad-info').classList.remove('hidden'); $('#ad-info').innerHTML = '<h2>Datos clave</h2><p class="muted small">Cargando…</p>';
      Market.fetchCoinInfo(a.ticker).then(function (inf) { renderAssetInfo(a, inf); })
        .catch(function (e) { if (asset === a) $('#ad-info').innerHTML = '<h2>Datos clave</h2><p class="muted small">No disponibles ahora (' + esc(e.message) + ').</p>'; });
    } else if (key) {
      $('#ad-info').classList.remove('hidden'); $('#ad-info').innerHTML = '<h2>Datos clave</h2><p class="muted small">Cargando…</p>';
      Market.fetchStockInfo(a.ticker, key).then(function (inf) { renderAssetInfo(a, inf); if (a.type === 'accion' && inf.beta != null) renderAssetRisk(a, null, false, inf); })
        .catch(function (e) { if (asset === a) $('#ad-info').innerHTML = '<h2>Datos clave</h2><p class="muted small">No disponibles ahora (' + esc(e.message) + ').</p>'; });
    }
    // Noticias
    var m = meta(a.type, a.ticker) || {};
    var listed = (explore.cryptos || []).filter(function (c) { return c.ticker === a.ticker; })[0] || etfInfo(a.ticker);
    var name = m.name && m.name.toUpperCase() !== a.ticker ? m.name : listed ? listed.name : a.ticker;
    var more = '<p style="margin:10px 0 0"><a href="' + esc(Market.newsSearchUrl(name + (a.type === 'cripto' ? ' cripto' : ''))) + '" target="_blank" rel="noopener noreferrer">Ver más noticias de ' + esc(name) + ' en Google Noticias ↗</a></p>';
    $('#ad-news').classList.remove('hidden');
    if (!key) { $('#ad-news').innerHTML = '<h2>Noticias</h2><p class="muted small">Para ver aquí las noticias recientes añade tu API key gratuita de Finnhub en Ajustes.</p>' + more; return; }
    $('#ad-news').innerHTML = '<h2>Noticias</h2><p class="muted small">Cargando…</p>';
    Market.fetchNews(a.type, a.ticker, name, key).then(function (n) {
      if (asset !== a) return;
      $('#ad-news').innerHTML = '<h2>Noticias</h2>' + (n.general && n.items.length ? '<p class="hint" style="margin-top:0">No hay noticias recientes que mencionen ' + esc(a.ticker) + ': estas son las últimas del mercado cripto.</p>' : '') +
        (n.items.length ? '<ul class="news-list">' + n.items.map(function (it) {
          return '<li><a href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">' + esc(it.headline) + '</a>' +
            '<div class="sub">' + esc(it.source) + (it.datetime ? ' · ' + fmtTime(it.datetime) : '') + '</div></li>';
        }).join('') + '</ul>' : '<p class="muted small">Sin noticias en los últimos 30 días.</p>') + more;
    }).catch(function (e) { if (asset === a) $('#ad-news').innerHTML = '<h2>Noticias</h2><p class="muted small">No se pudieron cargar (' + esc(e.message) + ').</p>' + more; });
  }

  function renderAssetRisk(a, st, loading, stockInfo) {
    if (asset !== a) return;
    var box = $('#ad-risk'), type = profileType();
    var lvl = st ? st.level : null, ref = false;
    if (!st && a.type !== 'cripto') { var e = etfInfo(a.ticker); if (e) { lvl = e.risk; ref = true; } }
    if (!lvl && stockInfo && stockInfo.beta != null) { lvl = stockInfo.beta < 0.8 ? 3 : stockInfo.beta <= 1.3 ? 4 : 5; ref = true; }
    if (!lvl && !loading) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (loading) { box.innerHTML = '<h2>Riesgo</h2><p class="muted small">Calculando con el historial de 1 año…</p>'; return; }
    var max = type ? Insights.PROFILE_MAX_RISK[type] : null;
    box.innerHTML = '<div class="risk-head"><h2 style="margin:0">Riesgo</h2>' + riskBadge(lvl, ref) + '</div>' +
      '<p class="rec-why" style="margin:8px 0 0">' + esc(RISK_TEXT[lvl]) + '</p>' +
      (st ? '<div class="kv-grid">' +
        '<div><span>Volatilidad anual</span><b>' + fmtNum(st.volatility, 0, 1) + ' %</b></div>' +
        '<div><span>Peor caída (12 meses)</span><b class="' + trend(st.maxDrawdown) + '">' + fmtPct(st.maxDrawdown) + '</b></div>' +
        '<div><span>Rendimiento 12 meses</span><b class="' + trend(st.return) + '">' + fmtPct(st.return) + '</b></div>' +
        '<div><span>Datos</span><b>' + st.points + ' cierres diarios</b></div></div>' : '') +
      (ref ? '<p class="hint" style="margin:8px 0 0">' + (stockInfo && stockInfo.beta != null && !etfInfo(a.ticker) ? 'Estimado con la beta (' + fmtNum(stockInfo.beta, 0, 2) + '): cuánto se mueve frente al mercado.' : 'Nivel de referencia según su comportamiento histórico típico.') + '</p>' : '') +
      (type ? '<p class="small" style="margin:8px 0 0">' + (lvl <= max ? '✓ Encaja con tu perfil ' + esc(Advisor.PROFILES[type].label.toLowerCase()) :
        'Supera el riesgo sugerido para tu perfil ' + esc(Advisor.PROFILES[type].label.toLowerCase()) + ' (hasta «' + esc(Insights.RISK_LABELS[max].toLowerCase()) + '»): si lo tienes, que pese poco en tu portafolio') + '.</p>' : '') +
      '<p class="hint" style="margin:8px 0 0">El riesgo pasado no garantiza el futuro. No es una recomendación.</p>';
  }

  function renderAssetInfo(a, inf) {
    if (asset !== a || !inf) return;
    var usd = function (v) { return v == null ? '—' : fmtMoney(v, 'USD'); };
    // Cifras grandes legibles: 308,1 mil M (miles de millones), 9,8 M, 950 k
    var big = function (v) { return v == null ? '—' : privacy ? 'USD ' + MASK : 'USD ' + (Math.abs(v) >= 1e9 ? fmtNum(v / 1e9, 0, 1) + ' mil M' : fmtCompact(v)); };
    var n = function (v) { return v == null ? '—' : Math.abs(v) >= 1e9 ? fmtNum(v / 1e9, 0, 2) + ' mil M' : Math.abs(v) >= 1e6 ? fmtNum(v / 1e6, 0, 1) + ' M' : fmtNum(v, 0, 0); };
    var pc = function (v) { return v == null ? '—' : '<span class="' + trend(v) + '">' + fmtPct(v) + '</span>'; };
    var items = [];
    if (a.type === 'cripto') {
      items = [['Puesto por capitalización', inf.rank ? '#' + inf.rank : '—'], ['Capitalización', big(inf.marketCap)], ['Volumen 24 h', big(inf.volume24h)],
        ['Máximo histórico', usd(inf.ath) + (inf.athDate ? ' <span class="muted small">(' + fmtDate(inf.athDate) + ')</span>' : '')],
        ['Distancia al máximo', pc(inf.athChange)],
        ['En circulación', n(inf.circulating) + (inf.maxSupply ? ' de ' + n(inf.maxSupply) + ' máx.' : ' (sin máximo)')],
        ['Cambio 7 días', pc(inf.change7d)], ['Cambio 30 días', pc(inf.change30d)], ['Cambio 1 año', pc(inf.change1y)]];
    } else {
      items = [['Sector', esc(inf.industry || '—')], ['País', esc(inf.country || '—')], ['Capitalización', big(inf.marketCap)],
        ['Máximo 52 semanas', usd(inf.high52)], ['Mínimo 52 semanas', usd(inf.low52)],
        ['Rendimiento 52 semanas', pc(inf.ret52)],
        ['Beta (vs. mercado)', inf.beta == null ? '—' : fmtNum(inf.beta, 0, 2)], ['PER', inf.pe == null ? '—' : fmtNum(inf.pe, 0, 1)],
        ['Rentabilidad por dividendo', inf.dividendYield == null ? '—' : fmtNum(inf.dividendYield, 0, 2) + ' %']];
    }
    var e = a.type === 'etf' ? etfInfo(a.ticker) : null;
    $('#ad-info').classList.remove('hidden');
    $('#ad-info').innerHTML = '<h2>Datos clave</h2>' +
      (inf.description ? '<p class="rec-why" style="margin:4px 0 0">' + esc(inf.description) + '</p>' : e ? '<p class="rec-why" style="margin:4px 0 0">' + esc(e.about) + '</p>' : '') +
      (inf.categories && inf.categories.length ? '<p class="small muted" style="margin:6px 0 0">' + inf.categories.map(esc).join(' · ') + '</p>' : '') +
      '<div class="kv-grid">' + items.map(function (x) { return '<div><span>' + x[0] + '</span><b>' + x[1] + '</b></div>'; }).join('') + '</div>' +
      '<p class="hint" style="margin:8px 0 0">Fuente: ' + esc(inf.source) + (inf.homepage ? ' · <a href="' + esc(inf.homepage) + '" target="_blank" rel="noopener noreferrer">web oficial ↗</a>' : '') + '</p>';
  }

  /** Foto diaria del patrimonio (valor de mercado) para la serie histórica. */
  function recordSnapshot() {
    if (!state.accounts.length && !state.investments.length) return;
    var nw = C.netWorth(state, S.today());
    state.snapshots[S.today()] = { cash: nw.cash, invested: nw.invested, terceros: C.round(nw.receivable - nw.payable, 2), total: nw.total, at: Date.now() };
  }
  /** Un cambio con fecha pasada invalida los registros diarios desde esa fecha. */
  function invalidateSnapshots(fromDate) {
    if (!fromDate) return;
    Object.keys(state.snapshots).forEach(function (d) { if (d >= fromDate && d !== S.today()) delete state.snapshots[d]; });
  }

  // ================================================================ recomendaciones
  var SEV = { alta: ['!', 'Importante'], media: ['!', 'Atención'], baja: ['i', 'Sugerencia'], ok: ['✓', 'Bien'] };
  var editingProfile = false;

  function sevBadge(sev) { return '<span class="sev"><i aria-hidden="true">' + SEV[sev][0] + '</i>' + SEV[sev][1] + '</span>'; }

  function currentRecs() {
    if (!state.profile) return null;
    return Advisor.recommend(state, state.profile, S.today(), function (v) { return fmtMoney(v, base()); }, LOCALE);
  }

  function renderAdvice() {
    var recs = currentRecs();
    var P = state.profile ? Advisor.PROFILES[state.profile.type] : null;

    // --- Tarjeta en Inicio ---
    var home = $('#home-recs-body');
    if (!recs) {
      home.innerHTML = '<p class="muted small" style="margin:0 0 10px">Responde 5 preguntas y recibe recomendaciones según tu perfil, tus gastos y tu portafolio.</p>' +
        '<button type="button" class="primary" data-action="start-profile">Hacer el test (1 min)</button>';
    } else {
      var top = recs.filter(function (r) { return r.severity !== 'ok'; }).slice(0, 3);
      var rev = Insights.profileReview(state, state.profile, S.today());
      if (rev.length) top = [{ severity: 'media', title: 'Revisa tu perfil de inversor', why: rev[0].text }].concat(top.slice(0, 2));
      home.innerHTML = top.length ? top.map(function (r) {
        return '<div class="home-rec" data-sev="' + r.severity + '">' + '<span class="sev"><i aria-hidden="true">' + SEV[r.severity][0] + '</i></span>' +
          '<div><div class="t">' + esc(r.title) + '</div><div class="w">' + esc(r.why) + '</div></div></div>';
      }).join('') : '<p class="muted small" style="margin:0">Todo en orden según tu perfil ' + esc(P.label.toLowerCase()) + ': no hay alertas.</p>';
    }

    // --- Vista de consejos ---
    var form = $('#profile-form');
    var showForm = !state.profile || editingProfile;
    form.classList.toggle('hidden', !showForm);
    $('#profile-card').classList.toggle('hidden', !state.profile || editingProfile);
    // Se rellena solo al abrirse: un redibujado (p. ej. precios cada 2 min) no borra respuestas a medias
    if (showForm && !form.dataset.filled) { fillProfileForm(); form.dataset.filled = '1'; }
    if (!showForm) delete form.dataset.filled;

    var cur = S.today().slice(0, 7);
    $('#advice-summary').innerHTML = '';
    var sumPrev = summaryHtml(Insights.prevMonth(cur)), sumCur = summaryHtml(cur, { title: monthNameOf(cur).replace(/^./, function (c) { return c.toUpperCase(); }) + ' hasta hoy' });
    $('#advice-summary').classList.toggle('hidden', !sumPrev && !sumCur);
    $('#advice-summary').innerHTML = (sumCur ? sumCur.replace('<div class="card summary-card">', '<div class="summary-card">') : '') +
      (sumPrev ? sumPrev.replace('<div class="card summary-card">', '<div class="summary-card" style="margin-top:14px">') : '');
    if (!recs) {
      $('#recs-headline').textContent = 'Empieza por tu perfil';
      $('#recs-summary').textContent = 'Con tus respuestas ajusto los límites de riesgo, el fondo de emergencia y la meta de ahorro.';
      $('#recs-list').innerHTML = '';
      return;
    }
    var counts = { alta: 0, media: 0, baja: 0, ok: 0 };
    recs.forEach(function (r) { counts[r.severity]++; });
    var pending = counts.alta + counts.media + counts.baja;
    $('#recs-headline').textContent = pending ? pending + (pending === 1 ? ' recomendación para ti' : ' recomendaciones para ti') : 'Todo en orden';
    $('#recs-summary').textContent = [
      counts.alta && counts.alta + (counts.alta === 1 ? ' importante' : ' importantes'),
      counts.media && counts.media + ' de atención',
      counts.baja && counts.baja + (counts.baja === 1 ? ' sugerencia' : ' sugerencias'),
      counts.ok && counts.ok + (counts.ok === 1 ? ' punto bien' : ' puntos bien')
    ].filter(Boolean).join(' · ');

    var pr = state.profile;
    $('#profile-card').innerHTML =
      '<div class="profile-head"><div><div class="eyebrow">Tu perfil de inversor</div><div class="profile-type">' + esc(P.label) + '</div></div>' +
      '<button type="button" data-action="edit-profile">Editar perfil</button></div>' +
      '<p class="rec-why" style="margin-top:6px">' + esc(P.desc) + ' Puntaje ' + pr.score + ' de 20' +
      (pr.cappedFrom ? ' (te correspondía ' + esc(Advisor.PROFILES[pr.cappedFrom].label.toLowerCase()) + ', pero tu horizonte es corto y conviene menos riesgo)' : '') + '.</p>' +
      (pr.goals && pr.goals.length ? '<p class="small muted" style="margin:6px 0 0">Objetivos: ' + pr.goals.map(function (g) { return esc(Advisor.GOALS[g]); }).join(', ') + '</p>' : '') +
      '<div class="profile-params">' +
      '<div><span>Inversiones de riesgo</span><b>' + P.risk[0] + '–' + P.risk[1] + ' % del patrimonio</b></div>' +
      '<div><span>Cripto como máximo</span><b>' + P.cryptoMax + ' %</b></div>' +
      '<div><span>Fondo de emergencia</span><b>' + (Number(pr.emergencyMonths) || P.emergency) + ' meses</b></div>' +
      '<div><span>Meta de ahorro</span><b>' + (Number(pr.savingsGoal) || 20) + ' %</b></div></div>';

    var review = Insights.profileReview(state, state.profile, S.today());
    if (review.length) {
      $('#profile-card').insertAdjacentHTML('beforeend', '<div class="review-box"><b>Conviene repetir el test</b><ul>' +
        review.map(function (x) { return '<li>' + esc(x.text) + '</li>'; }).join('') + '</ul>' +
        '<button type="button" class="primary" data-action="review-profile">Repetir el test (1 min)</button></div>');
    }
    $('#recs-list').innerHTML = recs.map(function (r) {
      return '<article class="rec" data-sev="' + r.severity + '">' +
        '<div class="rec-top">' + sevBadge(r.severity) + '<span class="tag">' + esc(r.area) + '</span></div>' +
        '<div class="rec-title">' + esc(r.title) + '</div>' +
        '<p class="rec-why"><b>Por qué:</b> ' + esc(r.why) + '</p>' +
        '<details><summary>Cómo se calculó</summary><div class="rec-data">' + esc(r.data) + '</div></details></article>';
    }).join('');
  }

  function fillProfileForm() {
    var pr = state.profile || {};
    var ans = pr.answers || {};
    $('#quiz').innerHTML = Advisor.QUESTIONS.map(function (q, qi) {
      return '<fieldset class="quiz-q"><legend>' + (qi + 1) + '. ' + esc(q.text) + '</legend><div class="quiz-opts">' +
        q.options.map(function (o, oi) {
          return '<label><input type="radio" name="q_' + q.id + '" value="' + (oi + 1) + '"' + (Number(ans[q.id]) === oi + 1 ? ' checked' : '') + ' required>' + esc(o) + '</label>';
        }).join('') + '</div></fieldset>';
    }).join('');
    $('#goals').innerHTML = Object.keys(Advisor.GOALS).map(function (g) {
      return '<label><input type="checkbox" name="goal" value="' + g + '"' + ((pr.goals || []).indexOf(g) !== -1 ? ' checked' : '') + '>' + esc(Advisor.GOALS[g]) + '</label>';
    }).join('');
    var f = $('#profile-form');
    f.emergencyMonths.value = pr.emergencyMonths || '';
    f.savingsGoal.value = pr.savingsGoal || 20;
  }

  function onProfileSubmit(e) {
    e.preventDefault();
    var f = e.target, answers = {}, missing = 0;
    Advisor.QUESTIONS.forEach(function (q) {
      var c = f.querySelector('input[name="q_' + q.id + '"]:checked');
      if (c) answers[q.id] = Number(c.value); else missing++;
    });
    if (missing) { toast('Responde las 5 preguntas (faltan ' + missing + ')'); return; }
    var goal = num(f.savingsGoal.value);
    if (!(goal > 0 && goal < 100)) { toast('La meta de ahorro debe estar entre 1 y 99 %'); return; }
    var res = Advisor.scoreProfile(answers);
    state.profile = {
      answers: answers, score: res.score, type: res.type, cappedFrom: res.cappedFrom,
      goals: $$('input[name="goal"]:checked', f).map(function (x) { return x.value; }),
      emergencyMonths: f.emergencyMonths.value ? Number(f.emergencyMonths.value) : null,
      savingsGoal: goal, updatedAt: Date.now(),
      context: Insights.profileContext(state, S.today())   // para proponer repetir el test si tu situación cambia
    };
    editingProfile = false;
    persist();
    window.scrollTo(0, 0);
    toast('Tu perfil: ' + Advisor.PROFILES[res.type].label);
  }

  /** Aviso de copia de seguridad: con datos y sin copia en los últimos 30 días. */
  function renderBackupReminder() {
    var count = state.transactions.length + state.investments.length;
    var last = state.settings.lastBackupAt;
    var days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    var show = count >= 5 && (days === null || days >= 30);
    $('#backup-reminder').innerHTML = show
      ? '<div class="warning reminder"><span>' + (days === null ? 'Aún no has descargado una copia de seguridad (archivo fuera del dispositivo).' : 'Hace ' + days + ' días que no descargas una copia de seguridad (archivo fuera del dispositivo).') +
        '</span><button type="button" data-action="backup">Hacer copia ahora</button></div>' : '';
  }

  // ================================================================ ficha de activo
  // Búsqueda, logo, historial, precio en vivo y gráfico con tus compras y ventas.
  var asset = null;          // ficha abierta
  var lastLiveSave = 0;
  var POPULAR = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'USDC'];
  var RANGE_LABELS = { mis: 'Mis operaciones', '1D': '1 D', '1S': '1 S', '1M': '1 M', '3M': '3 M', '1A': '1 A', todo: 'Todo' };

  function metaKey(type, ticker) { return C.priceKey(type, ticker); }
  function meta(type, ticker) { return (state.assetMeta && state.assetMeta[metaKey(type, ticker)]) || null; }
  function logoHtml(type, ticker, cls) {
    var m = meta(type, ticker);
    var initials = esc(String(ticker).slice(0, 4));
    // Sin logo guardado: para cripto se prueba el repositorio de iconos; si falla, iniciales.
    var src = m && m.logo ? m.logo : (type === 'cripto' ? 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + String(ticker).toLowerCase() + '.png' : null);
    return '<span class="' + cls + '">' + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'' + initials + '\'))">' : initials) + '</span>';
  }
  function assetBadge(p) {
    var m = meta(p.assetType, p.ticker);
    return m && m.logo ? logoHtml(p.assetType, p.ticker, 'asset-badge has-logo')
      : '<span class="asset-badge" style="--type-color:' + ASSET_COLORS[p.assetType] + '">' + esc(p.ticker.slice(0, 4)) + '</span>';
  }
  function quoteCurrency(type, ticker) {
    if (type === 'cripto' || type === 'accion' || type === 'etf') return 'USD';
    if (type === 'divisa') return base();
    var op = state.investments.filter(function (o) { return o.assetType === type && o.ticker === ticker; })[0];
    return op ? op.currency : base();
  }

  /** Abre la ficha de un activo (cripto, acción, ETF, divisa u otro). */
  function openAsset(type, ticker) {
    type = ASSET_LABELS[type] ? type : 'cripto';
    ticker = String(ticker).trim().toUpperCase().replace(/USDT$/, '') || 'BTC';
    closeAsset();
    var ops = state.investments.filter(function (o) { return o.assetType === type && o.ticker.toUpperCase() === ticker; });
    var q = state.prices[C.priceKey(type, ticker)];
    asset = {
      type: type, ticker: ticker, quoteCur: quoteCurrency(type, ticker), hasOps: ops.length > 0,
      range: ops.length ? 'mis' : (type === 'cripto' ? '1M' : 'mis'), points: [], loadId: 0,
      price: q && q.price != null ? q.price : null, change24h: q ? q.change24h : null, priceTime: q ? (q.lastAttempt || q.time) : null,
      status: 'connecting', chart: null, lastChart: 0
    };
    // Mostrar la vista (pestaña Inversiones activa)
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-activo'); });
    $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.view === 'inversiones'); });
    $('#settings-btn').classList.remove('active');
    var hash = '#activo/' + type + '/' + encodeURIComponent(ticker);
    if (location.hash !== hash) history.replaceState(null, '', hash);
    window.scrollTo(0, 0);
    hideSearch();

    renderAssetHeader();
    renderAssetRanges();
    renderAssetPosition();
    loadAssetMeta();
    loadAssetHistory();
    startLive();
    loadAssetInsights();
  }

  function closeAsset() {
    if (!asset) return;
    if (asset.conn) asset.conn.close();
    asset = null;
    S.save(state);
  }

  async function loadAssetMeta() {
    var a = asset, key = metaKey(a.type, a.ticker);
    state.assetMeta = state.assetMeta || {};
    var cached = state.assetMeta[key];
    if (cached && Date.now() - (cached.at || 0) < 7 * 86400000) return;
    var m;
    if (a.type === 'cripto') m = await Market.fetchCryptoMeta(a.ticker);
    else if (a.type === 'accion' || a.type === 'etf') m = await Market.fetchStockMeta(a.ticker, state.settings.finnhubKey);
    else m = { name: a.type === 'divisa' ? 'Divisa ' + a.ticker : a.ticker };
    state.assetMeta[key] = Object.assign({}, m, { at: Date.now() });
    S.save(state);
    if (asset === a) renderAssetHeader();
  }

  function renderAssetHeader() {
    var a = asset; if (!a) return;
    var m = meta(a.type, a.ticker) || {};
    $('#ad-logo').innerHTML = m.logo
      ? '<img src="' + esc(m.logo) + '" alt="" onerror="this.parentNode.textContent=\'' + esc(a.ticker.slice(0, 4)) + '\'">'
      : esc(a.ticker.slice(0, 4));
    $('#ad-name').textContent = m.name && m.name.toUpperCase() !== a.ticker ? m.name : a.ticker;
    $('#ad-sub').textContent = a.ticker + (a.type === 'cripto' ? '/USDT · Binance' : '') + ' · ' + ASSET_LABELS[a.type] + (m.exchange ? ' · ' + m.exchange : '');
    renderAssetPrice(null);
  }

  function renderAssetPrice(prev) {
    var a = asset; if (!a) return;
    var el = $('#ad-price');
    el.textContent = a.price != null ? fmtPrice(a.price, a.quoteCur) : '—';
    if (prev != null && a.price !== prev) {
      el.classList.remove('tick-up', 'tick-down');
      void el.offsetWidth; // reinicia la animación
      el.classList.add(a.price > prev ? 'tick-up' : 'tick-down');
      clearTimeout(renderAssetPrice._t);
      renderAssetPrice._t = setTimeout(function () { el.classList.remove('tick-up', 'tick-down'); }, 350);
    }
    $('#ad-change').innerHTML = a.change24h != null && isFinite(a.change24h)
      ? '<span class="' + trend(a.change24h) + '">' + fmtPct(a.change24h) + '</span> <span class="muted small">24 h</span>' : '';
    var st = $('#ad-live');
    var labels = {
      live: ['on', 'En vivo · Binance · ' + (a.priceTime ? new Date(a.priceTime).toLocaleTimeString(LOCALE) : '')],
      polling: ['on', 'Actualizando ' + (a.type === 'cripto' ? 'cada 5 s' : 'cada 15 s') + ' · ' + (a.priceTime ? new Date(a.priceTime).toLocaleTimeString(LOCALE) : '')],
      connecting: ['warn', 'Conectando…'],
      offline: ['', a.offlineMsg || (a.price != null ? 'Sin conexión · último precio ' + fmtTime(a.priceTime) : 'Sin conexión')],
      manual: ['', a.price != null ? 'Precio manual · ' + fmtTime(a.priceTime) : 'Sin precio: ingrésalo en «Mis activos»']
    };
    var l = labels[a.status] || labels.offline;
    st.innerHTML = '<span class="live-dot ' + l[0] + '"></span>' + esc(l[1]);
  }

  function startLive() {
    var a = asset;
    var onTick = function (t) {
      if (asset !== a) return;
      var prev = a.price;
      a.price = t.price; a.priceTime = t.time || Date.now();
      if (t.change24h != null && isFinite(t.change24h)) a.change24h = t.change24h;
      if (isFinite(t.volume)) a.volume = t.volume;
      renderAssetPrice(prev);
      updateLivePoint();
      saveLivePrice(a);
    };
    var onStatus = function (st, msg) { if (asset !== a) return; a.status = st; a.offlineMsg = msg || null; renderAssetPrice(null); };
    if (a.type === 'cripto') a.conn = Market.liveCrypto(a.ticker, onTick, onStatus);
    else if (a.type === 'accion' || a.type === 'etf') {
      if (state.settings.finnhubKey) a.conn = Market.liveStock(a.ticker, state.settings.finnhubKey, onTick, onStatus);
      else { a.status = 'offline'; a.offlineMsg = 'Para el precio en vivo de acciones añade tu API key de Finnhub en Ajustes'; renderAssetPrice(null); }
    } else if (a.type === 'divisa') {
      var r = rates()[a.ticker];
      a.price = r > 0 ? r : null; a.status = r > 0 ? 'manual' : 'offline'; a.priceTime = state.settings.ratesUpdatedAt;
      a.offlineMsg = 'Tasa de cambio actual de ' + a.ticker; renderAssetPrice(null);
    } else { a.status = 'manual'; renderAssetPrice(null); }
  }

  /** Si tienes el activo, el precio en vivo también actualiza tu portafolio (se guarda como máximo cada 30 s). */
  function saveLivePrice(a) {
    var key = C.priceKey(a.type, a.ticker);
    if (!state.investments.some(function (o) { return C.priceKey(o.assetType, o.ticker) === key; })) return;
    var prev = state.prices[key] || {};
    state.prices[key] = Object.assign({}, prev, { price: a.price, currency: a.quoteCur, change24h: a.change24h, time: a.priceTime, lastAttempt: Date.now(),
      source: a.type === 'cripto' ? 'Binance' : 'Finnhub', error: null });
    if (Date.now() - lastLiveSave > 30000) { lastLiveSave = Date.now(); S.save(state); }
  }

  function renderAssetRanges() {
    var a = asset;
    var ranges = (a.type === 'cripto' ? ['1D', '1S', '1M', '3M', '1A', 'todo'] : []);
    if (a.hasOps) ranges.unshift('mis');
    $('#ad-ranges').innerHTML = ranges.map(function (r) {
      return '<button type="button" data-asset-range="' + r + '" aria-pressed="' + (a.range === r) + '">' + RANGE_LABELS[r] + '</button>';
    }).join('');
  }

  function firstOpTime(a) {
    var m = C.opMarkers(state.investments, a.type, a.ticker, rates(), a.quoteCur);
    return m.length ? m[0].t : null;
  }

  async function loadAssetHistory() {
    var a = asset; if (!a) return;
    var id = ++a.loadId;
    $('#ad-chart').innerHTML = '<p class="muted">Cargando historial…</p>';
    $('#ad-chart-note').textContent = '';
    try {
      if (a.type === 'cripto') {
        var plan = C.klinePlan(a.range, Date.now(), firstOpTime(a));
        a.interval = plan.interval;
        a.points = await Market.fetchKlines(a.ticker, plan.interval, plan);
      } else if (a.type === 'accion' || a.type === 'etf') {
        var from = (firstOpTime(a) || Date.now() - 90 * 86400000) - 7 * 86400000;
        a.interval = '1d';
        a.points = await Market.fetchStockCandles(a.ticker, state.settings.finnhubKey, from, Date.now());
      } else {
        a.points = [];
        throw new Error('No hay historial público para este tipo de activo');
      }
      if (asset !== a || id !== a.loadId) return;
      a.historyError = null;
    } catch (e) {
      if (asset !== a || id !== a.loadId) return;
      a.points = []; a.historyError = e.message;
    }
    renderAssetChart();
    renderAssetPosition();
  }

  /** Mueve el último punto del gráfico al precio en vivo (cada 5 s, y nunca mientras lo exploras). */
  function updateLivePoint() {
    var a = asset;
    if (!a || !a.points.length || a.price == null) return;
    var last = a.points[a.points.length - 1];
    a.points[a.points.length - 1] = [Math.max(last[0], a.priceTime || Date.now()), a.price];
    if (Date.now() - a.lastChart > 5000 && !(a.chart && a.chart.isHovering())) renderAssetChart();
  }

  function opTipHtml(m) {
    var o = m.op, total = C.operationTotal(o);
    return '<b>' + (o.side === 'compra' ? '▲ Compra' : '▼ Venta') + ' · ' + fmtDate(o.date) + '</b>' +
      '<div class="row"><span>Cantidad</span><span>' + fmtNum(o.quantity) + ' ' + esc(o.ticker) + '</span></div>' +
      '<div class="row"><span>Precio</span><span>' + fmtPrice(o.price, o.currency) + '</span></div>' +
      (o.fee ? '<div class="row"><span>Comisión</span><span>' + fmtMoney(o.fee, o.currency) + '</span></div>' : '') +
      '<div class="row"><span>' + (o.side === 'compra' ? 'Pagaste' : 'Recibiste') + '</span><span>' + fmtMoney(total, o.currency) + '</span></div>' +
      (m.converted ? '<div class="small">Precio convertido a ' + esc(asset.quoteCur) + ' con la tasa actual</div>' : '');
  }

  function renderAssetChart() {
    var a = asset; if (!a) return;
    a.lastChart = Date.now();
    var all = C.opMarkers(state.investments, a.type, a.ticker, rates(), a.quoteCur);
    var pts = a.points;
    var t0 = pts.length ? pts[0][0] : 0, t1 = pts.length ? pts[pts.length - 1][0] : 0;
    var slack = 86400000; // una operación (sin hora) cae dentro del día
    var shown = all.filter(function (m) { return m.t >= t0 - slack && m.t <= t1 + slack; })
      .map(function (m) { return { t: Math.min(Math.max(m.t, t0), t1), y: m.y, kind: m.kind, html: opTipHtml(m) }; });
    var hidden = all.length - shown.length;

    var pos = C.buildPositions(state.investments.filter(function (o) { return o.assetType === a.type && o.ticker.toUpperCase() === a.ticker; }), rates()).positions[0];
    var ref = null;
    if (pos && pos.quantity > 0) {
      var avg = C.convert(pos.avgPrice, pos.currency, a.quoteCur, rates());
      if (pos.currency === a.quoteCur) avg = pos.avgPrice;
      if (isFinite(avg)) ref = { y: avg, label: 'Tu costo promedio ' + fmtPrice(avg, a.quoteCur) };
    }

    var COLORS_A = { price: 'var(--s1)', buy: 'var(--s3)', sell: 'var(--s2)' };
    $('#ad-legend').innerHTML = '<span><i class="line-key" style="background:' + COLORS_A.price + '"></i>Precio (' + esc(a.quoteCur) + ')</span>' +
      (all.some(function (m) { return m.kind === 'compra'; }) ? '<span><i class="tri up" style="--tri:' + COLORS_A.buy + '"></i>Compra</span>' : '') +
      (all.some(function (m) { return m.kind === 'venta'; }) ? '<span><i class="tri down" style="--tri:' + COLORS_A.sell + '"></i>Venta</span>' : '') +
      (ref ? '<span><i class="dash"></i>Tu costo promedio</span>' : '');

    if (!pts.length) {
      $('#ad-chart').innerHTML = '<p class="muted">' + esc(a.historyError || 'Sin historial disponible.') + '</p>';
      $('#ad-stats').innerHTML = '';
      $('#ad-chart-note').textContent = all.length ? 'Tus operaciones de ' + a.ticker + ' están en la lista de abajo.' : '';
      return;
    }
    var span = t1 - t0;
    var xFormat = function (t) {
      var d = new Date(t);
      if (span <= 2 * 86400000) return d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
      if (span <= 120 * 86400000) return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
      return d.toLocaleDateString(LOCALE, { month: 'short', year: '2-digit' });
    };
    var fine = /m$|h$/.test(a.interval || '');
    a.chart = Charts.price($('#ad-chart'), {
      points: pts, markers: shown, ref: ref, color: COLORS_A.price, buyColor: COLORS_A.buy, sellColor: COLORS_A.sell,
      xFormat: xFormat, yFormat: function (v) { return fmtCompactPrice(v); },
      ariaLabel: 'Precio histórico de ' + a.ticker + ' con tus operaciones',
      tooltip: function (i) {
        var d = new Date(pts[i][0]);
        return '<b>' + (fine ? d.toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })) +
          '</b><div class="row"><span>Precio</span><span>' + fmtPrice(pts[i][1], a.quoteCur) + '</span></div>';
      }
    });
    $('#ad-chart-note').textContent = hidden > 0 ? hidden + ' operación(es) fuera de este rango: elige «Mis operaciones» para verlas todas.' : '';

    var vals = pts.map(function (p) { return p[1]; });
    var chg = C.round((vals[vals.length - 1] / vals[0] - 1) * 100, 2);
    $('#ad-stats').innerHTML = stat('Cambio en el rango', '<span class="' + trend(chg) + '">' + fmtPct(chg) + '</span>') +
      stat('Máximo', fmtPrice(Math.max.apply(null, vals), a.quoteCur)) + stat('Mínimo', fmtPrice(Math.min.apply(null, vals), a.quoteCur)) +
      (a.volume ? stat('Volumen 24 h', fmtMoney(a.volume, a.quoteCur)) : '');
  }

  function fmtCompactPrice(v) {
    var a = Math.abs(v);
    if (a >= 1e6) return fmtNum(v / 1e6, 0, 2) + ' M';
    if (a >= 1e4) return fmtNum(v / 1e3, 0, 1) + ' k';
    return fmtNum(v, 0, a >= 100 ? 0 : a >= 1 ? 2 : 6);
  }

  function renderAssetPosition() {
    var a = asset; if (!a) return;
    var b = base();
    var ops = state.investments.filter(function (o) { return o.assetType === a.type && o.ticker.toUpperCase() === a.ticker; })
      .sort(function (x, y) { return x.date < y.date ? 1 : x.date > y.date ? -1 : (y.createdAt || 0) - (x.createdAt || 0); });
    var actions = '<div class="btn-row" style="margin-top:12px"><button type="button" class="primary" data-asset-op="compra">Registrar compra</button>' +
      (ops.length ? '<button type="button" data-asset-op="venta">Registrar venta</button>' : '') + '</div>';
    if (!ops.length) {
      $('#ad-position').innerHTML = '<h2>Mi posición</h2><p class="muted" style="margin:0">Todavía no has operado ' + esc(a.ticker) + '.</p>' + actions;
      return;
    }
    var pos = C.buildPositions(ops, rates()).positions[0];
    var valueBase = a.price != null ? C.toBase(C.round(pos.quantity * a.price, 2), a.quoteCur, rates()) : NaN;
    var pnl = isFinite(valueBase) ? C.round(valueBase - pos.costBase, 2) : NaN;
    var pnlPct = isFinite(pnl) && pos.costBase > 0 ? C.round(pnl / pos.costBase * 100, 2) : NaN;
    $('#ad-position').innerHTML = '<h2>Mi posición</h2>' +
      '<div class="stat-row">' +
      stat('Cantidad', fmtNum(pos.quantity) + ' ' + esc(a.ticker)) +
      stat('Costo promedio', pos.quantity > 0 ? fmtPrice(pos.avgPrice, pos.currency) : '—') +
      stat('Valor actual', pos.quantity > 0 && isFinite(valueBase) ? fmtMoney(valueBase, b) : '—') +
      (pos.quantity > 0 && isFinite(pnl) ? stat('Ganancia / pérdida', '<span class="' + trend(pnl) + '">' + fmtSigned(pnl, b) + ' (' + fmtPct(pnlPct) + ')</span>') : '') +
      (pos.realized ? stat('Realizada', '<span class="' + trend(pos.realizedBase) + '">' + fmtSigned(pos.realizedBase, b) + '</span>') : '') +
      '</div>' +
      '<h3>Mis operaciones <span class="muted small" style="text-transform:none;letter-spacing:0">· toca una para editarla</span></h3><ul class="list">' + ops.map(function (o) {
        var buy = o.side === 'compra', total = C.operationTotal(o);
        return '<li class="clickable" data-edit-inv="' + o.id + '" tabindex="0" role="button"><span class="avatar ' + (buy ? 'out' : 'in') + '">' + icon(buy ? 'i-out' : 'i-in') + '</span>' +
          '<div class="main"><div class="title">' + (buy ? '▲ Compra' : '▼ Venta') + '</div><div class="sub">' + fmtDate(o.date) + ' · ' + fmtNum(o.quantity) + ' × ' + fmtPrice(o.price, o.currency) + '</div></div>' +
          '<div class="amt">' + (buy ? '−' : '+') + fmtMoney(total, o.currency) + '</div></li>';
      }).join('') + '</ul>' + actions;
  }

  /** Ir a registrar una operación con el activo ya elegido (y el precio en vivo si la moneda coincide). */
  function prefillOperation(side) {
    var a = asset; if (!a) return;
    var price = a.price, quote = a.quoteCur, type = a.type, ticker = a.ticker;
    showView('inversiones');
    resetInvForm();
    var f = $('#inv-form');
    $('#inv-details').open = true;
    f.side.value = side; f.assetType.value = type; f.ticker.value = ticker;
    if (price != null && f.currency.value === quote) f.price.value = C.round(price, 8);
    renderInvAccountSelect(); updateInvPreview();
    $('#inv-details').scrollIntoView({ behavior: 'smooth', block: 'start' });
    f.quantity.focus({ preventScroll: true });
  }

  // ---------- Buscador ----------
  var cryptoList = null, searchSel = -1, stockTimer = null, lastQuery = '';

  function hideSearch() {
    var r = $('#search-results');
    if (!r) return;
    r.classList.add('hidden');
    $('#asset-search').setAttribute('aria-expanded', 'false');
    searchSel = -1;
  }

  function searchItem(it) {
    return '<li role="option" data-open-asset="' + esc(it.type + '|' + it.ticker) + '">' + logoHtml(it.type, it.ticker, 'mini-logo') +
      '<div class="r-main"><div class="r-t">' + esc(it.ticker) + '</div><div class="r-s">' + esc(it.sub) + '</div></div>' +
      (it.price != null ? '<span class="r-p">' + fmtPrice(it.price, 'USD') + '</span>' : '') + '</li>';
  }

  async function runSearch() {
    var input = $('#asset-search'), q = input.value.trim().toUpperCase();
    lastQuery = q;
    var loading = false;
    if (!cryptoList || cryptoList.loading) {
      loading = true;
      if (!cryptoList) {
        cryptoList = []; cryptoList.loading = true;
        Market.listCryptoSymbols().then(function (l) {
          cryptoList = l;
          // Volver a buscar con lo que haya escrito ahora, si el buscador sigue abierto
          if (!$('#search-results').classList.contains('hidden')) runSearch();
        });
      }
    }
    var held = {};
    state.investments.forEach(function (o) { held[o.assetType + '|' + o.ticker.toUpperCase()] = { type: o.assetType, ticker: o.ticker.toUpperCase() }; });
    var mine = Object.keys(held).map(function (k) { return held[k]; }).filter(function (h) { return !q || h.ticker.indexOf(q) !== -1; })
      .map(function (h) { var m = meta(h.type, h.ticker); return { type: h.type, ticker: h.ticker, sub: (m && m.name && m.name !== h.ticker ? m.name + ' · ' : '') + ASSET_LABELS[h.type] + ' · en tu cartera' }; });
    var byTicker = {}; (cryptoList || []).forEach(function (c) { byTicker[c.ticker] = c; });
    var cryptos;
    if (!q) cryptos = POPULAR.filter(function (t) { return byTicker[t] || !cryptoList.length; }).map(function (t) { return byTicker[t] || { ticker: t }; });
    else {
      // Coincidencia exacta primero; luego las que empiezan igual y las que lo contienen, por volumen negociado
      var byVol = function (a, b) { return (b.volume || 0) - (a.volume || 0); };
      var exact = cryptoList.filter(function (c) { return c.ticker === q; });
      var starts = cryptoList.filter(function (c) { return c.ticker !== q && c.ticker.indexOf(q) === 0; }).sort(byVol);
      var has = cryptoList.filter(function (c) { return c.ticker.indexOf(q) > 0; }).sort(byVol);
      cryptos = exact.concat(starts, has).slice(0, 8);
    }
    cryptos = cryptos.filter(function (c) { return !held['cripto|' + c.ticker]; }).map(function (c) {
      var m = meta('cripto', c.ticker);
      return { type: 'cripto', ticker: c.ticker, sub: (m && m.name && m.name !== c.ticker ? m.name + ' · ' : '') + 'Cripto · Binance', price: c.price };
    });
    var html = '';
    if (mine.length) html += '<li class="grp" role="presentation">En tu cartera</li>' + mine.map(searchItem).join('');
    if (cryptos.length) html += '<li class="grp" role="presentation">' + (q ? 'Cripto' : 'Cripto populares') + '</li>' + cryptos.map(searchItem).join('');
    html += '<li class="grp hidden" role="presentation" id="stock-grp">Acciones y ETF (Finnhub)</li>';
    if (loading) html = '<li class="grp" role="presentation">Cargando lista de Binance…</li>' + html;
    else if (!html.replace(/<li class="grp hidden"[^]*$/, '')) html = '<li class="grp" role="presentation">Sin resultados para «' + esc(q) + '»</li>' + html;
    var list = $('#search-results');
    list.innerHTML = html;
    list.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
    searchSel = -1;

    // Acciones y ETF (si hay API key), con espera para no saturar
    clearTimeout(stockTimer);
    if (q && state.settings.finnhubKey) {
      stockTimer = setTimeout(async function () {
        var res = await Market.searchStocks(q, state.settings.finnhubKey);
        if (lastQuery !== q || !res.length) return;
        var g = $('#stock-grp'); if (!g) return;
        g.classList.remove('hidden');
        g.insertAdjacentHTML('afterend', res.filter(function (r) { return !held[r.assetType + '|' + r.ticker]; })
          .map(function (r) { return searchItem({ type: r.assetType, ticker: r.ticker, sub: r.name + ' · ' + ASSET_LABELS[r.assetType] }); }).join(''));
      }, 400);
    }
  }

  function moveSearchSel(delta) {
    var items = $$('#search-results li[data-open-asset]');
    if (!items.length) return;
    searchSel = (searchSel + delta + items.length) % items.length;
    items.forEach(function (li, i) { li.setAttribute('aria-selected', i === searchSel ? 'true' : 'false'); });
    items[searchSel].scrollIntoView({ block: 'nearest' });
  }

  function openFromSearch() {
    var items = $$('#search-results li[data-open-asset]');
    var q = $('#asset-search').value.trim().toUpperCase();
    var pick = items[searchSel] || items[0];
    if (pick) { var p = pick.dataset.openAsset.split('|'); $('#asset-search').value = ''; openAsset(p[0], p[1]); }
    else if (q) { $('#asset-search').value = ''; openAsset('cripto', q); }
  }

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

  // ================================================================ clientes (directorio de personas)
  var peopleCache = [];        // Calc.peopleIndex: se recalcula en cada render
  var personOpenKey = null;    // ficha abierta en Cuentas → Clientes
  function renderPeople() { peopleCache = C.peopleIndex(state, S.today()); }
  function personByKey(k) { return peopleCache.filter(function (p) { return p.key === k; })[0] || null; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function personMeta(p) {
    var parts = [];
    if (p.exchanges) parts.push(plural(p.exchanges, 'cambio', 'cambios'));
    if (p.sales) parts.push(plural(p.sales, 'venta', 'ventas'));
    if (p.loans) parts.push(plural(p.loans, 'préstamo', 'préstamos'));
    if (p.debts) parts.push(plural(p.debts, 'deuda', 'deudas'));
    return (parts.join(' · ') || 'Sin operaciones') + (p.last ? ' · última ' + fmtDate(p.last) : '');
  }
  function personBalance(p, b) {
    return (p.owesYou > 0 ? '<span class="owes">te debe ' + fmtMoney(p.owesYou, b) + '</span>' : '') +
      (p.youOwe > 0 ? (p.owesYou > 0 ? '<br>' : '') + '<span class="owe">le debes ' + fmtMoney(p.youOwe, b) + '</span>' : '');
  }

  // ---- Sugerencias al escribir el nombre (cambios, ventas, préstamos, deudas)
  var sug = { input: null, items: [], sel: -1, mute: false };
  function hideSuggest() {
    if (sug.input) { var ul = sug.input.closest('label').querySelector('.people-suggest'); if (ul) ul.remove(); }
    sug.input = null; sug.items = []; sug.sel = -1;
  }
  function showSuggest(input) {
    if (sug.mute) return;
    if (sug.input && sug.input !== input) hideSuggest();
    var lab = input.closest('label'); lab.classList.add('has-suggest');
    var txt = input.value.trim(), key = C.personKey(txt);
    var list = C.matchPeople(peopleCache, txt, 6);
    var exact = peopleCache.some(function (p) { return p.key === key; });
    var items = list.map(function (p) { return { p: p }; });
    if (txt && !exact) items.push({ name: txt });
    if (!items.length || (items.length === 1 && items[0].p && items[0].p.key === key)) { hideSuggest(); return; }
    sug.input = input; sug.items = items; if (sug.sel >= items.length) sug.sel = -1;
    var ul = lab.querySelector('.people-suggest');
    if (!ul) { ul = document.createElement('ul'); ul.className = 'people-suggest'; ul.setAttribute('role', 'listbox'); lab.appendChild(ul); }
    var b = base();
    ul.innerHTML = items.map(function (it, i) {
      if (it.p) return '<li role="option" data-sug="' + i + '"' + (i === sug.sel ? ' class="sel"' : '') + '><span class="avatar">' + initials(it.p.name) + '</span>' +
        '<div class="main"><div>' + esc(it.p.name) + '</div><div class="sub">' + esc(personMeta(it.p)) +
        (it.p.owesYou > 0 ? ' · te debe ' + esc(fmtMoney(it.p.owesYou, b)) : '') + (it.p.youOwe > 0 ? ' · le debes ' + esc(fmtMoney(it.p.youOwe, b)) : '') + '</div></div></li>';
      return '<li role="option" class="new' + (i === sug.sel ? ' sel' : '') + '" data-sug="' + i + '">＋ Nuevo cliente: «' + esc(it.name) + '» <span class="sub">· se registra al guardar</span></li>';
    }).join('');
  }
  function chooseSuggest(i) {
    var it = sug.items[i], input = sug.input;
    if (!it || !input) return;
    if (it.p) {
      input.value = it.p.name;
      sug.mute = true;
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
      sug.mute = false;
    }
    hideSuggest();
  }

  // ---- Pestaña Clientes
  var HIST_LABEL = { cambio: 'Cambio', venta: 'Venta', prestamo: 'Préstamo', deuda: 'Deuda' };
  function histItemHtml(h) {
    var r = h.rec, title, tag = '', amt, icn = 'i-swap', av = 'tr';
    if (h.kind === 'cambio') {
      title = 'Cambio ' + fmtMoney(r.received, r.inCurrency) + ' → ' + r.outCurrency;
      tag = h.status === 'completada' ? '' : '<span class="tag warn">' + (C.exchangeSettlement(r).side === 'in' ? 'Falta cobrar ' : 'Falta entregar ') + fmtMoney(h.pending, h.pendingCurrency) + '</span>';
      var pr = C.exchangeProfit(r, rates()).profit;
      amt = '<span class="' + (h.status === 'completada' ? trend(pr) : 'muted') + '">' + fmtSigned(pr, base()) + '</span><div class="sub">' + (h.status === 'completada' ? 'ganancia' : 'prevista') + '</div>';
    } else if (h.kind === 'venta') {
      icn = 'i-in'; av = 'in';
      title = r.concept ? esc(r.concept) : 'Venta';
      tag = h.status === 'contado' ? '<span class="tag ok-soft">Contado</span>' : h.status === 'pagada' ? '<span class="tag ok">Cobrada</span>' : '<span class="tag warn">Falta cobrar ' + fmtMoney(h.pending, r.currency) + '</span>';
      amt = '<span class="up">+' + fmtMoney(r.amount, r.currency) + '</span>';
    } else if (h.kind === 'prestamo') {
      var give = r.kind !== 'recibido'; icn = give ? 'i-out' : 'i-in'; av = give ? 'out' : 'in';
      title = (give ? 'Le prestaste ' : 'Te prestó ') + fmtMoney(r.principal, r.currency);
      tag = h.status === 'pagada' ? '<span class="tag ok">Pagado</span>' : h.status === 'vencida' ? '<span class="tag danger">Vencido</span>' : '<span class="tag">Pendiente ' + fmtMoney(h.pending, r.currency) + '</span>';
      amt = fmtMoney(h.pending, r.currency) + '<div class="sub">pendiente</div>';
    } else {
      var cob = r.kind === 'cobrar'; icn = cob ? 'i-in' : 'i-out'; av = cob ? 'in' : 'out';
      title = (cob ? 'Te debe' : 'Le debes') + (r.concept ? ' · ' + esc(r.concept) : '');
      tag = h.status === 'pagada' ? '<span class="tag ok">Saldada</span>' : h.status === 'parcial' ? '<span class="tag">Parcial</span>' : '<span class="tag warn">Pendiente</span>';
      amt = fmtMoney(h.status === 'pagada' ? r.amount : h.pending, r.currency) + '<div class="sub">' + (h.status === 'pagada' ? 'total' : 'pendiente') + '</div>';
    }
    return '<li class="clickable" data-hist="' + h.kind + '|' + h.id + '" tabindex="0" role="button"><span class="avatar ' + av + '">' + icon(icn) + '</span>' +
      '<div class="main"><div class="title">' + title + '</div><div class="sub hist-sub">' + fmtDate(h.date) + (tag ? ' ' + tag : '') + '</div></div>' +
      '<div class="amt">' + amt + '</div></li>';
  }
  function renderPersonCard() {
    var card = $('#person-card'), p = personOpenKey ? personByKey(personOpenKey) : null;
    if (!p) { personOpenKey = null; card.classList.add('hidden'); return; }
    var b = base(), c = p.contact || {}, hist = C.personHistory(state, p.key, S.today());
    card.classList.remove('hidden');
    card.innerHTML = '<div class="person-head"><span class="avatar">' + initials(p.name) + '</span><div class="main"><div class="name">' + esc(p.name) + '</div>' +
      '<div class="sub muted small">' + (c.phone ? esc(c.phone) + ' · ' : '') + esc(personMeta(p)) + (c.note ? '<br>' + esc(c.note) : '') + '</div></div>' +
      '<button type="button" class="link small" data-action="person-close" aria-label="Cerrar">' + icon('i-x') + '</button></div>' +
      '<div class="kv-grid">' +
        '<div><span>Te debe</span><b class="' + (p.owesYou > 0 ? 'up' : '') + '">' + fmtMoney(p.owesYou, b) + '</b></div>' +
        '<div><span>Le debes</span><b class="' + (p.youOwe > 0 ? 'down' : '') + '">' + fmtMoney(p.youOwe, b) + '</b></div>' +
        '<div><span>Ventas (' + p.sales + ')</span><b>' + fmtMoney(p.salesTotal, b) + '</b></div>' +
        '<div><span>Cambios (' + p.exchanges + ')</span><b>' + fmtMoney(p.fxVolume, b) + '</b></div>' +
        '<div><span>Ganancia en cambios</span><b class="' + trend(p.fxProfit) + '">' + fmtSigned(p.fxProfit, b) + '</b></div>' +
        '<div><span>Préstamos · deudas</span><b>' + p.loans + ' · ' + p.debts + '</b></div></div>' +
      '<div class="person-actions">' +
        '<button type="button" data-action="person-new" data-kind="cambio">+ Cambio</button>' +
        '<button type="button" data-action="person-new" data-kind="venta">+ Venta</button>' +
        '<button type="button" data-action="person-new" data-kind="prestamo">+ Préstamo</button>' +
        '<button type="button" data-action="person-new" data-kind="deuda">+ Deuda</button>' +
        '<button type="button" class="wa-btn" data-action="person-wa">' + icon('i-chat') + (p.owesYou > 0 ? 'Recordar pago' : 'WhatsApp') + '</button>' +
        '<button type="button" class="ghost" data-action="person-edit">Editar ficha</button></div>' +
      '<h3 style="margin-top:14px">Historial (' + hist.length + ')</h3>' +
      '<ul class="list">' + (hist.length ? hist.map(histItemHtml).join('') : '<li class="empty">Todavía no tiene operaciones.</li>') + '</ul>';
  }
  function renderClients() {
    if (accTab !== 'clientes') return;
    var b = base(), ym = thisMonth();
    var owes = C.sum(peopleCache.map(function (p) { return p.owesYou; })), owe = C.sum(peopleCache.map(function (p) { return p.youOwe; }));
    $('#ppl-count').textContent = plural(peopleCache.length, 'persona', 'personas');
    $('#ppl-stats').innerHTML = stat('Te deben', '<span class="up">' + fmtMoney(owes, b) + '</span>') + stat('Les debes', '<span class="' + (owe > 0 ? 'down' : '') + '">' + fmtMoney(owe, b) + '</span>') +
      stat('Con saldo pendiente', String(peopleCache.filter(function (p) { return p.owesYou > 0 || p.youOwe > 0; }).length)) +
      stat('Activos este mes', String(peopleCache.filter(function (p) { return p.last && p.last.slice(0, 7) === ym; }).length));
    var q = $('#ppl-search').value;
    var list = q.trim() ? C.matchPeople(peopleCache, q, 500) : peopleCache;
    $('#ppl-list').innerHTML = list.length ? list.map(function (p) {
      return '<li class="clickable' + (p.key === personOpenKey ? ' editing' : '') + '" data-person="' + esc(p.key) + '" tabindex="0" role="button">' +
        '<span class="avatar">' + initials(p.name) + '</span><div class="main"><div class="title">' + esc(p.name) + '</div>' +
        '<div class="sub">' + esc(personMeta(p)) + '</div></div><div class="amt ppl-amt">' + personBalance(p, b) + '</div></li>';
    }).join('') : '<li class="empty">' + (q.trim() ? 'Nadie coincide con «' + esc(q.trim()) + '». Créalo abajo o al registrar una operación.' : 'Aún no hay clientes: aparecen solos al registrar cambios, ventas, préstamos o deudas.') + '</li>';
    renderPersonCard();
  }
  function openPerson(key) {
    personOpenKey = key;
    if (accTab !== 'clientes') showView('cuentas/clientes');
    renderClients();
    $('#person-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function openHistItem(kind, id) {
    if (kind === 'cambio') { var x = byId(state.exchanges, id), st = x && C.exchangeSettlement(x); if (st && st.status !== 'pagada') openFxSettle(id); else editFx(id); }
    else if (kind === 'venta') { var sv = byId(state.sales, id); if (sv && sv.mode === 'credito') openRef('sale', id); else editSale(id); }
    else if (kind === 'prestamo') openRef('loan', id);
    else if (kind === 'deuda') editDebt(id);
  }
  /** Empieza una operación nueva con el nombre del cliente ya escrito. */
  function personNew(kind) {
    var p = personByKey(personOpenKey); if (!p) return;
    var f;
    if (kind === 'cambio') { showView('cuentas/cambios'); resetFxForm(); f = $('#fx-form'); f.client.value = p.name; syncFxForm(); f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.amount.focus({ preventScroll: true }); }
    else if (kind === 'venta') { showView('cuentas/ventas'); resetSaleForm(); f = $('#sale-form'); f.client.value = p.name; f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.concept.focus({ preventScroll: true }); }
    else if (kind === 'prestamo') { showView('cuentas/prestamos'); resetLoanForm(); f = $('#loan-form'); f.person.value = p.name; f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.principal.focus({ preventScroll: true }); }
    else { showView('cuentas/cobrar'); resetDebtForm(); f = $('#debt-form'); f.person.value = p.name; f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.amount.focus({ preventScroll: true }); }
  }
  function resetContactForm() {
    var f = $('#contact-form'); f.reset(); f.editKey.value = '';
    $('#contact-form-title').textContent = 'Nuevo cliente';
    $('[data-action="cancel-contact"]').classList.add('hidden'); $('[data-action="delete-contact"]').classList.add('hidden');
  }
  function editContact() {
    var p = personByKey(personOpenKey); if (!p) return;
    var f = $('#contact-form'), c = p.contact || {};
    f.editKey.value = p.key; f.label.value = p.name; f.phone.value = c.phone || ''; f.note.value = c.note || '';
    $('#contact-form-title').textContent = 'Editar cliente';
    $('[data-action="cancel-contact"]').classList.remove('hidden');
    $('[data-action="delete-contact"]').classList.toggle('hidden', !p.contact);
    f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.label.focus({ preventScroll: true });
  }
  /** Cambia el nombre en todas las operaciones de una persona (y une historiales si el nombre nuevo ya existía). */
  function renamePerson(oldKey, name) {
    var n = 0, fix = function (list, field) { (list || []).forEach(function (r) { if (C.personKey(r[field]) === oldKey && r[field] !== name) { r[field] = name; n++; } }); };
    fix(state.debts, 'person'); fix(state.exchanges, 'client'); fix(state.sales, 'client'); fix(state.loans, 'person'); fix(state.contacts, 'name');
    return n;
  }
  function onContactSubmit(e) {
    e.preventDefault();
    var f = e.target, name = f.label.value.trim().replace(/\s+/g, ' ');
    if (!name) { toast('Escribe el nombre'); f.label.focus(); return; }
    var key = C.personKey(name), oldKey = f.editKey.value;
    if (oldKey && key !== oldKey && personByKey(key) && !confirm('Ya existe «' + personByKey(key).name + '». ¿Unir los dos historiales en uno solo?')) return;
    var changed = oldKey ? renamePerson(oldKey, name) : 0;
    state.contacts = state.contacts || [];
    var mine = state.contacts.filter(function (c) { return C.personKey(c.name) === key; });
    if (mine.length > 1) state.contacts = state.contacts.filter(function (c) { return c === mine[0] || C.personKey(c.name) !== key; });  // una sola ficha por persona
    var c = mine[0];
    if (c) { c.name = name; c.phone = f.phone.value.trim(); c.note = f.note.value.trim(); }
    else state.contacts.push({ id: S.uid(), name: name, phone: f.phone.value.trim(), note: f.note.value.trim(), createdAt: Date.now() });
    personOpenKey = key;
    resetContactForm();
    persist();
    toast(oldKey ? 'Cliente actualizado' + (changed ? ' · nombre cambiado en ' + plural(changed, 'registro', 'registros') : '') : (personByKey(key) && personByKey(key).total ? 'Ficha guardada' : 'Cliente creado: ' + name));
  }

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

  // ================================================================ comprobantes y WhatsApp
  // Colores de acento (versión clara: es la que se usa en el comprobante, siempre sobre fondo blanco)
  var ACCENTS = { azul: '#256abf', verde: '#0f7a5c', morado: '#6a4bc4', naranja: '#b4531c', rosa: '#b8336a', grafito: '#3a3a38' };
  function rcptSettings() { return state.settings.receipt || {}; }
  /** Contexto de los comprobantes: montos reales aunque el modo privado esté activo. */
  function receiptCtx() {
    var r = rcptSettings();
    return { locale: LOCALE, today: S.today(), business: { name: r.name, phone: r.phone, footer: r.footer },
      loanTerms: function (l) { var p = privacy; privacy = false; try { return loanTermsText(l); } finally { privacy = p; } } };
  }
  function recOf(kind, id) {
    var list = kind === 'fx' ? state.exchanges : kind === 'sale' ? state.sales : kind === 'loan' ? state.loans : state.debts;
    return byId(list || [], id);
  }
  /** Modelo del comprobante de una operación (o del recibo de uno de sus pagos si se da payId). */
  function receiptModel(kind, id, payId) {
    var rec = recOf(kind, id), ctx = receiptCtx();
    if (!rec) return null;
    if (payId) {
      var pm = byId((kind === 'fx' ? rec.settlements : rec.payments) || [], payId);
      return pm ? Receipt.paymentModel(kind, rec, pm, ctx) : null;
    }
    return kind === 'fx' ? Receipt.exchangeModel(rec, ctx) : kind === 'sale' ? Receipt.saleModel(rec, ctx)
      : kind === 'loan' ? Receipt.loanModel(rec, ctx) : Receipt.debtModel(rec, ctx);
  }
  function personOf(kind, id) { var r = recOf(kind, id); return r ? (r.client || r.person || '') : ''; }
  function contactOf(name) {
    var k = C.personKey(name); if (!k) return null;
    return (state.contacts || []).filter(function (c) { return C.personKey(c.name) === k; })[0] || null;
  }
  function waPhone(raw) { return Receipt.normalizePhone(raw, rcptSettings().countryCode); }
  /** Número listo para wa.me, o null (con aviso) si es local y falta el código de país. */
  function waTarget(raw) {
    var ph = waPhone(raw);
    if (ph.charAt(0) === '0' || (ph && ph.length < 8)) {
      toast('Falta el código de país: escribe el número con + (ej.: +58 412…) o ponlo en Ajustes → Comprobantes y WhatsApp');
      return null;
    }
    return ph;
  }
  /** Guarda en la ficha del cliente el teléfono escrito al enviar (crea la ficha si no existe). */
  function rememberPhone(name, phone) {
    if (!String(name || '').trim() || !phone) return;
    var c = contactOf(name);
    if (c) { if (c.phone === phone) return; c.phone = phone; }
    else { state.contacts = state.contacts || []; state.contacts.push({ id: S.uid(), name: name.trim(), phone: phone, note: '', createdAt: Date.now() }); }
    persist();
  }
  function openWa(phone, msg) {
    var url = Receipt.waUrl(phone, msg), w = window.open(url, '_blank');
    if (w) w.opener = null; else location.href = url;
  }
  function canShareFiles() {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] })); } catch (e) { return false; }
  }

  var rcpt = null;   // comprobante abierto: { model, name, canvas, png, pdf }
  function openReceipt(kind, id, payId) {
    var m = receiptModel(kind, id, payId);
    if (!m) { toast('No se encontró la operación'); return; }
    var name = personOf(kind, id), c = contactOf(name), canvas = document.createElement('canvas');
    Receipt.draw(m, canvas, { accent: ACCENTS[uiPrefs().accent] || ACCENTS.azul, scale: 2 });
    var mine = rcpt = { model: m, name: name, canvas: canvas, png: null, pdf: null };
    var share = canShareFiles(), dlg = $('#receipt-dialog');
    $('#rcpt-title').textContent = m.title;
    $('#rcpt-img').src = canvas.toDataURL('image/png');
    $('#rcpt-phone').value = c && c.phone ? c.phone : '';
    $$('[data-share]', dlg).forEach(function (s) { s.textContent = share ? 'Compartir' : 'Descargar'; });
    $('#rcpt-hint').textContent = share
      ? '«Enviar por WhatsApp» abre el chat del cliente con el comprobante escrito. Para mandar el PDF o la imagen, toca «Compartir» y elige WhatsApp.'
      : '«Enviar por WhatsApp» abre el chat con el comprobante escrito. El PDF y la imagen se descargan: arrástralos al chat para adjuntarlos.'
    if (!rcptSettings().name) $('#rcpt-hint').textContent += ' Pon el nombre de tu negocio en Ajustes → Comprobantes y WhatsApp.';
    if (!dlg.open) dlg.showModal();
    // Los archivos se preparan ya: compartir tiene que ocurrir justo al tocar el botón
    Receipt.canvasBlob(canvas, 'image/png').then(function (b) { mine.png = b; return Receipt.pdfBlob(canvas); })
      .then(function (b) { mine.pdf = b; }).catch(function () { /* se generan al tocar */ });
  }
  function downloadBlob(blob, name) {
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  async function shareReceipt(type) {
    if (!rcpt) return;
    var r = rcpt, pdf = type === 'pdf';
    var blob = pdf ? (r.pdf || await Receipt.pdfBlob(r.canvas)) : (r.png || await Receipt.canvasBlob(r.canvas, 'image/png'));
    var file = new File([blob], 'comprobante-' + r.model.number + (pdf ? '.pdf' : '.png'), { type: pdf ? 'application/pdf' : 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: r.model.title, text: r.model.title + ' N.º ' + r.model.number }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    downloadBlob(file, file.name);
    toast(pdf ? 'PDF descargado' : 'Imagen descargada');
  }
  function sendReceiptWa() {
    if (!rcpt) return;
    var raw = $('#rcpt-phone').value.trim();
    var ph = waTarget(raw);
    if (ph === null) { $('#rcpt-phone').focus(); return; }
    rememberPhone(rcpt.name, raw);
    openWa(ph, Receipt.text(rcpt.model));
  }
  function copyReceipt() {
    if (!rcpt) return;
    var t = Receipt.text(rcpt.model);
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Texto copiado'); }, function () { toast('No se pudo copiar'); });
  }
  /** Lo que esta persona te debe (todo o solo una operación), para el recordatorio. */
  function pendingFor(name, onlyId) {
    var k = C.personKey(name);
    return C.thirdParty(state, S.today()).receivables.filter(function (it) {
      return it.status !== 'pagada' && (onlyId ? it.id === onlyId : C.personKey(it.person) === k);
    });
  }
  function remindWa(name, onlyId) {
    var items = pendingFor(name, onlyId), c = contactOf(name), phone = c && c.phone ? waTarget(c.phone) : '';
    if (phone === null) return;
    var msg = items.length ? Receipt.reminderText(name, items.map(function (it) { return Receipt.reminderItem(it, LOCALE); }), rcptSettings().name)
      : 'Hola' + (String(name || '').trim() ? ' ' + String(name).trim().split(/\s+/)[0] : '') + ' 👋';
    if (!phone) toast('Sin teléfono guardado: elige el chat en WhatsApp (o añádelo en su ficha de cliente)');
    openWa(phone, msg);
  }
  /** Botones «Comprobante» y «Recordar por WhatsApp» de la tarjeta de cobros/pagos. */
  function setPayTools(kind, id, remind) {
    var box = $('#pay-tools');
    if (!kind) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    var r = $('#pay-rcpt'), w = $('#pay-remind');
    r.dataset.kind = w.dataset.kind = kind; r.dataset.id = w.dataset.id = id;
    w.classList.toggle('hidden', !remind);
  }
  function rcptFormBtn(kind, show) { $('[data-action="rcpt-form"][data-kind="' + kind + '"]').classList.toggle('hidden', !show); }
  function receiptClick(d) {
    if (d.rcpt) { var p = d.rcpt.split('|'); openReceipt(p[0], p[1], p[2]); return true; }
    switch (d.action) {
      case 'rcpt-open': openReceipt(d.kind, d.id); return true;
      case 'rcpt-form':
        var fid = { fx: '#fx-form', sale: '#sale-form', loan: '#loan-form', debt: '#debt-form' }[d.kind], eid = fid && $(fid).editId.value;
        if (eid) openReceipt(d.kind, eid);
        return true;
      case 'wa-remind': remindWa(personOf(d.kind, d.id), d.id); return true;
      case 'person-wa': var pp = personByKey(personOpenKey); if (pp) remindWa(pp.name); return true;
      case 'rcpt-close': $('#receipt-dialog').close(); return true;
      case 'rcpt-wa': sendReceiptWa(); return true;
      case 'rcpt-pdf': shareReceipt('pdf'); return true;
      case 'rcpt-img': shareReceipt('png'); return true;
      case 'rcpt-copy': copyReceipt(); return true;
    }
    return false;
  }
  function fillReceiptSettings() {
    var f = $('#rcpt-settings'); if (f.contains(document.activeElement)) return;
    var r = rcptSettings();
    f.bizName.value = r.name || ''; f.phone.value = r.phone || ''; f.countryCode.value = r.countryCode || ''; f.footer.value = r.footer || '';
  }
  function bindReceipts() {
    var f = $('#rcpt-settings');
    f.addEventListener('submit', function (e) { e.preventDefault(); });
    f.addEventListener('change', function () {
      state.settings.receipt = { name: f.bizName.value.trim(), phone: f.phone.value.trim(), footer: f.footer.value.trim(), countryCode: f.countryCode.value.replace(/\D/g, '') };
      persist(); toast('Datos de los comprobantes guardados');
    });
    var dlg = $('#receipt-dialog');
    dlg.addEventListener('click', function (e) {   // tocar fuera del recuadro lo cierra
      if (e.target !== dlg) return;
      var r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    });
    dlg.addEventListener('close', function () { rcpt = null; $('#rcpt-img').removeAttribute('src'); });
  }

  // ---- Apariencia (por dispositivo, no se sincroniza)
  function applyLook() {
    var p = uiPrefs(), r = document.documentElement;
    if (p.theme === 'light' || p.theme === 'dark') r.setAttribute('data-theme', p.theme); else r.removeAttribute('data-theme');
    if (p.accent && p.accent !== 'azul' && ACCENTS[p.accent]) r.setAttribute('data-accent', p.accent); else r.removeAttribute('data-accent');
    if (p.font && p.font !== 'm') r.setAttribute('data-font', p.font); else r.removeAttribute('data-font');
    var dark = p.theme === 'dark' || (p.theme !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = dark ? '#0d0d0d' : '#f9f9f7';
  }
  function bindLook() {
    var p = uiPrefs(), card = $('#look-card');
    var check = function (name, v) { var i = card.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (i) i.checked = true; };
    check('look-theme', p.theme || 'auto'); check('look-accent', ACCENTS[p.accent] ? p.accent : 'azul'); check('look-font', p.font || 'm');
    card.addEventListener('change', function (e) {
      var key = { 'look-theme': 'theme', 'look-accent': 'accent', 'look-font': 'font' }[e.target.name];
      if (!key) return;
      setUiPref(key, e.target.value); applyLook();
      renderAll();   // los gráficos se redibujan con el tamaño y los colores nuevos
    });
    if (window.matchMedia) { var mq = matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', applyLook); }
    applyLook();
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

  // ================================================================ ficha de cuenta
  var currentAccountId = null;

  function openAccount(id) {
    var a = account(id);
    if (!a) { showView('cuentas'); return; }
    closeAsset();
    currentAccountId = id;
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-cuenta'); });
    $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.view === 'cuentas'); });
    $('#settings-btn').classList.remove('active');
    var h = '#cuenta/' + id;
    if (location.hash !== h) history.replaceState(null, '', h);
    window.scrollTo(0, 0);
    renderAccountView();
  }

  /** Todo lo que movió dinero o activos de una cuenta, del más reciente al más antiguo. */
  function accountMoves(id) {
    var out = [];
    var push = function (date, title, sub, amount, extra) { out.push({ date: date, title: title, sub: sub, amount: amount, extra: extra || '' }); };
    var mine = function (pm) { return C.splitAmount(C.paySplits(pm), id); };   // parte de esta cuenta (pagos mixtos)
    var mixNote = function (pm, txt) { return pm.splits && pm.splits.length > 1 ? (txt ? txt + ' · ' : '') + 'pago mixto' : txt; };
    var ai, ao, as;
    (state.sales || []).forEach(function (sv) {
      if (sv.mode === 'contado' && (as = C.splitAmount(C.splitsOf(sv.splits, sv.accountId, sv.amount), id))) push(sv.date, 'Venta' + (sv.client ? ' · ' + sv.client : ''), mixNote(sv, sv.concept || ''), as);
      (sv.payments || []).forEach(function (pm) { var v = mine(pm); if (v) push(pm.date, 'Cobro de venta' + (sv.client ? ' · ' + sv.client : ''), mixNote(pm, sv.concept || ''), v); });
    });
    (state.loans || []).forEach(function (l) {
      var rec = l.kind === 'recibido';
      var lp = C.splitAmount(C.splitsOf(l.splits, l.accountId, l.principal), id);
      if (lp) push(l.date, (rec ? 'Préstamo de ' : 'Préstamo a ') + (l.person || ''), mixNote(l, ''), rec ? lp : -lp);
      (l.payments || []).forEach(function (pm) { var v = mine(pm); if (v) push(pm.date, (rec ? 'Pago de préstamo a ' : 'Pago recibido de ') + (l.person || ''), mixNote(pm, pm.note || ''), rec ? -v : v); });
    });
    state.transactions.forEach(function (t) {
      if (t.type === 'transferencia') {
        if (t.fromAccountId === id) push(t.date, 'Transferencia a ' + accName(t.toAccountId), t.note || '', -t.amount);
        if (t.toAccountId === id) push(t.date, 'Transferencia de ' + accName(t.fromAccountId), t.note || '', Number(t.toAmount));
      } else {
        var tp = C.splitAmount(C.splitsOf(t.splits, t.accountId, t.amount), id);
        if (tp) push(t.date, catName(t.categoryId), mixNote(t, t.note || ''), t.type === 'ingreso' ? tp : -tp);
      }
    });
    state.investments.forEach(function (o) {
      var buy = o.side === 'compra', total = C.operationTotal(o);
      var qty = fmtNum(o.quantity) + ' ' + o.ticker;
      if (o.accountId === id) push(o.date, (buy ? 'Compra ' : 'Venta ') + o.ticker, qty + ' × ' + fmtPrice(o.price, o.currency) + (o.custodyAccountId ? ' · guardado en ' + accName(o.custodyAccountId) : ''), buy ? -total : total);
      else if (o.custodyAccountId === id) push(o.date, (buy ? 'Entra ' : 'Sale ') + o.ticker, 'Pagado desde ' + accName(o.accountId), null, (buy ? '+' : '−') + qty);
    });
    state.exchanges.forEach(function (x) {
      var xs = C.exchangeSettlement(x);
      (x.settlements || []).forEach(function (s) {
        var v = mine(s);
        if (v && xs) push(s.date, xs.side === 'in' ? 'Cobro de cambio · ' + (x.client || 'cliente') : 'Entrega de cambio · ' + (x.client || 'cliente'), mixNote(s, s.note || ''), xs.side === 'in' ? v : -v);
      });
      if (xs && xs.side === 'in') { /* lo recibido entra con cada cobro */ }
      else if (x.status !== 'pendiente_cobro' && (ai = C.splitAmount(C.fxSplits(x, 'in'), id))) push(x.date, 'Cambio · recibido de ' + (x.client || 'cliente'), fmtMoney(x.received, x.inCurrency) + ' → ' + fmtMoney(x.delivered, x.outCurrency) + ((x.inSplits || []).length > 1 ? ' · pago mixto' : ''), ai);
      if (xs && xs.side === 'out') { /* lo entregado sale con cada entrega */ }
      else if (x.status !== 'pendiente_entrega' && (ao = C.splitAmount(C.fxSplits(x, 'out'), id))) push(x.date, 'Cambio · entregado a ' + (x.client || 'cliente'), fmtMoney(x.received, x.inCurrency) + ' → ' + fmtMoney(x.delivered, x.outCurrency) + ((x.outSplits || []).length > 1 ? ' · pago mixto' : ''), -ao);
      (x.costs || []).forEach(function (c) { if (c.accountId === id) push(x.date, 'Costo de cambio', c.concept || '', -c.amount); });
    });
    state.debts.forEach(function (d) {
      var c = d.kind === 'cobrar';
      var dp = C.splitAmount(C.splitsOf(d.splits, d.accountId, d.amount), id);
      if (dp) push(d.date, (c ? 'Préstamo a ' : 'Préstamo de ') + d.person, mixNote(d, d.concept || ''), c ? -dp : dp);
      (d.payments || []).forEach(function (pm) { var v = mine(pm); if (v) push(pm.date, (c ? 'Cobro de ' : 'Pago a ') + d.person, mixNote(pm, d.concept || ''), c ? v : -v); });
    });
    return out.sort(function (a, c) { return a.date < c.date ? 1 : a.date > c.date ? -1 : 0; });
  }

  function renderAccountView() {
    if (!currentAccountId || !$('#view-cuenta').classList.contains('active')) return;
    var acc = account(currentAccountId);
    if (!acc) { currentAccountId = null; showView('cuentas'); return; }
    var b = base(), h = C.accountHoldings(state, acc.id), pf = h.portfolio;
    $('#ac-icon').innerHTML = icon(KIND_ICONS[acc.kind] || 'i-wallet');
    $('#ac-name').textContent = acc.name;
    $('#ac-sub').textContent = (S.ACCOUNT_KINDS[acc.kind] || '') + ' · moneda ' + acc.currency;
    $('#ac-total').textContent = fmtMoney(h.total, b);
    $('#ac-stats').innerHTML = stat(acc.currency + ' disponible', fmtMoney(h.cash, acc.currency) + (acc.currency !== b ? ' <span class="muted small">≈ ' + fmtMoney(h.cashBase, b) + '</span>' : '')) +
      (pf.rows.length ? stat('En activos', fmtMoney(pf.value, b)) +
        stat('Ganancia / pérdida', '<span class="' + trend(pf.pnl) + '">' + fmtSigned(pf.pnl, b) + ' (' + fmtPct(pf.pnlPct) + ')</span>') : '');
    $('#ac-actions').innerHTML = '<button type="button" class="primary" data-action="ac-buy">Comprar activo</button>' +
      '<button type="button" data-action="ac-move">Registrar movimiento</button>' +
      '<button type="button" data-edit-acc="' + acc.id + '">Editar cuenta</button>';

    // Activos en la cuenta: saldo disponible + cada posición, con su peso en el total (un solo color)
    var items = [{ label: acc.currency + ' disponible', value: h.cashBase, cash: true }].concat(pf.rows.map(function (r) { return { label: r.position.ticker, value: r.valueBase, row: r }; }));
    var tot = h.total > 0 ? h.total : 1;
    var maxW = Math.max.apply(null, items.map(function (i) { return Math.max(0, i.value); }).concat([1]));
    $('#ac-dist').innerHTML = pf.rows.length ? '<div class="hbars">' + items.map(function (i) {
      var w = C.round(Math.max(0, i.value) / tot * 100, 1);
      return '<div class="hbar" data-tip="' + esc(i.label + ': ' + fmtMoney(i.value, b)) + '"><span class="lbl">' + esc(i.cash ? acc.currency : i.label) + '</span>' +
        '<span class="track"><span class="fill" style="width:' + (Math.max(0, i.value) / maxW * 100) + '%;display:block"></span></span><span class="pct">' + fmtNum(w, 1, 1) + ' %</span></div>';
    }).join('') + '</div>' : '';
    var cashRow = '<li><span class="asset-badge" style="--type-color:var(--muted)">' + esc(acc.currency.slice(0, 4)) + '</span>' +
      '<div class="main"><div class="asset-row"><span class="title">' + esc(acc.currency) + ' <span class="tag">Disponible</span></span><span class="val">' + fmtMoney(h.cash, acc.currency) + '</span></div>' +
      '<div class="asset-row"><span class="sub">Saldo de la cuenta</span>' + (acc.currency !== b ? '<span class="pnl muted">≈ ' + fmtMoney(h.cashBase, b) + '</span>' : '') + '</div></div></li>';
    $('#ac-holdings').innerHTML = cashRow + pf.rows.map(function (r) {
      var p = r.position, q = r.quote;
      return '<li class="clickable" data-open-asset="' + esc(p.assetType + '|' + p.ticker) + '" tabindex="0" role="button">' + assetBadge(p) +
        '<div class="main"><div class="asset-row"><span class="title">' + esc(p.ticker) + ' <span class="tag">' + ASSET_LABELS[p.assetType] + '</span></span>' +
        '<span class="val">' + fmtMoney(r.valueBase, b) + '</span></div>' +
        '<div class="asset-row"><span class="sub">' + fmtNum(p.quantity) + ' ' + esc(p.ticker) + (r.hasPrice && q ? ' · ' + fmtPrice(q.price, q.currency) : ' · sin precio') + '</span>' +
        (r.hasPrice ? '<span class="pnl ' + trend(r.pnlBase) + '">' + fmtSigned(r.pnlBase, b) + ' · ' + fmtPct(r.pnlPct) + '</span>' : '') + '</div>' +
        '<div class="price-line">' + fmtNum(C.round(r.valueBase / tot * 100, 1), 1, 1) + ' % de la cuenta</div></div></li>';
    }).join('');
    $('#ac-holdings-note').textContent = pf.rows.length ? '' :
      'Aún no hay activos guardados en esta cuenta. Al comprar, elige esta cuenta en «Pagado desde» o «Guardado en».';
    if (h.errors.length) $('#ac-holdings-note').textContent = 'Hay ventas de ' + h.errors.map(function (e) { return e.ticker; }).join(', ') + ' mayores a lo guardado en esta cuenta: revisa «Guardado en» en esas operaciones.';

    var moves = accountMoves(acc.id);
    $('#ac-moves').innerHTML = moves.length ? moves.slice(0, 25).map(function (m) {
      var amt = m.amount == null ? '<span class="muted">' + esc(m.extra) + '</span>'
        : '<span class="' + (m.amount > 0 ? 'up' : '') + '">' + (m.amount > 0 ? '+' : '−') + fmtMoney(Math.abs(m.amount), acc.currency) + '</span>';
      return '<li><span class="avatar ' + (m.amount == null ? 'tr' : m.amount > 0 ? 'in' : 'out') + '">' + icon(m.amount == null ? 'i-swap' : m.amount > 0 ? 'i-in' : 'i-out') + '</span>' +
        '<div class="main"><div class="title">' + esc(m.title) + '</div><div class="sub">' + fmtDate(m.date) + (m.sub ? ' · ' + esc(m.sub) : '') + '</div></div>' +
        '<div class="amt">' + amt + '</div></li>';
    }).join('') + (moves.length > 25 ? '<li class="empty">Mostrando los 25 más recientes de ' + moves.length + '.</li>' : '')
      : '<li class="empty">Sin movimientos todavía.</li>';
  }

  /** Comprar un activo desde esta cuenta: el formulario queda con su moneda y la cuenta elegidas. */
  function buyFromAccount() {
    var acc = account(currentAccountId); if (!acc) return;
    showView('inversiones');
    resetInvForm();
    var f = $('#inv-form');
    $('#inv-details').open = true;
    f.side.value = 'compra';
    if (acc.kind === 'broker' || C.pegOf(acc.currency) === 'USD') f.assetType.value = 'cripto';
    fillSelect(f.currency, currencyOptions(), acc.currency);
    renderInvAccountSelect(); f.accountId.value = acc.id; renderInvAccountSelect();
    updateInvPreview();
    $('#inv-details').scrollIntoView({ behavior: 'smooth', block: 'start' });
    f.ticker.focus({ preventScroll: true });
  }

  // ================================================================ sincronización (interfaz)
  var syncStep = null;   // paso intermedio de la configuración: { vaultExists }

  function renderSyncDot() {
    var st = Sync.status(), dot = $('#cloud-dot'), cfg = Sync.config();
    dot.classList.toggle('hidden', !cfg.enabled);
    dot.className = 'cloud-dot ' + (cfg.enabled ? st.state : 'hidden');
    var t = { ok: 'Sincronizado', pending: 'Cambios por subir', syncing: 'Sincronizando…', offline: 'Sin conexión: se sincronizará al volver', error: 'Error de sincronización', login: 'Vuelve a iniciar sesión' };
    $('#settings-btn').title = cfg.enabled ? 'Ajustes · ' + (t[st.state] || '') : 'Ajustes';
  }

  var recoveryMode = false;   // se abrió el enlace «restablecer contraseña» del correo
  function renderSyncCard() {
    var cfg = Sync.config(), st = Sync.status(), body = $('#sync-body');
    if (!body) return;
    renderSyncDot();
    if (recoveryMode && cfg.session) {
      body.innerHTML = '<div class="recovery-box"><b>Elige una contraseña nueva para tu cuenta</b>' +
        '<form class="sync-form" data-sync-form="newpass" style="margin-top:8px"><label>Contraseña nueva (mín. 6 caracteres)<input name="pass" type="password" autocomplete="new-password" minlength="6" required></label>' +
        '<label>Repítela<input name="pass2" type="password" autocomplete="new-password" required></label>' +
        '<div class="actions" style="margin-top:0"><button class="primary" type="submit">Guardar contraseña</button></div></form>' +
        '<p class="hint">Esto cambia la contraseña de la <b>cuenta</b>. Tu contraseña de <b>cifrado</b> no cambia y sigue sin poder recuperarse.</p></div>';
      return;
    }
    var https = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!https) {
      body.innerHTML = '<p class="warning">La sincronización funciona cuando la app está publicada en internet (https). Sigue la guía GUIA-MOVIL.md para publicarla en GitHub Pages; luego ábrela desde ese enlace en el PC y en el móvil.</p>';
      return;
    }
    if (!cfg.url || !cfg.anonKey) {
      body.innerHTML = '<ol class="steps"><li>Crea un proyecto gratis en supabase.com.</li><li>Ejecuta el archivo <b>supabase/setup.sql</b> en su «SQL Editor».</li><li>Copia aquí la URL y la clave «anon public» (Project Settings → API).</li></ol>' +
        '<form class="sync-form" data-sync-form="config"><label>URL del proyecto<input name="url" placeholder="https://xxxx.supabase.co" autocomplete="off" required></label>' +
        '<label>Clave anon public<input name="key" placeholder="eyJ…" autocomplete="off" required></label>' +
        '<div class="actions" style="margin-top:0"><button class="primary" type="submit">Guardar</button></div></form>';
      return;
    }
    if (!cfg.session) {
      // Sincronización activa pero la sesión caducó: solo hace falta entrar otra vez (la clave de cifrado sigue guardada)
      var relogin = cfg.enabled;
      var lastEmail = cfg.lastUser && cfg.lastUser.email || '';
      body.innerHTML = (relogin
        ? '<p class="warning" style="margin-top:0"><b>Tu sesión se cerró.</b> Inicia sesión otra vez para seguir sincronizando. Tus datos están a salvo en este dispositivo' +
          (cfg.pending ? ' y los cambios pendientes se subirán al entrar' : '') + '; no tendrás que escribir la contraseña de cifrado.</p>'
        : '<p class="hint" style="margin-top:0">Usa el mismo correo en el PC y en el móvil.</p>') +
        '<form class="sync-form" data-sync-form="auth"><label>Correo<input name="email" type="email" autocomplete="username" required value="' + esc(lastEmail) + '"></label>' +
        '<label>Contraseña de la cuenta<input name="password" type="password" autocomplete="current-password" minlength="6" required></label>' +
        '<div class="actions" style="margin-top:0">' + (relogin ? '' : '<button type="submit" value="signup">Crear cuenta</button>') + '<button class="primary" type="submit" value="signin">Iniciar sesión</button></div></form>' +
        '<div class="btn-row" style="margin-top:8px"><button type="button" class="link small" data-action="sync-forgot">¿Olvidaste la contraseña de la cuenta?</button>' +
        '<button type="button" class="link small" data-action="sync-reset-config">Cambiar proyecto de Supabase</button></div>';
      return;
    }
    if (!cfg.enabled) {
      if (!syncStep) {
        body.innerHTML = '<p class="muted">Comprobando tu bóveda en la nube…</p>';
        Sync.vaultExists().then(function (ex) { syncStep = { vaultExists: ex }; renderSyncCard(); })
          .catch(function (e) { body.innerHTML = '<p class="warning">' + esc(e.message) + '</p><button type="button" data-action="sync-retry">Reintentar</button>'; });
        return;
      }
      var hasLocal = !Sync.isPristine(state);
      body.innerHTML = syncStep.vaultExists
        ? '<p>Sesión iniciada como <b>' + esc(cfg.session.user.email) + '</b>. Ya tienes datos en la nube: escribe tu contraseña de cifrado para conectar este dispositivo.</p>' +
          '<form class="sync-form" data-sync-form="enable"><label>Contraseña de cifrado<input name="pass" type="password" autocomplete="off" required></label>' +
          (hasLocal ? '<label class="check"><input type="radio" name="mode" value="merge" checked> Combinar los datos de este dispositivo con los de la nube</label>' +
            '<label class="check"><input type="radio" name="mode" value="replace"> Reemplazar este dispositivo con los datos de la nube</label>' : '') +
          '<div class="actions" style="margin-top:0"><button class="primary" type="submit">Conectar este dispositivo</button></div></form>'
        : '<p>Sesión iniciada como <b>' + esc(cfg.session.user.email) + '</b>. Crea tu <b>contraseña de cifrado</b>: protege tus datos en la nube y la pedirá cada dispositivo nuevo.</p>' +
          '<form class="sync-form" data-sync-form="enable"><label>Contraseña de cifrado (mín. 8 caracteres)<input name="pass" type="password" autocomplete="new-password" minlength="8" required></label>' +
          '<label>Repítela<input name="pass2" type="password" autocomplete="new-password" required></label>' +
          '<label class="check"><input type="checkbox" name="ack" required> Entiendo que si la olvido nadie puede recuperar los datos de la nube (conserva también tus copias de seguridad).</label>' +
          '<div class="actions" style="margin-top:0"><button class="primary" type="submit">Activar sincronización</button></div></form>';
      body.insertAdjacentHTML('beforeend', '<button type="button" class="link small" data-action="sync-signout">Cerrar sesión</button>');
      return;
    }
    var labels = { ok: ['on', 'Sincronizado'], pending: ['warn', 'Cambios por subir'], syncing: ['warn', 'Sincronizando…'], offline: ['', 'Sin conexión: se sincronizará al volver'], error: ['', 'Error: ' + (st.error || '')], off: ['', 'Inactivo'] };
    var l = labels[st.state] || labels.off;
    body.innerHTML = '<div class="sync-status"><span class="live-dot ' + l[0] + '"></span><b>' + esc(l[1]) + '</b>' +
      (st.at ? '<span class="muted">· última vez ' + fmtTime(st.at) + '</span>' : '') + '</div>' +
      '<p class="hint" style="margin-top:0">Cuenta: ' + esc(cfg.session.user.email) + '. Los cambios se suben solos unos segundos después de guardarlos; sin conexión quedan pendientes.</p>' +
      '<div class="btn-row"><button type="button" class="primary" data-action="sync-now">Sincronizar ahora</button><button type="button" data-action="sync-signout">Cerrar sesión en este dispositivo</button></div>';
  }

  async function onSyncForm(e) {
    var f = e.target.closest('[data-sync-form]'); if (!f) return;
    e.preventDefault();
    var kind = f.dataset.syncForm, btn = e.submitter;
    var busy = function (on) { $$('button', f).forEach(function (b) { b.disabled = on; }); };
    busy(true);
    try {
      if (kind === 'config') {
        var url = f.url.value.trim();
        if (!/^https:\/\/.+/.test(url)) throw new Error('La URL debe empezar por https://');
        Sync.configure(url, f.key.value);
      } else if (kind === 'auth') {
        if (btn && btn.value === 'signup') {
          var r = await Sync.signUp(f.email.value.trim(), f.password.value);
          if (!r.session) { toast('Cuenta creada. Confirma el correo que te envió Supabase y luego inicia sesión.'); busy(false); return; }
        } else {
          var wasOn = Sync.config().enabled;
          await Sync.signIn(f.email.value.trim(), f.password.value);
          if (wasOn && Sync.config().enabled) toast('Sesión iniciada: sincronizando…');
        }
        syncStep = null;
      } else if (kind === 'newpass') {
        if (f.pass.value !== f.pass2.value) throw new Error('Las contraseñas no coinciden');
        await Sync.updatePassword(f.pass.value);
        recoveryMode = false; syncStep = null;
        toast('Contraseña de la cuenta actualizada');
      } else if (kind === 'enable') {
        if (f.pass2 && f.pass.value !== f.pass2.value) throw new Error('Las contraseñas de cifrado no coinciden');
        var mode = f.querySelector('input[name="mode"]:checked');
        toast('Cifrando y sincronizando…');
        await safetyBackup('antes de conectar con la nube');
        await Sync.enable(f.pass.value, mode ? mode.value : 'merge');
        toast('¡Sincronización activada en este dispositivo!');
        syncStep = null;
      }
    } catch (err) { toast(err.message); }
    busy(false);
    renderSyncCard();
  }

  // ================================================================ copias y versiones
  var cloudVersions = null;   // lista cargada al pulsar «Ver versiones en la nube»

  function countsText(c) {
    if (!c) return '';
    return [c.accounts + ' cuentas', c.transactions + ' movimientos', c.investments + ' inversiones',
      (c.debts || 0) + (c.exchanges || 0) ? (c.debts || 0) + ' por cobrar/pagar · ' + (c.exchanges || 0) + ' cambios' : ''].filter(Boolean).join(' · ');
  }
  function fmtStamp(ms) {
    return new Date(ms).toLocaleString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderVersionsCard() {
    var box = $('#local-versions'); if (!box || !window.Backups) return;
    Backups.list().then(function (list) {
      box.innerHTML = list.length ? list.map(function (v) {
        return '<li class="version-row"><span class="avatar">' + icon('i-refresh') + '</span><div class="main"><div class="title">' + esc(fmtStamp(v.at)) +
          ' <span class="tag">' + esc(v.reason) + '</span></div><div class="sub">' + esc(countsText(v.counts)) + '</div></div>' +
          '<button type="button" data-restore-local="' + v.id + '">Restaurar</button></li>';
      }).join('') : '<li class="empty">Todavía no hay copias: se creará una automáticamente.</li>';
    }).catch(function () { box.innerHTML = '<li class="empty">Este navegador no permite guardar copias (¿modo incógnito?).</li>'; });

    var cb = $('#cloud-versions-box'), cfg = Sync.config();
    if (!cfg.enabled) { cb.innerHTML = '<h3>En la nube</h3><p class="hint">Activa la sincronización para guardar versiones cifradas en la nube.</p>'; return; }
    var html = '<h3>En la nube (cifradas)</h3>';
    if (cloudVersions === null) {
      html += '<div class="btn-row"><button type="button" data-action="cloud-versions">Ver versiones en la nube</button>' +
        '<button type="button" data-action="cloud-version-now">Guardar versión en la nube ahora</button></div>';
    } else if (cloudVersions.missing) {
      html += '<div class="warning">Falta crear la tabla de versiones en Supabase: abre <b>SQL Editor</b>, pega el contenido de ' +
        '<b>supabase/versions.sql</b> y pulsa <b>Run</b>. Luego vuelve a intentarlo.</div><button type="button" data-action="cloud-versions">Reintentar</button>';
    } else {
      html += '<ul class="list">' + (cloudVersions.length ? cloudVersions.map(function (v) {
        return '<li class="version-row"><span class="avatar tr">' + icon('i-wallet') + '</span><div class="main"><div class="title">' + esc(fmtStamp(v.at)) +
          ' <span class="tag">' + esc(v.reason || '') + '</span></div></div><button type="button" data-restore-cloud="' + v.id + '">Restaurar</button></li>';
      }).join('') : '<li class="empty">Aún no hay versiones: se guarda una automáticamente cada 6 h al sincronizar.</li>') + '</ul>' +
        '<div class="btn-row"><button type="button" data-action="cloud-version-now">Guardar versión en la nube ahora</button></div>' +
        '<p class="hint">Se conservan las 20 más recientes y una por día del último mes.</p>';
    }
    cb.innerHTML = html;
  }

  async function restoreFrom(kind, id) {
    try {
      var data = kind === 'local' ? await Backups.get(id) : await Sync.getCloudVersion(id);
      if (!data) { toast('Esa copia ya no existe'); return; }
      var c = Backups.summarize(data);
      if (!confirm('¿Volver a esta versión?\n\n' + countsText(c) + '\n\nAntes se guarda una copia de cómo está todo ahora, por si quieres deshacerlo.')) return;
      await replaceState(data, 'restaurar una versión', 'Versión restaurada');
    } catch (e) { toast(e.message); }
  }

  // ================================================================ Sprint 1: borrar con «Deshacer»
  /** Borra un movimiento ('tx') u operación ('inv') y ofrece deshacer durante 6 s (sin ventana de confirmación). */
  function deleteWithUndo(kind, id) {
    var key = kind === 'tx' ? 'transactions' : 'investments';
    var idx = -1;
    state[key].forEach(function (x, i) { if (x.id === id) idx = i; });
    if (idx < 0) return;
    var item = state[key][idx];
    if (kind === 'inv') {
      var remaining = state.investments.filter(function (i) { return i.id !== id; });
      if (C.buildPositions(remaining, rates()).errors.length) { toast('No se puede: dejaría una venta sin compra previa'); return; }
    }
    invalidateSnapshots(item.date);
    state[key].splice(idx, 1);
    if (kind === 'tx' && $('#tx-form').editId.value === id) resetTxForm();
    if (kind === 'inv' && $('#inv-form').editId.value === id) resetInvForm();
    persist();
    toastAction(kind === 'tx' ? 'Movimiento eliminado' : 'Operación eliminada', 'Deshacer', function () {
      if (byId(state[key], id)) return;
      state[key].splice(Math.min(idx, state[key].length), 0, item);
      invalidateSnapshots(item.date);
      persist();
      toast('Restaurado');
    });
  }

  // ================================================================ Sprint 1: registro rápido («+»)
  var quick = { type: 'egreso', accountId: null, categoryId: null };

  function quickAccounts() {
    var ids = C.rankByUse(state.accounts.map(function (a) { return a.id; }), state.transactions, 'accountId', S.today());
    return ids.map(account);
  }
  function quickCategories(type) {
    var cats = state.categories.filter(function (c) { return c.type === type; });
    var ids = C.rankByUse(cats.map(function (c) { return c.id; }), state.transactions.filter(function (t) { return t.type === type; }), 'categoryId', S.today());
    return ids.map(function (id) { return byId(state.categories, id); });
  }
  function chip(attr, value, label, sub, on) {
    return '<button type="button" class="chip-opt" role="radio" ' + attr + '="' + esc(value) + '" aria-checked="' + (on ? 'true' : 'false') + '">' +
      esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>';
  }
  function renderQuick() {
    var f = $('#quick-sheet');
    var accs = quickAccounts(), cats = quickCategories(quick.type);
    if (!account(quick.accountId)) quick.accountId = (account(state.settings.last.accountId) || accs[0] || {}).id || null;
    if (!byId(cats, quick.categoryId)) {
      var lastCat = state.settings.last['cat_' + quick.type];
      quick.categoryId = (byId(cats, lastCat) || cats[0] || {}).id || null;
    }
    $('#q-accounts').innerHTML = accs.length ? accs.map(function (a) { return chip('data-q-acc', a.id, a.name, a.currency, a.id === quick.accountId); }).join('')
      : '<span class="muted small">Primero crea una cuenta en Cuentas.</span>';
    $('#q-cats').innerHTML = cats.map(function (c) { return chip('data-q-cat', c.id, c.name, '', c.id === quick.categoryId); }).join('');
    var acc = account(quick.accountId);
    $('#q-cur').textContent = acc ? acc.currency : '';
    $('#q-save').textContent = quick.type === 'ingreso' ? 'Guardar ingreso' : 'Guardar gasto';
    fillSelect(f.methodId, [{ value: '', label: '—' }].concat(state.methods.map(function (m) { return { value: m.id, label: m.name }; })), f.methodId.value || state.settings.last.methodId || '');
  }
  /** Abre la hoja. Se llama dentro del toque del usuario para que el móvil abra el teclado numérico. */
  function openQuick() {
    var f = $('#quick-sheet');
    f.reset();
    $('#q-heard').classList.add('hidden');
    $('#q-mic').classList.toggle('hidden', !Voice.supported());
    quick.type = 'egreso'; quick.accountId = null; quick.categoryId = null;
    f.date.value = S.today();
    $('#quick-sheet').classList.remove('hidden');
    $('#quick-backdrop').classList.remove('hidden');
    document.body.classList.add('sheet-open');
    renderQuick();
    f.amount.focus();
  }
  function closeQuick() {
    if (stopListening) stopListening();
    $('#quick-sheet').classList.add('hidden');
    $('#quick-backdrop').classList.add('hidden');
    document.body.classList.remove('sheet-open');
    if (document.activeElement) document.activeElement.blur();
  }
  /** Interpreta el monto escrito: acepta coma o punto decimal y sumas («12,50+3»). */
  function parseAmount(txt) { return C.parseAmount(txt); }
  /** Número escrito con coma o punto («1,5», «95,5», «1.234,56»); NaN si no es válido. */
  function num(txt) { return C.parseNum(txt); }

  // ---- Registro por voz o frase: «gasté 25 dólares en comida con la tarjeta»
  var stopListening = null;
  function voiceContext() {
    var methodIds = C.rankByUse(state.methods.map(function (m) { return m.id; }), state.transactions, 'methodId', S.today());
    return {
      today: S.today(), currencies: currencies(),
      defaultAccountId: (account(state.settings.last.accountId) || quickAccounts()[0] || {}).id || null,
      accounts: quickAccounts(), categories: state.categories,
      methods: methodIds.map(function (id) { return byId(state.methods, id); })
    };
  }
  /** Rellena la hoja con lo que se entendió; el usuario revisa y pulsa Guardar. */
  function applySay(text) {
    text = String(text || '').trim();
    if (!text) return;
    var f = $('#quick-sheet'), r = Voice.parse(text, voiceContext());
    quick.type = r.type;
    f.querySelector('input[name="qtype"][value="' + r.type + '"]').checked = true;
    if (r.accountId) quick.accountId = r.accountId;
    if (r.categoryId) quick.categoryId = r.categoryId; else quick.categoryId = null;
    if (r.amount != null) f.amount.value = String(r.amount).replace('.', ',');
    if (r.methodId) f.methodId.value = r.methodId;
    f.date.value = r.date;
    if (r.note) f.note.value = r.note;
    renderQuick();
    if (r.methodId) f.methodId.value = r.methodId;
    if (r.date !== S.today() || r.note) f.querySelector('.q-more').open = true;
    var acc = account(quick.accountId), parts = [r.type === 'ingreso' ? 'Ingreso' : 'Gasto'];
    if (r.amount != null && acc) parts.push(fmtMoney(r.amount, acc.currency));
    if (r.categoryId) parts.push(catName(r.categoryId));
    if (r.methodId) parts.push(methodName(r.methodId));
    if (acc) parts.push('cuenta ' + acc.name);
    if (r.date !== S.today()) parts.push(fmtDate(r.date));
    var miss = r.missing.filter(function (m) { return m.indexOf('cuenta en') !== 0; });
    var noAcc = r.missing.filter(function (m) { return m.indexOf('cuenta en') === 0; })[0];
    $('#q-heard').innerHTML = 'Entendí: <b>' + esc(parts.join(' · ')) + '</b>' +
      (miss.length ? '<br><span class="miss">Falta: ' + esc(miss.join(' y ')) + ' — elígelo abajo.</span>' : '<br>Revisa y pulsa Guardar.') +
      (noAcc ? '<br><span class="miss">No tienes una ' + esc(noAcc) + ': se usará ' + esc(acc ? acc.name : '') + '.</span>' : '');
    $('#q-heard').classList.remove('hidden');
    if (r.amount == null) f.amount.focus();
  }
  function quickVoice() {
    var btn = $('#q-mic'), f = $('#quick-sheet');
    if (stopListening) { stopListening(); return; }
    if (!Voice.supported()) { toast('Este navegador no permite dictar: escribe la frase y pulsa Enter'); f.say.focus(); return; }
    btn.classList.add('listening');
    $('#q-heard').innerHTML = 'Escuchando… di por ejemplo «gasté 25 dólares en comida con la tarjeta»';
    $('#q-heard').classList.remove('hidden');
    var last = '';
    stopListening = Voice.listen(function (txt, fin) {
      last = txt; f.say.value = txt;
      if (fin) applySay(txt);
    }, function (err) {
      stopListening = null; btn.classList.remove('listening');
      if (err === 'not-allowed' || err === 'service-not-allowed') toast('Permite el micrófono para dictar (icono del candado en la barra de direcciones)');
      else if (err && err !== 'aborted' && err !== 'no-speech') toast('No se pudo usar el micrófono (' + err + ')');
      else if (!last) { $('#q-heard').innerHTML = 'No te escuché. Vuelve a tocar el micrófono o escribe la frase.'; }
    });
  }
  function onQuickSubmit(e) {
    e.preventDefault();
    var f = e.target;
    var amount = C.round(parseAmount(f.amount.value), 2);
    var acc = account(quick.accountId);
    if (!(amount > 0)) { toast('Escribe el monto'); f.amount.focus(); return; }
    if (!acc) { toast('Elige una cuenta'); return; }
    if (!quick.categoryId) { toast('Elige una categoría'); return; }
    var data = { id: S.uid(), createdAt: Date.now(), type: quick.type, date: f.date.value || S.today(), amount: amount, currency: acc.currency,
      accountId: acc.id, categoryId: quick.categoryId, methodId: f.methodId.value, note: f.note.value.trim() };
    invalidateSnapshots(data.date);
    state.transactions.push(data);
    var last = state.settings.last;
    last.accountId = acc.id; last.methodId = data.methodId; last['cat_' + data.type] = data.categoryId;
    closeQuick();
    persist();
    toastAction((data.type === 'ingreso' ? 'Ingreso' : 'Gasto') + ' guardado: ' + fmtMoney(data.amount, data.currency) + ' · ' + catName(data.categoryId), 'Deshacer',
      function () { state.transactions = state.transactions.filter(function (t) { return t.id !== data.id; }); persist(); toast('Registro deshecho'); });
  }

  // ================================================================ Sprint 1: modo privado
  function applyPrivacy() {
    document.body.classList.toggle('privacy', privacy);
    var b = $('#privacy-btn');
    b.setAttribute('aria-pressed', privacy ? 'true' : 'false');
    b.title = privacy ? 'Mostrar montos' : 'Ocultar montos';
    b.setAttribute('aria-label', b.title);
    b.querySelector('use').setAttribute('href', privacy ? '#i-eye-off' : '#i-eye');
  }
  function togglePrivacy() {
    privacy = !privacy;
    setUiPref('privacy', privacy);
    applyPrivacy();
    renderAll();
    if (asset) { renderAssetHeader(); renderAssetChart(); renderAssetPosition(); }
    toast(privacy ? 'Montos ocultos' : 'Montos visibles');
  }

  // ================================================================ Sprint 1: gestos táctiles
  var gesture = null, suppressClickUntil = 0;
  function bindGestures() {
    var ptr = $('#ptr');
    document.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1 || document.body.classList.contains('sheet-open')) { gesture = null; return; }
      var t = e.touches[0];
      var row = e.target.closest('.list li[data-edit-tx], .list li[data-edit-inv]');
      var atTop = window.scrollY <= 0 && !e.target.closest('.chart-svg, .search-results, dialog');
      gesture = { x: t.clientX, y: t.clientY, dx: 0, dy: 0, row: row, atTop: atTop, axis: null };
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!gesture) return;
      var t = e.touches[0];
      gesture.dx = t.clientX - gesture.x; gesture.dy = t.clientY - gesture.y;
      if (!gesture.axis && (Math.abs(gesture.dx) > 10 || Math.abs(gesture.dy) > 10)) gesture.axis = Math.abs(gesture.dx) > Math.abs(gesture.dy) ? 'h' : 'v';
      if (gesture.axis === 'h' && gesture.row) {
        var dx = Math.max(-140, Math.min(140, gesture.dx));
        var r = gesture.row;
        r.classList.add('swiping'); r.classList.remove('swipe-back');
        r.style.transform = 'translateX(' + dx + 'px)';
        r.classList.toggle('swipe-delete', dx < -20);
        r.classList.toggle('swipe-edit', dx > 20);
      } else if (gesture.axis === 'v' && gesture.atTop && gesture.dy > 0) {
        var pull = Math.min(gesture.dy, 140);
        ptr.style.opacity = Math.min(1, pull / 80);
        ptr.style.transform = 'translate(-50%, ' + (pull / 2 - 40) + 'px)';
        var ready = C.pullIntent(gesture.dy, gesture.dx, true);
        ptr.classList.toggle('ready', ready);
        $('#ptr-text').textContent = ready ? 'Suelta para actualizar' : 'Arrastra para actualizar';
      }
    }, { passive: true });

    document.addEventListener('touchend', function () {
      var g = gesture; gesture = null;
      if (!g) return;
      if (g.row) {
        var r = g.row;
        r.classList.remove('swiping', 'swipe-delete', 'swipe-edit');
        r.classList.add('swipe-back');
        r.style.transform = '';
        var intent = g.axis === 'h' ? C.swipeIntent(g.dx, g.dy) : null;
        if (g.axis === 'h') suppressClickUntil = Date.now() + 400; // que el deslizamiento no cuente como toque
        if (intent === 'delete') deleteWithUndo(r.dataset.editTx ? 'tx' : 'inv', r.dataset.editTx || r.dataset.editInv);
        else if (intent === 'edit') { if (r.dataset.editTx) editTx(r.dataset.editTx); else editInv(r.dataset.editInv); }
      }
      if (g.axis === 'v' && g.atTop && C.pullIntent(g.dy, g.dx, true)) pullRefresh();
      else { ptr.style.opacity = 0; ptr.style.transform = ''; ptr.classList.remove('ready'); }
    }, { passive: true });

    // Un clic justo después de deslizar no debe abrir la fila
    document.addEventListener('click', function (e) {
      if (Date.now() < suppressClickUntil && e.target.closest('.list li')) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }
  function pullRefresh() {
    var ptr = $('#ptr');
    ptr.classList.add('loading'); ptr.classList.remove('ready');
    $('#ptr-text').textContent = 'Actualizando…';
    var jobs = [refreshPrices(false)];
    if (Sync.config().enabled) jobs.push(Sync.syncNow());
    Promise.all(jobs).catch(function () { /* los errores ya se muestran en su sitio */ }).then(function () {
      ptr.classList.remove('loading');
      ptr.style.opacity = 0; ptr.style.transform = '';
      toast('Actualizado');
    });
  }

  // ================================================================ render
  function renderAll() {
    renderSelects();
    renderHome();
    renderTxList();
    renderAccounts();
    renderPortfolio();
    renderSettings();
    renderSyncStatus();
    syncTxForm();
    updateInvPreview();
    renderAnalysis();
    renderAdvice();
    renderBackupReminder();
    renderThirdParty();
    renderAccountView();
    renderSyncCard();
    if ($('#view-ajustes').classList.contains('active')) renderVersionsCard();
  }

  // ================================================================ eventos
  function bind() {
    $('#tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-view]'); if (b) showView(b.dataset.view);
    });
    window.addEventListener('hashchange', function () { showView(location.hash.slice(1)); });

    // Clientes: buscador, ficha y sugerencias al escribir el nombre
    $('#ppl-search').addEventListener('input', renderClients);
    $('#contact-form').addEventListener('submit', onContactSubmit);
    document.addEventListener('focusin', function (e) { if (e.target.matches && e.target.matches('input[data-people]')) showSuggest(e.target); });
    document.addEventListener('input', function (e) { if (e.target.matches && e.target.matches('input[data-people]')) { sug.sel = -1; showSuggest(e.target); } });
    document.addEventListener('focusout', function (e) { if (e.target === sug.input) setTimeout(function () { if (document.activeElement !== sug.input) hideSuggest(); }, 150); });
    document.addEventListener('keydown', function (e) {
      if (!sug.input || e.target !== sug.input) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sug.sel = (sug.sel + (e.key === 'ArrowDown' ? 1 : -1) + sug.items.length) % sug.items.length; showSuggest(sug.input); }
      else if (e.key === 'Enter' && sug.sel >= 0) { e.preventDefault(); chooseSuggest(sug.sel); }
      else if (e.key === 'Escape') hideSuggest();
    });
    // pointerdown (antes de que el campo pierda el foco) para elegir una sugerencia
    document.addEventListener('pointerdown', function (e) {
      var li = e.target.closest && e.target.closest('.people-suggest li');
      if (li) { e.preventDefault(); chooseSuggest(Number(li.dataset.sug)); }
    });

    var sf = $('#sale-form');
    sf.addEventListener('submit', onSaleSubmit);
    sf.addEventListener('input', syncSaleForm);
    sf.addEventListener('change', function (e) { if (e.target.name === 'currency') renderSaleAccounts(); syncSaleForm(); });
    $('#sale-month').addEventListener('change', renderSales);
    var lf = $('#loan-form');
    lf.addEventListener('submit', onLoanSubmit);
    lf.addEventListener('input', syncLoanForm);
    lf.addEventListener('change', function (e) { if (e.target.name === 'currency') renderLoanAccounts(); syncLoanForm(); });
    $$('input[name="loan-filter"]').forEach(function (r) { r.addEventListener('change', renderLoans); });

    var tf = $('#tx-form');
    tf.addEventListener('submit', onTxSubmit);
    $$('input[name="type"]', tf).forEach(function (r) { r.addEventListener('change', function () { renderCategorySelect(); syncTxForm(); }); });
    tf.addEventListener('input', syncTxForm);
    tf.addEventListener('change', syncTxForm);

    var inf = $('#inv-form');
    inf.addEventListener('submit', onInvSubmit);
    inf.currency.addEventListener('change', renderInvAccountSelect);
    inf.accountId.addEventListener('change', renderInvAccountSelect);
    $$('input[name="side"]', inf).forEach(function (r) { r.addEventListener('change', renderInvAccountSelect); });
    inf.addEventListener('input', updateInvPreview);
    inf.addEventListener('change', updateInvPreview);

    $('#acc-form').addEventListener('submit', onAccSubmit);
    $('#profile-form').addEventListener('submit', onProfileSubmit);
    var qs = $('#quick-sheet');
    qs.addEventListener('submit', onQuickSubmit);
    $('#quick-backdrop').addEventListener('click', closeQuick);   // tocar fuera de la hoja la cierra
    $$('input[name="qtype"]', qs).forEach(function (r) { r.addEventListener('change', function () { quick.type = r.value; quick.categoryId = null; renderQuick(); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('sheet-open')) closeQuick(); });
    // Frase escrita en el «+»: Enter la interpreta (no guarda todavía)
    $('#quick-sheet').say.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); applySay(e.target.value); }
    });
    $('#privacy-on-open').checked = !!uiPrefs().privacyOnOpen;
    $('#privacy-on-open').addEventListener('change', function (e) { setUiPref('privacyOnOpen', e.target.checked); });
    bindMix();
    bindLook();
    bindReceipts();
    bindGestures();
    $('#sync-card').addEventListener('submit', onSyncForm);
    $('#debt-form').addEventListener('submit', onDebtSubmit);
    $('#debt-form').currency.addEventListener('change', renderDebtAccountSelect);
    $('#pay-form').addEventListener('submit', onPaySubmit);
    $$('input[name="debt-filter"]').forEach(function (r) { r.addEventListener('change', renderDebts); });
    $('#debt-search').addEventListener('input', renderDebts);
    var fxf = $('#fx-form');
    fxf.addEventListener('submit', onFxSubmit);
    fxf.addEventListener('input', function (e) { syncFxForm(e.target.name); });
    fxf.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.c === 'currency') { var row = t.closest('.cost-row'); fillSelect(row.querySelector('[data-c="accountId"]'), accountsFor(t.value, 'Ninguna'), ''); }
      syncFxForm(t.name);
    });
    $('#fx-month').addEventListener('change', renderExchanges);

    ['#f-month', '#f-type', '#f-account'].forEach(function (s) { $(s).addEventListener('change', renderTxList); });

    $('#base-select').addEventListener('change', function (e) { changeBase(e.target.value); });
    $('#auto-fx').addEventListener('change', function (e) {
      state.settings.autoFx = e.target.checked; persist();
      if (e.target.checked) refreshPrices(true);
    });

    $('#add-currency').addEventListener('submit', async function (e) {
      e.preventDefault();
      var f = e.target;
      var code = f.code.value.trim().toUpperCase().split(/\s|·/)[0], r = num(f.rate.value);
      if (!/^[A-Z0-9]{2,10}$/.test(code)) { toast('Código inválido'); return; }
      if (rates()[code]) { toast(code + ' ya existe'); return; }
      if (C.PEGGED[code]) {
        // USDT y USDC: siempre 1 USD
        if (!(C.rateOf(rates(), C.PEGGED[code]) > 0)) await P.refreshRates(state.settings, [C.PEGGED[code]]).catch(function () {});
        r = C.rateOf(rates(), C.PEGGED[code]);
        if (!(r > 0)) { toast('Primero necesito la tasa del USD; revisa tu conexión.'); return; }
        rates()[code] = r; f.reset(); persist(); toast(code + ' añadida: 1 ' + code + ' = 1 ' + C.PEGGED[code]);
        return;
      }
      if (r > 0) {
        rates()[code] = r; state.settings.rateLocks[code] = true; // tasa escrita a mano: queda fija
        f.reset(); persist(); toast(code + ' añadida con tasa manual');
        return;
      }
      // Sin tasa: conectarla a las tasas automáticas (en vivo si Binance tiene par)
      toast('Buscando la tasa de ' + code + '…');
      try { await P.refreshRates(state.settings, [code]); } catch (err) { /* sin conexión */ }
      if (!(rates()[code] > 0)) { toast('No encontré la tasa de ' + code + '. Escríbela a mano.'); f.rate.focus(); return; }
      var src = (state.settings.rateSources || {})[code] || {};
      f.reset(); persist();
      toast(code + ' añadida · ' + (src.live ? 'en vivo (Binance)' : 'tasa diaria') + ': 1 ' + code + ' = ' + fmtNum(rates()[code], 0, 6) + ' ' + base());
    });

    $('#finnhub-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var key = e.target.key.value.trim();
      state.settings.finnhubKey = key;
      e.target.reset(); persist();
      if (!key) { toast('Key eliminada'); return; }
      toast('Probando la key…');
      var r = await P.fetchStocks(['AAPL'], key);
      toast(r.AAPL && !r.AAPL.error ? 'Key válida ✓ (AAPL ' + fmtPrice(r.AAPL.price, 'USD') + ')' : 'La key no funcionó: ' + r.AAPL.error);
      refreshPrices(false);
    });

    $$('[data-add-cat]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = form.label.value.trim(), type = form.dataset.addCat;
        if (!name) return;
        if (state.categories.some(function (c) { return c.type === type && c.name.toLowerCase() === name.toLowerCase(); })) { toast('Ya existe'); return; }
        state.categories.push({ id: S.uid(), name: name, type: type });
        form.reset(); persist();
      });
    });

    $('#add-method').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = e.target.label.value.trim(); if (!name) return;
      state.methods.push({ id: S.uid(), name: name }); e.target.reset(); persist();
    });

    $('#restore').addEventListener('change', function (e) {
      if (e.target.files[0]) restoreBackup(e.target.files[0]);
      e.target.value = '';
    });

    // Se maneja el envío (no el evento «close», que no todos los navegadores emiten igual)
    $('#price-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var dlg = $('#price-dialog'), f = e.target;
      if (!e.submitter || e.submitter.value !== 'ok') { dlg.close(); return; }
      var p = num(f.price.value);
      if (!(p > 0)) { toast('Ingresa un precio mayor a 0'); f.price.focus(); return; }
      state.prices[f.dataset.key] = { price: C.round(p, 8), currency: f.dataset.cur, change24h: null, time: Date.now(), source: 'manual', error: null };
      dlg.close();
      persist(); toast('Precio guardado');
    });

    // Inputs editables de Ajustes
    document.addEventListener('change', function (e) {
      var el = e.target, d = el.dataset;
      if (d.rate) {
        var r = num(el.value);
        if (!(r > 0)) { toast('Tasa inválida'); el.value = rates()[d.rate]; return; }
        rates()[d.rate] = r; state.settings.rateLocks[d.rate] = true;
        persist(); toast('Tasa de ' + d.rate + ' fijada a mano');
      } else if (d.renameCat || d.renameMethod) {
        var item = byId(d.renameCat ? state.categories : state.methods, d.renameCat || d.renameMethod);
        var name = el.value.trim();
        if (!name) { el.value = item.name; return; }
        item.name = name; persist(); toast('Renombrado');
      }
    });

    // Filas editables (clic o Enter)
    function openRow(e) {
      var oa = e.target.closest('[data-open-account]');
      if (oa) { openAccount(oa.dataset.openAccount); return true; }
      var od = e.target.closest('[data-open-debt]');
      if (od) { editDebt(od.dataset.openDebt); return true; }
      var pk = e.target.closest('[data-person]');
      if (pk) { openPerson(pk.dataset.person); return true; }
      var hi = e.target.closest('[data-hist]');
      if (hi) { var hp = hi.dataset.hist.split('|'); openHistItem(hp[0], hp[1]); return true; }
      var pref = e.target.closest('[data-pay-ref]');
      if (pref) { var pr = pref.dataset.payRef.split('|'); openRef(pr[0], pr[1], { stay: accTab === 'cobrar' || accTab === 'pagar' }); return true; }
      var esv = e.target.closest('[data-edit-sale]');
      if (esv) { editSale(esv.dataset.editSale); return true; }
      var sfx = e.target.closest('[data-settle-fx]');
      if (sfx) { openFxSettle(sfx.dataset.settleFx); return true; }
      var ofx = e.target.closest('[data-open-fx]');
      if (ofx) { editFx(ofx.dataset.openFx); return true; }
      var ao = e.target.closest('[data-open-asset]');
      if (ao) { var parts = ao.dataset.openAsset.split('|'); $('#asset-search').value = ''; openAsset(parts[0], parts[1]); return true; }
      var row = e.target.closest('li[data-edit-tx], li[data-edit-inv]');
      if (!row) return false;
      if (row.dataset.editTx) editTx(row.dataset.editTx); else editInv(row.dataset.editInv);
      return true;
    }
    document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('li[data-edit-tx], li[data-edit-inv], [data-open-asset], li[data-open-debt], li[data-open-fx], li[data-settle-fx], li[data-pay-ref], li[data-edit-sale], li[data-person], li[data-hist], [data-open-account]')) openRow(e); });
    $$('input[name="ex-tab"]').forEach(function (r) { r.addEventListener('change', function () { explore.tab = r.value; renderExplore(); }); });
    $('#ex-fit').addEventListener('change', renderExplore);

    // Buscador de activos
    var si = $('#asset-search'), sTimer;
    si.addEventListener('focus', runSearch);
    si.addEventListener('input', function () { clearTimeout(sTimer); sTimer = setTimeout(runSearch, 120); });
    si.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchSel(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearchSel(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); openFromSearch(); }
      else if (e.key === 'Escape') { hideSearch(); si.blur(); }
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.search')) hideSearch(); });

    // La conexión en vivo se pausa con la app en segundo plano
    document.addEventListener('visibilitychange', function () {
      if (!asset) return;
      if (document.visibilityState === 'hidden') { if (asset.conn) asset.conn.close(); asset.conn = null; asset.status = 'offline'; }
      else if (!asset.conn) startLive();
    });

    // Clicks delegados
    document.addEventListener('click', function (e) {
      var el = e.target.closest('button');
      if (!el) { openRow(e); return; }
      var d = el.dataset;
      if (receiptClick(d)) return;
      if (d.action === 'debt-search-all') { $('#df-all').checked = true; renderDebts(); return; }
      if (d.goto) showView(d.goto);
      else if (d.action === 'open-search') { showView('inversiones'); setTimeout(function () { $('#asset-search').focus(); }, 0); }
      else if (d.action === 'asset-back') showView('inversiones');
      else if (d.openAccount) openAccount(d.openAccount);
      else if (d.action === 'account-back') showView('cuentas');
      else if (d.action === 'ac-buy') buyFromAccount();
      else if (d.action === 'ac-move') { var accId = currentAccountId; showView('movimientos'); var tfm = $('#tx-form'); tfm.accountId.value = accId; tfm.fromAccountId.value = accId; syncTxForm(); }
      else if (d.action === 'account-all-moves') { var aid = currentAccountId; $('#f-account').value = aid; $('#f-month').value = ''; $('#f-type').value = ''; showView('movimientos'); renderTxList(); }
      else if (d.accTab) showView('cuentas/' + d.accTab);
      else if (d.action === 'cancel-debt') { resetDebtForm(); renderDebts(); }
      else if (d.action === 'delete-debt') {
        var dd = byId(state.debts, $('#debt-form').editId.value);
        if (dd && confirm('¿Eliminar «' + (dd.concept || dd.person) + '» y sus abonos? Los saldos de las cuentas se recalculan.')) {
          invalidateSnapshots(dd.date);
          state.debts = state.debts.filter(function (x) { return x !== dd; });
          resetDebtForm(); persist(); toast('Eliminado');
        }
      } else if (d.delSettle) { deleteSettlement(d.delSettle); }
      else if (d.delRefPay) { deleteRefPay(d.delRefPay); }
      else if (d.action === 'sale-edit') { editSale(d.id); }
      else if (d.action === 'cancel-sale') { resetSaleForm(); renderSales(); }
      else if (d.action === 'delete-sale') {
        var sv = byId(state.sales, $('#sale-form').editId.value);
        if (sv && confirm('¿Eliminar esta venta' + ((sv.payments || []).length ? ' y sus cobros' : '') + '? Los saldos se recalculan.')) {
          invalidateSnapshots(sv.date); state.sales = state.sales.filter(function (x) { return x !== sv; });
          payRef = null; resetSaleForm(); persist(); toast('Venta eliminada');
        }
      }
      else if (d.action === 'loan-edit') { editLoan(d.id); }
      else if (d.action === 'person-close') { personOpenKey = null; renderClients(); }
      else if (d.action === 'person-new') { personNew(d.kind); }
      else if (d.action === 'person-edit') { editContact(); }
      else if (d.action === 'cancel-contact') { resetContactForm(); }
      else if (d.action === 'delete-contact') {
        var pc = personByKey(personOpenKey);
        if (pc && pc.contact && confirm('¿Eliminar la ficha de «' + pc.name + '» (teléfono y nota)? Sus operaciones no se borran.')) {
          state.contacts = state.contacts.filter(function (x) { return C.personKey(x.name) !== pc.key; });
          resetContactForm(); persist(); toast('Ficha eliminada');
        }
      }
      else if (d.action === 'cancel-loan') { resetLoanForm(); renderLoans(); }
      else if (d.action === 'delete-loan') {
        var ln = byId(state.loans, $('#loan-form').editId.value);
        if (ln && confirm('¿Eliminar este préstamo' + ((ln.payments || []).length ? ' y sus pagos' : '') + '? Los saldos se recalculan.')) {
          invalidateSnapshots(ln.date); state.loans = state.loans.filter(function (x) { return x !== ln; });
          payRef = null; resetLoanForm(); persist(); toast('Préstamo eliminado');
        }
      }
      else if (d.action === 'fx-open-edit') { payFx = null; payRef = null; $('#debt-payments').classList.add('hidden'); editFx(d.id); }
      else if (d.action === 'fx-fix-settle-acc') {
        var fxx = byId(state.exchanges, d.id), fst = fxx && C.exchangeSettlement(fxx);
        if (fst) {
          var acc2 = fst.side === 'in' ? fxx.inAccountId : fxx.outAccountId;
          (fxx.settlements || []).forEach(function (z) { if (!(z.splits && z.splits.length) && z.accountId !== acc2) { invalidateSnapshots(z.date); z.accountId = acc2; } });
          persist(); editFx(fxx.id);
          toast((fst.side === 'in' ? 'Cobros movidos a ' : 'Entregas movidas a ') + accName(acc2));
        }
      }
      else if (d.action === 'fx-settle') { openFxSettle(d.id); }
      else if (d.delPay) {
        var dp = byId(state.debts, $('#debt-form').editId.value);
        if (dp && confirm('¿Eliminar este abono?')) {
          var pm = byId(dp.payments, d.delPay); if (pm) invalidateSnapshots(pm.date);
          dp.payments = dp.payments.filter(function (x) { return x.id !== d.delPay; });
          $('#pay-form').dataset.debt = ''; persist(); toast('Abono eliminado');
        }
      } else if (d.action === 'add-cost') { fxCostRow(); syncFxForm(); }
      else if (d.action === 'flip-rate') {
        var ff = $('#fx-form'), effR = effectiveRate();
        ff.dataset.rateInv = rateInv() ? '' : '1';
        showRate(effR); syncFxForm();
      } else if (d.action === 'fx-market-rate') { setMarketRate(); syncFxForm('rate'); delete $('#fx-form').dataset.rateTouched; syncFxForm(); }
      else if (d.action === 'fx-recalc') { delete $('#fx-form').dataset.deliveredTouched; syncFxForm(); }
      else if (d.action === 'del-cost') { el.closest('.cost-row').remove(); syncFxForm(); }
      else if (d.action === 'cancel-fx') { resetFxForm(); renderExchanges(); }
      else if (d.action === 'delete-fx') {
        var xx = byId(state.exchanges, $('#fx-form').editId.value);
        if (xx && confirm('¿Eliminar este cambio? Los saldos de las cuentas se recalculan.')) {
          invalidateSnapshots(xx.date);
          state.exchanges = state.exchanges.filter(function (y) { return y !== xx; });
          resetFxForm(); persist(); toast('Cambio eliminado');
        }
      }
      else if (d.action === 'csv-debts') exportDebtsCSV();
      else if (d.action === 'sync-now') Sync.syncNow();
      else if (d.action === 'quick-open') openQuick();
      else if (d.action === 'quick-close') closeQuick();
      else if (d.action === 'quick-voice') quickVoice();
      else if (d.action === 'year-csv') exportYearCSV();
      else if (d.action === 'explore-retry') loadExplore(true);
      else if (d.action === 'summary-dismiss') { state.settings.summarySeen = d.month; persist(); }
      else if (d.action === 'review-profile') { editingProfile = true; showView('consejos'); renderAdvice(); window.scrollTo(0, 0); }
      else if (d.qAcc) { quick.accountId = d.qAcc; renderQuick(); }
      else if (d.qCat) { quick.categoryId = d.qCat; renderQuick(); }
      else if (d.action === 'quick-transfer') {
        closeQuick(); showView('movimientos');
        var tfq = $('#tx-form'); tfq.type.value = 'transferencia'; renderCategorySelect(); syncTxForm();
        setTimeout(function () { tfq.amount.focus(); }, 0);
      } else if (d.action === 'quick-exchange') { closeQuick(); showView('cuentas/cambios'); setTimeout(function () { $('#fx-form').amount.focus(); }, 0); }
      else if (d.action === 'toggle-privacy') togglePrivacy();
      else if (d.action === 'backup-local-now') safetyBackup('manual').then(function () { renderVersionsCard(); toast('Copia guardada en este dispositivo'); });
      else if (d.restoreLocal) restoreFrom('local', d.restoreLocal);
      else if (d.restoreCloud) restoreFrom('cloud', d.restoreCloud);
      else if (d.action === 'cloud-versions') {
        Sync.listCloudVersions().then(function (l) { cloudVersions = l; renderVersionsCard(); })
          .catch(function (e) { if (e.missing) { cloudVersions = { missing: true }; renderVersionsCard(); } else toast(e.message); });
      } else if (d.action === 'cloud-version-now') {
        Sync.saveVersionNow('manual').then(function () { toast('Versión guardada en la nube'); return Sync.listCloudVersions(); })
          .then(function (l) { cloudVersions = l; renderVersionsCard(); })
          .catch(function (e) { if (e.missing) { cloudVersions = { missing: true }; renderVersionsCard(); } else toast(e.message); });
      } else if (d.action === 'sync-forgot') {
        var em = ($('#sync-body input[name="email"]') || {}).value;
        if (!em || em.indexOf('@') === -1) { toast('Escribe primero tu correo arriba'); return; }
        Sync.recover(em.trim()).then(function () { toast('Te enviamos un correo para elegir una contraseña nueva. Ábrelo en este dispositivo.'); })
          .catch(function (e) { toast(e.message); });
      }
      else if (d.action === 'sync-retry') { syncStep = null; renderSyncCard(); }
      else if (d.action === 'sync-reset-config') { Sync.configure('', ''); renderSyncCard(); }
      else if (d.action === 'sync-signout') {
        if (confirm('¿Cerrar sesión en este dispositivo? Tus datos locales se conservan; la sincronización se detiene hasta que vuelvas a entrar.')) {
          Sync.signOut().then(function () { syncStep = null; renderSyncCard(); toast('Sesión cerrada'); });
        }
      }
      else if (d.action === 'csv-fx') exportFxCSV();
      else if (d.assetRange) { asset.range = d.assetRange; renderAssetRanges(); loadAssetHistory(); }
      else if (d.assetOp) prefillOperation(d.assetOp);
      else if (d.action === 'delete-tx') { var txId = $('#tx-form').editId.value; if (txId) deleteWithUndo('tx', txId); }
      else if (d.action === 'delete-inv') { var invId = $('#inv-form').editId.value; if (invId) deleteWithUndo('inv', invId); } else if (d.editAcc) editAcc(d.editAcc);
      else if (d.accMoves) {
        $('#f-account').value = d.accMoves; $('#f-month').value = ''; $('#f-type').value = '';
        showView('movimientos'); renderTxList();
      } else if (d.manualPrice) openManualPrice(d.manualPrice, d.cur);
      else if (d.lock) {
        var locks = state.settings.rateLocks;
        if (locks[d.lock]) { delete locks[d.lock]; persist(); refreshPrices(true); }
        else { locks[d.lock] = true; persist(); }
      } else if (d.delCur) {
        delete rates()[d.delCur]; delete state.settings.rateLocks[d.delCur]; persist();
      } else if (d.delCat) {
        state.categories = state.categories.filter(function (c) { return c.id !== d.delCat; }); persist();
      } else if (d.delMethod) {
        state.methods = state.methods.filter(function (m) { return m.id !== d.delMethod; }); persist();
      } else if (d.action === 'cancel-tx') resetTxForm();
      else if (d.action === 'cancel-inv') resetInvForm();
      else if (d.action === 'cancel-acc') resetAccForm();
      else if (d.action === 'delete-acc') {
        var id = $('#acc-form').editId.value;
        if (accountInUse(id)) return;
        if (confirm('¿Eliminar la cuenta «' + accName(id) + '»?')) {
          state.accounts = state.accounts.filter(function (a) { return a.id !== id; });
          resetAccForm(); persist(); toast('Cuenta eliminada');
        }
      }
      else if (d.action === 'refresh') refreshPrices(true);
      else if (d.action === 'csv-tx') exportTxCSV();
      else if (d.action === 'csv-acc') exportAccCSV();
      else if (d.action === 'csv-inv') exportInvCSV();
      else if (d.action === 'backup') {
        state.settings.lastBackupAt = Date.now();
        S.download('finanzas_backup_' + S.today() + '.json', JSON.stringify(state, null, 2), 'application/json');
        persist(); toast('Copia descargada. Guárdala en un lugar seguro.');
      }
      else if (d.action === 'start-profile' || d.action === 'edit-profile') { editingProfile = true; showView('consejos'); renderAdvice(); }
      else if (d.action === 'cancel-profile') {
        if (state.profile) { editingProfile = false; renderAdvice(); } else showView('inicio');
      }
      else if (d.action === 'sample') { loadSample(); refreshPrices(false); }
      else if (d.action === 'reset') {
        if (confirm('¿Borrar TODOS los datos? Esta acción no se puede deshacer. Te recomendamos exportar una copia antes.')) {
          safetyBackup('antes de borrar todo').then(function () {
            S.clear(); state = S.defaults(); resetTxForm(); resetInvForm(); resetAccForm(); persist(); toast('Datos borrados');
          });
        }
      }
    });

    // Tooltip de gráficos y avisos (ratón y teclado; en táctil, al tocar)
    var tip = $('#tooltip');
    function showTip(el, x, y) {
      tip.textContent = el.dataset.tip;
      tip.classList.add('show');
      var w = tip.offsetWidth;
      tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px';
      tip.style.top = Math.max(8, y - tip.offsetHeight - 12) + 'px';
    }
    document.addEventListener('mousemove', function (e) {
      if (e.target.closest('.chart-svg')) return; // los gráficos manejan su propio tooltip
      var el = e.target.closest('[data-tip]');
      if (el) showTip(el, e.clientX, e.clientY); else tip.classList.remove('show');
    });
    document.addEventListener('touchstart', function (e) {
      if (e.target.closest('.chart-svg')) return;
      var el = e.target.closest('[data-tip]');
      if (!el) { tip.classList.remove('show'); return; }
      var r = el.getBoundingClientRect();
      showTip(el, r.left + r.width / 2, r.top);
      clearTimeout(showTip._t); showTip._t = setTimeout(function () { tip.classList.remove('show'); }, 2500);
    }, { passive: true });

    // Análisis: filtros y redimensionado
    ['#a-range', '#a-from', '#a-to', '#a-category', '#a-account', '#a-asset'].forEach(function (sel) { $(sel).addEventListener('change', renderAnalysis); });
    $$('input[name="cat-type"]').forEach(function (r) { r.addEventListener('change', renderAnalysis); });
    $('#a-clear').addEventListener('click', function () {
      $('#a-category').value = ''; $('#a-account').value = ''; $('#a-asset').value = ''; renderAnalysis();
    });
    var rz;
    window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(renderAnalysis, 150); });
    $('#year-sel').addEventListener('change', renderYearReport);
    var pz;
    ['#proj-start', '#proj-saving'].forEach(function (sel) { $(sel).addEventListener('input', function () { clearTimeout(pz); pz = setTimeout(renderProjection, 250); }); });

    // Actualización periódica de precios mientras la app está visible
    setInterval(function () {
      if (document.visibilityState === 'visible' && Date.now() - (state.settings.lastRefresh || 0) > REFRESH_MS) refreshPrices(false);
    }, 30 * 1000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && Date.now() - (state.settings.lastRefresh || 0) > REFRESH_MS) refreshPrices(false);
    });
  }

  /** USD, USDT y EUR siempre disponibles; USDT anclado al USD. */
  async function ensureCoreCurrencies() {
    var s = state.settings, r = s.rates, missing = [];
    Object.keys(C.PEGGED).forEach(function (c) { delete s.rateLocks[c]; }); // la paridad 1:1 no se fija a mano
    ['USD', 'EUR'].forEach(function (c) { if (!(Number(r[c]) > 0) && c !== s.baseCurrency) missing.push(c); });
    if (missing.length) { try { await P.refreshRates(s, missing); } catch (e) { /* sin conexión: se reintenta al abrir */ } }
    if (!(Number(r.USDT) > 0) && C.rateOf(r, 'USD') > 0) r.USDT = C.rateOf(r, 'USD');
    if (C.rateOf(r, 'USD') > 0) r.USDT = C.rateOf(r, 'USD');
    S.save(state);
    renderAll();
  }

  // ================================================================ init
  bind();
  $('#f-month').value = thisMonth();
  applyPrivacy();
  resetTxForm();
  resetInvForm();
  resetAccForm();
  resetDebtForm();
  resetFxForm();
  $('#fx-month').value = thisMonth();
  $('#sale-month').value = thisMonth();
  resetSaleForm();
  resetLoanForm();
  renderAll();
  if (!state.investments.length) $('#inv-details').open = true;
  var receiveMode = location.hash === '#recibir' && !!window.opener;   // abierta por la versión anterior para recibir datos
  var authLink = Sync.hasAuthRedirect();                                  // enlace del correo de Supabase
  showView(receiveMode ? 'inicio' : authLink ? 'ajustes' : (location.hash.slice(1) || 'inicio'));
  recordSnapshot();
  S.save(state); // guarda la migración si la hubo
  Sync.onStatus(function (st) { renderSyncDot(); if ($('#view-ajustes').classList.contains('active')) renderSyncCard(); });
  Sync.init({
    getState: function () { return state; },
    // Datos combinados de la nube: se adoptan sin marcarlos como cambios locales
    adoptState: function (s) { state = S.normalize(s); S.adopt(state); renderAll(); }
  });
  // El service worker se registra en index.html (antes de la app) para que se actualice aunque la app falle al arrancar
  ensureCoreCurrencies();
  if (Date.now() - (state.settings.lastRefresh || 0) > REFRESH_MS) refreshPrices(false);
  maybeAutoBackup();
  if (authLink) {
    Sync.handleAuthRedirect().then(function (r) {
      if (!r) return;
      if (r.type === 'error') toast('El enlace no es válido o caducó: ' + r.message);
      else if (r.type === 'recovery') { recoveryMode = true; toast('Elige tu contraseña nueva'); }
      else { syncStep = null; toast('Correo confirmado: sesión iniciada'); }
      showView('ajustes'); renderSyncCard();
    }).catch(function (e) { toast('No se pudo abrir la sesión: ' + e.message); });
  }

  // ================================================================ pasar datos desde la versión anterior
  // La versión anterior (abierta como archivo en el PC) no puede sincronizar. Con un botón abre la
  // versión publicada y le entrega sus datos por mensaje entre ventanas; aquí se piden confirmación
  // y se cargan como una restauración: se guardan y la sincronización los sube cifrados.
  var publicUrl = (window.APP_CONFIG || {}).publicUrl;
  if (location.protocol === 'file:' && publicUrl) {
    var lb = $('#legacy-banner');
    lb.classList.remove('hidden');
    lb.innerHTML = '<b>Esta es la versión anterior: no se sincroniza con el teléfono.</b>' +
      'Tus datos de aquí pueden pasar a la versión sincronizada con un clic. Después usa siempre la app sincronizada.' +
      '<div class="btn-row"><button type="button" class="primary" data-action="migrate-out">Pasar mis datos a la app sincronizada</button>' +
      '<a class="btn" href="' + esc(publicUrl) + '" target="_blank" rel="noopener">Abrir la app sincronizada</a></div>';
  }
  function migrateOut() {
    var target = new URL(publicUrl).origin;
    var w = window.open(publicUrl + '#recibir', '_blank');
    if (!w) { toast('El navegador bloqueó la ventana: permite ventanas emergentes para este archivo y vuelve a pulsar.'); return; }
    var payload = JSON.stringify(state);
    var onMsg = function (e) {
      if (e.source !== w || !e.data) return;
      if (e.data.type === 'mf-ready') w.postMessage({ type: 'mf-data', data: payload }, target);
      if (e.data.type === 'mf-done') { window.removeEventListener('message', onMsg); toast('¡Listo! Tus datos ya están en la app sincronizada.'); }
      if (e.data.type === 'mf-cancel') { window.removeEventListener('message', onMsg); toast('Paso de datos cancelado'); }
    };
    window.addEventListener('message', onMsg);
    toast('Abriendo la app sincronizada…');
  }
  document.addEventListener('click', function (e) { if (e.target.closest('[data-action="migrate-out"]')) migrateOut(); });

  if (receiveMode) {
    var opener = window.opener, handled = false;
    window.addEventListener('message', function (e) {
      // Solo se aceptan datos de la ventana que abrió esta (la versión anterior, archivo local) y una sola vez
      if (handled || e.source !== opener || !e.data || e.data.type !== 'mf-data') return;
      if (e.origin !== 'null' && e.origin !== location.origin) return;
      handled = true;
      var incoming;
      try { incoming = S.normalize(JSON.parse(e.data.data)); } catch (err) { toast('Los datos recibidos no son válidos'); return; }
      var n = function (k) { return (incoming[k] || []).length; };
      var pristine = Sync.isPristine(state);
      var ok = confirm('Recibí los datos de tu versión anterior:\n\n• ' + n('accounts') + ' cuentas\n• ' + n('transactions') + ' movimientos\n• ' +
        n('investments') + ' operaciones de inversión\n• ' + n('debts') + ' por cobrar/pagar\n• ' + n('exchanges') + ' cambios de divisas\n\n' +
        (pristine ? '¿Cargarlos en esta app? Se subirán cifrados a la nube y llegarán a tu teléfono.'
                  : 'Esta app ya tiene datos: se COMBINARÁN (no se borra nada). ¿Continuar?'));
      if (!ok) { opener.postMessage({ type: 'mf-cancel' }, '*'); return; }
      // Instalación vacía: se reemplaza (como «Restaurar copia»); con datos: se combinan registro por registro
      safetyBackup('antes de recibir datos de la versión anterior');
      state = pristine ? incoming : S.normalize(Sync.merge(state, incoming));
      resetTxForm(); resetInvForm(); resetAccForm();
      persist();
      opener.postMessage({ type: 'mf-done' }, '*');
      toast('Datos cargados. Subiendo a la nube…');
      Sync.syncNow();
    });
    opener.postMessage({ type: 'mf-ready' }, '*');
  }
})();
