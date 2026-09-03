/* =====================================================================
   simulador.js · Modo PILOTO.

   Como se construye un solo prototipo físico, el resto de las camas se
   alimenta con pacientes sintéticos. Cada escenario define la fisiología
   (caudal urinario, temperatura y color en el tiempo) y el simulador la
   integra igual que lo haría el instrumento real: primero calcula el
   volumen, después la masa que "vería" la celda de carga y recién ahí
   genera la lectura. Así el camino de datos es idéntico al del ESP32.
   ===================================================================== */

var Simulador = (function () {

  /* Devuelve el RGB correspondiente a una categoría de color definida
     en CFG.coloresOrina. */
  function colorCategoria(clave) {
    for (var i = 0; i < CFG.coloresOrina.length; i++) {
      if (CFG.coloresOrina[i].clave === clave) {
        return U.hexARgb(CFG.coloresOrina[i].hex);
      }
    }
    return U.hexARgb('#F2D84A');
  }

  /* caudal en mL/kg/h · temp en °C · color: categoría de SÍMODI */
  var ESCENARIOS = {
    normal: {
      nombre: 'Evolución normal',
      resumen: 'Diuresis conservada 1–1,5 mL/kg/h, orina amarilla, afebril.',
      caudal: function (h) { return 1.15 + 0.22 * Math.sin(h / 1.9); },
      temp:   function (h) { return 36.8 + 0.12 * Math.sin(h / 3.1); },
      color:  function (h) { return 'amarillo'; }
    },

    deshidratacion: {
      nombre: 'Deshidratación progresiva',
      resumen: 'El caudal urinario disminuye progresivamente.',
      caudal: function (h) { return 0.55 * Math.exp(-h / 10) + 0.35; },
      temp:   function (h) { return 37.2 + 0.1 * Math.sin(h / 2.5); },
      color:  function (h) { return 'amarillo'; }
    },

    oliguria_lra: {
      nombre: 'Oliguria · LRA en curso',
      resumen: 'Caída sostenida por debajo de 0,5 mL/kg/h: dispara los estadios KDIGO.',
      caudal: function (h) { return 0.95 * Math.exp(-h / 3.2) + 0.17; },
      temp:   function (h) { return 37.5 + 0.15 * Math.sin(h / 2); },
      color:  function (h) { return 'amarillo'; }
    },

    sepsis: {
      nombre: 'Sepsis · fiebre + oliguria',
      resumen: 'La temperatura de la orina sube a 39 °C mientras el caudal se desploma.',
      caudal: function (h) { return 1.0 * Math.exp(-h / 5) + 0.26; },
      temp:   function (h) { return 37.2 + Math.min(2.1, h * 0.26) + 0.08 * Math.sin(h * 2); },
      color:  function (h) { return 'amarillo'; }
    },

    poliuria: {
      nombre: 'Poliuria · diabetes insípida',
      resumen: 'Más de 3 mL/kg/h de orina muy diluida. Riesgo de hipovolemia.',
      caudal: function (h) { return 3.6 + 1.1 * Math.sin(h / 2.2); },
      temp:   function (h) { return 36.9 + 0.1 * Math.sin(h / 3); },
      color:  function (h) { return 'transparente'; }
    },

    hematuria: {
      nombre: 'Coloración rojiza',
      resumen: 'Diuresis conservada con coloración rojiza de la orina.',
      caudal: function (h) { return 1.35 + 0.2 * Math.sin(h / 1.5); },
      temp:   function (h) { return 37.0 + 0.1 * Math.sin(h / 3); },
      color:  function (h) { return 'rojizo'; }
    },

    obstruccion: {
      nombre: 'Obstrucción de sonda',
      resumen: 'A las 2,5 h el flujo se detiene con peso estable: sonda acodada o coágulo.',
      caudal: function (h) { return h < 2.5 ? 1.25 : 0.015; },
      temp:   function (h) { return 36.9 + 0.1 * Math.sin(h / 3); },
      color:  function (h) { return 'amarillo'; }
    },

    bolsa_llena: {
      nombre: 'Bolsa por rebalsar',
      resumen: 'Diuresis alta sin recambio de bolsa: el colector llega al límite.',
      caudal: function (h) { return 2.3; },
      temp:   function (h) { return 36.9; },
      color:  function (h) { return 'amarillo'; },
      sinVaciadoAuto: true
    },

    postquirurgico: {
      nombre: 'Post-operatorio en recuperación',
      resumen: 'Oliguria de las primeras horas que se normaliza con la reposición.',
      caudal: function (h) {
        return h < 3
          ? 0.42 + h * 0.05
          : Math.min(1.25, 0.57 + (h - 3) * 0.16);
      },
      temp: function (h) {
        return 36.4 + Math.min(0.5, h * 0.08);
      },
      color: function (h) { return 'amarillo'; }
    },

    enlace_intermitente: {
      nombre: 'Enlace intermitente',
      resumen: 'Paciente estable, pero el WiFi se corta cada tanto: prueba el búfer del equipo.',
      caudal: function (h) { return 1.1 + 0.2 * Math.sin(h / 2); },
      temp:   function (h) { return 36.9; },
      color:  function (h) { return 'amarillo'; },
      cortes: true
    }
  };

  /* Reconstruye las variables internas tras recargar la página. */
  function asegurar(d) {
    if (d._volSim === undefined) {
      var ult = d.muestras.length ? d.muestras[d.muestras.length - 1] : null;
      d._volSim = ult ? ult.volMl : 0;
      d._tPrev = ult ? ult.t : d.reloj;
      d._bufferSim = [];
      d._cortadoHasta = 0;
      d._proxCorte = d.reloj + (8 + Math.random() * 6) * 60000;
    }
  }

  function esc(d) {
    return ESCENARIOS[d.escenario] || ESCENARIOS.normal;
  }

  /* Genera una lectura para el instante virtual t y la mete en el modelo. */
  function generar(d, p, t, precarga) {
    asegurar(d);

    var e = esc(d);
    var pesoKg = p ? p.pesoKg : 70;
    var h = (t - d.inicioEscenario) / 3600000;
    var dtH = Math.max(0, (t - d._tPrev) / 3600000);

    d._tPrev = t;

    /* --- volumen --- */
    var mlH = Math.max(0, e.caudal(h) * pesoKg);
    d._volSim += mlH * dtH;

    var cap = Modelo.estado.medicion.capacidadBolsaML;

    if (d._volSim > cap * 0.97 && !e.sinVaciadoAuto) {
      d._volSim = 12;
    }

    if (d._volSim > cap) {
      d._volSim = cap;
    }

    /* --- masa que ve la celda de carga (con ruido y cuantización) --- */
    var med = Modelo.estado.medicion;

    var pesoG =
      med.taraBolsaG +
      d._volSim * med.densidadOrina +
      U.ruido(0.35);

    pesoG =
      Math.round(pesoG / med.resolucionPesoG) *
      med.resolucionPesoG;

    /* --- temperatura y color --- */
    var tempC = e.temp(h) + U.ruido(0.04);

    var rgb = colorCategoria(e.color(h));

    rgb = rgb.map(function (v) {
      return U.clamp(v + U.ruido(1.6), 0, 255);
    });

    /* --- batería, fuente y señal --- */
    if (d.fuente === undefined) {
      d.fuente = 'bateria';
    }

    if (Math.random() < 0.0015) {
      d.fuente =
        d.fuente === 'bateria'
          ? 'red'
          : 'bateria';
    }

    d.bat =
      d.fuente === 'red'
        ? Math.min(
            100,
            (d.bat === undefined ? 100 : d.bat) + dtH * 4
          )
        : Math.max(
            0,
            (d.bat === undefined ? 100 : d.bat) - dtH * 1.1
          );

    if (d.bat < 5) {
      d.bat = 100;
    }

    var rssi =
      -52 -
      Math.abs(U.ruido(7));

    var lectura = {
      t: t,
      pesoG: pesoG,
      tempC: tempC,
      rgb: rgb,
      bat: d.bat,
      rssi: rssi,
      fuente: d.fuente,
      origen: 'enlace'
    };

    /* --- corte de enlace: el equipo guarda y reenvía después --- */
    if (!precarga && e.cortes) {
      if (
        t > d._cortadoHasta &&
        t > d._proxCorte &&
        !d._enCorte
      ) {
        d._enCorte = true;
        d._cortadoHasta =
          t +
          (40 + Math.random() * 50) *
          1000;

        d.estado = 'sin-senal';

        Modelo.registrarEvento(
          camaDe(d),
          'enlace',
          'Enlace perdido con ' + d.serie,
          d.id
        );
      }

      if (d._enCorte) {
        if (t < d._cortadoHasta) {
          d._bufferSim.push(lectura);
          return null;
        }

        d._enCorte = false;
        d.estado = 'en-linea';

        d._proxCorte =
          t +
          (6 + Math.random() * 8) *
          60000;

        var n = d._bufferSim.length;

        d._bufferSim.forEach(function (l) {
          l.origen = 'buffer';
          Modelo.ingresarMuestra(d.id, l);
        });

        d._bufferSim = [];

        Modelo.registrarEvento(
          camaDe(d),
          'enlace',
          'Enlace restablecido con ' +
            d.serie +
            ' · ' +
            n +
            ' muestras recuperadas del búfer',
          d.id
        );
      }
    }

    return Modelo.ingresarMuestra(d.id, lectura);
  }

  function camaDe(d) {
    var c = Modelo.camaDeDispositivo(d.id);
    return c ? c.id : null;
  }

  /* Rellena `horas` de historial hacia atrás, a 1 muestra por minuto. */
  function precargar(d, p, horas) {
    var ahora = Date.now();

    d.inicioEscenario =
      ahora -
      horas * 3600000;

    d._volSim = 0;
    d._tPrev = d.inicioEscenario;
    d._bufferSim = [];
    d._cortadoHasta = 0;
    d._proxCorte = ahora + 5 * 60000;
    d.reloj = d.inicioEscenario;

    for (
      var t = d.inicioEscenario;
      t <= ahora;
      t += 60000
    ) {
      generar(d, p, t, true);
    }

    d.reloj = ahora;
    d.estado = 'en-linea';
    d.ultimoContacto = ahora;
  }

  /* Avance en vivo. dtReal = ms transcurridos; velocidad comprime el tiempo. */
  function paso(dtRealMs) {
    var vel =
      Modelo.estado.velocidad ||
      1;

    Modelo.estado.camas.forEach(function (c) {
      if (!c.dispositivoId) return;

      var d =
        Modelo.estado.dispositivos[c.dispositivoId];

      if (!d || d.tipo !== 'sim') return;

      if (
        Modelo.estado.modo === 'real' &&
        !Modelo.estado.mostrarPilotoEnReal
      ) {
        return;
      }

      var p =
        c.pacienteId
          ? Modelo.estado.pacientes[c.pacienteId]
          : null;

      var t =
        (d.reloj || Date.now()) +
        dtRealMs *
        vel;

      d.reloj = t;

      generar(
        d,
        p,
        t,
        false
      );
    });
  }

  function listaEscenarios() {
    return Object.keys(ESCENARIOS).map(function (k) {
      return {
        clave: k,
        nombre: ESCENARIOS[k].nombre,
        resumen: ESCENARIOS[k].resumen
      };
    });
  }

  /* Cambia el escenario de un dispositivo sin perder el historial previo. */
  function cambiarEscenario(dispId, clave, precargaHoras, operador) {
    var d =
      Modelo.estado.dispositivos[dispId];

    if (!d || !ESCENARIOS[clave]) {
      return;
    }

    var c =
      Modelo.camaDeDispositivo(dispId);

    var p =
      (c && c.pacienteId)
        ? Modelo.estado.pacientes[c.pacienteId]
        : null;

    d.escenario = clave;

    if (precargaHoras) {
      d.muestras = [];
      d.volTotalMl = 0;

      precargar(
        d,
        p,
        precargaHoras
      );
    } else {
      d.inicioEscenario =
        d.reloj ||
        Date.now();

      d._proxCorte =
        (d.reloj || Date.now()) +
        3 * 60000;
    }

    Modelo.registrarEvento(
      c ? c.id : null,
      'escenario',
      'Escenario piloto → ' +
        ESCENARIOS[clave].nombre,
      dispId,
      operador
    );
  }

  return {
    escenarios: ESCENARIOS,
    listaEscenarios: listaEscenarios,
    precargar: precargar,
    paso: paso,
    cambiarEscenario: cambiarEscenario
  };

})();
