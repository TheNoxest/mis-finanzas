/* =========================================================================
 * receipt.js — Comprobantes de operación y mensajes de WhatsApp.
 *
 *  - Modelos (puros, probados): qué dice cada comprobante (cambio, venta,
 *    préstamo y cada pago/abono/cobro), con número estable y montos reales
 *    (no les afecta el modo privado).
 *  - Dibujo en <canvas> → imagen (PNG/JPEG) y PDF de una página hecho a mano
 *    (la imagen JPEG embebida con /DCTDecode), sin librerías.
 *  - WhatsApp: número normalizado con código de país y enlace wa.me con el
 *    texto ya escrito; recordatorios de cobro.
 * Depende de Calc (calc.js).
 * ========================================================================= */
(function (root) {
  'use strict';

  var C = root.Calc;

  // ---------------------------------------------------------------- formato
  function money(v, cur, locale) {
    var n = Number(v) || 0;
    try {
      return new Intl.NumberFormat(locale || 'es', { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    } catch (e) { // códigos no ISO (USDT, USDC…)
      return n.toLocaleString(locale || 'es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + cur;
    }
  }
  function numTxt(v, locale, maxDp) {
    return Number(v).toLocaleString(locale || 'es', { minimumFractionDigits: 0, maximumFractionDigits: maxDp == null ? 6 : maxDp });
  }
  function dateTxt(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso || ''); }

  /** Número estable del comprobante: prefijo + fecha + 4 caracteres del id (no hace falta contador ni se repite entre dispositivos). */
  function number(prefix, date, id) {
    var d = String(date || '').replace(/-/g, '').slice(2, 8);
    return prefix + '-' + d + '-' + String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
  }

  /** Pagos ordenados como los aplica la app (fecha y luego orden de registro). */
  function ordered(list) {
    return (list || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0); });
  }
  /** Copia del registro con solo los pagos hasta `pm` incluido (para el saldo «después de este pago»). */
  function upTo(rec, field, pm) {
    var list = ordered(rec[field]), i = list.indexOf(list.filter(function (x) { return x.id === pm.id; })[0]);
    var copy = Object.assign({}, rec); copy[field] = list.slice(0, i + 1);
    return copy;
  }

  function base(ctx, extra) {
    var biz = (ctx && ctx.business) || {};
    return Object.assign({
      business: biz.name || 'Mis Finanzas', businessPhone: biz.phone || '', footer: biz.footer || '',
      rows: [], status: '', note: ''
    }, extra);
  }
  function row(label, value, strong) { return { label: label, value: value, strong: !!strong }; }

  // ---------------------------------------------------------------- modelos
  /** Cambio de divisas: lo que entrega y recibe el cliente, comisión y tasa acordada. */
  function exchangeModel(x, ctx) {
    var L = ctx && ctx.locale, inC = x.inCurrency, outC = x.outCurrency;
    var m = base(ctx, {
      kind: 'cambio', title: 'Comprobante de cambio de divisas', number: number('CAM', x.date, x.id), date: x.date,
      partyLabel: 'Cliente', party: x.client || ''
    });
    m.rows.push(row('El cliente entrega', money(x.received, inC, L)));
    var com = Number(x.commissionAmount) || 0, cm = x.commission || {};
    if (com > 0) {
      var how = cm.charge === 'aparte' ? ' (aparte)' : ' (descontada)';
      m.rows.push(row(cm.mode === 'porcentaje' ? 'Comisión ' + numTxt(cm.value, L, 4) + ' %' + how : 'Comisión' + how, money(com, inC, L)));
    }
    var rate = Number(x.rate) || 0;
    var same = C && C.pegOf ? C.pegOf(inC) === C.pegOf(outC) : inC === outC;
    m.rows.push(row('Tasa', same && rate === 1 ? '1 ' + inC + ' = 1 ' + outC
      : x.rateInv && rate > 0 ? '1 ' + outC + ' = ' + numTxt(1 / rate, L, 4) + ' ' + inC : '1 ' + inC + ' = ' + numTxt(rate, L, 6) + ' ' + outC));
    m.rows.push(row('El cliente recibe', money(x.delivered, outC, L), true));
    var st = C && C.exchangeSettlement ? C.exchangeSettlement(x) : null;
    if (x.status === 'completada' || (st && st.status === 'pagada')) m.status = 'Completado';
    else if (st) {
      var cur = st.currency;
      m.status = (st.side === 'in' ? 'Pendiente de pago: ' : 'Pendiente de entrega: ') + money(st.pending, cur, L) +
        (st.paid > 0 ? ' (ya ' + (st.side === 'in' ? 'pagado ' : 'entregado ') + money(st.paid, cur, L) + ')' : '');
    }
    m.note = x.note || '';
    return m;
  }

  /** Venta (de contado o a crédito). */
  function saleModel(sv, ctx) {
    var L = ctx && ctx.locale, cur = sv.currency;
    var m = base(ctx, {
      kind: 'venta', title: 'Comprobante de venta', number: number('VEN', sv.date, sv.id), date: sv.date,
      partyLabel: 'Cliente', party: sv.client || ''
    });
    if (sv.concept) m.rows.push(row('Concepto', sv.concept));
    var q = Number(sv.quantity) || 1;
    if (q !== 1) m.rows.push(row('Cantidad × precio', numTxt(q, L, 4) + ' × ' + money(sv.unitPrice, cur, L)));
    m.rows.push(row('Total', money(sv.amount, cur, L), true));
    var b = C.saleBalance(sv);
    if (sv.mode === 'contado') m.status = 'Pagado de contado';
    else {
      m.rows.push(row('Pagado', money(b.paid, cur, L)));
      m.rows.push(row('Pendiente', money(b.pending, cur, L)));
      m.status = b.status === 'pagada' ? 'Pagado' : 'A crédito' + (sv.dueDate ? ' · vence ' + dateTxt(sv.dueDate) : '');
    }
    m.note = sv.note || '';
    return m;
  }

  /** Préstamo: condiciones, total a devolver y estado de los pagos. */
  function loanModel(l, ctx) {
    var L = ctx && ctx.locale, cur = l.currency, st = C.loanStatus(l, ctx && ctx.today);
    var gave = l.kind !== 'recibido';
    var m = base(ctx, {
      kind: 'prestamo', title: 'Comprobante de préstamo', number: number('PRE', l.date, l.id), date: l.date,
      partyLabel: gave ? 'Prestatario' : 'Prestamista', party: l.person || ''
    });
    m.rows.push(row('Monto prestado', money(st.principal, cur, L)));
    if (ctx && ctx.loanTerms) m.rows.push(row('Condiciones', ctx.loanTerms(l)));
    m.rows.push(row('Intereses', money(st.interest, cur, L)));
    m.rows.push(row('Total a devolver', money(st.total, cur, L), true));
    m.rows.push(row('Pagado', money(st.paid, cur, L)));
    m.rows.push(row('Pendiente', money(st.pending, cur, L)));
    if (st.next) m.rows.push(row('Próxima cuota', 'N.º ' + st.next.n + ' · ' + dateTxt(st.next.date) + ' · ' + money(st.next.amount, cur, L)));
    m.status = st.status === 'pagada' ? 'Préstamo pagado' : st.overdue > 0 ? 'Vencido: ' + money(st.overdue, cur, L) : 'Al día';
    m.note = l.note || '';
    return m;
  }

  /** Cuenta por cobrar / por pagar (deuda simple). */
  function debtModel(d, ctx) {
    var L = ctx && ctx.locale, cur = d.currency, b = C.debtBalance(d), cob = d.kind === 'cobrar';
    var m = base(ctx, {
      kind: 'deuda', title: cob ? 'Estado de cuenta por cobrar' : 'Estado de cuenta por pagar', number: number('DEU', d.date, d.id), date: d.date,
      partyLabel: cob ? 'Deudor' : 'Acreedor', party: d.person || ''
    });
    if (d.concept) m.rows.push(row('Concepto', d.concept));
    m.rows.push(row('Monto', money(d.amount, cur, L), true));
    m.rows.push(row(cob ? 'Abonado' : 'Pagado', money(b.paid, cur, L)));
    m.rows.push(row('Pendiente', money(b.pending, cur, L)));
    if (d.dueDate) m.rows.push(row('Vence', dateTxt(d.dueDate)));
    m.status = b.status === 'pagada' ? 'Saldado' : 'Pendiente: ' + money(b.pending, cur, L);
    m.note = d.note || '';
    return m;
  }

  /**
   * Recibo de un pago concreto.
   *  kind: 'loan' (pago de préstamo), 'sale' (cobro de venta), 'debt' (abono), 'fx' (cobro/entrega de un cambio).
   *  parent: el registro; pm: el pago. El saldo es el que quedaba después de ese pago.
   */
  function paymentModel(kind, parent, pm, ctx) {
    var L = ctx && ctx.locale, cur, after, title, partyLabel = 'Cliente', party = '', rows = [];
    if (kind === 'loan') {
      cur = parent.currency;
      var gave = parent.kind !== 'recibido';
      title = gave ? 'Recibo de pago de préstamo' : 'Comprobante de pago de préstamo';
      partyLabel = gave ? 'Pagó' : 'Pagado a'; party = parent.person || '';
      var split = C.loanPaymentSplit(parent).filter(function (s) { return s.payment.id === pm.id; })[0];
      var stA = C.loanStatus(upTo(parent, 'payments', pm), ctx && ctx.today);
      rows.push(row('Préstamo del', dateTxt(parent.date) + ' · ' + money(parent.principal, cur, L)));
      rows.push(row('Monto pagado', money(pm.amount, cur, L), true));
      if (split && split.interest > 0) rows.push(row('A intereses', money(split.interest, cur, L)));
      if (split) rows.push(row('A capital', money(split.capital, cur, L)));
      rows.push(row('Saldo pendiente', money(stA.pending, cur, L)));
      after = stA.pending;
    } else if (kind === 'sale') {
      cur = parent.currency; title = 'Recibo de pago'; party = parent.client || '';
      after = C.saleBalance(upTo(parent, 'payments', pm)).pending;
      rows.push(row('Venta del', dateTxt(parent.date) + (parent.concept ? ' · ' + parent.concept : '')));
      rows.push(row('Total de la venta', money(parent.amount, cur, L)));
      rows.push(row('Monto pagado', money(pm.amount, cur, L), true));
      rows.push(row('Saldo pendiente', money(after, cur, L)));
    } else if (kind === 'debt') {
      cur = parent.currency; party = parent.person || '';
      var cob = parent.kind === 'cobrar';
      title = cob ? 'Recibo de abono' : 'Comprobante de pago'; partyLabel = cob ? 'Pagó' : 'Pagado a';
      after = C.debtBalance(upTo(parent, 'payments', pm)).pending;
      if (parent.concept) rows.push(row('Concepto', parent.concept));
      rows.push(row('Deuda total', money(parent.amount, cur, L)));
      rows.push(row('Monto ' + (cob ? 'abonado' : 'pagado'), money(pm.amount, cur, L), true));
      rows.push(row('Saldo pendiente', money(after, cur, L)));
    } else { // fx
      var st = C.exchangeSettlement(parent); cur = st ? st.currency : parent.inCurrency; party = parent.client || '';
      var paidIn = st && st.side === 'in';
      title = paidIn ? 'Recibo de pago del cambio' : 'Comprobante de entrega del cambio';
      // Mismo lado aunque ya esté completado: se fuerza el estado pendiente de ese lado
      var stA2 = C.exchangeSettlement(Object.assign(upTo(parent, 'settlements', pm), { status: paidIn ? 'pendiente_cobro' : 'pendiente_entrega' }));
      rows.push(row('Cambio del', dateTxt(parent.date) + ' · ' + money(parent.received, parent.inCurrency, L) + ' → ' + money(parent.delivered, parent.outCurrency, L)));
      rows.push(row(paidIn ? 'Monto pagado' : 'Monto entregado', money(pm.amount, cur, L), true));
      after = stA2 ? stA2.pending : 0;
      rows.push(row('Saldo pendiente', money(after, cur, L)));
    }
    var m = base(ctx, { kind: 'pago', title: title, number: number('REC', pm.date, pm.id), date: pm.date, partyLabel: partyLabel, party: party });
    m.rows = rows;
    m.status = after > 0 ? 'Queda pendiente ' + money(after, cur, L) : 'Saldado';
    m.note = pm.note || '';
    return m;
  }

  // ---------------------------------------------------------------- texto (WhatsApp)
  /** Mensaje con el comprobante (formato de WhatsApp: *negrita*). */
  function text(m) {
    var out = ['*' + m.business + '*', m.title, 'N.º ' + m.number + ' · ' + dateTxt(m.date)];
    if (m.party) out.push(m.partyLabel + ': ' + m.party);
    out.push('');
    m.rows.forEach(function (r) { out.push(r.label + ': ' + (r.strong ? '*' + r.value + '*' : r.value)); });
    if (m.status) { out.push(''); out.push(m.status); }
    if (m.note) out.push('Nota: ' + m.note);
    if (m.footer) { out.push(''); out.push(m.footer); }
    return out.join('\n');
  }

  /** Recordatorio amable de un pendiente. items: [{ concept, amount (texto), due (AAAA-MM-DD|null) }]. */
  function reminderText(name, items, business) {
    var first = String(name || '').trim().split(/\s+/)[0];
    var lines = ['Hola' + (first ? ' ' + first : '') + ' 👋, te escribo para recordarte ' + (items.length === 1 ? 'un pago pendiente:' : 'estos pagos pendientes:')];
    items.forEach(function (it) {
      lines.push('• ' + it.concept + ': *' + it.amount + '*' + (it.due ? ' (vence el ' + dateTxt(it.due) + ')' : ''));
    });
    lines.push('');
    lines.push('Cuando puedas, avísame. ¡Muchas gracias!');
    if (business) lines.push('— ' + business);
    return lines.join('\n');
  }

  /**
   * Línea del recordatorio para un pendiente de Calc.thirdParty (receivables).
   * Préstamo → la próxima cuota; el resto → lo que falta.
   */
  function reminderItem(it, locale) {
    if (it.source === 'prestamo' && it.next) {
      return { concept: 'Préstamo, cuota ' + it.next.n + ' de ' + it.installments, amount: money(it.next.amount, it.currency, locale), due: it.next.date };
    }
    var concept = it.source === 'venta' ? 'Venta' + (it.concept && it.concept !== 'Venta' ? ' (' + it.concept + ')' : '') + ' del ' + dateTxt(it.date)
      : it.source === 'cambio' ? 'Cambio de divisas del ' + dateTxt(it.date)
      : (it.concept || 'Deuda') + ' del ' + dateTxt(it.date);
    return { concept: concept, amount: money(it.pending, it.currency, locale), due: it.dueDate || null };
  }

  // ---------------------------------------------------------------- WhatsApp
  /**
   * Número para wa.me: solo dígitos, con código de país.
   *  «+58 412-555-1234» → 584125551234 · «0412 5551234» (país 58) → 584125551234 · «0058…» → 58…
   * Sin «+»/«00»: con 0 inicial o 10 dígitos o menos se antepone el código de país (quitando el 0).
   */
  function normalizePhone(p, cc) {
    var s = String(p || '').trim();
    if (!s) return '';
    var compact = s.replace(/[^\d+]/g, '');
    var intl = compact.charAt(0) === '+' || compact.indexOf('00') === 0;
    var d = compact.replace(/\D/g, '');
    if (compact.indexOf('00') === 0) d = d.replace(/^00/, '');
    var code = String(cc || '').replace(/\D/g, '');
    // Local: con 0 inicial (prefijo nacional) siempre; sin él, solo si es corto (si no, ya trae el código de país)
    if (!intl && code) { if (d.charAt(0) === '0') d = code + d.replace(/^0+/, ''); else if (d.length <= 10) d = code + d; }
    return d;
  }
  function waUrl(phone, msg) {
    return 'https://wa.me/' + (phone || '') + '?text=' + encodeURIComponent(msg || '');
  }

  // ---------------------------------------------------------------- dibujo
  /**
   * Dibuja el comprobante en un canvas (ancho 720 px lógicos × escala).
   * opts: { accent: '#256abf', scale: 2 }
   */
  function draw(m, canvas, opts) {
    opts = opts || {};
    var W = 720, S = opts.scale || 2, P = 44, accent = opts.accent || '#256abf';
    var font = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    var ctx = canvas.getContext('2d');
    var lines = function (txt, size, weight, maxW) {
      ctx.font = (weight || 400) + ' ' + size + 'px ' + font;
      var words = String(txt).split(/\s+/), out = [], cur = '';
      words.forEach(function (w) {
        var t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t;
      });
      if (cur) out.push(cur);
      return out.length ? out : [''];
    };
    // Primera pasada: medir la altura; segunda: dibujar
    var render = function (paint) {
      var y = 0;
      var text = function (t, x, yy, size, weight, color, align) {
        if (!paint) return;
        ctx.font = (weight || 400) + ' ' + size + 'px ' + font; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(t, x, yy);
      };
      // Cabecera con el color de acento
      var bizLines = lines(m.business, 30, 700, W - 2 * P - 170);
      var headH = 40 + bizLines.length * 36 + (m.businessPhone ? 30 : 0) + 22;
      if (paint) { ctx.fillStyle = accent; ctx.fillRect(0, 0, W, headH); }
      y = 40;
      bizLines.forEach(function (l) { y += 30; text(l, P, y, 30, 700, '#ffffff'); y += 6; });
      if (m.businessPhone) { y += 26; text(m.businessPhone, P, y, 19, 400, 'rgba(255,255,255,.88)'); }
      text('COMPROBANTE', W - P, 70, 17, 700, 'rgba(255,255,255,.92)', 'right');
      y = headH + 46;
      lines(m.title, 26, 700, W - 2 * P).forEach(function (l, i) { if (i) y += 32; text(l, P, y, 26, 700, '#111111'); });
      y += 34; text('N.º ' + m.number + '   ·   ' + dateTxt(m.date), P, y, 18, 400, '#6b6b66');
      if (m.party) {
        y += 34;
        if (paint) { ctx.fillStyle = '#f3f3f0'; ctx.fillRect(P, y - 4, W - 2 * P, 66); }
        text(m.partyLabel, P + 18, y + 22, 15, 600, '#6b6b66');
        text(m.party, P + 18, y + 50, 22, 700, '#111111');
        y += 66;
      }
      y += 22;
      m.rows.forEach(function (r) {
        var size = r.strong ? 25 : 20, weight = r.strong ? 700 : 500;
        if (r.strong) { y += 10; if (paint) { ctx.fillStyle = '#dcdbd5'; ctx.fillRect(P, y, W - 2 * P, 2); } y += 8; }
        ctx.font = weight + ' ' + size + 'px ' + font;
        var labW = Math.min(300, ctx.measureText(r.label).width + 24);
        var vals = lines(r.value, size, weight, W - 2 * P - labW);
        y += size + 14;
        text(r.label, P, y, r.strong ? 20 : 18, r.strong ? 700 : 400, r.strong ? '#111111' : '#6b6b66');
        vals.forEach(function (v, i) { if (i) y += size + 8; text(v, W - P, y, size, weight, '#111111', 'right'); });
        if (!r.strong) { y += 12; if (paint) { ctx.fillStyle = '#ecebe6'; ctx.fillRect(P, y, W - 2 * P, 1); } }
        else y += 6;
      });
      if (m.status) {
        y += 46;
        ctx.font = '700 19px ' + font;
        var sw = Math.min(W - 2 * P, ctx.measureText(m.status).width + 36);
        if (paint) { ctx.fillStyle = accent; ctx.globalAlpha = .12; roundRect(ctx, P, y - 26, sw, 40, 20); ctx.fill(); ctx.globalAlpha = 1; }
        text(m.status, P + 18, y, 19, 700, accent);
        y += 18;
      }
      if (m.note) {
        y += 20;
        lines('Nota: ' + m.note, 18, 400, W - 2 * P).forEach(function (l) { y += 26; text(l, P, y, 18, 400, '#52514e'); });
      }
      y += 40;
      if (m.footer) lines(m.footer, 18, 500, W - 2 * P).forEach(function (l) { y += 24; text(l, W / 2, y, 18, 500, '#52514e', 'center'); });
      y += 30; text('Generado con Mis Finanzas', W / 2, y, 14, 400, '#9a9993', 'center');
      return y + 30;
    };
    var H = Math.ceil(render(false));
    canvas.width = W * S; canvas.height = H * S;
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    render(true);
    return { width: W * S, height: H * S };
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------------------------------------------------------------- PDF
  /**
   * PDF de una página con una imagen JPEG a todo el ancho (puro: bytes → bytes).
   * Página de 420 pt de ancho (A5) y alto proporcional a la imagen.
   */
  function pdfFromJpeg(jpeg, w, h) {
    var enc = function (s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
    var PW = 420, PH = Math.round(PW * h / w * 100) / 100;
    var parts = [], offsets = [], pos = 0;
    var add = function (b) { parts.push(b); pos += b.length; };
    add(enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
    var obj = function (n, body) { offsets[n] = pos; add(enc(n + ' 0 obj\n' + body + '\nendobj\n')); };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    offsets[4] = pos;
    add(enc('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n'));
    add(jpeg);
    add(enc('\nendstream\nendobj\n'));
    var content = 'q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im0 Do Q';
    obj(5, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    var xref = pos, x = 'xref\n0 6\n0000000000 65535 f \n';
    for (var i = 1; i <= 5; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    add(enc(x + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'));
    var out = new Uint8Array(pos), o = 0;
    parts.forEach(function (b) { out.set(b, o); o += b.length; });
    return out;
  }

  /** Canvas → Blob (promesa). */
  function canvasBlob(canvas, type, q) {
    return new Promise(function (res) { canvas.toBlob(res, type, q); });
  }
  /** PDF del comprobante (Blob) a partir del canvas ya dibujado. */
  async function pdfBlob(canvas) {
    var jpg = await canvasBlob(canvas, 'image/jpeg', 0.92);
    var bytes = new Uint8Array(await jpg.arrayBuffer());
    return new Blob([pdfFromJpeg(bytes, canvas.width, canvas.height)], { type: 'application/pdf' });
  }

  root.Receipt = {
    money: money, number: number,
    exchangeModel: exchangeModel, saleModel: saleModel, loanModel: loanModel, debtModel: debtModel, paymentModel: paymentModel,
    text: text, reminderText: reminderText, reminderItem: reminderItem, normalizePhone: normalizePhone, waUrl: waUrl,
    draw: draw, pdfFromJpeg: pdfFromJpeg, pdfBlob: pdfBlob, canvasBlob: canvasBlob
  };
})(this);
