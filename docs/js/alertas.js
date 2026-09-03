/* =====================================================================
   alertas.js · Motor de alarmas clínicas y técnicas.

   Cada regla devuelve una alerta con un código estable (cama + tipo) para
   que la misma condición no vuelva a sonar en cada refresco: se "engancha"
   mientras dura, se puede reconocer (silenciar) y se apaga sola cuando la
   condición desaparece.

   Niveles:  critica > alta > media > tecnica
   ===================================================================== */

var Alertas = (function () {

  var activas = {};          // codigo -> alerta ya confirmada (se ve en pantalla)
  var pendientes = {};       // codigo -> { alerta, desde } candidata, todavía sin confirmar
  var porResolver = {};      // codigo -> { desde } activa pero la condición ya no se cumple
  var ORDEN = { critica: 0, alta: 1, media: 2, tecnica: 3 };
  var oyentes = [];

  /* Una lectura ruidosa aislada (temperatura, color) puede cruzar un umbral
     por un instante y volver enseguida. Para no abrir y cerrar la misma
     alerta —y hacer sonar la alarma— en cada muestra, una condición tiene
     que sostenerse este tiempo antes de confirmarse o de darse por resuelta. */
  var DEBOUNCE_MS = 6000;

  /* ------------------------- Reglas por cama ------------------------- */
  function reglas(m) {
    var out = [];
    var U_ = CFG.umbrales;
    var cama = m.cama, p = m.paciente, d = m.dispositivo;
    var ref = cama.etiqueta;

    function a(tipo, nivel, titulo, detalle) {
      out.push({
        codigo: cama.id + ':' + tipo, camaId: cama.id, ref: ref, tipo: tipo,
        nivel: nivel, titulo: titulo, detalle: detalle
      });
    }

    /* ---- Técnicas: primero, porque condicionan la lectura de las demás ---- */
    if (m.sinSenalSeg > U_.segundosSinDatos) {
      a('enlace', 'tecnica', 'Sin señal del dispositivo',
        d.serie + ' no transmite hace ' + U.duracion(m.sinSenalSeg * 1000) +
        '. Los datos mostrados son los últimos recibidos.');
    }
    if (!p) {
      a('sinpaciente', 'tecnica', 'Dispositivo sin paciente',
        d.serie + ' está midiendo pero no tiene paciente vinculado.');
    }
    if (m.bat <= U_.bateriaCritica) {
      a('bateria', 'alta', 'Batería crítica', d.serie + ' al ' + Math.round(m.bat) + ' %. Conectar a la red.');
    } else if (m.bat <= U_.bateriaBaja) {
      a('bateria', 'tecnica', 'Batería baja', d.serie + ' al ' + Math.round(m.bat) + ' %.');
    }

    /* ---- Bolsa colectora ---- */
    if (m.llenado >= U_.bolsaCritica) {
      a('bolsa', 'alta', 'Bolsa llena',
        'Colector al ' + Math.round(m.llenado * 100) + ' % (' + U.num(m.volBolsaMl, 0) + ' mL). Vaciar ahora: la medición se pierde si rebalsa.');
    } else if (m.llenado >= U_.bolsaAviso) {
      a('bolsa', 'media', 'Bolsa próxima al límite',
        'Colector al ' + Math.round(m.llenado * 100) + ' %. Programar el vaciado.');
    }

    if (!p || m.mlKgH === null) return out;   // sin peso no hay criterio clínico

    /* ---- Diuresis ---- */
    if (m.kdigo === 3) {
      a('kdigo', 'critica', 'LRA KDIGO estadio 3',
        'Diuresis < 0,3 mL/kg/h durante ' + m.horasOliguriaGrave + ' h' +
        (m.horasAnuria >= U_.horasAnuria ? ' · anuria ' + m.horasAnuria + ' h' : '') +
        '. Avisar al médico de guardia.');
    } else if (m.kdigo === 2) {
      a('kdigo', 'critica', 'LRA KDIGO estadio 2',
        'Oliguria sostenida hace ' + m.horasOliguria + ' h (' + U.num(m.mlKgH, 2) + ' mL/kg/h).');
    } else if (m.kdigo === 1) {
      a('kdigo', 'alta', 'LRA KDIGO estadio 1',
        'Oliguria hace ' + m.horasOliguria + ' h. Revisar balance y perfusión.');
    } else if (m.mlKgH < U_.anuria) {
      a('anuria', 'critica', 'Anuria',
        'Prácticamente sin diuresis en la última hora (' + U.num(m.mlH, 0) + ' mL/h).');
    } else if (m.mlKgH < U_.oliguria) {
      a('oliguria', 'media', 'Diuresis por debajo del objetivo',
        U.num(m.mlKgH, 2) + ' mL/kg/h · objetivo ≥ ' + U.num(p.objetivoMlKgH, 1) +
        '. Lleva ' + (m.horasOliguria || '<1') + ' h.');
    } else if (m.mlKgH > U_.poliuria) {
      a('poliuria', 'alta', 'Poliuria',
        U.num(m.mlKgH, 1) + ' mL/kg/h (' + U.num(m.mlH, 0) + ' mL/h). Riesgo de hipovolemia y trastorno electrolítico.');
    }

    /* ---- Sonda / flujo ---- */
    if (m.minSinFlujo >= U_.minutosSinFlujo && m.llenado < U_.bolsaAviso) {
      a('obstruccion', 'alta', 'Posible obstrucción de sonda',
        'Sin incremento de volumen hace ' + U.duracion(m.minSinFlujo * 60000) +
        ' con peso estable. Verificar acodamiento o coágulos.');
    }

    /* ---- Temperatura ---- */
    if (m.tempC !== null) {
      if (m.tempC >= U_.tempFebrilAlta) {
        a('temp', 'critica', 'Hipertermia', U.num(m.tempC, 1) + ' °C medidos en la orina.');
      } else if (m.tempC >= U_.tempFebril) {
        a('temp', 'alta', 'Fiebre', U.num(m.tempC, 1) + ' °C. Máxima de 6 h: ' + U.num(m.tempMax6h, 1) + ' °C.');
      } else if (m.tempC <= U_.tempHipotermia) {
        a('temp', 'alta', 'Hipotermia', U.num(m.tempC, 1) + ' °C. Revisar temperatura del paciente.');
      }
    }

   /* ---- Color ---- */
if (m.color) {
  if (m.color.clave === 'rojizo') {
    a('color', 'alta', 'Coloración rojiza',
      m.color.detalle);
  } else if (m.color.clave === 'marron') {
    a('color', 'alta', 'Coloración marrón oscura',
      m.color.detalle);
  }
}

  /* --------------------- Ciclo de vida de la alerta ------------------ */
  function actualizar() {
    var vistas = {}, nuevas = [];
    var ahora = Date.now();
    var camas = Modelo.camasVisibles();

    camas.forEach(function (c) {
      var m = Modelo.metricas(c);
      if (m.vacio) return;
      reglas(m).forEach(function (al) {
        vistas[al.codigo] = true;
        delete porResolver[al.codigo];   // sigue cumpliéndose: se cancela cualquier resolución pendiente

        var prev = activas[al.codigo];
        if (prev) {
          prev.titulo = al.titulo; prev.detalle = al.detalle;
          if (ORDEN[al.nivel] < ORDEN[prev.nivel]) {
            // Un empeoramiento reabre la alerta aunque estuviera reconocida.
            prev.nivel = al.nivel; prev.reconocida = false;
            delete Modelo.estado.reconocidas[al.codigo];
            nuevas.push(prev);
          } else if (prev.reconocida) {
            // Sigue igual de mal: si ya pasó el tiempo de gracia elegido al
            // silenciarla sin que nadie la haya resuelto, vuelve a sonar sola.
            var silencio = Modelo.estado.reconocidas[al.codigo];
            var ventanas = CFG.umbrales.reAlertaMin[prev.nivel] || {};
            var motivo = (silencio && silencio.motivo) || 'espera';
            var ventanaMs = (ventanas[motivo] || 60) * 60000;
            if (silencio && (ahora - silencio.en) >= ventanaMs) {
              prev.reconocida = false;
              delete Modelo.estado.reconocidas[al.codigo];
              nuevas.push(prev);
              Modelo.registrarEvento(prev.camaId, 'alerta',
                'Persiste: ' + prev.titulo + ' (silenciada como "' +
                (motivo === 'atendido' ? 'paciente atendido' : 'paciente en espera') +
                '" hace ' + U.duracion(ahora - silencio.en) + ', sigue sin resolverse)');
            }
          }
          return;
        }

        var cand = pendientes[al.codigo];
        if (!cand) { pendientes[al.codigo] = { alerta: al, desde: ahora }; return; }
        cand.alerta = al;   // se sostiene: se refresca el detalle por si tarda en confirmarse
        if (ahora - cand.desde < DEBOUNCE_MS) return;   // todavía no se sostuvo lo suficiente

        al.desde = ahora;
        al.reconocida = !!Modelo.estado.reconocidas[al.codigo];
        activas[al.codigo] = al;
        nuevas.push(al);
        delete pendientes[al.codigo];
        Modelo.registrarEvento(al.camaId, 'alerta', '[' + al.nivel.toUpperCase() + '] ' + al.titulo);
      });
    });

    // Una candidata que dejó de verse este ciclo no llegó a sostenerse: se descarta.
    Object.keys(pendientes).forEach(function (cod) { if (!vistas[cod]) delete pendientes[cod]; });

    // Se apagan (tras el tiempo de confirmación) las que ya no se cumplen.
    Object.keys(activas).forEach(function (cod) {
      if (vistas[cod]) return;
      var res = porResolver[cod];
      if (!res) { porResolver[cod] = { desde: ahora }; return; }
      if (ahora - res.desde < DEBOUNCE_MS) return;
      var al = activas[cod];
      Modelo.registrarEvento(al.camaId, 'alerta', 'Resuelta: ' + al.titulo);
      delete activas[cod];
      delete Modelo.estado.reconocidas[cod];
      delete porResolver[cod];
    });

    // Sonido: sólo la más grave de las nuevas, y sólo si no está reconocida.
    var sonar = null;
    nuevas.forEach(function (al) {
      if (al.reconocida) return;
      if (!sonar || ORDEN[al.nivel] < ORDEN[sonar.nivel]) sonar = al;
    });
    if (sonar && sonar.nivel !== 'tecnica') U.alarma(sonar.nivel);

    if (nuevas.length) oyentes.forEach(function (f) { f(nuevas); });
    return nuevas;
  }

  function lista() {
    return Object.keys(activas).map(function (k) { return activas[k]; })
      .sort(function (a, b) {
        if (a.reconocida !== b.reconocida) return a.reconocida ? 1 : -1;
        if (ORDEN[a.nivel] !== ORDEN[b.nivel]) return ORDEN[a.nivel] - ORDEN[b.nivel];
        return b.desde - a.desde;
      });
  }

  function porCama(camaId) {
    return lista().filter(function (a) { return a.camaId === camaId; });
  }

  /* Silencia una alerta activa por un tiempo acorde al motivo elegido
     (ver CFG.umbrales.reAlertaMin). No registra el evento: eso queda a
     cargo de quien llama, que conoce el nombre del operador. */
  function silenciar(codigo, motivo) {
    var al = activas[codigo];
    if (!al) return null;
    al.reconocida = true;
    Modelo.estado.reconocidas[codigo] = { en: Date.now(), motivo: motivo === 'atendido' ? 'atendido' : 'espera' };
    return al;
  }

  /* Nivel más grave de una cama; alimenta el color del borde de la tarjeta. */
  function nivelCama(camaId) {
    var as = porCama(camaId);
    if (!as.length) return 'ok';
    var peor = as.reduce(function (p, a) { return ORDEN[a.nivel] < ORDEN[p.nivel] ? a : p; });
    return { critica: 'critico', alta: 'grave', media: 'aviso', tecnica: 'sinsenal' }[peor.nivel];
  }

  function contarPorNivel() {
    var c = { critica: 0, alta: 0, media: 0, tecnica: 0 };
    lista().forEach(function (a) { c[a.nivel]++; });
    return c;
  }

  function alCambiar(f) { oyentes.push(f); }

  return {
    actualizar: actualizar, lista: lista, porCama: porCama,
    silenciar: silenciar,
    nivelCama: nivelCama, contarPorNivel: contarPorNivel, alCambiar: alCambiar
  };
})();
