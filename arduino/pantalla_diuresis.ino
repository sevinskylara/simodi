/*
 * Pantalla local - Sistema Inteligente de Monitoreo de Diuresis
 * ESP32-DevKitC + TFT SPI ILI9488 480x320 (modo 18 bits)
 *
 * Libreria: Arduino_GFX_Library (moononournation)
 * Las fuentes van como archivos .h en la misma carpeta del sketch.
 *
 * Conexiones (segun esquematico):
 *   TFT_DC   -> GPIO2      TFT_CS   -> GPIO15
 *   TFT_SCK  -> GPIO18     TFT_MOSI -> GPIO23 (SDI)
 *   TFT_RST  -> GPIO4      SDO      -> sin conectar
 *   LED      -> 3V3
 *
 * Uso: completar un DatosMonitor con las mediciones y llamar a
 * actualizarPantalla(datos). Solo se redibuja lo que cambio.
 * Para la tendencia: agregarPuntoTendencia(diuresis) cada X minutos.
 *
 * Las fuentes son ASCII: no usar tildes ni enie en los textos.
 */

#include <Arduino_GFX_Library.h>
#include "FreeMono12pt7b.h"
#include "FreeMonoBold9pt7b.h"
#include "FreeMonoBold12pt7b.h"
#include "FreeMonoBold24pt7b.h"
#include "FreeMonoBold36pt7b.h"
#include "tipos_monitor.h"   // struct DatosMonitor y enum Estado

// ------------------------------------------------------------------ Pines
#define TFT_DC    2
#define TFT_CS   15
#define TFT_SCK  18
#define TFT_MOSI 23
#define TFT_RST   4

#define VELOCIDAD_SPI 10000000   // 10 MHz probado; se puede intentar 20-40 MHz

Arduino_DataBus *bus = new Arduino_ESP32SPI(TFT_DC, TFT_CS, TFT_SCK, TFT_MOSI, GFX_NOT_DEFINED);
Arduino_GFX *tft = new Arduino_ILI9488_18bit(bus, TFT_RST, 1 /* rotacion */, false);

// --------------------------------------------------------------- Umbrales
// Ajustarlos para que coincidan con los de la pagina web
const float UMBRAL_OLIGURIA  = 0.5;   // mL/kg/h (KDIGO)
const float UMBRAL_POLIURIA  = 3.0;   // mL/kg/h
const float UMBRAL_FIEBRE    = 38.0;  // C
const int   UMBRAL_BOLSA_PCT = 90;    // % de llenado
const int   UMBRAL_BATERIA   = 20;    // %

// --------------------------------------------------------------- Demo
#define MODO_DEMO 1                          // 0 = usar datos reales
const unsigned long INTERVALO_PANTALLA_MS  = 1000;
const unsigned long INTERVALO_TENDENCIA_MS = 5000;   // en uso real: 5-10 min

// --------------------------------------------------------------- Colores
// rgb(r, g, b) esta definida en tipos_monitor.h
const uint16_t C_FONDO       = rgb(17, 23, 30);
const uint16_t C_CAJA        = rgb(13, 18, 24);
const uint16_t C_BORDE       = rgb(40, 48, 58);
const uint16_t C_TEXTO       = rgb(230, 237, 243);
const uint16_t C_TENUE       = rgb(139, 148, 158);
const uint16_t C_BARRA_FDO   = rgb(30, 37, 45);
const uint16_t C_TEAL        = rgb(111, 211, 190);
const uint16_t C_TEAL_OSC    = rgb(24, 46, 44);
const uint16_t C_NARANJA     = rgb(232, 146, 74);
const uint16_t C_NARANJA_OSC = rgb(52, 38, 30);
const uint16_t C_ROJO        = rgb(235, 92, 82);
const uint16_t C_ROJO_OSC    = rgb(58, 28, 28);



DatosMonitor datos;
DatosMonitor previo;
bool primeraVez = true;

const int N_TEND = 30;
float tendencia[N_TEND];
int nTend = 0;
bool tendenciaCambio = false;

// ============================================================ Utilidades
void fmtDecimal(float v, int dec, char *out, size_t n) {
  snprintf(out, n, "%.*f", dec, v);
  for (char *p = out; *p; p++) if (*p == '.') *p = ',';
}

void fmtMiles(int v, char *out, size_t n) {
  if (v >= 1000) snprintf(out, n, "%d.%03d", v / 1000, v % 1000);
  else           snprintf(out, n, "%d", v);
}

void texto(const char *s, int x, int y, const GFXfont *f, uint16_t c) {
  tft->setFont(f);
  tft->setTextSize(1);
  tft->setTextColor(c);
  tft->setCursor(x, y);   // con fuentes GFX, y es la linea base
  tft->print(s);
}

int anchoTexto(const char *s, const GFXfont *f) {
  int16_t x1, y1; uint16_t w, h;
  tft->setFont(f);
  tft->setTextSize(1);
  tft->getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  return w;
}

Estado estadoDiuresis(float v) {
  if (v < UMBRAL_OLIGURIA) return OLIGURIA;
  if (v > UMBRAL_POLIURIA) return POLIURIA;
  return NORMAL;
}

uint16_t colorEstado(Estado e) {
  if (e == OLIGURIA) return C_ROJO;
  if (e == POLIURIA) return C_NARANJA;
  return C_TEAL;
}

uint16_t colorEstadoOsc(Estado e) {
  if (e == OLIGURIA) return C_ROJO_OSC;
  if (e == POLIURIA) return C_NARANJA_OSC;
  return C_TEAL_OSC;
}

// ============================================================ Secciones

void dibujarBarraLateral(Estado e) {
  tft->fillRect(0, 0, 6, 320, colorEstado(e));
}

void dibujarEncabezado(const DatosMonitor &d) {
  tft->fillRect(8, 0, 368, 62, C_FONDO);

  // Badge de cama
  int wb = anchoTexto(d.cama, &FreeMonoBold12pt7b) + 24;
  tft->fillRoundRect(18, 12, wb, 36, 7, C_TEAL);
  texto(d.cama, 30, 38, &FreeMonoBold12pt7b, C_FONDO);

  // Nombre (recortado a 16 caracteres)
  char nombre[18];
  if (strlen(d.paciente) > 16) {
    strncpy(nombre, d.paciente, 15);
    nombre[15] = '.'; nombre[16] = '\0';
  } else {
    strcpy(nombre, d.paciente);
  }
  texto(nombre, 18 + wb + 16, 38, &FreeMonoBold12pt7b, C_TEXTO);

  // Badge de modo (PILOTO)
  tft->fillRect(380, 32, 100, 22, C_FONDO);
  if (strlen(d.modo) > 0) {
    int wm = anchoTexto(d.modo, &FreeMonoBold9pt7b) + 14;
    tft->fillRoundRect(380, 32, wm, 21, 4, C_TEAL_OSC);
    texto(d.modo, 387, 47, &FreeMonoBold9pt7b, C_TEAL);
  }

  tft->drawFastHLine(8, 62, 472, C_BORDE);
}

void dibujarBateria(int pct, bool cargando) {
  const int x = 380, y = 9;
  tft->fillRect(x, y, 100, 18, C_FONDO);

  tft->drawRoundRect(x, y, 28, 16, 3, C_TENUE);
  tft->fillRect(x + 28, y + 5, 3, 6, C_TENUE);
  uint16_t c = (pct <= UMBRAL_BATERIA) ? C_ROJO : C_TEAL;
  int w = map(constrain(pct, 0, 100), 0, 100, 0, 24);
  tft->fillRect(x + 2, y + 2, w, 12, c);

  if (cargando) {  // rayo
    tft->fillTriangle(x + 16, y + 1, x + 9, y + 9, x + 15, y + 9, C_TEXTO);
    tft->fillTriangle(x + 13, y + 7, x + 19, y + 7, x + 12, y + 15, C_TEXTO);
  }

  char buf[6];
  snprintf(buf, sizeof(buf), "%d%%", pct);
  texto(buf, x + 38, y + 14, &FreeMonoBold9pt7b, C_TENUE);
}

void dibujarDiuresis(float v, Estado e) {
  tft->fillRect(8, 66, 314, 86, C_FONDO);

  char buf[10];
  fmtDecimal(v, (v < 10) ? 2 : 1, buf, sizeof(buf));
  texto(buf, 20, 134, &FreeMonoBold36pt7b, colorEstado(e));

  int xu = 20 + anchoTexto(buf, &FreeMonoBold36pt7b) + 14;
  texto("mL/kg/h", xu, 134, &FreeMono12pt7b, C_TENUE);
}

void dibujarTendencia(Estado e) {
  const int X = 330, Y = 78, W = 134, H = 58;
  tft->fillRect(X - 4, Y - 6, W + 10, H + 10, C_FONDO);
  if (nTend < 2) return;

  float vmax = UMBRAL_OLIGURIA * 2;
  for (int i = 0; i < nTend; i++) if (tendencia[i] > vmax) vmax = tendencia[i];
  vmax *= 1.15;

  auto yDe = [&](float v) { return Y + H - (int)(v / vmax * H); };
  auto xDe = [&](int i)   { return X + (i * W) / (nTend - 1); };

  // Relleno bajo la curva
  uint16_t cRel = colorEstadoOsc(e);
  for (int i = 0; i < nTend - 1; i++) {
    int x0 = xDe(i), x1 = xDe(i + 1);
    int y0 = yDe(tendencia[i]), y1 = yDe(tendencia[i + 1]);
    for (int px = x0; px <= x1; px++) {
      int py = (x1 == x0) ? y0 : y0 + (y1 - y0) * (px - x0) / (x1 - x0);
      tft->drawFastVLine(px, py, Y + H - py, cRel);
    }
  }

  // Umbral de oliguria (punteado)
  int yu = yDe(UMBRAL_OLIGURIA);
  for (int px = X; px < X + W; px += 8) tft->drawFastHLine(px, yu, 4, C_ROJO);

  // Curva
  uint16_t c = colorEstado(e);
  for (int i = 0; i < nTend - 1; i++) {
    int x0 = xDe(i), x1 = xDe(i + 1);
    int y0 = yDe(tendencia[i]), y1 = yDe(tendencia[i + 1]);
    for (int k = -1; k <= 1; k++) tft->drawLine(x0, y0 + k, x1, y1 + k, c);
  }
  tft->fillCircle(xDe(nTend - 1), yDe(tendencia[nTend - 1]), 4, c);
}

void dibujarTemperatura(float t) {
  const int x = 16, y = 160, w = 178, h = 70;
  tft->fillRoundRect(x, y, w, h, 9, C_CAJA);
  tft->drawRoundRect(x, y, w, h, 9, C_BORDE);

  char buf[8];
  fmtDecimal(t, 1, buf, sizeof(buf));
  uint16_t c = (t >= UMBRAL_FIEBRE) ? C_ROJO : C_TEXTO;
  texto(buf, x + 16, y + 50, &FreeMonoBold24pt7b, c);

  int xg = x + 16 + anchoTexto(buf, &FreeMonoBold24pt7b) + 10;
  tft->drawCircle(xg, y + 24, 3, C_TENUE);   // simbolo de grado
  texto("C", xg + 5, y + 40, &FreeMono12pt7b, C_TENUE);
}

void dibujarColor(const char *nombre, uint8_t r, uint8_t g, uint8_t b) {
  const int x = 204, y = 160, w = 264, h = 70;
  tft->fillRoundRect(x, y, w, h, 9, C_CAJA);
  tft->drawRoundRect(x, y, w, h, 9, C_BORDE);

  char buf[14];
  strncpy(buf, nombre, 13); buf[13] = '\0';
  texto(buf, x + 18, y + 42, &FreeMonoBold12pt7b, C_TEXTO);

  int xs = x + w - 18 - 26;
  tft->fillRoundRect(xs, y + 22, 26, 26, 5, rgb(r, g, b));
  tft->drawRoundRect(xs, y + 22, 26, 26, 5, C_BORDE);
}

void dibujarBolsa(int vol, int cap) {
  tft->fillRect(8, 238, 472, 46, C_FONDO);
  texto("Bolsa", 18, 258, &FreeMono12pt7b, C_TENUE);

  char sv[10], sc[10], buf[32];
  fmtMiles(vol, sv, sizeof(sv));
  fmtMiles(cap, sc, sizeof(sc));
  snprintf(buf, sizeof(buf), "%s / %s mL", sv, sc);
  texto(buf, 466 - anchoTexto(buf, &FreeMono12pt7b), 258, &FreeMono12pt7b, C_TENUE);

  const int bx = 18, by = 268, bw = 448, bh = 10;
  tft->fillRoundRect(bx, by, bw, bh, 5, C_BARRA_FDO);
  int pct = (cap > 0) ? constrain(vol * 100 / cap, 0, 100) : 0;
  int wl = bw * pct / 100;
  if (wl > 0) {
    uint16_t c = (pct >= UMBRAL_BOLSA_PCT) ? C_ROJO : C_TEAL;
    tft->fillRoundRect(bx, by, max(wl, bh), bh, 5, c);
  }
}

// Etiquetas de estado al pie (tipo "Poliuria")
int dibujarEtiqueta(int x, const char *s, uint16_t cTexto, uint16_t cFondo) {
  int w = anchoTexto(s, &FreeMonoBold12pt7b) + 24;
  if (x + w > 468) return x;   // no entra, se omite
  tft->fillRoundRect(x, 287, w, 30, 6, cFondo);
  texto(s, x + 12, 308, &FreeMonoBold12pt7b, cTexto);
  return x + w + 10;
}

uint8_t mascaraAlertas(const DatosMonitor &d) {
  uint8_t m = estadoDiuresis(d.diuresis);   // bits 0-1
  if (d.temperatura >= UMBRAL_FIEBRE) m |= 1 << 2;
  if (d.capacidadBolsa > 0 &&
      d.volumenBolsa * 100 / d.capacidadBolsa >= UMBRAL_BOLSA_PCT) m |= 1 << 3;
  if (d.bateria <= UMBRAL_BATERIA) m |= 1 << 4;
  return m;
}

void dibujarEtiquetas(const DatosMonitor &d) {
  tft->fillRect(8, 286, 472, 34, C_FONDO);
  int x = 18;
  switch (estadoDiuresis(d.diuresis)) {
    case OLIGURIA: x = dibujarEtiqueta(x, "Oliguria", C_ROJO, C_ROJO_OSC); break;
    case POLIURIA: x = dibujarEtiqueta(x, "Poliuria", C_NARANJA, C_NARANJA_OSC); break;
    default:       x = dibujarEtiqueta(x, "Normal", C_TEAL, C_TEAL_OSC); break;
  }
  uint8_t m = mascaraAlertas(d);
  if (m & (1 << 2)) x = dibujarEtiqueta(x, "Fiebre", C_ROJO, C_ROJO_OSC);
  if (m & (1 << 3)) x = dibujarEtiqueta(x, "Bolsa llena", C_ROJO, C_ROJO_OSC);
  if (m & (1 << 4)) x = dibujarEtiqueta(x, "Bateria baja", C_NARANJA, C_NARANJA_OSC);
}

// ============================================================ API publica

void agregarPuntoTendencia(float v) {
  if (nTend < N_TEND) {
    tendencia[nTend++] = v;
  } else {
    memmove(tendencia, tendencia + 1, (N_TEND - 1) * sizeof(float));
    tendencia[N_TEND - 1] = v;
  }
  tendenciaCambio = true;
}

void actualizarPantalla(const DatosMonitor &d) {
  Estado e  = estadoDiuresis(d.diuresis);
  Estado eP = estadoDiuresis(previo.diuresis);
  bool cambioEstado = primeraVez || e != eP;

  char a[10], b[10];
  fmtDecimal(d.diuresis, 2, a, sizeof(a));
  fmtDecimal(previo.diuresis, 2, b, sizeof(b));
  bool cambioDiuresis = primeraVez || strcmp(a, b) != 0;

  if (primeraVez) tft->fillScreen(C_FONDO);

  if (cambioEstado) dibujarBarraLateral(e);

  if (primeraVez || strcmp(d.cama, previo.cama) || strcmp(d.paciente, previo.paciente) ||
      strcmp(d.modo, previo.modo))
    dibujarEncabezado(d);

  if (primeraVez || d.bateria != previo.bateria || d.cargando != previo.cargando)
    dibujarBateria(d.bateria, d.cargando);

  if (cambioDiuresis || cambioEstado) dibujarDiuresis(d.diuresis, e);

  if (tendenciaCambio || cambioEstado) {
    dibujarTendencia(e);
    tendenciaCambio = false;
  }

  if (primeraVez || fabsf(d.temperatura - previo.temperatura) >= 0.05f)
    dibujarTemperatura(d.temperatura);

  if (primeraVez || strcmp(d.colorNombre, previo.colorNombre) ||
      d.colR != previo.colR || d.colG != previo.colG || d.colB != previo.colB)
    dibujarColor(d.colorNombre, d.colR, d.colG, d.colB);

  if (primeraVez || d.volumenBolsa != previo.volumenBolsa ||
      d.capacidadBolsa != previo.capacidadBolsa)
    dibujarBolsa(d.volumenBolsa, d.capacidadBolsa);

  if (primeraVez || mascaraAlertas(d) != mascaraAlertas(previo))
    dibujarEtiquetas(d);

  previo = d;
  primeraVez = false;
}

// ============================================================ Setup / loop

void setup() {
  Serial.begin(115200);

  if (!tft->begin(VELOCIDAD_SPI)) {
    Serial.println("Error iniciando la pantalla");
  }

  // Valores iniciales (luego se reemplazan con las mediciones)
  strcpy(datos.cama, "UTI-04");
  strcpy(datos.paciente, "Quiroga, Beatriz");
  strcpy(datos.modo, "PILOTO");
  datos.bateria = 89;
  datos.cargando = true;
  datos.diuresis = 4.97;
  datos.temperatura = 36.8;
  strcpy(datos.colorNombre, "Transparente");
  datos.colR = 245; datos.colG = 243; datos.colB = 230;
  datos.volumenBolsa = 1244;
  datos.capacidadBolsa = 2000;

  agregarPuntoTendencia(datos.diuresis);
  actualizarPantalla(datos);
}

void loop() {
  static unsigned long tPantalla = 0, tTendencia = 0;
  unsigned long ahora = millis();

  if (ahora - tPantalla >= INTERVALO_PANTALLA_MS) {
    tPantalla = ahora;

#if MODO_DEMO
    // Valores simulados para probar la pantalla
    datos.diuresis     = constrain(datos.diuresis + random(-30, 31) / 100.0, 0.1, 6.0);
    datos.temperatura  = constrain(datos.temperatura + random(-2, 3) / 10.0, 36.0, 39.0);
    datos.volumenBolsa = min(datos.volumenBolsa + (int)random(0, 4), datos.capacidadBolsa);
#else
    // Aca cargar las mediciones reales, por ejemplo:
    // datos.diuresis     = calcularDiuresisHoraria() / pesoPaciente;
    // datos.temperatura  = leerTemperaturaNTC();
    // datos.volumenBolsa = leerVolumenCeldaCarga();
    // datos.bateria      = leerBateriaPct();
    // clasificarColor(datos.colorNombre, &datos.colR, &datos.colG, &datos.colB);
#endif

    actualizarPantalla(datos);
  }

  if (ahora - tTendencia >= INTERVALO_TENDENCIA_MS) {
    tTendencia = ahora;
    agregarPuntoTendencia(datos.diuresis);
    actualizarPantalla(datos);
  }
}
