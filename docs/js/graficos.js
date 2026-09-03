/* =====================================================================
   graficos.js · Gráficos dibujados a mano sobre <canvas>.

   Sin librerías externas: la central tiene que abrir aunque la sala no
   tenga internet. Criterios de lectura:
     · un solo eje por gráfico (nunca dos escalas superpuestas),
     · trazos finos y grilla discreta, el dato manda sobre la decoración,
     · el color de estado (rojo/ámbar/verde) se reserva para el estado,
     · todo gráfico tiene capa de hover con lectura puntual.
   ===================================================================== */

var Graf = (function () {

  function css(v) {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  }

  /* Prepara el lienzo para pantallas HiDPI y devuelve el contexto en px CSS. */
  function preparar(canvas, alto) {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || canvas.parentNode.clientWidth || 320;
    var h = alto || canvas.height || 140;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  /* Etiqueta de hora para el eje X. */
  function etiquetaHora(t) {
    return new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }

  /* ------------------------------ Tooltip ---------------------------- */
  function tip(canvas) {
    var cont = canvas.parentNode;
    var t = cont.querySelector('.tip');
    if (!t) {
      t = document.createElement('div');
      t.className = 'tip';
      cont.appendChild(t);
    }
    return t;
  }

  /* zonas: [{x0,x1,html}] ; se resalta la más cercana al puntero. */
  function enganchar(canvas, zonas, alDibujar) {
    var t = tip(canvas);

    canvas.onmousemove = function (ev) {
      var r = canvas.getBoundingClientRect();
      var x = ev.clientX - r.left;
      var y = ev.clientY - r.top;
      var z = null;

      for (var i = 0; i < zonas.length; i++) {
        if (x >= zonas[i].x0 && x <= zonas[i].x1) {
          z = zonas[i];
          break;
        }
      }

      if (!z) {
        t.classList.remove('visible');
        if (alDibujar) alDibujar(null);
        return;
      }

      t.innerHTML = z.html;
      t.classList.add('visible');

      var tw = t.offsetWidth;
      var px = U.clamp(
        (z.x0 + z.x1) / 2 - tw / 2,
        2,
        canvas.clientWidth - tw - 2
      );

      t.style.left = px + 'px';
      t.style.top = Math.max(2, y - t.offsetHeight - 12) + 'px';

      if (alDibujar) alDibujar(z);
    };

    canvas.onmouseleave = function () {
      t.classList.remove('visible');
      if (alDibujar) alDibujar(null);
    };
  }

  /* --------------------------- Grilla y ejes -------------------------- */
  function grilla(ctx, w, h, pad, max, min, lineas, formato) {
    var i, v, y;

    ctx.font = '10px ' + (css('--mono') || 'monospace');
    ctx.textBaseline = 'middle';

    for (i = 0; i <= lineas; i++) {
      v = min + (max - min) * (i / lineas);

      y = h - pad.b -
        ((v - min) / (max - min || 1)) *
        (h - pad.t - pad.b);

      ctx.strokeStyle = css('--borde-suave');
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.moveTo(pad.l, Math.round(y) + .5);
      ctx.lineTo(w - pad.r, Math.round(y) + .5);
      ctx.stroke();

      ctx.fillStyle = css('--texto-tenue');
      ctx.textAlign = 'right';

      ctx.fillText(
        formato ? formato(v) : Math.round(v),
        pad.l - 6,
        y
      );
    }
  }

  function ejeTiempo(ctx, w, h, pad, t0, t1, marcas) {
    ctx.font = '10px ' + (css('--mono') || 'monospace');
    ctx.fillStyle = css('--texto-tenue');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    var n = marcas || 5;

    for (var i = 0; i <= n; i++) {
      var t = t0 + (t1 - t0) * (i / n);
      var x = pad.l + (w - pad.l - pad.r) * (i / n);

      ctx.fillText(
        etiquetaHora(t),
        U.clamp(x, pad.l + 14, w - pad.r - 14),
        h - pad.b + 9
      );
    }
  }

  /* ====================== Sparkline de la tarjeta ===================== */
  /* Micro-gráfico sin ejes: sólo la forma de las últimas horas. */
  function sparkline(canvas, valores, color, umbral) {
    var p = preparar(canvas, 38);
    var ctx = p.ctx;
    var w = p.w;
    var h = p.h;

    if (!valores || valores.length < 2) {
      ctx.fillStyle = css('--texto-tenue');
      ctx.font = '10px ' + (css('--mono') || 'monospace');
      ctx.textAlign = 'center';
      ctx.fillText('sin datos', w / 2, h / 2);
      return;
    }

    var max = Math.max.apply(null, valores);

    if (umbral) {
      max = Math.max(max, umbral);
    }

    max = max * 1.15 || 1;

    var stepX = w / (valores.length - 1);

    var yDe = function (v) {
      return h - 2 - (v / max) * (h - 6);
    };

    if (umbral) {
      ctx.strokeStyle = css('--critico');
      ctx.globalAlpha = .5;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.moveTo(0, yDe(umbral));
      ctx.lineTo(w, yDe(umbral));
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    /* Área */
    ctx.beginPath();
    ctx.moveTo(0, h);

    valores.forEach(function (v, i) {
      ctx.lineTo(i * stepX, yDe(v));
    });

    ctx.lineTo(w, h);
    ctx.closePath();

    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, color + '38');
    g.addColorStop(1, color + '00');

    ctx.fillStyle = g;
    ctx.fill();

    /* Trazo */
    ctx.beginPath();

    valores.forEach(function (v, i) {
      if (i) {
        ctx.lineTo(i * stepX, yDe(v));
      } else {
        ctx.moveTo(0, yDe(v));
      }
    });

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();

    /* Punto final */
    ctx.beginPath();
    ctx.arc(
      w - 1.5,
      yDe(valores[valores.length - 1]),
      2.6,
      0,
      6.284
    );

    ctx.fillStyle = color;
    ctx.fill();
  }

  /* ==================== Barras de diuresis horaria ==================== */
  function barrasDiuresis(canvas, buckets, opts) {
    opts = opts || {};

    var p = preparar(canvas, opts.alto || 175);
    var ctx = p.ctx;
    var w = p.w;
    var h = p.h;

    var pad = { l: 38, r: 12, t: 12, b: 28 };

    if (!buckets.length) {
      vacio(ctx, w, h);
      return;
    }

    var pesoKg = opts.pesoKg || null;
    var umbral = opts.umbralMlH || null;
    var umbralPoli = opts.umbralPoliuriaMlH || null;

    var max = Math.max.apply(
      null,
      buckets.map(function (b) {
        return b.mlH;
      })
    );

    if (umbral) {
      max = Math.max(max, umbral * 1.6);
    }

    if (umbralPoli) {
      max = Math.max(max, umbralPoli * 1.15);
    }

    max = Math.max(max * 1.15, 10);

    grilla(
      ctx,
      w,
      h,
      pad,
      max,
      0,
      3,
      function (v) {
        return Math.round(v);
      }
    );

    var area = w - pad.l - pad.r;
    var ancho = Math.max(3, area / buckets.length - 2);
    var zonas = [];

    buckets.forEach(function (b, i) {
      var x = pad.l + (area / buckets.length) * i + 1;
      var alto = (b.mlH / max) * (h - pad.t - pad.b);
      var y = h - pad.b - alto;

      var mlKg = pesoKg
        ? b.mlH / pesoKg
        : null;

      var col = css('--teal');

      if (mlKg !== null) {
        if (mlKg < CFG.umbrales.anuria) {
          col = css('--critico');
        } else if (mlKg < CFG.umbrales.oliguria) {
          col = css('--grave');
        } else if (mlKg > CFG.umbrales.poliuria) {
          col = css('--aviso');
        }
      }

      ctx.fillStyle = col;
      ctx.globalAlpha = b.parcial ? .45 : 1;

      redondeada(
        ctx,
        x,
        y,
        ancho,
        Math.max(2, alto),
        4
      );

      ctx.globalAlpha = 1;

      zonas.push({
        x0: x - 1,
        x1: x + ancho + 1,
        html:
          '<b>' + U.num(b.mlH, 0) + ' mL/h</b>' +
          (mlKg !== null
            ? ' · ' + U.num(mlKg, 2) + ' mL/kg/h'
            : '') +
          '<br>' +
          etiquetaHora(b.t0) +
          '–' +
          etiquetaHora(b.t1) +
          '<br>' +
          U.num(b.ml, 0) +
          ' mL en la hora' +
          (b.parcial ? ' (hora en curso)' : '')
      });
    });

    if (umbral) {
      var yU =
        h -
        pad.b -
        (umbral / max) *
        (h - pad.t - pad.b);

      ctx.strokeStyle = css('--critico');
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);

      ctx.beginPath();
      ctx.moveTo(pad.l, yU);
      ctx.lineTo(w - pad.r, yU);
      ctx.stroke();

      ctx.setLineDash([]);

      ctx.fillStyle = css('--critico');
      ctx.font = '10px ' + css('--mono');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';

      ctx.fillText(
        U.num(umbral, 0) + ' mL/h',
        pad.l + 4,
        yU - 3
      );
    }

    if (umbralPoli) {
      var yP =
        h -
        pad.b -
        (umbralPoli / max) *
        (h - pad.t - pad.b);

      ctx.strokeStyle = css('--aviso');
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);

      ctx.beginPath();
      ctx.moveTo(pad.l, yP);
      ctx.lineTo(w - pad.r, yP);
      ctx.stroke();

      ctx.setLineDash([]);

      ctx.fillStyle = css('--aviso');
      ctx.font = '10px ' + css('--mono');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      ctx.fillText(
        U.num(umbralPoli, 0) + ' mL/h',
        pad.l + 4,
        yP + 3
      );
    }

    ejeTiempo(
      ctx,
      w,
      h,
      pad,
      buckets[0].t0,
      buckets[buckets.length - 1].t1,
      Math.min(6, buckets.length)
    );

    enganchar(canvas, zonas);
  }

  function redondeada(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h);

    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
  }

  /* ========================= Serie temporal ========================== */
  /* opts: {color, area, min, max, formato, banda:{desde,hasta,color}, unidad} */
  function serie(canvas, puntos, opts) {
    opts = opts || {};

    var p = preparar(canvas, opts.alto || 155);
    var ctx = p.ctx;
    var w = p.w;
    var h = p.h;

    var pad = { l: 40, r: 12, t: 12, b: 28 };

    if (!puntos || puntos.length < 2) {
      vacio(ctx, w, h);
      return;
    }

    var vs = puntos.map(function (q) {
      return q.v;
    });

    var max =
      opts.max !== undefined
        ? opts.max
        : Math.max.apply(null, vs);

    var min =
      opts.min !== undefined
        ? opts.min
        : Math.min.apply(null, vs);

    if (max === min) {
      max += 1;
      min -= 1;
    }

    var margen = (max - min) * 0.12;
    max += margen;
    min -= margen;

    if (opts.desdeCero) {
      min = 0;
    }

    var t0 = puntos[0].t;
    var t1 = puntos[puntos.length - 1].t;

    var xDe = function (t) {
      return pad.l +
        ((t - t0) / (t1 - t0 || 1)) *
        (w - pad.l - pad.r);
    };

    var yDe = function (v) {
      return h -
        pad.b -
        ((v - min) / (max - min)) *
        (h - pad.t - pad.b);
    };

    /* Banda de referencia */
    if (opts.banda) {
      var yA = yDe(Math.min(opts.banda.hasta, max));
      var yB = yDe(Math.max(opts.banda.desde, min));

      ctx.fillStyle = opts.banda.color;

      ctx.fillRect(
        pad.l,
        yA,
        w - pad.l - pad.r,
        Math.max(0, yB - yA)
      );
    }

    grilla(
      ctx,
      w,
      h,
      pad,
      max,
      min,
      3,
      opts.formato
    );

    var color = opts.color || css('--teal');

    if (opts.area) {
      ctx.beginPath();
      ctx.moveTo(xDe(t0), h - pad.b);

      puntos.forEach(function (q) {
        ctx.lineTo(xDe(q.t), yDe(q.v));
      });

      ctx.lineTo(xDe(t1), h - pad.b);
      ctx.closePath();

      var g = ctx.createLinearGradient(
        0,
        pad.t,
        0,
        h - pad.b
      );

      g.addColorStop(0, color + '33');
      g.addColorStop(1, color + '00');

      ctx.fillStyle = g;
      ctx.fill();
    }

    ctx.beginPath();

    puntos.forEach(function (q, i) {
      if (i) {
        ctx.lineTo(xDe(q.t), yDe(q.v));
      } else {
        ctx.moveTo(xDe(q.t), yDe(q.v));
      }
    });

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    /* Tramos reconstruidos desde el búfer */
    puntos.forEach(function (q) {
      if (!q.buffer) return;

      ctx.beginPath();
      ctx.arc(
        xDe(q.t),
        yDe(q.v),
        2.2,
        0,
        6.284
      );

      ctx.fillStyle = css('--aviso');
      ctx.fill();
    });

    /* Último valor */
    var ult = puntos[puntos.length - 1];

    ctx.beginPath();
    ctx.arc(
      xDe(ult.t),
      yDe(ult.v),
      3.4,
      0,
      6.284
    );

    ctx.fillStyle = color;
    ctx.fill();

    ctx.strokeStyle = css('--panel');
    ctx.lineWidth = 2;
    ctx.stroke();

    ejeTiempo(
      ctx,
      w,
      h,
      pad,
      t0,
      t1,
      5
    );

    /* Hover */
    var zonas = puntos.map(function (q) {
      var x = xDe(q.t);
      var ancho =
        (w - pad.l - pad.r) /
        puntos.length;

      return {
        x0: x - ancho / 2,
        x1: x + ancho / 2,
        html:
          '<b>' +
          (opts.formato
            ? opts.formato(q.v)
            : U.num(q.v, 1)) +
          (opts.unidad || '') +
          '</b><br>' +
          etiquetaHora(q.t) +
          (q.buffer
            ? '<br>reconstruido del búfer'
            : '')
      };
    });

    enganchar(canvas, zonas);
  }

  /* ===================== Color de orina en el tiempo =================== */
  /*
     Cada muestra del sensor RGB se clasifica en una de las cuatro
     categorías definidas en CFG.coloresOrina:

       · Transparente
       · Amarillo
       · Rojizo
       · Marrón oscuro

     El gráfico muestra la categoría obtenida, no una escala numérica
     de hidratación ni el RGB crudo del sensor.
  */
  function tiraColor(canvas, muestras, opts) {
    opts = opts || {};

    var p = preparar(canvas, opts.alto || 140);
    var ctx = p.ctx;
    var w = p.w;
    var h = p.h;

    var pad = { l: 8, r: 8, t: 10, b: 34 };

    if (!muestras || !muestras.length) {
      vacio(ctx, w, h);
      return;
    }

    var t0 = muestras[0].t;
    var t1 = muestras[muestras.length - 1].t;

    var n = Math.min(
      muestras.length,
      Math.max(
        24,
        Math.floor(
          (w - pad.l - pad.r) / 6
        )
      )
    );

    var altoTira =
      h -
      pad.t -
      pad.b;

    var ancho =
      (w - pad.l - pad.r) /
      n;

    var zonas = [];

    for (var i = 0; i < n; i++) {
      var idx = Math.floor(
        i *
        (muestras.length - 1) /
        (n - 1 || 1)
      );

      var m = muestras[idx];
      var cl = U.clasificarColor(m.rgb);
      var x = pad.l + i * ancho;

      /* Se muestra el color de la categoría */
      ctx.fillStyle = cl.hex;

      ctx.fillRect(
        x,
        pad.t,
        Math.ceil(ancho) + .5,
        altoTira
      );

      zonas.push({
        x0: x,
        x1: x + ancho,
        html:
          '<b>' +
          cl.nombre +
          '</b><br>' +
          etiquetaHora(m.t)
      });
    }

    /* Marco */
    ctx.strokeStyle = css('--borde');
    ctx.lineWidth = 1;

    ctx.strokeRect(
      pad.l + .5,
      pad.t + .5,
      w - pad.l - pad.r - 1,
      altoTira - 1
    );

    /* Eje temporal */
    ejeTiempo(
      ctx,
      w,
      h,
      pad,
      t0,
      t1,
      4
    );

    enganchar(canvas, zonas);
  }

  function vacio(ctx, w, h) {
    ctx.fillStyle = css('--texto-tenue');
    ctx.font = '11px ' + (css('--mono') || 'monospace');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Sin datos suficientes', w / 2, h / 2);
  }

  return {
    sparkline: sparkline,
    barrasDiuresis: barrasDiuresis,
    serie: serie,
    tiraColor: tiraColor
  };

})();
