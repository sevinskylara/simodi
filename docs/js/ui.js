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
  var codigoSilenciar = null; // código de la alerta a la que se le está por elegir motivo de silencio
  var filtroTexto = '';
  var filtroEstado = 'todas';
  var orden = 'cama';
  var eventosExpandido = false;

  /* ============================== KPIs ================================ */

  function pintarKpis() {
    var camas = Modelo.camasVisibles();
    var ocupadas = camas.filter(function (c) { return c.pacienteId; });
    var alertas = Alertas.contarPorNivel();
    var sinSenal = 0, enRiesgo = 0, enObjetivo = 0, conDato = 0;

    ocupadas.forEach(function (c) {
      var m = Modelo.metricas(c);
      if (m.vacio) return;
      if (m.sinSenalSeg > CFG.umbrales.segundosSinDatos) sinSenal++;
      if (m.kdigo > 0) enRiesgo++;
      if (m.mlKgH !== null) {
        conDato++;
        if (claseTasa(m.mlKgH) === 'ok') enObjetivo++;
      }
    });

    var items = [
      { rot: 'Camas ocupadas', val: ocupadas.length + ' / ' + camas.length, sub: (camas.length - ocupadas.length) + ' libres', clase: 'teal' },
      { rot: 'En objetivo', val: conDato ? enObjetivo + ' / ' + conDato : '—',
        sub: 'diuresis dentro de rango', clase: !conDato ? 'teal' : (enObjetivo === conDato ? 'ok' : (enObjetivo === 0 ? 'critico' : 'aviso')) },
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
    // Sin datos de dispositivo en este equipo: puede ser que nunca se haya
    // vinculado uno, o que el dispositivoId venga sincronizado desde otra
    // computadora (dispositivos/muestras son locales a cada navegador, no
    // se sincronizan). En ambos casos no hay nada de "m.dispositivo" que
    // mostrar, con o sin paciente asignado.
    if (!m || m.vacio) return 'sindispositivo';
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
    if (filtroEstado === 'conpaciente') return !!(m && m.paciente);
    // A diferencia del paciente (que sí se sincroniza por completo con la
    // nube), el dispositivo es local a cada navegador: cama.dispositivoId
    // puede estar bien asignado y no resolver a m.dispositivo en este
    // equipo. El filtro es sobre la asignación, no sobre si hay datos acá.
    if (filtroEstado === 'condispositivo') return !!cama.dispositivoId;
    if (filtroEstado === 'libres') return estadoClase === 'libre';
    if (filtroEstado === 'sinsenal') return estadoClase === 'sinsenal';
    if (filtroEstado === 'alerta') return ['critico', 'grave', 'aviso'].indexOf(estadoClase) !== -1;
    if (filtroEstado === 'oliguria') return m && !m.vacio && m.kdigo > 0;
    return true;
  }

  var PESO_ORDEN = { critico: 0, grave: 1, aviso: 2, sinsenal: 3, sindispositivo: 4, ok: 5, libre: 6 };

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
      mural.innerHTML = '<div class="vacio" style="width:100%">Ninguna cama coincide con el filtro actual.</div>';
    } else {
      filas.forEach(function (f) { mural.appendChild(tarjetaCama(f.cama, f.m, f.estado)); });
    }
    alinearAnchoFilaIncompleta();

    // El panel de alertas y el de eventos se alinean al mural en cada
    // repintado, no sólo en pintarTodo(): si sólo se repinta el mural
    // (buscar/filtrar/ordenar) su cantidad de filas puede cambiar sin que
    // cambie la cantidad de alertas, y si el alto quedara desactualizado
    // parecería (engañosamente) que la lista de alertas está filtrada
    // junto con las camas.
    igualarAlturasLateral();
  }

  /* Cuando la última fila queda incompleta, sus tarjetas crecen con
     flex-grow para no dejar un hueco vacío a la derecha (ver .mural en
     estilos.css) — pero antes tenían un max-width fijo (780px) que sólo
     aproximaba "el ancho de dos tarjetas", sin coincidir exactamente con
     el borde real de la 2.ª columna en cada resolución. Se mide el ancho
     real de una columna en una fila completa y se fija --ancho-doble a
     ese valor exacto (2 columnas + el gap entre ellas), para que el
     borde derecho de una tarjeta que creció quede alineado con el de la
     2.ª tarjeta de la fila de arriba. */
  function alinearAnchoFilaIncompleta() {
    var mural = U.$('#mural');
    var hijos = U.$$('.cama', mural);
    if (!hijos.length) return;
    var gap = parseFloat(getComputedStyle(mural).columnGap) || 13;
    var filas = [];
    hijos.forEach(function (el) {
      var top = el.offsetTop;
      var fila = filas.filter(function (f) { return Math.abs(f.top - top) < 1; })[0];
      if (!fila) { fila = { top: top, elems: [] }; filas.push(fila); }
      fila.elems.push(el);
    });
    var filaCompleta = filas.filter(function (f) { return f.elems.length > 1; })[0];
    if (!filaCompleta) return;
    var anchoColumna = filaCompleta.elems[0].getBoundingClientRect().width;
    mural.style.setProperty('--ancho-doble', Math.round(anchoColumna * 2 + gap) + 'px');
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
          '<div class="cama-libre-acciones">' +
            '<button class="btn secundario chico" data-accion="asignar">Asignar paciente</button>' +
            '<button class="btn peligro chico" data-accion="eliminar">Eliminar cama</button>' +
          '</div>' +
        '</div>';
      div.querySelector('[data-accion="asignar"]').onclick = function (ev) {
        ev.stopPropagation(); abrirAsignar(cama.id);
      };
      div.querySelector('[data-accion="eliminar"]').onclick = function (ev) {
        ev.stopPropagation(); Acciones.eliminarCama(cama.id);
      };
      return div;
    }

    if (estado === 'sindispositivo') {
      var encabezado = m.paciente
        ? '<div class="cama-ident">' +
            '<span class="tag-cama">' + U.esc(cama.etiqueta) + '</span>' +
            '<div>' +
              '<div class="cama-nombre">' + U.esc(m.paciente.nombre) + '</div>' +
              '<div class="cama-meta">' + U.esc(m.paciente.hc) + ' · ' + (m.paciente.edad ? m.paciente.edad + 'a · ' : '') + m.paciente.pesoKg + ' kg</div>' +
            '</div>' +
          '</div>'
        : '<span class="tag-cama">' + U.esc(cama.etiqueta) + '</span>';
      var mensaje = cama.dispositivoId
        ? 'Dispositivo vinculado sin datos disponibles en este equipo'
        : (m.paciente ? 'Paciente admitido, sin dispositivo vinculado' : 'Cama sin paciente ni dispositivo vinculado');
      var textoBoton = cama.dispositivoId ? 'Reasignar' : (m.paciente ? 'Vincular dispositivo' : 'Asignar paciente');

      div.innerHTML =
        '<div class="cama-head">' + encabezado + '</div>' +
        '<div class="cama-libre-cuerpo">' +
          iconoCamaLibre() +
          '<div>' + mensaje + '</div>' +
          '<button class="btn secundario chico" data-accion="asignar">' + textoBoton + '</button>' +
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
            '<div class="cama-meta">' + (p ? U.esc(p.hc) + ' · ' + (p.edad ? p.edad + 'a · ' : '') + p.pesoKg + ' kg' : d.serie) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="cama-badges">' +
          '<span class="badge ' + (d.tipo === 'sim' ? 'sim' : 'real') + '">' + (d.tipo === 'sim' ? 'PILOTO' : 'REAL') + '</span>' +
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
          '<div class="mini' + (m.color && m.color.anomalo ? ' alerta' : '') + '"><div class="mini-rot">Color</div><div class="mini-val"><span class="muestra-color" style="background:' + (m.color ? m.color.hex : '#333') + '"></span><span class="mini-val-txt">' + (m.color ? U.esc(m.color.nombre) : '—') + '</span></div></div>' +
          '<div class="mini"><div class="mini-rot">Acumulado</div><div class="mini-val">' + U.num(m.volTotalMl, 0) + '<small>mL</small></div></div>' +
        '</div>' +
        '<div class="barra-bolsa">' +
          '<div class="rot"><span>Bolsa colectora</span><span>' + U.num(m.volBolsaMl, 0) + ' / ' + CFG.medicion.capacidadBolsaML + ' mL</span></div>' +
          '<div class="barra-pista"><div class="barra-relleno' + (m.llenado >= CFG.umbrales.bolsaCritica ? ' critico' : (m.llenado >= CFG.umbrales.bolsaAviso ? ' aviso' : '')) + '" style="width:' + Math.round(m.llenado * 100) + '%"></div></div>' +
        '</div>' +
        (alertasCama.length ? '<div class="cama-alertas">' + alertasCama.map(pastillaAlerta).join('') + '</div>' : '') +
        (m.muestrasBuffer ? '<div class="cama-buffer-nota" title="Datos reconstruidos del búfer del equipo al reconectar"><span class="badge buffer">BÚFER</span> Datos reconstruidos al reconectar</div>' : '') +
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

  var NIVEL_ORDEN = ['critica', 'alta', 'media', 'tecnica'];
  function vibrarPanelAlertas() {
    var panel = U.$('.panel-alertas');
    panel.classList.remove('vibrar');
    void panel.offsetWidth;   // fuerza reflow para poder re-disparar la animación
    panel.classList.add('vibrar');
    setTimeout(function () { panel.classList.remove('vibrar'); }, 450);
  }
  function pintarAlertas() {
    var lista = Alertas.lista();
    var activasNoRec = lista.filter(function (a) { return !a.reconocida; });
    var cont = U.$('#contAlertas');
    cont.textContent = activasNoRec.length;
    cont.classList.toggle('activo', activasNoRec.length > 0);

    var panel = U.$('.panel-alertas');
    var conteos = Alertas.contarPorNivel();
    var peor = NIVEL_ORDEN.find(function (n) { return conteos[n] > 0; });
    NIVEL_ORDEN.forEach(function (n) { panel.classList.toggle('nivel-' + n, n === peor); });

    var el = U.$('#listaAlertas');
    if (!lista.length) { el.innerHTML = '<div class="vacio">Sin alertas activas. Todo dentro de rango.</div>'; return; }
    el.innerHTML = '';
    lista.forEach(function (a) {
      var silInfo = Modelo.estado.reconocidas[a.codigo];
      var etiquetaSilencio = silInfo ? (silInfo.motivo === 'atendido' ? 'paciente atendido' : 'en espera') : '';
      var it = U.el('div', 'item-alerta ' + a.nivel + (a.reconocida ? ' reconocida' : ''));
      it.innerHTML =
        '<div class="franja"></div>' +
        '<div class="alerta-cuerpo">' +
          '<div class="alerta-titulo"><span class="cama-ref">' + U.esc(a.ref) + '</span>' + U.esc(a.titulo) + '</div>' +
          '<div class="alerta-detalle">' + U.esc(a.detalle) + '</div>' +
          '<div class="alerta-tiempo">' + U.desde(a.desde) + (a.reconocida ? ' · silenciada (' + etiquetaSilencio + ')' : '') + '</div>' +
          (a.reconocida ? '' : '<button class="btn-silenciar" data-codigo="' + U.esc(a.codigo) + '" data-titulo="' + U.esc(a.titulo) + '">Silenciar</button>') +
        '</div>';
      it.onclick = function () { abrirDetalle(a.camaId); };
      var btn = it.querySelector('.btn-silenciar');
      if (btn) {
        btn.onclick = function (ev) {
          ev.stopPropagation();
          pedirSilenciar(btn.dataset.codigo, btn.dataset.titulo);
        };
      }
      el.appendChild(it);
    });
  }

  function pintarEventos() {
    var ev = Modelo.estado.eventos.slice(-(eventosExpandido ? 300 : 40)).reverse();
    var el = U.$('#listaEventos');
    if (!ev.length) { el.innerHTML = '<div class="vacio">Sin eventos todavía.</div>'; return; }
    el.innerHTML = ev.map(function (e) {
      var cama = e.camaId ? Modelo.buscarCama(e.camaId) : null;
      var reciente = e.tipo === 'silencio' && (Date.now() - e.t) < 6000;
      return '<div class="item-evento' + (reciente ? ' silencio-reciente' : '') + '"><span class="hora">' + U.hora(e.t) + '</span><span>' +
        (cama ? '<b style="color:var(--texto)">' + U.esc(cama.etiqueta) + '</b> · ' : '') +
        (e.operador ? '<span class="ev-operador">' + U.esc(e.operador) + '</span> — ' : '') +
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

    pintarChipNube();
  }

  function pintarChipNube() {
    var chip = U.$('#chipNube');
    if (typeof Nube === 'undefined' || !Nube.configurado()) {
      chip.className = 'chip oculto';
      return;
    }
    chip.className = 'chip';
    var txt = chip.querySelector('.chip-txt');
    if (Nube.activo()) { chip.classList.add('en-linea'); txt.textContent = 'Base compartida · en línea'; }
    else { chip.classList.add('simulado'); txt.textContent = 'Base compartida · conectando…'; }
  }

  function pintarReloj() {
    U.$('#reloj').textContent = U.horaSeg(Date.now());
  }

  /* ============================== OPERADOR =============================== */

  function pintarOperador() {
    U.$('#operadorTxt').textContent = Operador.actual();
  }

  function abrirOperador() {
    var d = Operador.datos();
    U.$('#opNombre').value = d ? d.nombre : '';
    U.$('#opRol').value = d ? d.rol : 'Enfermero/a';
    var primeraVez = Operador.necesitaPreguntar();
    U.$('#opTitulo').textContent = primeraVez ? '¿Quién está operando esta computadora?' : 'Cambiar operador de esta computadora';
    U.$('#opNota').style.display = primeraVez ? '' : 'none';
    U.$('#btnInvitadoOperador').classList.toggle('oculto', !primeraVez);
    U.$('#btnCerrarOperador').classList.toggle('oculto', primeraVez);
    U.$('#modalOperador').classList.add('abierto');
    U.$('#modalOperador').setAttribute('aria-hidden', 'false');
    U.$('#opNombre').focus();
  }
  function cerrarOperador() {
    if (Operador.necesitaPreguntar()) return;   // la primera vez es obligatorio elegir un nombre
    U.$('#modalOperador').classList.remove('abierto');
    U.$('#modalOperador').setAttribute('aria-hidden', 'true');
  }
  function guardarOperador() {
    var nombre = U.$('#opNombre').value.trim();
    if (!nombre) { U.$('#opNombre').focus(); return; }
    Operador.establecer(nombre, U.$('#opRol').value);
    pintarOperador();
    U.$('#modalOperador').classList.remove('abierto');
    U.$('#modalOperador').setAttribute('aria-hidden', 'true');
    toast('Ahora estás operando como ' + nombre);
  }

  /* =============================== TODO ================================= */

  function pintarTodo() {
    pintarBarraEstado();
    pintarKpis();
    pintarMural();   // ya iguala el alto del panel lateral al final
    pintarAlertas();
    pintarEventos();
    if (camaAbierta) actualizarDetalleAbierto();
  }

  var ALTURA_EVENTOS_SIN_FILAS = 300;   // fallback: sin ninguna cama visible

  /* Agrupa las tarjetas del mural por fila visual (mismo offsetTop, ya que
     .mural usa flex-wrap) y devuelve [{top, height}, ...] ordenadas. */
  function filasDelMural() {
    var mural = U.$('#mural');
    var hijos = U.$$('.cama', mural);
    var filas = [];
    hijos.forEach(function (el) {
      var top = el.offsetTop;
      var fila = filas.filter(function (f) { return Math.abs(f.top - top) < 1; })[0];
      if (!fila) { fila = { top: top, height: 0 }; filas.push(fila); }
      fila.height = Math.max(fila.height, el.offsetHeight);
    });
    filas.sort(function (a, b) { return a.top - b.top; });
    return filas;
  }

  /* Iguala el alto de "Alertas activas" al de las dos primeras filas de
     camas (borde superior con borde superior, borde inferior de la 2.ª
     fila con borde inferior del panel), y el de "Registro de eventos" al
     de la 3.ª fila. Sin 3.ª fila, Eventos toma como referencia la fila más
     alta del mural (una tarjeta con alerta es más alta que una sin
     alertas); sin ninguna fila, un tamaño fijo razonable. */
  function igualarAlturasLateral() {
    var filas = filasDelMural();
    var mural = U.$('#mural');
    var gap = parseFloat(getComputedStyle(mural).rowGap) || 13;

    var panelAlertas = U.$('.panel-alertas');
    var alturaAlertas = null;
    if (filas.length === 1) {
      // No hay una 2.ª fila real con la que alinearse (pocas camas, o un
      // filtro/zoom que hace entrar todas en una sola fila): en vez de
      // colapsar al alto de esa única fila (muy bajo para una lista de
      // alertas), se usa el doble como referencia de "2 filas esperadas".
      alturaAlertas = filas[0].height * 2 + gap;
    } else if (filas.length >= 2) {
      alturaAlertas = filas[0].height + gap + filas[1].height;
    }
    panelAlertas.style.height = alturaAlertas !== null ? alturaAlertas + 'px' : '';

    var panelEventos = U.$('.panel-eventos');
    var alturaEventos;
    if (eventosExpandido) {
      // Expandido a mano: ignora la altura atada al mural y ocupa buena
      // parte del alto de la ventana para poder navegar el historial.
      alturaEventos = Math.round(window.innerHeight * 0.7);
    } else if (filas.length >= 3) {
      alturaEventos = filas[2].height;
    } else if (filas.length > 0) {
      alturaEventos = Math.max.apply(null, filas.map(function (f) { return f.height; }));
    } else {
      alturaEventos = ALTURA_EVENTOS_SIN_FILAS;
    }
    panelEventos.style.height = alturaEventos + 'px';
  }

  /* ============================ MODAL DETALLE ============================ */

  function abrirDetalle(camaId) {
    camaAbierta = camaId;
    tabDetalle = 'tendencias';
    U.$$('.tab-det').forEach(function (b) { b.classList.toggle('activo', b.dataset.tab === tabDetalle); });
    U.$$('.tab-panel').forEach(function (p) { p.classList.toggle('activo', p.dataset.panel === tabDetalle); });
    U.$('#modalDetalle').classList.add('abierto');
    U.$('#modalDetalle').setAttribute('aria-hidden', 'false');
    renderDetalle();
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
      ? (m.paciente.hc + ' · ' + (m.paciente.edad ? m.paciente.edad + ' años · ' : '') + m.paciente.sexo + ' · ' + m.paciente.pesoKg + ' kg · ' + (m.paciente.dx || 'sin diagnóstico cargado'))
      : (m.dispositivo ? m.dispositivo.serie + ' sin paciente vinculado' : 'Sin dispositivo asignado');

    U.$('#btnVaciarBolsa').style.display = m.dispositivo ? '' : 'none';
    U.$('#btnExportar').style.display = m.dispositivo ? '' : 'none';
    U.$('#btnTrasladar').style.display = m.paciente ? '' : 'none';

    // No pisar el campo si el usuario lo está editando ahora mismo: la
    // vista se re-renderiza sola cada pocos segundos con datos nuevos.
    if (document.activeElement !== U.$('#detSerieInventario')) {
      U.$('#detSerieInventario').value = cama.serieInventario || '';
    }

    renderResumen(m);
    if (m.dispositivo) {
      U.$('#tendenciasVacio').hidden = true;
      U.$('#tendenciasContenido').hidden = false;
      renderTendencias(m);
      renderDispositivo(m);
    } else {
      U.$('#tendenciasVacio').hidden = false;
      U.$('#tendenciasContenido').hidden = true;
      U.$('#tendenciasVacio').textContent = cama.dispositivoId
        ? 'El dispositivo vinculado no tiene datos disponibles en este equipo.'
        : (m.paciente ? 'Vinculá un dispositivo a esta cama para ver sus tendencias.' : 'Asigná un paciente y vinculá un dispositivo para ver tendencias.');
      U.$('#detDispositivo').innerHTML = '<p class="nota">Esta cama todavía no tiene un dispositivo vinculado.</p>';
    }
    // Los eventos son de la cama, no del dispositivo: se muestran siempre,
    // tenga o no dispositivo vinculado en este momento.
    renderEventosCama(cama);
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
      resVal('Color', m.color ? U.esc(m.color.nombre) : '—', m.color ? m.color.hidratacion : '', m.color ? m.color.estado : '') +
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
      pesoKg: p ? p.pesoKg : null, umbralMlH: m.umbralMlH, umbralPoliuriaMlH: m.umbralPoliuriaMlH
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

  function duracionBateria(d) {
    var horas = Modelo.horasBateriaRestante(d);
    if (horas === null) return 'estimando autonomía…';
    var prefijo = d.estado === 'en-linea' ? '' : 'incomunicado · ';
    return prefijo + '~' + U.duracion(horas * 3600000) + ' de autonomía restante';
  }

  function renderDispositivo(m) {
    var d = m.dispositivo;
    var e = d.tipo === 'sim' ? null : Conexion.estado();
    var html = '<div class="fila">' +
      resVal('N.º de serie', '<span style="font-family:var(--mono)">' + U.esc(d.serie) + '</span>', d.tipo === 'sim' ? 'dispositivo piloto (simulado)' : 'dispositivo real', '') +
      resVal('Estado del enlace', d.estado === 'en-linea' ? 'En línea' : 'Sin señal', U.desde(d.ultimoContacto || d.reloj), d.estado === 'en-linea' ? 'ok' : 'critico') +
    '</div><div class="fila">' +
      resVal('Batería', Math.round(d.bat) + ' <small>%</small>', duracionBateria(d), d.bat <= CFG.umbrales.bateriaBaja ? 'critico' : 'ok') +
      resVal('Señal (RSSI)', Math.round(d.rssi) + ' <small>dBm</small>', d.tipo === 'sim' ? 'simulado' : (e ? e.tipo : '—'), '') +
    '</div>';

    if (d.tipo === 'sim') {
      var esc = Simulador.escenarios[d.escenario];
      html += '<div class="sep"></div><div class="subtitulo">Escenario piloto</div>' +
        '<p class="nota"><b style="color:var(--texto)">' + U.esc(esc ? esc.nombre : d.escenario) + '</b> — ' + U.esc(esc ? esc.resumen : '') + '</p>' +
        '<div class="campo"><label>Cambiar escenario</label><select id="selEscenarioDet"></select></div>' +
        '<div class="acciones"><button class="btn secundario chico" id="btnAplicarEscenario">Aplicar (mantiene el historial)</button>' +
        '<button class="btn chico" id="btnReiniciarEscenario">Reiniciar con 26 h de historial nuevo</button></div>';
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
    // Se filtra el registro global por camaId (no por dispositivo: un
    // dispositivo puede irse con el paciente a otra cama, o cambiar, y la
    // cama debe conservar su propia historia igual).
    var ev = Modelo.estado.eventos.filter(function (e) { return e.camaId === cama.id; }).slice(-60).reverse();
    if (!ev.length) { U.$('#detEventos').innerHTML = '<p class="nota">Sin eventos registrados para esta cama.</p>'; return; }
    var filas = ev.map(function (e) {
      return '<tr><td style="font-family:var(--mono);white-space:nowrap">' + U.fechaHora(e.t) + '</td><td>' + U.esc(e.tipo) + '</td><td>' + U.esc(e.operador || 'Sistema') + '</td><td>' + U.esc(e.texto) + '</td></tr>';
    }).join('');
    U.$('#detEventos').innerHTML = '<table class="tabla"><thead><tr><th>Cuándo</th><th>Tipo</th><th>Operador</th><th>Detalle</th></tr></thead><tbody>' + filas + '</tbody></table>';
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
      // El dispositivo ya asignado a esta cama también tiene que poder elegirse,
      // salvo que sea uno gestionado por otra estación (no existe en este navegador).
      var actual = cama.dispositivoId ? Modelo.estado.dispositivos[cama.dispositivoId] : null;
      if (actual && !lista.some(function (x) { return x.id === actual.id; })) {
        lista = [actual].concat(lista);
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
      Modelo.asignar(camaId, null, null, Operador.actual());
      Acciones.guardar();
      cerrarAsignar(); UI.pintarTodo();
      toast('Cama liberada');
    };
    U.$('#btnGuardarAsig').onclick = function () {
      var pacId = U.$('#selPaciente').value || null;
      var nuevo = leerFormNuevoPaciente();
      if (nuevo) { var p = Modelo.altaPaciente(nuevo); pacId = p.id; }
      Modelo.asignar(camaId, pacId, dispSel, Operador.actual());
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

  /* ============================ MODAL TRASLADAR ============================ */

  function abrirTrasladar(camaId) {
    var cama = Modelo.buscarCama(camaId);
    if (!cama || !cama.pacienteId) return;
    var p = Modelo.estado.pacientes[cama.pacienteId];
    U.$('#trasTitulo').textContent = 'Trasladar a ' + (p ? p.nombre : 'paciente');
    var libres = Modelo.camasLibres();
    var el = U.$('#listaCamasLibres');
    if (!libres.length) {
      el.innerHTML = '<p class="nota">No hay camas libres para trasladar.</p>';
    } else {
      el.innerHTML = libres.map(function (c) {
        return '<div class="disp-opcion" data-cama="' + U.esc(c.id) + '">' +
          '<div><div class="serie">' + U.esc(c.etiqueta) + '</div><div class="desc">Cama libre</div></div>' +
        '</div>';
      }).join('');
      U.$$('.disp-opcion', el).forEach(function (op) {
        op.onclick = function () {
          if (Acciones.trasladarPaciente(camaId, op.dataset.cama)) {
            cerrarTrasladar();
            abrirDetalle(op.dataset.cama);
          }
        };
      });
    }
    U.$('#modalTrasladar').classList.add('abierto');
    U.$('#modalTrasladar').setAttribute('aria-hidden', 'false');
  }
  function cerrarTrasladar() {
    U.$('#modalTrasladar').classList.remove('abierto');
    U.$('#modalTrasladar').setAttribute('aria-hidden', 'true');
  }

  /* ============================ MODAL SILENCIAR =========================== */

  function pedirSilenciar(codigo, titulo) {
    if (Operador.actual() === 'Invitado') {
      toast('Para silenciar alarmas hace falta identificarse con un nombre.', 'error');
      return;
    }
    codigoSilenciar = codigo;
    U.$('#silTitulo').textContent = '"' + titulo + '"';
    U.$('#modalSilenciar').classList.add('abierto');
    U.$('#modalSilenciar').setAttribute('aria-hidden', 'false');
  }
  function cerrarSilenciar() {
    codigoSilenciar = null;
    U.$('#modalSilenciar').classList.remove('abierto');
    U.$('#modalSilenciar').setAttribute('aria-hidden', 'true');
  }
  function confirmarSilenciar(motivo) {
    if (!codigoSilenciar) return;
    Acciones.silenciarAlerta(codigoSilenciar, motivo);
    cerrarSilenciar();
  }

  /* ============================ MODAL CONFIG ============================= */

  function abrirConfig() {
    var enlace = Modelo.estado.enlace, med = Modelo.estado.medicion;
    var op = Operador.datos();
    var html =
      '<div class="subtitulo">Usuario de esta computadora</div>' +
      '<p class="nota">Los cambios que hagas (asignar pacientes, registrar vaciados, etc.) quedan guardados a tu ' +
        'nombre en el registro de eventos. Cambiá esto al empezar tu turno.</p>' +
      '<div class="fila" style="align-items:flex-end">' +
        '<div class="campo"><label>Operando ahora</label>' +
          '<input type="text" value="' + U.esc(Operador.actual()) + (op ? ' · ' + U.esc(op.rol) : '') + '" disabled></div>' +
        '<button class="btn secundario chico" id="btnCambiarOperadorCfg">Cambiar usuario</button>' +
      '</div>' +
      '<div class="sep"></div><div class="subtitulo">Base de datos compartida</div>' +
      (Nube.configurado()
        ? '<p class="nota">' + (Nube.activo()
            ? 'Conectada. Pacientes, camas y el registro de eventos se sincronizan en tiempo real con el resto de las computadoras del equipo.'
            : 'Configurada, estableciendo conexión…') + '</p>'
        : '<p class="nota">Todavía no está configurada — cada computadora guarda sus propios datos por separado. ' +
          'Para compartir pacientes y camas entre todo el equipo, completá <code>FIREBASE_CONFIG</code> en ' +
          '<code>js/nube.js</code> con los datos de un proyecto de Firebase (gratis).</p>') +
      '<div class="sep"></div><div class="subtitulo">Enlace con el dispositivo real</div>' +
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

    U.$('#btnCambiarOperadorCfg').onclick = function () { cerrarConfig(); abrirOperador(); };
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

    U.$('#cabeceraEventos').onclick = function () {
      eventosExpandido = !eventosExpandido;
      U.$('.panel-eventos').classList.toggle('expandido', eventosExpandido);
      pintarEventos();
      igualarAlturasLateral();
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
    U.$('#btnTrasladar').onclick = function () { if (camaAbierta) abrirTrasladar(camaAbierta); };
    U.$('#btnGuardarInventario').onclick = function () {
      if (!camaAbierta) return;
      Acciones.guardarSerieInventario(camaAbierta, U.$('#detSerieInventario').value.trim());
    };
    U.$('#detSerieInventario').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') U.$('#btnGuardarInventario').click();
    });
    U.$('#btnCerrarTrasladar').onclick = cerrarTrasladar;
    U.$('#modalTrasladar').addEventListener('click', function (ev) { if (ev.target.id === 'modalTrasladar') cerrarTrasladar(); });
    U.$('#btnVaciarBolsa').onclick = function () { if (camaAbierta) Acciones.vaciarBolsa(camaAbierta); };
    U.$('#btnExportar').onclick = function () { if (camaAbierta) Acciones.exportarCamaCsv(camaAbierta); };

    U.$('#btnCerrarAsignar').onclick = cerrarAsignar;
    U.$('#modalAsignar').addEventListener('click', function (ev) { if (ev.target.id === 'modalAsignar') cerrarAsignar(); });

    U.$('#btnCerrarSilenciar').onclick = cerrarSilenciar;
    U.$('#modalSilenciar').addEventListener('click', function (ev) { if (ev.target.id === 'modalSilenciar') cerrarSilenciar(); });
    U.$('#btnSilenciarAtendido').onclick = function () { confirmarSilenciar('atendido'); };
    U.$('#btnSilenciarEspera').onclick = function () { confirmarSilenciar('espera'); };

    U.$('#chipOperador').onclick = abrirOperador;
    U.$('#btnGuardarOperador').onclick = guardarOperador;
    U.$('#btnCerrarOperador').onclick = cerrarOperador;
    U.$('#btnInvitadoOperador').onclick = function () {
      Operador.establecer('Invitado', 'Otro');
      pintarOperador();
      cerrarOperador();   // ya no necesita preguntar: establecer() dejó un nombre cargado
    };
    U.$('#opNombre').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') guardarOperador(); });
    U.$('#modalOperador').addEventListener('click', function (ev) { if (ev.target.id === 'modalOperador') cerrarOperador(); });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { cerrarDetalle(); cerrarAsignar(); cerrarConfig(); cerrarOperador(); cerrarSilenciar(); cerrarTrasladar(); }
    });

    Alertas.alCambiar(function (nuevas) {
      pintarAlertas();
      if (nuevas && nuevas.length) vibrarPanelAlertas();
    });
    Conexion.alCambiar(function () { pintarBarraEstado(); });

    // Cambiar el zoom o el ancho de ventana puede cambiar cuántas camas
    // entran por fila sin que se repinte el mural por ningún otro motivo:
    // hay que volver a medir las filas y realinear el panel lateral.
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(igualarAlturasLateral, 120);
    });
  }

  return {
    bind: bind, pintarTodo: pintarTodo, pintarReloj: pintarReloj, pintarBarraEstado: pintarBarraEstado,
    abrirDetalle: abrirDetalle, abrirAsignar: abrirAsignar, abrirConfig: abrirConfig,
    pintarOperador: pintarOperador, abrirOperador: abrirOperador,
    toast: toast
  };
})();
