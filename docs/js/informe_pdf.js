/* =====================================================================
   informe_pdf.js · Informe clínico en PDF (reemplaza la exportación CSV).

   Por cama: identificación del paciente, resumen actual, gráfico de la
   diuresis horaria de las últimas 24 h, tabla hora por hora y registro de
   eventos. "Exportar todo" genera un único PDF con una sección por cama.

   Usa jsPDF + jsPDF-AutoTable guardados en js/, así funciona sin
   internet, igual que el resto de la central.

   Las fuentes estándar de PDF no tienen algunos símbolos (→, ≥, etc.),
   por eso todo texto pasa por limpiar() antes de escribirse.
   ===================================================================== */

var InformePDF = (function () {

  /* ------------------------------ Estilo ------------------------------ */
  var C = {
    texto:   [31, 41, 55],
    tenue:   [107, 114, 128],
    linea:   [209, 213, 219],
    fondo:   [243, 244, 246],
    marca:   [42, 157, 143],
    rojo:    [192, 57, 43],
    naranja: [217, 130, 43],
    barra:   [42, 157, 143]
  };
  var MARGEN = 15;
  var ANCHO_UTIL = 180;   // A4 = 210 mm

  /* ----------------------------- Utilidades --------------------------- */
  function limpiar(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/→/g, '->').replace(/←/g, '<-')
      .replace(/≥/g, '>=').replace(/≤/g, '<=')
      .replace(/[–—]/g, '-')
      .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
      .replace(/…/g, '...')
      .replace(/[\u00A0\u202F]/g, ' ')
      .replace(/[^\x00-\xFF]/g, '');
  }

  function dos(n) { return (n < 10 ? '0' : '') + n; }

  /* Hora en formato 24 h (HH:MM), más legible en papel que "10:00 p. m.". */
  function hm(ts) {
    var d = new Date(ts);
    return dos(d.getHours()) + ':' + dos(d.getMinutes());
  }

  function fecha(ts) {
    var d = new Date(ts);
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + hm(ts);
  }

  function disponible() {
    return !!(window.jspdf && window.jspdf.jsPDF);
  }

  function nuevoDoc() {
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', 'normal');
    return doc;
  }

  function tabla(doc, opciones) {
    if (typeof doc.autoTable === 'function') doc.autoTable(opciones);
    else window.autoTable(doc, opciones);
    return doc.lastAutoTable.finalY;
  }

  /* Si lo que sigue no entra en la página, salta a una nueva. */
  function espacio(doc, y, alto) {
    if (y + alto > 280) { doc.addPage(); return 20; }
    return y;
  }

  function tituloSeccion(doc, y, texto) {
    y = espacio(doc, y, 14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor.apply(doc, C.marca);
    doc.text(limpiar(texto).toUpperCase(), MARGEN, y);
    doc.setDrawColor.apply(doc, C.linea);
    doc.line(MARGEN, y + 1.5, MARGEN + ANCHO_UTIL, y + 1.5);
    return y + 5;
  }

  /* ------------------------------ Cálculos ---------------------------- */

  /* Temperatura media y último color dentro de cada hora del gráfico. */
  function detalleHora(muestras, t0, t1) {
    var suma = 0, n = 0, ultima = null;
    for (var i = 0; i < muestras.length; i++) {
      var x = muestras[i];
      if (x.t < t0) continue;
      if (x.t >= t1) break;
      if (x.tempC !== null && x.tempC !== undefined) { suma += x.tempC; n++; }
      if (x.rgb) ultima = x;
    }
    return {
      temp: n ? suma / n : null,
      color: ultima ? U.clasificarColor(ultima.rgb).nombre : null
    };
  }

  function colorDiuresis(mlKgH) {
    if (mlKgH === null || mlKgH === undefined) return C.texto;
    if (mlKgH < CFG.umbrales.oliguria) return C.rojo;
    if (mlKgH > CFG.umbrales.poliuria) return C.naranja;
    return C.texto;
  }

  /* ----------------------------- Secciones ---------------------------- */

  function encabezado(doc, subtitulo) {
    doc.setFillColor.apply(doc, C.marca);
    doc.rect(0, 0, 210, 4, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor.apply(doc, C.texto);
    doc.text('SÍMODI', MARGEN, 16);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor.apply(doc, C.tenue);
    doc.text(limpiar(CFG.app.nombreLargo + ' · ' + CFG.app.sector), MARGEN, 22);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor.apply(doc, C.texto);
    doc.text(limpiar(subtitulo), 210 - MARGEN, 16, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor.apply(doc, C.tenue);
    doc.text(limpiar('Generado: ' + fecha(Date.now()) + ' · ' + Operador.actual()),
      210 - MARGEN, 22, { align: 'right' });

    doc.setDrawColor.apply(doc, C.linea);
    doc.line(MARGEN, 26, 210 - MARGEN, 26);
    return 34;
  }

  /* Tabla de pares dato/valor en dos columnas. */
  function tablaDatos(doc, y, pares) {
    var filas = [];
    for (var i = 0; i < pares.length; i += 2) {
      var a = pares[i], b = pares[i + 1] || ['', ''];
      filas.push([limpiar(a[0]), limpiar(a[1]), limpiar(b[0]), limpiar(b[1])]);
    }
    return tabla(doc, {
      startY: y,
      body: filas,
      theme: 'plain',
      margin: { left: MARGEN, right: MARGEN },
      styles: { fontSize: 9.5, cellPadding: { top: 1.4, bottom: 1.4, left: 2, right: 2 }, textColor: C.texto },
      columnStyles: {
        0: { textColor: C.tenue, cellWidth: 38 },
        1: { fontStyle: 'bold', cellWidth: 52 },
        2: { textColor: C.tenue, cellWidth: 38 },
        3: { fontStyle: 'bold', cellWidth: 52 }
      },
      didParseCell: function (h) {
        if (h.row.index % 2 === 0) h.cell.styles.fillColor = C.fondo;
      }
    }) + 6;
  }

  function seccionIdentificacion(doc, y, cama, m) {
    var p = m.paciente, d = m.dispositivo;
    y = tituloSeccion(doc, y, 'Identificación');
    var pares = [
      ['Cama', cama.etiqueta],
      ['N.º de inventario', cama.serieInventario || '—'],
      ['Paciente', p ? p.nombre : 'Sin paciente asignado'],
      ['Historia clínica', p ? p.hc : '—'],
      ['Edad / sexo', p ? (p.edad + ' años · ' + p.sexo) : '—'],
      ['Peso', p ? (U.num(p.pesoKg, 1) + ' kg') : '—'],
      ['Diagnóstico', p && p.dx ? p.dx : '—'],
      ['Ingreso', p && p.ingreso ? fecha(p.ingreso) : '—'],
      ['Dispositivo', d ? d.serie : '—'],
      ['Batería', d ? (Math.round(d.bat) + ' %') : '—']
    ];
    return tablaDatos(doc, y, pares);
  }

  function seccionResumen(doc, y, m) {
    y = tituloSeccion(doc, y, 'Resumen actual');
    var conPeso = !!m.paciente;
    function diu(mlH, mlKgH) {
      if (mlH === null || mlH === undefined) return '—';
      return U.num(mlH, 0) + ' mL/h' + (conPeso && mlKgH !== null ? ' · ' + U.num(mlKgH, 2) + ' mL/kg/h' : '');
    }
    var pares = [
      ['Diuresis última hora', diu(m.mlH, m.mlKgH)],
      ['Promedio 6 h', diu(m.mlH6, m.mlKgH6)],
      ['Promedio 24 h', diu(m.mlH24, m.mlKgH24)],
      ['Volumen acumulado', U.num(m.volTotalMl, 0) + ' mL'],
      ['Volumen en bolsa', U.num(m.volBolsaMl, 0) + ' / ' + U.num(Modelo.estado.medicion.capacidadBolsaML, 0) + ' mL'],
      ['Temperatura', (m.tempC !== null ? U.num(m.tempC, 1) + ' °C' : '—') +
        (m.tempMax6h !== null ? ' (máx. 6 h: ' + U.num(m.tempMax6h, 1) + ' °C)' : '')],
      ['Color', m.color ? m.color.nombre : '—'],
      ['Estadio KDIGO (diuresis)', conPeso ? (m.kdigo ? 'Estadio ' + m.kdigo : 'Sin criterio') : 'Requiere peso'],
      ['Horas en oliguria', conPeso ? String(m.horasOliguria) + ' h consecutivas' : '—'],
      ['Sin flujo apreciable', U.num(m.minSinFlujo, 0) + ' min']
    ];
    return tablaDatos(doc, y, pares);
  }

  /* Gráfico de barras de la diuresis horaria (últimas 24 h). */
  function seccionGrafico(doc, y, m) {
    y = tituloSeccion(doc, y, 'Diuresis horaria · últimas 24 h');
    y = espacio(doc, y, 66);

    var conPesoTxt = !!m.paciente;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor.apply(doc, C.tenue);
    doc.text(conPesoTxt ? 'mL/kg/h' : 'mL/h (sin peso del paciente)', MARGEN, y + 1);
    y += 5;

    var conPeso = !!m.paciente;
    var peso = conPeso ? m.paciente.pesoKg : 1;
    var valores = m.buckets.map(function (b) { return b.sinDatos ? null : b.mlH / peso; });

    var maxV = 0;
    valores.forEach(function (v) { if (v !== null && v > maxV) maxV = v; });
    if (conPeso) maxV = Math.max(maxV, CFG.umbrales.oliguria * 2);
    maxV = Math.max(maxV, 1) * 1.15;

    var x0 = MARGEN + 12, ancho = ANCHO_UTIL - 12, alto = 45, yBase = y + alto;

    // Grilla y eje Y
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor.apply(doc, C.tenue);
    doc.setDrawColor.apply(doc, C.linea);
    doc.setLineWidth(0.1);
    for (var g = 0; g <= 4; g++) {
      var vg = maxV * g / 4;
      var yg = yBase - alto * g / 4;
      doc.line(x0, yg, x0 + ancho, yg);
      doc.text(U.num(vg, vg < 10 ? 1 : 0), x0 - 2, yg + 1, { align: 'right' });
    }

    // Barras
    var n = valores.length, paso = ancho / n, bw = paso * 0.7;
    valores.forEach(function (v, i) {
      if (v === null) return;
      var h = Math.max(0.3, alto * v / maxV);
      var col = conPeso ? colorDiuresis(v) : C.barra;
      if (col === C.texto) col = C.barra;
      if (m.buckets[i].parcial) col = col.map(function (c) { return Math.round(c + (255 - c) * 0.5); });
      doc.setFillColor.apply(doc, col);
      doc.rect(x0 + i * paso + (paso - bw) / 2, yBase - h, bw, h, 'F');
    });

    // Umbrales
    function umbral(v, col, texto) {
      if (v > maxV) return;
      var yu = yBase - alto * v / maxV;
      doc.setDrawColor.apply(doc, col);
      doc.setLineWidth(0.35);
      doc.setLineDashPattern([1.5, 1.2], 0);
      doc.line(x0, yu, x0 + ancho, yu);
      doc.setLineDashPattern([], 0);
      doc.setTextColor.apply(doc, col);
      doc.text(texto, x0 + ancho, yu - 1, { align: 'right' });
    }
    if (conPeso) {
      umbral(CFG.umbrales.oliguria, C.rojo, 'oliguria ' + U.num(CFG.umbrales.oliguria, 1));
      umbral(CFG.umbrales.poliuria, C.naranja, 'poliuria ' + U.num(CFG.umbrales.poliuria, 0));
    }

    // Eje X: hora cada 3 h
    doc.setTextColor.apply(doc, C.tenue);
    doc.setLineWidth(0.1);
    m.buckets.forEach(function (b, i) {
      if (i % 3 !== 0) return;
      doc.text(hm(b.t0), x0 + i * paso + paso / 2, yBase + 4, { align: 'center' });
    });

    return yBase + 11;
  }

  function seccionTablaHoraria(doc, y, m) {
    y = tituloSeccion(doc, y, 'Detalle hora por hora');
    var conPeso = !!m.paciente;
    var ms = m.dispositivo.muestras;

    var filas = [];
    m.buckets.forEach(function (b) {
      var det = detalleHora(ms, b.t0, b.t1);
      if (b.sinDatos) {
        filas.push([hm(b.t0) + ' - ' + hm(b.t1), 'Sin datos', '', '', '', '']);
        return;
      }
      var mlKgH = conPeso ? b.mlH / m.paciente.pesoKg : null;
      filas.push([
        hm(b.t0) + ' - ' + hm(b.t1) + (b.parcial ? ' *' : ''),
        U.num(b.ml, 0),
        U.num(b.mlH, 0),
        conPeso ? U.num(mlKgH, 2) : '—',
        det.temp !== null ? U.num(det.temp, 1) : '—',
        limpiar(det.color || '—')
      ]);
    });

    y = tabla(doc, {
      startY: y,
      head: [['Hora', 'Volumen (mL)', 'mL/h', 'mL/kg/h', 'Temp. media (°C)', 'Color']],
      body: filas,
      theme: 'striped',
      margin: { left: MARGEN, right: MARGEN, top: 20 },
      styles: { fontSize: 8.5, cellPadding: 1.3, textColor: C.texto, halign: 'center' },
      headStyles: { fillColor: C.marca, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: C.fondo },
      columnStyles: { 0: { halign: 'left' }, 5: { halign: 'left' } },
      didParseCell: function (h) {
        if (h.section !== 'body') return;
        var txt = h.cell.raw;
        if (txt === 'Sin datos') { h.cell.styles.textColor = C.tenue; return; }
        if (h.column.index === 3 && conPeso) {
          var v = parseFloat(String(txt).replace(/\./g, '').replace(',', '.'));
          if (!isNaN(v)) {
            var c = colorDiuresis(v);
            h.cell.styles.textColor = c;
            if (c !== C.texto) h.cell.styles.fontStyle = 'bold';
          }
        }
        if (h.column.index === 4) {
          var t = parseFloat(String(txt).replace(',', '.'));
          if (!isNaN(t) && t >= CFG.umbrales.tempFebril) {
            h.cell.styles.textColor = C.rojo;
            h.cell.styles.fontStyle = 'bold';
          }
        }
      }
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor.apply(doc, C.tenue);
    y = espacio(doc, y + 4, 6);
    doc.text(limpiar('* Hora incompleta: el valor de mL/h se proyecta a la hora completa. ' +
      'En rojo: < ' + U.num(CFG.umbrales.oliguria, 1) + ' mL/kg/h o temperatura >= ' +
      U.num(CFG.umbrales.tempFebril, 0) + ' °C. En naranja: > ' + U.num(CFG.umbrales.poliuria, 0) + ' mL/kg/h.'),
      MARGEN, y, { maxWidth: ANCHO_UTIL });
    return y + 9;
  }

  function seccionEventos(doc, y, cama) {
    var evs = Modelo.estado.eventos.filter(function (e) { return e.camaId === cama.id; }).slice(-40).reverse();
    y = tituloSeccion(doc, y, 'Registro de eventos de la cama');
    if (!evs.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor.apply(doc, C.tenue);
      doc.text('Sin eventos registrados.', MARGEN, y + 3);
      return y + 10;
    }
    return tabla(doc, {
      startY: y,
      head: [['Fecha y hora', 'Detalle', 'Operador']],
      body: evs.map(function (e) {
        return [fecha(e.t), limpiar(e.texto), limpiar(e.operador || '—')];
      }),
      theme: 'striped',
      margin: { left: MARGEN, right: MARGEN, top: 20 },
      styles: { fontSize: 8.5, cellPadding: 1.3, textColor: C.texto },
      headStyles: { fillColor: C.marca, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: C.fondo },
      columnStyles: { 0: { cellWidth: 32 }, 2: { cellWidth: 40 } }
    }) + 8;
  }

  function pieDePagina(doc) {
    var total = doc.getNumberOfPages();
    for (var i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setDrawColor.apply(doc, C.linea);
      doc.setLineWidth(0.1);
      doc.line(MARGEN, 285, 210 - MARGEN, 285);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor.apply(doc, C.tenue);
      doc.text('SÍMODI · Informe generado automáticamente. Herramienta de apoyo: no reemplaza la valoración clínica.',
        MARGEN, 290);
      doc.text('Página ' + i + ' de ' + total, 210 - MARGEN, 290, { align: 'right' });
    }
  }

  function informeCama(doc, cama) {
    var m = Modelo.metricas(cama);
    var y = encabezado(doc, 'Informe de diuresis · ' + cama.etiqueta);
    y = seccionIdentificacion(doc, y, cama, m);
    y = seccionResumen(doc, y, m);
    y = seccionGrafico(doc, y, m);
    y = seccionTablaHoraria(doc, y, m);
    seccionEventos(doc, y, cama);
  }

  function nombreArchivo(base) {
    return limpiar(base).replace(/[^A-Za-z0-9_\-]/g, '_') + '_' +
      new Date().toISOString().slice(0, 10) + '.pdf';
  }

  /* ------------------------------ Públicas ---------------------------- */

  function exportarCama(camaId) {
    if (!disponible()) { UI.toast('No se pudo cargar el generador de PDF', 'error'); return; }
    var cama = Modelo.buscarCama(camaId);
    if (!cama || !cama.dispositivoId) { UI.toast('La cama no tiene dispositivo: no hay datos para exportar'); return; }

    var p = cama.pacienteId ? Modelo.estado.pacientes[cama.pacienteId] : null;
    var d = Modelo.estado.dispositivos[cama.dispositivoId];
    var doc = nuevoDoc();
    informeCama(doc, cama);
    pieDePagina(doc);
    doc.save(nombreArchivo('simodi_' + cama.etiqueta + '_' + (p ? p.hc : d.serie)));
    UI.toast('PDF exportado');
  }

  function exportarTodo() {
    if (!disponible()) { UI.toast('No se pudo cargar el generador de PDF', 'error'); return; }
    var camas = Modelo.estado.camas
      .filter(function (c) { return c.dispositivoId && Modelo.estado.dispositivos[c.dispositivoId]; })
      .sort(function (a, b) { return a.etiqueta.localeCompare(b.etiqueta); });
    if (!camas.length) { UI.toast('No hay camas con dispositivo para exportar'); return; }

    var doc = nuevoDoc();
    camas.forEach(function (cama, i) {
      if (i > 0) doc.addPage();
      informeCama(doc, cama);
    });
    pieDePagina(doc);
    doc.save(nombreArchivo('simodi_sala'));
    UI.toast('PDF de toda la sala exportado');
  }

  return { exportarCama: exportarCama, exportarTodo: exportarTodo };
})();
