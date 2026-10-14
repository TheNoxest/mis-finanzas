/* =========================================================================
 * insights.js — Análisis automáticos (funciones puras, probadas en tests/index.html):
 *   · Resumen mensual («En octubre ahorraste un 18 %, 4 puntos más que…»)
 *   · Resumen anual para la declaración (ingresos, gastos, cambios, ventas)
 *   · Proyección de patrimonio a 1, 5 y 10 años (3 escenarios)
 *   · Revisión del perfil de inversor (¿cambió tu situación?)
 *   · Nivel de riesgo de un activo e ideas para explorar
 * Nada de esto es asesoría financiera ni fiscal: son cálculos con reglas fijas.
 * ========================================================================= */
(function (root) {
  'use strict';

  var C = root.Calc;

  // ---------------------------------------------------------------- fechas
  function monthEnd(ym) { return C.addDays(C.shiftMonths(ym + '-01', 1), -1); }
  function prevMonth(ym) { return C.shiftMonths(ym + '-01', -1).slice(0, 7); }
  function rangeOf(ym, today) {
    var end = monthEnd(ym);
    return { from: ym + '-01', to: today && today < end ? today : end };
  }
  function baseOf(v) { return isNaN(v) ? 0 : v; }

  // ================================================================ resumen mensual
  /**
   * Resumen de un mes frente al anterior.
   *  tasa de ahorro = (ingresos − gastos) ÷ ingresos × 100 ; puntos = tasa − tasa anterior
   *  categoría que más subió: mayor aumento en dinero, con al menos +20 % y +20 (en base)
   *  patrimonio: fin del mes anterior → fin del mes (o hoy)
   */
  function monthlySummary(state, ym, today) {
    var rates = state.settings.rates;
    var flows = C.flowTransactions(state);
    var pm = prevMonth(ym);
    var r = rangeOf(ym, today), pr = rangeOf(pm);
    var cur = C.summarizeTransactions(flows, rates, r), prev = C.summarizeTransactions(flows, rates, pr);
    var curCats = C.totalsByCategory(flows, rates, 'egreso', r);
    var prevMap = {};
    C.totalsByCategory(flows, rates, 'egreso', pr).forEach(function (x) { prevMap[x.categoryId] = x.total; });
    var top = curCats[0] ? { categoryId: curCats[0].categoryId, total: curCats[0].total,
      share: cur.expense > 0 ? C.round(curCats[0].total / cur.expense * 100, 1) : 0 } : null;
    var rising = null;
    curCats.forEach(function (x) {
      var b = prevMap[x.categoryId] || 0, diff = C.round(x.total - b, 2);
      if (b > 0 && diff >= 20 && diff / b >= 0.2 && (!rising || diff > rising.diff)) {
        rising = { categoryId: x.categoryId, now: x.total, before: b, diff: diff, change: C.round(diff / b * 100, 1) };
      }
    });
    var fxList = (state.exchanges || []).filter(function (x) { return x.status === 'completada' && x.date >= r.from && x.date <= r.to; });
    var fxProfit = C.sum(fxList.map(function (x) { return baseOf(C.exchangeProfit(x, rates).profit); }));
    var nw = C.netWorthSeries(state, [monthEnd(pm), r.to], { today: today });
    var nwStart = nw[0].total, nwEnd = nw[1].total;
    return {
      month: ym, prevMonth: pm, partial: r.to !== monthEnd(ym),
      income: cur.income, expense: cur.expense, net: cur.net,
      savingsRate: cur.income > 0 ? cur.savingsRate : null,
      prevSavingsRate: prev.income > 0 ? prev.savingsRate : null,
      deltaPts: cur.income > 0 && prev.income > 0 ? C.round(cur.savingsRate - prev.savingsRate, 1) : null,
      prevExpense: prev.expense,
      top: top, rising: rising,
      fx: { count: fxList.length, profit: fxProfit },
      netWorth: { start: nwStart, end: nwEnd, change: C.round(nwEnd - nwStart, 2),
        pct: nwStart ? C.round((nwEnd - nwStart) / Math.abs(nwStart) * 100, 1) : null },
      hasData: cur.count > 0 || fxList.length > 0
    };
  }

  /**
   * Frases del resumen. h = { money(v), monthName(ym), cat(id), pct(v) } (los pone la interfaz).
   */
  function summarySentences(s, h) {
    var out = [], M = h.monthName(s.month), P = h.monthName(s.prevMonth);
    if (s.savingsRate != null) {
      var t = 'En ' + M + (s.partial ? ' (hasta hoy)' : '') + (s.savingsRate >= 0 ? ' ahorraste el ' + h.pct(s.savingsRate) + ' de tus ingresos' : ' gastaste más de lo que ingresaste (' + h.pct(s.savingsRate) + ')');
      if (s.deltaPts != null && s.deltaPts !== 0) t += ', ' + h.pct(Math.abs(s.deltaPts)).replace(' %', '') + (Math.abs(s.deltaPts) === 1 ? ' punto ' : ' puntos ') + (s.deltaPts > 0 ? 'más' : 'menos') + ' que en ' + P;
      else if (s.deltaPts === 0) t += ', igual que en ' + P;
      out.push(t + '.');
    } else if (s.expense > 0) out.push('En ' + M + ' gastaste ' + h.money(s.expense) + ' y no registraste ingresos.');
    if (s.top) out.push('Tu mayor gasto fue ' + h.cat(s.top.categoryId) + ': ' + h.money(s.top.total) + ' (' + h.pct(s.top.share) + ' del total).');
    if (s.rising) out.push(h.cat(s.rising.categoryId) + ' subió ' + h.pct(s.rising.change) + ' frente a ' + P + ' (de ' + h.money(s.rising.before) + ' a ' + h.money(s.rising.now) + ').');
    if (s.fx.count) out.push('Hiciste ' + s.fx.count + (s.fx.count === 1 ? ' cambio de divisas' : ' cambios de divisas') + ' con una ganancia de ' + h.money(s.fx.profit) + '.');
    if (s.netWorth.change !== 0) out.push('Tu patrimonio ' + (s.netWorth.change > 0 ? 'creció ' : 'bajó ') + h.money(Math.abs(s.netWorth.change)) +
      (s.netWorth.pct != null ? ' (' + (s.netWorth.change > 0 ? '+' : '−') + h.pct(Math.abs(s.netWorth.pct)) + ')' : '') + '.');
    return out;
  }

  // ================================================================ resumen anual
  /**
   * Todo lo de un año, en moneda base (tasas actuales; los cambios usan las tasas fijadas al registrarlos).
   *  ventas: ganancia = venta − comisión − costo promedio de lo vendido (método del costo promedio ponderado)
   */
  function annualReport(state, year) {
    var rates = state.settings.rates, Y = String(year);
    var range = { from: Y + '-01-01', to: Y + '-12-31' };
    var flows = C.flowTransactions(state);
    var s = C.summarizeTransactions(flows, rates, range);
    var inc = C.totalsByCategory(flows, rates, 'ingreso', range), exp = C.totalsByCategory(flows, rates, 'egreso', range);
    var fxList = (state.exchanges || []).filter(function (x) { return x.status === 'completada' && x.date.slice(0, 4) === Y; });
    var fxP = fxList.map(function (x) { return C.exchangeProfit(x, rates); });
    var sales = [];
    C.buildPositions(state.investments, rates).positions.forEach(function (p) {
      (p.sales || []).forEach(function (sl) {
        if (sl.date.slice(0, 4) !== Y) return;
        sales.push({ date: sl.date, ticker: p.ticker, assetType: p.assetType, currency: p.currency, quantity: sl.quantity,
          proceeds: sl.proceeds, cost: sl.cost, fee: sl.fee, gain: sl.gain, gainBase: baseOf(C.toBase(sl.gain, p.currency, rates)) });
      });
    });
    sales.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var gains = C.sum(sales.filter(function (x) { return x.gainBase > 0; }).map(function (x) { return x.gainBase; }));
    var losses = C.sum(sales.filter(function (x) { return x.gainBase < 0; }).map(function (x) { return -x.gainBase; }));
    var opsY = state.investments.filter(function (o) { return o.date.slice(0, 4) === Y; });
    var invFees = C.sum(opsY.map(function (o) { return baseOf(C.toBase(o.fee || 0, o.currency, rates)); }));
    var yrs = {};
    state.transactions.concat(state.investments, state.exchanges || []).forEach(function (x) { if (x.date) yrs[x.date.slice(0, 4)] = true; });
    return {
      year: Number(Y), income: s.income, expense: s.expense, net: s.net,
      incomeByCat: inc, expenseByCat: exp,
      fx: { count: fxList.length, received: C.sum(fxP.map(function (p) { return baseOf(p.received); })),
        commission: C.sum(fxP.map(function (p) { return baseOf(p.commission); })), costs: C.sum(fxP.map(function (p) { return baseOf(p.costs); })),
        profit: C.sum(fxP.map(function (p) { return baseOf(p.profit); })) },
      sales: sales, salesGains: gains, salesLosses: losses, salesNet: C.round(gains - losses, 2),
      invFees: invFees, buys: opsY.filter(function (o) { return o.side === 'compra'; }).length,
      years: Object.keys(yrs).sort().reverse()
    };
  }

  // ================================================================ proyección
  /**
   * Valor futuro con aporte mensual e interés compuesto mensual.
   *  r = (1 + anual)^(1/12) − 1 ;  V(n) = V0·(1+r)^n + A·((1+r)^n − 1) / r   (r = 0 → V0 + A·n)
   */
  function futureValue(start, monthly, annualPct, months) {
    var r = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
    var g = Math.pow(1 + r, months);
    return C.round(start * g + (r === 0 ? monthly * months : monthly * (g - 1) / r), 2);
  }
  /** Escenarios (por defecto 2 / 5 / 8 % anual) con el valor al final de cada año. */
  function projection(start, monthly, rates, years) {
    rates = rates || [2, 5, 8]; years = years || 10;
    return rates.map(function (a) {
      var pts = [];
      for (var y = 0; y <= years; y++) pts.push(futureValue(start, monthly, a, y * 12));
      return { rate: a, values: pts, contributed: C.round(start + monthly * years * 12, 2) };
    });
  }

  // ================================================================ revisión del perfil
  function avgIncome(state, fromIso, toIso) {
    var cf = C.monthlyCashflow(C.flowTransactions(state), state.settings.rates, { from: fromIso, to: toIso })
      .filter(function (m) { return m.income > 0 || m.expense > 0; });
    return cf.length ? C.round(C.sum(cf.map(function (m) { return m.income; })) / cf.length, 2) : null;
  }
  /** Situación al hacer el test (para comparar después). */
  function profileContext(state, today) {
    var cur = today.slice(0, 7) + '-01';
    return { income: avgIncome(state, C.shiftMonths(cur, -3), C.addDays(cur, -1)) || avgIncome(state, cur, today),
      netWorth: C.netWorth(state, today).total, date: today };
  }
  /**
   * ¿Conviene repetir el test? Motivos:
   *  · pasaron 180 días o más · ingresos ±25 % · patrimonio ±30 %
   *  · dijiste que mantendrías en una caída, pero vendiste con pérdida ≥ 15 % después del test
   */
  function profileReview(state, profile, today) {
    if (!profile || !profile.updatedAt) return [];
    var out = [];
    var d = new Date(profile.updatedAt); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    var at = d.toISOString().slice(0, 10);
    var days = C.daysBetween(at, today);
    if (days >= 180) out.push({ id: 'tiempo', text: 'Hiciste el test hace ' + Math.floor(days / 30) + ' meses: tu situación puede haber cambiado.' });
    var ctx = profile.context || null;
    var then = ctx || (function () { var m = at.slice(0, 7) + '-01';
      return { income: avgIncome(state, C.shiftMonths(m, -3), C.addDays(m, -1)) || avgIncome(state, m, at),
        netWorth: C.netWorthSeries(state, [at], { today: today })[0].total }; })();
    var now = profileContext(state, today);
    if (days >= 30 && then.income > 0 && now.income > 0) {
      var ci = C.round((now.income - then.income) / then.income * 100, 1);
      if (Math.abs(ci) >= 25) out.push({ id: 'ingresos', change: ci, text: 'Tus ingresos mensuales ' + (ci > 0 ? 'subieron' : 'bajaron') + ' un ' + Math.abs(ci) + ' % desde el test.' });
    }
    if (days >= 30 && Math.abs(then.netWorth) > 0) {
      var cn = C.round((now.netWorth - then.netWorth) / Math.abs(then.netWorth) * 100, 1);
      if (Math.abs(cn) >= 30) out.push({ id: 'patrimonio', change: cn, text: 'Tu patrimonio ' + (cn > 0 ? 'creció' : 'bajó') + ' un ' + Math.abs(cn) + ' % desde el test.' });
    }
    var drop = Number((profile.answers || {}).drop) || 0;
    var after = [];
    C.buildPositions(state.investments, state.settings.rates).positions.forEach(function (p) {
      (p.sales || []).forEach(function (s) { if (s.date >= at && s.date <= today && s.cost > 0) after.push({ ticker: p.ticker, pct: C.round(s.gain / s.cost * 100, 1) }); });
    });
    var panic = after.filter(function (s) { return s.pct <= -15; });
    if (drop >= 3 && panic.length) {
      out.push({ id: 'caidas', text: 'En el test dijiste que mantendrías ante una caída, pero vendiste ' + panic[0].ticker + ' con una pérdida del ' + Math.abs(panic[0].pct) + ' %. Tu tolerancia real puede ser menor.' });
    }
    return out;
  }

  // ================================================================ riesgo de un activo
  var RISK_LABELS = ['', 'Muy bajo', 'Bajo', 'Medio', 'Alto', 'Muy alto'];
  var PROFILE_MAX_RISK = { conservador: 2, moderado: 3, agresivo: 5 };

  /**
   * Nivel 1–5 por volatilidad anual (%): ≤ 6 muy bajo · ≤ 12 bajo · ≤ 20 medio · ≤ 45 alto · > 45 muy alto.
   * Caídas máximas fuertes suben el nivel: ≤ −50 % → al menos 4; ≤ −75 % → 5.
   */
  function riskLevel(volPct, maxDrawdownPct) {
    var v = Math.abs(Number(volPct) || 0);
    var lvl = v <= 6 ? 1 : v <= 12 ? 2 : v <= 20 ? 3 : v <= 45 ? 4 : 5;
    var dd = Number(maxDrawdownPct) || 0;
    if (dd <= -75) lvl = 5; else if (dd <= -50) lvl = Math.max(lvl, 4);
    return lvl;
  }
  /**
   * Estadísticas de riesgo con cierres (más antiguo primero).
   *  volatilidad anual = desviación muestral de los retornos × √(periodos por año) × 100
   *  rendimiento = (último ÷ primero − 1) × 100 · caída máxima desde un máximo previo
   */
  function riskStats(closes, periodsPerYear) {
    var c = closes.map(Number).filter(function (x) { return x > 0; });
    if (c.length < 10) return null;
    var rets = [];
    for (var i = 1; i < c.length; i++) rets.push(c[i] / c[i - 1] - 1);
    var mean = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
    var sd = Math.sqrt(rets.reduce(function (a, r) { return a + (r - mean) * (r - mean); }, 0) / (rets.length - 1));
    var peak = c[0], dd = 0;
    c.forEach(function (x) { if (x > peak) peak = x; dd = Math.min(dd, x / peak - 1); });
    var vol = C.round(sd * Math.sqrt(periodsPerYear || 365) * 100, 1);
    var maxDD = C.round(dd * 100, 1);
    var lvl = riskLevel(vol, maxDD);
    return { volatility: vol, maxDrawdown: maxDD, return: C.round((c[c.length - 1] / c[0] - 1) * 100, 1),
      level: lvl, label: RISK_LABELS[lvl], points: c.length };
  }
  function fitsProfile(level, type) { return !!type && level <= (PROFILE_MAX_RISK[type] || 3); }

  // ================================================================ activos para explorar
  /**
   * ETF de referencia (sin historial gratis en vivo: el nivel es el típico de su historia y se indica así).
   */
  var ETF_CATALOG = [
    { ticker: 'BND', assetType: 'etf', name: 'Vanguard Total Bond Market', group: 'Renta fija', risk: 1, about: 'Bonos de EE. UU. de alta calidad: se mueve poco y suele amortiguar las caídas de las acciones.' },
    { ticker: 'SHY', assetType: 'etf', name: 'iShares 1-3 Year Treasury Bond', group: 'Renta fija', risk: 1, about: 'Bonos del Tesoro a corto plazo: de lo más estable del mercado.' },
    { ticker: 'VT', assetType: 'etf', name: 'Vanguard Total World Stock', group: 'Índices', risk: 3, about: 'Miles de empresas de todo el mundo en un solo fondo: máxima diversificación en acciones.' },
    { ticker: 'VOO', assetType: 'etf', name: 'Vanguard S&P 500', group: 'Índices', risk: 3, about: 'Las 500 mayores empresas de EE. UU.; comisión muy baja.' },
    { ticker: 'SCHD', assetType: 'etf', name: 'Schwab U.S. Dividend Equity', group: 'Dividendos', risk: 3, about: 'Empresas de EE. UU. que pagan dividendos de forma constante.' },
    { ticker: 'GLD', assetType: 'etf', name: 'SPDR Gold Shares', group: 'Materias primas', risk: 3, about: 'Sigue el precio del oro; a menudo se usa como refugio.' },
    { ticker: 'QQQ', assetType: 'etf', name: 'Invesco QQQ (Nasdaq 100)', group: 'Índices', risk: 4, about: 'Las 100 mayores empresas no financieras del Nasdaq, con mucho peso en tecnología.' }
  ];
  var STABLE = { USDT: 1, USDC: 1, FDUSD: 1, DAI: 1, TUSD: 1, BUSD: 1, USDE: 1, USDS: 1, PYUSD: 1, USD1: 1, USDD: 1, EURC: 1, XAUT: 1, PAXG: 1, WBTC: 1, STETH: 1, WSTETH: 1, WETH: 1, WEETH: 1, CBBTC: 1, BSC_USD: 1 };

  /** Criptos para explorar: las de mayor capitalización con par USDT en Binance, sin estables ni envueltas. */
  function pickCryptos(markets, binanceTickers, n) {
    var ok = {};
    (binanceTickers || []).forEach(function (t) { ok[t] = true; });
    return (markets || []).filter(function (m) {
      var t = String(m.symbol || '').toUpperCase();
      return t && !STABLE[t] && ok[t];
    }).slice(0, n || 12).map(function (m) {
      return { ticker: String(m.symbol).toUpperCase(), assetType: 'cripto', name: m.name, id: m.id, logo: m.image,
        price: m.current_price, change24h: m.price_change_percentage_24h, marketCap: m.market_cap, rank: m.market_cap_rank };
    });
  }

  /**
   * Ideas para explorar según tu portafolio y tu perfil (reglas fijas; no son recomendaciones de compra).
   * pf: resultado de valuePortfolio · type: perfil ('conservador'|'moderado'|'agresivo'|null)
   */
  function ideas(pf, type) {
    var out = [];
    var held = {};
    (pf.rows || []).forEach(function (r) { held[r.position.ticker] = true; });
    var w = {};
    (pf.byType || []).forEach(function (t) { w[t.assetType] = t.weight; });
    var pick = function (list) { return list.filter(function (t) { return !held[t]; }).map(function (t) { return { assetType: t === 'BTC' || t === 'ETH' ? 'cripto' : 'etf', ticker: t }; }); };
    var maxR = PROFILE_MAX_RISK[type] || 3;
    if (!(pf.rows || []).length) {
      out.push({ id: 'empezar', title: 'Para empezar: fondos muy diversificados',
        why: 'Un ETF de índice reparte tu dinero entre cientos o miles de empresas con una sola compra y comisiones bajas.',
        items: pick(maxR <= 2 ? ['BND', 'SHY', 'VT'] : ['VT', 'VOO', 'BND']) });
      return out;
    }
    if ((w.cripto || 0) >= 60) out.push({ id: 'cripto', title: 'Tu portafolio depende casi todo de cripto (' + C.round(w.cripto, 0) + ' %)',
      why: 'Añadir activos que se mueven distinto (índices de acciones, bonos u oro) suaviza las caídas fuertes de la cripto.',
      items: pick(['VT', 'VOO', 'BND', 'GLD']) });
    var hasBonds = held.BND || held.SHY || held.AGG || held.TLT || held.IEF;
    if (!hasBonds && maxR <= 3) out.push({ id: 'bonos', title: 'No tienes renta fija',
      why: 'Para un perfil ' + (type || 'moderado') + ' los bonos dan estabilidad y amortiguan las caídas de las acciones.',
      items: pick(['BND', 'SHY']) });
    var hasIndex = held.VT || held.VOO || held.SPY || held.IVV || held.VTI || held.QQQ || held.VWCE || held.ACWI;
    if (!hasIndex) out.push({ id: 'indices', title: 'Diversifica con un índice amplio',
      why: 'Un índice como el S&P 500 o el mundial evita depender de pocas empresas o de un solo activo.',
      items: pick(['VT', 'VOO']) });
    if (!held.BTC && !held.ETH && type === 'agresivo' && !(w.cripto > 0)) out.push({ id: 'cripto-mayores', title: 'Si quieres algo de cripto, empieza por las de mayor tamaño',
      why: 'Bitcoin y Ethereum son las de mayor capitalización y liquidez; aun así su riesgo es muy alto: limita su peso.',
      items: pick(['BTC', 'ETH']) });
    return out.filter(function (i) { return i.items.length; });
  }

  root.Insights = {
    monthlySummary: monthlySummary, summarySentences: summarySentences, annualReport: annualReport,
    futureValue: futureValue, projection: projection,
    profileContext: profileContext, profileReview: profileReview,
    riskLevel: riskLevel, riskStats: riskStats, fitsProfile: fitsProfile, RISK_LABELS: RISK_LABELS, PROFILE_MAX_RISK: PROFILE_MAX_RISK,
    ETF_CATALOG: ETF_CATALOG, pickCryptos: pickCryptos, ideas: ideas, monthEnd: monthEnd, prevMonth: prevMonth
  };
})(this);
