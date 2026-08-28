/* =====================================================================
   almacenamiento.js · Persistencia en localStorage.

   Todo lo que se ve en pantalla sobrevive a un F5, a que se cierre el
   navegador o a que se corte la luz de la PC: la central guarda el estado
   completo (camas, pacientes, dispositivos, historial e incidencias).
   El historial se guarda diezmado a 1 muestra por minuto para no reventar
   la cuota de localStorage (~5 MB); en memoria se trabaja a resolución
   completa.
   ===================================================================== */

var Almacen = (function () {

  var CLAVE = CFG.claveAlmacen;
  var pendiente = null;
  var ultimoGuardado = 0;

  /* Comprime una muestra a un array corto (ocupa ~1/3 que el objeto). */
  function compactar(m) {
    return [
      Math.round(m.t / 1000),
      Math.round(m.pesoG * 10) / 10,
      Math.round(m.volMl * 10) / 10,
      Math.round(m.volTotalMl * 10) / 10,
      Math.round(m.tempC * 100) / 100,
      Math.round(m.rgb[0]), Math.round(m.rgb[1]), Math.round(m.rgb[2]),
      Math.round(m.bat), Math.round(m.rssi),
      m.origen === 'buffer' ? 1 : 0
    ];
  }
  function expandir(a) {
    return {
      t: a[0] * 1000, pesoG: a[1], volMl: a[2], volTotalMl: a[3], tempC: a[4],
      rgb: [a[5], a[6], a[7]], bat: a[8], rssi: a[9],
      origen: a[10] === 1 ? 'buffer' : 'enlace'
    };
  }

  /* Diezma el historial: 1 muestra por minuto, conservando siempre la última. */
  function diezmar(muestras) {
    var out = [], ultimoMin = -1, i, min;
    for (i = 0; i < muestras.length; i++) {
      min = Math.floor(muestras[i].t / 60000);
      if (min !== ultimoMin) { out.push(compactar(muestras[i])); ultimoMin = min; }
    }
    if (muestras.length && out.length &&
        out[out.length - 1][0] !== Math.round(muestras[muestras.length - 1].t / 1000)) {
      out.push(compactar(muestras[muestras.length - 1]));
    }
    return out;
  }

  function serializar(estado) {
    var dispositivos = {};
    Object.keys(estado.dispositivos).forEach(function (k) {
      var d = estado.dispositivos[k];
      dispositivos[k] = {
        id: d.id, serie: d.serie, tipo: d.tipo, escenario: d.escenario,
        inicioEscenario: d.inicioEscenario, estado: d.estado, bat: d.bat, rssi: d.rssi,
        volTotalMl: d.volTotalMl, volBaseMl: d.volBaseMl, tara: d.tara,
        ultimoDato: d.ultimoDato, vaciados: d.vaciados,
        muestras: diezmar(d.muestras || []),
        eventos: (d.eventos || []).slice(-120)
      };
    });
    return JSON.stringify({
      version: 2,
      guardado: Date.now(),
      modo: estado.modo,
      mostrarPilotoEnReal: estado.mostrarPilotoEnReal,
      tema: estado.tema,
      velocidad: estado.velocidad,
      silenciado: estado.silenciado,
      camas: estado.camas,
      pacientes: estado.pacientes,
      dispositivos: dispositivos,
      eventos: (estado.eventos || []).slice(-300),
      reconocidas: estado.reconocidas,
      enlace: estado.enlace,
      medicion: estado.medicion
    });
  }

  function guardar(estado) {
    try {
      localStorage.setItem(CLAVE, serializar(estado));
      ultimoGuardado = Date.now();
      return true;
    } catch (e) {
      // Cuota llena: se recorta el historial a la mitad y se reintenta una vez.
      try {
        Object.keys(estado.dispositivos).forEach(function (k) {
          var d = estado.dispositivos[k];
          d.muestras = d.muestras.slice(Math.floor(d.muestras.length / 2));
        });
        localStorage.setItem(CLAVE, serializar(estado));
        return true;
      } catch (e2) {
        console.warn('No se pudo guardar el estado:', e2);
        return false;
      }
    }
  }

  /* Guardado diferido: como llegan muestras cada 3 s, se escribe a disco
     como mucho una vez cada 4 s. */
  function guardarDiferido(estado) {
    if (pendiente) return;
    var espera = Math.max(0, 4000 - (Date.now() - ultimoGuardado));
    pendiente = setTimeout(function () { pendiente = null; guardar(estado); }, espera);
  }

  function cargar() {
    var crudo;
    try { crudo = localStorage.getItem(CLAVE); } catch (e) { return null; }
    if (!crudo) return null;
    try {
      var d = JSON.parse(crudo);
      if (!d || d.version !== 2) return null;
      Object.keys(d.dispositivos || {}).forEach(function (k) {
        var disp = d.dispositivos[k];
        disp.muestras = (disp.muestras || []).map(expandir);
      });
      return d;
    } catch (e) {
      console.warn('Estado guardado ilegible, se empieza de cero.', e);
      return null;
    }
  }

  function borrar() {
    try { localStorage.removeItem(CLAVE); } catch (e) { }
  }

  function tamano() {
    try {
      var s = localStorage.getItem(CLAVE);
      return s ? Math.round(s.length / 1024) : 0;
    } catch (e) { return 0; }
  }

  return { guardar: guardar, guardarDiferido: guardarDiferido, cargar: cargar, borrar: borrar, tamano: tamano };
})();
