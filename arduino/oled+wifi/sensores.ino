/* ======================================================================
   sensores.ino - Celda de carga, temperatura, color y bateria
   ====================================================================== */

// --- NTC (divisor: 3V3 -- R_FIJO -- A0 del ADS1115 -- NTC -- GND) ---
// Verificar R25 y BETA en la hoja de datos del termistor que usen.
const float NTC_VCC   = 3.3;      // tension del divisor (V)
const float NTC_RFIJO = 22000.0;  // resistencia fija del divisor (ohm)
const float NTC_R25   = 22000.0;  // resistencia del NTC a 25 C (ohm)
const float NTC_BETA  = 3950.0;   // coeficiente beta (K)

// --- Bateria: divisor resistivo sobre la celda hacia GPIO39 ---
const float DIVISOR_BAT = 2.0;    // (R_arriba + R_abajo) / R_abajo. Ajustar al divisor real.

// --- Colores de referencia: los mismos 4 que usa la web (config.js) ---
struct ColorRef { const char *nombre; uint8_t r, g, b; };
const ColorRef COLORES[] = {
  { "Transparente",  0xF7, 0xF7, 0xE8 },
  { "Amarillo",      0xF2, 0xD8, 0x4A },
  { "Rojizo",        0xB8, 0x5C, 0x5C },
  { "Marron oscuro", 0x6B, 0x44, 0x23 },
};
const int N_COLORES = sizeof(COLORES) / sizeof(COLORES[0]);

void iniciarSensores() {
#if SIMULAR_SENSORES
  Serial.println("MODO SIMULACION: los valores son inventados");
  return;
#endif
  // Celda de carga
  balanza.begin(HX_DT, HX_SCK);
  hayBalanza = balanza.wait_ready_timeout(1000);
  if (hayBalanza) {
    balanza.set_scale(FACTOR_CALIBRACION);
    prefs.begin("simodi", false);
    if (prefs.isKey("offset")) {
      balanza.set_offset(prefs.getLong("offset"));     // tara guardada
    } else {
      balanza.tare(20);                                // primera vez: tara al arrancar
      prefs.putLong("offset", balanza.get_offset());
    }
    prefs.end();
  } else {
    Serial.println("AVISO: no se detecta el HX711");
  }

  // Bus I2C (color + ADC de temperatura)
  Wire.begin(I2C_SDA, I2C_SCL);
  hayColor = sensorColor.begin(TCS34725_ADDRESS, &Wire);
  if (!hayColor) Serial.println("AVISO: no se detecta el TCS34725");

  hayADS = ads.begin(0x48, &Wire);
  if (hayADS) ads.setGain(GAIN_ONE);                   // rango +-4,096 V
  else Serial.println("AVISO: no se detecta el ADS1115");
}

/* Tara: con la bolsa VACIA colgada, mantener apretado el boton 1 segundo. */
void revisarBotonTara() {
  static unsigned long desde = 0;
  if (!hayBalanza) return;
  if (digitalRead(PIN_BTN_TARE) == LOW) {
    if (desde == 0) desde = millis();
    if (desde != 1 && millis() - desde > 1000) {
      balanza.tare(20);
      prefs.begin("simodi", false);
      prefs.putLong("offset", balanza.get_offset());
      prefs.end();
      reiniciarDiuresis();
      tone(PIN_BUZZ, 2000, 120);
      Serial.println("Tara realizada");
      desde = 1;   // no repetir hasta soltar el boton
    }
  } else {
    desde = 0;
  }
}

// ----------------------------------------------------------- Lecturas

float leerVolumenMl() {
  if (!hayBalanza || !balanza.wait_ready_timeout(200)) return datos.volumen;
  float gramos = balanza.get_units(5);
  return max(0.0f, gramos / DENSIDAD_ORINA);
}

float leerTemperatura() {
  if (!hayADS) return NAN;
  float v = ads.computeVolts(ads.readADC_SingleEnded(0));
  if (v <= 0.01 || v >= NTC_VCC - 0.01) return NAN;    // NTC desconectado o en corto
  float rntc = NTC_RFIJO * v / (NTC_VCC - v);
  float invT = 1.0 / 298.15 + log(rntc / NTC_R25) / NTC_BETA;
  return 1.0 / invT - 273.15;
}

void leerColor(uint8_t &r, uint8_t &g, uint8_t &b) {
  if (!hayColor) return;
  float fr, fg, fb;
  digitalWrite(PIN_LED_COLOR, HIGH);
  delay(5);
  sensorColor.getRGB(&fr, &fg, &fb);   // espera el tiempo de integracion
  digitalWrite(PIN_LED_COLOR, LOW);
  r = constrain((int)fr, 0, 255);
  g = constrain((int)fg, 0, 255);
  b = constrain((int)fb, 0, 255);
}

int leerBateria() {
  static float pct = -1;
  float v = analogReadMilliVolts(PIN_BAT_ADC) / 1000.0 * DIVISOR_BAT;
  if (v < 2.5) return 100;   // divisor no conectado: no se informa bateria baja

  // Curva aproximada de una celda Li-ion
  const float tabV[] = { 3.30, 3.50, 3.60, 3.70, 3.80, 3.90, 4.00, 4.10, 4.20 };
  const float tabP[] = {    0,   10,   20,   35,   50,   65,   80,   90,  100 };
  float p = 100;
  if (v <= tabV[0]) p = 0;
  for (int i = 0; i < 8; i++) {
    if (v >= tabV[i] && v < tabV[i + 1]) {
      p = tabP[i] + (tabP[i + 1] - tabP[i]) * (v - tabV[i]) / (tabV[i + 1] - tabV[i]);
    }
  }
  pct = (pct < 0) ? p : pct * 0.9 + p * 0.1;   // suavizado
  return (int)(pct + 0.5);
}

// ------------------------------------------------- Clasificacion de color
// Misma logica que la web: distancia en espacio CIE Lab al color mas parecido.

void rgbALab(float r, float g, float b, float lab[3]) {
  auto lin = [](float c) {
    c /= 255.0;
    return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
  };
  float rl = lin(r), gl = lin(g), bl = lin(b);
  float x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  float y = (rl * 0.2126 + gl * 0.7152 + bl * 0.0722);
  float z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  auto f = [](float t) { return t > 0.008856 ? pow(t, 1.0 / 3.0) : (7.787 * t + 16.0 / 116.0); };
  float fx = f(x), fy = f(y), fz = f(z);
  lab[0] = 116 * fy - 16;
  lab[1] = 500 * (fx - fy);
  lab[2] = 200 * (fy - fz);
}

const char *clasificarColor(uint8_t r, uint8_t g, uint8_t b) {
  float lab[3], ref[3];
  rgbALab(r, g, b, lab);
  int mejor = 0; float mejorD = 1e9;
  for (int i = 0; i < N_COLORES; i++) {
    rgbALab(COLORES[i].r, COLORES[i].g, COLORES[i].b, ref);
    float d = sqrt(sq(lab[0] - ref[0]) + sq(lab[1] - ref[1]) + sq(lab[2] - ref[2]));
    if (d < mejorD) { mejorD = d; mejor = i; }
  }
  return COLORES[mejor].nombre;
}

// ------------------------------------------------------------- Todo junto

void leerSensores(DatosMonitor &d) {
#if SIMULAR_SENSORES
  // Diuresis simulada que sube y baja entre ~20 y ~80 mL/h en ciclos de
  // 30 min (con 70 kg: de oliguria ~0,3 a normal ~1,1 mL/kg/h).
  // Se llama una vez por segundo.
  static float vol = 300;
  static float temp = 36.8;
  float minutos = millis() / 60000.0;
  float mlH = 50 + 30 * sin(2 * PI * minutos / 30.0);
  vol += mlH / 3600.0;
  if (vol > CAPACIDAD_BOLSA) vol = 0;                // "vaciado" de la bolsa
  temp += random(-2, 3) / 100.0;                     // deriva lenta
  temp = constrain(temp, 36.2, 38.6);
  d.volumen = (int)vol;
  d.temperatura = temp;
  d.r = 242; d.g = 216; d.b = 74;                    // amarillo
  d.bateria = 87;
#else
  d.volumen = (int)(leerVolumenMl() + 0.5);
  d.temperatura = leerTemperatura();
  leerColor(d.r, d.g, d.b);
  d.bateria = leerBateria();
#endif
  if (d.r || d.g || d.b) {
    strncpy(d.colorNombre, clasificarColor(d.r, d.g, d.b), sizeof(d.colorNombre) - 1);
    d.colorNombre[sizeof(d.colorNombre) - 1] = '\0';
  }
}
