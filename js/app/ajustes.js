/* =========================================================================
 * app/ajustes.js — Ajustes, exportar/importar datos y apariencia.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

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
