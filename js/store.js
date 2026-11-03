/* =========================================================================
 * store.js — Persistencia, valores por defecto, migraciones, copia de seguridad (JSON) y exportación CSV.
 * Los datos se guardan en IndexedDB (sin el límite de ~5 MB de localStorage). Mientras ocupan poco
 * (≤ MIRROR_MAX) también se deja una copia en localStorage por compatibilidad. `Store.ready` se cumple
 * cuando IndexedDB ya se leyó: la app llama a `load()` después (ver app/init.js).
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
      brokerages: [],          // intermediaciones: compro a un cliente y vendo a otro (ganancia por la diferencia de tasas)
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
      brokerages: Array.isArray(data.brokerages) ? data.brokerages : [],
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
  var COLLECTIONS = ['accounts', 'categories', 'methods', 'transactions', 'investments', 'debts', 'exchanges', 'sales', 'loans', 'contacts', 'brokerages'];
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
    flush();   // lo pendiente del estado anterior se escribe primero (y queda marcado)
    baseline = stamp(state, null);
    return writeRaw(state);
  }

  // ---------- IndexedDB (almacenamiento principal) ----------
  var DB_NAME = 'misFinanzasDatos', DB_STORE = 'kv';
  var MIRROR_MAX = 1500000;          // caracteres (~3 MB en localStorage): por encima solo se guarda en IndexedDB
  var AT_KEY = KEY + '.at';          // marca de la última copia en localStorage (para detectar cambios de una versión vieja)
  var idb = null, idbRec = null, lastLen = 0, putting = false, pendingPut = null;
  var source = 'nuevo';              // de dónde se cargaron los datos: indexeddb | localStorage | nuevo
  function idbReq(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function idbOpen() {
    return new Promise(function (res, rej) {
      if (!root.indexedDB) { rej(new Error('Sin IndexedDB')); return; }
      var r = root.indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(DB_STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.onblocked = function () { rej(new Error('IndexedDB bloqueado')); };
    });
  }
  // Se lee al cargar el archivo; si IndexedDB no responde en 1,5 s se sigue con localStorage
  var ready = Promise.race([
    idbOpen().then(function (db) { return idbReq(db.transaction(DB_STORE).objectStore(DB_STORE).get(KEY)).then(function (rec) { idb = db; idbRec = rec || null; }); })
      .catch(function () { idb = null; }),
    new Promise(function (res) { setTimeout(res, 1500); })
  ]);
  /** Escribe en IndexedDB sin bloquear: si ya hay una escritura en curso, solo se guarda la última. */
  function idbPut(rec) {
    pendingPut = rec;
    if (putting || !idb) return;
    putting = true;
    var next = pendingPut; pendingPut = null;
    var tx = idb.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(next, KEY);
    var done = function () { putting = false; if (pendingPut) idbPut(pendingPut); };
    tx.oncomplete = done;
    tx.onerror = tx.onabort = function () { done(); try { root.localStorage.setItem(KEY, next.data); } catch (e) { /* sin espacio */ } };
  }

  function writeRaw(state) {
    var json = JSON.stringify(state), at = Date.now(), lsOk = false;
    lastLen = json.length;
    if (!idb || json.length <= MIRROR_MAX) {
      try { root.localStorage.setItem(KEY, json); root.localStorage.setItem(AT_KEY, String(at)); lsOk = true; } catch (e) { lsOk = false; }
    }
    if (idb) {
      // Grande (o sin espacio en localStorage): solo IndexedDB; se quita la copia vieja para que no quede desactualizada
      if (!lsOk) { try { root.localStorage.removeItem(KEY); root.localStorage.removeItem(AT_KEY); } catch (e) { /* nada */ } }
      idbPut({ data: json, at: at });
      return true;
    }
    if (!lsOk) root.alert('No se pudo guardar (almacenamiento lleno o bloqueado). Exporta una copia de seguridad.');
    return lsOk;
  }

  /** Datos guardados: IndexedDB; localStorage si no hay nada allí (o si una versión vieja de la app lo cambió después). */
  function pickRaw() {
    var ls = null, lsAt = null;
    try { ls = root.localStorage.getItem(KEY); lsAt = root.localStorage.getItem(AT_KEY); } catch (e) { ls = null; }
    var dbRaw = idbRec && idbRec.data;
    if (dbRaw && ls && ls !== dbRaw && lsAt === String(idbRec.at)) { source = 'localStorage'; return ls; }   // editado por una versión sin IndexedDB
    if (dbRaw) { source = 'indexeddb'; return dbRaw; }
    if (ls) { source = 'localStorage'; return ls; }
    source = 'nuevo'; return null;
  }

  function load() {
    var raw = pickRaw(), state;
    lastLen = raw ? raw.length : 0;
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
    // Primera vez con IndexedDB: los datos de localStorage pasan allí
    if (idb && source !== 'indexeddb' && raw) writeRaw(state);
    return state;
  }

  /** Cuánto ocupan los datos y dónde están (para Ajustes). */
  function info() {
    var lsChars = 0;
    try { for (var i = 0; i < root.localStorage.length; i++) { var k = root.localStorage.key(i); lsChars += k.length + (root.localStorage.getItem(k) || '').length; } } catch (e) { /* nada */ }
    var out = { dataChars: lastLen, indexedDB: !!idb, mirror: !idb || lastLen <= MIRROR_MAX, mirrorMax: MIRROR_MAX, lsChars: lsChars, source: source };
    var nav = root.navigator && root.navigator.storage;
    if (!nav || !nav.estimate) return Promise.resolve(out);
    return Promise.all([nav.estimate(), nav.persisted ? nav.persisted() : Promise.resolve(null)]).then(function (r) {
      out.usage = r[0].usage; out.quota = r[0].quota; out.details = r[0].usageDetails || null; out.persisted = r[1];
      return out;
    }).catch(function () { return out; });
  }
  /** Pide al navegador no borrar los datos de la app cuando le falte espacio. */
  function persistStorage() {
    var nav = root.navigator && root.navigator.storage;
    return nav && nav.persist ? nav.persist() : Promise.resolve(false);
  }

  /** Guarda y marca lo que cambió desde el último guardado. */
  // Para que la pantalla responda antes, el marcado y la escritura se hacen justo después (setTimeout 0);
  // varios guardados seguidos se juntan en uno. `flush()` lo adelanta (antes de sincronizar o al cerrar la app).
  var saveTimer = null, saveState = null;
  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    var st = saveState;
    if (!st) return true;
    saveState = null;
    baseline = stamp(st, baseline);
    var ok = writeRaw(st);
    if (ok && root.Store.onSave) root.Store.onSave();
    return ok;
  }
  function save(state) {
    saveState = state;
    if (!saveTimer) saveTimer = setTimeout(flush, 0);
    return true;
  }
  if (root.addEventListener) {
    root.addEventListener('pagehide', flush);
    root.document && root.document.addEventListener('visibilitychange', function () { if (root.document.visibilityState === 'hidden') flush(); });
  }

  function clear() {
    saveState = null; if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try { root.localStorage.removeItem(KEY); root.localStorage.removeItem(AT_KEY); } catch (e) { /* nada */ }
    if (idb) { pendingPut = null; idb.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).delete(KEY); }
  }

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
    ready: ready, info: info, flush: flush, persistStorage: persistStorage, MIRROR_MAX: MIRROR_MAX,
    onSave: null   // la sincronización se engancha aquí
  };
})(this);
