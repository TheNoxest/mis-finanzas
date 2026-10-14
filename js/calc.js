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
      var st = exchangeSettlement(x);
      if (st && st.side === 'in') (x.settlements || []).forEach(function (s) { if (s.accountId) add(s.accountId, Number(s.amount), s); });
      else if (x.status !== 'pendiente_cobro' && x.inAccountId) add(x.inAccountId, Number(x.received), x);
      if (st && st.side === 'out') (x.settlements || []).forEach(function (s) { if (s.accountId) add(s.accountId, -Number(s.amount), s); });
      else if (x.status !== 'pendiente_entrega' && x.outAccountId) add(x.outAccountId, -Number(x.delivered), x);
      (x.costs || []).forEach(function (c) { if (c.accountId) add(c.accountId, -Number(c.amount), x); });
    });
    // Deudas: un préstamo mueve dinero al crearse; cada abono entra (por cobrar) o sale (por pagar)
    // Ventas: de contado entra todo en su cuenta; por cobrar entra con cada cobro
    (state.sales || []).forEach(function (sv) {
      if (sv.mode === 'contado') { if (sv.accountId) add(sv.accountId, Number(sv.amount), sv); }
      else (sv.payments || []).forEach(function (pm) { if (pm.accountId) add(pm.accountId, Number(pm.amount), pm); });
    });
    // Préstamos: el capital sale (presté) o entra (me prestaron); cada pago entra o sale
    (state.loans || []).forEach(function (l) {
      var sign = l.kind === 'recibido' ? 1 : -1;
      if (l.accountId) add(l.accountId, sign * Number(l.principal), l);
      (l.payments || []).forEach(function (pm) { if (pm.accountId) add(pm.accountId, -sign * Number(pm.amount), pm); });
    });
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
          quantity: 0, cost: 0, realized: 0, fees: 0, operations: 0, sales: []
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
        // Cada venta con su fecha (para el resumen anual / impuestos)
        p.sales.push({ id: op.id, date: op.date, quantity: sellQ, proceeds: round(sellQ * px, 2), fee: round(fee, 2),
          cost: costOut, gain: round(sellQ * px - fee - costOut, 2) });
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

  /**
   * Cobro o entrega pendiente de un cambio de divisas.
   *  lado 'in'  = falta cobrar al cliente (total = recibido) · 'out' = falta entregarle (total = entregado)
   *  Lo cobrado/entregado después va en x.settlements [{date, amount, accountId}]; x.settleSide recuerda el lado
   *  cuando ya está saldado (estado «completada»). Devuelve null si el cambio nunca estuvo pendiente.
   */
  function exchangeSettlement(x) {
    var side = x.status === 'pendiente_cobro' ? 'in' : x.status === 'pendiente_entrega' ? 'out' : (x.settleSide || null);
    if (!side) return null;
    var total = round(Number(side === 'in' ? x.received : x.delivered) || 0, 2);
    var paid = sum((x.settlements || []).map(function (s) { return s.amount; }));
    var pending = round(total - paid, 2);
    return { side: side, currency: side === 'in' ? x.inCurrency : x.outCurrency, total: total, paid: paid,
      pending: pending > 0 ? pending : 0, status: pending <= 0 ? 'pagada' : paid > 0 ? 'parcial' : 'pendiente' };
  }

  // =================================================================== Clientes (personas)
  /** Clave de una persona: sin tildes, sin mayúsculas, sin signos ni espacios dobles («Ana López» = «ana  lopez»). */
  function personKey(name) {
    return String(name == null ? '' : name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /**
   * Directorio de personas armado con los nombres usados en cambios, ventas, préstamos y deudas
   * (+ fichas de `contacts` con teléfono y nota). Agrupa por `personKey`.
   * Por persona: cuántas operaciones de cada tipo, última fecha, te debe / le debes (base, lo pendiente de Por cobrar/pagar),
   * ventas totales, volumen y ganancia de cambios (base).
   */
  function peopleIndex(state, today) {
    var rates = state.settings.rates, map = {};
    var toB = function (v, c) { var r = toBase(v, c, rates); return isNaN(r) ? 0 : r; };
    function get(name, date) {
      var k = personKey(name);
      if (!k) return null;
      var p = map[k];
      if (!p) p = map[k] = { key: k, name: String(name).trim(), contact: null, exchanges: 0, sales: 0, loans: 0, debts: 0,
        last: '', owesYou: 0, youOwe: 0, salesTotal: 0, fxVolume: 0, fxProfit: 0, spell: {} };
      if (date && date > p.last) p.last = date;
      var nm = String(name).trim().replace(/\s+/g, ' ');
      p.spell[nm] = (p.spell[nm] || 0) + 1;
      return p;
    }
    (state.exchanges || []).forEach(function (x) {
      var p = get(x.client, x.date); if (!p) return;
      var pr = exchangeProfit(x, rates);
      p.exchanges++; p.fxVolume += isNaN(pr.received) ? 0 : pr.received;
      if (x.status === 'completada') p.fxProfit += isNaN(pr.profit) ? 0 : pr.profit;
    });
    (state.sales || []).forEach(function (sv) { var p = get(sv.client, sv.date); if (!p) return; p.sales++; p.salesTotal += toB(sv.amount, sv.currency); });
    (state.loans || []).forEach(function (l) { var p = get(l.person, l.date); if (p) p.loans++; });
    (state.debts || []).forEach(function (d) { var p = get(d.person, d.date); if (p) p.debts++; });
    (state.contacts || []).forEach(function (c) { var p = get(c.name, ''); if (p) { p.contact = c; p.name = String(c.name).trim(); } });
    var tp = thirdParty(state, today);
    tp.receivables.forEach(function (i) { var p = map[personKey(i.person)]; if (p && i.status !== 'pagada') p.owesYou += isNaN(i.pendingBase) ? 0 : i.pendingBase; });
    tp.payables.forEach(function (i) { var p = map[personKey(i.person)]; if (p && i.status !== 'pagada') p.youOwe += isNaN(i.pendingBase) ? 0 : i.pendingBase; });
    // Nombre a mostrar: el de la ficha; si no, la forma mejor escrita (mayúsculas y tildes), luego la más usada
    var quality = function (n) { return (n.match(/[A-ZÁÉÍÓÚÑÜ]/g) || []).length + 2 * (n.match(/[áéíóúñüÁÉÍÓÚÑÜ]/g) || []).length; };
    return Object.keys(map).map(function (k) {
      var p = map[k];
      if (!p.contact) p.name = Object.keys(p.spell).sort(function (a, b) { return quality(b) - quality(a) || p.spell[b] - p.spell[a] || a.localeCompare(b); })[0] || p.name;
      delete p.spell;
      ['owesYou', 'youOwe', 'salesTotal', 'fxVolume', 'fxProfit'].forEach(function (f) { p[f] = round(p[f], 2); });
      p.total = p.exchanges + p.sales + p.loans + p.debts;
      return p;
    }).sort(function (a, b) { return a.last < b.last ? 1 : a.last > b.last ? -1 : a.name.localeCompare(b.name); });
  }

  /**
   * Historial de una persona (más reciente primero): cada cambio, venta, préstamo y deuda con su estado.
   * item: { date, kind: 'cambio'|'venta'|'prestamo'|'deuda', id, rec, status, amount, currency, pending }
   */
  function personHistory(state, key, today) {
    var out = [];
    var mine = function (n) { return personKey(n) === key; };
    (state.exchanges || []).forEach(function (x) {
      if (!mine(x.client)) return;
      var st = exchangeSettlement(x);
      out.push({ date: x.date, kind: 'cambio', id: x.id, rec: x, amount: Number(x.received), currency: x.inCurrency,
        status: st && st.status !== 'pagada' ? (st.paid > 0 ? 'parcial' : 'pendiente') : 'completada', pending: st ? st.pending : 0, pendingCurrency: st ? st.currency : null });
    });
    (state.sales || []).forEach(function (sv) {
      if (!mine(sv.client)) return;
      var b = saleBalance(sv);
      out.push({ date: sv.date, kind: 'venta', id: sv.id, rec: sv, amount: Number(sv.amount), currency: sv.currency, status: sv.mode === 'contado' ? 'contado' : b.status, pending: b.pending });
    });
    (state.loans || []).forEach(function (l) {
      if (!mine(l.person)) return;
      var st = loanStatus(l, today);
      out.push({ date: l.date, kind: 'prestamo', id: l.id, rec: l, amount: Number(l.principal), currency: l.currency, status: st.overdue > 0 ? 'vencida' : st.status, pending: st.pending });
    });
    (state.debts || []).forEach(function (d) {
      if (!mine(d.person)) return;
      var b = debtBalance(d);
      out.push({ date: d.date, kind: 'deuda', id: d.id, rec: d, amount: Number(d.amount), currency: d.currency, status: b.status, pending: b.pending });
    });
    return out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.rec.createdAt || 0) - (a.rec.createdAt || 0); });
  }

  /** Personas cuyo nombre coincide con lo escrito (empieza por → contiene), para sugerir al escribir. */
  function matchPeople(people, text, limit) {
    var q = personKey(text);
    if (!q) return people.slice(0, limit || 6);
    var starts = [], contains = [];
    people.forEach(function (p) {
      if (p.key.indexOf(q) === 0 || p.key.split(' ').some(function (w) { return w.indexOf(q) === 0; })) starts.push(p);
      else if (p.key.indexOf(q) !== -1) contains.push(p);
    });
    return starts.concat(contains).slice(0, limit || 6);
  }

  // =================================================================== Ventas
  /** Venta: de contado está cobrada; por cobrar = total − cobros. */
  function saleBalance(sv) {
    var total = round(Number(sv.amount) || 0, 2);
    if (sv.mode === 'contado') return { total: total, paid: total, pending: 0, status: 'pagada' };
    var paid = sum((sv.payments || []).map(function (p) { return p.amount; }));
    var pending = round(total - paid, 2);
    return { total: total, paid: paid, pending: pending > 0 ? pending : 0, status: pending <= 0 ? 'pagada' : paid > 0 ? 'parcial' : 'pendiente' };
  }

  // =================================================================== Préstamos
  var PERIODS = { diario: { days: 1 }, semanal: { days: 7 }, quincenal: { days: 15 }, mensual: { months: 1 }, bimestral: { months: 2 },
    trimestral: { months: 3 }, semestral: { months: 6 }, anual: { months: 12 } };
  /** Fecha `k` periodos después de `iso` (quincenal = 15 días; los meses respetan fin de mes). */
  function addPeriod(iso, period, k) {
    var p = PERIODS[period] || PERIODS.mensual;
    return p.days ? addDays(iso, p.days * k) : shiftMonths(iso, p.months * k);
  }
  /**
   * Plan de cuotas de un préstamo.
   *  l: { principal, installments, period, date, firstDue?, interest: { mode: 'ninguno'|'porcentaje'|'fijo', value, basis: 'periodo'|'total', method: 'simple'|'frances' } }
   *  · porcentaje por periodo, simple:   interés total = capital × % × cuotas
   *  · porcentaje por periodo, sobre saldo (francés): cuota fija = C·r / (1 − (1+r)^−n); interés = saldo × r
   *  · porcentaje en total:              interés total = capital × %
   *  · monto fijo por periodo:           interés total = monto × cuotas ;  monto fijo en total: interés total = monto
   *  Capital e interés se reparten en partes iguales; la última cuota ajusta los centavos.
   */
  function loanSchedule(l) {
    var P = round(Number(l.principal) || 0, 2), n = Math.max(1, Math.floor(Number(l.installments) || 1));
    var it = l.interest || {}, mode = it.mode || 'ninguno', v = Number(it.value) || 0, basis = it.basis === 'total' ? 'total' : 'periodo';
    var first = l.firstDue || addPeriod(l.date, l.period, 1);
    // Cada cuota se cuenta desde el inicio (31/1 mensual → 28/2, 31/3, 30/4) o desde la primera cuota elegida
    var dueOf = function (i) { return l.firstDue ? addPeriod(l.firstDue, l.period, i) : addPeriod(l.date, l.period, i + 1); };
    var rows = [], i;
    if (mode === 'porcentaje' && basis === 'periodo' && it.method === 'frances' && v > 0) {
      var r = v / 100, cuota = round(P * r / (1 - Math.pow(1 + r, -n)), 2), saldo = P;
      for (i = 0; i < n; i++) {
        var ip = round(saldo * r, 2), cap = i === n - 1 ? saldo : round(cuota - ip, 2);
        rows.push({ n: i + 1, date: dueOf(i), capital: cap, interest: ip, total: round(cap + ip, 2) });
        saldo = round(saldo - cap, 2);
      }
    } else {
      var I = mode === 'porcentaje' ? (basis === 'periodo' ? P * v / 100 * n : P * v / 100) : mode === 'fijo' ? (basis === 'periodo' ? v * n : v) : 0;
      I = round(I, 2);
      var capEach = round(P / n, 2), intEach = round(I / n, 2);
      for (i = 0; i < n; i++) {
        var last = i === n - 1;
        var c = last ? round(P - capEach * (n - 1), 2) : capEach, t = last ? round(I - intEach * (n - 1), 2) : intEach;
        rows.push({ n: i + 1, date: dueOf(i), capital: c, interest: t, total: round(c + t, 2) });
      }
    }
    var interest = sum(rows.map(function (x) { return x.interest; }));
    return { rows: rows, principal: P, interest: interest, total: round(P + interest, 2), first: first };
  }
  /**
   * Reparte cada pago (en orden de fecha) sobre las cuotas: en cada cuota primero el interés y luego el capital.
   * Devuelve [{ payment, interest, capital }] — el interés es lo que cuenta como ingreso (o gasto) el día del pago.
   */
  function loanPaymentSplit(l) {
    var rows = loanSchedule(l).rows.map(function (x) { return { interest: x.interest, capital: x.capital }; });
    var pays = (l.payments || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0); });
    var k = 0;
    return pays.map(function (pm) {
      var left = round(Number(pm.amount) || 0, 2), gi = 0, gc = 0;
      while (left > 0 && k < rows.length) {
        var r = rows[k], a = Math.min(left, r.interest);
        r.interest = round(r.interest - a, 2); left = round(left - a, 2); gi += a;
        var b = Math.min(left, r.capital);
        r.capital = round(r.capital - b, 2); left = round(left - b, 2); gc += b;
        if (r.interest <= 0 && r.capital <= 0) k++;
      }
      return { payment: pm, interest: round(gi, 2), capital: round(gc + left, 2) };   // lo que sobre (pago de más) va a capital
    });
  }
  /** Estado del préstamo hoy: cuotas pagadas/parciales/vencidas, lo pendiente, el capital pendiente y la próxima cuota. */
  function loanStatus(l, today) {
    var sc = loanSchedule(l), split = loanPaymentSplit(l);
    var paid = sum((l.payments || []).map(function (p) { return p.amount; }));
    var interestPaid = sum(split.map(function (x) { return x.interest; })), capitalPaid = sum(split.map(function (x) { return x.capital; }));
    var left = paid, overdue = 0, next = null;
    var rows = sc.rows.map(function (r) {
      var got = round(Math.min(left, r.total), 2); left = round(left - got, 2);
      var st = got >= r.total ? 'pagada' : got > 0 ? 'parcial' : 'pendiente';
      var due = round(r.total - got, 2);
      if (st !== 'pagada' && today && r.date < today) { st = 'vencida'; overdue = round(overdue + due, 2); }
      if (!next && due > 0) next = { n: r.n, date: r.date, amount: due };
      return Object.assign({}, r, { paid: got, due: due, status: st });
    });
    var pending = round(sc.total - paid, 2), capPend = round(sc.principal - capitalPaid, 2);
    return { rows: rows, principal: sc.principal, interest: sc.interest, total: sc.total, paid: paid,
      interestPaid: interestPaid, capitalPaid: capitalPaid, pending: pending > 0 ? pending : 0, capitalPending: capPend > 0 ? capPend : 0,
      overdue: overdue, next: next, paidCount: rows.filter(function (r) { return r.status === 'pagada'; }).length,
      status: pending <= 0 ? 'pagada' : paid > 0 ? 'parcial' : 'pendiente' };
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
    (state.sales || []).forEach(function (sv) {
      if (sv.mode === 'contado') return;
      var b = saleBalance(sv);
      rec.push({ source: 'venta', id: sv.id, person: sv.client, concept: sv.concept || 'Venta', currency: sv.currency, date: sv.date, dueDate: sv.dueDate || null,
        total: b.total, paid: b.paid, pending: b.pending, status: b.status, pendingBase: toBase(b.pending, sv.currency, rates) });
    });
    (state.loans || []).forEach(function (l) {
      var st = loanStatus(l, today);
      // Lo que vale hoy (patrimonio) es el capital pendiente; los intereses futuros aún no se han ganado
      (l.kind === 'recibido' ? pay : rec).push({ source: 'prestamo', id: l.id, person: l.person, concept: 'Préstamo', currency: l.currency, date: l.date,
        dueDate: st.next ? st.next.date : null, total: st.total, paid: st.paid, pending: st.pending, status: st.status,
        capitalPending: st.capitalPending, pendingBase: toBase(st.capitalPending, l.currency, rates), next: st.next, installments: st.rows.length });
    });
    (state.exchanges || []).forEach(function (x) {
      var st = exchangeSettlement(x);
      if (!st) return;
      (st.side === 'in' ? rec : pay).push({ source: 'cambio', id: x.id, person: x.client, concept: st.side === 'in' ? 'Cobrar cambio' : 'Entregar cambio',
        currency: st.currency, date: x.date, dueDate: null, total: st.total, paid: st.paid, pending: st.pending, status: st.status,
        pendingBase: toBase(st.pending, st.currency, rates) });
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
    // Comisión de una transferencia en la misma moneda (o USDT ↔ USD): lo que se perdió por el camino es un gasto
    state.transactions.forEach(function (t) {
      var fee = transferFee(t);
      if (fee) extra.push({ id: 'tf_' + t.id, synthetic: true, type: fee > 0 ? 'egreso' : 'ingreso', amount: Math.abs(fee),
        currency: t.toCurrency, categoryId: '__comisiones', accountId: t.fromAccountId, date: t.date, note: t.note || '' });
    });
    (state.sales || []).forEach(function (sv) {
      if (Number(sv.amount) > 0) extra.push({ id: 'sv_' + sv.id, synthetic: true, type: 'ingreso', amount: Number(sv.amount), currency: sv.currency,
        categoryId: sv.categoryId || '__ventas', accountId: sv.mode === 'contado' ? sv.accountId : null, date: sv.date, note: sv.client || '' });
    });
    (state.loans || []).forEach(function (l) {
      loanPaymentSplit(l).forEach(function (x) {
        if (x.interest > 0) extra.push({ id: 'li_' + x.payment.id, synthetic: true, type: l.kind === 'recibido' ? 'egreso' : 'ingreso', amount: x.interest,
          currency: l.currency, categoryId: l.kind === 'recibido' ? '__intereses_pag' : '__intereses', accountId: x.payment.accountId, date: x.payment.date, note: l.person || '' });
      });
    });
    return state.transactions.concat(extra);
  }

  /** ¿Valen lo mismo? (misma moneda o ancladas: USDT = USDC = USD) */
  function samePeg(a, b) { return pegOf(a) === pegOf(b); }

  /**
   * Comisión de una transferencia: enviado − recibido, solo si ambas monedas valen lo mismo.
   * Ej.: envías 200 USDT y llegan 195 USD → 5 (gasto). Si llega más → negativo (ingreso).
   * Entre monedas distintas (EUR → USD) la diferencia depende de la tasa: devuelve 0.
   */
  function transferFee(t) {
    if (t.type !== 'transferencia' || !t.toCurrency || !samePeg(t.currency, t.toCurrency)) return 0;
    var to = Number(t.toAmount);
    if (!(to > 0)) return 0;
    return round(Number(t.amount) - to, 2);
  }

  /**
   * Número escrito con coma o punto decimal (NaN si no es válido). Acepta signo «-».
   *  · una sola coma o un solo punto = decimales: «1,5» = 1.5 · «95,5» = 95.5 · «0,00012» = 0.00012 · «1.5» = 1.5
   *  · con los dos, el último es el decimal: «1.234,56» = 1234.56 · «1,234.56» = 1234.56
   *  · varios iguales = miles: «1.234.567» = 1234567 · «1,234,567» = 1234567
   */
  function parseNum(txt) {
    var t = String(txt == null ? '' : txt).replace(/[\s ]/g, '');
    var neg = t.charAt(0) === '-';
    if (neg) t = t.slice(1);
    if (!/^[0-9.,]*[0-9][0-9.,]*$/.test(t)) return NaN;
    var commas = t.split(',').length - 1, dots = t.split('.').length - 1;
    if (commas && dots) {
      var dec = t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.';
      t = t.split(dec === ',' ? '.' : ',').join('');
      if (t.split(dec).length > 2) return NaN;
      t = t.replace(dec, '.');
    } else if (commas) t = commas > 1 ? t.split(',').join('') : t.replace(',', '.');
    else if (dots > 1) t = t.split('.').join('');
    var v = Number(t);
    return isFinite(v) ? (neg ? -v : v) : NaN;
  }

  /** Monto escrito: como `parseNum` (sin signo) y con sumas («12,50+3» = 15.5). NaN si no es válido. */
  function parseAmount(txt) {
    var parts = String(txt == null ? '' : txt).replace(/[\s ]/g, '').split('+');
    var total = 0;
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i] && i > 0) continue;            // «12+» mientras se escribe
      var v = parseNum(parts[i]);
      if (!(v >= 0)) return NaN;
      total += v;
    }
    return total;
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
        exchanges: (state.exchanges || []).filter(function (x) { return x.date <= d; }).map(function (x) {
          return x.settlements ? Object.assign({}, x, { settlements: x.settlements.filter(function (s) { return s.date <= d; }) }) : x;
        }),
        debts: (state.debts || []).filter(function (x) { return x.date <= d; }).map(function (x) {
          return Object.assign({}, x, { payments: (x.payments || []).filter(function (pm) { return pm.date <= d; }) });
        }),
        sales: (state.sales || []).filter(function (x) { return x.date <= d; }).map(function (x) {
          return Object.assign({}, x, { payments: (x.payments || []).filter(function (pm) { return pm.date <= d; }) });
        }),
        loans: (state.loans || []).filter(function (x) { return x.date <= d; }).map(function (x) {
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
    exchangeQuote: exchangeQuote, exchangeProfit: exchangeProfit, debtBalance: debtBalance, thirdParty: thirdParty, exchangeSettlement: exchangeSettlement,
    personKey: personKey, peopleIndex: peopleIndex, personHistory: personHistory, matchPeople: matchPeople,
    saleBalance: saleBalance, PERIODS: PERIODS, addPeriod: addPeriod, loanSchedule: loanSchedule, loanPaymentSplit: loanPaymentSplit, loanStatus: loanStatus,
    flowTransactions: flowTransactions,
    samePeg: samePeg,
    transferFee: transferFee,
    parseAmount: parseAmount, parseNum: parseNum,
    seriesDates: seriesDates, monthlyCashflow: monthlyCashflow, categoryBreakdown: categoryBreakdown,
    netWorthSeries: netWorthSeries
  };

  if (typeof module === 'object' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(this);
