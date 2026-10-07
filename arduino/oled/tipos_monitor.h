#pragma once
#include <Arduino.h>

// Tipos en un .h aparte: el IDE de Arduino genera prototipos de funciones
// automaticamente y los ubica antes de las definiciones del .ino, por eso
// los tipos tienen que estar declarados antes en un header.

struct DatosMonitor {
  int   bateria;            // %
  bool  cargando;
  float diuresis;           // mL/kg/h
  float temperatura;        // C
  int   volumen;            // mL acumulados en la bolsa
  int   capacidad;          // mL totales de la bolsa (ej. 2000)
  char  colorNombre[16];    // "Transparente"
};

enum Estado { NORMAL, OLIGURIA, POLIURIA };

// Convierte RGB 8 bits a RGB565
constexpr uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}
