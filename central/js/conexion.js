/* =====================================================================
   conexion.js · Enlace con el instrumento real (ESP32).

   Cuatro transportes, todos hablando el mismo JSON:

     WebSocket  ws://<ip>:81        · el ESP32 empuja cada muestra (recomendado)
     HTTP       GET http://<ip>/datos · la central consulta cada N segundos
     Bluetooth  BLE + notificaciones  (Web Bluetooth, Chrome/Edge)
     Serie      USB a 115200 baudios  (Web Serial, Chrome/Edge)

   Trama de una muestra:
     {"serie":"URO-0001","t":1727450000,"peso":412.5,"temp":36.8,
      "rgb":[210,180,60],"bat":87,"rssi":-62}

   Trama de recuperación tras un corte (el ESP32 guarda en su memoria y
   reenvía todo junto al reconectar):
     {"serie":"URO-0001","lote":[{...},{...},...]}

   Resiliencia: reconexión con espera exponencial, muestras marcadas como
   "reconstruidas" y persistencia inmediata de todo lo que llega.
   ===================================================================== */

var Conexion = (function () {

  var st = {
    activo: false,
    tipo: null,
    estado: 'desconectado',     // desconectado | conectando | conectado | error
    detalle: '',
    intentos: 0,
    recibidas: 0,
    recuperadas: 0,
    ultimoMensaje: null,
    serieVista: null
  };

  var ws = null, timerHttp = null, timerReintento = null;
  var bleServidor = null, bleCarac = null;
  var puertoSerie = null, lectorSerie = null, cerrandoSerie = false;
  var parcial = '';
  var oyentes = [];

  function avisar() { oyentes.forEach(function (f) { f(estado()); }); }
  function alCambiar(f) { oyentes.push(f); }
  function estado() { return Object.assign({}, st); }

  function log(texto, tipo) {
    Modelo.registrarEvento(null, tipo || 'enlace', texto);
  }

  /* ===================== Normalización de la trama ==================== */

  function normalizar(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var peso = primero(obj, ['peso', 'peso_g', 'pesoG', 'masa', 'w']);
    var vol  = primero(obj, ['vol', 'volumen', 'vol_ml', 'volMl']);
    if (peso === null && vol === null) return null;

    var rgb = obj.rgb;
    if (!rgb && (obj.r !== undefined)) rgb = [obj.r, obj.g, obj.b];
    if (!rgb && obj.color && obj.color.length === 3) rgb = obj.color;
    if (!rgb) rgb = [240, 224, 90];

    var t = primero(obj, ['t', 'ts', 'tiempo', 'time']);
    if (t === null) t = Date.now();
    else if (t < 1e12) t = t * 1000;             // llegó en segundos
    // Un ESP32 sin RTC manda milisegundos desde el arranque: se reancla al reloj de la PC.
    if (t < 1e12) t = Date.now();

    var med = Modelo.estado.medicion;
    if (peso === null) peso = med.taraBolsaG + vol * med.densidadOrina;

    return {
      serie: obj.serie || obj.id || obj.dev || st.serieVista || 'URO-REAL',
      t: t,
      pesoG: Number(peso),
      tempC: Number(primero(obj, ['temp', 'temp_c', 'tempC', 'temperatura']) || 36.8),
      rgb: rgb.map(Number),
      bat: Number(primero(obj, ['bat', 'bateria', 'battery']) === null ? 100 : primero(obj, ['bat', 'bateria', 'battery'])),
      rssi: Number(primero(obj, ['rssi', 'senal']) === null ? -60 : primero(obj, ['rssi', 'senal'])),
      origen: 'enlace'
    };
  }
  function primero(o, claves) {
    for (var i = 0; i < claves.length; i++) {
      if (o[claves[i]] !== undefined && o[claves[i]] !== null) return o[claves[i]];
    }
    return null;
  }

  /* Busca el dispositivo por número de serie; si es nuevo, lo da de alta. */
  function dispositivoDe(serie) {
    var d = Modelo.buscarPorSerie(serie);
    if (!d) {
      d = Modelo.crearDispositivo({ tipo: 'real', serie: serie });
      log('Nuevo dispositivo detectado: ' + serie, 'alta');
      // Si hay una cama libre, se sugiere sola (queda pendiente de vincular paciente).
      var libre = Modelo.estado.camas.filter(function (c) { return !c.dispositivoId; })[0];
      if (libre) {
        libre.dispositivoId = d.id;
        log('Asignado ' + serie + ' a ' + libre.etiqueta + ' (falta vincular paciente)', 'asignacion');
      }
    }
    if (d.tipo !== 'real') d.tipo = 'real';
    return d;
  }

  /* Punto de entrada único: todo lo que llega por cualquier transporte. */
  function recibir(texto) {
    var obj;
    try { obj = JSON.parse(texto); } catch (e) { return; }

    var lote = obj.lote || obj.buffer || obj.muestras;
    if (Array.isArray(lote)) {
      var n = 0;
      lote.forEach(function (o) {
        if (!o.serie && obj.serie) o.serie = obj.serie;
        var l = normalizar(o);
        if (!l) return;
        l.origen = 'buffer';
        var d = dispositivoDe(l.serie);
        Modelo.ingresarMuestra(d.id, l);
        n++;
      });
      st.recuperadas += n;
      if (n) log(n + ' muestras recuperadas del búfer del equipo', 'enlace');
      st.ultimoMensaje = Date.now();
      avisar();
      return;
    }

    var lectura = normalizar(obj);
    if (!lectura) return;
    var disp = dispositivoDe(lectura.serie);
    st.serieVista = lectura.serie;
    st.recibidas++;
    st.ultimoMensaje = Date.now();
    disp.estado = 'en-linea';
    Modelo.ingresarMuestra(disp.id, lectura);
  }

  /* Reensambla líneas: BLE y serie parten el JSON en trozos. */
  function recibirTrozo(texto) {
    parcial += texto;
    var partes = parcial.split(/[\r\n]+/);
    parcial = partes.pop();
    partes.forEach(function (p) { if (p.trim()) recibir(p.trim()); });
    if (parcial.length > 4000) parcial = '';       // basura: se descarta
  }

  /* ======================= Reconexión automática ===================== */

  function programarReintento() {
    if (!st.activo) return;
    clearTimeout(timerReintento);
    var cfg = Modelo.estado.enlace;
    var espera = Math.min(cfg.reintentoMaxMs, cfg.reintentoBaseMs * Math.pow(1.7, st.intentos));
    st.intentos++;
    st.detalle = 'Reintentando en ' + Math.round(espera / 1000) + ' s (intento ' + st.intentos + ')';
    avisar();
    timerReintento = setTimeout(function () { abrir(st.tipo); }, espera);
  }

  /* ============================ Transportes ========================== */

  function abrirWebSocket() {
    var url = Modelo.estado.enlace.urlWebSocket;
    st.estado = 'conectando'; st.detalle = url; avisar();
    try { ws = new WebSocket(url); } catch (e) { st.estado = 'error'; st.detalle = e.message; programarReintento(); return; }

    ws.onopen = function () {
      st.estado = 'conectado'; st.intentos = 0; st.detalle = url;
      log('Enlace WebSocket establecido con ' + url);
      // Se le pide al equipo lo que haya guardado mientras no había central.
      try { ws.send(JSON.stringify({ cmd: 'buffer' })); } catch (e) { }
      avisar();
    };
    ws.onmessage = function (ev) { recibirTrozo(String(ev.data) + '\n'); };
    ws.onerror = function () { st.estado = 'error'; st.detalle = 'Error de WebSocket'; avisar(); };
    ws.onclose = function () {
      if (!st.activo) { st.estado = 'desconectado'; avisar(); return; }
      st.estado = 'error'; st.detalle = 'Conexión cerrada';
      marcarSinSenal();
      programarReintento();
    };
  }

  function abrirHttp() {
    var cfg = Modelo.estado.enlace;
    st.estado = 'conectando'; st.detalle = cfg.urlHttp; avisar();

    function sondear() {
      fetch(cfg.urlHttp, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (txt) {
          if (st.estado !== 'conectado') {
            st.estado = 'conectado'; st.intentos = 0;
            log('Enlace HTTP establecido con ' + cfg.urlHttp);
          }
          st.detalle = cfg.urlHttp;
          recibirTrozo(txt + '\n');
          avisar();
        })
        .catch(function (e) {
          st.estado = 'error'; st.detalle = e.message;
          marcarSinSenal(); avisar();
        });
    }
    clearInterval(timerHttp);
    timerHttp = setInterval(sondear, cfg.periodoHttpMs);
    sondear();
  }

  function abrirBluetooth() {
    if (!navigator.bluetooth) {
      st.estado = 'error';
      st.detalle = 'Este navegador no expone Web Bluetooth. Usá Chrome/Edge y abrí la central desde http://localhost.';
      avisar(); return;
    }
    var cfg = Modelo.estado.enlace;
    st.estado = 'conectando'; st.detalle = 'Elegí el equipo en el diálogo del navegador'; avisar();

    navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: cfg.bleNombrePrefijo }],
      optionalServices: [cfg.bleServicio]
    })
      .then(function (dev) {
        dev.addEventListener('gattserverdisconnected', function () {
          if (!st.activo) return;
          st.estado = 'error'; st.detalle = 'BLE desconectado';
          marcarSinSenal(); programarReintento();
        });
        return dev.gatt.connect();
      })
      .then(function (srv) { bleServidor = srv; return srv.getPrimaryService(cfg.bleServicio); })
      .then(function (svc) { return svc.getCharacteristic(cfg.bleCaracteristica); })
      .then(function (car) {
        bleCarac = car;
        car.addEventListener('characteristicvaluechanged', function (ev) {
          recibirTrozo(new TextDecoder().decode(ev.target.value));
        });
        return car.startNotifications();
      })
      .then(function () {
        st.estado = 'conectado'; st.intentos = 0; st.detalle = 'BLE · notificaciones activas';
        log('Enlace Bluetooth establecido'); avisar();
      })
      .catch(function (e) {
        st.estado = 'error'; st.detalle = e.message || 'No se pudo emparejar'; avisar();
      });
  }

  function abrirSerie() {
    if (!navigator.serial) {
      st.estado = 'error';
      st.detalle = 'Este navegador no expone Web Serial. Usá Chrome/Edge desde http://localhost.';
      avisar(); return;
    }
    st.estado = 'conectando'; st.detalle = 'Elegí el puerto del ESP32'; avisar();
    cerrandoSerie = false;

    navigator.serial.requestPort()
      .then(function (p) { puertoSerie = p; return p.open({ baudRate: 115200 }); })
      .then(function () {
        st.estado = 'conectado'; st.intentos = 0; st.detalle = 'USB · 115200 baudios';
        log('Enlace serie establecido'); avisar();
        var dec = new TextDecoderStream();
        puertoSerie.readable.pipeTo(dec.writable).catch(function () { });
        lectorSerie = dec.readable.getReader();
        (function leer() {
          lectorSerie.read().then(function (r) {
            if (r.done || cerrandoSerie) return;
            recibirTrozo(r.value);
            leer();
          }).catch(function () {
            if (!st.activo) return;
            st.estado = 'error'; st.detalle = 'Lectura serie interrumpida';
            marcarSinSenal(); avisar();
          });
        })();
      })
      .catch(function (e) {
        st.estado = 'error'; st.detalle = e.message || 'No se pudo abrir el puerto'; avisar();
      });
  }

  /* Marca como "sin señal" a los equipos reales: la pantalla sigue mostrando
     el último dato válido, que es lo que la enfermera necesita ver. */
  function marcarSinSenal() {
    Object.keys(Modelo.estado.dispositivos).forEach(function (k) {
      var d = Modelo.estado.dispositivos[k];
      if (d.tipo === 'real') d.estado = 'sin-senal';
    });
  }

  /* ============================== API =============================== */

  function abrir(tipo) {
    cerrarTransporte();
    st.tipo = tipo || Modelo.estado.enlace.tipo;
    st.activo = true;
    parcial = '';
    if (st.tipo === 'websocket') abrirWebSocket();
    else if (st.tipo === 'http') abrirHttp();
    else if (st.tipo === 'bluetooth') abrirBluetooth();
    else if (st.tipo === 'serie') abrirSerie();
    else { st.estado = 'desconectado'; st.detalle = 'Carga manual'; avisar(); }
  }

  function cerrarTransporte() {
    clearTimeout(timerReintento);
    clearInterval(timerHttp);
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { } ws = null; }
    if (bleServidor) { try { bleServidor.disconnect(); } catch (e) { } bleServidor = null; bleCarac = null; }
    if (lectorSerie) { cerrandoSerie = true; try { lectorSerie.cancel(); } catch (e) { } lectorSerie = null; }
    if (puertoSerie) { try { puertoSerie.close(); } catch (e) { } puertoSerie = null; }
  }

  function desconectar() {
    st.activo = false;
    cerrarTransporte();
    st.estado = 'desconectado'; st.detalle = ''; st.intentos = 0;
    marcarSinSenal();
    log('Enlace cerrado por el operador');
    avisar();
  }

  /* Plan B durante la defensa: si el equipo falla, se carga a mano. */
  function cargaManual(dispId, datos) {
    var med = Modelo.estado.medicion;
    var pesoG = datos.pesoG !== undefined
      ? datos.pesoG
      : med.taraBolsaG + datos.volMl * med.densidadOrina;
    var m = Modelo.ingresarMuestra(dispId, {
      t: Date.now(), pesoG: pesoG, tempC: datos.tempC,
      rgb: datos.rgb, bat: datos.bat === undefined ? 100 : datos.bat,
      rssi: -50, origen: 'manual'
    });
    var d = Modelo.estado.dispositivos[dispId];
    if (d) d.estado = 'en-linea';
    var c = Modelo.camaDeDispositivo(dispId);
    Modelo.registrarEvento(c ? c.id : null, 'manual', 'Medición cargada a mano', dispId);
    return m;
  }

  return {
    abrir: abrir, desconectar: desconectar, estado: estado, alCambiar: alCambiar,
    cargaManual: cargaManual, recibir: recibir
  };
})();
