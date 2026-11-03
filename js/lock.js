/* =========================================================================
 * lock.js — Bloqueo de la app en este dispositivo (PIN y huella / Face ID).
 * El PIN nunca se guarda: solo su huella PBKDF2-SHA256 con sal aleatoria. La huella / Face ID usa el
 * autenticador del dispositivo (WebAuthn, verificación del usuario obligatoria) como llave local.
 * No cifra los datos: es una puerta para que nadie abra la app en tu teléfono sin ti.
 * Configuración en localStorage['misFinanzas.lock'] (por dispositivo, no se sincroniza).
 * ========================================================================= */
(function (root) {
  'use strict';

  var KEY = 'misFinanzas.lock';
  var ITER = 150000;

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function unhex(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function b64(buf) { var s = ''; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); }
  function unb64(t) { var s = atob(t), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function random(n) { var a = new Uint8Array(n); root.crypto.getRandomValues(a); return a; }

  // ---------------------------------------------------------------- reglas (puras, probadas)
  /** PIN válido: de 4 a 8 números. */
  function validPin(pin) { return /^\d{4,8}$/.test(String(pin || '')); }
  /**
   * ¿Hay que bloquear al volver a la app? after = minutos en segundo plano (0 = siempre al salir).
   * hiddenAt = cuándo se ocultó (ms) o null si no se ocultó.
   */
  function shouldLock(cfg, hiddenAt, now) {
    if (!cfg || !cfg.enabled || !hiddenAt) return false;
    return now - hiddenAt >= (Number(cfg.after) || 0) * 60000;
  }
  /** Espera tras fallar el PIN: desde el 5.º intento 30 s, y se duplica con cada fallo más (máx. 15 min). */
  function lockoutMs(fails) {
    if (fails < 5) return 0;
    return Math.min(30000 * Math.pow(2, fails - 5), 15 * 60000);
  }

  // ---------------------------------------------------------------- PIN
  function hashPin(pin, saltHex, iter) {
    var enc = new TextEncoder();
    return root.crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']).then(function (k) {
      return root.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: iter || ITER }, k, 256);
    }).then(hex);
  }
  function newSalt() { return hex(random(16)); }

  // ---------------------------------------------------------------- configuración del dispositivo
  function read() { try { return JSON.parse(root.localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function write(c) { try { root.localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* sin almacenamiento */ } }
  /** Activa el bloqueo (o cambia el PIN). */
  function setPin(pin) {
    var c = read(), salt = newSalt();
    return hashPin(pin, salt, ITER).then(function (h) {
      c.enabled = true; c.salt = salt; c.hash = h; c.iter = ITER; c.fails = 0; c.until = 0;
      if (c.after == null) c.after = 0;
      write(c); return c;
    });
  }
  /** Comprueba el PIN, cuenta los fallos y aplica la espera. → {ok, wait (ms)} */
  function checkPin(pin) {
    var c = read(), now = Date.now();
    if (c.until && now < c.until) return Promise.resolve({ ok: false, wait: c.until - now });
    return hashPin(pin, c.salt, c.iter).then(function (h) {
      if (h === c.hash) { c.fails = 0; c.until = 0; write(c); return { ok: true, wait: 0 }; }
      c.fails = (c.fails || 0) + 1;
      var w = lockoutMs(c.fails);
      c.until = w ? now + w : 0;
      write(c);
      return { ok: false, wait: w, fails: c.fails };
    });
  }
  function disable() { write({ after: read().after || 0 }); }

  // ---------------------------------------------------------------- huella / Face ID (WebAuthn)
  function bioAvailable() {
    var P = root.PublicKeyCredential;
    if (!P || !P.isUserVerifyingPlatformAuthenticatorAvailable || !root.isSecureContext) return Promise.resolve(false);
    return P.isUserVerifyingPlatformAuthenticatorAvailable().catch(function () { return false; });
  }
  function bioRegister() {
    return root.navigator.credentials.create({ publicKey: {
      challenge: random(32), rp: { name: 'Mis Finanzas' },
      user: { id: random(16), name: 'mis-finanzas', displayName: 'Mis Finanzas' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none'
    } }).then(function (cred) {
      var c = read(); c.bio = b64(cred.rawId); write(c); return true;
    });
  }
  /** Pide la huella / Face ID; se acepta solo si el dispositivo verificó al usuario (bit UV). */
  function bioUnlock() {
    var c = read();
    if (!c.bio) return Promise.reject(new Error('Sin huella registrada'));
    return root.navigator.credentials.get({ publicKey: {
      challenge: random(32), allowCredentials: [{ type: 'public-key', id: unb64(c.bio), transports: ['internal'] }],
      userVerification: 'required', timeout: 60000
    } }).then(function (a) {
      var data = a && a.response && a.response.authenticatorData ? new Uint8Array(a.response.authenticatorData) : null;
      if (!data || !(data[32] & 0x04)) throw new Error('No se verificó la identidad');
      c = read(); c.fails = 0; c.until = 0; write(c);
      return true;
    });
  }
  function bioRemove() { var c = read(); delete c.bio; write(c); }

  root.Lock = {
    KEY: KEY, validPin: validPin, shouldLock: shouldLock, lockoutMs: lockoutMs, hashPin: hashPin, newSalt: newSalt,
    read: read, write: write, setPin: setPin, checkPin: checkPin, disable: disable,
    bioAvailable: bioAvailable, bioRegister: bioRegister, bioUnlock: bioUnlock, bioRemove: bioRemove
  };
})(this);
