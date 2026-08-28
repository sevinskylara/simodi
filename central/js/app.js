/* =====================================================================
   app.js · Acciones de alto nivel + arranque de la central.

   Acciones = el único camino desde la UI hacia el modelo. Cada acción
   termina en Acciones.guardar(), así que ninguna interacción del usuario
   se pierde si se recarga la página o se corta la luz.
   ===================================================================== */

var Acciones = (function () {

  function guardar() { Almacen.guardarDiferido(Modelo.estado); }

  function cambiarModo(modo) {
    if (Modelo.estado.modo === modo) return;
    Modelo.estado.modo = modo;
    Modelo.registrarEvento(null, 'sistema', 'Modo de operación → ' + (modo === 'real' ? 'REAL (ESP32)' : 'PILOTO (demo)'));
    guardar();
    if (modo === 'real') Conexion.abrir();
    UI.pintarTodo();
  }

  function agregarCama() {
    var n = Modelo.estado.camas.length + 1;
    var letra = 'A';
    var num = n;
    while (Modelo.buscarCama(letra + num)) num++;
    var id = letra + num;
    Modelo.estado.camas.push({ id: id, etiqueta: 'UTI-' + String(num).padStart(2, '0'), pacienteId: null, dispositivoId: null });
    Modelo.registrarEvento(id, 'sistema', 'Cama agregada a la sala');
    guardar();
    UI.pintarTodo();
    UI.toast('Cama agregada');
  }

  function cambiarEscenario(dispId, clave, reiniciar) {
    Simulador.cambiarEscenario(dispId, clave, reiniciar ? 8 : 0);
    guardar();
    UI.pintarTodo();
  }

  function vaciarBolsa(camaId) {
    var cama = Modelo.buscarCama(camaId);
    if (!cama || !cama.dispositivoId) return;
    var d = Modelo.estado.dispositivos[cama.dispositivoId];
    var ultima = d.muestras.length ? d.muestras[d.muestras.length - 1] : null;
    var mlVaciados = ultima ? ultima.volMl : 0;
    d.vaciados++;
    if (d.tipo === 'sim') d._volSim = 0;
    var med = Modelo.estado.medicion;
    Modelo.ingresarMuestra(d.id, {
      t: Date.now(), pesoG: (d.tara !== undefined ? d.tara : med.taraBolsaG),
      tempC: ultima ? ultima.tempC : 36.8, rgb: ultima ? ultima.rgb : [240, 224, 90],
      bat: d.bat, rssi: d.rssi, origen: 'manual'
    });
    Modelo.registrarEvento(camaId, 'vaciado', 'Vaciado manual de bolsa (' + U.num(mlVaciados, 0) + ' mL) registrado por enfermería', d.id);
    guardar();
    UI.pintarTodo();
    UI.toast('Vaciado registrado: ' + U.num(mlVaciados, 0) + ' mL');
  }

  /* ------------------------------ Exportar CSV -------------------------- */

  function filaCsv(cama, d, m) {
    var enc = ['t_iso', 'hora', 'peso_g', 'vol_ml', 'vol_total_ml', 'temp_c', 'r', 'g', 'b', 'color', 'bat_pct', 'rssi_dbm', 'origen'];
    var filas = d.muestras.map(function (x) {
      var cl = U.clasificarColor(x.rgb);
      return [
        new Date(x.t).toISOString(), U.hora(x.t),
        U.num(x.pesoG, 2), U.num(x.volMl, 2), U.num(x.volTotalMl, 2), U.num(x.tempC, 2),
        Math.round(x.rgb[0]), Math.round(x.rgb[1]), Math.round(x.rgb[2]),
        cl.nombre, Math.round(x.bat), Math.round(x.rssi), x.origen
      ].join(',');
    });
    return enc.join(',') + '\n' + filas.join('\n');
  }

  function exportarCamaCsv(camaId) {
    var cama = Modelo.buscarCama(camaId);
    if (!cama || !cama.dispositivoId) return;
    var d = Modelo.estado.dispositivos[cama.dispositivoId];
    var p = cama.pacienteId ? Modelo.estado.pacientes[cama.pacienteId] : null;
    var nombreArchivo = 'simodi_' + cama.etiqueta + '_' + (p ? p.hc : d.serie) + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    var cab = '# SÍMODI · ' + cama.etiqueta + (p ? ' · ' + p.nombre + ' (' + p.hc + ', ' + p.pesoKg + ' kg)' : '') + ' · dispositivo ' + d.serie + '\n';
    U.descargar(nombreArchivo, cab + filaCsv(cama, d, null));
    UI.toast('CSV exportado');
  }

  function exportarTodoCsv() {
    var partes = [];
    Modelo.estado.camas.forEach(function (cama) {
      if (!cama.dispositivoId) return;
      var d = Modelo.estado.dispositivos[cama.dispositivoId];
      var p = cama.pacienteId ? Modelo.estado.pacientes[cama.pacienteId] : null;
      partes.push('# ' + cama.etiqueta + (p ? ' · ' + p.nombre : '') + ' · ' + d.serie);
      partes.push(filaCsv(cama, d, null));
      partes.push('');
    });
    U.descargar('simodi_export_' + new Date().toISOString().slice(0, 10) + '.csv', partes.join('\n'));
    UI.toast('Exportación completa generada');
  }

  return {
    guardar: guardar, cambiarModo: cambiarModo, agregarCama: agregarCama,
    cambiarEscenario: cambiarEscenario, vaciarBolsa: vaciarBolsa,
    exportarCamaCsv: exportarCamaCsv, exportarTodoCsv: exportarTodoCsv
  };
})();


/* ============================== ARRANQUE ================================ */

(function iniciar() {
  var esPrimeraVez = Modelo.inicializar();

  document.documentElement.dataset.tema = Modelo.estado.tema || 'oscuro';
  U.silenciar(!!Modelo.estado.silenciado);

  UI.bind();
  UI.pintarReloj();
  UI.pintarTodo();
  Alertas.actualizar();
  UI.pintarTodo();

  if (esPrimeraVez) {
    UI.toast('Sala de ejemplo cargada en modo piloto. Probá abrir una cama para ver el detalle.');
  }

  if (Modelo.estado.modo === 'real') Conexion.abrir();

  /* --- reloj de pared: 1 vez por segundo --- */
  setInterval(UI.pintarReloj, 1000);

  /* --- paso de simulación + recálculo de alertas + repintado --- */
  var ultimoPaso = Date.now();
  setInterval(function () {
    var ahora = Date.now();
    var dt = ahora - ultimoPaso;
    ultimoPaso = ahora;

    Simulador.paso(dt);
    Alertas.actualizar();
    UI.pintarTodo();
    guardarPeriodico();
  }, CFG.medicion.periodoMuestreoMs);

  var Acciones_guardar = Acciones.guardar;
  function guardarPeriodico() { Acciones_guardar(); }

  /* --- se guarda también al salir, por si el intervalo no llegó a correr --- */
  window.addEventListener('beforeunload', function () { Almacen.guardar(Modelo.estado); });

  /* --- visibilidad: al volver a la pestaña, se refresca todo al toque --- */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { Alertas.actualizar(); UI.pintarTodo(); }
  });
})();
