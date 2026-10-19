/* =========================================================================
 * app/sincronizacion.js — Sincronización (interfaz) y copias/versiones.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ sincronización (interfaz)
var syncStep = null;   // paso intermedio de la configuración: { vaultExists }

function renderSyncDot() {
  var st = Sync.status(), dot = $('#cloud-dot'), cfg = Sync.config();
  dot.classList.toggle('hidden', !cfg.enabled);
  dot.className = 'cloud-dot ' + (cfg.enabled ? st.state : 'hidden');
  var t = { ok: 'Sincronizado', pending: 'Cambios por subir', syncing: 'Sincronizando…', offline: 'Sin conexión: se sincronizará al volver', error: 'Error de sincronización', login: 'Vuelve a iniciar sesión' };
  $('#settings-btn').title = cfg.enabled ? 'Ajustes · ' + (t[st.state] || '') : 'Ajustes';
}

var recoveryMode = false;   // se abrió el enlace «restablecer contraseña» del correo
function renderSyncCard() {
  var cfg = Sync.config(), st = Sync.status(), body = $('#sync-body');
  if (!body) return;
  renderSyncDot();
  if (recoveryMode && cfg.session) {
    body.innerHTML = '<div class="recovery-box"><b>Elige una contraseña nueva para tu cuenta</b>' +
      '<form class="sync-form" data-sync-form="newpass" style="margin-top:8px"><label>Contraseña nueva (mín. 6 caracteres)<input name="pass" type="password" autocomplete="new-password" minlength="6" required></label>' +
      '<label>Repítela<input name="pass2" type="password" autocomplete="new-password" required></label>' +
      '<div class="actions" style="margin-top:0"><button class="primary" type="submit">Guardar contraseña</button></div></form>' +
      '<p class="hint">Esto cambia la contraseña de la <b>cuenta</b>. Tu contraseña de <b>cifrado</b> no cambia y sigue sin poder recuperarse.</p></div>';
    return;
  }
  var https = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!https) {
    body.innerHTML = '<p class="warning">La sincronización funciona cuando la app está publicada en internet (https). Sigue la guía GUIA-MOVIL.md para publicarla en GitHub Pages; luego ábrela desde ese enlace en el PC y en el móvil.</p>';
    return;
  }
  if (!cfg.url || !cfg.anonKey) {
    body.innerHTML = '<ol class="steps"><li>Crea un proyecto gratis en supabase.com.</li><li>Ejecuta el archivo <b>supabase/setup.sql</b> en su «SQL Editor».</li><li>Copia aquí la URL y la clave «anon public» (Project Settings → API).</li></ol>' +
      '<form class="sync-form" data-sync-form="config"><label>URL del proyecto<input name="url" placeholder="https://xxxx.supabase.co" autocomplete="off" required></label>' +
      '<label>Clave anon public<input name="key" placeholder="eyJ…" autocomplete="off" required></label>' +
      '<div class="actions" style="margin-top:0"><button class="primary" type="submit">Guardar</button></div></form>';
    return;
  }
  if (!cfg.session) {
    // Sincronización activa pero la sesión caducó: solo hace falta entrar otra vez (la clave de cifrado sigue guardada)
    var relogin = cfg.enabled;
    var lastEmail = cfg.lastUser && cfg.lastUser.email || '';
    body.innerHTML = (relogin
      ? '<p class="warning" style="margin-top:0"><b>Tu sesión se cerró.</b> Inicia sesión otra vez para seguir sincronizando. Tus datos están a salvo en este dispositivo' +
        (cfg.pending ? ' y los cambios pendientes se subirán al entrar' : '') + '; no tendrás que escribir la contraseña de cifrado.</p>'
      : '<p class="hint" style="margin-top:0">Usa el mismo correo en el PC y en el móvil.</p>') +
      '<form class="sync-form" data-sync-form="auth"><label>Correo<input name="email" type="email" autocomplete="username" required value="' + esc(lastEmail) + '"></label>' +
      '<label>Contraseña de la cuenta<input name="password" type="password" autocomplete="current-password" minlength="6" required></label>' +
      '<div class="actions" style="margin-top:0">' + (relogin ? '' : '<button type="submit" value="signup">Crear cuenta</button>') + '<button class="primary" type="submit" value="signin">Iniciar sesión</button></div></form>' +
      '<div class="btn-row" style="margin-top:8px"><button type="button" class="link small" data-action="sync-forgot">¿Olvidaste la contraseña de la cuenta?</button>' +
      '<button type="button" class="link small" data-action="sync-reset-config">Cambiar proyecto de Supabase</button></div>';
    return;
  }
  if (!cfg.enabled) {
    if (!syncStep) {
      body.innerHTML = '<p class="muted">Comprobando tu bóveda en la nube…</p>';
      Sync.vaultExists().then(function (ex) { syncStep = { vaultExists: ex }; renderSyncCard(); })
        .catch(function (e) { body.innerHTML = '<p class="warning">' + esc(e.message) + '</p><button type="button" data-action="sync-retry">Reintentar</button>'; });
      return;
    }
    var hasLocal = !Sync.isPristine(state);
    body.innerHTML = syncStep.vaultExists
      ? '<p>Sesión iniciada como <b>' + esc(cfg.session.user.email) + '</b>. Ya tienes datos en la nube: escribe tu contraseña de cifrado para conectar este dispositivo.</p>' +
        '<form class="sync-form" data-sync-form="enable"><label>Contraseña de cifrado<input name="pass" type="password" autocomplete="off" required></label>' +
        (hasLocal ? '<label class="check"><input type="radio" name="mode" value="merge" checked> Combinar los datos de este dispositivo con los de la nube</label>' +
          '<label class="check"><input type="radio" name="mode" value="replace"> Reemplazar este dispositivo con los datos de la nube</label>' : '') +
        '<div class="actions" style="margin-top:0"><button class="primary" type="submit">Conectar este dispositivo</button></div></form>'
      : '<p>Sesión iniciada como <b>' + esc(cfg.session.user.email) + '</b>. Crea tu <b>contraseña de cifrado</b>: protege tus datos en la nube y la pedirá cada dispositivo nuevo.</p>' +
        '<form class="sync-form" data-sync-form="enable"><label>Contraseña de cifrado (mín. 8 caracteres)<input name="pass" type="password" autocomplete="new-password" minlength="8" required></label>' +
        '<label>Repítela<input name="pass2" type="password" autocomplete="new-password" required></label>' +
        '<label class="check"><input type="checkbox" name="ack" required> Entiendo que si la olvido nadie puede recuperar los datos de la nube (conserva también tus copias de seguridad).</label>' +
        '<div class="actions" style="margin-top:0"><button class="primary" type="submit">Activar sincronización</button></div></form>';
    body.insertAdjacentHTML('beforeend', '<button type="button" class="link small" data-action="sync-signout">Cerrar sesión</button>');
    return;
  }
  var labels = { ok: ['on', 'Sincronizado'], pending: ['warn', 'Cambios por subir'], syncing: ['warn', 'Sincronizando…'], offline: ['', 'Sin conexión: se sincronizará al volver'], error: ['', 'Error: ' + (st.error || '')], off: ['', 'Inactivo'] };
  var l = labels[st.state] || labels.off;
  body.innerHTML = '<div class="sync-status"><span class="live-dot ' + l[0] + '"></span><b>' + esc(l[1]) + '</b>' +
    (st.at ? '<span class="muted">· última vez ' + fmtTime(st.at) + '</span>' : '') + '</div>' +
    '<p class="hint" style="margin-top:0">Cuenta: ' + esc(cfg.session.user.email) + '. Los cambios se suben solos unos segundos después de guardarlos; sin conexión quedan pendientes.</p>' +
    '<div class="btn-row"><button type="button" class="primary" data-action="sync-now">Sincronizar ahora</button><button type="button" data-action="sync-signout">Cerrar sesión en este dispositivo</button></div>';
}

async function onSyncForm(e) {
  var f = e.target.closest('[data-sync-form]'); if (!f) return;
  e.preventDefault();
  var kind = f.dataset.syncForm, btn = e.submitter;
  var busy = function (on) { $$('button', f).forEach(function (b) { b.disabled = on; }); };
  busy(true);
  try {
    if (kind === 'config') {
      var url = f.url.value.trim();
      if (!/^https:\/\/.+/.test(url)) throw new Error('La URL debe empezar por https://');
      Sync.configure(url, f.key.value);
    } else if (kind === 'auth') {
      if (btn && btn.value === 'signup') {
        var r = await Sync.signUp(f.email.value.trim(), f.password.value);
        if (!r.session) { toast('Cuenta creada. Confirma el correo que te envió Supabase y luego inicia sesión.'); busy(false); return; }
      } else {
        var wasOn = Sync.config().enabled;
        await Sync.signIn(f.email.value.trim(), f.password.value);
        if (wasOn && Sync.config().enabled) toast('Sesión iniciada: sincronizando…');
      }
      syncStep = null;
    } else if (kind === 'newpass') {
      if (f.pass.value !== f.pass2.value) throw new Error('Las contraseñas no coinciden');
      await Sync.updatePassword(f.pass.value);
      recoveryMode = false; syncStep = null;
      toast('Contraseña de la cuenta actualizada');
    } else if (kind === 'enable') {
      if (f.pass2 && f.pass.value !== f.pass2.value) throw new Error('Las contraseñas de cifrado no coinciden');
      var mode = f.querySelector('input[name="mode"]:checked');
      toast('Cifrando y sincronizando…');
      await safetyBackup('antes de conectar con la nube');
      await Sync.enable(f.pass.value, mode ? mode.value : 'merge');
      toast('¡Sincronización activada en este dispositivo!');
      syncStep = null;
    }
  } catch (err) { toast(err.message); }
  busy(false);
  renderSyncCard();
}

// ================================================================ copias y versiones
var cloudVersions = null;   // lista cargada al pulsar «Ver versiones en la nube»

function countsText(c) {
  if (!c) return '';
  return [c.accounts + ' cuentas', c.transactions + ' movimientos', c.investments + ' inversiones',
    (c.debts || 0) + (c.exchanges || 0) ? (c.debts || 0) + ' por cobrar/pagar · ' + (c.exchanges || 0) + ' cambios' : ''].filter(Boolean).join(' · ');
}
function fmtStamp(ms) {
  return new Date(ms).toLocaleString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderVersionsCard() {
  var box = $('#local-versions'); if (!box || !window.Backups) return;
  Backups.list().then(function (list) {
    box.innerHTML = list.length ? list.map(function (v) {
      return '<li class="version-row"><span class="avatar">' + icon('i-refresh') + '</span><div class="main"><div class="title">' + esc(fmtStamp(v.at)) +
        ' <span class="tag">' + esc(v.reason) + '</span></div><div class="sub">' + esc(countsText(v.counts)) + '</div></div>' +
        '<button type="button" data-restore-local="' + v.id + '">Restaurar</button></li>';
    }).join('') : '<li class="empty">Todavía no hay copias: se creará una automáticamente.</li>';
  }).catch(function () { box.innerHTML = '<li class="empty">Este navegador no permite guardar copias (¿modo incógnito?).</li>'; });

  var cb = $('#cloud-versions-box'), cfg = Sync.config();
  if (!cfg.enabled) { cb.innerHTML = '<h3>En la nube</h3><p class="hint">Activa la sincronización para guardar versiones cifradas en la nube.</p>'; return; }
  var html = '<h3>En la nube (cifradas)</h3>';
  if (cloudVersions === null) {
    html += '<div class="btn-row"><button type="button" data-action="cloud-versions">Ver versiones en la nube</button>' +
      '<button type="button" data-action="cloud-version-now">Guardar versión en la nube ahora</button></div>';
  } else if (cloudVersions.missing) {
    html += '<div class="warning">Falta crear la tabla de versiones en Supabase: abre <b>SQL Editor</b>, pega el contenido de ' +
      '<b>supabase/versions.sql</b> y pulsa <b>Run</b>. Luego vuelve a intentarlo.</div><button type="button" data-action="cloud-versions">Reintentar</button>';
  } else {
    html += '<ul class="list">' + (cloudVersions.length ? cloudVersions.map(function (v) {
      return '<li class="version-row"><span class="avatar tr">' + icon('i-wallet') + '</span><div class="main"><div class="title">' + esc(fmtStamp(v.at)) +
        ' <span class="tag">' + esc(v.reason || '') + '</span></div></div><button type="button" data-restore-cloud="' + v.id + '">Restaurar</button></li>';
    }).join('') : '<li class="empty">Aún no hay versiones: se guarda una automáticamente cada 6 h al sincronizar.</li>') + '</ul>' +
      '<div class="btn-row"><button type="button" data-action="cloud-version-now">Guardar versión en la nube ahora</button></div>' +
      '<p class="hint">Se conservan las 20 más recientes y una por día del último mes.</p>';
  }
  cb.innerHTML = html;
}

async function restoreFrom(kind, id) {
  try {
    var data = kind === 'local' ? await Backups.get(id) : await Sync.getCloudVersion(id);
    if (!data) { toast('Esa copia ya no existe'); return; }
    var c = Backups.summarize(data);
    if (!confirm('¿Volver a esta versión?\n\n' + countsText(c) + '\n\nAntes se guarda una copia de cómo está todo ahora, por si quieres deshacerlo.')) return;
    await replaceState(data, 'restaurar una versión', 'Versión restaurada');
  } catch (e) { toast(e.message); }
}
