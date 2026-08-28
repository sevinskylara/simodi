/* =====================================================================
   ui.js · Todo el renderizado de pantalla: KPIs, mural de camas, panel
   de alertas, eventos y los tres modales (detalle, asignar, config).

   Nada de esto toca el modelo: sólo lee Modelo/Alertas y escribe DOM.
   La única vía de escritura hacia el modelo es a través de las acciones
   (Acciones.*), llamadas desde los manejadores de eventos de acá abajo.
   ===================================================================== */

var UI = (function () {

  var camaAbierta = null;     // id de la cama mostrada en el modal de detalle
  var rangoHoras = 6;
  var tabDetalle = 'tendencias';
  var filtroTexto = '';
  var filtroEstado = 'todas';
  var orden = 'cama';

  /* ============================== KPIs ================================ */

  function pintarKpis() {
    var camas = Modelo.camasVisibles();
    var ocupadas = camas.filter(function (c) { return c.pacienteId; });
    var alertas = Alertas.contarPorNivel();
    var sinSenal = 0, enRiesgo = 0, mlKgHSuma = 0, mlKgHn = 0;

    ocupadas.forEach(function (c) {
      var m = Modelo.metricas(c);
      if (m.vacio) return;
      if (m.sinSenalSeg > CFG.umbrales.segundosSinDatos) sinSenal++;
      if (m.kdigo > 0) enRiesgo++;
      if (m.mlKgH !== null) { mlKgHSuma += m.mlKgH; mlKgHn++; }
    });

    var items = [
      { rot: 'Camas ocupadas', val: ocupadas.length + ' / ' + camas.length, sub: (camas.length - ocupadas.length) + ' libres', clase: 'teal' },
      { rot: 'Diuresis media', val: mlKgHn ? U.num(mlKgHSuma / mlKgHn, 2) : '—', sub: 'mL/kg/h · sala', clase: 'teal' },
      { rot: 'En riesgo (KDIGO)', val: String(enRiesgo), sub: 'con oliguria sostenida', clase: enRiesgo ? 'critico' : 'ok' },
      { rot: 'Alertas activas', val: String(alertas.critica + alertas.alta + alertas.media), sub: alertas.critica + ' críticas · ' + alertas.alta + ' altas', clase: (alertas.critica ? 'critico' : (alertas.alta ? 'aviso' : 'ok')) },
      { rot: 'Sin señal', val: String(sinSenal), sub: 'equipos a reconectar', clase: sinSenal ? 'aviso' : 'ok' }
    ];

    var cont = U.$('#kpis');
    cont.innerHTML = '';
    items.forEach(function (it) {
      var d = U.el('div', 'kpi ' + it.clase);
      d.innerHTML =
        '<div class="kpi-rotulo">' + U.esc(it.rot) + '</div>' +
        '<div class="kpi-valor">' + U.esc(it.val) + '</div>' +
        '<div class="kpi-sub">' + U.esc(it.sub) + '</div>';
      cont.appendChild(d);
    });
  }

  /* ============================== MURAL ================================ */

  function claseEstado(cama, m) {
    if (!cama.pacienteId && !cama.dispositivoId) return 'libre';
    if (!m || m.vacio) return 'sinsenal';
    if (m.sinSenalSeg > CFG.umbrales.segundosSinDatos) return 'sinsenal';
    var nivel = Alertas.nivelCama(cama.id);
    return nivel === 'sinsenal' ? 'ok' : nivel;
  }

  function coincideBusqueda(cama, m, texto) {
    if (!texto) return true;
    texto = texto.toLowerCase();
    var campos = [cama.etiqueta];
    if (m && m.paciente) campos.push(m.paciente.nombre, m.paciente.hc);
    if (m && m.dispositivo) campos.push(m.dispositivo.serie);
    return campos.some(function (c) { return c && c.toLowerCase().indexOf(texto) !== -1; });
  }

  function pasaFiltro(cama, m, estadoClase) {
    if (filtroEstado === 'todas') return true;
    if (filtroEstado === 'libres') return estadoClase === 'libre';
    if (filtroEstado === 'sinsenal') return estadoClase === 'sinsenal';
    if (filtroEstado === 'alerta') return ['critico', 'grave', 'aviso'].indexOf(estadoClase) !== -1;
    if (filtroEstado === 'oliguria') return m && !m.vacio && m.kdigo > 0;
    return true;
  }

  var PESO_ORDEN = { critico: 0, grave: 1, aviso: 2, sinsenal: 3, ok: 4, libre: 5 };

  function pintarMural() {
    var camas = Modelo.camasVisibles();
    var filas = camas.map(function (c) {
      var m = Modelo.metricas(c);
      return { cama: c, m: m, estado: claseEstado(c, m) };
    }).filter(function (f) {
      return coincideBusqueda(f.cama, f.m, filtroTexto) && pasaFiltro(f.cama, f.m, f.estado);
    });

    if (orden === 'criticidad') {
      filas.sort(function (a, b) { return PESO_ORDEN[a.estado] - PESO_ORDEN[b.estado]; });
    } else if (orden === 'diuresis') {
      filas.sort(function (a, b) {
        var av = (a.m && a.m.mlKgH !== null && a.m.mlKgH !== undefined) ? a.m.mlKgH : Infinity;
        var bv = (b.m && b.m.mlKgH !== null && b.m.mlKgH !== undefined) ? b.m.mlKgH : Infinity;
        return av - bv;
      });
    } else {
      filas.sort(function (a, b) { return a.cama.etiqueta.localeCompare(b.cama.etiqueta); });
    }

    U.$('#conteoCamas').textContent = filas.length;
    var mural = U.$('#mural');
    mural.innerHTML = '';
    if (!filas.length) {
      mural.innerHTML = '<div class="vacio" style="grid-column:1/-1">Ninguna cama coincide con el filtro actual.</div>';
      return;
    }
    filas.forEach(function (f) { mural.appendChild(tarjetaCama(f.cama, f.m, f.estado)); });
  }

  function tarjetaCama(cama, m, estado) {
    var div = U.el('div', 'cama est-' + estado);
    div.onclick = function () { abrirDetalle(cama.id); };

    if (estado === 'libre') {
      div.innerHTML =
        '<div class="cama-head">' +
          '<span class="tag-cama libre">' + U.esc(cama.etiqueta) + '</span>' +
        '</div>' +
        '<div class="cama-libre-cuerpo">' +
          iconoCamaLibre() +
          '<div>Cama libre</div>' +
          '<button class="btn secundario chico" data-accion="asignar">Asignar paciente</button>' +
        '</div>';
      div.querySelector('[data-accion="asignar"]').onclick = function (ev) {
        ev.stopPropagation(); abrirAsignar(cama.id);
      };
      return div;
    }

    var p = m.paciente, d = m.dispositivo;
    var bat = d.bat;
    var claseBat = bat <= CFG.umbrales.bateriaCritica ? 'critica' : (bat <= CFG.umbrales.bateriaBaja ? 'baja' : '');
    var alertasCama = Alertas.porCama(cama.id).filter(function (a) { return !a.reconocida; }).slice(0, 3);

    var sub24 = Modelo.bucketsHorarios(d, rangoHoras).map(function (b) { return b.mlH; });

    div.innerHTML =
      '<div class="cama-head">' +
        '<div class="cama-ident">' +
          '<span class="tag-cama">' + U.esc(cama.etiqueta) + '</span>' +
          '<div>' +
            '<div class="cama-nombre">' + U.esc(p ? p.nombre : 'Sin paciente') + '</div>' +
            '<div class="cama-meta">' + (p ? U.esc(p.hc) + ' · ' + p.edad + 'a · ' + p.pesoKg + ' kg' : d.serie) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="cama-badges">' +
          '<span class="badge ' + (d.tipo === 'sim' ? 'sim' : 'real') + '">' + (d.tipo === 'sim' ? 'PILOTO' : 'REAL') + '</span>' +
          (m.muestrasBuffer ? '<span class="badge buffer" title="Datos reconstruidos del búfer">BÚFER</span>' : '') +
          '<span class="bateria ' + claseBat + '" title="Batería ' + Math.round(bat) + ' %">' +
            '<span class="bat-cuerpo"><span class="bat-relleno" style="width:' + U.clamp(bat, 0, 100) + '%"></span></span>' +
            Math.round(bat) + '%' +
          '</span>' +
        '</div>' +
      '</div>' +
      '<div class="cama-cuerpo">' +
        '<div class="dato-principal">' +
          '<div>' +
            '<div class="diuresis-val"><span class="num">' + (m.mlH === null ? '—' : U.num(m.mlH, 0)) + '</span><span class="uni">mL/h</span></div>' +
            '<div class="diuresis-norm">' + (m.mlKgH !== null ? U.num(m.mlKgH, 2) + ' mL/kg/h' : 'sin peso cargado') +
              (m.umbralMlH !== null ? ' · umbral <b>' + U.num(m.umbralMlH, 0) + ' mL/h</b>' : '') + '</div>' +
          '</div>' +
          '<canvas class="spark" data-spark></canvas>' +
        '</div>' +
        '<div class="mini-datos">' +
          '<div class="mini' + (claseTempMini(m.tempC)) + '"><div class="mini-rot">Temp.</div><div class="mini-val">' + (m.tempC === null ? '—' : U.num(m.tempC, 1)) + '<small>°C</small></div></div>' +
          '<div class="mini' + (m.color && m.color.anomalo ? ' alerta' : '') + '"><div class="mini-rot">Color</div><div class="mini-val"><span class="muestra-color" style="background:' + (m.color ? m.color.hex : '#333') + '"></span>' + (m.color ? U.esc(m.color.nombre) : '—') + '</div></div>' +
          '<div class="mini"><div class="mini-rot">Acumulado</div><div class="mini-val">' + U.num(m.volTotalMl, 0) + '<small>mL</small></div></div>' +
        '</div>' +
        '<div class="barra-bolsa">' +
          '<div class="rot"><span>Bolsa colectora</span><span>' + U.num(m.volBolsaMl, 0) + ' / ' + CFG.medicion.capacidadBolsaML + ' mL</span></div>' +
          '<div class="barra-pista"><div class="barra-relleno' + (m.llenado >= CFG.umbrales.bolsaCritica ? ' critico' : (m.llenado >= CFG.umbrales.bolsaAviso ? ' aviso' : '')) + '" style="width:' + Math.round(m.llenado * 100) + '%"></div></div>' +
        '</div>' +
        (alertasCama.length ? '<div class="cama-alertas">' + alertasCama.map(pastillaAlerta).join('') + '</div>' : '') +
      '</div>';

    var cv = div.querySelector('[data-spark]');
    requestAnimationFrame(function () {
      Graf.sparkline(cv, sub24, colorEstado(estado), m.umbralMlH);
    });
    return div;
  }

  function claseTempMini(t) {
    if (t === null) return '';
    if (t >= CFG.umbrales.tempFebrilAlta) return ' alerta';
    if (t >= CFG.umbrales.tempFebril || t <= CFG.umbrales.tempHipotermia) return ' aviso';
    return '';
  }
  function colorEstado(estado) {
    return { ok: getCss('--ok'), aviso: getCss('--aviso'), grave: getCss('--grave'), critico: getCss('--critico'), sinsenal: getCss('--neutro') }[estado] || getCss('--teal');
  }
  function getCss(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  function pastillaAlerta(a) {
    var clase = { critica: 'critica', alta: 'alta', media: 'media', tecnica: 'tecnica' }[a.nivel];
    return '<span class="pastilla ' + clase + '">' + U.esc(a.titulo) + '</span>';
  }

  function iconoCamaLibre() {
    return '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10" width="18" height="8" rx="1.5"/><path d="M5 10V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3"/><path d="M7 18v2M17 18v2"/></svg>';
  }

  /* ============================ ALERTAS LATERAL ========================= */

  function pintarAlertas() {
    var lista = Alertas.lista();
    var activasNoRec = lista.filter(function (a) { return !a.reconocida; });
    var cont = U.$('#contAlertas');
    cont.textContent = activasNoRec.length;
    cont.classList.toggle('activo', activasNoRec.length > 0);

    var el = U.$('#listaAlertas');
    if (!lista.length) { el.innerHTML = '<div class="vacio">Sin alertas activas. Todo dentro de rango.</div>'; return; }
    el.innerHTML = '';
    lista.forEach(function (a) {
      var it = U.el('div', 'item-alerta ' + a.nivel + (a.reconocida ? ' reconocida' : ''));
      it.innerHTML =
        '<div class="franja"></div>' +
        '<div class="alerta-cuerpo">' +
          '<div class="alerta-titulo"><span class="cama-ref">' + U.esc(a.ref) + '</span>' + U.esc(a.titulo) + '</div>' +
          '<div class="alerta-detalle">' + U.esc(a.detalle) + '</div>' +
          '<div class="alerta-tiempo">' + U.desde(a.desde) + (a.reconocida ? ' · reconocida' : '') + '</div>' +
        '</div>';
      it.onclick = function () { abrirDetalle(a.camaId); };
      el.appendChild(it);
    });
  }

  function pintarEventos() {
    var ev = Modelo.estado.eventos.slice(-40).reverse();
    var el = U.$('#listaEventos');
    if (!ev.length) { el.innerHTML = '<div class="vacio">Sin eventos todavía.</div>'; return; }
    el.innerHTML = ev.map(function (e) {
      var cama = e.camaId ? Modelo.buscarCama(e.camaId) : null;
      return '<div class="item-evento"><span class="hora">' + U.hora(e.t) + '</span><span>' +
        (cama ? '<b style="color:var(--texto)">' + U.esc(cama.etiqueta) + '</b> · ' : '') +
        U.esc(e.texto) + '</span></div>';
    }).join('');
  }

  /* ============================ ESTADO GLOBAL =========================== */

  function pintarBarraEstado() {
    var modoReal = Modelo.estado.modo === 'real';
    U.$$('.modo').forEach(function (b) {
      var on = b.dataset.modo === Modelo.estado.modo;
      b.classList.toggle('activo', on);
      b.setAttribute('aria-selected', on);
    });
    U.$('#avisoReal').classList.toggle('oculto', !modoReal);
    U.$('#chkPilotoEnReal').checked = Modelo.estado.mostrarPilotoEnReal;

    var chip = U.$('#chipEnlace');
    chip.className = 'chip';
    if (!modoReal) {
      chip.classList.add('simulado');
      chip.querySelector('.chip-txt').textContent = 'Simulación · piloto';
    } else {
      var e = Conexion.estado();
      var det = U.$('#avisoRealDetalle');
      if (e.estado === 'conectado') {
        chip.classList.add('en-linea');
        chip.querySelector('.chip-txt').textContent = 'En línea · ' + e.tipo;
        det.textContent = 'Recibiendo datos del dispositivo (' + e.recibidas + ' muestras' + (e.recuperadas ? ', ' + e.recuperadas + ' recuperadas del búfer' : '') + ').';
      } else if (e.estado === 'conectando') {
        chip.classList.add('simulado');
        chip.querySelector('.chip-txt').textContent = 'Conectando…';
        det.textContent = e.detalle || 'Estableciendo enlace con el dispositivo.';
      } else if (e.estado === 'error') {
        chip.classList.add('error');
        chip.querySelector('.chip-txt').textContent = 'Enlace caído';
        det.textContent = (e.detalle || 'Sin conexión') + '. Los datos mostrados son los últimos recibidos.';
      } else {
        chip.classList.add('error');
        chip.querySelector('.chip-txt').textContent = 'Sin dispositivo';
        det.textContent = 'Sin dispositivo conectado. Configurá el enlace para recibir datos del ESP32.';
      }
    }

    var bufferPend = Object.keys(Modelo.estado.dispositivos).reduce(function (n, k) {
      var d = Modelo.estado.dispositivos[k];
      return n + (d.muestras.length ? d.muestras.filter(function (m) { return m.origen === 'buffer' && m.t > Date.now() - 120000; }).length : 0);
    }, 0);
    U.$('#chipBuffer').classList.toggle('oculto', bufferPend === 0);
    if (bufferPend) U.$('#chipBuffer').querySelector('.chip-txt').textContent = bufferPend + ' recuperadas del búfer';

    var btnSonido = U.$('#btnSonido');
    btnSonido.classList.toggle('mudo', U.estaSilenciado());
  }

  function pintarReloj() {
    U.$('#reloj').textContent = U.horaSeg(Date.now());
  }

  /* =============================== TODO ================================= */

  function pintarTodo() {
    pintarBarraEstado();
    pintarKpis();
    pintarMural();
    pintarAlertas();
    pintarEventos();
    if (camaAbierta) actualizarDetalleAbierto();
  }

  /* ============================ MODAL DETALLE ============================ */

  function abrirDetalle(camaId) {
    camaAbierta = camaId;
    tabDetalle = 'tendencias';
    U.$$('.tab-det').forEach(function (b) { b.classList.toggle('activo', b.dataset.tab === tabDetalle); });
    U.$$('.tab-panel').forEach(function (p) { p.classList.toggle('activo', p.dataset.panel === tabDetalle); });
    renderDetalle();
    U.$('#modalDetalle').classList.add('abierto');
    U.$('#modalDetalle').setAttribute('aria-hidden', 'false');
  }
  function cerrarDetalle() {
    camaAbierta = null;
    U.$('#modalDetalle').classList.remove('abierto');
    U.$('#modalDetalle').setAttribute('aria-hidden', 'true');
  }
  function actualizarDetalleAbierto() {
    if (!U.$('#modalDetalle').classList.contains('abierto')) return;
    renderDetalle();
  }

  function renderDetalle() {
    var cama = Modelo.buscarCama(camaAbierta);
    if (!cama) { cerrarDetalle(); return; }
    var m = Modelo.metricas(cama);

    U.$('#detCama').textContent = cama.etiqueta;
    U.$('#detCama').className = 'tag-cama' + (m.vacio ? ' libre' : '');
    U.$('#detNombre').textContent = m.paciente ? m.paciente.nombre : 'Cama sin paciente';
    U.$('#detMeta').textContent = m.paciente
      ? (m.paciente.hc + ' · ' + m.paciente.edad + ' años · ' + m.paciente.sexo + ' · ' + m.paciente.pesoKg + ' kg · ' + (m.paciente.dx || 'sin diagnóstico cargado'))
      : (m.dispositivo ? m.dispositivo.serie + ' sin paciente vinculado' : 'Sin dispositivo asignado');

    U.$('#btnVaciarBolsa').style.display = m.dispositivo ? '' : 'none';
    U.$('#btnExportar').style.display = m.dispositivo ? '' : 'none';

    renderResumen(m);
    if (m.dispositivo) {
      renderTendencias(m);
      renderDispositivo(m);
      renderEventosCama(cama);
    } else {
      ['gDiuresis', 'gVolumen', 'gTemp', 'gColor'].forEach(function (id) {
        var c = U.$('#' + id); var ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
      });
      U.$('#detDispositivo').innerHTML = '<p class="nota">Esta cama todavía no tiene un dispositivo vinculado.</p>';
      U.$('#detEventos').innerHTML = '<p class="nota">Sin eventos.</p>';
    }
  }

  function resVal(rot, val, sub, clase) {
    return '<div class="res ' + (clase || '') + '"><div class="res-rot">' + U.esc(rot) + '</div><div class="res-val">' + val + '</div><div class="res-sub">' + U.esc(sub || '') + '</div></div>';
  }

  function renderResumen(m) {
    var el = U.$('#detResumen');
    if (m.vacio) { el.innerHTML = ''; return; }
    var kdigoTxt = ['Sin criterio KDIGO', 'KDIGO 1', 'KDIGO 2', 'KDIGO 3'][m.kdigo];
    var kdigoClase = m.kdigo >= 2 ? 'critico' : (m.kdigo === 1 ? 'aviso' : 'ok');
    el.innerHTML =
      resVal('Diuresis (1 h)', (m.mlH === null ? '—' : U.num(m.mlH, 0) + ' <small>mL/h</small>'), m.mlKgH !== null ? U.num(m.mlKgH, 2) + ' mL/kg/h' : '', claseTasa(m.mlKgH)) +
      resVal('Diuresis (6 h)', (m.mlH6 === null ? '—' : U.num(m.mlKgH6, 2) + ' <small>mL/kg/h</small>'), 'promedio de las últimas 6 h', claseTasa(m.mlKgH6)) +
      resVal('Temperatura', (m.tempC === null ? '—' : U.num(m.tempC, 1) + ' <small>°C</small>'), 'máx. 6 h: ' + (m.tempMax6h !== null ? U.num(m.tempMax6h, 1) + ' °C' : '—'), claseTemp(m.tempC)) +
      resVal('Color', m.color ? U.esc(m.color.nombre) : '—', m.color ? m.color.hidratacion : '', m.color && m.color.anomalo ? 'critico' : 'ok') +
      resVal('Volumen acumulado', U.num(m.volTotalMl, 0) + ' <small>mL</small>', 'desde el alta del dispositivo', '') +
      resVal('Estado renal', kdigoTxt, m.horasOliguria ? m.horasOliguria + ' h por debajo de 0,5 mL/kg/h' : 'diuresis dentro de objetivo', kdigoClase);
  }
  function claseTasa(v) {
    if (v === null || v === undefined) return '';
    if (v < CFG.umbrales.anuria) return 'critico';
    if (v < CFG.umbrales.oliguria) return 'grave';
    if (v > CFG.umbrales.poliuria) return 'aviso';
    return 'ok';
  }
  function claseTemp(t) {
    if (t === null) return '';
    if (t >= CFG.umbrales.tempFebrilAlta || t <= CFG.umbrales.tempHipotermia) return 'critico';
    if (t >= CFG.umbrales.tempFebril) return 'aviso';
    return 'ok';
  }

  function renderTendencias(m) {
    var d = m.dispositivo, p = m.paciente;
    var ahora = m.ahora;
    var desde = ahora - rangoHoras * 3600000;
    var ms = d.muestras.filter(function (x) { return x.t >= desde; });
    if (!ms.length) ms = d.muestras.slice(-2);

    Graf.barrasDiuresis(U.$('#gDiuresis'), Modelo.bucketsHorarios(d, rangoHoras), {
      pesoKg: p ? p.pesoKg : null, umbralMlH: m.umbralMlH
    });

    Graf.serie(U.$('#gVolumen'), ms.map(function (x) { return { t: x.t, v: x.volTotalMl, buffer: x.origen === 'buffer' }; }), {
      color: getCss('--teal'), area: true, desdeCero: true, unidad: ' mL'
    });
    U.$('#legVolumen').textContent = U.num(m.volTotalMl, 0) + ' mL acumulados';

    Graf.serie(U.$('#gTemp'), ms.map(function (x) { return { t: x.t, v: x.tempC, buffer: x.origen === 'buffer' }; }), {
      color: getCss('--aviso'), unidad: ' °C',
      banda: { desde: CFG.umbrales.tempFebril, hasta: 42, color: hexAlpha(getCss('--critico'), .08) },
      min: 34.5, max: 40
    });

    Graf.tiraColor(U.$('#gColor'), ms);
    U.$('#legColor').textContent = m.color ? (m.color.nivel ? 'Escala ' + m.color.nivel + '/8' : m.color.nombre) : '';
  }
  function hexAlpha(hex, a) {
    var rgb = U.hexARgb(hex.trim());
    return 'rgba(' + rgb.join(',') + ',' + a + ')';
  }

  function renderDispositivo(m) {
    var d = m.dispositivo;
    var e = d.tipo === 'sim' ? null : Conexion.estado();
    var html = '<div class="fila">' +
      resVal('N.º de serie', '<span style="font-family:var(--mono)">' + U.esc(d.serie) + '</span>', d.tipo === 'sim' ? 'dispositivo piloto (simulado)' : 'dispositivo real', '') +
      resVal('Estado del enlace', d.estado === 'en-linea' ? 'En línea' : 'Sin señal', U.desde(d.ultimoContacto || d.reloj), d.estado === 'en-linea' ? 'ok' : 'critico') +
    '</div><div class="fila">' +
      resVal('Batería', Math.round(d.bat) + ' <small>%</small>', '', d.bat <= CFG.umbrales.bateriaBaja ? 'aviso' : 'ok') +
      resVal('Señal (RSSI)', Math.round(d.rssi) + ' <small>dBm</small>', d.tipo === 'sim' ? 'simulado' : (e ? e.tipo : '—'), '') +
    '</div>';

    if (d.tipo === 'sim') {
      var esc = Simulador.escenarios[d.escenario];
      html += '<div class="sep"></div><div class="subtitulo">Escenario piloto</div>' +
        '<p class="nota"><b style="color:var(--texto)">' + U.esc(esc ? esc.nombre : d.escenario) + '</b> — ' + U.esc(esc ? esc.resumen : '') + '</p>' +
        '<div class="campo"><label>Cambiar escenario</label><select id="selEscenarioDet"></select></div>' +
        '<div class="acciones"><button class="btn secundario chico" id="btnAplicarEscenario">Aplicar (mantiene el historial)</button>' +
        '<button class="btn chico" id="btnReiniciarEscenario">Reiniciar con 8 h de historial nuevo</button></div>';
    }

    html += '<div class="sep"></div><div class="subtitulo">Calibración</div>' +
      '<div class="fila">' +
        '<div class="campo"><label>Tara de la bolsa (g)</label><input type="number" id="inTaraDet" value="' + d.tara + '"></div>' +
        '<div class="campo"><label>Vaciados registrados</label><input type="number" value="' + d.vaciados + '" disabled></div>' +
      '</div><div class="acciones"><button class="btn secundario chico" id="btnGuardarTara">Guardar tara</button></div>';

    U.$('#detDispositivo').innerHTML = html;

    if (d.tipo === 'sim') {
      var sel = U.$('#selEscenarioDet');
      Simulador.listaEscenarios().forEach(function (o) {
        var op = U.el('option'); op.value = o.clave; op.textContent = o.nombre;
        if (o.clave === d.escenario) op.selected = true;
        sel.appendChild(op);
      });
      U.$('#btnAplicarEscenario').onclick = function () {
        Acciones.cambiarEscenario(d.id, sel.value, false);
        toast('Escenario actualizado: ' + Simulador.escenarios[sel.value].nombre);
      };
      U.$('#btnReiniciarEscenario').onclick = function () {
        Acciones.cambiarEscenario(d.id, sel.value, true);
        toast('Historial reiniciado con el nuevo escenario');
      };
    }
    U.$('#btnGuardarTara').onclick = function () {
      d.tara = parseFloat(U.$('#inTaraDet').value) || d.tara;
      Acciones.guardar();
      toast('Tara actualizada');
    };
  }

  function renderEventosCama(cama) {
    var d = Modelo.estado.dispositivos[cama.dispositivoId];
    var ev = (d ? d.eventos : []).slice(-60).reverse();
    if (!ev.length) { U.$('#detEventos').innerHTML = '<p class="nota">Sin eventos registrados.</p>'; return; }
    var filas = ev.map(function (e) {
      return '<tr><td style="font-family:var(--mono);white-space:nowrap">' + U.fechaHora(e.t) + '</td><td>' + U.esc(e.tipo) + '</td><td>' + U.esc(e.texto) + '</td></tr>';
    }).join('');
    U.$('#detEventos').innerHTML = '<table class="tabla"><thead><tr><th>Cuándo</th><th>Tipo</th><th>Detalle</th></tr></thead><tbody>' + filas + '</tbody></table>';
  }

  /* ============================ MODAL ASIGNAR ============================ */

  function abrirAsignar(camaId) {
    var cama = Modelo.buscarCama(camaId);
    U.$('#asigTitulo').textContent = 'Asignar ' + cama.etiqueta;
    var libres = Modelo.dispositivosLibres();
    var pacientesUsados = {};
    Modelo.estado.camas.forEach(function (c) { if (c.pacienteId && c.id !== camaId) pacientesUsados[c.pacienteId] = 1; });
    var pacientesLibres = Object.keys(Modelo.estado.pacientes)
      .map(function (k) { return Modelo.estado.pacientes[k]; })
      .filter(function (p) { return !pacientesUsados[p.id]; });

    var html = '';
    html += '<div class="subtitulo">Paciente</div>';
    html += '<div class="campo"><label>Vincular paciente existente</label><select id="selPaciente"><option value="">— Ninguno —</option>' +
      pacientesLibres.map(function (p) { return '<option value="' + p.id + '"' + (cama.pacienteId === p.id ? ' selected' : '') + '>' + U.esc(p.nombre) + ' · ' + U.esc(p.hc) + '</option>'; }).join('') +
      (cama.pacienteId && !pacientesUsados[cama.pacienteId] ? '' : '') + '</select></div>';

    html += '<div class="acciones" style="justify-content:flex-start"><button class="btn secundario chico" id="btnNuevoPaciente">+ Nuevo paciente</button></div>';
    html += '<div id="formNuevoPaciente" class="oculto"></div>';

    html += '<div class="sep"></div><div class="subtitulo">Dispositivo</div>';
    html += '<div class="lista-dispositivos" id="listaDisp"></div>';
    html += '<div class="acciones" style="justify-content:flex-start"><button class="btn secundario chico" id="btnNuevoDisp">+ Dispositivo piloto de prueba</button></div>';

    html += '<div class="sep"></div><div class="acciones">' +
      (cama.dispositivoId || cama.pacienteId ? '<button class="btn peligro chico" id="btnLiberar">Liberar cama</button>' : '') +
      '<button class="btn secundario chico" id="btnCancelarAsig">Cancelar</button>' +
      '<button class="btn chico" id="btnGuardarAsig">Guardar</button>' +
    '</div>';

    U.$('#asigCuerpo').innerHTML = html;

    var dispSel = cama.dispositivoId;
    function pintarListaDisp() {
      var lista = Modelo.dispositivosLibres();
      // El dispositivo ya asignado a esta cama también tiene que poder elegirse.
      if (cama.dispositivoId && !lista.some(function (x) { return x.id === cama.dispositivoId; })) {
        lista = [Modelo.estado.dispositivos[cama.dispositivoId]].concat(lista);
      }
      var cont = U.$('#listaDisp');
      cont.innerHTML = lista.length ? lista.map(function (d) {
        return '<div class="disp-opcion' + (dispSel === d.id ? ' sel' : '') + '" data-id="' + d.id + '">' +
          '<div><div class="serie">' + U.esc(d.serie) + '</div><div class="desc">' + (d.tipo === 'sim' ? 'Piloto · ' + (Simulador.escenarios[d.escenario] || {}).nombre : 'Dispositivo real') + '</div></div>' +
          '<div class="estado-mini">' + (d.estado === 'en-linea' ? 'en línea' : 'sin señal') + '</div>' +
        '</div>';
      }).join('') : '<p class="nota">No hay dispositivos libres. Se puede crear uno piloto para pruebas.</p>';
      U.$$('.disp-opcion', cont).forEach(function (op) {
        op.onclick = function () {
          dispSel = dispSel === op.dataset.id ? null : op.dataset.id;
          U.$$('.disp-opcion', cont).forEach(function (o) { o.classList.toggle('sel', o.dataset.id === dispSel); });
        };
      });
    }
    pintarListaDisp();

    U.$('#btnNuevoPaciente').onclick = function () { toggleFormNuevoPaciente(true); };
    U.$('#btnNuevoDisp').onclick = function () {
      var d = Modelo.crearDispositivo({ tipo: 'sim', escenario: 'normal' });
      dispSel = d.id;
      pintarListaDisp();
      toast('Dispositivo piloto creado: ' + d.serie);
    };
    U.$('#btnCancelarAsig').onclick = cerrarAsignar;
    var btnLib = U.$('#btnLiberar');
    if (btnLib) btnLib.onclick = function () {
      Modelo.asignar(camaId, null, null);
      Acciones.guardar();
      cerrarAsignar(); UI.pintarTodo();
      toast('Cama liberada');
    };
    U.$('#btnGuardarAsig').onclick = function () {
      var pacId = U.$('#selPaciente').value || null;
      var nuevo = leerFormNuevoPaciente();
      if (nuevo) { var p = Modelo.altaPaciente(nuevo); pacId = p.id; }
      Modelo.asignar(camaId, pacId, dispSel);
      Acciones.guardar();
      cerrarAsignar(); UI.pintarTodo();
      toast('Cama actualizada');
    };

    U.$('#modalAsignar').classList.add('abierto');
    U.$('#modalAsignar').setAttribute('aria-hidden', 'false');
  }

  function toggleFormNuevoPaciente(on) {
    var cont = U.$('#formNuevoPaciente');
    if (!on) { cont.classList.add('oculto'); cont.innerHTML = ''; return; }
    cont.classList.remove('oculto');
    cont.innerHTML =
      '<div class="fila">' +
        '<div class="campo"><label>Nombre y apellido</label><input type="text" id="npNombre" placeholder="Apellido, Nombre"></div>' +
        '<div class="campo"><label>N.º de historia clínica</label><input type="text" id="npHc" placeholder="HC-00000"></div>' +
      '</div>' +
      '<div class="fila-3">' +
        '<div class="campo"><label>Edad</label><input type="number" id="npEdad" min="0" max="120"></div>' +
        '<div class="campo"><label>Sexo</label><select id="npSexo"><option value="F">F</option><option value="M">M</option><option value="-">Otro</option></select></div>' +
        '<div class="campo"><label>Peso (kg)</label><input type="number" id="npPeso" min="1" step="0.5" placeholder="70"></div>' +
      '</div>' +
      '<div class="campo"><label>Diagnóstico / motivo de ingreso</label><input type="text" id="npDx" placeholder="Opcional"></div>';
  }
  function leerFormNuevoPaciente() {
    var nombreEl = U.$('#npNombre');
    if (!nombreEl || !nombreEl.value.trim()) return null;
    var peso = parseFloat(U.$('#npPeso').value);
    return {
      nombre: nombreEl.value.trim(),
      hc: U.$('#npHc').value.trim() || ('HC-' + Math.floor(Math.random() * 90000 + 10000)),
      edad: parseInt(U.$('#npEdad').value, 10) || null,
      sexo: U.$('#npSexo').value,
      pesoKg: peso && peso > 0 ? peso : 70,
      dx: U.$('#npDx').value.trim(),
      ingreso: Date.now(), objetivoMlKgH: 0.5, notas: ''
    };
  }

  function cerrarAsignar() {
    U.$('#modalAsignar').classList.remove('abierto');
    U.$('#modalAsignar').setAttribute('aria-hidden', 'true');
  }

  /* ============================ MODAL CONFIG ============================= */

  function abrirConfig() {
    var enlace = Modelo.estado.enlace, med = Modelo.estado.medicion;
    var html =
      '<div class="subtitulo">Enlace con el dispositivo real</div>' +
      '<div class="campo"><label>Transporte</label><select id="cfgTipo">' +
        ['websocket', 'http', 'bluetooth', 'serie'].map(function (t) {
          return '<option value="' + t + '"' + (enlace.tipo === t ? ' selected' : '') + '>' +
            { websocket: 'WiFi · WebSocket (recomendado)', http: 'WiFi · HTTP (consulta periódica)', bluetooth: 'Bluetooth Low Energy', serie: 'Cable USB (Web Serial)' }[t] + '</option>';
        }).join('') + '</select></div>' +
      '<div class="fila">' +
        '<div class="campo"><label>URL WebSocket</label><input type="text" id="cfgWs" value="' + U.esc(enlace.urlWebSocket) + '"></div>' +
        '<div class="campo"><label>URL HTTP</label><input type="text" id="cfgHttp" value="' + U.esc(enlace.urlHttp) + '"></div>' +
      '</div>' +
      '<p class="nota">Bluetooth y USB piden permiso del navegador (Chrome/Edge) al conectar; no se pueden precargar por URL.</p>' +
      '<div class="acciones" style="justify-content:flex-start">' +
        '<button class="btn chico" id="btnConectarCfg">Conectar</button>' +
        '<button class="btn secundario chico" id="btnDesconectarCfg">Desconectar</button>' +
      '</div>' +
      '<div class="sep"></div><div class="subtitulo">Calibración de la medición</div>' +
      '<div class="fila-3">' +
        '<div class="campo"><label>Densidad de la orina</label><input type="number" id="cfgDensidad" step="0.001" value="' + med.densidadOrina + '"></div>' +
        '<div class="campo"><label>Tara de bolsa (g)</label><input type="number" id="cfgTara" value="' + med.taraBolsaG + '"></div>' +
        '<div class="campo"><label>Capacidad bolsa (mL)</label><input type="number" id="cfgCap" value="' + med.capacidadBolsaML + '"></div>' +
      '</div>' +
      '<div class="sep"></div><div class="subtitulo">Modo piloto</div>' +
      '<div class="campo"><label>Velocidad de simulación</label><select id="cfgVel">' +
        CFG.velocidades.map(function (v) { return '<option value="' + v.v + '"' + (Modelo.estado.velocidad === v.v ? ' selected' : '') + '>' + v.rot + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="sep"></div><div class="subtitulo">Datos locales</div>' +
      '<p class="nota">Todo se guarda en este navegador (' + Almacen.tamano() + ' KB usados). No se envía a ningún servidor.</p>' +
      '<div class="acciones" style="justify-content:flex-start">' +
        '<button class="btn secundario chico" id="btnExportarTodo">Exportar todo a CSV</button>' +
        '<button class="btn peligro chico" id="btnBorrarTodo">Borrar y reiniciar con la sala de ejemplo</button>' +
      '</div>' +
      '<div class="sep"></div><div class="acciones"><button class="btn chico" id="btnGuardarCfg">Guardar configuración</button></div>';

    U.$('#cfgCuerpo').innerHTML = html;

    U.$('#btnConectarCfg').onclick = function () {
      Modelo.estado.enlace.tipo = U.$('#cfgTipo').value;
      Modelo.estado.enlace.urlWebSocket = U.$('#cfgWs').value.trim();
      Modelo.estado.enlace.urlHttp = U.$('#cfgHttp').value.trim();
      Acciones.guardar();
      Conexion.abrir(Modelo.estado.enlace.tipo);
    };
    U.$('#btnDesconectarCfg').onclick = function () { Conexion.desconectar(); };
    U.$('#btnGuardarCfg').onclick = function () {
      med.densidadOrina = parseFloat(U.$('#cfgDensidad').value) || med.densidadOrina;
      med.taraBolsaG = parseFloat(U.$('#cfgTara').value) || med.taraBolsaG;
      med.capacidadBolsaML = parseFloat(U.$('#cfgCap').value) || med.capacidadBolsaML;
      Modelo.estado.velocidad = parseInt(U.$('#cfgVel').value, 10) || 1;
      Acciones.guardar();
      cerrarConfig();
      toast('Configuración guardada');
      UI.pintarTodo();
    };
    U.$('#btnExportarTodo').onclick = function () { Acciones.exportarTodoCsv(); };
    U.$('#btnBorrarTodo').onclick = function () {
      if (!confirm('Esto borra todos los pacientes, dispositivos e historial guardados en este navegador y recarga la sala de ejemplo. ¿Continuar?')) return;
      Almacen.borrar();
      location.reload();
    };

    U.$('#modalConfig').classList.add('abierto');
    U.$('#modalConfig').setAttribute('aria-hidden', 'false');
  }
  function cerrarConfig() {
    U.$('#modalConfig').classList.remove('abierto');
    U.$('#modalConfig').setAttribute('aria-hidden', 'true');
  }

  /* =============================== TOASTS ================================ */

  function toast(msg, tipo) {
    var t = U.el('div', 'toast' + (tipo ? ' ' + tipo : ''), msg);
    U.$('#toasts').appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; setTimeout(function () { t.remove(); }, 260); }, 4200);
  }

  /* ========================= Listeners generales ========================= */

  function bind() {
    U.$$('.modo').forEach(function (b) {
      b.onclick = function () { Acciones.cambiarModo(b.dataset.modo); };
    });
    U.$('#chkPilotoEnReal').onchange = function (ev) {
      Modelo.estado.mostrarPilotoEnReal = ev.target.checked;
      Acciones.guardar(); UI.pintarTodo();
    };
    U.$('#btnConectarRapido').onclick = abrirConfig;
    U.$('#btnConfig').onclick = abrirConfig;
    U.$('#btnCerrarConfig').onclick = cerrarConfig;
    U.$('#modalConfig').addEventListener('click', function (ev) { if (ev.target.id === 'modalConfig') cerrarConfig(); });

    U.$('#btnSonido').onclick = function () {
      U.silenciar(!U.estaSilenciado());
      Modelo.estado.silenciado = U.estaSilenciado();
      Acciones.guardar();
      pintarBarraEstado();
    };
    U.$('#btnTema').onclick = function () {
      var nuevo = Modelo.estado.tema === 'oscuro' ? 'claro' : 'oscuro';
      Modelo.estado.tema = nuevo;
      document.documentElement.dataset.tema = nuevo;
      Acciones.guardar();
    };

    U.$('#buscar').oninput = function (ev) { filtroTexto = ev.target.value; pintarMural(); };
    U.$('#filtroEstado').onchange = function (ev) { filtroEstado = ev.target.value; pintarMural(); };
    U.$('#orden').onchange = function (ev) { orden = ev.target.value; pintarMural(); };
    U.$('#btnNuevaCama').onclick = function () { Acciones.agregarCama(); };

    U.$('#btnCerrarDetalle').onclick = cerrarDetalle;
    U.$('#modalDetalle').addEventListener('click', function (ev) { if (ev.target.id === 'modalDetalle') cerrarDetalle(); });
    U.$$('.tab-det').forEach(function (b) {
      b.onclick = function () {
        tabDetalle = b.dataset.tab;
        U.$$('.tab-det').forEach(function (x) { x.classList.toggle('activo', x === b); });
        U.$$('.tab-panel').forEach(function (p) { p.classList.toggle('activo', p.dataset.panel === tabDetalle); });
      };
    });
    U.$$('#rangoTiempo .rango').forEach(function (b) {
      b.onclick = function () {
        rangoHoras = parseInt(b.dataset.horas, 10);
        U.$$('#rangoTiempo .rango').forEach(function (x) { x.classList.toggle('activo', x === b); });
        renderDetalle();
      };
    });
    U.$('#btnAsignarDesdeDetalle').onclick = function () { if (camaAbierta) abrirAsignar(camaAbierta); };
    U.$('#btnVaciarBolsa').onclick = function () { if (camaAbierta) Acciones.vaciarBolsa(camaAbierta); };
    U.$('#btnExportar').onclick = function () { if (camaAbierta) Acciones.exportarCamaCsv(camaAbierta); };

    U.$('#btnCerrarAsignar').onclick = cerrarAsignar;
    U.$('#modalAsignar').addEventListener('click', function (ev) { if (ev.target.id === 'modalAsignar') cerrarAsignar(); });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { cerrarDetalle(); cerrarAsignar(); cerrarConfig(); }
    });

    Alertas.alCambiar(function () { pintarAlertas(); });
    Conexion.alCambiar(function () { pintarBarraEstado(); });
  }

  return {
    bind: bind, pintarTodo: pintarTodo, pintarReloj: pintarReloj,
    abrirDetalle: abrirDetalle, abrirAsignar: abrirAsignar, abrirConfig: abrirConfig,
    toast: toast
  };
})();
