/* =========================================================================
 * app/clientes.js — Clientes: directorio, ficha, historial y sugerencias de nombre.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ clientes (directorio de personas)
var peopleCache = [];        // Calc.peopleIndex: se recalcula en cada render
var personOpenKey = null;    // ficha abierta en Cuentas → Clientes
function renderPeople() { peopleCache = C.peopleIndex(state, S.today()); }
function personByKey(k) { return peopleCache.filter(function (p) { return p.key === k; })[0] || null; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
function personMeta(p) {
  var parts = [];
  if (p.exchanges) parts.push(plural(p.exchanges, 'cambio', 'cambios'));
  if (p.sales) parts.push(plural(p.sales, 'venta', 'ventas'));
  if (p.loans) parts.push(plural(p.loans, 'préstamo', 'préstamos'));
  if (p.debts) parts.push(plural(p.debts, 'deuda', 'deudas'));
  return (parts.join(' · ') || 'Sin operaciones') + (p.last ? ' · última ' + fmtDate(p.last) : '');
}
function personBalance(p, b) {
  return (p.owesYou > 0 ? '<span class="owes">te debe ' + fmtMoney(p.owesYou, b) + '</span>' : '') +
    (p.youOwe > 0 ? (p.owesYou > 0 ? '<br>' : '') + '<span class="owe">le debes ' + fmtMoney(p.youOwe, b) + '</span>' : '');
}

// ---- Sugerencias al escribir el nombre (cambios, ventas, préstamos, deudas)
var sug = { input: null, items: [], sel: -1, mute: false };
function hideSuggest() {
  if (sug.input) { var ul = sug.input.closest('label').querySelector('.people-suggest'); if (ul) ul.remove(); }
  sug.input = null; sug.items = []; sug.sel = -1;
}
function showSuggest(input) {
  if (sug.mute) return;
  if (sug.input && sug.input !== input) hideSuggest();
  var lab = input.closest('label'); lab.classList.add('has-suggest');
  var txt = input.value.trim(), key = C.personKey(txt);
  var list = C.matchPeople(peopleCache, txt, 6);
  var exact = peopleCache.some(function (p) { return p.key === key; });
  var items = list.map(function (p) { return { p: p }; });
  if (txt && !exact) items.push({ name: txt });
  if (!items.length || (items.length === 1 && items[0].p && items[0].p.key === key)) { hideSuggest(); return; }
  sug.input = input; sug.items = items; if (sug.sel >= items.length) sug.sel = -1;
  var ul = lab.querySelector('.people-suggest');
  if (!ul) { ul = document.createElement('ul'); ul.className = 'people-suggest'; ul.setAttribute('role', 'listbox'); lab.appendChild(ul); }
  var b = base();
  ul.innerHTML = items.map(function (it, i) {
    if (it.p) return '<li role="option" data-sug="' + i + '"' + (i === sug.sel ? ' class="sel"' : '') + '><span class="avatar">' + initials(it.p.name) + '</span>' +
      '<div class="main"><div>' + esc(it.p.name) + '</div><div class="sub">' + esc(personMeta(it.p)) +
      (it.p.owesYou > 0 ? ' · te debe ' + esc(fmtMoney(it.p.owesYou, b)) : '') + (it.p.youOwe > 0 ? ' · le debes ' + esc(fmtMoney(it.p.youOwe, b)) : '') + '</div></div></li>';
    return '<li role="option" class="new' + (i === sug.sel ? ' sel' : '') + '" data-sug="' + i + '">＋ Nuevo cliente: «' + esc(it.name) + '» <span class="sub">· se registra al guardar</span></li>';
  }).join('');
}
function chooseSuggest(i) {
  var it = sug.items[i], input = sug.input;
  if (!it || !input) return;
  if (it.p) {
    input.value = it.p.name;
    sug.mute = true;
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    sug.mute = false;
  }
  hideSuggest();
}

// ---- Pestaña Clientes
var HIST_LABEL = { cambio: 'Cambio', venta: 'Venta', prestamo: 'Préstamo', deuda: 'Deuda' };
function histItemHtml(h) {
  var r = h.rec, title, tag = '', amt, icn = 'i-swap', av = 'tr';
  if (h.kind === 'cambio') {
    title = 'Cambio ' + fmtMoney(r.received, r.inCurrency) + ' → ' + r.outCurrency;
    tag = h.status === 'completada' ? '' : '<span class="tag warn">' + (C.exchangeSettlement(r).side === 'in' ? 'Falta cobrar ' : 'Falta entregar ') + fmtMoney(h.pending, h.pendingCurrency) + '</span>';
    var pr = C.exchangeProfit(r, rates()).profit;
    amt = '<span class="' + (h.status === 'completada' ? trend(pr) : 'muted') + '">' + fmtSigned(pr, base()) + '</span><div class="sub">' + (h.status === 'completada' ? 'ganancia' : 'prevista') + '</div>';
  } else if (h.kind === 'venta') {
    icn = 'i-in'; av = 'in';
    title = r.concept ? esc(r.concept) : 'Venta';
    tag = h.status === 'contado' ? '<span class="tag ok-soft">Contado</span>' : h.status === 'pagada' ? '<span class="tag ok">Cobrada</span>' : '<span class="tag warn">Falta cobrar ' + fmtMoney(h.pending, r.currency) + '</span>';
    amt = '<span class="up">+' + fmtMoney(r.amount, r.currency) + '</span>';
  } else if (h.kind === 'prestamo') {
    var give = r.kind !== 'recibido'; icn = give ? 'i-out' : 'i-in'; av = give ? 'out' : 'in';
    title = (give ? 'Le prestaste ' : 'Te prestó ') + fmtMoney(r.principal, r.currency);
    tag = h.status === 'pagada' ? '<span class="tag ok">Pagado</span>' : h.status === 'vencida' ? '<span class="tag danger">Vencido</span>' : '<span class="tag">Pendiente ' + fmtMoney(h.pending, r.currency) + '</span>';
    amt = fmtMoney(h.pending, r.currency) + '<div class="sub">pendiente</div>';
  } else {
    var cob = r.kind === 'cobrar'; icn = cob ? 'i-in' : 'i-out'; av = cob ? 'in' : 'out';
    title = (cob ? 'Te debe' : 'Le debes') + (r.concept ? ' · ' + esc(r.concept) : '');
    tag = h.status === 'pagada' ? '<span class="tag ok">Saldada</span>' : h.status === 'parcial' ? '<span class="tag">Parcial</span>' : '<span class="tag warn">Pendiente</span>';
    amt = fmtMoney(h.status === 'pagada' ? r.amount : h.pending, r.currency) + '<div class="sub">' + (h.status === 'pagada' ? 'total' : 'pendiente') + '</div>';
  }
  return '<li class="clickable" data-hist="' + h.kind + '|' + h.id + '" tabindex="0" role="button"><span class="avatar ' + av + '">' + icon(icn) + '</span>' +
    '<div class="main"><div class="title">' + title + '</div><div class="sub hist-sub">' + fmtDate(h.date) + (tag ? ' ' + tag : '') + '</div></div>' +
    '<div class="amt">' + amt + '</div></li>';
}
function renderPersonCard() {
  var card = $('#person-card'), p = personOpenKey ? personByKey(personOpenKey) : null;
  if (!p) { personOpenKey = null; card.classList.add('hidden'); return; }
  var b = base(), c = p.contact || {}, hist = C.personHistory(state, p.key, S.today());
  card.classList.remove('hidden');
  card.innerHTML = '<div class="person-head"><span class="avatar">' + initials(p.name) + '</span><div class="main"><div class="name">' + esc(p.name) + '</div>' +
    '<div class="sub muted small">' + (c.phone ? esc(c.phone) + ' · ' : '') + esc(personMeta(p)) + (c.note ? '<br>' + esc(c.note) : '') + '</div></div>' +
    '<button type="button" class="link small" data-action="person-close" aria-label="Cerrar">' + icon('i-x') + '</button></div>' +
    '<div class="kv-grid">' +
      '<div><span>Te debe</span><b class="' + (p.owesYou > 0 ? 'up' : '') + '">' + fmtMoney(p.owesYou, b) + '</b></div>' +
      '<div><span>Le debes</span><b class="' + (p.youOwe > 0 ? 'down' : '') + '">' + fmtMoney(p.youOwe, b) + '</b></div>' +
      '<div><span>Ventas (' + p.sales + ')</span><b>' + fmtMoney(p.salesTotal, b) + '</b></div>' +
      '<div><span>Cambios (' + p.exchanges + ')</span><b>' + fmtMoney(p.fxVolume, b) + '</b></div>' +
      '<div><span>Ganancia en cambios</span><b class="' + trend(p.fxProfit) + '">' + fmtSigned(p.fxProfit, b) + '</b></div>' +
      '<div><span>Préstamos · deudas</span><b>' + p.loans + ' · ' + p.debts + '</b></div></div>' +
    '<div class="person-actions">' +
      '<button type="button" data-action="person-new" data-kind="cambio">+ Cambio</button>' +
      '<button type="button" data-action="person-new" data-kind="venta">+ Venta</button>' +
      '<button type="button" data-action="person-new" data-kind="prestamo">+ Préstamo</button>' +
      '<button type="button" data-action="person-new" data-kind="deuda">+ Deuda</button>' +
      '<button type="button" class="wa-btn" data-action="person-wa">' + icon('i-chat') + (p.owesYou > 0 ? 'Recordar pago' : 'WhatsApp') + '</button>' +
      '<button type="button" class="ghost" data-action="person-edit">Editar ficha</button></div>' +
    '<h3 style="margin-top:14px">Historial (' + hist.length + ')</h3>' +
    '<ul class="list">' + (hist.length ? hist.map(histItemHtml).join('') : '<li class="empty">Todavía no tiene operaciones.</li>') + '</ul>';
}
function renderClients() {
  if (accTab !== 'clientes') return;
  var b = base(), ym = thisMonth();
  var owes = C.sum(peopleCache.map(function (p) { return p.owesYou; })), owe = C.sum(peopleCache.map(function (p) { return p.youOwe; }));
  $('#ppl-count').textContent = plural(peopleCache.length, 'persona', 'personas');
  $('#ppl-stats').innerHTML = stat('Te deben', '<span class="up">' + fmtMoney(owes, b) + '</span>') + stat('Les debes', '<span class="' + (owe > 0 ? 'down' : '') + '">' + fmtMoney(owe, b) + '</span>') +
    stat('Con saldo pendiente', String(peopleCache.filter(function (p) { return p.owesYou > 0 || p.youOwe > 0; }).length)) +
    stat('Activos este mes', String(peopleCache.filter(function (p) { return p.last && p.last.slice(0, 7) === ym; }).length));
  var q = $('#ppl-search').value;
  var list = q.trim() ? C.matchPeople(peopleCache, q, 500) : peopleCache;
  $('#ppl-list').innerHTML = list.length ? list.map(function (p) {
    return '<li class="clickable' + (p.key === personOpenKey ? ' editing' : '') + '" data-person="' + esc(p.key) + '" tabindex="0" role="button">' +
      '<span class="avatar">' + initials(p.name) + '</span><div class="main"><div class="title">' + esc(p.name) + '</div>' +
      '<div class="sub">' + esc(personMeta(p)) + '</div></div><div class="amt ppl-amt">' + personBalance(p, b) + '</div></li>';
  }).join('') : '<li class="empty">' + (q.trim() ? 'Nadie coincide con «' + esc(q.trim()) + '». Créalo abajo o al registrar una operación.' : 'Aún no hay clientes: aparecen solos al registrar cambios, ventas, préstamos o deudas.') + '</li>';
  renderPersonCard();
}
function openPerson(key) {
  personOpenKey = key;
  if (accTab !== 'clientes') showView('cuentas/clientes');
  renderClients();
  $('#person-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function openHistItem(kind, id) {
  if (kind === 'cambio') { var x = byId(state.exchanges, id), st = x && C.exchangeSettlement(x); if (st && st.status !== 'pagada') openFxSettle(id); else editFx(id); }
  else if (kind === 'venta') { var sv = byId(state.sales, id); if (sv && sv.mode === 'credito') openRef('sale', id); else editSale(id); }
  else if (kind === 'prestamo') openRef('loan', id);
  else if (kind === 'deuda') editDebt(id);
}
/** Empieza una operación nueva con el nombre del cliente ya escrito. */
function personNew(kind) {
  var p = personByKey(personOpenKey); if (!p) return;
  var f;
  if (kind === 'cambio') { showView('cuentas/cambios'); resetFxForm(); f = $('#fx-form'); f.client.value = p.name; syncFxForm(); f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.amount.focus({ preventScroll: true }); }
  else if (kind === 'venta') { showView('cuentas/ventas'); resetSaleForm(); f = $('#sale-form'); f.client.value = p.name; f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.concept.focus({ preventScroll: true }); }
  else if (kind === 'prestamo') { showView('cuentas/prestamos'); resetLoanForm(); f = $('#loan-form'); f.person.value = p.name; f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.principal.focus({ preventScroll: true }); }
  else { showView('cuentas/cobrar'); resetDebtForm(); f = $('#debt-form'); f.person.value = p.name; f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.amount.focus({ preventScroll: true }); }
}
function resetContactForm() {
  var f = $('#contact-form'); f.reset(); f.editKey.value = '';
  $('#contact-form-title').textContent = 'Nuevo cliente';
  $('[data-action="cancel-contact"]').classList.add('hidden'); $('[data-action="delete-contact"]').classList.add('hidden');
}
function editContact() {
  var p = personByKey(personOpenKey); if (!p) return;
  var f = $('#contact-form'), c = p.contact || {};
  f.editKey.value = p.key; f.label.value = p.name; f.phone.value = c.phone || ''; f.note.value = c.note || '';
  $('#contact-form-title').textContent = 'Editar cliente';
  $('[data-action="cancel-contact"]').classList.remove('hidden');
  $('[data-action="delete-contact"]').classList.toggle('hidden', !p.contact);
  f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.label.focus({ preventScroll: true });
}
/** Cambia el nombre en todas las operaciones de una persona (y une historiales si el nombre nuevo ya existía). */
function renamePerson(oldKey, name) {
  var n = 0, fix = function (list, field) { (list || []).forEach(function (r) { if (C.personKey(r[field]) === oldKey && r[field] !== name) { r[field] = name; n++; } }); };
  fix(state.debts, 'person'); fix(state.exchanges, 'client'); fix(state.sales, 'client'); fix(state.loans, 'person'); fix(state.contacts, 'name');
  return n;
}
function onContactSubmit(e) {
  e.preventDefault();
  var f = e.target, name = f.label.value.trim().replace(/\s+/g, ' ');
  if (!name) { toast('Escribe el nombre'); f.label.focus(); return; }
  var key = C.personKey(name), oldKey = f.editKey.value;
  if (oldKey && key !== oldKey && personByKey(key) && !confirm('Ya existe «' + personByKey(key).name + '». ¿Unir los dos historiales en uno solo?')) return;
  var changed = oldKey ? renamePerson(oldKey, name) : 0;
  state.contacts = state.contacts || [];
  var mine = state.contacts.filter(function (c) { return C.personKey(c.name) === key; });
  if (mine.length > 1) state.contacts = state.contacts.filter(function (c) { return c === mine[0] || C.personKey(c.name) !== key; });  // una sola ficha por persona
  var c = mine[0];
  if (c) { c.name = name; c.phone = f.phone.value.trim(); c.note = f.note.value.trim(); }
  else state.contacts.push({ id: S.uid(), name: name, phone: f.phone.value.trim(), note: f.note.value.trim(), createdAt: Date.now() });
  personOpenKey = key;
  resetContactForm();
  persist();
  toast(oldKey ? 'Cliente actualizado' + (changed ? ' · nombre cambiado en ' + plural(changed, 'registro', 'registros') : '') : (personByKey(key) && personByKey(key).total ? 'Ficha guardada' : 'Cliente creado: ' + name));
}
