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
  var COLLECTIONS = ['accounts', 'categories', 'methods', 'transactions', 'investments', 'debts', 'exchanges', 'sales', 'loans'];

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
  /**
   * Guarda la configuración SIN pisar una sesión más nueva: otra pestaña (o una llamada en paralelo) puede haber
   * renovado la sesión mientras esta tenía la vieja en memoria. Volver a guardar el refresh token viejo hacía que
   * Supabase detectara su reutilización y cerrara la sesión («Invalid Refresh Token»).
   * dropSession = true solo al cerrar sesión o cuando la sesión ya no vale.
   */
  function writeCfg(c, dropSession) {
    var cur = readCfg();
    if (!dropSession && cur.session && (!c.session || (cur.session.expires_at || 0) > (c.session.expires_at || 0))) c.session = cur.session;
    // Una sesión que Supabase ya rechazó no puede «revivir» desde una copia vieja en memoria
    if (cur.deadRefresh && !c.deadRefresh) c.deadRefresh = cur.deadRefresh;
    if (cur.lastUser && !c.lastUser) c.lastUser = cur.lastUser;
    if (c.session && c.deadRefresh && c.session.refresh_token === c.deadRefresh) delete c.session;
    root.localStorage.setItem(CFG_KEY, JSON.stringify(c));
  }
  /** ¿Supabase rechazó el refresh token? (sesión cerrada, caducada o revocada) */
  function deadSession(e) {
    return !!e && !e.offline && (e.status === 400 || e.status === 401 || e.status === 403) &&
      /refresh.?token|invalid_grant|session.*(not found|expired)/i.test(e.message || '');
  }
  var NEED_LOGIN = 'Tu sesión se cerró: vuelve a iniciar sesión para seguir sincronizando. Tus datos están a salvo en este dispositivo.';

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
  /** Toma la sesión guardada si es más nueva que la que esta llamada tiene en memoria. */
  function adoptStoredSession(cfg) {
    var s = readCfg().session;
    if (s && (!cfg.session || (s.expires_at || 0) > (cfg.session.expires_at || 0))) cfg.session = s;
  }
  var refreshing = null; // una sola renovación a la vez dentro de esta pestaña
  async function ensureSession(cfg) {
    adoptStoredSession(cfg);
    if (!cfg.session) { var ne = new Error(NEED_LOGIN); ne.needLogin = true; throw ne; }
    if (Date.now() < cfg.session.expires_at - 60000) return;
    if (!refreshing) {
      var run = async function () {
        var c = readCfg();
        // Otra pestaña pudo renovarla mientras esperábamos el candado
        if (c.session && Date.now() < c.session.expires_at - 60000) return;
        if (!c.session) { var ne2 = new Error(NEED_LOGIN); ne2.needLogin = true; throw ne2; }
        try {
          var s = await call(c, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: c.session.refresh_token } });
          saveSession(c, s);
        } catch (e) {
          if (!deadSession(e)) throw e;
          // La sesión ya no vale: se olvida (los datos y la clave de cifrado se quedan) y se pide entrar de nuevo
          var d = readCfg();
          if (d.session && d.session.refresh_token === c.session.refresh_token) {
            d.lastUser = d.session.user; d.deadRefresh = d.session.refresh_token; delete d.session; d.pending = true; writeCfg(d, true);
          }
          var ne3 = new Error(NEED_LOGIN); ne3.needLogin = true; throw ne3;
        }
      };
      // Candado entre pestañas (si el navegador lo permite) para no gastar el mismo refresh token dos veces
      refreshing = (root.navigator && navigator.locks ? navigator.locks.request('misFinanzas-auth', run) : run())
        .finally(function () { refreshing = null; });
    }
    await refreshing;
    adoptStoredSession(cfg);
    if (!cfg.session) { var ne4 = new Error(NEED_LOGIN); ne4.needLogin = true; throw ne4; }
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
      !(s.exchanges || []).length && !(s.sales || []).length && !(s.loans || []).length && (s.accounts || []).length <= 1 && !s.profile;
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
    if (!cfg.enabled) return;
    if (!cfg.session) { setStatus('login', { error: NEED_LOGIN, at: cfg.lastSync || null }); return; }
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
        await autoCloudVersion(cfg, key, merged); // nunca hace fallar la sincronización
        setStatus('ok', { at: cfg.lastSync });
        return;
      }
      throw new Error('Demasiados cambios simultáneos; se reintentará');
    } catch (e) {
      var c2 = readCfg(); c2.pending = true; writeCfg(c2);
      setStatus(e.needLogin ? 'login' : e.offline ? 'offline' : 'error', { error: e.message, at: c2.lastSync });
    } finally {
      running = false;
      if (again) { again = false; schedule(1500); }
    }
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(syncNow, ms == null ? 3000 : ms);
  }

  // ---------------------------------------------------------------- versiones en la nube
  // Tabla `vault_versions` (supabase/versions.sql): copias cifradas igual que la bóveda.
  // Una automática cada 6 h como máximo; retención = 20 recientes + 1 por día de los últimos 30 días.
  var VERSION_EVERY = 6 * 3600 * 1000;
  function versionsMissing(e) {
    return !!e && (e.status === 404 || /vault_versions|42P01|does not exist|schema cache/i.test(e.message || ''));
  }
  async function pruneCloudVersions(cfg) {
    var rows = await call(cfg, '/rest/v1/vault_versions?select=id,created_at&user_id=eq.' + cfg.session.user.id + '&order=created_at.desc');
    var drop = root.Backups.pruneCloud((rows || []).map(function (r) { return { id: r.id, at: Date.parse(r.created_at) }; }), Date.now());
    if (drop.length) await call(cfg, '/rest/v1/vault_versions?id=in.(' + drop.join(',') + ')', { method: 'DELETE' });
  }
  async function saveCloudVersion(cfg, key, state, reason) {
    var enc = await encrypt(state, key);
    await call(cfg, '/rest/v1/vault_versions', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: { user_id: cfg.session.user.id, reason: reason, iv: enc.iv, data: enc.data } });
    cfg.lastVersionAt = Date.now(); delete cfg.versionsMissing; writeCfg(cfg);
    await pruneCloudVersions(cfg);
  }
  async function autoCloudVersion(cfg, key, state) {
    if (cfg.versionsMissing && Date.now() - cfg.versionsMissing < 3600000) return; // tabla aún no creada: reintentar en 1 h
    if (!root.Backups || !root.Backups.isDue(cfg.lastVersionAt, Date.now(), VERSION_EVERY)) return;
    try { await saveCloudVersion(cfg, key, state, 'automática'); }
    catch (e) { if (versionsMissing(e)) { cfg.versionsMissing = Date.now(); writeCfg(cfg); } }
  }
  /** Lista de versiones (sin datos). Lanza un error con `.missing = true` si falta la tabla. */
  async function listCloudVersions() {
    var cfg = readCfg(); await ensureSession(cfg);
    try {
      var rows = await call(cfg, '/rest/v1/vault_versions?select=id,created_at,reason&user_id=eq.' + cfg.session.user.id + '&order=created_at.desc');
      return (rows || []).map(function (r) { return { id: r.id, at: Date.parse(r.created_at), reason: r.reason }; });
    } catch (e) { if (versionsMissing(e)) e.missing = true; throw e; }
  }
  /** Descarga y descifra una versión. */
  async function getCloudVersion(id) {
    var cfg = readCfg(); await ensureSession(cfg);
    var key = await keyGet();
    if (!key) throw new Error('Falta la contraseña de cifrado en este dispositivo');
    var rows = await call(cfg, '/rest/v1/vault_versions?select=*&id=eq.' + encodeURIComponent(id));
    if (!rows || !rows[0]) throw new Error('Esa versión ya no existe');
    return decrypt(rows[0], key);
  }
  /** Guarda ya una versión en la nube con los datos actuales. */
  async function saveVersionNow(reason) {
    var cfg = readCfg(); await ensureSession(cfg);
    var key = await keyGet();
    if (!key) throw new Error('Falta la contraseña de cifrado en este dispositivo');
    try { await saveCloudVersion(cfg, key, app.getState(), reason || 'manual'); }
    catch (e) { if (versionsMissing(e)) e.missing = true; throw e; }
  }

  // ---------------------------------------------------------------- recuperar contraseña y enlaces del correo
  /** Envía el correo para restablecer la contraseña de la CUENTA (no la de cifrado). */
  async function recover(email) {
    var cfg = readCfg();
    var back = (root.APP_CONFIG && root.APP_CONFIG.publicUrl) || (location.origin + location.pathname);
    await call(cfg, '/auth/v1/recover?redirect_to=' + encodeURIComponent(back), { method: 'POST', auth: false, body: { email: email } });
  }
  /** ¿La dirección trae un enlace del correo de Supabase? (#access_token=…&type=… o #error=…) */
  function hasAuthRedirect() { return /(^|[#&])(access_token|error_description)=/.test(location.hash); }
  /**
   * Procesa el enlace del correo: confirma la cuenta o abre la sesión para cambiar la contraseña.
   * Devuelve { type: 'signup' | 'recovery' | 'magiclink' | 'error', message? } o null.
   */
  async function handleAuthRedirect() {
    if (!hasAuthRedirect()) return null;
    var p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search + '#ajustes'); // no dejar el token en la barra
    if (p.get('error_description')) return { type: 'error', message: p.get('error_description').replace(/\+/g, ' ') };
    var cfg = readCfg();
    var tok = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: Number(p.get('expires_in')) || 3600 };
    var user = await call(Object.assign({}, cfg, { session: { access_token: tok.access_token } }), '/auth/v1/user');
    saveSession(cfg, Object.assign(tok, { user: user }));
    return { type: p.get('type') || 'signup' };
  }
  /** Cambia la contraseña de la cuenta (tras el enlace de recuperación o con la sesión abierta). */
  async function updatePassword(password) {
    var cfg = readCfg(); await ensureSession(cfg);
    await call(cfg, '/auth/v1/user', { method: 'PUT', body: { password: password } });
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
    // Otra cuenta distinta de la que estaba conectada: la clave de cifrado guardada no le sirve
    var other = cfg.enabled && cfg.lastUser && r.user && cfg.lastUser.id !== r.user.id;
    if (other) { cfg.enabled = false; await keyDel(); }
    delete cfg.lastUser;
    saveSession(cfg, r);
    // Si la sincronización ya estaba activa (sesión caducada), sigue sola sin pedir la contraseña de cifrado
    if (cfg.enabled) { setStatus('pending', { at: cfg.lastSync || null }); schedule(300); }
  }
  async function signOut() {
    var cfg = readCfg();
    // scope=local: cierra solo ESTE dispositivo (sin «local» Supabase cerraba también el PC/móvil)
    try { if (cfg.session) await call(cfg, '/auth/v1/logout?scope=local', { method: 'POST' }); } catch (e) { /* sin conexión: igual se cierra local */ }
    delete cfg.session; delete cfg.lastUser; delete cfg.deadRefresh; cfg.enabled = false; delete cfg.lastSync; delete cfg.pending;
    writeCfg(cfg, true); await keyDel();
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
    if (cfg.enabled) setStatus(!cfg.session ? 'login' : cfg.pending ? 'pending' : 'ok', { at: cfg.lastSync || null, error: cfg.session ? null : NEED_LOGIN });
    root.Store.onSave = function () { if (readCfg().enabled) { var c = readCfg(); c.pending = true; writeCfg(c); setStatus('pending', { at: c.lastSync }); schedule(3000); } };
    root.addEventListener('online', function () { schedule(500); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') schedule(500); });
    setInterval(function () { if (document.visibilityState === 'visible') syncNow(); }, 60000);
    if (cfg.enabled) schedule(800);
  }

  root.Sync = {
    init: init, configure: configure, signUp: signUp, signIn: signIn, signOut: signOut, vaultExists: vaultExists,
    enable: enable, syncNow: syncNow, merge: merge, isPristine: isPristine,
    listCloudVersions: listCloudVersions, getCloudVersion: getCloudVersion, saveVersionNow: saveVersionNow,
    recover: recover, hasAuthRedirect: hasAuthRedirect, handleAuthRedirect: handleAuthRedirect, updatePassword: updatePassword,
    config: readCfg, status: function () { return status; }, onStatus: function (f) { listeners.push(f); },
    // expuestos para pruebas
    _crypto: { deriveKey: deriveKey, encrypt: encrypt, decrypt: decrypt },
    _auth: { deadSession: deadSession, writeCfg: writeCfg, ensureSession: ensureSession }
  };
})(this);
