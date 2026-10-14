/* =========================================================================
 * voice.js — Registro por voz o texto libre.
 *   «Gasté 25 dólares en comida con la tarjeta» → { gasto, 25, USD, Comida, tarjeta }
 * `parse` es una función pura (probada en tests/index.html). `listen` usa el
 * reconocimiento de voz del navegador (Chrome/Edge/Android; en Chrome el audio
 * lo procesa el servicio de voz del navegador).
 * ========================================================================= */
(function (root) {
  'use strict';

  /** Minúsculas y sin tildes, para comparar «Débito» con «debito». */
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }
  function hasWord(text, w) { return new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(text); }

  var EXPENSE = ['gaste', 'gasto', 'pague', 'pago', 'compre', 'compra', 'gastamos', 'pagamos', 'invite', 'di '];
  var INCOME = ['recibi', 'cobre', 'cobro', 'me pagaron', 'me depositaron', 'ingreso', 'ingresaron', 'gane', 'me dieron', 'me transfirieron', 'vendi'];

  // Palabra dicha → moneda (solo si la moneda existe en la app)
  var CURRENCY_WORDS = [
    [['usdt', 'tether', 'teter'], ['USDT']],
    [['dolares', 'dolar', 'usd', 'verdes'], ['USD']],
    [['euros', 'euro', 'eur'], ['EUR']],
    [['bolivares', 'bolivar', 'bs'], ['VES']],
    [['soles', 'sol'], ['PEN']],
    [['reales', 'real'], ['BRL']],
    [['libras', 'libra'], ['GBP']],
    [['pesos', 'peso'], ['MXN', 'COP', 'ARS', 'CLP', 'UYU', 'DOP']]
  ];

  // Palabras frecuentes → trozos del nombre de categoría que las representan
  var CATEGORY_HINTS = [
    [['comida', 'almuerzo', 'almorce', 'cena', 'cene', 'desayuno', 'desayune', 'restaurante', 'supermercado', 'super', 'mercado', 'pizza', 'cafe', 'hamburguesa', 'pan', 'viveres'], ['comida', 'aliment', 'restaur', 'supermerc', 'mercado']],
    [['taxi', 'uber', 'gasolina', 'combustible', 'bus', 'autobus', 'metro', 'pasaje', 'transporte', 'peaje', 'estacionamiento', 'parqueo'], ['transport', 'gasolina', 'auto', 'carro']],
    [['alquiler', 'renta', 'arriendo', 'casa', 'hipoteca', 'condominio'], ['vivienda', 'alquiler', 'casa', 'hogar']],
    [['luz', 'agua', 'internet', 'telefono', 'celular', 'gas', 'electricidad', 'netflix', 'spotify', 'suscripcion'], ['servicio', 'suscrip']],
    [['medico', 'doctor', 'farmacia', 'medicina', 'medicinas', 'dentista', 'clinica', 'seguro medico'], ['salud', 'medic', 'farmac']],
    [['cine', 'fiesta', 'salida', 'bar', 'juego', 'viaje', 'vacaciones', 'concierto', 'ocio'], ['ocio', 'entreten', 'diversion', 'viaje']],
    [['curso', 'libro', 'libros', 'colegio', 'universidad', 'matricula', 'clases', 'escuela'], ['educac', 'estudio', 'curso']],
    [['ropa', 'zapatos', 'tienda', 'amazon', 'regalo', 'compras'], ['compra', 'ropa']],
    [['comision', 'comisiones', 'fee'], ['comision']],
    [['sueldo', 'salario', 'nomina', 'quincena'], ['salario', 'sueldo', 'nomina']],
    [['freelance', 'proyecto', 'cliente', 'trabajo extra', 'honorarios'], ['freelance', 'honorar', 'trabajo']],
    [['dividendo', 'dividendos', 'intereses', 'rendimiento'], ['inversion', 'dividend', 'interes']]
  ];

  /**
   * Número dicho o escrito. «25», «25,50», «25.5», «1.200», «1,200.50», «2 mil», «25 con 50», «$25».
   * Coma o punto seguido de 1–2 cifras = decimales; de 3 cifras = miles.
   */
  function parseNumber(text) {
    var t = text.replace(/\$/g, ' ');
    var m = t.match(/(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*mil\b)?(\s*con\s*(\d{1,2})\b)?/);
    if (!m) return null;
    var raw = m[1], val;
    var dec = raw.match(/[.,](\d{1,2})$/);
    if (dec && !/[.,]\d{3}$/.test(raw)) val = Number(raw.slice(0, -dec[0].length).replace(/[.,]/g, '') + '.' + dec[1]);
    else val = Number(raw.replace(/[.,]/g, ''));
    if (m[2]) val *= 1000;
    if (m[4]) val += Number(m[4]) / (m[4].length === 1 ? 10 : 100);
    return isFinite(val) && val > 0 ? Math.round(val * 100) / 100 : null;
  }

  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
  }

  /**
   * Interpreta una frase.
   * ctx: { accounts:[{id,name,currency}], categories:[{id,name,type}], methods:[{id,name}] (ordenados por uso),
   *        currencies:['USD',…], defaultAccountId, today:'AAAA-MM-DD' }
   * Devuelve { type, amount, currency, accountId, categoryId, methodId, date, note, understood:[…], missing:[…] }
   */
  function parse(text, ctx) {
    var t = ' ' + norm(text) + ' ';
    var out = { type: 'egreso', amount: null, currency: null, accountId: null, categoryId: null, methodId: null,
      date: ctx.today, note: '', understood: [], missing: [] };

    // Tipo
    // Frases de varias palabras se buscan tal cual; palabras sueltas, como palabra completa («pago» ≠ «pagaron»)
    var said1 = function (w) { w = w.trim(); return w.indexOf(' ') !== -1 ? t.indexOf(' ' + w + ' ') !== -1 : hasWord(t, w); };
    var isIncome = INCOME.some(said1);
    var isExpense = EXPENSE.some(said1);
    if (isIncome && !isExpense) out.type = 'ingreso';

    // Monto
    out.amount = parseNumber(t);
    if (out.amount == null) out.missing.push('monto');

    // Moneda dicha
    var curs = ctx.currencies || [];
    var said = null;
    CURRENCY_WORDS.some(function (row) {
      if (!row[0].some(function (w) { return hasWord(t, w); })) return false;
      said = row[1].filter(function (c) { return curs.indexOf(c) !== -1; })[0] || null;
      return true;
    });
    if (!said && /€/.test(text) && curs.indexOf('EUR') !== -1) said = 'EUR';

    // Cuenta: nombrada en la frase («desde Binance», «del banco»)
    var accs = ctx.accounts || [];
    var named = accs.filter(function (a) {
      var n = norm(a.name);
      if (n.length >= 3 && t.indexOf(' ' + n + ' ') !== -1) return true;
      // Una palabra distintiva del nombre (≥ 4 letras), p. ej. «Binance» en «Binance USDT»
      return n.split(' ').some(function (w) { return w.length >= 4 && hasWord(t, w) && ['cuenta', 'principal', 'personal'].indexOf(w) === -1; });
    });
    var acc = named.filter(function (a) { return !said || a.currency === said; })[0] || named[0] || null;
    if (!acc && said) acc = accs.filter(function (a) { return a.id === ctx.defaultAccountId && a.currency === said; })[0] ||
      accs.filter(function (a) { return a.currency === said; })[0] || null;
    if (!acc) acc = accs.filter(function (a) { return a.id === ctx.defaultAccountId; })[0] || accs[0] || null;
    if (acc) { out.accountId = acc.id; out.currency = acc.currency; }
    if (said && acc && acc.currency !== said) out.missing.push('cuenta en ' + said);

    // Categoría: nombre exacto de una categoría del tipo, o palabra frecuente
    var cats = (ctx.categories || []).filter(function (c) { return c.type === out.type; });
    var cat = cats.filter(function (c) { var n = norm(c.name); return n.length >= 3 && t.indexOf(' ' + n) !== -1; })[0] || null;
    if (!cat) CATEGORY_HINTS.some(function (row) {
      if (!row[0].some(function (w) { return hasWord(t, w); })) return false;
      cat = cats.filter(function (c) { var n = norm(c.name); return row[1].some(function (r) { return n.indexOf(r) !== -1; }); })[0] || null;
      return !!cat;
    });
    if (cat) out.categoryId = cat.id; else out.missing.push('categoría');

    // Método de pago
    var methods = ctx.methods || [];
    var byName = function (frag) { return methods.filter(function (m) { return norm(m.name).indexOf(frag) !== -1; })[0] || null; };
    var met = null;
    if (/credito/.test(t)) met = byName('credito');
    else if (/debito/.test(t)) met = byName('debito');
    else if (/tarjeta/.test(t)) met = byName('tarjeta') || methods.filter(function (m) { return /debito|credito/.test(norm(m.name)); })[0] || null;
    else if (hasWord(t, 'efectivo') || hasWord(t, 'cash')) met = byName('efectivo');
    else if (/transferencia|transferi|pago movil|zelle|bizum/.test(t)) met = byName('transfer') || byName('zelle') || byName('pago movil');
    if (!met) methods.some(function (m) { var n = norm(m.name); return n.length >= 4 && hasWord(t, n) && (met = m); });
    if (met) out.methodId = met.id;

    // Fecha
    if (hasWord(t, 'anteayer') || /antes de ayer/.test(t)) out.date = addDays(ctx.today, -2);
    else if (hasWord(t, 'ayer')) out.date = addDays(ctx.today, -1);

    if (!cat) out.note = String(text || '').trim().slice(0, 140);
    return out;
  }

  // ---------------------------------------------------------------- micrófono
  function supported() { return !!(root.SpeechRecognition || root.webkitSpeechRecognition); }
  /**
   * Escucha una frase. onText(texto, final), onEnd(error|null). Devuelve una función para detener.
   */
  function listen(onText, onEnd) {
    var R = root.SpeechRecognition || root.webkitSpeechRecognition;
    if (!R) { onEnd('no-soportado'); return function () {}; }
    var rec = new R();
    rec.lang = 'es-ES'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    var finished = false, error = null;
    rec.onresult = function (e) {
      var txt = '', fin = false;
      for (var i = e.resultIndex; i < e.results.length; i++) { txt += e.results[i][0].transcript; fin = fin || e.results[i].isFinal; }
      onText(txt, fin);
    };
    rec.onerror = function (e) { error = e.error || 'error'; };
    rec.onend = function () { if (!finished) { finished = true; onEnd(error); } };
    try { rec.start(); } catch (e) { finished = true; onEnd('error'); }
    return function () { try { rec.stop(); } catch (e) { /* nada */ } };
  }

  root.Voice = { parse: parse, parseNumber: parseNumber, norm: norm, supported: supported, listen: listen };
})(this);
