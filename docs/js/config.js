/* =====================================================================
   config.js · Parámetros clínicos, de medición y categorías de color.
   Todo lo "ajustable" del instrumento vive acá.
   ===================================================================== */

var CFG = {

  app: { nombre: 'SÍMODI', nombreLargo: 'Sistema de Monitoreo de Diuresis', version: '1.0', sector: 'Terapia Intensiva' },

  /* ---------------- Conversión peso → volumen ----------------
     La celda de carga mide la masa total colgada del soporte.
       volumen [mL] = (masa_total [g] - tara [g]) / densidad [g/mL]
     La densidad de la orina es la densidad específica urinaria, que va de
     1.003 (muy diluida) a 1.035 (concentrada). Se usa un valor medio y se
     puede corregir por paciente desde Configuración.                     */
  medicion: {
    densidadOrina:   1.015,   // g/mL
    taraBolsaG:      90,      // masa de la bolsa vacía + soporte
    capacidadBolsaML:2000,    // bolsa colectora estándar
    periodoMuestreoMs: 3000,  // cada cuánto llega una muestra del ESP32
    ventanaDiuresisMin: 60,   // ventana para la diuresis "horaria"
    ventanaMinimaMin: 10,     // mínimo de datos para calcular una tasa
    ventanaInstantMin: 15,    // ventana de la tasa instantánea
    horasHistorial: 24,       // cuánto historial se guarda por dispositivo
    resolucionPesoG: 0.5      // resolución de la celda de carga (HX711)
  },

  /* ---------------- Umbrales clínicos ----------------
     Diuresis normal del adulto: 0,5 – 1,5 mL/kg/h.
     Criterios KDIGO de lesión renal aguda (LRA) por diuresis:
       Estadio 1 : < 0,5 mL/kg/h durante 6–12 h
       Estadio 2 : < 0,5 mL/kg/h durante ≥ 12 h
       Estadio 3 : < 0,3 mL/kg/h ≥ 24 h  ó  anuria ≥ 12 h            */
  umbrales: {
    anuria:        0.1,   // mL/kg/h
    oliguriaGrave: 0.3,
    oliguria:      0.5,
    normalBajo:    0.5,
    normalAlto:    1.5,
    poliuria:      3.0,

    horasKdigo1:  6,
    horasKdigo2: 12,
    horasKdigo3: 24,
    horasAnuria: 12,

    tempHipotermia: 35.5,
    tempSubfebril:  37.5,
    tempFebril:     38.0,
    tempFebrilAlta: 39.0,

    bolsaAviso:   0.80,   // fracción de llenado
    bolsaCritica: 0.95,

    bateriaBaja:    20,   // %
    bateriaCritica: 10,

    segundosSinDatos: 45,     // se considera "sin señal"
    minutosSinFlujo:  45,     // flujo ~0 sostenido ⇒ sospecha de obstrucción
    flujoNuloMlH:     3,      // por debajo de esto se considera flujo nulo

    /* Re-alerta: silenciar una alerta la posterga, pero si el mismo problema
       sigue sin resolverse pasado este tiempo, vuelve a sonar sola (no hace
       falta que empeore). Cuanto más grave, antes insiste.

       Dos ventanas por nivel según el motivo que elige quien silencia:
       "atendido" (ya se actuó sobre el paciente) tolera más espera antes de
       reinsistir; "espera" (todavía no se pudo atender) vuelve a chequear
       antes. Basado en los criterios KDIGO de diuresis horaria —oliguria
       sostenida ≥6-12 h para estadio 1, ≥12 h para estadio 2, <0,3 mL/kg/h
       ≥24 h o anuria ≥12 h para estadio 3— y en el hallazgo de que un
       control manual cada ≤3 h reduce la sobrecarga de fluidos frente a
       controles más espaciados (KDIGO 2012 AKI Guideline; PMC9792308).
       Las ventanas quedan bien por debajo de esas horas de definición para
       no dejar pasar una hora completa de diuresis sin reevaluar. */
    reAlertaMin: {
      critica: { atendido: 30,  espera: 15 },
      alta:    { atendido: 60,  espera: 30 },
      media:   { atendido: 120, espera: 60 },
      tecnica: { atendido: 180, espera: 60 }
    }
  },

/* ---------------- Clasificación del color de la orina ----------------
   La clasificación la hace el FIRMWARE (sensor TCS34725 calibrado contra la
   recta del agua y la del amarillo) y llega por Bluetooth como
   "color":"NORMAL" | "ANOMALO" (null si el sensor está en falla).
   La central no vuelve a clasificar: solo muestra lo que decidió el equipo.
   ANOMALO = coloración rojiza sostenida (3 de 10 lecturas); queda enganchado
   en el equipo hasta que se reconoce con el pulsador ALARMA.
   El sensor identifica características ópticas; no hace diagnóstico químico
   ni cuantifica sangre.

   "hex" es el color con que se pinta la categoría en la central.
   "referencias" sirve para leer historiales viejos guardados como RGB. */

  coloresOrina: [
    {
      clave: 'normal',
      firmware: 'NORMAL',
      hex: '#E8C547',
      nombre: 'Normal',
      estado: 'ok',
      detalle: 'Sin coloración rojiza.',
      referencias: ['#E8C547', '#F2D84A', '#F7F7E8']
    },
    {
      clave: 'anomalo',
      firmware: 'ANOMALO',
      hex: '#C0504D',
      nombre: 'Anómalo',
      estado: 'grave',
      detalle: 'Coloración rojiza detectada por el equipo: puede asociarse a presencia de sangre. Requiere valoración clínica. Se reconoce con el botón ALARMA del equipo.',
      referencias: ['#C0504D', '#B85C5C', '#6B4423']
    }
  ],

  /* ---------------- Enlace con el dispositivo ---------------- */
  enlace: {
    tipo: 'bluetooth',                    // bluetooth (firmware actual) | websocket | http | serie | manual
    urlWebSocket: 'ws://192.168.4.1:81',  // ESP32 como punto de acceso
    urlHttp: 'http://192.168.4.1/datos',
    periodoHttpMs: 3000,
    reintentoBaseMs: 1500,
    reintentoMaxMs: 30000,
    // UUID del servicio BLE que expone el firmware del ESP32
    bleServicio: '0000ffe0-0000-1000-8000-00805f9b34fb',
    bleCaracteristica: '0000ffe1-0000-1000-8000-00805f9b34fb',
    bleNombrePrefijo: 'URO-'
  },

  /* ---------------- Camas del sector ---------------- */
  maxCamas: 6,   // máximo de camas que se pueden tener en la sala

  camasIniciales: [
    { id:'A1', etiqueta:'UTI-01' }, { id:'A2', etiqueta:'UTI-02' },
    { id:'A3', etiqueta:'UTI-03' }, { id:'A4', etiqueta:'UTI-04' },
    { id:'A5', etiqueta:'UTI-05' }, { id:'A6', etiqueta:'UTI-06' }
  ],

  /* Velocidades de simulación disponibles en modo piloto.
     x60 = 1 minuto real equivale a 1 hora de paciente.  */
  velocidades: [
    { v:1,   rot:'Tiempo real' },
    { v:60,  rot:'×60 (1 min = 1 h)' },
    { v:300, rot:'×300 (12 s = 1 h)' }
  ],

  claveAlmacen: 'simodi.v1'
};
