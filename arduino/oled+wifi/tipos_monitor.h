#pragma once
#include <Arduino.h>

// Tipos en un .h aparte: el IDE de Arduino genera prototipos de funciones
// automaticamente y los ubica antes de las definiciones del .ino, por eso
// los tipos tienen que estar declarados antes en un header.

struct DatosMonitor {
  int   bateria;            // %
  bool  cargando;
  float diuresis;           // mL/kg/h (NAN = todavia no hay datos suficientes)
  float temperatura;        // C       (NAN = sensor no disponible)
  int   volumen;            // mL en la bolsa
  int   capacidad;          // mL totales de la bolsa (ej. 2000)
  char  colorNombre[16];    // "Transparente"
  uint8_t r, g, b;          // color medido (se manda a la web)
};

enum Estado { NORMAL, OLIGURIA, POLIURIA };

// Convierte RGB 8 bits a RGB565
constexpr uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}
