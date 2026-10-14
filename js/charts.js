/* =========================================================================
 * charts.js — Gráficos SVG mínimos, sin dependencias.
 *  - bars():  barras agrupadas (+ línea opcional en el MISMO eje)
 *  - lines(): líneas sobre el tiempo con cursor vertical
 * Marcas finas, extremos redondeados de 4 px anclados a la base, líneas de 2 px,
 * marcadores de 8 px con anillo del color de superficie, rejilla tenue.
 * Cada gráfico muestra un tooltip al pasar el ratón o tocar.
 * ========================================================================= */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  /** Escala "redonda" para el eje Y (incluye siempre el 0). */
  function niceScale(min, max, count) {
    min = Math.min(0, min); max = Math.max(0, max);
    if (min === max) max = 1;
    var raw = (max - min) / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / mag;
    var step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
    return { lo: lo, hi: hi, ticks: ticks };
  }

  // ---------- Tooltip compartido ----------
  function tip() { return document.getElementById('tooltip'); }
  function showTip(html, x, y) {
    var t = tip();
    t.innerHTML = html;
    t.classList.add('show');
    var w = t.offsetWidth, h = t.offsetHeight;
    var left = x + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    t.style.left = Math.max(8, left) + 'px';
    t.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y - h / 2)) + 'px';
  }
  function hideTip() { tip().classList.remove('show'); }

  /** Conecta eventos de ratón/táctil: idxAt(clientX) → índice; onIndex(i, x, y). */
  function interact(svg, idxAt, onIndex, onLeave) {
    function handle(cx, cy) {
      var i = idxAt(cx);
      if (i == null) { onLeave(); return; }
      onIndex(i, cx, cy);
    }
    svg.addEventListener('mousemove', function (e) { handle(e.clientX, e.clientY); });
    svg.addEventListener('mouseleave', onLeave);
    svg.addEventListener('touchstart', function (e) { var t = e.touches[0]; handle(t.clientX, t.clientY); }, { passive: true });
    svg.addEventListener('touchmove', function (e) { var t = e.touches[0]; handle(t.clientX, t.clientY); }, { passive: true });
    svg.addEventListener('touchend', function () { setTimeout(onLeave, 2500); });
  }

  /** Barra con extremo de datos redondeado (4 px) y anclada a la línea base. */
  function barPath(x, y0, y1, w) {
    var h = Math.abs(y1 - y0);
    if (h < 0.5) return '';
    var r = Math.min(4, w / 2, h);
    if (y1 < y0) { // hacia arriba
      return 'M' + x + ',' + y0 + 'V' + (y1 + r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 +
        'H' + (x + w - r) + 'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + (y1 + r) + 'V' + y0 + 'Z';
    }
    return 'M' + x + ',' + y0 + 'V' + (y1 - r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + (y1 - r) + 'V' + y0 + 'Z';
  }

  function frame(container, height, yWidth) {
    container.innerHTML = '';
    var W = Math.max(280, container.clientWidth || 600), H = height || 240;
    var m = { t: 10, r: 10, b: 26, l: yWidth || 56 };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img', class: 'chart-svg' }, container);
    return { svg: svg, W: W, H: H, m: m, iw: W - m.l - m.r, ih: H - m.t - m.b };
  }

  function yAxis(f, sc, fmt) {
    var y = function (v) { return f.m.t + (sc.hi - v) / (sc.hi - sc.lo) * f.ih; };
    sc.ticks.forEach(function (v) {
      el('line', { x1: f.m.l, x2: f.W - f.m.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis-base' : 'grid' }, f.svg);
      var t = el('text', { x: f.m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, f.svg);
      t.textContent = fmt(v);
    });
    return y;
  }

  /**
   * Barras agrupadas.
   * cfg: { labels[], series:[{label, color, values[]}], line?:{label, color, values[]},
   *        yFormat(v), tooltip(i) → html, height, ariaLabel }
   */
  function bars(container, cfg) {
    var f = frame(container, cfg.height, cfg.yWidth);
    if (cfg.ariaLabel) f.svg.setAttribute('aria-label', cfg.ariaLabel);
    var n = cfg.labels.length;
    var all = [0];
    cfg.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) all.push(v); }); });
    if (cfg.line) cfg.line.values.forEach(function (v) { if (v != null) all.push(v); });
    var sc = niceScale(Math.min.apply(null, all), Math.max.apply(null, all), 4);
    var y = yAxis(f, sc, cfg.yFormat);
    var band = f.iw / n, k = cfg.series.length, gap = 2;
    var bw = Math.max(3, Math.min(18, (band * 0.72 - (k - 1) * gap) / k));
    var gw = k * bw + (k - 1) * gap;
    var cx = function (i) { return f.m.l + band * i + band / 2; };

    var hl = el('rect', { x: 0, y: f.m.t, width: band, height: f.ih, class: 'band-hl', opacity: 0 }, f.svg);

    cfg.series.forEach(function (s, si) {
      s.values.forEach(function (v, i) {
        if (v == null || v === 0) return;
        var x = cx(i) - gw / 2 + si * (bw + gap);
        el('path', { d: barPath(x, y(0), y(v), bw), style: 'fill:' + s.color }, f.svg);
      });
    });

    if (cfg.line) {
      var pts = [];
      cfg.line.values.forEach(function (v, i) { if (v != null) pts.push([cx(i), y(v)]); });
      if (pts.length > 1) el('polyline', { points: pts.map(function (p) { return p.join(','); }).join(' '), fill: 'none', style: 'stroke:' + cfg.line.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, f.svg);
      pts.forEach(function (p) { el('circle', { cx: p[0], cy: p[1], r: 4, style: 'fill:' + cfg.line.color, class: 'marker' }, f.svg); });
    }

    // Etiquetas X (se espacian si hay muchas)
    var every = Math.ceil(n / Math.max(1, Math.floor(f.iw / 34)));
    cfg.labels.forEach(function (l, i) {
      if (i % every !== 0 && i !== n - 1) return;
      var t = el('text', { x: cx(i), y: f.H - 8, 'text-anchor': 'middle', class: 'tick' }, f.svg);
      t.textContent = l;
    });

    var box = function () { return f.svg.getBoundingClientRect(); };
    interact(f.svg, function (clientX) {
      var b = box(), x = (clientX - b.left) * f.W / b.width;
      var i = Math.floor((x - f.m.l) / band);
      return i >= 0 && i < n ? i : null;
    }, function (i, x, yy) {
      hl.setAttribute('x', f.m.l + band * i); hl.setAttribute('opacity', 1);
      showTip(cfg.tooltip(i), x, yy);
    }, function () { hl.setAttribute('opacity', 0); hideTip(); });
  }

  /**
   * Líneas sobre el tiempo (mismo eje), con área suave bajo la serie `area`.
   * cfg: { x:[ 'YYYY-MM-DD' ], series:[{label, color, values[], area?:bool, width?}],
   *        xFormat(d), yFormat(v), tooltip(i) → html, height }
   */
  function lines(container, cfg) {
    var f = frame(container, cfg.height, cfg.yWidth);
    if (cfg.ariaLabel) f.svg.setAttribute('aria-label', cfg.ariaLabel);
    var n = cfg.x.length;
    var t0 = Date.parse(cfg.x[0]), t1 = Date.parse(cfg.x[n - 1]);
    var xs = cfg.x.map(function (d) { return n === 1 ? f.m.l + f.iw / 2 : f.m.l + (Date.parse(d) - t0) / (t1 - t0 || 1) * f.iw; });
    var all = [0];
    cfg.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null && !isNaN(v)) all.push(v); }); });
    var sc = niceScale(Math.min.apply(null, all), Math.max.apply(null, all), 4);
    var y = yAxis(f, sc, cfg.yFormat);

    cfg.series.forEach(function (s) {
      var pts = s.values.map(function (v, i) { return [xs[i], y(v)]; });
      if (s.area && pts.length > 1) {
        el('path', { d: 'M' + pts[0][0] + ',' + y(0) + 'L' + pts.map(function (p) { return p.join(','); }).join('L') + 'L' + pts[pts.length - 1][0] + ',' + y(0) + 'Z', class: 'area-fill' }, f.svg);
      }
      if (pts.length > 1) el('polyline', { points: pts.map(function (p) { return p.join(','); }).join(' '), fill: 'none', style: 'stroke:' + s.color, 'stroke-width': s.width || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.svg);
      else el('circle', { cx: pts[0][0], cy: pts[0][1], r: 4, style: 'fill:' + s.color, class: 'marker' }, f.svg);
    });

    // Etiquetas X: ~5 repartidas
    var count = Math.min(n, Math.max(2, Math.floor(f.iw / 80)));
    var used = {};
    for (var j = 0; j < count; j++) {
      var i = count === 1 ? 0 : Math.round(j * (n - 1) / (count - 1));
      if (used[i]) continue; used[i] = 1;
      var t = el('text', { x: xs[i], y: f.H - 8, 'text-anchor': j === 0 ? 'start' : j === count - 1 ? 'end' : 'middle', class: 'tick' }, f.svg);
      t.textContent = cfg.xFormat(cfg.x[i]);
    }

    var cross = el('line', { y1: f.m.t, y2: f.m.t + f.ih, class: 'crosshair', opacity: 0 }, f.svg);
    var dots = cfg.series.map(function (s) { return el('circle', { r: 4, style: 'fill:' + s.color, class: 'marker', opacity: 0 }, f.svg); });

    interact(f.svg, function (clientX) {
      var b = f.svg.getBoundingClientRect(), x = (clientX - b.left) * f.W / b.width;
      if (x < f.m.l - 10 || x > f.W - f.m.r + 10) return null;
      var best = 0;
      xs.forEach(function (px, i) { if (Math.abs(px - x) < Math.abs(xs[best] - x)) best = i; });
      return best;
    }, function (i, cx, cy) {
      cross.setAttribute('x1', xs[i]); cross.setAttribute('x2', xs[i]); cross.setAttribute('opacity', 1);
      dots.forEach(function (d, k) { d.setAttribute('cx', xs[i]); d.setAttribute('cy', y(cfg.series[k].values[i])); d.setAttribute('opacity', 1); });
      showTip(cfg.tooltip(i), cx, cy);
    }, function () {
      cross.setAttribute('opacity', 0);
      dots.forEach(function (d) { d.setAttribute('opacity', 0); });
      hideTip();
    });
  }

  /** Escala sin forzar el 0 (para precios). */
  function rangeScale(min, max, count) {
    if (min === max) { var d = Math.abs(min) * 0.02 || 1; min -= d; max += d; }
    var pad = (max - min) * 0.06;
    var raw = (max - min + 2 * pad) / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / mag;
    var step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    var lo = Math.floor((min - pad) / step) * step, hi = Math.ceil((max + pad) / step) * step;
    if (min >= 0 && lo < 0) lo = 0;
    var ticks = [];
    for (var v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
    return { lo: lo, hi: hi, ticks: ticks };
  }

  /**
   * Gráfico de precio con operaciones.
   * cfg: { points:[[t, precio]], markers:[{t, y, kind:'compra'|'venta', html}], ref?:{y, label},
   *        color, buyColor, sellColor, xFormat(t), yFormat(v), tooltip(i) → html, height }
   * Devuelve { isHovering() } para que la vista no lo redibuje mientras el usuario lo explora.
   */
  function price(container, cfg) {
    var pts = cfg.points;
    if (!pts.length) { container.innerHTML = '<p class="muted">Sin datos de precio para este rango.</p>'; return { isHovering: function () { return false; } }; }
    var f = frame(container, cfg.height || 260, cfg.yWidth || 62);
    f.svg.setAttribute('aria-label', cfg.ariaLabel || 'Precio histórico');
    var hovering = false;
    var n = pts.length, t0 = pts[0][0], t1 = pts[n - 1][0];
    var vals = pts.map(function (p) { return p[1]; });
    cfg.markers.forEach(function (m) { vals.push(m.y); });
    if (cfg.ref) vals.push(cfg.ref.y);
    var sc = rangeScale(Math.min.apply(null, vals), Math.max.apply(null, vals), 4);
    var x = function (t) { return f.m.l + (n === 1 ? f.iw / 2 : (t - t0) / (t1 - t0) * f.iw); };
    var y = function (v) { return f.m.t + (sc.hi - v) / (sc.hi - sc.lo) * f.ih; };

    sc.ticks.forEach(function (v) {
      el('line', { x1: f.m.l, x2: f.W - f.m.r, y1: y(v), y2: y(v), class: 'grid' }, f.svg);
      var t = el('text', { x: f.m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, f.svg);
      t.textContent = cfg.yFormat(v);
    });
    var xs = pts.map(function (p) { return x(p[0]); });
    var line = xs.map(function (px, i) { return px + ',' + y(pts[i][1]); }).join(' ');
    el('path', { d: 'M' + xs[0] + ',' + y(sc.lo) + 'L' + line.split(' ').join('L') + 'L' + xs[n - 1] + ',' + y(sc.lo) + 'Z', style: 'fill:' + cfg.color + ';fill-opacity:.08' }, f.svg);
    el('polyline', { points: line, fill: 'none', style: 'stroke:' + cfg.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.svg);

    if (cfg.ref) {
      el('line', { x1: f.m.l, x2: f.W - f.m.r, y1: y(cfg.ref.y), y2: y(cfg.ref.y), class: 'ref-line' }, f.svg);
      var rl = el('text', { x: f.W - f.m.r - 4, y: y(cfg.ref.y) - 5, 'text-anchor': 'end', class: 'ref-label' }, f.svg);
      rl.textContent = cfg.ref.label;
    }

    // Etiquetas de tiempo
    var count = Math.max(2, Math.min(5, Math.floor(f.iw / 90)));
    for (var j = 0; j < count; j++) {
      var tt = t0 + (t1 - t0) * j / (count - 1);
      var lab = el('text', { x: x(tt), y: f.H - 8, 'text-anchor': j === 0 ? 'start' : j === count - 1 ? 'end' : 'middle', class: 'tick' }, f.svg);
      lab.textContent = cfg.xFormat(tt);
    }

    // Último precio
    el('circle', { cx: xs[n - 1], cy: y(pts[n - 1][1]), r: 4, style: 'fill:' + cfg.color, class: 'marker' }, f.svg);

    // Operaciones: ▲ compra, ▼ venta (≥ 12 px, con anillo del color de superficie)
    var mk = cfg.markers.map(function (m) {
      var cx = x(m.t), cy = y(m.y), s = 7;
      var d = m.kind === 'venta'
        ? 'M' + (cx - s) + ',' + (cy - s) + 'L' + (cx + s) + ',' + (cy - s) + 'L' + cx + ',' + (cy + s * 0.9) + 'Z'
        : 'M' + (cx - s) + ',' + (cy + s) + 'L' + (cx + s) + ',' + (cy + s) + 'L' + cx + ',' + (cy - s * 0.9) + 'Z';
      el('path', { d: d, style: 'fill:' + (m.kind === 'venta' ? cfg.sellColor : cfg.buyColor), class: 'marker op-marker' }, f.svg);
      return { cx: cx, cy: cy, html: m.html };
    });

    var cross = el('line', { y1: f.m.t, y2: f.m.t + f.ih, class: 'crosshair', opacity: 0 }, f.svg);
    var dot = el('circle', { r: 4, style: 'fill:' + cfg.color, class: 'marker', opacity: 0 }, f.svg);

    interact(f.svg, function (clientX) {
      var b = f.svg.getBoundingClientRect(), px = (clientX - b.left) * f.W / b.width;
      if (px < f.m.l - 10 || px > f.W - f.m.r + 10) return null;
      return px;
    }, function (px, cx, cy) {
      hovering = true;
      var b = f.svg.getBoundingClientRect(), py = (cy - b.top) * f.H / b.height;
      // Prioridad a las operaciones cercanas al puntero
      var near = null, best = 14;
      mk.forEach(function (m) { var dd = Math.hypot(m.cx - px, m.cy - py); if (dd < best) { best = dd; near = m; } });
      if (near) {
        cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0);
        showTip(near.html, cx, cy);
        return;
      }
      // Punto más cercano (búsqueda binaria sobre x)
      var lo = 0, hi = n - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (xs[mid] < px) lo = mid; else hi = mid; }
      var i = Math.abs(xs[lo] - px) <= Math.abs(xs[hi] - px) ? lo : hi;
      cross.setAttribute('x1', xs[i]); cross.setAttribute('x2', xs[i]); cross.setAttribute('opacity', 1);
      dot.setAttribute('cx', xs[i]); dot.setAttribute('cy', y(pts[i][1])); dot.setAttribute('opacity', 1);
      showTip(cfg.tooltip(i), cx, cy);
    }, function () {
      hovering = false;
      cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0);
      hideTip();
    });
    return { isHovering: function () { return hovering; } };
  }

  root.Charts = { bars: bars, lines: lines, price: price, niceScale: niceScale, hideTip: hideTip };
})(this);
