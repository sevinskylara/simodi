/* =====================================================================
   operador.js · Quién está usando esta computadora.

   Es identidad de DISPOSITIVO, no de sistema: vive en una clave de
   localStorage propia, separada del resto del estado (Almacen), para que
   nunca se pise con una sincronización en la nube ni viaje entre compus.
   Cambiar de turno en la misma PC es tan simple como tocar el chip de
   arriba y escribir otro nombre.
   ===================================================================== */

var Operador = (function () {

  var CLAVE = 'simodi.operador.v1';
  var actual = null;

  function cargar() {
    try {
      var crudo = localStorage.getItem(CLAVE);
      actual = crudo ? JSON.parse(crudo) : null;
    } catch (e) { actual = null; }
    return actual;
  }

  function establecer(nombre, rol) {
    actual = { nombre: nombre.trim(), rol: rol || 'Otro', desde: Date.now() };
    try { localStorage.setItem(CLAVE, JSON.stringify(actual)); } catch (e) { }
    return actual;
  }

  function necesitaPreguntar() {
    return !actual || !actual.nombre;
  }

  /* Nombre para mostrar / para sellar eventos. 'Invitado' si nunca se cargó. */
  function nombreActual() {
    return actual && actual.nombre ? actual.nombre : 'Invitado';
  }

  cargar();

  return {
    cargar: cargar, establecer: establecer,
    necesitaPreguntar: necesitaPreguntar, actual: nombreActual,
    datos: function () { return actual; }
  };
})();
