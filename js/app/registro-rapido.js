/* =========================================================================
 * app/registro-rapido.js — Deshacer, botón «+», voz, modo privado y gestos.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ Sprint 1: borrar con «Deshacer»
/** Borra un movimiento ('tx') u operación ('inv') y ofrece deshacer durante 6 s (sin ventana de confirmación). */
function deleteWithUndo(kind, id) {
  var key = kind === 'tx' ? 'transactions' : 'investments';
  var idx = -1;
  state[key].forEach(function (x, i) { if (x.id === id) idx = i; });
  if (idx < 0) return;
  var item = state[key][idx];
  if (kind === 'inv') {
    var remaining = state.investments.filter(function (i) { return i.id !== id; });
    if (C.buildPositions(remaining, rates()).errors.length) { toast('No se puede: dejaría una venta sin compra previa'); return; }
  }
  invalidateSnapshots(item.date);
  state[key].splice(idx, 1);
  if (kind === 'tx' && $('#tx-form').editId.value === id) resetTxForm();
  if (kind === 'inv' && $('#inv-form').editId.value === id) resetInvForm();
  persist();
  toastAction(kind === 'tx' ? 'Movimiento eliminado' : 'Operación eliminada', 'Deshacer', function () {
    if (byId(state[key], id)) return;
    state[key].splice(Math.min(idx, state[key].length), 0, item);
    invalidateSnapshots(item.date);
    persist();
    toast('Restaurado');
  });
}

// ================================================================ Sprint 1: registro rápido («+»)
var quick = { type: 'egreso', accountId: null, categoryId: null };

function quickAccounts() {
  var ids = C.rankByUse(state.accounts.map(function (a) { return a.id; }), state.transactions, 'accountId', S.today());
  return ids.map(account);
}
function quickCategories(type) {
  var cats = state.categories.filter(function (c) { return c.type === type; });
  var ids = C.rankByUse(cats.map(function (c) { return c.id; }), state.transactions.filter(function (t) { return t.type === type; }), 'categoryId', S.today());
  return ids.map(function (id) { return byId(state.categories, id); });
}
function chip(attr, value, label, sub, on) {
  return '<button type="button" class="chip-opt" role="radio" ' + attr + '="' + esc(value) + '" aria-checked="' + (on ? 'true' : 'false') + '">' +
    esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>';
}
function renderQuick() {
  var f = $('#quick-sheet');
  var accs = quickAccounts(), cats = quickCategories(quick.type);
  if (!account(quick.accountId)) quick.accountId = (account(state.settings.last.accountId) || accs[0] || {}).id || null;
  if (!byId(cats, quick.categoryId)) {
    var lastCat = state.settings.last['cat_' + quick.type];
    quick.categoryId = (byId(cats, lastCat) || cats[0] || {}).id || null;
  }
  $('#q-accounts').innerHTML = accs.length ? accs.map(function (a) { return chip('data-q-acc', a.id, a.name, a.currency, a.id === quick.accountId); }).join('')
    : '<span class="muted small">Primero crea una cuenta en Cuentas.</span>';
  $('#q-cats').innerHTML = cats.map(function (c) { return chip('data-q-cat', c.id, c.name, '', c.id === quick.categoryId); }).join('');
  var acc = account(quick.accountId);
  $('#q-cur').textContent = acc ? acc.currency : '';
  $('#q-save').textContent = quick.type === 'ingreso' ? 'Guardar ingreso' : 'Guardar gasto';
  fillSelect(f.methodId, [{ value: '', label: '—' }].concat(state.methods.map(function (m) { return { value: m.id, label: m.name }; })), f.methodId.value || state.settings.last.methodId || '');
}
/** Abre la hoja. Se llama dentro del toque del usuario para que el móvil abra el teclado numérico. */
function openQuick() {
  var f = $('#quick-sheet');
  f.reset();
  $('#q-heard').classList.add('hidden');
  $('#q-mic').classList.toggle('hidden', !Voice.supported());
  quick.type = 'egreso'; quick.accountId = null; quick.categoryId = null;
  f.date.value = S.today();
  $('#quick-sheet').classList.remove('hidden');
  $('#quick-backdrop').classList.remove('hidden');
  document.body.classList.add('sheet-open');
  renderQuick();
  f.amount.focus();
}
function closeQuick() {
  if (stopListening) stopListening();
  $('#quick-sheet').classList.add('hidden');
  $('#quick-backdrop').classList.add('hidden');
  document.body.classList.remove('sheet-open');
  if (document.activeElement) document.activeElement.blur();
}
/** Interpreta el monto escrito: acepta coma o punto decimal y sumas («12,50+3»). */
function parseAmount(txt) { return C.parseAmount(txt); }
/** Número escrito con coma o punto («1,5», «95,5», «1.234,56»); NaN si no es válido. */
function num(txt) { return C.parseNum(txt); }

// ---- Registro por voz o frase: «gasté 25 dólares en comida con la tarjeta»
var stopListening = null;
function voiceContext() {
  var methodIds = C.rankByUse(state.methods.map(function (m) { return m.id; }), state.transactions, 'methodId', S.today());
  return {
    today: S.today(), currencies: currencies(),
    defaultAccountId: (account(state.settings.last.accountId) || quickAccounts()[0] || {}).id || null,
    accounts: quickAccounts(), categories: state.categories,
    methods: methodIds.map(function (id) { return byId(state.methods, id); })
  };
}
/** Rellena la hoja con lo que se entendió; el usuario revisa y pulsa Guardar. */
function applySay(text) {
  text = String(text || '').trim();
  if (!text) return;
  var f = $('#quick-sheet'), r = Voice.parse(text, voiceContext());
  quick.type = r.type;
  f.querySelector('input[name="qtype"][value="' + r.type + '"]').checked = true;
  if (r.accountId) quick.accountId = r.accountId;
  if (r.categoryId) quick.categoryId = r.categoryId; else quick.categoryId = null;
  if (r.amount != null) f.amount.value = String(r.amount).replace('.', ',');
  if (r.methodId) f.methodId.value = r.methodId;
  f.date.value = r.date;
  if (r.note) f.note.value = r.note;
  renderQuick();
  if (r.methodId) f.methodId.value = r.methodId;
  if (r.date !== S.today() || r.note) f.querySelector('.q-more').open = true;
  var acc = account(quick.accountId), parts = [r.type === 'ingreso' ? 'Ingreso' : 'Gasto'];
  if (r.amount != null && acc) parts.push(fmtMoney(r.amount, acc.currency));
  if (r.categoryId) parts.push(catName(r.categoryId));
  if (r.methodId) parts.push(methodName(r.methodId));
  if (acc) parts.push('cuenta ' + acc.name);
  if (r.date !== S.today()) parts.push(fmtDate(r.date));
  var miss = r.missing.filter(function (m) { return m.indexOf('cuenta en') !== 0; });
  var noAcc = r.missing.filter(function (m) { return m.indexOf('cuenta en') === 0; })[0];
  $('#q-heard').innerHTML = 'Entendí: <b>' + esc(parts.join(' · ')) + '</b>' +
    (miss.length ? '<br><span class="miss">Falta: ' + esc(miss.join(' y ')) + ' — elígelo abajo.</span>' : '<br>Revisa y pulsa Guardar.') +
    (noAcc ? '<br><span class="miss">No tienes una ' + esc(noAcc) + ': se usará ' + esc(acc ? acc.name : '') + '.</span>' : '');
  $('#q-heard').classList.remove('hidden');
  if (r.amount == null) f.amount.focus();
}
function quickVoice() {
  var btn = $('#q-mic'), f = $('#quick-sheet');
  if (stopListening) { stopListening(); return; }
  if (!Voice.supported()) { toast('Este navegador no permite dictar: escribe la frase y pulsa Enter'); f.say.focus(); return; }
  btn.classList.add('listening');
  $('#q-heard').innerHTML = 'Escuchando… di por ejemplo «gasté 25 dólares en comida con la tarjeta»';
  $('#q-heard').classList.remove('hidden');
  var last = '';
  stopListening = Voice.listen(function (txt, fin) {
    last = txt; f.say.value = txt;
    if (fin) applySay(txt);
  }, function (err) {
    stopListening = null; btn.classList.remove('listening');
    if (err === 'not-allowed' || err === 'service-not-allowed') toast('Permite el micrófono para dictar (icono del candado en la barra de direcciones)');
    else if (err && err !== 'aborted' && err !== 'no-speech') toast('No se pudo usar el micrófono (' + err + ')');
    else if (!last) { $('#q-heard').innerHTML = 'No te escuché. Vuelve a tocar el micrófono o escribe la frase.'; }
  });
}
function onQuickSubmit(e) {
  e.preventDefault();
  var f = e.target;
  var amount = C.round(parseAmount(f.amount.value), 2);
  var acc = account(quick.accountId);
  if (!(amount > 0)) { toast('Escribe el monto'); f.amount.focus(); return; }
  if (!acc) { toast('Elige una cuenta'); return; }
  if (!quick.categoryId) { toast('Elige una categoría'); return; }
  var data = { id: S.uid(), createdAt: Date.now(), type: quick.type, date: f.date.value || S.today(), amount: amount, currency: acc.currency,
    accountId: acc.id, categoryId: quick.categoryId, methodId: f.methodId.value, note: f.note.value.trim() };
  invalidateSnapshots(data.date);
  state.transactions.push(data);
  var last = state.settings.last;
  last.accountId = acc.id; last.methodId = data.methodId; last['cat_' + data.type] = data.categoryId;
  closeQuick();
  persist();
  toastAction((data.type === 'ingreso' ? 'Ingreso' : 'Gasto') + ' guardado: ' + fmtMoney(data.amount, data.currency) + ' · ' + catName(data.categoryId), 'Deshacer',
    function () { state.transactions = state.transactions.filter(function (t) { return t.id !== data.id; }); persist(); toast('Registro deshecho'); });
}

// ================================================================ Sprint 1: modo privado
function applyPrivacy() {
  document.body.classList.toggle('privacy', privacy);
  var b = $('#privacy-btn');
  b.setAttribute('aria-pressed', privacy ? 'true' : 'false');
  b.title = privacy ? 'Mostrar montos' : 'Ocultar montos';
  b.setAttribute('aria-label', b.title);
  b.querySelector('use').setAttribute('href', privacy ? '#i-eye-off' : '#i-eye');
}
function togglePrivacy() {
  privacy = !privacy;
  setUiPref('privacy', privacy);
  applyPrivacy();
  renderAll();
  if (asset) { renderAssetHeader(); renderAssetChart(); renderAssetPosition(); }
  toast(privacy ? 'Montos ocultos' : 'Montos visibles');
}

// ================================================================ Sprint 1: gestos táctiles
var gesture = null, suppressClickUntil = 0;
function bindGestures() {
  var ptr = $('#ptr');
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1 || document.body.classList.contains('sheet-open')) { gesture = null; return; }
    var t = e.touches[0];
    var row = e.target.closest('.list li[data-edit-tx], .list li[data-edit-inv]');
    var atTop = window.scrollY <= 0 && !e.target.closest('.chart-svg, .search-results, dialog');
    gesture = { x: t.clientX, y: t.clientY, dx: 0, dy: 0, row: row, atTop: atTop, axis: null };
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!gesture) return;
    var t = e.touches[0];
    gesture.dx = t.clientX - gesture.x; gesture.dy = t.clientY - gesture.y;
    if (!gesture.axis && (Math.abs(gesture.dx) > 10 || Math.abs(gesture.dy) > 10)) gesture.axis = Math.abs(gesture.dx) > Math.abs(gesture.dy) ? 'h' : 'v';
    if (gesture.axis === 'h' && gesture.row) {
      var dx = Math.max(-140, Math.min(140, gesture.dx));
      var r = gesture.row;
      r.classList.add('swiping'); r.classList.remove('swipe-back');
      r.style.transform = 'translateX(' + dx + 'px)';
      r.classList.toggle('swipe-delete', dx < -20);
      r.classList.toggle('swipe-edit', dx > 20);
    } else if (gesture.axis === 'v' && gesture.atTop && gesture.dy > 0) {
      var pull = Math.min(gesture.dy, 140);
      ptr.style.opacity = Math.min(1, pull / 80);
      ptr.style.transform = 'translate(-50%, ' + (pull / 2 - 40) + 'px)';
      var ready = C.pullIntent(gesture.dy, gesture.dx, true);
      ptr.classList.toggle('ready', ready);
      $('#ptr-text').textContent = ready ? 'Suelta para actualizar' : 'Arrastra para actualizar';
    }
  }, { passive: true });

  document.addEventListener('touchend', function () {
    var g = gesture; gesture = null;
    if (!g) return;
    if (g.row) {
      var r = g.row;
      r.classList.remove('swiping', 'swipe-delete', 'swipe-edit');
      r.classList.add('swipe-back');
      r.style.transform = '';
      var intent = g.axis === 'h' ? C.swipeIntent(g.dx, g.dy) : null;
      if (g.axis === 'h') suppressClickUntil = Date.now() + 400; // que el deslizamiento no cuente como toque
      if (intent === 'delete') deleteWithUndo(r.dataset.editTx ? 'tx' : 'inv', r.dataset.editTx || r.dataset.editInv);
      else if (intent === 'edit') { if (r.dataset.editTx) editTx(r.dataset.editTx); else editInv(r.dataset.editInv); }
    }
    if (g.axis === 'v' && g.atTop && C.pullIntent(g.dy, g.dx, true)) pullRefresh();
    else { ptr.style.opacity = 0; ptr.style.transform = ''; ptr.classList.remove('ready'); }
  }, { passive: true });

  // Un clic justo después de deslizar no debe abrir la fila
  document.addEventListener('click', function (e) {
    if (Date.now() < suppressClickUntil && e.target.closest('.list li')) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}
function pullRefresh() {
  var ptr = $('#ptr');
  ptr.classList.add('loading'); ptr.classList.remove('ready');
  $('#ptr-text').textContent = 'Actualizando…';
  var jobs = [refreshPrices(false)];
  if (Sync.config().enabled) jobs.push(Sync.syncNow());
  Promise.all(jobs).catch(function () { /* los errores ya se muestran en su sitio */ }).then(function () {
    ptr.classList.remove('loading');
    ptr.style.opacity = 0; ptr.style.transform = '';
    toast('Actualizado');
  });
}
