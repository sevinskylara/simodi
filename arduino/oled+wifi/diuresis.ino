/* ======================================================================
   diuresis.ino - Volumen acumulado y diuresis horaria
   Misma logica que la web, para que pantalla y central muestren lo mismo:
   - Se suman solo los aumentos de volumen.
   - Una caida de mas de 40 mL se toma como vaciado de bolsa (no resta).
   - Diuresis = lo que se acumulo en los ultimos 60 min / horas transcurridas.
     Hasta tener 10 min de datos no se calcula (se muestra "--").
   ====================================================================== */

const int   VENTANA_MIN  = 60;   // ventana de la diuresis horaria
const int   MINIMO_MIN   = 10;   // datos minimos para calcular
const float UMBRAL_VACIADO_ML = 40.0;

float volAnterior = -1;
float volTotal = 0;              // acumulado desde el arranque o la ultima tara

// Historial: un punto por minuto (volumen acumulado), 61 puntos = 60 min
float histVol[VENTANA_MIN + 1];
unsigned long histT[VENTANA_MIN + 1];
int nHist = 0;
unsigned long tUltimoPunto = 0;

void reiniciarDiuresis() {
  volAnterior = -1;
  volTotal = 0;
  nHist = 0;
}

void registrarVolumen(float vol, unsigned long ahora) {
  if (volAnterior >= 0) {
    float delta = vol - volAnterior;
    if (delta < -UMBRAL_VACIADO_ML) {
      Serial.println("Vaciado de bolsa detectado");
      delta = 0;
    }
    if (delta > 0) volTotal += delta;
  }
  volAnterior = vol;

  if (nHist == 0 || ahora - tUltimoPunto >= 60000UL) {
    if (nHist == VENTANA_MIN + 1) {          // se descarta el punto mas viejo
      memmove(histVol, histVol + 1, VENTANA_MIN * sizeof(float));
      memmove(histT, histT + 1, VENTANA_MIN * sizeof(unsigned long));
      nHist--;
    }
    histVol[nHist] = volTotal;
    histT[nHist] = ahora;
    nHist++;
    tUltimoPunto = ahora;
  }
}

float diuresisMlKgH(unsigned long ahora) {
  if (nHist == 0 || PESO_PACIENTE_KG <= 0) return NAN;
  float minutos = (ahora - histT[0]) / 60000.0;
  if (minutos < MINIMO_MIN) return NAN;
  float mlH = (volTotal - histVol[0]) / (minutos / 60.0);
  return max(0.0f, mlH) / PESO_PACIENTE_KG;
}
