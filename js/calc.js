/* =========================================================================
 * calc.js — Cálculos financieros puros (sin DOM, sin red, sin estado).
 * Todo lo que suma, convierte o calcula ganancias vive aquí para poder
 * verificarse de forma aislada (ver tests/index.html).
 * ========================================================================= */
(function (root) {
  'use strict';

  /**
   * Redondeo decimal "humano" (half away from zero) sin errores de coma flotante.
   * Ej.: round(1.005, 2) === 1.01  (Math.round(1.005*100)/100 daría 1.00)
   */
  function round(value, dp) {
    if (dp === undefined) dp = 2;
    var n = Number(value);
    if (!isFinite(n)) return NaN;
    var sign = n < 0 ? -1 : 1;
    var abs = Math.abs(n);
    var s = String(abs);
    var r;
    if (s.indexOf('e') === -1) {
      // Desplazamiento por notación exponencial: evita multiplicar floats.
      r = Number(Math.round(Number(s + 'e' + dp)) + 'e-' + dp);
    } else {
      var f = Math.pow(10, dp);
      r = Math.round(abs * f * (1 + Number.EPSILON)) / f;
    }
    return r === 0 ? 0 : sign * r; // evita -0
  }

  /** Suma una lista de importes y redondea al final (2 decimales por defecto). */
  function sum(values, dp) {
    var total = 0;
    for (var i = 0; i < values.length; i++) total += Number(values[i]) || 0;
    return round(total, dp === undefined ? 2 : dp);
  }

  /**
   * Convierte un importe a la moneda base.
   * rates[moneda] = cuántas unidades de la moneda base vale 1 unidad de esa moneda.
   * Devuelve NaN si falta la tasa (la interfaz lo señala).
   */
  function toBase(amount, currency, rates) {
    var rate = rateOf(rates, currency);
    if (!isFinite(rate) || rate <= 0) return NaN;
    return round(Number(amount) * rate, 2);
  }

  /**
   * Monedas ancladas al dólar: 1 USDT = 1 USDC = 1 USD, siempre.
   * Se usa la tasa del USD aunque la tabla tenga guardado otro valor para USDT.
   */
  var PEGGED = { USDT: 'USD', USDC: 'USD' };
  function pegOf(cur) { return PEGGED[cur] || cur; }
  function rateOf(rates, cur) {
    if (!rates) return NaN;
    var p = PEGGED[cur];
    if (p) {
      if (Number(rates[p]) > 0) return Number(rates[p]);
      // Base sin USD en la tabla pero con USDT: vale lo que valga
      return Number(rates[cur]);
    }
    return Number(rates[cur]);
  }

  /** Convierte entre dos monedas cualesquiera pasando por la base. */
  function convert(amount, from, to, rates) {
    if (from === to || pegOf(from) === pegOf(to)) return round(amount, 2);
    var a = rateOf(rates, from), b = rateOf(rates, to);
    if (!(a > 0) || !(b > 0)) return NaN;
    return round(Number(amount) * a / b, 2);
  }

  /** Tasa de mercado: cuántas unidades de `to` vale 1 unidad de `from` (8 decimales). */
  function marketRate(from, to, rates) {
    if (from === to || pegOf(from) === pegOf(to)) return 1;
    var a = rateOf(rates, from), b = rateOf(rates, to);
    return a > 0 && b > 0 ? round(a / b, 8) : NaN;
  }

  /**
   * Recalcula la tabla de tasas al cambiar de moneda base.
   * nueva[c] = vieja[c] / vieja[nuevaBase]
   */
  function rebaseRates(rates, newBase) {
    var factor = Number(rates[newBase]);
    if (!isFinite(factor) || factor <= 0) throw new Error('No hay tasa para ' + newBase);
    var out = {};
    Object.keys(rates).forEach(function (c) {
      out[c] = c === newBase ? 1 : round(Number(rates[c]) / factor, 10);
    });
    return out;
  }

  /** Filtra elementos con fecha (YYYY-MM-DD) dentro de [from, to] (ambos opcionales). */
  function inRange(item, from, to) {
    if (from && item.date < from) return false;
    if (to && item.date > to) return false;
    return true;
  }

  /** Filtro común de ingresos/gastos: { from, to, categoryId, accountId } (todos opcionales). */
  function matches(t, opts) {
    if (!inRange(t, opts.from, opts.to)) return false;
    if (opts.categoryId && t.categoryId !== opts.categoryId) return false;
    if (opts.accountId && t.accountId !== opts.accountId) return false;
    return true;
  }

  // ---------- Fechas (en UTC para no depender de la zona horaria) ----------
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(from, to) {
    return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
  }
  function lastDayOfMonth(ym) {
    var p = ym.split('-').map(Number);
    return ym + '-' + String(new Date(Date.UTC(p[0], p[1], 0)).getUTCDate()).padStart(2, '0');
  }
  /** Meses 'YYYY-MM' entre dos fechas, ambos incluidos. */
  function monthsBetween(from, to) {
    var out = [], y = +from.slice(0, 4), m = +from.slice(5, 7), ey = +to.slice(0, 4), em = +to.slice(5, 7);
    while ((y < ey || (y === ey && m <= em)) && out.length < 600) {
      out.push(y + '-' + String(m).padStart(2, '0'));
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }
  /** Desplaza una fecha n meses (el día se ajusta al último del mes si no existe: 31/03 − 1 mes = 28/02). */
  function shiftMonths(iso, n) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + n, d = +iso.slice(8, 10);
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(Math.min(d, last)).padStart(2, '0');
  }
  /** Mismo tramo n meses antes (p. ej. 1–13 oct → 1–13 sept). */
  function previousByMonths(from, to, n) {
    return { from: shiftMonths(from, -n), to: shiftMonths(to, -n) };
  }

  /** Periodo anterior de la misma duración, inmediatamente antes de `from`. */
  function previousPeriod(from, to) {
    var len = daysBetween(from, to);
    var prevTo = addDays(from, -1);
    return { from: addDays(prevTo, -len), to: prevTo };
  }
  /** Fechas para la serie de patrimonio: diaria hasta 92 días; si no, fin de cada mes (+ la fecha final). */
  function seriesDates(from, to) {
    var out = [];
    if (daysBetween(from, to) <= 92) {
      for (var d = from; d <= to; d = addDays(d, 1)) out.push(d);
      return out;
    }
    monthsBetween(from, to).forEach(function (ym) {
      var end = lastDayOfMonth(ym);
      out.push(end > to ? to : end);
    });
    if (out[out.length - 1] !== to) out.push(to);
    return out;
  }

  /**
   * Resumen de ingresos y egresos en moneda base.
   * Las transferencias entre cuentas NO son ingreso ni gasto: se ignoran.
   * opts: { from, to, categoryId, accountId }
   */
  function summarizeTransactions(transactions, rates, opts) {
    opts = opts || {};
    var inc = [], exp = [], missing = {};
    transactions.forEach(function (t) {
      if (t.type !== 'ingreso' && t.type !== 'egreso') return;
      if (!matches(t, opts)) return;
      var v = toBase(t.amount, t.currency, rates);
      if (isNaN(v)) { missing[t.currency] = true; return; }
      (t.type === 'ingreso' ? inc : exp).push(v);
    });
    var income = sum(inc), expense = sum(exp);
    return {
      income: income,
      expense: expense,
      net: round(income - expense, 2),
      // Tasa de ahorro = neto / ingresos
      savingsRate: income > 0 ? round((income - expense) / income * 100, 2) : 0,
      count: inc.length + exp.length,
      missingRates: Object.keys(missing)
    };
  }

  /** Total por categoría (moneda base), ordenado de mayor a menor. */
  function totalsByCategory(transactions, rates, type, opts) {
    opts = opts || {};
    var map = {};
    transactions.forEach(function (t) {
      if (t.type !== type || !matches(t, opts)) return;
      var v = toBase(t.amount, t.currency, rates);
      if (isNaN(v)) return;
      (map[t.categoryId] = map[t.categoryId] || []).push(v);
    });
    return Object.keys(map)
      .map(function (k) { return { categoryId: k, total: sum(map[k]) }; })
      .sort(function (a, b) { return b.total - a.total; });
  }

  /** Importe de una operación de inversión en su moneda.
   *  Compra: cantidad × precio + comisión (dinero que sale).
   *  Venta:  cantidad × precio − comisión (dinero que entra). */
  function operationTotal(op) {
    var gross = Number(op.quantity) * Number(op.price);
    var fee = Number(op.fee) || 0;
    return round(op.side === 'venta' ? gross - fee : gross + fee, 2);
  }

  /**
   * Saldo de cada cuenta en SU moneda:
   *   saldo = saldo inicial + ingresos − egresos + transferencias recibidas
   *           − transferencias enviadas − compras pagadas + ventas cobradas
   * opts {from,to}: rango para calcular entradas/salidas del periodo.
   */
  function accountBalances(state, opts) {
    opts = opts || {};
    var rates = state.settings.rates;
    var map = {};
    state.accounts.forEach(function (a) {
      map[a.id] = { account: a, moves: [Number(a.initialBalance) || 0], inflow: [], outflow: [] };
    });
    function add(accId, amount, item) {
      var m = map[accId];
      if (!m) return;
      m.moves.push(amount);
      if (inRange(item, opts.from, opts.to)) (amount >= 0 ? m.inflow : m.outflow).push(Math.abs(amount));
    }
    state.transactions.forEach(function (t) {
      if (t.type === 'ingreso') add(t.accountId, Number(t.amount), t);
      else if (t.type === 'egreso') add(t.accountId, -Number(t.amount), t);
      else if (t.type === 'transferencia') {
        add(t.fromAccountId, -Number(t.amount), t);
        add(t.toAccountId, Number(t.toAmount), t);
      }
    });
    state.investments.forEach(function (op) {
      if (!op.accountId) return;
      var total = operationTotal(op);
      add(op.accountId, op.side === 'venta' ? total : -total, op);
    });
    // Cambios de divisas: entra lo recibido, sale lo entregado y los costos (salvo lo que siga pendiente)
    (state.exchanges || []).forEach(function (x) {
      if (x.status !== 'pendiente_cobro' && x.inAccountId) add(x.inAccountId, Number(x.received), x);
      if (x.status !== 'pendiente_entrega' && x.outAccountId) add(x.outAccountId, -Number(x.delivered), x);
      (x.costs || []).forEach(function (c) { if (c.accountId) add(c.accountId, -Number(c.amount), x); });
    });
    // Deudas: un préstamo mueve dinero al crearse; cada abono entra (por cobrar) o sale (por pagar)
    (state.debts || []).forEach(function (d) {
      var sign = d.kind === 'cobrar' ? 1 : -1;
      if (d.accountId) add(d.accountId, -sign * Number(d.amount), d);
      (d.payments || []).forEach(function (pm) { if (pm.accountId) add(pm.accountId, sign * Number(pm.amount), pm); });
    });
    return state.accounts.map(function (a) {
      var m = map[a.id];
      var balance = sum(m.moves);
      return {
        account: a,
        balance: balance,
        balanceBase: toBase(balance, a.currency, rates),
        inflow: sum(m.inflow),
        outflow: sum(m.outflow)
      };
    });
  }

  function positionKey(op) {
    return op.assetType + '|' + String(op.ticker).trim().toUpperCase() + '|' + op.currency;
  }
  /** Clave de precio: un mismo ticker comparte cotización aunque se haya comprado en otra moneda. */
  function priceKey(assetType, ticker) {
    return assetType + '|' + String(ticker).trim().toUpperCase();
  }

  /**
   * Posiciones con el método de COSTO PROMEDIO PONDERADO.
   *  - Compra: cantidad += q; costo += q·p + comisión
   *  - Venta:  costo_salida = costo · q / cantidad
   *            ganancia_realizada += q·p − comisión − costo_salida
   * Si una venta supera lo disponible se registra en `errors`.
   */
  function buildPositions(investments, rates) {
    var ops = investments.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0);
    });
    var map = {}, order = [], errors = [];

    ops.forEach(function (op) {
      var key = positionKey(op);
      var p = map[key];
      if (!p) {
        p = map[key] = {
          key: key, priceKey: priceKey(op.assetType, op.ticker), assetType: op.assetType,
          ticker: String(op.ticker).trim().toUpperCase(), currency: op.currency,
          quantity: 0, cost: 0, realized: 0, fees: 0, operations: 0
        };
        order.push(key);
      }
      var q = Number(op.quantity), px = Number(op.price), fee = Number(op.fee) || 0;
      p.operations++;
      p.fees = round(p.fees + fee, 2);

      if (op.side === 'compra') {
        p.quantity = round(p.quantity + q, 8);
        p.cost = round(p.cost + q * px + fee, 2);
      } else {
        if (q > p.quantity + 1e-9) {
          errors.push({ id: op.id, ticker: p.ticker, date: op.date, wanted: q, available: p.quantity });
        }
        var sellQ = Math.min(q, p.quantity);
        var costOut = p.quantity > 0 ? round(p.cost * sellQ / p.quantity, 2) : 0;
        p.realized = round(p.realized + sellQ * px - fee - costOut, 2);
        p.quantity = round(p.quantity - sellQ, 8);
        p.cost = round(p.cost - costOut, 2);
        if (p.quantity <= 0) { p.quantity = 0; p.cost = 0; } // posición cerrada
      }
    });

    var list = order.map(function (k) {
      var p = map[k];
      p.avgPrice = p.quantity > 0 ? round(p.cost / p.quantity, 8) : 0;
      p.costBase = toBase(p.cost, p.currency, rates);
      p.realizedBase = toBase(p.realized, p.currency, rates);
      return p;
    });
    return { positions: list, errors: errors };
  }

  /**
   * Valora las posiciones abiertas con las cotizaciones disponibles.
   * prices[priceKey] = { price, currency, change24h, time, source }
   *  valor      = round(cantidad × precio, 2) convertido a base
   *  G/P        = valor − costo   (ambos en base)
   *  G/P %      = G/P / costo × 100
   *  cambio día = valor − valor / (1 + cambio24h/100)
   * Sin precio → se valora a costo y se marca `hasPrice: false`.
   */
  function valuePortfolio(positions, prices, rates) {
    var open = positions.filter(function (p) { return p.quantity > 0; });
    var rows = open.map(function (p) {
      var q = prices && prices[p.priceKey];
      var hasPrice = !!(q && isFinite(q.price) && q.price !== null);
      var valueBase = hasPrice ? toBase(round(p.quantity * q.price, 2), q.currency, rates) : NaN;
      if (isNaN(valueBase)) hasPrice = false;
      var value = hasPrice ? valueBase : p.costBase;
      var pnl = hasPrice ? round(value - p.costBase, 2) : 0;
      var change = hasPrice && isFinite(q.change24h) && q.change24h !== null ? Number(q.change24h) : null;
      return {
        position: p, quote: q || null, hasPrice: hasPrice,
        valueBase: value,
        pnlBase: pnl,
        pnlPct: hasPrice && p.costBase > 0 ? round(pnl / p.costBase * 100, 2) : 0,
        dayChangeBase: change !== null ? round(value - value / (1 + change / 100), 2) : 0
      };
    });
    var total = sum(rows.map(function (r) { return r.valueBase; }));
    var cost = sum(rows.map(function (r) { return r.position.costBase; }));
    var pnl = sum(rows.map(function (r) { return r.pnlBase; }));
    var pricedCost = sum(rows.filter(function (r) { return r.hasPrice; }).map(function (r) { return r.position.costBase; }));
    rows.forEach(function (r) { r.weight = total > 0 ? round(r.valueBase / total * 100, 2) : 0; });
    rows.sort(function (a, b) { return b.valueBase - a.valueBase; });

    // Distribución por tipo de activo
    var byType = {};
    rows.forEach(function (r) { (byType[r.position.assetType] = byType[r.position.assetType] || []).push(r.valueBase); });
    var types = Object.keys(byType).map(function (t) {
      var v = sum(byType[t]);
      return { assetType: t, value: v, weight: total > 0 ? round(v / total * 100, 2) : 0 };
    });

    return {
      rows: rows,
      byType: types,
      value: total,
      cost: cost,
      pnl: pnl,
      pnlPct: pricedCost > 0 ? round(pnl / pricedCost * 100, 2) : 0,
      dayChange: sum(rows.map(function (r) { return r.dayChangeBase; })),
      realized: sum(positions.map(function (p) { return p.realizedBase || 0; })),
      unpriced: rows.filter(function (r) { return !r.hasPrice; }).length
    };
  }

  /**
   * Patrimonio = saldo de todas las cuentas + valor de mercado de inversiones
   * (las posiciones sin precio se valoran a costo).
   */
  function netWorth(state, today) {
    var rates = state.settings.rates;
    var acc = accountBalances(state);
    var cash = sum(acc.map(function (a) { return isNaN(a.balanceBase) ? 0 : a.balanceBase; }));
    var pf = valuePortfolio(buildPositions(state.investments, rates).positions, state.prices, rates);
    var tp = thirdParty(state, today);
    return {
      cash: cash, invested: pf.value, portfolio: pf, accounts: acc,
      receivable: tp.receivableBase, payable: tp.payableBase, thirdParty: tp,
      // Patrimonio = cuentas + inversiones + te deben − debes
      total: round(cash + pf.value + tp.receivableBase - tp.payableBase, 2)
    };
  }

  /**
   * Estadísticas de una serie de cierres diarios (más antiguo primero).
   *  ret30       = (último ÷ primero − 1) × 100
   *  vol30       = desviación estándar muestral de los retornos diarios × 100
   *  maxDrawdown = peor caída desde un máximo previo, en % (≤ 0)
   */
  function priceStats(closes) {
    var c = closes.map(Number).filter(function (x) { return x > 0; });
    if (c.length < 2) return null;
    var rets = [];
    for (var i = 1; i < c.length; i++) rets.push(c[i] / c[i - 1] - 1);
    var mean = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
    var variance = rets.length > 1 ? rets.reduce(function (a, r) { return a + (r - mean) * (r - mean); }, 0) / (rets.length - 1) : 0;
    var peak = c[0], dd = 0;
    c.forEach(function (x) { if (x > peak) peak = x; dd = Math.min(dd, x / peak - 1); });
    return {
      ret30: round((c[c.length - 1] / c[0] - 1) * 100, 2),
      vol30: round(Math.sqrt(variance) * 100, 2),
      maxDrawdown: round(dd * 100, 2)
    };
  }

  // =================================================================== Registro rápido y gestos (Sprint 1)
  /**
   * Ordena ids por cuántas veces se usaron en los últimos `days` días (más usados primero).
   * records: lista con `date` y el campo `field` (p. ej. accountId, categoryId). Empates: orden original.
   */
  function rankByUse(ids, records, field, today, days) {
    days = days || 90;
    var from = today ? addDays(today, -days) : null;
    var count = {};
    records.forEach(function (r) {
      if (from && r.date < from) return;
      var k = r[field];
      if (k) count[k] = (count[k] || 0) + 1;
    });
    return ids.map(function (id, i) { return { id: id, n: count[id] || 0, i: i }; })
      .sort(function (a, b) { return b.n - a.n || a.i - b.i; })
      .map(function (x) { return x.id; });
  }

  /** Deslizar una fila: 'delete' (izquierda), 'edit' (derecha) o null. Debe ser claramente horizontal. */
  function swipeIntent(dx, dy, threshold) {
    threshold = threshold || 70;
    if (Math.abs(dx) < threshold || Math.abs(dx) < 2 * Math.abs(dy)) return null;
    return dx < 0 ? 'delete' : 'edit';
  }

  /** Arrastrar hacia abajo para actualizar: solo desde arriba del todo y claramente vertical. */
  function pullIntent(dy, dx, atTop, threshold) {
    threshold = threshold || 80;
    return !!atTop && dy >= threshold && dy > 2 * Math.abs(dx);
  }

  // =================================================================== Contenido de una cuenta
  /** Cuenta donde queda guardado un activo: la indicada (custodia) o, si no, la que pagó. */
  function custodyOf(op) { return op.custodyAccountId || op.accountId || null; }

  /**
   * Lo que hay en una cuenta: su saldo en su moneda + los activos guardados en ella, a valor de mercado.
   *  total (base) = saldo convertido + valor de los activos
   */
  function accountHoldings(state, accountId) {
    var rates = state.settings.rates;
    var acc = accountBalances(state).filter(function (a) { return a.account.id === accountId; })[0];
    var ops = state.investments.filter(function (o) { return custodyOf(o) === accountId; });
    var built = buildPositions(ops, rates);
    var pf = valuePortfolio(built.positions, state.prices, rates);
    var cashBase = acc && !isNaN(acc.balanceBase) ? acc.balanceBase : 0;
    var total = round(cashBase + pf.value, 2);
    return {
      account: acc ? acc.account : null, cash: acc ? acc.balance : 0, cashBase: cashBase,
      portfolio: pf, errors: built.errors, total: total,
      cashWeight: total > 0 ? round(cashBase / total * 100, 2) : 0
    };
  }

  // =================================================================== Terceros
  /**
   * Cotización de un cambio de divisas a un cliente.
   *  x: { amount, inCurrency, outCurrency, rate, commission: { mode:'porcentaje'|'fijo', value, currency, charge:'descontada'|'aparte' } }
   *  comisión  = porcentaje → monto × valor / 100 ; fijo → valor (convertido a la moneda que envía el cliente)
   *  descontada: el cliente envía el monto;            entregas (monto − comisión) × tasa
   *  aparte:     el cliente envía monto + comisión;    entregas monto × tasa
   */
  function exchangeQuote(x, rates) {
    var A = Number(x.amount) || 0;
    var c = x.commission || {};
    var v = Number(c.value) || 0;
    var com;
    if (c.mode === 'porcentaje') com = round(A * v / 100, 2);
    else {
      var cc = c.currency || x.inCurrency;
      com = cc === x.inCurrency ? round(v, 2) : convert(v, cc, x.inCurrency, rates);
    }
    var aparte = c.charge === 'aparte';
    var net = aparte ? A : round(A - com, 2);
    return {
      commission: com,
      received: aparte ? round(A + com, 2) : round(A, 2),
      net: net,
      delivered: round(net * (Number(x.rate) || 0), 2)
    };
  }

  /**
   * Ganancia de un cambio en moneda base, con las tasas guardadas al registrarlo
   * (así la ganancia no cambia cuando las tasas se mueven después).
   *  ganancia    = recibido − entregado − costos pagados
   *  diferencial = ganancia − comisión + costos   (lo que ganaste o perdiste por la tasa acordada)
   */
  function exchangeProfit(x, ratesNow) {
    var snap = x.snapshot || {};
    var r = snap.rates || ratesNow;
    var toB = function (amt, cur) {
      var k = rateOf(r, cur) > 0 ? rateOf(r, cur) : rateOf(ratesNow, cur);
      return k > 0 ? round(Number(amt) * k, 2) : NaN;
    };
    var receivedB = toB(x.received, x.inCurrency);
    var deliveredB = toB(x.delivered, x.outCurrency);
    var costsB = sum((x.costs || []).map(function (c) { return toB(c.amount, c.currency); }));
    var comB = toB(x.commissionAmount || 0, x.inCurrency);
    // Pasar de la base del registro a la base actual (si cambió)
    var f = snap.base && Number(ratesNow[snap.base]) > 0 ? Number(ratesNow[snap.base]) : 1;
    var profit = round(receivedB - deliveredB - costsB, 2);
    return {
      received: round(receivedB * f, 2), delivered: round(deliveredB * f, 2), costs: round(costsB * f, 2),
      commission: round(comB * f, 2), profit: round(profit * f, 2), spread: round((profit - comB + costsB) * f, 2)
    };
  }

  /** Saldo de una deuda: total − abonos. Estado: pendiente, parcial o pagada. */
  function debtBalance(d) {
    var paid = sum((d.payments || []).map(function (p) { return p.amount; }));
    var pending = round(Number(d.amount) - paid, 2);
    return { paid: paid, pending: pending > 0 ? pending : 0, status: pending <= 0 ? 'pagada' : paid > 0 ? 'parcial' : 'pendiente' };
  }

  /**
   * Cuentas por cobrar y por pagar (incluye cambios pendientes de entregar o de cobrar).
   * Devuelve { receivables, payables, receivableBase, payableBase }.
   */
  function thirdParty(state, today) {
    var rates = state.settings.rates;
    var rec = [], pay = [];
    (state.debts || []).forEach(function (d) {
      var b = debtBalance(d);
      var item = {
        source: 'deuda', id: d.id, person: d.person, concept: d.concept, currency: d.currency, date: d.date, dueDate: d.dueDate || null,
        total: Number(d.amount), paid: b.paid, pending: b.pending, status: b.status, pendingBase: toBase(b.pending, d.currency, rates)
      };
      (d.kind === 'cobrar' ? rec : pay).push(item);
    });
    (state.exchanges || []).forEach(function (x) {
      if (x.status === 'pendiente_entrega') {
        pay.push({ source: 'cambio', id: x.id, person: x.client, concept: 'Entregar cambio', currency: x.outCurrency, date: x.date, dueDate: null,
          total: Number(x.delivered), paid: 0, pending: Number(x.delivered), status: 'pendiente', pendingBase: toBase(x.delivered, x.outCurrency, rates) });
      } else if (x.status === 'pendiente_cobro') {
        rec.push({ source: 'cambio', id: x.id, person: x.client, concept: 'Cobrar cambio', currency: x.inCurrency, date: x.date, dueDate: null,
          total: Number(x.received), paid: 0, pending: Number(x.received), status: 'pendiente', pendingBase: toBase(x.received, x.inCurrency, rates) });
      }
    });
    [rec, pay].forEach(function (list) {
      list.forEach(function (it) {
        it.overdue = it.status !== 'pagada' && !!it.dueDate && !!today && it.dueDate < today;
        it.daysToDue = it.dueDate && today ? daysBetween(today, it.dueDate) : null;
      });
    });
    var open = function (l) { return sum(l.filter(function (i) { return i.status !== 'pagada'; }).map(function (i) { return isNaN(i.pendingBase) ? 0 : i.pendingBase; })); };
    return { receivables: rec, payables: pay, receivableBase: open(rec), payableBase: open(pay) };
  }

  /**
   * Movimientos para informes: los tuyos + la ganancia (o pérdida) de cada cambio completado,
   * como ingreso (o gasto) en la categoría virtual «Cambios de divisa».
   */
  function flowTransactions(state) {
    var rates = state.settings.rates, base = state.settings.baseCurrency;
    var extra = (state.exchanges || []).filter(function (x) { return x.status === 'completada'; }).map(function (x) {
      var p = exchangeProfit(x, rates).profit;
      return { id: 'fx_' + x.id, synthetic: true, type: p >= 0 ? 'ingreso' : 'egreso', amount: Math.abs(p), currency: base,
        categoryId: '__cambios', accountId: x.inAccountId, date: x.date, note: x.client || '' };
    }).filter(function (t) { return t.amount > 0; });
    return state.transactions.concat(extra);
  }

  // =================================================================== Ficha de activo
  var MS = { m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  function intervalMs(iv) { return Number(iv.slice(0, -1)) * MS[iv.slice(-1)]; }

  /**
   * Qué velas pedir a Binance para cada rango (máx. 1000 por consulta).
   * 'mis' = desde 7 días antes de tu primera operación hasta hoy; el intervalo se elige por la duración.
   */
  function klinePlan(range, now, firstOpMs) {
    var fixed = { '1D': ['5m', 288], '1S': ['1h', 168], '1M': ['4h', 180], '3M': ['1d', 90], '1A': ['1d', 365], 'todo': ['1w', 1000] };
    if (fixed[range]) return { interval: fixed[range][0], limit: fixed[range][1] };
    var start = (firstOpMs || now) - 7 * MS.d;
    var span = now - start;
    var iv = span <= 2 * MS.d ? '15m' : span <= 14 * MS.d ? '1h' : span <= 120 * MS.d ? '4h' : span <= 900 * MS.d ? '1d' : '1w';
    return { interval: iv, limit: Math.min(1000, Math.ceil(span / intervalMs(iv)) + 2), startTime: start };
  }

  /**
   * Marcas de compra/venta para el gráfico de un activo.
   * y = precio de la operación expresado en la moneda de la cotización (quoteCur);
   * si la operación se hizo en otra moneda se convierte con las tasas actuales (converted: true).
   * USDT se trata como USD.
   */
  function opMarkers(investments, assetType, ticker, rates, quoteCur) {
    var T = String(ticker).toUpperCase();
    var norm = function (c) { return c === 'USDT' ? 'USD' : c; };
    return investments.filter(function (o) { return o.assetType === assetType && String(o.ticker).toUpperCase() === T; })
      .map(function (o) {
        var same = norm(o.currency) === norm(quoteCur);
        var a = rateOf(rates, o.currency), b = rateOf(rates, norm(quoteCur));
        var y = same ? Number(o.price) : (a > 0 && b > 0 ? round(Number(o.price) * a / b, 8) : NaN);
        return { t: Date.parse(o.date + 'T12:00:00'), y: y, kind: o.side, op: o, converted: !same };
      })
      .filter(function (m) { return isFinite(m.y); })
      .sort(function (a, b) { return a.t - b.t || (a.op.createdAt || 0) - (b.op.createdAt || 0); });
  }

  // =================================================================== Análisis

  /**
   * Flujo de caja por mes (moneda base). Incluye meses sin movimientos (en 0).
   * tasa de ahorro = (ingresos − gastos) / ingresos × 100  (null si no hubo ingresos)
   */
  function monthlyCashflow(transactions, rates, opts) {
    var months = monthsBetween(opts.from, opts.to);
    var acc = {};
    months.forEach(function (m) { acc[m] = { inc: [], exp: [] }; });
    transactions.forEach(function (t) {
      if ((t.type !== 'ingreso' && t.type !== 'egreso') || !matches(t, opts)) return;
      var v = toBase(t.amount, t.currency, rates);
      var bucket = acc[t.date.slice(0, 7)];
      if (!bucket || isNaN(v)) return;
      (t.type === 'ingreso' ? bucket.inc : bucket.exp).push(v);
    });
    return months.map(function (m) {
      var income = sum(acc[m].inc), expense = sum(acc[m].exp), net = round(income - expense, 2);
      return { month: m, income: income, expense: expense, net: net, savingsRate: income > 0 ? round(net / income * 100, 2) : null };
    });
  }

  /**
   * Total por categoría con participación y comparación contra el periodo anterior.
   * share = total / suma × 100 ; change = (total − anterior) / anterior × 100 (null si anterior = 0)
   */
  function categoryBreakdown(transactions, rates, type, opts) {
    var cur = totalsByCategory(transactions, rates, type, opts);
    var prevRange = opts.prev || previousPeriod(opts.from, opts.to);
    var prevOpts = { from: prevRange.from, to: prevRange.to, categoryId: opts.categoryId, accountId: opts.accountId };
    var prev = {};
    totalsByCategory(transactions, rates, type, prevOpts).forEach(function (r) { prev[r.categoryId] = r.total; });
    var total = sum(cur.map(function (r) { return r.total; }));
    return {
      total: total,
      prevTotal: sum(Object.keys(prev).map(function (k) { return prev[k]; })),
      rows: cur.map(function (r) {
        var p = prev[r.categoryId] || 0;
        return {
          categoryId: r.categoryId, total: r.total, share: total > 0 ? round(r.total / total * 100, 2) : 0,
          prev: p, change: p > 0 ? round((r.total - p) / p * 100, 2) : null
        };
      })
    };
  }

  /**
   * Evolución del patrimonio en las fechas dadas.
   *  cuentas    = saldos (con lo ocurrido hasta esa fecha) convertidos con las tasas actuales
   *  inversiones = en `today`: valor de mercado; antes: costo de las posiciones abiertas,
   *               salvo que exista un registro diario (snapshot) con el valor de mercado de ese día.
   * opts: { today, accountId (solo esa cuenta, sin inversiones), assetType (solo ese tipo) }
   */
  function netWorthSeries(state, dates, opts) {
    opts = opts || {};
    var rates = state.settings.rates;
    var snaps = state.snapshots || {};
    return dates.map(function (d) {
      var sub = {
        settings: state.settings, accounts: state.accounts,
        transactions: state.transactions.filter(function (t) { return t.date <= d; }),
        investments: state.investments.filter(function (o) { return o.date <= d; }),
        exchanges: (state.exchanges || []).filter(function (x) { return x.date <= d; }),
        debts: (state.debts || []).filter(function (x) { return x.date <= d; }).map(function (x) {
          return Object.assign({}, x, { payments: (x.payments || []).filter(function (pm) { return pm.date <= d; }) });
        })
      };
      var bal = accountBalances(sub).filter(function (a) { return !opts.accountId || a.account.id === opts.accountId; });
      var cash = sum(bal.map(function (a) { return isNaN(a.balanceBase) ? 0 : a.balanceBase; }));
      var invested = 0, source = 'costo';
      if (!opts.accountId) {
        var ops = opts.assetType ? sub.investments.filter(function (o) { return o.assetType === opts.assetType; }) : sub.investments;
        var pos = buildPositions(ops, rates).positions;
        if (d === opts.today) {
          invested = valuePortfolio(pos, state.prices, rates).value;
          source = 'mercado';
        } else {
          invested = sum(pos.filter(function (p) { return p.quantity > 0; }).map(function (p) { return p.costBase; }));
        }
      }
      var tp = opts.accountId ? null : thirdParty(sub, d);
      var other = tp ? round(tp.receivableBase - tp.payableBase, 2) : 0;
      var snap = snaps[d];
      if (snap && d !== opts.today && !opts.accountId && !opts.assetType) {
        cash = snap.cash; invested = snap.invested; other = snap.terceros || 0; source = 'registro';
      }
      return { date: d, cash: cash, invested: invested, terceros: other, total: round(cash + invested + other, 2), source: source };
    });
  }

  var Calc = {
    round: round, sum: sum, toBase: toBase, convert: convert, rebaseRates: rebaseRates,
    PEGGED: PEGGED, pegOf: pegOf, rateOf: rateOf, marketRate: marketRate,
    summarizeTransactions: summarizeTransactions, totalsByCategory: totalsByCategory,
    operationTotal: operationTotal, accountBalances: accountBalances,
    priceKey: priceKey, buildPositions: buildPositions, valuePortfolio: valuePortfolio,
    netWorth: netWorth,
    addDays: addDays, daysBetween: daysBetween, monthsBetween: monthsBetween, previousPeriod: previousPeriod,
    shiftMonths: shiftMonths, previousByMonths: previousByMonths, priceStats: priceStats,
    klinePlan: klinePlan, opMarkers: opMarkers,
    custodyOf: custodyOf, accountHoldings: accountHoldings,
    rankByUse: rankByUse, swipeIntent: swipeIntent, pullIntent: pullIntent,
    exchangeQuote: exchangeQuote, exchangeProfit: exchangeProfit, debtBalance: debtBalance, thirdParty: thirdParty,
    flowTransactions: flowTransactions,
    seriesDates: seriesDates, monthlyCashflow: monthlyCashflow, categoryBreakdown: categoryBreakdown,
    netWorthSeries: netWorthSeries
  };

  if (typeof module === 'object' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(this);
