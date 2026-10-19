/* =========================================================================
 * app/eventos.js — renderAll() y todos los eventos (delegación).
 * La interfaz está repartida en js/app/*.js: todos comparten el ámbito global
 * (funciones y variables de nivel superior) y se cargan en el orden de index.html.
 * ========================================================================= */
'use strict';

// ================================================================ render
function renderAll() {
  renderSelects();
  renderHome();
  renderTxList();
  renderAccounts();
  renderPortfolio();
  renderSettings();
  renderSyncStatus();
  syncTxForm();
  updateInvPreview();
  renderAnalysis();
  renderAdvice();
  renderBackupReminder();
  renderThirdParty();
  renderAccountView();
  renderSyncCard();
  if ($('#view-ajustes').classList.contains('active')) renderVersionsCard();
}

// ================================================================ eventos
function bind() {
  $('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]'); if (b) showView(b.dataset.view);
  });
  window.addEventListener('hashchange', function () { showView(location.hash.slice(1)); });

  // Clientes: buscador, ficha y sugerencias al escribir el nombre
  $('#ppl-search').addEventListener('input', renderClients);
  $('#contact-form').addEventListener('submit', onContactSubmit);
  document.addEventListener('focusin', function (e) { if (e.target.matches && e.target.matches('input[data-people]')) showSuggest(e.target); });
  document.addEventListener('input', function (e) { if (e.target.matches && e.target.matches('input[data-people]')) { sug.sel = -1; showSuggest(e.target); } });
  document.addEventListener('focusout', function (e) { if (e.target === sug.input) setTimeout(function () { if (document.activeElement !== sug.input) hideSuggest(); }, 150); });
  document.addEventListener('keydown', function (e) {
    if (!sug.input || e.target !== sug.input) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sug.sel = (sug.sel + (e.key === 'ArrowDown' ? 1 : -1) + sug.items.length) % sug.items.length; showSuggest(sug.input); }
    else if (e.key === 'Enter' && sug.sel >= 0) { e.preventDefault(); chooseSuggest(sug.sel); }
    else if (e.key === 'Escape') hideSuggest();
  });
  // pointerdown (antes de que el campo pierda el foco) para elegir una sugerencia
  document.addEventListener('pointerdown', function (e) {
    var li = e.target.closest && e.target.closest('.people-suggest li');
    if (li) { e.preventDefault(); chooseSuggest(Number(li.dataset.sug)); }
  });

  var sf = $('#sale-form');
  sf.addEventListener('submit', onSaleSubmit);
  sf.addEventListener('input', syncSaleForm);
  sf.addEventListener('change', function (e) { if (e.target.name === 'currency') renderSaleAccounts(); syncSaleForm(); });
  $('#sale-month').addEventListener('change', renderSales);
  var lf = $('#loan-form');
  lf.addEventListener('submit', onLoanSubmit);
  lf.addEventListener('input', syncLoanForm);
  lf.addEventListener('change', function (e) { if (e.target.name === 'currency') renderLoanAccounts(); syncLoanForm(); });
  $$('input[name="loan-filter"]').forEach(function (r) { r.addEventListener('change', renderLoans); });

  var tf = $('#tx-form');
  tf.addEventListener('submit', onTxSubmit);
  $$('input[name="type"]', tf).forEach(function (r) { r.addEventListener('change', function () { renderCategorySelect(); syncTxForm(); }); });
  tf.addEventListener('input', syncTxForm);
  tf.addEventListener('change', syncTxForm);

  var inf = $('#inv-form');
  inf.addEventListener('submit', onInvSubmit);
  inf.currency.addEventListener('change', renderInvAccountSelect);
  inf.accountId.addEventListener('change', renderInvAccountSelect);
  $$('input[name="side"]', inf).forEach(function (r) { r.addEventListener('change', renderInvAccountSelect); });
  inf.addEventListener('input', updateInvPreview);
  inf.addEventListener('change', updateInvPreview);

  $('#acc-form').addEventListener('submit', onAccSubmit);
  $('#profile-form').addEventListener('submit', onProfileSubmit);
  var qs = $('#quick-sheet');
  qs.addEventListener('submit', onQuickSubmit);
  $('#quick-backdrop').addEventListener('click', closeQuick);   // tocar fuera de la hoja la cierra
  $$('input[name="qtype"]', qs).forEach(function (r) { r.addEventListener('change', function () { quick.type = r.value; quick.categoryId = null; renderQuick(); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('sheet-open')) closeQuick(); });
  // Frase escrita en el «+»: Enter la interpreta (no guarda todavía)
  $('#quick-sheet').say.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); applySay(e.target.value); }
  });
  $('#privacy-on-open').checked = !!uiPrefs().privacyOnOpen;
  $('#privacy-on-open').addEventListener('change', function (e) { setUiPref('privacyOnOpen', e.target.checked); });
  bindMix();
  bindLook();
  bindReceipts();
  bindGestures();
  $('#sync-card').addEventListener('submit', onSyncForm);
  $('#debt-form').addEventListener('submit', onDebtSubmit);
  $('#debt-form').currency.addEventListener('change', renderDebtAccountSelect);
  $('#pay-form').addEventListener('submit', onPaySubmit);
  $$('input[name="debt-filter"]').forEach(function (r) { r.addEventListener('change', renderDebts); });
  $('#debt-search').addEventListener('input', renderDebts);
  var fxf = $('#fx-form');
  fxf.addEventListener('submit', onFxSubmit);
  fxf.addEventListener('input', function (e) { syncFxForm(e.target.name); });
  fxf.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.c === 'currency') { var row = t.closest('.cost-row'); fillSelect(row.querySelector('[data-c="accountId"]'), accountsFor(t.value, 'Ninguna'), ''); }
    syncFxForm(t.name);
  });
  $('#fx-month').addEventListener('change', renderExchanges);

  ['#f-month', '#f-type', '#f-account'].forEach(function (s) { $(s).addEventListener('change', renderTxList); });
  // Historial completo: alcance, filtros y orden
  $$('input[name="hist-scope"]').forEach(function (r) { r.addEventListener('change', function () { setUiPref('histScope', r.value); lgLimit = 200; renderTxList(); }); });
  ['#lg-month', '#lg-group', '#lg-account', '#lg-sort', '#lg-issues'].forEach(function (sel) { $(sel).addEventListener('change', function () { lgLimit = 200; renderLedger(); }); });
  var lgT;
  $('#lg-q').addEventListener('input', function () { clearTimeout(lgT); lgT = setTimeout(function () { lgLimit = 200; renderLedger(); }, 150); });

  $('#base-select').addEventListener('change', function (e) { changeBase(e.target.value); });
  $('#auto-fx').addEventListener('change', function (e) {
    state.settings.autoFx = e.target.checked; persist();
    if (e.target.checked) refreshPrices(true);
  });

  $('#add-currency').addEventListener('submit', async function (e) {
    e.preventDefault();
    var f = e.target;
    var code = f.code.value.trim().toUpperCase().split(/\s|·/)[0], r = num(f.rate.value);
    if (!/^[A-Z0-9]{2,10}$/.test(code)) { toast('Código inválido'); return; }
    if (rates()[code]) { toast(code + ' ya existe'); return; }
    if (C.PEGGED[code]) {
      // USDT y USDC: siempre 1 USD
      if (!(C.rateOf(rates(), C.PEGGED[code]) > 0)) await P.refreshRates(state.settings, [C.PEGGED[code]]).catch(function () {});
      r = C.rateOf(rates(), C.PEGGED[code]);
      if (!(r > 0)) { toast('Primero necesito la tasa del USD; revisa tu conexión.'); return; }
      rates()[code] = r; f.reset(); persist(); toast(code + ' añadida: 1 ' + code + ' = 1 ' + C.PEGGED[code]);
      return;
    }
    if (r > 0) {
      rates()[code] = r; state.settings.rateLocks[code] = true; // tasa escrita a mano: queda fija
      f.reset(); persist(); toast(code + ' añadida con tasa manual');
      return;
    }
    // Sin tasa: conectarla a las tasas automáticas (en vivo si Binance tiene par)
    toast('Buscando la tasa de ' + code + '…');
    try { await P.refreshRates(state.settings, [code]); } catch (err) { /* sin conexión */ }
    if (!(rates()[code] > 0)) { toast('No encontré la tasa de ' + code + '. Escríbela a mano.'); f.rate.focus(); return; }
    var src = (state.settings.rateSources || {})[code] || {};
    f.reset(); persist();
    toast(code + ' añadida · ' + (src.live ? 'en vivo (Binance)' : 'tasa diaria') + ': 1 ' + code + ' = ' + fmtNum(rates()[code], 0, 6) + ' ' + base());
  });

  $('#finnhub-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var key = e.target.key.value.trim();
    state.settings.finnhubKey = key;
    e.target.reset(); persist();
    if (!key) { toast('Key eliminada'); return; }
    toast('Probando la key…');
    var r = await P.fetchStocks(['AAPL'], key);
    toast(r.AAPL && !r.AAPL.error ? 'Key válida ✓ (AAPL ' + fmtPrice(r.AAPL.price, 'USD') + ')' : 'La key no funcionó: ' + r.AAPL.error);
    refreshPrices(false);
  });

  $$('[data-add-cat]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.label.value.trim(), type = form.dataset.addCat;
      if (!name) return;
      if (state.categories.some(function (c) { return c.type === type && c.name.toLowerCase() === name.toLowerCase(); })) { toast('Ya existe'); return; }
      state.categories.push({ id: S.uid(), name: name, type: type });
      form.reset(); persist();
    });
  });

  $('#add-method').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = e.target.label.value.trim(); if (!name) return;
    state.methods.push({ id: S.uid(), name: name }); e.target.reset(); persist();
  });

  $('#restore').addEventListener('change', function (e) {
    if (e.target.files[0]) restoreBackup(e.target.files[0]);
    e.target.value = '';
  });

  // Se maneja el envío (no el evento «close», que no todos los navegadores emiten igual)
  $('#price-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var dlg = $('#price-dialog'), f = e.target;
    if (!e.submitter || e.submitter.value !== 'ok') { dlg.close(); return; }
    var p = num(f.price.value);
    if (!(p > 0)) { toast('Ingresa un precio mayor a 0'); f.price.focus(); return; }
    state.prices[f.dataset.key] = { price: C.round(p, 8), currency: f.dataset.cur, change24h: null, time: Date.now(), source: 'manual', error: null };
    dlg.close();
    persist(); toast('Precio guardado');
  });

  // Inputs editables de Ajustes
  document.addEventListener('change', function (e) {
    var el = e.target, d = el.dataset;
    if (d.rate) {
      var r = num(el.value);
      if (!(r > 0)) { toast('Tasa inválida'); el.value = rates()[d.rate]; return; }
      rates()[d.rate] = r; state.settings.rateLocks[d.rate] = true;
      persist(); toast('Tasa de ' + d.rate + ' fijada a mano');
    } else if (d.renameCat || d.renameMethod) {
      var item = byId(d.renameCat ? state.categories : state.methods, d.renameCat || d.renameMethod);
      var name = el.value.trim();
      if (!name) { el.value = item.name; return; }
      item.name = name; persist(); toast('Renombrado');
    }
  });

  // Filas editables (clic o Enter)
  function openRow(e) {
    var oa = e.target.closest('[data-open-account]');
    if (oa) { openAccount(oa.dataset.openAccount); return true; }
    var od = e.target.closest('[data-open-debt]');
    if (od) { editDebt(od.dataset.openDebt); return true; }
    var lgr = e.target.closest('[data-lg]');
    if (lgr) { var lp = lgr.dataset.lg.split('|'); openLedgerRow(lp[0], lp[1], lp[2]); return true; }
    var pk = e.target.closest('[data-person]');
    if (pk) { openPerson(pk.dataset.person); return true; }
    var hi = e.target.closest('[data-hist]');
    if (hi) { var hp = hi.dataset.hist.split('|'); openHistItem(hp[0], hp[1]); return true; }
    var pref = e.target.closest('[data-pay-ref]');
    if (pref) { var pr = pref.dataset.payRef.split('|'); openRef(pr[0], pr[1], { stay: accTab === 'cobrar' || accTab === 'pagar' }); return true; }
    var esv = e.target.closest('[data-edit-sale]');
    if (esv) { editSale(esv.dataset.editSale); return true; }
    var sfx = e.target.closest('[data-settle-fx]');
    if (sfx) { openFxSettle(sfx.dataset.settleFx); return true; }
    var ofx = e.target.closest('[data-open-fx]');
    if (ofx) { editFx(ofx.dataset.openFx); return true; }
    var ao = e.target.closest('[data-open-asset]');
    if (ao) { var parts = ao.dataset.openAsset.split('|'); $('#asset-search').value = ''; openAsset(parts[0], parts[1]); return true; }
    var row = e.target.closest('li[data-edit-tx], li[data-edit-inv]');
    if (!row) return false;
    if (row.dataset.editTx) editTx(row.dataset.editTx); else editInv(row.dataset.editInv);
    return true;
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('li[data-edit-tx], li[data-edit-inv], [data-open-asset], li[data-open-debt], li[data-open-fx], li[data-settle-fx], li[data-pay-ref], li[data-edit-sale], li[data-person], li[data-hist], li[data-lg], [data-open-account]')) openRow(e); });
  $$('input[name="ex-tab"]').forEach(function (r) { r.addEventListener('change', function () { explore.tab = r.value; renderExplore(); }); });
  $('#ex-fit').addEventListener('change', renderExplore);

  // Buscador de activos
  var si = $('#asset-search'), sTimer;
  si.addEventListener('focus', runSearch);
  si.addEventListener('input', function () { clearTimeout(sTimer); sTimer = setTimeout(runSearch, 120); });
  si.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchSel(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearchSel(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); openFromSearch(); }
    else if (e.key === 'Escape') { hideSearch(); si.blur(); }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.search')) hideSearch(); });

  // La conexión en vivo se pausa con la app en segundo plano
  document.addEventListener('visibilitychange', function () {
    if (!asset) return;
    if (document.visibilityState === 'hidden') { if (asset.conn) asset.conn.close(); asset.conn = null; asset.status = 'offline'; }
    else if (!asset.conn) startLive();
  });

  // Clicks delegados
  document.addEventListener('click', function (e) {
    var el = e.target.closest('button');
    if (!el) { openRow(e); return; }
    var d = el.dataset;
    if (receiptClick(d)) return;
    if (d.action === 'debt-search-all') { $('#df-all').checked = true; renderDebts(); return; }
    if (d.goto) showView(d.goto);
    else if (d.action === 'open-search') openGlobalSearch();   // lupa de arriba: búsqueda en toda la app (app/busqueda.js)
    else if (d.action === 'asset-back') showView('inversiones');
    else if (d.openAccount) openAccount(d.openAccount);
    else if (d.action === 'account-back') showView('cuentas');
    else if (d.action === 'ac-buy') buyFromAccount();
    else if (d.action === 'ac-move') { var accId = currentAccountId; showView('movimientos'); var tfm = $('#tx-form'); tfm.accountId.value = accId; tfm.fromAccountId.value = accId; syncTxForm(); }
    else if (d.action === 'account-all-moves') { var aid = currentAccountId; $('#f-account').value = aid; $('#f-month').value = ''; $('#f-type').value = ''; showView('movimientos'); renderTxList(); }
    else if (d.accTab) showView('cuentas/' + d.accTab);
    else if (d.action === 'cancel-debt') { resetDebtForm(); renderDebts(); }
    else if (d.action === 'delete-debt') {
      var dd = byId(state.debts, $('#debt-form').editId.value);
      if (dd && confirm('¿Eliminar «' + (dd.concept || dd.person) + '» y sus abonos? Los saldos de las cuentas se recalculan.')) {
        invalidateSnapshots(dd.date);
        state.debts = state.debts.filter(function (x) { return x !== dd; });
        resetDebtForm(); persist(); toast('Eliminado');
      }
    } else if (d.delSettle) { deleteSettlement(d.delSettle); }
    else if (d.delRefPay) { deleteRefPay(d.delRefPay); }
    else if (d.action === 'sale-edit') { editSale(d.id); }
    else if (d.action === 'cancel-sale') { resetSaleForm(); renderSales(); }
    else if (d.action === 'delete-sale') {
      var sv = byId(state.sales, $('#sale-form').editId.value);
      if (sv && confirm('¿Eliminar esta venta' + ((sv.payments || []).length ? ' y sus cobros' : '') + '? Los saldos se recalculan.')) {
        invalidateSnapshots(sv.date); state.sales = state.sales.filter(function (x) { return x !== sv; });
        payRef = null; resetSaleForm(); persist(); toast('Venta eliminada');
      }
    }
    else if (d.action === 'loan-edit') { editLoan(d.id); }
    else if (d.action === 'person-close') { personOpenKey = null; renderClients(); }
    else if (d.action === 'lg-more') { lgLimit += 200; renderLedger(); }
    else if (d.action === 'lg-csv') { exportLedgerCSV(); }
    else if (d.action === 'person-new') { personNew(d.kind); }
    else if (d.action === 'person-edit') { editContact(); }
    else if (d.action === 'cancel-contact') { resetContactForm(); }
    else if (d.action === 'delete-contact') {
      var pc = personByKey(personOpenKey);
      if (pc && pc.contact && confirm('¿Eliminar la ficha de «' + pc.name + '» (teléfono y nota)? Sus operaciones no se borran.')) {
        state.contacts = state.contacts.filter(function (x) { return C.personKey(x.name) !== pc.key; });
        resetContactForm(); persist(); toast('Ficha eliminada');
      }
    }
    else if (d.action === 'cancel-loan') { resetLoanForm(); renderLoans(); }
    else if (d.action === 'delete-loan') {
      var ln = byId(state.loans, $('#loan-form').editId.value);
      if (ln && confirm('¿Eliminar este préstamo' + ((ln.payments || []).length ? ' y sus pagos' : '') + '? Los saldos se recalculan.')) {
        invalidateSnapshots(ln.date); state.loans = state.loans.filter(function (x) { return x !== ln; });
        payRef = null; resetLoanForm(); persist(); toast('Préstamo eliminado');
      }
    }
    else if (d.action === 'fx-open-edit') { payFx = null; payRef = null; $('#debt-payments').classList.add('hidden'); editFx(d.id); }
    else if (d.action === 'fx-fix-settle-acc') {
      var fxx = byId(state.exchanges, d.id), fst = fxx && C.exchangeSettlement(fxx);
      if (fst) {
        var acc2 = fst.side === 'in' ? fxx.inAccountId : fxx.outAccountId;
        (fxx.settlements || []).forEach(function (z) { if (!(z.splits && z.splits.length) && z.accountId !== acc2) { invalidateSnapshots(z.date); z.accountId = acc2; } });
        persist(); editFx(fxx.id);
        toast((fst.side === 'in' ? 'Cobros movidos a ' : 'Entregas movidas a ') + accName(acc2));
      }
    }
    else if (d.action === 'fx-settle') { openFxSettle(d.id); }
    else if (d.delPay) {
      var dp = byId(state.debts, $('#debt-form').editId.value);
      if (dp && confirm('¿Eliminar este abono?')) {
        var pm = byId(dp.payments, d.delPay); if (pm) invalidateSnapshots(pm.date);
        dp.payments = dp.payments.filter(function (x) { return x.id !== d.delPay; });
        $('#pay-form').dataset.debt = ''; persist(); toast('Abono eliminado');
      }
    } else if (d.action === 'add-cost') { fxCostRow(); syncFxForm(); }
    else if (d.action === 'flip-rate') {
      var ff = $('#fx-form'), effR = effectiveRate();
      ff.dataset.rateInv = rateInv() ? '' : '1';
      showRate(effR); syncFxForm();
    } else if (d.action === 'fx-market-rate') { setMarketRate(); syncFxForm('rate'); delete $('#fx-form').dataset.rateTouched; syncFxForm(); }
    else if (d.action === 'fx-recalc') { delete $('#fx-form').dataset.deliveredTouched; syncFxForm(); }
    else if (d.action === 'del-cost') { el.closest('.cost-row').remove(); syncFxForm(); }
    else if (d.action === 'cancel-fx') { resetFxForm(); renderExchanges(); }
    else if (d.action === 'delete-fx') {
      var xx = byId(state.exchanges, $('#fx-form').editId.value);
      if (xx && confirm('¿Eliminar este cambio? Los saldos de las cuentas se recalculan.')) {
        invalidateSnapshots(xx.date);
        state.exchanges = state.exchanges.filter(function (y) { return y !== xx; });
        resetFxForm(); persist(); toast('Cambio eliminado');
      }
    }
    else if (d.action === 'csv-debts') exportDebtsCSV();
    else if (d.action === 'sync-now') Sync.syncNow();
    else if (d.action === 'quick-open') openQuick();
    else if (d.action === 'quick-close') closeQuick();
    else if (d.action === 'quick-voice') quickVoice();
    else if (d.action === 'year-csv') exportYearCSV();
    else if (d.action === 'explore-retry') loadExplore(true);
    else if (d.action === 'summary-dismiss') { state.settings.summarySeen = d.month; persist(); }
    else if (d.action === 'review-profile') { editingProfile = true; showView('consejos'); renderAdvice(); window.scrollTo(0, 0); }
    else if (d.qAcc) { quick.accountId = d.qAcc; renderQuick(); }
    else if (d.qCat) { quick.categoryId = d.qCat; renderQuick(); }
    else if (d.action === 'quick-transfer') {
      closeQuick(); showView('movimientos');
      var tfq = $('#tx-form'); tfq.type.value = 'transferencia'; renderCategorySelect(); syncTxForm();
      setTimeout(function () { tfq.amount.focus(); }, 0);
    } else if (d.action === 'quick-exchange') { closeQuick(); showView('cuentas/cambios'); setTimeout(function () { $('#fx-form').amount.focus(); }, 0); }
    else if (d.action === 'toggle-privacy') togglePrivacy();
    else if (d.action === 'backup-local-now') safetyBackup('manual').then(function () { renderVersionsCard(); toast('Copia guardada en este dispositivo'); });
    else if (d.restoreLocal) restoreFrom('local', d.restoreLocal);
    else if (d.restoreCloud) restoreFrom('cloud', d.restoreCloud);
    else if (d.action === 'cloud-versions') {
      Sync.listCloudVersions().then(function (l) { cloudVersions = l; renderVersionsCard(); })
        .catch(function (e) { if (e.missing) { cloudVersions = { missing: true }; renderVersionsCard(); } else toast(e.message); });
    } else if (d.action === 'cloud-version-now') {
      Sync.saveVersionNow('manual').then(function () { toast('Versión guardada en la nube'); return Sync.listCloudVersions(); })
        .then(function (l) { cloudVersions = l; renderVersionsCard(); })
        .catch(function (e) { if (e.missing) { cloudVersions = { missing: true }; renderVersionsCard(); } else toast(e.message); });
    } else if (d.action === 'sync-forgot') {
      var em = ($('#sync-body input[name="email"]') || {}).value;
      if (!em || em.indexOf('@') === -1) { toast('Escribe primero tu correo arriba'); return; }
      Sync.recover(em.trim()).then(function () { toast('Te enviamos un correo para elegir una contraseña nueva. Ábrelo en este dispositivo.'); })
        .catch(function (e) { toast(e.message); });
    }
    else if (d.action === 'sync-retry') { syncStep = null; renderSyncCard(); }
    else if (d.action === 'sync-reset-config') { Sync.configure('', ''); renderSyncCard(); }
    else if (d.action === 'sync-signout') {
      if (confirm('¿Cerrar sesión en este dispositivo? Tus datos locales se conservan; la sincronización se detiene hasta que vuelvas a entrar.')) {
        Sync.signOut().then(function () { syncStep = null; renderSyncCard(); toast('Sesión cerrada'); });
      }
    }
    else if (d.action === 'csv-fx') exportFxCSV();
    else if (d.assetRange) { asset.range = d.assetRange; renderAssetRanges(); loadAssetHistory(); }
    else if (d.assetOp) prefillOperation(d.assetOp);
    else if (d.action === 'delete-tx') { var txId = $('#tx-form').editId.value; if (txId) deleteWithUndo('tx', txId); }
    else if (d.action === 'delete-inv') { var invId = $('#inv-form').editId.value; if (invId) deleteWithUndo('inv', invId); } else if (d.editAcc) editAcc(d.editAcc);
    else if (d.accMoves) {
      $('#f-account').value = d.accMoves; $('#f-month').value = ''; $('#f-type').value = '';
      showView('movimientos'); renderTxList();
    } else if (d.manualPrice) openManualPrice(d.manualPrice, d.cur);
    else if (d.lock) {
      var locks = state.settings.rateLocks;
      if (locks[d.lock]) { delete locks[d.lock]; persist(); refreshPrices(true); }
      else { locks[d.lock] = true; persist(); }
    } else if (d.delCur) {
      delete rates()[d.delCur]; delete state.settings.rateLocks[d.delCur]; persist();
    } else if (d.delCat) {
      state.categories = state.categories.filter(function (c) { return c.id !== d.delCat; }); persist();
    } else if (d.delMethod) {
      state.methods = state.methods.filter(function (m) { return m.id !== d.delMethod; }); persist();
    } else if (d.action === 'cancel-tx') resetTxForm();
    else if (d.action === 'cancel-inv') resetInvForm();
    else if (d.action === 'cancel-acc') resetAccForm();
    else if (d.action === 'delete-acc') {
      var id = $('#acc-form').editId.value;
      if (accountInUse(id)) return;
      if (confirm('¿Eliminar la cuenta «' + accName(id) + '»?')) {
        state.accounts = state.accounts.filter(function (a) { return a.id !== id; });
        resetAccForm(); persist(); toast('Cuenta eliminada');
      }
    }
    else if (d.action === 'refresh') refreshPrices(true);
    else if (d.action === 'csv-tx') exportTxCSV();
    else if (d.action === 'csv-acc') exportAccCSV();
    else if (d.action === 'csv-inv') exportInvCSV();
    else if (d.action === 'backup') {
      state.settings.lastBackupAt = Date.now();
      S.download('finanzas_backup_' + S.today() + '.json', JSON.stringify(state, null, 2), 'application/json');
      persist(); toast('Copia descargada. Guárdala en un lugar seguro.');
    }
    else if (d.action === 'start-profile' || d.action === 'edit-profile') { editingProfile = true; showView('consejos'); renderAdvice(); }
    else if (d.action === 'cancel-profile') {
      if (state.profile) { editingProfile = false; renderAdvice(); } else showView('inicio');
    }
    else if (d.action === 'sample') { loadSample(); refreshPrices(false); }
    else if (d.action === 'reset') {
      if (confirm('¿Borrar TODOS los datos? Esta acción no se puede deshacer. Te recomendamos exportar una copia antes.')) {
        safetyBackup('antes de borrar todo').then(function () {
          S.clear(); state = S.defaults(); resetTxForm(); resetInvForm(); resetAccForm(); persist(); toast('Datos borrados');
        });
      }
    }
  });

  // Tooltip de gráficos y avisos (ratón y teclado; en táctil, al tocar)
  var tip = $('#tooltip');
  function showTip(el, x, y) {
    tip.textContent = el.dataset.tip;
    tip.classList.add('show');
    var w = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px';
    tip.style.top = Math.max(8, y - tip.offsetHeight - 12) + 'px';
  }
  document.addEventListener('mousemove', function (e) {
    if (e.target.closest('.chart-svg')) return; // los gráficos manejan su propio tooltip
    var el = e.target.closest('[data-tip]');
    if (el) showTip(el, e.clientX, e.clientY); else tip.classList.remove('show');
  });
  document.addEventListener('touchstart', function (e) {
    if (e.target.closest('.chart-svg')) return;
    var el = e.target.closest('[data-tip]');
    if (!el) { tip.classList.remove('show'); return; }
    var r = el.getBoundingClientRect();
    showTip(el, r.left + r.width / 2, r.top);
    clearTimeout(showTip._t); showTip._t = setTimeout(function () { tip.classList.remove('show'); }, 2500);
  }, { passive: true });

  // Análisis: filtros y redimensionado
  ['#a-range', '#a-from', '#a-to', '#a-category', '#a-account', '#a-asset'].forEach(function (sel) { $(sel).addEventListener('change', renderAnalysis); });
  $$('input[name="cat-type"]').forEach(function (r) { r.addEventListener('change', renderAnalysis); });
  $('#a-clear').addEventListener('click', function () {
    $('#a-category').value = ''; $('#a-account').value = ''; $('#a-asset').value = ''; renderAnalysis();
  });
  var rz;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(renderAnalysis, 150); });
  $('#year-sel').addEventListener('change', renderYearReport);
  var pz;
  ['#proj-start', '#proj-saving'].forEach(function (sel) { $(sel).addEventListener('input', function () { clearTimeout(pz); pz = setTimeout(renderProjection, 250); }); });

  // Actualización periódica de precios mientras la app está visible
  setInterval(function () {
    if (document.visibilityState === 'visible' && Date.now() - (state.settings.lastRefresh || 0) > REFRESH_MS) refreshPrices(false);
  }, 30 * 1000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - (state.settings.lastRefresh || 0) > REFRESH_MS) refreshPrices(false);
  });
}

/** USD, USDT y EUR siempre disponibles; USDT anclado al USD. */
async function ensureCoreCurrencies() {
  var s = state.settings, r = s.rates, missing = [];
  Object.keys(C.PEGGED).forEach(function (c) { delete s.rateLocks[c]; }); // la paridad 1:1 no se fija a mano
  ['USD', 'EUR'].forEach(function (c) { if (!(Number(r[c]) > 0) && c !== s.baseCurrency) missing.push(c); });
  if (missing.length) { try { await P.refreshRates(s, missing); } catch (e) { /* sin conexión: se reintenta al abrir */ } }
  if (!(Number(r.USDT) > 0) && C.rateOf(r, 'USD') > 0) r.USDT = C.rateOf(r, 'USD');
  if (C.rateOf(r, 'USD') > 0) r.USDT = C.rateOf(r, 'USD');
  S.save(state);
  renderAll();
}
