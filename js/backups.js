/* =========================================================================
 * backups.js — Copias automáticas de tus datos en ESTE dispositivo.
 *
 *  - Se guardan en IndexedDB (base `misFinanzasVersiones`), aparte de los datos
 *    en uso: si algo sale mal, se vuelve a una versión anterior en un toque.
 *  - Automática: como máximo una cada 6 h mientras usas la app.
 *  - Preventiva: justo antes de restaurar, cargar ejemplo, borrar todo,
 *    recibir datos o cualquier cambio grande.
 *  - Se conservan las 10 más recientes (`keepLocal`).
 *  Las reglas de retención son funciones puras (probadas en tests/index.html).
 * ========================================================================= */
(function (root) {
  'use strict';

  var DB = 'misFinanzasVersiones', STORE = 'versions';
  var AUTO_EVERY = 6 * 3600 * 1000;
  var KEEP_LOCAL = 10;

  // ---------------------------------------------------------------- reglas (puras)
  /** Resumen legible de un estado: cuántos registros tiene. */
  function summarize(state) {
    var n = function (k) { return (state[k] || []).length; };
    return { accounts: n('accounts'), transactions: n('transactions'), investments: n('investments'), debts: n('debts'), exchanges: n('exchanges') };
  }

  /** Versiones locales: se conservan las `keep` más recientes. Devuelve los ids a borrar. */
  function pruneLocal(list, keep) {
    keep = keep || KEEP_LOCAL;
    return list.slice().sort(function (a, b) { return b.at - a.at; }).slice(keep).map(function (v) { return v.id; });
  }

  /**
   * Versiones en la nube: se conservan las `recent` más recientes y, además, la más reciente de cada día
   * de los últimos `days` días. Devuelve los ids a borrar.
   */
  function pruneCloud(list, now, recent, days) {
    recent = recent || 20; days = days || 30;
    var sorted = list.slice().sort(function (a, b) { return b.at - a.at; });
    var keep = {};
    sorted.slice(0, recent).forEach(function (v) { keep[v.id] = true; });
    var seenDay = {}, limit = now - days * 86400000;
    sorted.forEach(function (v) {
      if (v.at < limit) return;
      var day = new Date(v.at).toISOString().slice(0, 10);
      if (!seenDay[day]) { seenDay[day] = true; keep[v.id] = true; }
    });
    return sorted.filter(function (v) { return !keep[v.id]; }).map(function (v) { return v.id; });
  }

  /** ¿Toca una copia automática? */
  function isDue(lastAt, now, every) { return !lastAt || now - lastAt >= (every || AUTO_EVERY); }

  // ---------------------------------------------------------------- IndexedDB
  function open() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, mode), out;
        out = fn(t.objectStore(STORE));
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function all() {
    return tx('readonly', function (s) { return s.getAll(); }).then(function (r) { return r || []; });
  }

  // ---------------------------------------------------------------- API
  /** Guarda una versión ahora. `reason`: texto corto («automática», «antes de restaurar»…). */
  async function save(state, reason) {
    var rec = { at: Date.now(), reason: reason || 'manual', counts: summarize(state), data: JSON.stringify(state) };
    await tx('readwrite', function (s) { return s.add(rec); });
    var list = await all();
    var drop = pruneLocal(list);
    if (drop.length) await tx('readwrite', function (s) { drop.forEach(function (id) { s.delete(id); }); });
    return rec.at;
  }

  /** Copia automática si pasaron 6 h desde la última. */
  async function auto(state) {
    try {
      var list = await all();
      var last = list.reduce(function (m, v) { return Math.max(m, v.at); }, 0);
      if (isDue(last, Date.now())) await save(state, 'automática');
    } catch (e) { /* sin IndexedDB (modo privado del navegador): no se guarda copia */ }
  }

  /** Lista sin los datos (para mostrarla), de la más reciente a la más antigua. */
  async function list() {
    var l = await all();
    return l.map(function (v) { return { id: v.id, at: v.at, reason: v.reason, counts: v.counts }; })
      .sort(function (a, b) { return b.at - a.at; });
  }

  async function get(id) {
    var v = await tx('readonly', function (s) { return s.get(Number(id)); });
    return v ? JSON.parse(v.data) : null;
  }

  root.Backups = {
    save: save, auto: auto, list: list, get: get,
    // reglas puras (para pruebas y para la nube)
    summarize: summarize, pruneLocal: pruneLocal, pruneCloud: pruneCloud, isDue: isDue
  };
})(this);
