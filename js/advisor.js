/* =========================================================================
 * advisor.js — Perfil de inversor y recomendaciones (reglas fijas, sin IA).
 * Funciones puras: reciben el estado y devuelven datos. Cada recomendación
 * incluye una frase de "por qué" y los datos exactos con que se calculó.
 * No es asesoría financiera profesional.
 * ========================================================================= */
(function (root) {
  'use strict';

  var C = root.Calc;

  // ---------------------------------------------------------------- cuestionario
  /** Cada respuesta vale 1–4 puntos. Total 5–20. */
  var QUESTIONS = [
    { id: 'horizon', text: '¿Cuándo vas a necesitar la mayor parte del dinero que inviertes?',
      options: ['En menos de 2 años', 'En 2 a 5 años', 'En 5 a 10 años', 'En más de 10 años'] },
    { id: 'drop', text: 'Si tus inversiones cayeran un 20 % en un mes, ¿qué harías?',
      options: ['Vendería todo para no perder más', 'Vendería una parte', 'Mantendría y esperaría', 'Compraría más aprovechando la caída'] },
    { id: 'goal', text: '¿Qué buscas principalmente con tus inversiones?',
      options: ['Proteger lo que tengo', 'Crecer poco a poco con pocos sobresaltos', 'Crecer aunque haya altibajos', 'El máximo crecimiento posible'] },
    { id: 'experience', text: '¿Cuánta experiencia tienes invirtiendo?',
      options: ['Ninguna', 'Básica (fondos, plazo fijo)', 'Intermedia (acciones, ETF)', 'Avanzada (cripto, derivados)'] },
    { id: 'income', text: '¿Qué tan estables son tus ingresos?',
      options: ['Inestables', 'Algo variables', 'Estables', 'Muy estables y con varias fuentes'] }
  ];

  var GOALS = {
    emergencia: 'Fondo de emergencia', vivienda: 'Comprar vivienda', jubilacion: 'Jubilación',
    educacion: 'Educación', viaje: 'Viajes', libertad: 'Libertad financiera', deudas: 'Pagar deudas'
  };

  /**
   * Parámetros por perfil (transparentes y editables aquí).
   *  risk:       rango recomendado de inversiones de riesgo (acciones, ETF, cripto, otros) sobre el patrimonio
   *  cryptoMax:  máximo de cripto sobre el patrimonio
   *  assetMax:   peso máximo de un solo activo dentro del portafolio
   *  emergency:  meses de gastos que conviene tener en cuentas
   */
  var PROFILES = {
    conservador: { label: 'Conservador', risk: [10, 35], cryptoMax: 2, assetMax: 20, emergency: 9,
      desc: 'Priorizas no perder dinero. Aceptas menos rentabilidad a cambio de estabilidad.' },
    moderado: { label: 'Moderado', risk: [35, 65], cryptoMax: 5, assetMax: 25, emergency: 6,
      desc: 'Buscas crecer de forma equilibrada y toleras caídas moderadas.' },
    agresivo: { label: 'Agresivo', risk: [60, 90], cryptoMax: 10, assetMax: 35, emergency: 4,
      desc: 'Buscas el mayor crecimiento a largo plazo y toleras caídas fuertes.' }
  };

  /**
   * Puntaje → perfil. ≤ 10 conservador · 11–15 moderado · ≥ 16 agresivo.
   * Límite por horizonte: < 2 años → conservador; 2–5 años → como máximo moderado.
   */
  function scoreProfile(answers) {
    var score = 0;
    QUESTIONS.forEach(function (q) { score += Number(answers[q.id]) || 1; });
    var type = score <= 10 ? 'conservador' : score <= 15 ? 'moderado' : 'agresivo';
    var capped = null;
    var h = Number(answers.horizon) || 1;
    if (h === 1 && type !== 'conservador') { capped = type; type = 'conservador'; }
    else if (h === 2 && type === 'agresivo') { capped = type; type = 'moderado'; }
    return { score: score, type: type, cappedFrom: capped };
  }

  // ---------------------------------------------------------------- utilidades
  function lastCompleteMonths(today, n) {
    var cur = today.slice(0, 7) + '-01';
    var from = C.shiftMonths(cur, -n);
    return { from: from, to: C.addDays(cur, -1) };
  }

  /**
   * Gasto e ingreso mensual promedio de los últimos n meses completos con movimientos.
   * Si no hay meses completos con datos, usa el mes en curso (parcial).
   */
  function monthlyAverages(state, today, n) {
    var rates = state.settings.rates;
    var r = lastCompleteMonths(today, n);
    var months = C.monthlyCashflow(C.flowTransactions(state), rates, r).filter(function (m) { return m.income > 0 || m.expense > 0; });
    var partial = false;
    if (!months.length) {
      months = C.monthlyCashflow(C.flowTransactions(state), rates, { from: today.slice(0, 7) + '-01', to: today }).filter(function (m) { return m.income > 0 || m.expense > 0; });
      partial = months.length > 0;
    }
    if (!months.length) return null;
    var inc = C.sum(months.map(function (m) { return m.income; }));
    var exp = C.sum(months.map(function (m) { return m.expense; }));
    return {
      months: months.map(function (m) { return m.month; }), partial: partial,
      income: C.round(inc / months.length, 2), expense: C.round(exp / months.length, 2),
      totalIncome: inc, totalExpense: exp,
      savingsRate: inc > 0 ? C.round((inc - exp) / inc * 100, 2) : null
    };
  }

  var SEVERITY_ORDER = { alta: 0, media: 1, baja: 2, ok: 3 };

  // ---------------------------------------------------------------- motor
  /**
   * Genera recomendaciones.
   * profile: { type, emergencyMonths?, savingsGoal? }   today: 'YYYY-MM-DD'
   * fmt(v): formateador de dinero en moneda base; locale: formato de números (los inyecta la interfaz).
   * Devuelve [{ id, severity, area, title, why, data }]
   */
  function recommend(state, profile, today, fmt, locale) {
    var rates = state.settings.rates;
    var P = PROFILES[profile.type] || PROFILES.moderado;
    var targetMonths = Number(profile.emergencyMonths) || P.emergency;
    var savingsGoal = Number(profile.savingsGoal) || 20;
    var nf = function (v) { return C.round(v, 1).toLocaleString(locale || 'es', { maximumFractionDigits: 1 }); };
    var pct = function (v) { return nf(v) + ' %'; };
    var out = [];
    var add = function (r) { out.push(r); };

    var nw = C.netWorth(state, today);
    var pf = nw.portfolio;
    var avg = monthlyAverages(state, today, 3);
    var monthsTxt = avg ? avg.months.map(function (m) { return m; }).join(', ') + (avg.partial ? ' (mes en curso, parcial)' : '') : '';

    // 1) Fondo de emergencia -------------------------------------------------
    if (avg && avg.expense > 0) {
      var covered = C.round(nw.cash / avg.expense, 1);
      var data = 'Saldo en cuentas ' + fmt(nw.cash) + ' ÷ gasto mensual promedio ' + fmt(avg.expense) + ' (' + monthsTxt + ') = ' + nf(covered) + ' meses. Objetivo: ' + targetMonths + ' meses.';
      if (covered < targetMonths) {
        var missing = C.round(targetMonths * avg.expense - nw.cash, 2);
        add({ id: 'emergencia', severity: covered < targetMonths / 2 ? 'alta' : 'media', area: 'Liquidez',
          title: 'Refuerza tu fondo de emergencia (faltan ' + fmt(missing) + ')',
          why: 'Tu dinero en cuentas cubre ' + nf(covered) + ' meses de gastos y para tu perfil conviene tener ' + targetMonths + ' antes de asumir más riesgo.',
          data: data });
      } else if (covered >= targetMonths * 2 && profile.type !== 'conservador') {
        var excess = C.round(nw.cash - targetMonths * avg.expense, 2);
        add({ id: 'exceso-liquidez', severity: 'baja', area: 'Liquidez',
          title: 'Tienes ' + fmt(excess) + ' de efectivo por encima de tu colchón',
          why: 'Cubres ' + nf(covered) + ' meses de gastos, más del doble de tu objetivo: el excedente sin invertir pierde valor con la inflación.',
          data: data + ' Excedente = ' + fmt(nw.cash) + ' − ' + targetMonths + ' × ' + fmt(avg.expense) + '.' });
      } else {
        add({ id: 'emergencia-ok', severity: 'ok', area: 'Liquidez', title: 'Tu fondo de emergencia está cubierto',
          why: 'Tu dinero en cuentas alcanza para ' + nf(covered) + ' meses de gastos, en línea con tu objetivo de ' + targetMonths + '.', data: data });
      }
    }

    // 2) Tasa de ahorro --------------------------------------------------------
    if (avg && avg.totalIncome > 0) {
      var sr = avg.savingsRate;
      var srData = '(Ingresos ' + fmt(avg.totalIncome) + ' − gastos ' + fmt(avg.totalExpense) + ') ÷ ingresos, en ' + monthsTxt + ' = ' + pct(sr) + '. Meta: ' + savingsGoal + ' %.';
      if (sr < 0) {
        add({ id: 'ahorro-negativo', severity: 'alta', area: 'Ahorro', title: 'Estás gastando más de lo que ingresas',
          why: 'En los últimos meses tus gastos superaron a tus ingresos, así que tu patrimonio se está reduciendo.', data: srData });
      } else if (sr < savingsGoal) {
        var gap = C.round((savingsGoal - sr) / 100 * avg.income, 2);
        add({ id: 'ahorro-bajo', severity: 'media', area: 'Ahorro',
          title: 'Ahorra ' + fmt(gap) + ' más al mes para llegar a tu meta',
          why: 'Ahorras el ' + pct(sr) + ' de tus ingresos y tu meta es el ' + savingsGoal + ' %.',
          data: srData + ' Diferencia mensual = (' + savingsGoal + ' % − ' + pct(sr) + ') × ingreso promedio ' + fmt(avg.income) + '.' });
      } else {
        add({ id: 'ahorro-ok', severity: 'ok', area: 'Ahorro', title: 'Cumples tu meta de ahorro',
          why: 'Ahorras el ' + pct(sr) + ' de tus ingresos, por encima de tu meta del ' + savingsGoal + ' %.', data: srData });
      }
    }

    // 3) Categorías de gasto que crecen (3 meses vs. 3 meses anteriores) -------
    var recent = lastCompleteMonths(today, 3);
    var before = { from: C.shiftMonths(recent.from, -3), to: C.addDays(recent.from, -1) };
    var cur = C.totalsByCategory(state.transactions, rates, 'egreso', recent);
    var prevMap = {};
    C.totalsByCategory(state.transactions, rates, 'egreso', before).forEach(function (r) { prevMap[r.categoryId] = r.total; });
    var threshold = avg ? Math.max(30, C.round(avg.income * 0.02, 2)) : 30; // relevante: ≥ 2 % del ingreso mensual
    // Promedios solo sobre meses con datos: si empezaste a registrar a mitad de periodo, no se inventa una subida.
    var activeMonths = function (range) {
      return C.monthlyCashflow(C.flowTransactions(state), rates, range).filter(function (m) { return m.income > 0 || m.expense > 0; }).length;
    };
    var nRecent = activeMonths(recent), nBefore = activeMonths(before);
    if (nRecent >= 2 && nBefore >= 2) cur.map(function (r) {
      var p = prevMap[r.categoryId] || 0;
      return { categoryId: r.categoryId, now: C.round(r.total / nRecent, 2), before: C.round(p / nBefore, 2) };
    }).filter(function (x) {
      return x.before > 0 && (x.now - x.before) / x.before >= 0.25 && x.now - x.before >= threshold;
    }).sort(function (a, b) { return (b.now - b.before) - (a.now - a.before); }).slice(0, 2).forEach(function (x) {
      var cat = (state.categories.filter(function (c) { return c.id === x.categoryId; })[0] || {}).name || 'Sin categoría';
      var ch = C.round((x.now - x.before) / x.before * 100, 1);
      add({ id: 'gasto-' + x.categoryId, severity: 'media', area: 'Gastos',
        title: 'Tu gasto en ' + cat + ' subió ' + pct(ch),
        why: 'Pasaste de ' + fmt(x.before) + ' a ' + fmt(x.now) + ' al mes en ' + cat + '; revisar este rubro es la forma más rápida de mejorar tu ahorro.',
        data: 'Promedio mensual ' + recent.from.slice(0, 7) + ' a ' + recent.to.slice(0, 7) + ': ' + fmt(x.now) + ' vs. ' + before.from.slice(0, 7) + ' a ' + before.to.slice(0, 7) + ': ' + fmt(x.before) + ' → (' + fmt(x.now) + ' − ' + fmt(x.before) + ') ÷ ' + fmt(x.before) + ' = +' + pct(ch) + '.' });
    });

    // 4) Exposición a riesgo según el perfil -----------------------------------
    if (nw.total > 0 && pf.rows.length) {
      var riskValue = C.sum(pf.rows.filter(function (r) { return r.position.assetType !== 'divisa'; }).map(function (r) { return r.valueBase; }));
      var risk = C.round(riskValue / nw.total * 100, 1);
      var riskData = 'Inversiones de riesgo (acciones, ETF, cripto, otros) ' + fmt(riskValue) + ' ÷ patrimonio ' + fmt(nw.total) + ' = ' + pct(risk) + '. Rango ' + P.label.toLowerCase() + ': ' + P.risk[0] + '–' + P.risk[1] + ' %.';
      if (risk > P.risk[1]) {
        var reduce = C.round(riskValue - P.risk[1] / 100 * nw.total, 2);
        add({ id: 'riesgo-alto', severity: risk > P.risk[1] + 15 ? 'alta' : 'media', area: 'Riesgo',
          title: 'Tu exposición a riesgo supera tu perfil ' + P.label.toLowerCase(),
          why: 'El ' + pct(risk) + ' de tu patrimonio está en activos volátiles; para tu perfil el máximo sugerido es ' + P.risk[1] + ' % (unos ' + fmt(reduce) + ' menos).',
          data: riskData });
      } else if (risk < P.risk[0] && (!avg || nw.cash / Math.max(1, avg.expense) >= targetMonths)) {
        var addAmt = C.round(P.risk[0] / 100 * nw.total - riskValue, 2);
        add({ id: 'riesgo-bajo', severity: 'baja', area: 'Riesgo',
          title: 'Podrías invertir un poco más (unos ' + fmt(addAmt) + ')',
          why: 'Tu fondo de emergencia está cubierto y solo el ' + pct(risk) + ' de tu patrimonio está invertido, por debajo del ' + P.risk[0] + ' % sugerido para tu perfil.',
          data: riskData });
      } else if (risk >= P.risk[0] && risk <= P.risk[1]) {
        add({ id: 'riesgo-ok', severity: 'ok', area: 'Riesgo', title: 'Tu nivel de riesgo encaja con tu perfil',
          why: 'Tienes el ' + pct(risk) + ' de tu patrimonio invertido en activos de riesgo, dentro del rango ' + P.label.toLowerCase() + '.', data: riskData });
      }
    } else if (nw.total > 0 && avg && nw.cash / Math.max(1, avg.expense) >= targetMonths) {
      add({ id: 'empezar', severity: 'baja', area: 'Riesgo', title: 'Podrías empezar a invertir',
        why: 'Tienes tu fondo de emergencia cubierto y todavía no registras inversiones; para tu perfil se sugiere invertir entre el ' + P.risk[0] + ' y el ' + P.risk[1] + ' % del patrimonio.',
        data: 'Patrimonio ' + fmt(nw.total) + ', inversiones registradas: 0.' });
    }

    // 5) Cripto según el perfil -------------------------------------------------
    var crypto = C.sum(pf.rows.filter(function (r) { return r.position.assetType === 'cripto'; }).map(function (r) { return r.valueBase; }));
    if (crypto > 0 && nw.total > 0) {
      var cshare = C.round(crypto / nw.total * 100, 1);
      if (cshare > P.cryptoMax) {
        add({ id: 'cripto', severity: cshare > P.cryptoMax * 2 ? 'alta' : 'media', area: 'Riesgo',
          title: 'La cripto pesa más de lo recomendable para ti',
          why: 'Cripto es el ' + pct(cshare) + ' de tu patrimonio y para un perfil ' + P.label.toLowerCase() + ' se sugiere no pasar del ' + P.cryptoMax + ' %, porque puede caer más de la mitad en meses.',
          data: 'Valor cripto ' + fmt(crypto) + ' ÷ patrimonio ' + fmt(nw.total) + ' = ' + pct(cshare) + '. Máximo sugerido: ' + P.cryptoMax + ' % (' + fmt(C.round(P.cryptoMax / 100 * nw.total, 2)) + ').' });
      }
    }

    // 6) Concentración ------------------------------------------------------------
    if (pf.rows.length) {
      var top = pf.rows[0];
      if (pf.rows.length === 1 || top.weight > P.assetMax) {
        add({ id: 'concentracion', severity: top.weight >= 50 ? 'media' : 'baja', area: 'Diversificación',
          title: top.position.ticker + ' concentra el ' + pct(top.weight) + ' de tu portafolio',
          why: 'Si ' + top.position.ticker + ' cae, arrastra a casi todo tu portafolio; para tu perfil se sugiere que un solo activo no supere el ' + P.assetMax + ' %.',
          data: 'Valor ' + top.position.ticker + ' ' + fmt(top.valueBase) + ' ÷ portafolio ' + fmt(pf.value) + ' = ' + pct(top.weight) + '. ' + pf.rows.length + ' activo(s) en total.' });
      }
      var topType = pf.byType.slice().sort(function (a, b) { return b.weight - a.weight; })[0];
      var LABEL = { accion: 'acciones', etf: 'ETF', cripto: 'cripto', divisa: 'divisas', otro: 'otros activos' };
      if (pf.byType.length > 0 && topType.weight > 70 && pf.rows.length > 1) {
        add({ id: 'concentracion-tipo', severity: 'baja', area: 'Diversificación',
          title: 'El ' + pct(topType.weight) + ' de tu portafolio está en ' + LABEL[topType.assetType],
          why: 'Combinar tipos de activo distintos (por ejemplo ETF diversificados) reduce el impacto de que un solo mercado vaya mal.',
          data: 'Valor en ' + LABEL[topType.assetType] + ' ' + fmt(topType.value) + ' ÷ portafolio ' + fmt(pf.value) + ' = ' + pct(topType.weight) + '.' });
      }
    }

    // 7) Comportamiento reciente del mercado --------------------------------------
    pf.rows.forEach(function (r) {
      var q = r.quote || {}, t = r.position.ticker;
      var h = q.history || null;
      if (q.change24h != null && Math.abs(q.change24h) >= 5 && q.source !== 'manual') {
        add({ id: 'mercado-24h-' + t, severity: 'baja', area: 'Mercado',
          title: t + ' se movió ' + (q.change24h > 0 ? '+' : '') + pct(q.change24h) + ' en 24 h',
          why: q.change24h < 0
            ? 'Las caídas fuertes de un día son normales en activos volátiles; evita vender por impulso y revisa si tu exposición es la que quieres.'
            : 'Tras una subida fuerte, tu posición pesa más en el portafolio; revisa si sigue dentro de tus límites.',
          data: 'Cambio 24 h (' + q.source + '): ' + pct(q.change24h) + '. Tu posición: ' + fmt(r.valueBase) + ' (' + pct(r.weight) + ' del portafolio).' });
      }
      if (h && isFinite(h.ret30) && Math.abs(h.ret30) >= 15) {
        add({ id: 'mercado-30d-' + t, severity: h.ret30 <= -15 && profile.type === 'conservador' ? 'media' : 'baja', area: 'Mercado',
          title: t + ' ' + (h.ret30 < 0 ? 'cayó ' : 'subió ') + pct(Math.abs(h.ret30)) + ' en 30 días',
          why: h.ret30 < 0
            ? 'Una caída sostenida de un mes indica alta volatilidad: asegúrate de que el peso de ' + t + ' encaje con lo que toleras.'
            : 'Una subida fuerte en un mes puede ser buen momento para rebalancear si ' + t + ' ya pesa demasiado.',
          data: 'Rendimiento 30 d (Binance, cierres diarios): ' + pct(h.ret30) + '; volatilidad diaria ' + pct(h.vol30) + '; caída máxima ' + pct(h.maxDrawdown) + '.' });
      }
      if (r.hasPrice && r.pnlPct <= -20) {
        add({ id: 'perdida-' + t, severity: 'media', area: 'Mercado', title: t + ' acumula ' + pct(r.pnlPct) + ' desde tu compra',
          why: 'Una pérdida grande merece revisar si las razones por las que compraste siguen vigentes, en lugar de esperar por inercia.',
          data: 'Valor ' + fmt(r.valueBase) + ' vs. costo ' + fmt(r.position.costBase) + ' → ' + pct(r.pnlPct) + '.' });
      } else if (r.hasPrice && r.pnlPct >= 50 && r.weight > P.assetMax) {
        add({ id: 'ganancia-' + t, severity: 'baja', area: 'Mercado', title: t + ' gana ' + pct(r.pnlPct) + ' y pesa ' + pct(r.weight),
          why: 'Tomar parte de la ganancia y repartirla en otros activos reduce el riesgo sin renunciar a toda la subida.',
          data: 'Valor ' + fmt(r.valueBase) + ' vs. costo ' + fmt(r.position.costBase) + '; peso máximo sugerido ' + P.assetMax + ' %.' });
      }
    });

    // 8) Comisiones ------------------------------------------------------------------
    var buys = state.investments.filter(function (o) { return o.side === 'compra'; });
    if (buys.length) {
      var feeTotal = C.sum(state.investments.map(function (o) { return C.toBase(o.fee || 0, o.currency, rates) || 0; }));
      var gross = C.sum(buys.map(function (o) { return C.toBase(o.quantity * o.price, o.currency, rates) || 0; }));
      var feePct = gross > 0 ? C.round(feeTotal / gross * 100, 2) : 0;
      if (feePct >= 1) {
        add({ id: 'comisiones', severity: 'baja', area: 'Costos', title: 'Tus comisiones son altas (' + pct(feePct) + ' de lo invertido)',
          why: 'Pagar más del 1 % en comisiones se come una parte importante de la rentabilidad; agrupar compras o cambiar de broker puede ayudar.',
          data: 'Comisiones ' + fmt(feeTotal) + ' ÷ monto comprado ' + fmt(gross) + ' = ' + pct(feePct) + '.' });
      }
    }

    // 9) Terceros: cobros vencidos y pagos próximos ---------------------------------
    var tp = nw.thirdParty;
    var overdueRec = tp.receivables.filter(function (i) { return i.overdue; });
    if (overdueRec.length) {
      var od = C.sum(overdueRec.map(function (i) { return i.pendingBase || 0; }));
      add({ id: 'cobros-vencidos', severity: od >= (avg ? avg.expense : 0) * 0.5 && od > 0 ? 'alta' : 'media', area: 'Terceros',
        title: 'Tienes ' + fmt(od) + ' por cobrar vencido',
        why: 'Cuanto más tiempo pasa, más difícil es cobrar: conviene reclamarlo ya o acordar una fecha de pago.',
        data: overdueRec.map(function (i) { return (i.person || 'Sin nombre') + ': ' + fmt(i.pendingBase) + ' (vencido hace ' + Math.abs(i.daysToDue) + ' días)'; }).join(' · ') + '.' });
    }
    var soonPay = tp.payables.filter(function (i) { return i.status !== 'pagada' && i.dueDate && i.daysToDue <= 7; });
    if (soonPay.length) {
      var sp = C.sum(soonPay.map(function (i) { return i.pendingBase || 0; }));
      var late = soonPay.some(function (i) { return i.overdue; });
      add({ id: 'pagos-proximos', severity: late || sp > nw.cash ? 'alta' : 'media', area: 'Terceros',
        title: late ? 'Tienes pagos vencidos por ' + fmt(sp) : 'Pagos por ' + fmt(sp) + ' vencen esta semana',
        why: sp > nw.cash ? 'Lo que debes pagar supera el dinero que tienes en cuentas; planifica de dónde saldrá.' : 'Tenerlos presentes evita recargos y mantiene tu reputación con quien te prestó.',
        data: soonPay.map(function (i) { return (i.person || 'Sin nombre') + ': ' + fmt(i.pendingBase) + (i.overdue ? ' (vencido)' : ' (vence en ' + i.daysToDue + ' días)'); }).join(' · ') +
          '. Saldo en cuentas: ' + fmt(nw.cash) + '.' });
    }

    // 10) Calidad de los datos ------------------------------------------------------
    var unpriced = pf.rows.filter(function (r) { return !r.hasPrice; }).map(function (r) { return r.position.ticker; });
    if (unpriced.length) {
      add({ id: 'sin-precio', severity: 'baja', area: 'Datos', title: 'Faltan precios de ' + unpriced.join(', '),
        why: 'Sin precio actual esos activos se valoran a costo, así que tu patrimonio y tus porcentajes pueden no ser exactos.',
        data: unpriced.length + ' activo(s) sin cotización: ingrésala a mano en Inversiones o añade tu API key de Finnhub.' });
    }

    return out.sort(function (a, b) { return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]; });
  }

  root.Advisor = {
    QUESTIONS: QUESTIONS, GOALS: GOALS, PROFILES: PROFILES,
    scoreProfile: scoreProfile, monthlyAverages: monthlyAverages, recommend: recommend
  };
})(this);
