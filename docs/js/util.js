/* =====================================================================
   util.js · Funciones auxiliares: formato, color, tiempo, DOM y audio.
   ===================================================================== */

var U = (function () {

  /* ------------------------------- DOM ------------------------------- */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function el(tag, clases, texto) {
    var n = document.createElement(tag);
    if (clases) n.className = clases;
    if (texto !== undefined && texto !== null) n.textContent = texto;
    return n;
  }

  /* Escapa texto que viene del usuario antes de meterlo en innerHTML. */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ------------------------------ Números ---------------------------- */
  function num(v, dec) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return Number(v).toLocaleString('es-AR', {
      minimumFractionDigits: dec || 0, maximumFractionDigits: dec === undefined ? 0 : dec
    });
  }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ------------------------------ Tiempo ----------------------------- */
  function hora(ts) {
    return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  function horaSeg(ts) {
    return new Date(ts).toLocaleTimeString('es-AR', { hour12: false });
  }
  function fechaHora(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' + hora(ts);
  }

  /* "hace 4 min" */
  function desde(ts, ahora) {
    var s = Math.max(0, Math.round(((ahora || Date.now()) - ts) / 1000));
    if (s < 10) return 'ahora';
    if (s < 60) return 'hace ' + s + ' s';
    var m = Math.floor(s / 60);
    if (m < 60) return 'hace ' + m + ' min';
    var h = Math.floor(m / 60);
    if (h < 24) return 'hace ' + h + ' h ' + (m % 60) + ' min';
    return 'hace ' + Math.floor(h / 24) + ' d';
  }

  /* Duración legible a partir de milisegundos. */
  function duracion(ms) {
    var m = Math.round(ms / 60000);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60);
    return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  }

  /* ------------------------------- Color ----------------------------- */
  function hexARgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }

  function rgbAHex(rgb) {
    return '#' + rgb.map(function (v) {
      var s = Math.round(clamp(v, 0, 255)).toString(16);
      return s.length === 1 ? '0' + s : s;
    }).join('');
  }

  function rgbCss(rgb) {
    return 'rgb(' + rgb.map(function (v) { return Math.round(v); }).join(',') + ')';
  }

  /* sRGB → CIE Lab (D65). Se usa para comparar colores de forma perceptual. */
  function rgbALab(rgb) {
    function lin(c) {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
    var x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    var y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
    var z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;

    function f(t) {
      return t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t + 16 / 116);
    }

    var fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function deltaE(rgb1, rgb2) {
    var a = rgbALab(rgb1), b = rgbALab(rgb2);
    return Math.sqrt(
      Math.pow(a[0] - b[0], 2) +
      Math.pow(a[1] - b[1], 2) +
      Math.pow(a[2] - b[2], 2)
    );
  }

  /* Clasifica una lectura RGB en una de las cuatro categorías de SÍMODI. */
  function clasificarColor(rgb) {
    var mejor = null, mejorD = Infinity, i, d;

    for (i = 0; i < CFG.coloresOrina.length; i++) {
      d = deltaE(rgb, hexARgb(CFG.coloresOrina[i].hex));
      if (d < mejorD) {
        mejorD = d;
        mejor = CFG.coloresOrina[i];
      }
    }

    if (!mejor) {
      return {
        nombre: 'Sin clasificar',
        estado: 'ok',
        detalle: '',
        clave: 'sin-clasificar',
        distancia: null,
        hex: rgbAHex(rgb)
      };
    }

    return {
      nombre: mejor.nombre,
      estado: mejor.estado,
      detalle: mejor.detalle || '',
      clave: mejor.clave,
      distancia: mejorD,
      hex: mejor.hex
    };
  }

  /* ------------------------------ Varios ----------------------------- */
  function id(prefijo) {
    return (prefijo || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  }

  /* Ruido gaussiano (Box-Muller) para que el simulador no se vea "de plástico". */
  function ruido(sigma) {
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * (sigma || 1);
  }

  function descargar(nombre, contenido, tipo) {
    var blob = new Blob([contenido], { type: (tipo || 'text/csv') + ';charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  /* ------------------------------- Audio ----------------------------- */
  var ctxAudio = null, silenciado = false;

  function tono(freq, dur, retardo, vol) {
    if (silenciado) return;

    try {
      if (!ctxAudio) ctxAudio = new (window.AudioContext || window.webkitAudioContext)();
      if (ctxAudio.state === 'suspended') ctxAudio.resume();

      var t0 = ctxAudio.currentTime + (retardo || 0);
      var osc = ctxAudio.createOscillator(), g = ctxAudio.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;

      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol || 0.14, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(g);
      g.connect(ctxAudio.destination);

      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch (e) {
      /* El navegador puede bloquear audio sin interacción previa. */
    }
  }

  function alarma(nivel) {
    if (nivel === 'critica') {
      tono(880, .18, 0);
      tono(880, .18, .25);
      tono(1100, .28, .5);
    } else if (nivel === 'alta') {
      tono(700, .16, 0);
      tono(700, .16, .24);
    } else {
      tono(560, .14, 0);
    }
  }

  function silenciar(v) { silenciado = v; }
  function estaSilenciado() { return silenciado; }

  return {
    $: $, $$: $$, el: el, esc: esc, num: num, clamp: clamp, lerp: lerp,
    hora: hora, horaSeg: horaSeg, fechaHora: fechaHora, desde: desde, duracion: duracion,
    hexARgb: hexARgb, rgbAHex: rgbAHex, rgbCss: rgbCss, deltaE: deltaE,
    clasificarColor: clasificarColor,
    id: id, ruido: ruido, descargar: descargar,
    alarma: alarma, silenciar: silenciar, estaSilenciado: estaSilenciado
  };
})();
