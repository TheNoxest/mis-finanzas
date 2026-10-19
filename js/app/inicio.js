/* =========================================================================
 * app/inicio.js — Inicio y resumen mensual.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

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
