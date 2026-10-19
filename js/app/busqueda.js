/* =========================================================================
 * app/busqueda.js — Búsqueda global (la lupa de arriba): clientes, operaciones,
 * cuentas y activos desde cualquier pantalla. El cálculo está en Calc.globalSearch.
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

var gsTimer = null;
var gsFirst = null;   // primer resultado (Enter lo abre)

function gsOpen() { return !$('#gsearch').classList.contains('hidden'); }
function openGlobalSearch() {
  var box = $('#gsearch'), q = $('#gs-q');
  box.classList.remove('hidden');
  document.body.classList.add('gs-open');
  renderGlobalSearch();
  q.focus(); q.select();
}
function closeGlobalSearch() {
  $('#gsearch').classList.add('hidden');
  document.body.classList.remove('gs-open');
  if (document.activeElement) document.activeElement.blur();
}
/** Guarda la búsqueda entre las recientes (por dispositivo, máx. 6). */
function gsRemember(q) {
  q = String(q || '').trim(); if (!q) return;
  var list = (uiPrefs().gsRecent || []).filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); });
  list.unshift(q);
  setUiPref('gsRecent', list.slice(0, 6));
}
function gsSection(title, count, body) {
  return '<div class="gs-section"><h3>' + esc(title) + (count != null ? ' <span class="muted small">(' + count + ')</span>' : '') + '</h3><ul class="list">' + body + '</ul></div>';
}
function renderGlobalSearch() {
  var out = $('#gs-results'), q = $('#gs-q').value, b = base();
  gsFirst = null;
  if (!q.trim()) {
    var rec = uiPrefs().gsRecent || [];
    out.innerHTML = (rec.length ? '<div class="gs-section"><h3>Búsquedas recientes</h3><div class="gs-chips">' +
        rec.map(function (x) { return '<button type="button" class="chip" data-gs-recent="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div></div>' : '') +
      '<div class="gs-tips"><b>Puedes buscar:</b><ul>' +
      '<li>Un cliente: <i>Ana</i>, <i>López</i></li>' +
      '<li>Un monto: <i>150</i>, <i>&gt;100</i>, <i>&lt;20</i></li>' +
      '<li>Una nota, concepto o categoría: <i>almuerzo</i>, <i>zapatos</i></li>' +
      '<li>Una fecha: <i>14/10</i> · una cuenta: <i>zelle</i> · un activo: <i>BTC</i></li>' +
      '<li>Combinar palabras: <i>ana &gt;50</i></li></ul></div>';
    return;
  }
  var res = C.globalSearch(state, q, S.today(), {
    names: lgNames, kinds: S.ACCOUNT_KINDS, limit: 30,
    metaName: function (t, k) { var m = meta(t, k); return m && m.name && m.name.toUpperCase() !== k ? m.name : ''; }
  });
  var html = '';
  if (res.people.length) {
    html += gsSection('Clientes', res.people.length, res.people.map(function (p) {
      gsFirst = gsFirst || { kind: 'person', key: p.key };
      return '<li class="clickable" data-gs="person|' + esc(p.key) + '" tabindex="0" role="button"><span class="avatar">' + initials(p.name) + '</span>' +
        '<div class="main"><div class="title">' + esc(p.name) + '</div><div class="sub">' + esc(personMeta(p)) + '</div></div>' +
        '<div class="amt ppl-amt">' + personBalance(p, b) + '</div></li>';
    }).join(''));
  }
  if (res.ops.length) {
    var issues = C.ledgerIssues(C.ledger(state), state, S.today());
    gsFirst = gsFirst || { kind: 'op', ref: res.ops[0].ref };
    html += gsSection('Operaciones', res.opsTotal, res.ops.map(function (r) { return lgRowHtml(r, issues[r.key] || [], true); }).join('') +
      (res.opsTotal > res.ops.length ? '<li class="gs-more"><button type="button" class="link" data-gs="ledger|' + esc(q) + '">Ver las ' + res.opsTotal + ' en el historial completo →</button></li>' : ''));
  }
  if (res.accounts.length) {
    var bal = {};
    C.accountBalances(state).forEach(function (x) { bal[x.account.id] = x.balance; });
    gsFirst = gsFirst || { kind: 'account', id: res.accounts[0].id };
    html += gsSection('Cuentas', res.accounts.length, res.accounts.map(function (a) {
      return '<li class="clickable" data-gs="account|' + esc(a.id) + '" tabindex="0" role="button"><span class="avatar">' + icon(KIND_ICONS[a.kind] || 'i-wallet') + '</span>' +
        '<div class="main"><div class="title">' + esc(a.name) + '</div><div class="sub">' + esc((S.ACCOUNT_KINDS[a.kind] || '') + ' · ' + a.currency) + '</div></div>' +
        '<div class="amt">' + fmtMoney(bal[a.id] || 0, a.currency) + '</div></li>';
    }).join(''));
  }
  if (res.assets.length) {
    gsFirst = gsFirst || { kind: 'asset', type: res.assets[0].assetType, ticker: res.assets[0].ticker };
    html += gsSection('Tus activos', res.assets.length, res.assets.map(function (x) {
      return '<li class="clickable" data-gs="asset|' + esc(x.assetType) + '|' + esc(x.ticker) + '" tabindex="0" role="button">' + logoHtml(x.assetType, x.ticker, 'mini-logo') +
        '<div class="main"><div class="title">' + esc(x.ticker) + ' <span class="tag">' + esc(ASSET_LABELS[x.assetType] || x.assetType) + '</span></div>' +
        (x.name && x.name !== x.ticker ? '<div class="sub">' + esc(x.name) + '</div>' : '') + '</div></li>';
    }).join(''));
  }
  if (!html) html = '<p class="muted gs-empty">Nada coincide con «' + esc(q.trim()) + '».</p>';
  if (!/^[<>]?=?\s*[\d.,/]+$/.test(q.trim())) {
    html += '<div class="gs-section"><ul class="list"><li class="clickable" data-gs="market|' + esc(q.trim()) + '" tabindex="0" role="button">' +
      '<span class="avatar">' + icon('i-chart') + '</span><div class="main"><div class="title">Buscar «' + esc(q.trim()) + '» en el mercado</div>' +
      '<div class="sub">Cripto, acciones y ETF que aún no tienes</div></div></li></ul></div>';
  }
  out.innerHTML = html;
}
/** Abre un resultado y cierra el buscador. */
function gsChoose(spec) {
  gsRemember($('#gs-q').value);
  closeGlobalSearch();
  var p = spec.split('|');
  if (p[0] === 'person') openPerson(p[1]);
  else if (p[0] === 'account') openAccount(p[1]);
  else if (p[0] === 'asset') openAsset(p[1], p.slice(2).join('|'));
  else if (p[0] === 'ledger') {
    $('#hs-all').checked = true; setUiPref('histScope', 'all');
    $('#lg-q').value = p.slice(1).join('|'); $('#lg-month').value = ''; $('#lg-group').value = ''; $('#lg-account').value = ''; $('#lg-issues').checked = false;
    lgLimit = 200; showView('movimientos'); renderTxList();
    setTimeout(function () { $('#hist-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 0);
  } else if (p[0] === 'market') {
    showView('inversiones');
    var si = $('#asset-search'); si.value = p.slice(1).join('|');
    setTimeout(function () { si.focus(); runSearch(); }, 0);
  }
}
function gsOpenFirst() {
  var f = gsFirst; if (!f) return;
  if (f.kind === 'op') { gsRemember($('#gs-q').value); closeGlobalSearch(); openLedgerRow(f.ref.kind, f.ref.id, f.ref.pay); }
  else gsChoose(f.kind === 'person' ? 'person|' + f.key : f.kind === 'account' ? 'account|' + f.id : 'asset|' + f.type + '|' + f.ticker);
}

// ---- Eventos del buscador (se enlazan al cargar: el HTML ya existe)
(function bindGlobalSearch() {
  var box = $('#gsearch'), q = $('#gs-q');
  q.addEventListener('input', function () { clearTimeout(gsTimer); gsTimer = setTimeout(renderGlobalSearch, 120); });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); gsOpenFirst(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeGlobalSearch(); }
  });
  // Clics dentro del buscador: se resuelven aquí (no llegan a la delegación general)
  box.addEventListener('click', function (e) {
    e.stopPropagation();
    if (e.target.closest('[data-action="gs-close"]') || e.target === box) { closeGlobalSearch(); return; }
    var rc = e.target.closest('[data-gs-recent]');
    if (rc) { q.value = rc.dataset.gsRecent; renderGlobalSearch(); q.focus(); return; }
    var g = e.target.closest('[data-gs]');
    if (g) { gsChoose(g.dataset.gs); return; }
    var lr = e.target.closest('[data-lg]');
    if (lr) { var lp = lr.dataset.lg.split('|'); gsRemember(q.value); closeGlobalSearch(); openLedgerRow(lp[0], lp[1], lp[2]); }
  });
  box.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeGlobalSearch(); return; }
    if (e.key === 'Enter' && e.target.matches('li[data-gs], li[data-lg]')) { e.preventDefault(); e.target.click(); }
  });
  // Atajo en el PC: Ctrl+K (o / fuera de un campo de texto)
  document.addEventListener('keydown', function (e) {
    var typing = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
      if (!gsOpen()) { e.preventDefault(); openGlobalSearch(); }
    }
  });
})();
