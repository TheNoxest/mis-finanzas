/* =========================================================================
 * app/bloqueo.js — Pantalla de bloqueo (PIN y huella / Face ID) y su tarjeta en Ajustes.
 * La lógica y el PIN cifrado están en js/lock.js (global Lock). Por dispositivo, no se sincroniza.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

var lockHiddenAt = null;    // cuándo pasó la app a segundo plano
var lockSetup = null;       // tarjeta de Ajustes: null | 'new' (crear PIN) | 'change' | 'off' (pedir PIN para desactivar)
var LOCK_AFTER = [[0, 'Siempre al salir de la app'], [1, 'Tras 1 minuto fuera'], [5, 'Tras 5 minutos fuera'], [15, 'Tras 15 minutos fuera'], [30, 'Tras 30 minutos fuera']];

function isLocked() { return document.documentElement.classList.contains('locked'); }
function lockNow() {
  var c = Lock.read();
  if (!c.enabled) return;
  $$('dialog[open]').forEach(function (d) { try { d.close(); } catch (e) { /* nada */ } });
  if (document.activeElement) document.activeElement.blur();
  document.documentElement.classList.add('locked');
  renderLockScreen();
}
function unlockApp() {
  document.documentElement.classList.remove('locked');
  $('#lock-pin').value = ''; $('#lock-msg').textContent = ''; $('#lock-reset').classList.add('hidden');
  lockHiddenAt = null;
}
function renderLockScreen() {
  var c = Lock.read();
  $('#lock-pin').value = '';
  $('#lock-reset').classList.add('hidden');
  showLockWait(c);
  Lock.bioAvailable().then(function (ok) {
    var useBio = ok && !!c.bio;
    $('#lock-bio').classList.toggle('hidden', !useBio);
    // Se intenta abrir la huella sola; si el navegador pide un toque, queda el botón
    if (useBio && document.visibilityState === 'visible') tryBioUnlock(true);
    else setTimeout(function () { if (isLocked()) $('#lock-pin').focus(); }, 50);
  });
}
function showLockWait(c) {
  var wait = c.until ? c.until - Date.now() : 0;
  if (wait > 0) {
    $('#lock-msg').textContent = 'Demasiados intentos. Espera ' + Math.ceil(wait / 1000) + ' s.';
    setTimeout(function () { if (isLocked()) showLockWait(Lock.read()); }, 1000);
  } else if (/Espera/.test($('#lock-msg').textContent)) $('#lock-msg').textContent = '';
}
function tryBioUnlock(silent) {
  Lock.bioUnlock().then(function () { unlockApp(); }).catch(function () {
    if (!silent) $('#lock-msg').textContent = 'No se pudo con la huella / Face ID. Escribe tu PIN.';
    $('#lock-pin').focus();
  });
}
function submitLockPin() {
  var pin = $('#lock-pin').value.trim();
  if (!pin) return;
  Lock.checkPin(pin).then(function (r) {
    if (r.ok) { unlockApp(); return; }
    $('#lock-pin').value = '';
    if (r.wait > 0) showLockWait(Lock.read());
    else $('#lock-msg').textContent = 'PIN incorrecto' + (r.fails ? ' (' + r.fails + ' de 5 intentos antes de esperar)' : '');
    $('#lock-pin').focus();
  });
}
/** «Olvidé mi PIN»: la única salida es borrar los datos de ESTE dispositivo (y su sesión y clave de la nube). */
async function wipeDevice() {
  var syncOn = !!(Sync.config && Sync.config().enabled);
  if (!confirm(syncOn ? 'Se borrarán los datos de ESTE dispositivo y se cerrará la sesión. Tus datos siguen en la nube: vuelven al iniciar sesión con tu cuenta y tu contraseña de cifrado. ¿Continuar?'
    : 'Se borrarán TODOS los datos de este dispositivo. La sincronización no está activa: si no tienes una copia de seguridad, se perderán. ¿Continuar?')) return;
  if (!syncOn && !confirm('Última confirmación: ¿borrar todos los datos de la app en este dispositivo?')) return;
  try { await Sync.signOut(); } catch (e) { /* sin conexión: igual se borra lo local */ }
  S.clear();
  ['misFinanzasDatos', 'misFinanzasVersiones', 'misFinanzas'].forEach(function (n) { try { indexedDB.deleteDatabase(n); } catch (e) { /* nada */ } });
  try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('misFinanzas') === 0) localStorage.removeItem(k); }); } catch (e) { /* nada */ }
  location.reload();
}

// ---- Tarjeta de Ajustes
function renderLockCard() {
  var box = $('#lock-body'); if (!box) return;
  var c = Lock.read(), on = !!c.enabled;
  $('#lock-on').checked = on || lockSetup === 'new';
  var html = '';
  if (lockSetup === 'new' || lockSetup === 'change') {
    html += '<div class="lock-setup grid">' +
      (lockSetup === 'change' ? '<label class="span2">PIN actual<input type="password" inputmode="numeric" autocomplete="off" maxlength="8" id="ls-old"></label>' : '') +
      '<label>PIN nuevo (4 a 8 números)<input type="password" inputmode="numeric" autocomplete="off" maxlength="8" id="ls-pin"></label>' +
      '<label>Repite el PIN<input type="password" inputmode="numeric" autocomplete="off" maxlength="8" id="ls-pin2"></label>' +
      '<div class="span2 btn-row"><button type="button" class="primary" data-action="lock-save">Guardar PIN</button><button type="button" class="ghost" data-action="lock-cancel">Cancelar</button></div></div>';
  } else if (lockSetup === 'off') {
    html += '<div class="lock-setup grid"><label class="span2">Escribe tu PIN para quitar el bloqueo<input type="password" inputmode="numeric" autocomplete="off" maxlength="8" id="ls-old"></label>' +
      '<div class="span2 btn-row"><button type="button" class="danger" data-action="lock-off">Quitar bloqueo</button><button type="button" class="ghost" data-action="lock-cancel">Cancelar</button></div></div>';
  } else if (on) {
    html += '<label class="lock-row">Bloquear<select id="lock-after">' + LOCK_AFTER.map(function (o) { return '<option value="' + o[0] + '"' + (Number(c.after || 0) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="switch hidden" id="lock-bio-row"><input type="checkbox" id="lock-bio-on"' + (c.bio ? ' checked' : '') + '> <span>Desbloquear con huella / Face ID</span></label>' +
      '<div class="btn-row"><button type="button" data-action="lock-change">Cambiar PIN</button><button type="button" data-action="lock-now">Bloquear ahora</button></div>';
  }
  box.innerHTML = html;
  if (on && !lockSetup) Lock.bioAvailable().then(function (ok) { var r = $('#lock-bio-row'); if (r) r.classList.toggle('hidden', !ok); });
  var f = $('#ls-old') || $('#ls-pin'); if (f) setTimeout(function () { f.focus(); }, 0);
}
async function lockSavePin() {
  var c = Lock.read(), p1 = ($('#ls-pin') || {}).value || '', p2 = ($('#ls-pin2') || {}).value || '';
  if (lockSetup === 'change') {
    var r = await Lock.checkPin(($('#ls-old') || {}).value || '');
    if (!r.ok) { toast(r.wait > 0 ? 'Demasiados intentos: espera un momento' : 'El PIN actual no es correcto'); return; }
  }
  if (!Lock.validPin(p1)) { toast('El PIN debe tener de 4 a 8 números'); return; }
  if (p1 !== p2) { toast('Los dos PIN no coinciden'); return; }
  var first = !c.enabled;
  await Lock.setPin(p1);
  lockSetup = null; renderLockCard();
  toast(first ? 'Bloqueo activado: se pedirá el PIN al abrir la app' : 'PIN cambiado');
  if (first) Lock.bioAvailable().then(function (ok) { if (ok) toast('Puedes activar también la huella / Face ID aquí abajo'); });
}
async function lockTurnOff() {
  var r = await Lock.checkPin(($('#ls-old') || {}).value || '');
  if (!r.ok) { toast(r.wait > 0 ? 'Demasiados intentos: espera un momento' : 'PIN incorrecto'); return; }
  Lock.disable(); lockSetup = null; renderLockCard(); toast('Bloqueo desactivado');
}

// ---- Eventos (el HTML ya existe al cargar)
(function bindLock() {
  // Mientras está bloqueada, nada fuera de la pantalla de bloqueo recibe clics ni teclas
  ['click', 'keydown', 'submit', 'focusin'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (isLocked() && !e.target.closest('#lock-screen')) { e.stopPropagation(); if (ev !== 'focusin') e.preventDefault(); else if (e.target.blur) e.target.blur(); }
    }, true);
  });
  $('#lock-form').addEventListener('submit', function (e) { e.preventDefault(); submitLockPin(); });
  $('#lock-bio').addEventListener('click', function () { tryBioUnlock(false); });
  $('#lock-forgot').addEventListener('click', function () { $('#lock-reset').classList.toggle('hidden'); });
  $('#lock-wipe').addEventListener('click', wipeDevice);
  // Segundo plano: «siempre al salir» bloquea ya (así tampoco se ve en el selector de apps); si no, al volver
  document.addEventListener('visibilitychange', function () {
    var c = Lock.read();
    if (!c.enabled) return;
    if (document.visibilityState === 'hidden') { if (!isLocked()) { lockHiddenAt = Date.now(); if (!Number(c.after)) lockNow(); } }
    else if (!isLocked() && Lock.shouldLock(c, lockHiddenAt, Date.now())) lockNow();
    else if (isLocked()) renderLockScreen();
  });
  // Ajustes
  $('#lock-on').addEventListener('change', function (e) {
    var on = Lock.read().enabled;
    if (e.target.checked && !on) lockSetup = 'new';
    else if (!e.target.checked && on) lockSetup = 'off';
    else lockSetup = null;
    renderLockCard();
  });
  $('#lock-card').addEventListener('change', function (e) {
    if (e.target.id === 'lock-after') { var c = Lock.read(); c.after = Number(e.target.value); Lock.write(c); toast('Guardado'); }
    if (e.target.id === 'lock-bio-on') {
      if (e.target.checked) Lock.bioRegister().then(function () { toast('Huella / Face ID activada'); renderLockCard(); })
        .catch(function () { toast('No se pudo activar la huella / Face ID en este dispositivo'); e.target.checked = false; });
      else { Lock.bioRemove(); toast('Huella / Face ID desactivada: se usará solo el PIN'); }
    }
  });
  $('#lock-card').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-action]'); if (!b) return;
    var a = b.dataset.action;
    if (a.indexOf('lock-') !== 0) return;
    e.stopPropagation();
    if (a === 'lock-save') lockSavePin();
    else if (a === 'lock-off') lockTurnOff();
    else if (a === 'lock-cancel') { lockSetup = null; renderLockCard(); }
    else if (a === 'lock-change') { lockSetup = 'change'; renderLockCard(); }
    else if (a === 'lock-now') lockNow();
  });
  $('#lock-card').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.matches('#lock-card input')) return;
    e.preventDefault();
    if (lockSetup === 'off') lockTurnOff(); else if (lockSetup) lockSavePin();
  });
  // Al abrir la app: si está activado, la pantalla de bloqueo ya se mostró desde <head> (clase «locked»)
  if (isLocked()) renderLockScreen();
})();
