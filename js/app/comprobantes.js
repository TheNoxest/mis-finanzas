/* =========================================================================
 * app/comprobantes.js — Comprobantes (PDF/imagen) y WhatsApp.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ comprobantes y WhatsApp
// Colores de acento (versión clara: es la que se usa en el comprobante, siempre sobre fondo blanco)
var ACCENTS = { azul: '#256abf', verde: '#0f7a5c', morado: '#6a4bc4', naranja: '#b4531c', rosa: '#b8336a', grafito: '#3a3a38' };
function rcptSettings() { return state.settings.receipt || {}; }
/** Contexto de los comprobantes: montos reales aunque el modo privado esté activo. */
function receiptCtx() {
  var r = rcptSettings();
  return { locale: LOCALE, today: S.today(), business: { name: r.name, phone: r.phone, footer: r.footer },
    loanTerms: function (l) { var p = privacy; privacy = false; try { return loanTermsText(l); } finally { privacy = p; } } };
}
function recOf(kind, id) {
  var list = kind === 'fx' ? state.exchanges : kind === 'sale' ? state.sales : kind === 'loan' ? state.loans : state.debts;
  return byId(list || [], id);
}
/** Modelo del comprobante de una operación (o del recibo de uno de sus pagos si se da payId). */
function receiptModel(kind, id, payId) {
  var rec = recOf(kind, id), ctx = receiptCtx();
  if (!rec) return null;
  if (payId) {
    var pm = byId((kind === 'fx' ? rec.settlements : rec.payments) || [], payId);
    return pm ? Receipt.paymentModel(kind, rec, pm, ctx) : null;
  }
  return kind === 'fx' ? Receipt.exchangeModel(rec, ctx) : kind === 'sale' ? Receipt.saleModel(rec, ctx)
    : kind === 'loan' ? Receipt.loanModel(rec, ctx) : Receipt.debtModel(rec, ctx);
}
function personOf(kind, id) { var r = recOf(kind, id); return r ? (r.client || r.person || '') : ''; }
function contactOf(name) {
  var k = C.personKey(name); if (!k) return null;
  return (state.contacts || []).filter(function (c) { return C.personKey(c.name) === k; })[0] || null;
}
function waPhone(raw) { return Receipt.normalizePhone(raw, rcptSettings().countryCode); }
/** Número listo para wa.me, o null (con aviso) si es local y falta el código de país. */
function waTarget(raw) {
  var ph = waPhone(raw);
  if (ph.charAt(0) === '0' || (ph && ph.length < 8)) {
    toast('Falta el código de país: escribe el número con + (ej.: +58 412…) o ponlo en Ajustes → Comprobantes y WhatsApp');
    return null;
  }
  return ph;
}
/** Guarda en la ficha del cliente el teléfono escrito al enviar (crea la ficha si no existe). */
function rememberPhone(name, phone) {
  if (!String(name || '').trim() || !phone) return;
  var c = contactOf(name);
  if (c) { if (c.phone === phone) return; c.phone = phone; }
  else { state.contacts = state.contacts || []; state.contacts.push({ id: S.uid(), name: name.trim(), phone: phone, note: '', createdAt: Date.now() }); }
  persist();
}
function openWa(phone, msg) {
  var url = Receipt.waUrl(phone, msg), w = window.open(url, '_blank');
  if (w) w.opener = null; else location.href = url;
}
function canShareFiles() {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] })); } catch (e) { return false; }
}

var rcpt = null;   // comprobante abierto: { model, name, canvas, png, pdf }
function openReceipt(kind, id, payId) {
  var m = receiptModel(kind, id, payId);
  if (!m) { toast('No se encontró la operación'); return; }
  var name = personOf(kind, id), c = contactOf(name), canvas = document.createElement('canvas');
  Receipt.draw(m, canvas, { accent: ACCENTS[uiPrefs().accent] || ACCENTS.azul, scale: 2 });
  var mine = rcpt = { model: m, name: name, canvas: canvas, png: null, pdf: null };
  var share = canShareFiles(), dlg = $('#receipt-dialog');
  $('#rcpt-title').textContent = m.title;
  $('#rcpt-img').src = canvas.toDataURL('image/png');
  $('#rcpt-phone').value = c && c.phone ? c.phone : '';
  $$('[data-share]', dlg).forEach(function (s) { s.textContent = share ? 'Compartir' : 'Descargar'; });
  $('#rcpt-hint').textContent = share
    ? '«Enviar por WhatsApp» abre el chat del cliente con el comprobante escrito. Para mandar el PDF o la imagen, toca «Compartir» y elige WhatsApp.'
    : '«Enviar por WhatsApp» abre el chat con el comprobante escrito. El PDF y la imagen se descargan: arrástralos al chat para adjuntarlos.'
  if (!rcptSettings().name) $('#rcpt-hint').textContent += ' Pon el nombre de tu negocio en Ajustes → Comprobantes y WhatsApp.';
  if (!dlg.open) dlg.showModal();
  // Los archivos se preparan ya: compartir tiene que ocurrir justo al tocar el botón
  Receipt.canvasBlob(canvas, 'image/png').then(function (b) { mine.png = b; return Receipt.pdfBlob(canvas); })
    .then(function (b) { mine.pdf = b; }).catch(function () { /* se generan al tocar */ });
}
function downloadBlob(blob, name) {
  var a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}
async function shareReceipt(type) {
  if (!rcpt) return;
  var r = rcpt, pdf = type === 'pdf';
  var blob = pdf ? (r.pdf || await Receipt.pdfBlob(r.canvas)) : (r.png || await Receipt.canvasBlob(r.canvas, 'image/png'));
  var file = new File([blob], 'comprobante-' + r.model.number + (pdf ? '.pdf' : '.png'), { type: pdf ? 'application/pdf' : 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: r.model.title, text: r.model.title + ' N.º ' + r.model.number }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  downloadBlob(file, file.name);
  toast(pdf ? 'PDF descargado' : 'Imagen descargada');
}
function sendReceiptWa() {
  if (!rcpt) return;
  var raw = $('#rcpt-phone').value.trim();
  var ph = waTarget(raw);
  if (ph === null) { $('#rcpt-phone').focus(); return; }
  rememberPhone(rcpt.name, raw);
  openWa(ph, Receipt.text(rcpt.model));
}
function copyReceipt() {
  if (!rcpt) return;
  var t = Receipt.text(rcpt.model);
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Texto copiado'); }, function () { toast('No se pudo copiar'); });
}
/** Lo que esta persona te debe (todo o solo una operación), para el recordatorio. */
function pendingFor(name, onlyId) {
  var k = C.personKey(name);
  return C.thirdParty(state, S.today()).receivables.filter(function (it) {
    return it.status !== 'pagada' && (onlyId ? it.id === onlyId : C.personKey(it.person) === k);
  });
}
function remindWa(name, onlyId) {
  var items = pendingFor(name, onlyId), c = contactOf(name), phone = c && c.phone ? waTarget(c.phone) : '';
  if (phone === null) return;
  var msg = items.length ? Receipt.reminderText(name, items.map(function (it) { return Receipt.reminderItem(it, LOCALE); }), rcptSettings().name)
    : 'Hola' + (String(name || '').trim() ? ' ' + String(name).trim().split(/\s+/)[0] : '') + ' 👋';
  if (!phone) toast('Sin teléfono guardado: elige el chat en WhatsApp (o añádelo en su ficha de cliente)');
  openWa(phone, msg);
}
/** Botones «Comprobante» y «Recordar por WhatsApp» de la tarjeta de cobros/pagos. */
function setPayTools(kind, id, remind) {
  var box = $('#pay-tools');
  if (!kind) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  var r = $('#pay-rcpt'), w = $('#pay-remind');
  r.dataset.kind = w.dataset.kind = kind; r.dataset.id = w.dataset.id = id;
  w.classList.toggle('hidden', !remind);
}
function rcptFormBtn(kind, show) { $('[data-action="rcpt-form"][data-kind="' + kind + '"]').classList.toggle('hidden', !show); }
function receiptClick(d) {
  if (d.rcpt) { var p = d.rcpt.split('|'); openReceipt(p[0], p[1], p[2]); return true; }
  switch (d.action) {
    case 'rcpt-open': openReceipt(d.kind, d.id); return true;
    case 'rcpt-form':
      var fid = { fx: '#fx-form', sale: '#sale-form', loan: '#loan-form', debt: '#debt-form' }[d.kind], eid = fid && $(fid).editId.value;
      if (eid) openReceipt(d.kind, eid);
      return true;
    case 'wa-remind': remindWa(personOf(d.kind, d.id), d.id); return true;
    case 'person-wa': var pp = personByKey(personOpenKey); if (pp) remindWa(pp.name); return true;
    case 'rcpt-close': $('#receipt-dialog').close(); return true;
    case 'rcpt-wa': sendReceiptWa(); return true;
    case 'rcpt-pdf': shareReceipt('pdf'); return true;
    case 'rcpt-img': shareReceipt('png'); return true;
    case 'rcpt-copy': copyReceipt(); return true;
  }
  return false;
}
function fillReceiptSettings() {
  var f = $('#rcpt-settings'); if (f.contains(document.activeElement)) return;
  var r = rcptSettings();
  f.bizName.value = r.name || ''; f.phone.value = r.phone || ''; f.countryCode.value = r.countryCode || ''; f.footer.value = r.footer || '';
}
function bindReceipts() {
  var f = $('#rcpt-settings');
  f.addEventListener('submit', function (e) { e.preventDefault(); });
  f.addEventListener('change', function () {
    state.settings.receipt = { name: f.bizName.value.trim(), phone: f.phone.value.trim(), footer: f.footer.value.trim(), countryCode: f.countryCode.value.replace(/\D/g, '') };
    persist(); toast('Datos de los comprobantes guardados');
  });
  var dlg = $('#receipt-dialog');
  dlg.addEventListener('click', function (e) {   // tocar fuera del recuadro lo cierra
    if (e.target !== dlg) return;
    var r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
  });
  dlg.addEventListener('close', function () { rcpt = null; $('#rcpt-img').removeAttribute('src'); });
}
