/* =========================================================================
 * sync.js — Sincronización cifrada entre dispositivos (Supabase).
 *
 *  - Cifrado de extremo a extremo: AES-GCM 256 con una clave derivada de tu
 *    contraseña de cifrado (PBKDF2-SHA256, 310 000 iteraciones). La contraseña
 *    nunca sale del dispositivo; en la nube solo se guarda texto cifrado.
 *  - Inicio de sesión con correo y contraseña (Supabase Auth).
 *  - Una fila por usuario en la tabla `vaults` (protegida con RLS).
 *  - Combinación registro por registro: gana el cambio más reciente (`_u`) y
 *    se respetan los borrados (`deleted`). Control de versión optimista para
 *    que dos dispositivos no se pisen.
 *  - Funciona sin conexión: los cambios quedan pendientes y se suben al volver.
 * ========================================================================= */
(function (root) {
  'use strict';

  var CFG_KEY = 'misFinanzas.sync';      // configuración y sesión (no contiene tus datos)
  var KDF_ITER = 310000;
  var COLLECTIONS = ['accounts', 'categories', 'methods', 'transactions', 'investments', 'debts', 'exchanges'];

  // ---------------------------------------------------------------- utilidades
  function b64(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(str) {
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function readCfg() { try { return JSON.parse(root.localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; } }
  function writeCfg(c) { root.localStorage.setItem(CFG_KEY, JSON.stringify(c)); }

  // ---------------------------------------------------------------- cifrado
  async function deriveKey(passphrase, saltB64) {
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: unb64(saltB64), iterations: KDF_ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(obj, key) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { iv: b64(iv), data: b64(data) };
  }
  async function decrypt(row, key) {
    var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv) }, key, unb64(row.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // La clave (no exportable) se guarda en IndexedDB: no hace falta volver a escribir la contraseña.
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('misFinanzas', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('keys'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  async function keyPut(key) {
    var db = await idb();
    return new Promise(function (res, rej) { var t = db.transaction('keys', 'readwrite'); t.objectStore('keys').put(key, 'vault'); t.oncomplete = res; t.onerror = function () { rej(t.error); }; });
  }
  async function keyGet() {
    try {
      var db = await idb();
      return await new Promise(function (res) { var g = db.transaction('keys').objectStore('keys').get('vault'); g.onsuccess = function () { res(g.result || null); }; g.onerror = function () { res(null); }; });
    } catch (e) { return null; }
  }
  async function keyDel() {
    try { var db = await idb(); db.transaction('keys', 'readwrite').objectStore('keys').delete('vault'); } catch (e) { /* nada */ }
  }

  // ---------------------------------------------------------------- Supabase (REST, sin librerías)
  function api(cfg) { return String(cfg.url || '').replace(/\/+$/, ''); }
  async function call(cfg, path, opts) {
    opts = opts || {};
    var headers = Object.assign({ apikey: cfg.anonKey, 'Content-Type': 'application/json' }, opts.headers || {});
    if (opts.auth !== false && cfg.session) headers.Authorization = 'Bearer ' + cfg.session.access_token;
    var r;
    try { r = await fetch(api(cfg) + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
    catch (e) { var off = new Error('Sin conexión'); off.offline = true; throw off; }
    var text = await r.text(), json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* no JSON */ }
    if (!r.ok) {
      var msg = (json && (json.msg || json.message || json.error_description || json.error)) || ('HTTP ' + r.status);
      var err = new Error(translate(msg)); err.status = r.status; throw err;
    }
    return json;
  }
  function translate(m) {
    var map = {
      'Invalid login credentials': 'Correo o contraseña incorrectos',
      'Email not confirmed': 'Confirma tu correo: revisa el enlace que te envió Supabase',
      'User already registered': 'Ese correo ya tiene cuenta: inicia sesión',
      'Password should be at least 6 characters': 'La contraseña debe tener al menos 6 caracteres'
    };
    for (var k in map) if (String(m).indexOf(k) !== -1) return map[k];
    return m;
  }

  function saveSession(cfg, s) {
    cfg.session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: Date.now() + (s.expires_in || 3600) * 1000, user: { id: s.user.id, email: s.user.email } };
    writeCfg(cfg);
  }
  async function ensureSession(cfg) {
    if (!cfg.session) throw new Error('Inicia sesión');
    if (Date.now() < cfg.session.expires_at - 60000) return;
    var s = await call(cfg, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: cfg.session.refresh_token } });
    saveSession(cfg, s);
  }

  // ---------------------------------------------------------------- combinación
  /**
   * Combina dos estados registro por registro (función pura).
   *  - Colecciones con id: gana la versión con `_u` mayor; un borrado gana si es igual o más reciente.
   *  - settings y profile: gana el más reciente (`_u`).
   *  - precios, fotos diarias y metadatos: por clave, el más reciente.
   */
  function merge(local, remote) {
    var out = JSON.parse(JSON.stringify(local));
    var del = Object.assign({}, remote.deleted || {});
    Object.keys(local.deleted || {}).forEach(function (id) { del[id] = Math.max(del[id] || 0, local.deleted[id]); });
    // Las lápidas viejas (> 180 días) se descartan para no crecer sin fin
    var limit = Date.now() - 180 * 86400000;
    Object.keys(del).forEach(function (id) { if (del[id] < limit) delete del[id]; });

    COLLECTIONS.forEach(function (k) {
      var byId = {}, order = [];
      (local[k] || []).concat(remote[k] || []).forEach(function (r) {
        if (!byId[r.id]) order.push(r.id);
        if (!byId[r.id] || (r._u || 0) > (byId[r.id]._u || 0)) byId[r.id] = r;
      });
      out[k] = order.map(function (id) { return byId[id]; }).filter(function (r) { return !(del[r.id] && del[r.id] >= (r._u || 0)); });
    });
    ['settings', 'profile'].forEach(function (k) {
      var a = local[k], b = remote[k];
      out[k] = !a ? b : !b ? a : ((b._u || 0) > (a._u || 0) ? b : a);
    });
    var newest = function (a, b, f) { var x = {}; Object.keys(a || {}).concat(Object.keys(b || {})).forEach(function (key) {
      var va = (a || {})[key], vb = (b || {})[key]; x[key] = !va ? vb : !vb ? va : (f(vb) > f(va) ? vb : va); }); return x; };
    out.prices = newest(local.prices, remote.prices, function (p) { return p.lastAttempt || p.time || 0; });
    out.snapshots = newest(local.snapshots, remote.snapshots, function (p) { return p.at || 0; });
    out.assetMeta = newest(local.assetMeta, remote.assetMeta, function (p) { return p.at || 0; });
    out.deleted = del;
    return out;
  }

  /** ¿El dispositivo solo tiene los datos iniciales (instalación nueva)? */
  function isPristine(s) {
    return !(s.transactions || []).length && !(s.investments || []).length && !(s.debts || []).length &&
      !(s.exchanges || []).length && (s.accounts || []).length <= 1 && !s.profile;
  }

  // ---------------------------------------------------------------- motor
  var app = null;           // { getState, adoptState(state) }
  var running = false, again = false, timer = null;
  var status = { state: 'off', at: null, error: null };
  var listeners = [];
  function setStatus(st, extra) {
    status = Object.assign({ state: st, at: status.at, error: null }, extra || {});
    listeners.forEach(function (f) { try { f(status); } catch (e) { /* nada */ } });
  }

  async function fetchVault(cfg) {
    var rows = await call(cfg, '/rest/v1/vaults?select=*&user_id=eq.' + cfg.session.user.id);
    return rows && rows[0] ? rows[0] : null;
  }

  /** Sincroniza ahora: baja, combina, sube. Seguro de llamar muchas veces. */
  async function syncNow() {
    var cfg = readCfg();
    if (!cfg.enabled || !cfg.session) return;
    if (running) { again = true; return; }
    running = true;
    setStatus('syncing');
    try {
      var key = await keyGet();
      if (!key) throw new Error('Falta la contraseña de cifrado en este dispositivo');
      await ensureSession(cfg);
      for (var attempt = 0; attempt < 3; attempt++) {
        var row = await fetchVault(cfg);
        var local = app.getState();
        var localAtStart = JSON.stringify(local);
        var merged;
        if (!row) throw new Error('No hay datos en la nube: vuelve a activar la sincronización');
        var remote = await decrypt(row, key);
        merged = cfg.adoptRemoteOnce ? remote : merge(local, remote);
        var remoteJson = JSON.stringify(remote), mergedJson = JSON.stringify(merged);
        if (mergedJson !== remoteJson) {
          var enc = await encrypt(merged, key);
          var upd = await call(cfg, '/rest/v1/vaults?user_id=eq.' + cfg.session.user.id + '&version=eq.' + row.version, {
            method: 'PATCH', headers: { Prefer: 'return=representation' },
            body: { iv: enc.iv, data: enc.data, version: row.version + 1, updated_at: new Date().toISOString() }
          });
          if (!upd || !upd.length) continue; // otro dispositivo guardó entre medias: volver a combinar
        }
        // Si registraste algo mientras se sincronizaba, no se pisa: se vuelve a combinar enseguida
        if (JSON.stringify(app.getState()) !== localAtStart) again = true;
        else if (localAtStart !== mergedJson) app.adoptState(merged);
        if (cfg.adoptRemoteOnce) { delete cfg.adoptRemoteOnce; writeCfg(cfg); }
        cfg.lastSync = Date.now(); delete cfg.pending; writeCfg(cfg);
        setStatus('ok', { at: cfg.lastSync });
        return;
      }
      throw new Error('Demasiados cambios simultáneos; se reintentará');
    } catch (e) {
      var c2 = readCfg(); c2.pending = true; writeCfg(c2);
      setStatus(e.offline ? 'offline' : 'error', { error: e.message, at: c2.lastSync });
    } finally {
      running = false;
      if (again) { again = false; schedule(1500); }
    }
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(syncNow, ms == null ? 3000 : ms);
  }

  // ---------------------------------------------------------------- configuración (pasos de la interfaz)
  async function signUp(email, password) {
    var cfg = readCfg();
    var r = await call(cfg, '/auth/v1/signup', { method: 'POST', auth: false, body: { email: email, password: password } });
    if (r && r.access_token) { saveSession(cfg, r); return { session: true }; }
    return { session: false }; // requiere confirmar el correo
  }
  async function signIn(email, password) {
    var cfg = readCfg();
    var r = await call(cfg, '/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: email, password: password } });
    saveSession(cfg, r);
  }
  async function signOut() {
    var cfg = readCfg();
    try { if (cfg.session) await call(cfg, '/auth/v1/logout', { method: 'POST' }); } catch (e) { /* sin conexión: igual se cierra local */ }
    delete cfg.session; cfg.enabled = false; delete cfg.lastSync; delete cfg.pending;
    writeCfg(cfg); await keyDel();
    setStatus('off');
  }
  /** ¿Ya existe una bóveda en la nube para esta cuenta? */
  async function vaultExists() {
    var cfg = readCfg(); await ensureSession(cfg);
    return !!(await fetchVault(cfg));
  }
  /**
   * Activa la sincronización en este dispositivo.
   *  - Primera vez (sin bóveda): crea la bóveda cifrada con los datos de este dispositivo.
   *  - Bóveda existente: verifica la contraseña y, según `mode`, combina ('merge') o reemplaza ('replace') lo local.
   */
  async function enable(passphrase, mode) {
    var cfg = readCfg(); await ensureSession(cfg);
    var row = await fetchVault(cfg);
    var key;
    if (!row) {
      var salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      key = await deriveKey(passphrase, salt);
      var enc = await encrypt(app.getState(), key);
      await call(cfg, '/rest/v1/vaults', { method: 'POST', headers: { Prefer: 'return=representation' },
        body: { user_id: cfg.session.user.id, salt: salt, iv: enc.iv, data: enc.data, version: 1 } });
    } else {
      key = await deriveKey(passphrase, row.salt);
      try { await decrypt(row, key); } catch (e) { throw new Error('Contraseña de cifrado incorrecta'); }
      if (mode === 'replace' || isPristine(app.getState())) cfg.adoptRemoteOnce = true;
    }
    await keyPut(key);
    cfg.enabled = true; writeCfg(cfg);
    await syncNow();
  }

  function configure(url, anonKey) {
    var cfg = readCfg();
    cfg.url = String(url || '').trim(); cfg.anonKey = String(anonKey || '').trim();
    writeCfg(cfg);
  }

  /** Engancha la sincronización a la app: al guardar, al abrir, al volver la conexión y cada minuto. */
  function init(hooks) {
    app = hooks;
    var cfg = readCfg();
    // Valores por defecto desde config.js (para que el móvil no tenga que escribirlos)
    if ((!cfg.url || !cfg.anonKey) && root.APP_CONFIG && root.APP_CONFIG.supabaseUrl) {
      cfg.url = root.APP_CONFIG.supabaseUrl; cfg.anonKey = root.APP_CONFIG.supabaseAnonKey; writeCfg(cfg);
    }
    if (cfg.enabled) setStatus(cfg.pending ? 'pending' : 'ok', { at: cfg.lastSync || null });
    root.Store.onSave = function () { if (readCfg().enabled) { var c = readCfg(); c.pending = true; writeCfg(c); setStatus('pending', { at: c.lastSync }); schedule(3000); } };
    root.addEventListener('online', function () { schedule(500); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') schedule(500); });
    setInterval(function () { if (document.visibilityState === 'visible') syncNow(); }, 60000);
    if (cfg.enabled) schedule(800);
  }

  root.Sync = {
    init: init, configure: configure, signUp: signUp, signIn: signIn, signOut: signOut, vaultExists: vaultExists,
    enable: enable, syncNow: syncNow, merge: merge, isPristine: isPristine,
    config: readCfg, status: function () { return status; }, onStatus: function (f) { listeners.push(f); },
    // expuestos para pruebas
    _crypto: { deriveKey: deriveKey, encrypt: encrypt, decrypt: decrypt }
  };
})(this);
