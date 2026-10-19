/* =========================================================================
 * app/init.js — Arranque de la app y paso de datos desde la versión anterior. Se carga ÚLTIMO.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ init
bind();
$('#f-month').value = thisMonth();
$('#lg-month').value = thisMonth();
if (uiPrefs().histScope === 'all') $('#hs-all').checked = true;
applyPrivacy();
resetTxForm();
resetInvForm();
resetAccForm();
resetDebtForm();
resetFxForm();
$('#fx-month').value = thisMonth();
$('#sale-month').value = thisMonth();
resetSaleForm();
resetLoanForm();
renderAll();
if (!state.investments.length) $('#inv-details').open = true;
var receiveMode = location.hash === '#recibir' && !!window.opener;   // abierta por la versión anterior para recibir datos
var authLink = Sync.hasAuthRedirect();                                  // enlace del correo de Supabase
showView(receiveMode ? 'inicio' : authLink ? 'ajustes' : (location.hash.slice(1) || 'inicio'));
recordSnapshot();
S.save(state); // guarda la migración si la hubo
Sync.onStatus(function (st) { renderSyncDot(); if ($('#view-ajustes').classList.contains('active')) renderSyncCard(); });
Sync.init({
  getState: function () { return state; },
  // Datos combinados de la nube: se adoptan sin marcarlos como cambios locales
  adoptState: function (s) { state = S.normalize(s); S.adopt(state); renderAll(); }
});
// El service worker se registra en index.html (antes de la app) para que se actualice aunque la app falle al arrancar
ensureCoreCurrencies();
if (Date.now() - (state.settings.lastRefresh || 0) > REFRESH_MS) refreshPrices(false);
maybeAutoBackup();
if (authLink) {
  Sync.handleAuthRedirect().then(function (r) {
    if (!r) return;
    if (r.type === 'error') toast('El enlace no es válido o caducó: ' + r.message);
    else if (r.type === 'recovery') { recoveryMode = true; toast('Elige tu contraseña nueva'); }
    else { syncStep = null; toast('Correo confirmado: sesión iniciada'); }
    showView('ajustes'); renderSyncCard();
  }).catch(function (e) { toast('No se pudo abrir la sesión: ' + e.message); });
}

// ================================================================ pasar datos desde la versión anterior
// La versión anterior (abierta como archivo en el PC) no puede sincronizar. Con un botón abre la
// versión publicada y le entrega sus datos por mensaje entre ventanas; aquí se piden confirmación
// y se cargan como una restauración: se guardan y la sincronización los sube cifrados.
var publicUrl = (window.APP_CONFIG || {}).publicUrl;
if (location.protocol === 'file:' && publicUrl) {
  var lb = $('#legacy-banner');
  lb.classList.remove('hidden');
  lb.innerHTML = '<b>Esta es la versión anterior: no se sincroniza con el teléfono.</b>' +
    'Tus datos de aquí pueden pasar a la versión sincronizada con un clic. Después usa siempre la app sincronizada.' +
    '<div class="btn-row"><button type="button" class="primary" data-action="migrate-out">Pasar mis datos a la app sincronizada</button>' +
    '<a class="btn" href="' + esc(publicUrl) + '" target="_blank" rel="noopener">Abrir la app sincronizada</a></div>';
}
function migrateOut() {
  var target = new URL(publicUrl).origin;
  var w = window.open(publicUrl + '#recibir', '_blank');
  if (!w) { toast('El navegador bloqueó la ventana: permite ventanas emergentes para este archivo y vuelve a pulsar.'); return; }
  var payload = JSON.stringify(state);
  var onMsg = function (e) {
    if (e.source !== w || !e.data) return;
    if (e.data.type === 'mf-ready') w.postMessage({ type: 'mf-data', data: payload }, target);
    if (e.data.type === 'mf-done') { window.removeEventListener('message', onMsg); toast('¡Listo! Tus datos ya están en la app sincronizada.'); }
    if (e.data.type === 'mf-cancel') { window.removeEventListener('message', onMsg); toast('Paso de datos cancelado'); }
  };
  window.addEventListener('message', onMsg);
  toast('Abriendo la app sincronizada…');
}
document.addEventListener('click', function (e) { if (e.target.closest('[data-action="migrate-out"]')) migrateOut(); });

if (receiveMode) {
  var opener = window.opener, handled = false;
  window.addEventListener('message', function (e) {
    // Solo se aceptan datos de la ventana que abrió esta (la versión anterior, archivo local) y una sola vez
    if (handled || e.source !== opener || !e.data || e.data.type !== 'mf-data') return;
    if (e.origin !== 'null' && e.origin !== location.origin) return;
    handled = true;
    var incoming;
    try { incoming = S.normalize(JSON.parse(e.data.data)); } catch (err) { toast('Los datos recibidos no son válidos'); return; }
    var n = function (k) { return (incoming[k] || []).length; };
    var pristine = Sync.isPristine(state);
    var ok = confirm('Recibí los datos de tu versión anterior:\n\n• ' + n('accounts') + ' cuentas\n• ' + n('transactions') + ' movimientos\n• ' +
      n('investments') + ' operaciones de inversión\n• ' + n('debts') + ' por cobrar/pagar\n• ' + n('exchanges') + ' cambios de divisas\n\n' +
      (pristine ? '¿Cargarlos en esta app? Se subirán cifrados a la nube y llegarán a tu teléfono.'
                : 'Esta app ya tiene datos: se COMBINARÁN (no se borra nada). ¿Continuar?'));
    if (!ok) { opener.postMessage({ type: 'mf-cancel' }, '*'); return; }
    // Instalación vacía: se reemplaza (como «Restaurar copia»); con datos: se combinan registro por registro
    safetyBackup('antes de recibir datos de la versión anterior');
    state = pristine ? incoming : S.normalize(Sync.merge(state, incoming));
    resetTxForm(); resetInvForm(); resetAccForm();
    persist();
    opener.postMessage({ type: 'mf-done' }, '*');
    toast('Datos cargados. Subiendo a la nube…');
    Sync.syncNow();
  });
  opener.postMessage({ type: 'mf-ready' }, '*');
}
