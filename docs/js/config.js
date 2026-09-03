/* =====================================================================
   config.js · Parámetros clínicos, de medición y escala colorimétrica.
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

/* ---------------- Clasificación colorimétrica de la orina ----------------
   SÍMODI clasifica el color observado en cuatro categorías simples.
   El sensor RGB identifica características ópticas; no realiza diagnóstico
   químico ni cuantifica bilirrubina o sangre. */
   
coloresOrina: [
  {
    clave: 'transparente',
    hex: '#F7F7E8',
    nombre: 'Transparente',
    estado: 'ok',
    detalle: ''
  },
  {
    clave: 'amarillo',
    hex: '#F2D84A',
    nombre: 'Amarillo',
    estado: 'ok',
    detalle: ''
  },
  {
    clave: 'rojizo',
    hex: '#B85C5C',
    nombre: 'Rojizo',
    estado: 'grave',
    detalle: 'Coloración rojiza: puede asociarse a presencia de sangre. Requiere valoración clínica.'
  },
  {
    clave: 'marron',
    hex: '#6B4423',
    nombre: 'Marrón oscuro',
    estado: 'grave',
    detalle: 'Coloración marrón oscura: puede asociarse a pigmentos biliares. Requiere valoración clínica.'
  }
],

  /* ---------------- Enlace con el dispositivo ---------------- */
  enlace: {
    tipo: 'websocket',                    // websocket | http | bluetooth | serie | manual
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

  /* ---------------- Camas iniciales del sector ---------------- */
  camasIniciales: [
    { id:'A1', etiqueta:'UTI-01' }, { id:'A2', etiqueta:'UTI-02' },
    { id:'A3', etiqueta:'UTI-03' }, { id:'A4', etiqueta:'UTI-04' },
    { id:'A5', etiqueta:'UTI-05' }, { id:'A6', etiqueta:'UTI-06' },
    { id:'A7', etiqueta:'UTI-07' }, { id:'A8', etiqueta:'UTI-08' }
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
