/* =====================================================================
   modelo.js · Estado de la central y cálculo de las métricas clínicas.

   Cadena de medida:
        celda de carga → masa (g) → volumen (mL) → volumen acumulado (mL)
                                                 → tasa de diuresis (mL/h)
                                                 → diuresis indexada (mL/kg/h)

   El volumen acumulado es MONÓTONO: si la bolsa se vacía, el salto negativo
   se descarta y se anota como evento de vaciado, de modo que las tasas nunca
   se calculan sobre un escalón artificial.
   ===================================================================== */

var Modelo = (function () {

  var E = {
    modo: 'piloto',
    mostrarPilotoEnReal: true,
    tema: 'oscuro',
    velocidad: 1,
    silenciado: false,
    camas: [],
    pacientes: {},
    dispositivos: {},
    eventos: [],
    reconocidas: {},
    enlace: null,
    medicion: null
  };

  /* ===================== Inicialización / semilla ===================== */

  function inicializar() {
    var guardado = Almacen.cargar();
    if (guardado) {
      E.modo = guardado.modo || 'piloto';
      E.mostrarPilotoEnReal = guardado.mostrarPilotoEnReal !== false;
      E.tema = guardado.tema || 'oscuro';
      E.velocidad = guardado.velocidad || 1;
      E.silenciado = !!guardado.silenciado;
      E.camas = guardado.camas || [];
      E.pacientes = guardado.pacientes || {};
      E.dispositivos = guardado.dispositivos || {};
      E.eventos = guardado.eventos || [];
      E.reconocidas = guardado.reconocidas || {};
      E.enlace = Object.assign({}, CFG.enlace, guardado.enlace || {});
      E.medicion = Object.assign({}, CFG.medicion, guardado.medicion || {});
      Object.keys(E.dispositivos).forEach(function (k) {
        var d = E.dispositivos[k];
        d.muestras = d.muestras || [];
        d.eventos = d.eventos || [];
        d.reloj = d.muestras.length ? d.muestras[d.muestras.length - 1].t : Date.now();
      });
      return false; // no es la primera vez
    }
    E.enlace = Object.assign({}, CFG.enlace);
    E.medicion = Object.assign({}, CFG.medicion);
    sembrar();
    return true;
  }

  /* Sala de ejemplo: 6 camas ocupadas con escenarios distintos + 2 libres. */
  function sembrar() {
    var siembra = [
      { cama:'A1', nombre:'Ramírez, Elena',   hc:'HC-40218', edad:68, sexo:'F', pesoKg:62, escenario:'oliguria_lra',  dx:'Shock séptico de foco abdominal' },
      { cama:'A2', nombre:'Sosa, Martín',     hc:'HC-40233', edad:54, sexo:'M', pesoKg:88, escenario:'normal',        dx:'Post-operatorio de cirugía cardíaca' },
      { cama:'A3', nombre:'Quiroga, Beatriz', hc:'HC-40190', edad:77, sexo:'F', pesoKg:55, escenario:'sepsis',        dx:'Neumonía grave de la comunidad' },
      { cama:'A4', nombre:'Ledesma, Hugo',    hc:'HC-40251', edad:41, sexo:'M', pesoKg:79, escenario:'poliuria',      dx:'TEC grave · sospecha de diabetes insípida' },
      { cama:'A6', nombre:'Pereyra, Nadia',   hc:'HC-40260', edad:33, sexo:'F', pesoKg:61, escenario:'hematuria',     dx:'Post-RTU vesical' },
      { cama:'A7', nombre:'Ibarra, Carlos',   hc:'HC-40204', edad:62, sexo:'M', pesoKg:95, escenario:'obstruccion',   dx:'Pancreatitis aguda grave' },
      { cama:'A5', nombre:'Vega, Rosa',       hc:'HC-40277', edad:70, sexo:'F', pesoKg:66, escenario:'enlace_intermitente', dx:'Post-operatorio de cadera' }
    ];

    E.camas = CFG.camasIniciales.map(function (c) {
      return { id: c.id, etiqueta: c.etiqueta, pacienteId: null, dispositivoId: null };
    });

    siembra.forEach(function (s, i) {
      var p = {
        id: U.id('pac'), nombre: s.nombre, hc: s.hc, edad: s.edad, sexo: s.sexo,
        pesoKg: s.pesoKg, dx: s.dx, ingreso: Date.now() - (8 + i) * 3600000,
        objetivoMlKgH: 0.5, notas: ''
      };
      E.pacientes[p.id] = p;

      var d = crearDispositivo({ tipo: 'sim', escenario: s.escenario });
      var cama = buscarCama(s.cama);
      cama.pacienteId = p.id;
      cama.dispositivoId = d.id;

      // Batería inicial distinta por equipo, para que la sala de ejemplo no
      // muestre los ocho dispositivos con el mismo nivel de carga.
      d.bat = Math.round(35 + Math.random() * 65);

      // Se rellenan 26 h de historial para que la central "ya venga andando"
      // y para que las tres ventanas de tendencias (6/12/24 h) muestren datos distintos.
      Simulador.precargar(d, p, 26);
    });

    registrarEvento(null, 'sistema', 'Central iniciada · sala de ejemplo cargada');
  }

  /* ========================== Altas y bajas ========================== */

  var contadorSerie = 1;
  function crearDispositivo(op) {
    op = op || {};
    var serie = op.serie || ('URO-' + String(1000 + (contadorSerie++)).slice(-4));
    while (buscarPorSerie(serie) && !op.serie) serie = 'URO-' + String(1000 + (contadorSerie++)).slice(-4);
    var d = {
      id: U.id('dsp'),
      serie: serie,
      tipo: op.tipo || 'real',          // 'sim' | 'real'
      escenario: op.escenario || 'normal',
      inicioEscenario: Date.now(),
      estado: op.tipo === 'sim' ? 'en-linea' : 'sin-senal',
      bat: 100, rssi: -55,
      volTotalMl: 0,                    // acumulado monótono desde el alta
      tara: E.medicion.taraBolsaG,
      ultimoDato: null,
      vaciados: 0,
      reloj: Date.now(),
      muestras: [],
      eventos: []
    };
    E.dispositivos[d.id] = d;
    if (typeof Nube !== 'undefined' && Nube.activo()) Nube.guardarDispositivoMeta(d);
    return d;
  }

  function buscarPorSerie(serie) {
    var k, ks = Object.keys(E.dispositivos);
    for (k = 0; k < ks.length; k++) if (E.dispositivos[ks[k]].serie === serie) return E.dispositivos[ks[k]];
    return null;
  }
  function buscarCama(id) {
    for (var i = 0; i < E.camas.length; i++) if (E.camas[i].id === id) return E.camas[i];
    return null;
  }
  function camaDeDispositivo(dispId) {
    for (var i = 0; i < E.camas.length; i++) if (E.camas[i].dispositivoId === dispId) return E.camas[i];
    return null;
  }
  function dispositivosLibres() {
    var usados = {};
    E.camas.forEach(function (c) { if (c.dispositivoId) usados[c.dispositivoId] = 1; });
    return Object.keys(E.dispositivos).map(function (k) { return E.dispositivos[k]; })
      .filter(function (d) { return !usados[d.id]; });
  }
  function camasLibres() {
    return E.camas.filter(function (c) { return !c.pacienteId && !c.dispositivoId; });
  }

  function eliminarCama(id) {
    E.camas = E.camas.filter(function (c) { return c.id !== id; });
  }

  function asignar(camaId, pacienteId, dispositivoId, operador) {
    var cama = buscarCama(camaId);
    if (!cama) return;
    // Un dispositivo no puede estar en dos camas a la vez.
    if (dispositivoId) {
      E.camas.forEach(function (c) {
        if (c.id !== camaId && c.dispositivoId === dispositivoId) {
          c.dispositivoId = null;
          registrarEvento(c.id, 'asignacion', 'Dispositivo retirado de ' + c.etiqueta, null, operador);
          sincronizarCama(c);
        }
      });
    }
    cama.pacienteId = pacienteId || null;
    cama.dispositivoId = dispositivoId || null;
    var p = pacienteId ? E.pacientes[pacienteId] : null;
    var d = dispositivoId ? E.dispositivos[dispositivoId] : null;
    registrarEvento(camaId, 'asignacion',
      p ? ('Vinculado ' + p.nombre + (d ? ' ↔ ' + d.serie : '')) : 'Cama liberada', null, operador);
    sincronizarCama(cama);
  }

  /* Mueve al paciente (con su dispositivo, historial y registros) de una
     cama a otra que esté libre. La cama de origen queda disponible. */
  function trasladarPaciente(origenId, destinoId, operador) {
    var origen = buscarCama(origenId), destino = buscarCama(destinoId);
    if (!origen || !destino) return false;
    if (!origen.pacienteId) return false;
    if (destino.pacienteId || destino.dispositivoId) return false;

    var pacienteId = origen.pacienteId, dispositivoId = origen.dispositivoId;
    var p = pacienteId ? E.pacientes[pacienteId] : null;

    origen.pacienteId = null; origen.dispositivoId = null;
    destino.pacienteId = pacienteId; destino.dispositivoId = dispositivoId;

    var nombre = p ? p.nombre : 'Paciente';
    registrarEvento(origenId, 'traslado', nombre + ' trasladado/a a ' + destino.etiqueta, null, operador);
    registrarEvento(destinoId, 'traslado', nombre + ' trasladado/a desde ' + origen.etiqueta, dispositivoId, operador);
    sincronizarCama(origen);
    sincronizarCama(destino);
    return true;
  }

  function altaPaciente(datos) {
    var p = Object.assign({
      id: U.id('pac'), nombre: '', hc: '', edad: null, sexo: '-', pesoKg: 70,
      dx: '', ingreso: Date.now(), objetivoMlKgH: 0.5, notas: ''
    }, datos);
    E.pacientes[p.id] = p;
    if (typeof Nube !== 'undefined' && Nube.activo()) Nube.guardarPaciente(p);
    return p;
  }

  /* --- espejo hacia la base compartida (no-op si Nube no está activa) --- */
  function sincronizarCama(cama) {
    if (typeof Nube !== 'undefined' && Nube.activo()) Nube.guardarCama(cama);
  }

  /* Al dar de alta / cambiar de paciente se reinicia el acumulado del equipo. */
  function reiniciarDispositivo(dispId) {
    var d = E.dispositivos[dispId];
    if (!d) return;
    d.volTotalMl = 0; d.vaciados = 0; d.muestras = []; d.eventos = [];
    d.inicioEscenario = Date.now(); d.reloj = Date.now();
  }

  /* ======================= Ingreso de muestras ======================= */

  /* lectura: { t, pesoG, tempC, rgb:[r,g,b], bat, rssi, origen } */
  function ingresarMuestra(dispId, lectura) {
    var d = E.dispositivos[dispId];
    if (!d) return null;

    var tara = (d.tara !== undefined && d.tara !== null) ? d.tara : E.medicion.taraBolsaG;
    var volMl = Math.max(0, (lectura.pesoG - tara) / E.medicion.densidadOrina);
    var prev = d.muestras.length ? d.muestras[d.muestras.length - 1] : null;

    if (prev) {
      var delta = volMl - prev.volMl;
      if (delta < -40) {
        // Caída brusca de peso: se vació la bolsa o se cambió el colector.
        d.vaciados++;
        registrarEvento(camaId(d), 'vaciado',
          'Vaciado de bolsa detectado (' + U.num(prev.volMl, 0) + ' mL)', d.id);
        delta = 0;
      }
      d.volTotalMl += Math.max(0, delta);
    }

    var m = {
      t: lectura.t || Date.now(),
      pesoG: lectura.pesoG,
      volMl: volMl,
      volTotalMl: d.volTotalMl,
      tempC: lectura.tempC,
      rgb: lectura.rgb || [240, 224, 90],
      bat: lectura.bat === undefined ? d.bat : lectura.bat,
      rssi: lectura.rssi === undefined ? d.rssi : lectura.rssi,
      origen: lectura.origen || 'enlace'
    };

    d.muestras.push(m);
    // Las muestras del búfer pueden llegar desordenadas: se reordena por tiempo.
    if (prev && m.t < prev.t) d.muestras.sort(function (a, b) { return a.t - b.t; });

    d.ultimoDato = Math.max(d.ultimoDato || 0, m.t);
    d.ultimoContacto = Date.now();   // reloj de pared: mide el silencio del enlace
    d.reloj = Math.max(d.reloj || 0, m.t);
    d.bat = m.bat; d.rssi = m.rssi;
    if (d.estado !== 'en-linea' && lectura.origen !== 'buffer') d.estado = 'en-linea';

    podar(d);
    return m;
  }

  function podar(d) {
    var limite = (d.reloj || Date.now()) - E.medicion.horasHistorial * 3600000;
    var i = 0;
    while (i < d.muestras.length && d.muestras[i].t < limite) i++;
    if (i > 0) d.muestras = d.muestras.slice(i);
  }

  function camaId(d) { var c = camaDeDispositivo(d.id); return c ? c.id : null; }

  /* ============================ Eventos ============================= */

  function registrarEvento(camaId, tipo, texto, dispId, operador) {
    var ev = { id: U.id('ev'), t: Date.now(), camaId: camaId, tipo: tipo, texto: texto, operador: operador || null };
    E.eventos.push(ev);
    if (E.eventos.length > 400) E.eventos = E.eventos.slice(-300);
    if (dispId && E.dispositivos[dispId]) {
      E.dispositivos[dispId].eventos.push(ev);
      if (E.dispositivos[dispId].eventos.length > 200) {
        E.dispositivos[dispId].eventos = E.dispositivos[dispId].eventos.slice(-120);
      }
    }
    if (typeof Nube !== 'undefined' && Nube.activo()) Nube.agregarEvento(ev);
    return ev;
  }

  /* ==================== Fusión de cambios remotos ==================== */
  /* Llamado desde Nube cuando otra computadora modifica pacientes, camas
     o agrega un evento. Nunca toca muestras/dispositivos en vivo: eso
     sigue siendo local a cada navegador. */

  function aplicarPacienteRemoto(p) {
    E.pacientes[p.id] = p;
  }

  function aplicarCamaRemota(data) {
    var cama = buscarCama(data.id);
    if (!cama) {
      cama = { id: data.id, etiqueta: data.etiqueta || data.id, pacienteId: null, dispositivoId: null };
      E.camas.push(cama);
    }
    if (data.etiqueta) cama.etiqueta = data.etiqueta;
    cama.pacienteId = data.pacienteId || null;
    cama.dispositivoId = data.dispositivoId || null;
    cama.serieInventario = data.serieInventario || null;
  }

  function aplicarEventoRemoto(ev) {
    if (E.eventos.some(function (e) { return e.id === ev.id; })) return;
    E.eventos.push(ev);
    E.eventos.sort(function (a, b) { return a.t - b.t; });
    if (E.eventos.length > 400) E.eventos = E.eventos.slice(-300);
  }

  /* ====================== Cálculos sobre la serie ==================== */

  /* Horas de batería restante, estimadas por la tasa de descarga real de
     las últimas horas (no un supuesto fijo): compara la batería de ahora
     contra la de hace hasta 4 h. Sirve sobre todo cuando el equipo está
     incomunicado (no se sabe cuándo va a poder cargarse). Null si no hay
     suficiente historial o si la batería no está cayendo (recién cambiada,
     o el equipo está enchufado). */
  function horasBateriaRestante(d) {
    var ms = d.muestras;
    if (ms.length < 2) return null;
    var fin = ms[ms.length - 1];
    var ini = fin, ventanaMs = 4 * 3600000;
    for (var i = ms.length - 1; i >= 0; i--) {
      if (fin.t - ms[i].t > ventanaMs) break;
      ini = ms[i];
    }
    var horas = (fin.t - ini.t) / 3600000;
    if (horas <= 0) return null;
    var caida = ini.bat - fin.bat;
    if (caida <= 0) return null;
    return fin.bat / (caida / horas);
  }

  /* Volumen acumulado interpolado en un instante t. */
  function volumenEn(muestras, t) {
    if (!muestras.length) return null;
    if (t <= muestras[0].t) return muestras[0].volTotalMl;
    if (t >= muestras[muestras.length - 1].t) return muestras[muestras.length - 1].volTotalMl;
    var lo = 0, hi = muestras.length - 1, mid;
    while (hi - lo > 1) {
      mid = (lo + hi) >> 1;
      if (muestras[mid].t <= t) lo = mid; else hi = mid;
    }
    var a = muestras[lo], b = muestras[hi];
    var f = (t - a.t) / Math.max(1, b.t - a.t);
    return a.volTotalMl + (b.volTotalMl - a.volTotalMl) * f;
  }

  /* Tasa media de diuresis en los últimos `minutos`, en mL/h.
     Devuelve null si no hay ventana suficiente para que el número signifique algo. */
  function tasaMlH(d, minutos) {
    var ms = d.muestras;
    if (ms.length < 2) return null;
    var fin = ms[ms.length - 1].t;
    var ini = fin - minutos * 60000;
    var spanDisponible = (fin - ms[0].t) / 60000;
    if (spanDisponible < E.medicion.ventanaMinimaMin) return null;
    if (ini < ms[0].t) ini = ms[0].t;
    var horas = (fin - ini) / 3600000;
    if (horas <= 0) return null;
    var dv = ms[ms.length - 1].volTotalMl - volumenEn(ms, ini);
    return Math.max(0, dv) / horas;
  }

  /* Serie de diuresis por hora de reloj (para el gráfico de barras). */
  function bucketsHorarios(d, horas) {
    var ms = d.muestras;
    var out = [];
    if (ms.length < 2) return out;
    var fin = ms[ms.length - 1].t;
    var finHora = Math.ceil(fin / 3600000) * 3600000;
    for (var h = horas - 1; h >= 0; h--) {
      var t1 = finHora - h * 3600000;
      var t0 = t1 - 3600000;
      if (t1 < ms[0].t) continue;
      var a = volumenEn(ms, Math.max(t0, ms[0].t));
      var b = volumenEn(ms, Math.min(t1, fin));
      var fraccion = (Math.min(t1, fin) - Math.max(t0, ms[0].t)) / 3600000;
      if (fraccion <= 0.08) continue;                 // hora demasiado incompleta
      out.push({
        t0: t0, t1: t1,
        ml: Math.max(0, b - a),
        mlH: Math.max(0, b - a) / fraccion,           // normalizado a hora completa
        parcial: fraccion < 0.95
      });
    }
    return out;
  }

  /* Horas consecutivas (contando desde ahora hacia atrás) por debajo de un umbral. */
  function horasBajoUmbral(buckets, pesoKg, umbralMlKgH) {
    var n = 0;
    for (var i = buckets.length - 1; i >= 0; i--) {
      if (buckets[i].parcial && i === buckets.length - 1) continue;   // la hora en curso no cuenta
      if (buckets[i].mlH / pesoKg < umbralMlKgH) n++; else break;
    }
    return n;
  }

  /* Tiempo sin flujo apreciable (posible sonda acodada u obstruida). */
  function minutosSinFlujo(d) {
    var ms = d.muestras;
    if (ms.length < 2) return 0;
    var fin = ms[ms.length - 1];
    for (var i = ms.length - 2; i >= 0; i--) {
      if (fin.volTotalMl - ms[i].volTotalMl > 1.5) {
        return (fin.t - ms[i + 1].t) / 60000;
      }
    }
    return (fin.t - ms[0].t) / 60000;
  }

  /* ========================= Métricas de cama ======================== */

  function metricas(cama) {
    var d = cama.dispositivoId ? E.dispositivos[cama.dispositivoId] : null;
    var p = cama.pacienteId ? E.pacientes[cama.pacienteId] : null;
    if (!d) return { vacio: true, paciente: p, dispositivo: null };

    var ms = d.muestras;
    var ultima = ms.length ? ms[ms.length - 1] : null;
    var ahora = d.reloj || Date.now();
    var pesoKg = p ? p.pesoKg : null;

    var mlH1 = tasaMlH(d, E.medicion.ventanaDiuresisMin);
    var mlHInst = tasaMlH(d, E.medicion.ventanaInstantMin);
    var mlH6 = tasaMlH(d, 360);
    var mlH24 = tasaMlH(d, 1440);
    var buckets = bucketsHorarios(d, 24);

    var m = {
      vacio: false,
      cama: cama,
      paciente: p,
      dispositivo: d,
      ultima: ultima,
      ahora: ahora,
      sinSenalSeg: d.ultimoContacto ? (Date.now() - d.ultimoContacto) / 1000 : Infinity,

      volBolsaMl: ultima ? ultima.volMl : null,
      volTotalMl: d.volTotalMl,
      llenado: ultima ? U.clamp(ultima.volMl / E.medicion.capacidadBolsaML, 0, 1) : 0,

      mlH: mlH1, mlHInst: mlHInst, mlH6: mlH6, mlH24: mlH24,
      mlKgH: (mlH1 !== null && pesoKg) ? mlH1 / pesoKg : null,
      mlKgH6: (mlH6 !== null && pesoKg) ? mlH6 / pesoKg : null,
      mlKgH24: (mlH24 !== null && pesoKg) ? mlH24 / pesoKg : null,
      umbralMlH: pesoKg ? CFG.umbrales.oliguria * pesoKg : null,
      umbralPoliuriaMlH: pesoKg ? CFG.umbrales.poliuria * pesoKg : null,

      buckets: buckets,
      tempC: ultima ? ultima.tempC : null,
      tempMax6h: null,
      color: ultima ? U.clasificarColor(ultima.rgb) : null,
      bat: d.bat, rssi: d.rssi,
      minSinFlujo: minutosSinFlujo(d),
      horasOliguria: (pesoKg && buckets.length) ? horasBajoUmbral(buckets, pesoKg, CFG.umbrales.oliguria) : 0,
      horasOliguriaGrave: (pesoKg && buckets.length) ? horasBajoUmbral(buckets, pesoKg, CFG.umbrales.oliguriaGrave) : 0,
      horasAnuria: (pesoKg && buckets.length) ? horasBajoUmbral(buckets, pesoKg, CFG.umbrales.anuria) : 0,
      muestrasBuffer: 0
    };

    // Temperatura máxima y muestras reconstruidas en las últimas 6 h
    var t6 = ahora - 6 * 3600000, i;
    for (i = ms.length - 1; i >= 0 && ms[i].t >= t6; i--) {
      if (m.tempMax6h === null || ms[i].tempC > m.tempMax6h) m.tempMax6h = ms[i].tempC;
      if (ms[i].origen === 'buffer') m.muestrasBuffer++;
    }

    m.kdigo = estadioKdigo(m);
    return m;
  }

  /* Estadio KDIGO de lesión renal aguda según el criterio de diuresis. */
  function estadioKdigo(m) {
    if (!m.paciente || !m.buckets.length) return 0;
    if (m.horasAnuria >= CFG.umbrales.horasAnuria) return 3;
    if (m.horasOliguriaGrave >= CFG.umbrales.horasKdigo3) return 3;
    if (m.horasOliguria >= CFG.umbrales.horasKdigo2) return 2;
    if (m.horasOliguria >= CFG.umbrales.horasKdigo1) return 1;
    return 0;
  }

  /* Camas visibles según el modo de operación. */
  function camasVisibles() {
    return E.camas.filter(function (c) {
      if (!c.dispositivoId) return true;
      var d = E.dispositivos[c.dispositivoId];
      if (!d) return true;
      if (E.modo === 'piloto') return true;
      return d.tipo === 'real' || E.mostrarPilotoEnReal;
    });
  }

  return {
    estado: E,
    inicializar: inicializar,
    crearDispositivo: crearDispositivo,
    buscarPorSerie: buscarPorSerie,
    buscarCama: buscarCama,
    camaDeDispositivo: camaDeDispositivo,
    dispositivosLibres: dispositivosLibres,
    camasLibres: camasLibres,
    eliminarCama: eliminarCama,
    asignar: asignar,
    trasladarPaciente: trasladarPaciente,
    altaPaciente: altaPaciente,
    reiniciarDispositivo: reiniciarDispositivo,
    ingresarMuestra: ingresarMuestra,
    registrarEvento: registrarEvento,
    metricas: metricas,
    bucketsHorarios: bucketsHorarios,
    volumenEn: volumenEn,
    tasaMlH: tasaMlH,
    horasBateriaRestante: horasBateriaRestante,
    camasVisibles: camasVisibles,
    aplicarPacienteRemoto: aplicarPacienteRemoto,
    aplicarCamaRemota: aplicarCamaRemota,
    aplicarEventoRemoto: aplicarEventoRemoto
  };
})();
