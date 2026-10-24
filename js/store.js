/* =========================================================================
 * store.js — Persistencia en localStorage, valores por defecto, migraciones,
 * copia de seguridad (JSON) y exportación CSV.
 * ========================================================================= */
(function (root) {
  'use strict';

  var KEY = 'misFinanzas.v1';   // se mantiene la clave; la versión va dentro
  var VERSION = 2;

  var ACCOUNT_KINDS = {
    banco: 'Banco', efectivo: 'Efectivo', billetera: 'Billetera digital',
    broker: 'Broker / Exchange', ahorro: 'Ahorro', otro: 'Otro'
  };

  function uid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /** Fecha local de hoy en formato YYYY-MM-DD. */
  function today() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function defaults() {
    var cat = function (name, type) { return { id: uid(), name: name, type: type }; };
    var met = function (name) { return { id: uid(), name: name }; };
    return {
      version: VERSION,
      settings: {
        baseCurrency: 'USD',
        rates: { USD: 1 },     // 1 unidad de la moneda = X unidades de la base
        rateLocks: {},         // monedas con tasa fijada a mano (no se auto-actualizan)
        autoFx: true,          // actualizar tasas automáticamente
        ratesUpdatedAt: null,
        finnhubKey: '',
        last: {}               // últimos valores usados (registro rápido)
      },
      accounts: [{ id: uid(), name: 'Efectivo', kind: 'efectivo', currency: 'USD', initialBalance: 0, createdAt: Date.now() }],
      categories: [
        cat('Salario', 'ingreso'), cat('Freelance', 'ingreso'), cat('Inversiones', 'ingreso'),
        cat('Otros ingresos', 'ingreso'),
        cat('Vivienda', 'egreso'), cat('Comida', 'egreso'), cat('Transporte', 'egreso'),
        cat('Servicios', 'egreso'), cat('Salud', 'egreso'), cat('Ocio', 'egreso'),
        cat('Educación', 'egreso'), cat('Compras', 'egreso'), cat('Comisiones', 'egreso'),
        cat('Otros gastos', 'egreso')
      ],
      methods: [met('Efectivo'), met('Débito'), met('Crédito'), met('Transferencia')],
      transactions: [],
      investments: [],
      prices: {},              // última cotización conocida por activo
      snapshots: {},           // foto diaria del patrimonio { 'YYYY-MM-DD': {cash, invested, total} }
      profile: null,           // perfil de inversor (cuestionario de la Fase 4)
      assetMeta: {},           // nombre y logo de activos consultados (caché de 7 días)
      debts: [],               // cuentas por cobrar / por pagar a terceros
      exchanges: [],           // cambios de divisas a terceros
      sales: [],               // ventas (de contado o por cobrar)
      loans: [],               // préstamos (presté / me prestaron) con plan de cuotas
      contacts: []             // fichas de clientes (teléfono, nota); el historial sale de los nombres en cada registro
    };
  }

  /** v1 → v2: cada movimiento necesita una cuenta. Se crea una por moneda usada. */
  function migrateV1(data) {
    var accounts = [];
    var byCur = {};
    (data.transactions || []).forEach(function (t) {
      if (!byCur[t.currency]) {
        byCur[t.currency] = { id: uid(), name: 'Cuenta principal ' + t.currency, kind: 'otro', currency: t.currency, initialBalance: 0, createdAt: Date.now() };
        accounts.push(byCur[t.currency]);
      }
      t.accountId = byCur[t.currency].id;
    });
    data.accounts = accounts;
    data.version = 2;
    return data;
  }

  /** Valida la forma mínima del estado; completa campos faltantes. */
  function normalize(data) {
    if (!data || typeof data !== 'object') throw new Error('Formato inválido');
    if (!data.version || data.version < 2) data = migrateV1(data);
    var d = defaults();
    var s = data.settings || {};
    var out = {
      version: VERSION,
      // Se conservan todos los ajustes guardados (fuentes de tasas, última actualización…) y se validan los esenciales
      settings: Object.assign({}, s, {
        baseCurrency: typeof s.baseCurrency === 'string' ? s.baseCurrency : d.settings.baseCurrency,
        rates: s.rates && typeof s.rates === 'object' ? s.rates : d.settings.rates,
        rateLocks: s.rateLocks && typeof s.rateLocks === 'object' ? s.rateLocks : {},
        autoFx: s.autoFx !== false,
        ratesUpdatedAt: s.ratesUpdatedAt || null,
        finnhubKey: typeof s.finnhubKey === 'string' ? s.finnhubKey : '',
        lastBackupAt: s.lastBackupAt || null,
        last: s.last && typeof s.last === 'object' ? s.last : {}
      }),
      accounts: Array.isArray(data.accounts) ? data.accounts : d.accounts,
      categories: Array.isArray(data.categories) ? data.categories : d.categories,
      methods: Array.isArray(data.methods) ? data.methods : d.methods,
      transactions: Array.isArray(data.transactions) ? data.transactions : [],
      investments: Array.isArray(data.investments) ? data.investments : [],
      prices: data.prices && typeof data.prices === 'object' ? data.prices : {},
      snapshots: data.snapshots && typeof data.snapshots === 'object' ? data.snapshots : {},
      profile: data.profile && typeof data.profile === 'object' ? data.profile : null,
      assetMeta: data.assetMeta && typeof data.assetMeta === 'object' ? data.assetMeta : {},
      debts: Array.isArray(data.debts) ? data.debts : [],
      exchanges: Array.isArray(data.exchanges) ? data.exchanges : [],
      sales: Array.isArray(data.sales) ? data.sales : [],
      loans: Array.isArray(data.loans) ? data.loans : [],
      contacts: Array.isArray(data.contacts) ? data.contacts : [],
      deleted: data.deleted && typeof data.deleted === 'object' ? data.deleted : {}   // registros borrados (para sincronizar)
    };
    out.settings.rates[out.settings.baseCurrency] = 1;
    return out;
  }

  // ---------- Marcas de cambio (para sincronizar entre dispositivos) ----------
  // Cada registro lleva `_u` = momento de su último cambio. Al guardar se compara con lo guardado
  // antes: lo que cambió recibe la hora actual y lo que desapareció queda en `deleted` (lápida).
  var COLLECTIONS = ['accounts', 'categories', 'methods', 'transactions', 'investments', 'debts', 'exchanges', 'sales', 'loans', 'contacts'];
  var SINGLES = ['settings', 'profile'];
  var baseline = null;   // huellas de lo último guardado: id → JSON

  function fingerprint(rec) {
    var copy = Object.assign({}, rec);
    delete copy._u;
    return JSON.stringify(copy);
  }

  /**
   * Pone `_u` a lo que cambió respecto de `prev` y anota borrados. Devuelve las huellas nuevas.
   * Sin `prev` (primera carga) solo completa `_u` faltantes, sin marcar cambios.
   */
  function stamp(state, prev, now) {
    now = now || Date.now();
    state.deleted = state.deleted || {};
    var cur = {}, marks = {};
    COLLECTIONS.forEach(function (k) {
      (state[k] || []).forEach(function (r) {
        var h = fingerprint(r);
        cur[r.id] = h;
        if (!prev) { if (!r._u) r._u = r.createdAt || 1; }
        else if (prev[r.id] !== h) { r._u = now; delete state.deleted[r.id]; }
        marks[r.id] = r._u;
      });
    });
    cur.__u = marks;   // marca de cada registro (para que la lápida de un borrado siempre sea más nueva)
    SINGLES.forEach(function (k) {
      var obj = state[k];
      if (!obj) return;
      var h = fingerprint(obj);
      cur['__' + k] = h;
      if (!prev) { if (!obj._u) obj._u = 1; }
      else if (prev['__' + k] !== h) obj._u = now;
    });
    // Borrados: la lápida debe ganarle a la última marca del registro. Si quedaba una lápida vieja
    // (el registro se recuperó con «Deshacer» o al restaurar una copia), se renueva; antes se dejaba la
    // vieja y la sincronización devolvía el registro borrado.
    if (prev) Object.keys(prev).forEach(function (id) {
      if (id.indexOf('__') === 0 || cur[id]) return;
      var t = Math.max(now, ((prev.__u || {})[id] || 0) + 1);
      if (!(state.deleted[id] >= t)) state.deleted[id] = t;
    });
    return cur;
  }

  /**
   * Marca TODO el estado como recién cambiado. Se usa al restaurar una copia o una versión anterior:
   * sin esto, los registros restaurados conservarían su marca vieja y la sincronización los
   * reemplazaría por los de la nube (más recientes), deshaciendo la restauración.
   */
  function touchAll(state, now) {
    now = now || Date.now();
    COLLECTIONS.forEach(function (k) { (state[k] || []).forEach(function (r) { r._u = now; }); });
    SINGLES.forEach(function (k) { if (state[k]) state[k]._u = now; });
    // Lo que existe en la copia restaurada vuelve a estar vivo aunque se hubiera borrado después
    COLLECTIONS.forEach(function (k) { (state[k] || []).forEach(function (r) { if (state.deleted) delete state.deleted[r.id]; }); });
    return state;
  }

  /** Toma `state` como referencia sin marcar cambios (al cargar o al recibir datos sincronizados). */
  function adopt(state) {
    baseline = stamp(state, null);
    return writeRaw(state);
  }

  function writeRaw(state) {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      root.alert('No se pudo guardar (almacenamiento lleno o bloqueado). Exporta una copia de seguridad.');
      return false;
    }
  }

  function load() {
    var raw, state;
    try { raw = root.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) state = defaults();
    else {
      try {
        state = normalize(JSON.parse(raw));
      } catch (e) {
        // No perdemos nada: se guarda el contenido dañado aparte.
        try { root.localStorage.setItem(KEY + '.danado.' + Date.now(), raw); } catch (_) { /* sin espacio */ }
        root.alert('Los datos guardados estaban dañados. Se guardó una copia y se empezó de cero.');
        state = defaults();
      }
    }
    baseline = stamp(state, null);
    return state;
  }

  /** Guarda y marca lo que cambió desde el último guardado. */
  function save(state) {
    baseline = stamp(state, baseline);
    var ok = writeRaw(state);
    if (ok && root.Store.onSave) root.Store.onSave();
    return ok;
  }

  function clear() { root.localStorage.removeItem(KEY); }

  // ---------- Archivos ----------

  /** Escapa un campo CSV (RFC 4180). */
  function csvField(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(header, rows) {
    return [header].concat(rows).map(function (r) { return r.map(csvField).join(','); }).join('\r\n');
  }

  function download(filename, content, mime) {
    // BOM para que Excel reconozca UTF-8 (tildes, ñ).
    var blob = new Blob([mime === 'text/csv' ? '﻿' + content : content], { type: mime + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  root.Store = {
    KEY: KEY, ACCOUNT_KINDS: ACCOUNT_KINDS, COLLECTIONS: COLLECTIONS, uid: uid, today: today, defaults: defaults,
    normalize: normalize, load: load, save: save, adopt: adopt, stamp: stamp, touchAll: touchAll, clear: clear, toCSV: toCSV, download: download,
    onSave: null   // la sincronización se engancha aquí
  };
})(this);
