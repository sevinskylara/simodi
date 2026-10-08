/* ======================================================================
   pantalla.ino - Dibujo del display ILI9488 (480x320)
   Muestra diuresis, volumen (actual / total), temperatura, color y bateria.
   Solo se redibuja lo que cambio, para que no parpadee.
   ====================================================================== */

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
  uint16_t c = C_TENUE;
  if (isnan(v)) {
    strcpy(buf, "--,--");          // todavia no hay 10 min de datos
  } else {
    fmtDecimal(v, (v < 10) ? 2 : 1, buf, sizeof(buf));
    c = colorDiuresis(v);
  }
  int yb = DIU_Y + 90;
  texto(buf, DIU_X + 16, yb, &FreeMonoBold36pt7b, c);
  int xu = DIU_X + 16 + anchoTexto(buf, &FreeMonoBold36pt7b) + 16;
  texto("mL/kg/h", xu, yb, &FreeMono12pt7b, C_TENUE);
}

void dibujarTemperatura(float t) {
  tft->fillRect(TMP_X + 4, TMP_Y + 28, TMP_W - 8, TMP_H - 32, C_CAJA);

  char buf[8];
  uint16_t c = C_TEXTO;
  if (isnan(t)) {
    strcpy(buf, "--,-");           // sensor no disponible
    c = C_TENUE;
  } else {
    fmtDecimal(t, 1, buf, sizeof(buf));
    if (t >= UMBRAL_FIEBRE) c = C_ROJO;
  }
  int yb = TMP_Y + 62;
  texto(buf, TMP_X + 16, yb, &FreeMonoBold24pt7b, c);
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

  char ta[8], tb[8];
  fmtDecimal(d.temperatura, 1, ta, sizeof(ta));
  fmtDecimal(previo.temperatura, 1, tb, sizeof(tb));
  if (primeraVez || strcmp(ta, tb) != 0)
    dibujarTemperatura(d.temperatura);

  if (primeraVez || d.volumen != previo.volumen || d.capacidad != previo.capacidad)
    dibujarVolumen(d.volumen, d.capacidad);

  if (primeraVez || strcmp(d.colorNombre, previo.colorNombre) != 0)
    dibujarColor(d.colorNombre);

  previo = d;
  primeraVez = false;
}

