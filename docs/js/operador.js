/* =====================================================================
   operador.js · Quién hizo cada cambio.

   Antes se le preguntaba el nombre a cada persona al abrir la central.
   Ahora que entrar ya exige loguearse (auth.js, Firebase Auth), no hace
   falta preguntar de nuevo: el registro de auditoría usa directamente
   la identidad de la cuenta con la que se inició sesión.
   ===================================================================== */

var Operador = (function () {

  function actual() {
    try {
      if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
        var u = firebase.auth().currentUser;
        return u.displayName || u.email || 'Sistema';
      }
    } catch (e) { /* Firebase todavía no inicializó: se sella como Sistema */ }
    return 'Sistema';
  }

  return { actual: actual };
})();
