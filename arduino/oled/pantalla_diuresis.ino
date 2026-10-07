/*
 * Pantalla local - Sistema Inteligente de Monitoreo de Diuresis
 * ESP32-DevKitC + TFT SPI ILI9488 480x320 (modo 18 bits)
 * Version simplificada: diuresis, volumen (actual / total), temperatura,
 * color y bateria.
 *
 * Libreria: Arduino_GFX_Library (moononournation)
 * Las fuentes y tipos_monitor.h van en la misma carpeta del sketch.
 *
 * Conexiones:
 *   TFT_DC -> GPIO2   TFT_CS -> GPIO15   TFT_SCK -> GPIO18
 *   TFT_MOSI -> GPIO23   TFT_RST -> GPIO4   LED -> 3V3
 *
 * Uso: completar "datos" con las mediciones y llamar a actualizarPantalla(datos).
 * Solo se redibuja lo que cambio. No usar tildes ni enie en los textos.
 */

#include <Arduino_GFX_Library.h>
#include "FreeMono12pt7b.h"
#include "FreeMonoBold9pt7b.h"
#include "FreeMonoBold12pt7b.h"
#include "FreeMonoBold18pt7b.h"
#include "FreeMonoBold24pt7b.h"
#include "FreeMonoBold36pt7b.h"
#include "tipos_monitor.h"   // struct DatosMonitor, enum Estado, rgb()

// ------------------------------------------------------------------ Pines
#define TFT_DC    2
#define TFT_CS   15
#define TFT_SCK  18
#define TFT_MOSI 23
#define TFT_RST   4

#define VELOCIDAD_SPI 10000000

Arduino_DataBus *bus = new Arduino_ESP32SPI(TFT_DC, TFT_CS, TFT_SCK, TFT_MOSI, GFX_NOT_DEFINED);
Arduino_GFX *tft = new Arduino_ILI9488_18bit(bus, TFT_RST, 1 /* rotacion */, false);

// --------------------------------------------------------------- Umbrales
// Solo cambian el color del numero (no se muestran etiquetas)
const float UMBRAL_OLIGURIA = 0.5;   // mL/kg/h -> rojo
const float UMBRAL_POLIURIA = 3.0;   // mL/kg/h -> naranja
const float UMBRAL_FIEBRE   = 38.0;  // C       -> rojo
const int   UMBRAL_BATERIA  = 20;    // %       -> rojo

// --------------------------------------------------------------- Demo
#define MODO_DEMO 1                          // 0 = usar datos reales
const unsigned long INTERVALO_PANTALLA_MS = 1000;

// --------------------------------------------------------------- Colores
const uint16_t C_FONDO   = rgb(17, 23, 30);
const uint16_t C_CAJA    = rgb(13, 18, 24);
const uint16_t C_BORDE   = rgb(40, 48, 58);
const uint16_t C_TEXTO   = rgb(235, 240, 245);
const uint16_t C_TENUE   = rgb(150, 158, 168);
const uint16_t C_TEAL    = rgb(111, 211, 190);
const uint16_t C_NARANJA = rgb(232, 146, 74);
const uint16_t C_ROJO    = rgb(235, 92, 82);

// --------------------------------------------------------------- Layout
// Cajas: x, y, ancho, alto
const int DIU_X = 16,  DIU_Y = 46,  DIU_W = 448, DIU_H = 104;
const int VOL_X = 16,  VOL_Y = 158, VOL_W = 448, VOL_H = 74;
const int TMP_X = 16,  TMP_Y = 240, TMP_W = 180, TMP_H = 74;
const int COL_X = 206, COL_Y = 240, COL_W = 258, COL_H = 74;

DatosMonitor datos;
DatosMonitor previo;
bool primeraVez = true;

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

uint16_t colorDiuresis(float v) {
  switch (estadoDiuresis(v)) {
    case OLIGURIA: return C_ROJO;
    case POLIURIA: return C_NARANJA;
    default:       return C_TEXTO;
  }
}

void caja(int x, int y, int w, int h, const char *etiqueta, int yEtiqueta) {
  tft->fillRoundRect(x, y, w, h, 10, C_CAJA);
  tft->drawRoundRect(x, y, w, h, 10, C_BORDE);
  texto(etiqueta, x + 16, yEtiqueta, &FreeMonoBold9pt7b, C_TENUE);
}

// ============================================================ Secciones

void dibujarMarco() {
  tft->fillScreen(C_FONDO);
  caja(DIU_X, DIU_Y, DIU_W, DIU_H, "DIURESIS",    DIU_Y + 26);
  caja(VOL_X, VOL_Y, VOL_W, VOL_H, "VOLUMEN",     VOL_Y + 22);
  caja(TMP_X, TMP_Y, TMP_W, TMP_H, "TEMPERATURA", TMP_Y + 22);
  caja(COL_X, COL_Y, COL_W, COL_H, "COLOR",       COL_Y + 22);
}

void dibujarBateria(int pct, bool cargando) {
  tft->fillRect(300, 6, 180, 34, C_FONDO);

  char buf[6];
  snprintf(buf, sizeof(buf), "%d%%", pct);
  uint16_t c = (pct <= UMBRAL_BATERIA) ? C_ROJO : C_TEXTO;
  int wt = anchoTexto(buf, &FreeMonoBold12pt7b);
  int xt = 464 - wt;
  texto(buf, xt, 31, &FreeMonoBold12pt7b, c);

  // Icono
  const int w = 40, h = 20;
  int x = xt - w - 14, y = 13;
  tft->drawRoundRect(x, y, w, h, 4, C_TENUE);
  tft->drawRoundRect(x + 1, y + 1, w - 2, h - 2, 3, C_TENUE);
  tft->fillRect(x + w, y + 6, 4, 8, C_TENUE);
  int relleno = map(constrain(pct, 0, 100), 0, 100, 0, w - 8);
  tft->fillRect(x + 4, y + 4, relleno, h - 8, (pct <= UMBRAL_BATERIA) ? C_ROJO : C_TEAL);

  if (cargando) {   // rayo
    tft->fillTriangle(x + 23, y + 1, x + 13, y + 11, x + 21, y + 11, C_TEXTO);
    tft->fillTriangle(x + 19, y + 9, x + 27, y + 9, x + 17, y + 19, C_TEXTO);
  }
}

void dibujarDiuresis(float v) {
  tft->fillRect(DIU_X + 4, DIU_Y + 34, DIU_W - 8, DIU_H - 40, C_CAJA);

  char buf[10];
  fmtDecimal(v, (v < 10) ? 2 : 1, buf, sizeof(buf));
  int yb = DIU_Y + 90;
  texto(buf, DIU_X + 16, yb, &FreeMonoBold36pt7b, colorDiuresis(v));
  int xu = DIU_X + 16 + anchoTexto(buf, &FreeMonoBold36pt7b) + 16;
  texto("mL/kg/h", xu, yb, &FreeMono12pt7b, C_TENUE);
}

void dibujarTemperatura(float t) {
  tft->fillRect(TMP_X + 4, TMP_Y + 28, TMP_W - 8, TMP_H - 32, C_CAJA);

  char buf[8];
  fmtDecimal(t, 1, buf, sizeof(buf));
  int yb = TMP_Y + 62;
  texto(buf, TMP_X + 16, yb, &FreeMonoBold24pt7b, (t >= UMBRAL_FIEBRE) ? C_ROJO : C_TEXTO);
  int xg = TMP_X + 16 + anchoTexto(buf, &FreeMonoBold24pt7b) + 10;
  tft->drawCircle(xg, yb - 26, 3, C_TENUE);   // simbolo de grado
  tft->drawCircle(xg, yb - 26, 2, C_TENUE);
  texto("C", xg + 6, yb, &FreeMono12pt7b, C_TENUE);
}

// Muestra "actual / total mL", por ejemplo "1.244 / 2.000 mL"
void dibujarVolumen(int v, int cap) {
  tft->fillRect(VOL_X + 4, VOL_Y + 28, VOL_W - 8, VOL_H - 32, C_CAJA);

  char sv[10], sc[12];
  fmtMiles(v, sv, sizeof(sv));
  sc[0] = '/'; sc[1] = ' ';
  fmtMiles(cap, sc + 2, sizeof(sc) - 2);

  int yb = VOL_Y + 62;
  int x = VOL_X + 16;
  texto(sv, x, yb, &FreeMonoBold24pt7b, C_TEXTO);               // actual
  x += anchoTexto(sv, &FreeMonoBold24pt7b) + 16;
  texto(sc, x, yb, &FreeMonoBold24pt7b, C_TENUE);               // total
  x += anchoTexto(sc, &FreeMonoBold24pt7b) + 12;
  texto("mL", x, yb, &FreeMono12pt7b, C_TENUE);
}

// El tamano de letra se ajusta solo para que el nombre entre en la caja
void dibujarColor(const char *nombre) {
  tft->fillRect(COL_X + 4, COL_Y + 28, COL_W - 8, COL_H - 32, C_CAJA);

  char buf[16];
  strncpy(buf, nombre, 15); buf[15] = '\0';

  const int disponible = COL_W - 32;
  const GFXfont *f = &FreeMonoBold24pt7b;
  if (anchoTexto(buf, f) > disponible) f = &FreeMonoBold18pt7b;
  if (anchoTexto(buf, f) > disponible) f = &FreeMonoBold12pt7b;
  texto(buf, COL_X + 16, COL_Y + 60, f, C_TEXTO);
}

// ============================================================ API publica

void actualizarPantalla(const DatosMonitor &d) {
  if (primeraVez) dibujarMarco();

  if (primeraVez || d.bateria != previo.bateria || d.cargando != previo.cargando)
    dibujarBateria(d.bateria, d.cargando);

  char a[10], b[10];
  fmtDecimal(d.diuresis, 2, a, sizeof(a));
  fmtDecimal(previo.diuresis, 2, b, sizeof(b));
  if (primeraVez || strcmp(a, b) != 0)
    dibujarDiuresis(d.diuresis);

  if (primeraVez || fabsf(d.temperatura - previo.temperatura) >= 0.05f)
    dibujarTemperatura(d.temperatura);

  if (primeraVez || d.volumen != previo.volumen || d.capacidad != previo.capacidad)
    dibujarVolumen(d.volumen, d.capacidad);

  if (primeraVez || strcmp(d.colorNombre, previo.colorNombre) != 0)
    dibujarColor(d.colorNombre);

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
  datos.bateria = 89;
  datos.cargando = true;
  datos.diuresis = 1.25;
  datos.temperatura = 36.8;
  datos.volumen = 1244;
  datos.capacidad = 2000;
  strcpy(datos.colorNombre, "Transparente");

  actualizarPantalla(datos);
}

void loop() {
  static unsigned long tPantalla = 0;
  unsigned long ahora = millis();

  if (ahora - tPantalla >= INTERVALO_PANTALLA_MS) {
    tPantalla = ahora;

#if MODO_DEMO
    // Valores simulados para probar la pantalla
    datos.diuresis    = constrain(datos.diuresis + random(-30, 31) / 100.0, 0.1, 6.0);
    datos.temperatura = constrain(datos.temperatura + random(-2, 3) / 10.0, 36.0, 39.0);
    datos.volumen     = min(datos.volumen + (int)random(0, 4), datos.capacidad);
#else
    // Aca cargar las mediciones reales, por ejemplo:
    // datos.diuresis    = calcularDiuresisHoraria() / pesoPaciente;
    // datos.temperatura = leerTemperaturaNTC();
    // datos.volumen     = leerVolumenCeldaCarga();
    // datos.bateria     = leerBateriaPct();
    // strcpy(datos.colorNombre, clasificarColor());
#endif

    actualizarPantalla(datos);
  }
}
