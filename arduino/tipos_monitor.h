#pragma once
#include <Arduino.h>

// Tipos en un .h aparte: el IDE de Arduino genera prototipos de funciones
// automaticamente y los ubica antes de las definiciones del .ino, por eso
// los tipos tienen que estar declarados antes en un header.

struct DatosMonitor {
  char  cama[8];             // "UTI-04"
  char  paciente[24];        // "Quiroga, Beatriz"
  char  modo[8];             // "PILOTO" (vacio = sin etiqueta)
  int   bateria;             // %
  bool  cargando;
  float diuresis;            // mL/kg/h
  float temperatura;         // C
  char  colorNombre[16];     // "Transparente"
  uint8_t colR, colG, colB;  // color medido, para la muestra
  int   volumenBolsa;        // mL
  int   capacidadBolsa;      // mL
};

enum Estado { NORMAL, OLIGURIA, POLIURIA };

// Convierte RGB 8 bits a RGB565
constexpr uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}
