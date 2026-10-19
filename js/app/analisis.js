/* =========================================================================
 * app/analisis.js — Análisis, proyección de patrimonio y resumen anual.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

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
