/* =========================================================
   SÍMODI · Autenticación de usuarios
   ========================================================= */

(function () {

  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyAmrqTZmaoIPb0bM6WqVw4x4I7Wbsa6UB0",
    authDomain: "simodi-9b9f9.firebaseapp.com",
    projectId: "simodi-9b9f9",
    storageBucket: "simodi-9b9f9.firebasestorage.app",
    messagingSenderId: "273629499703",
    appId: "1:273629499703:web:92842de021ad6c424a4ab2"
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }

  var auth = firebase.auth();

  window.SimodiAuth = {
    login: function (email, password) {
      return auth.signInWithEmailAndPassword(email, password);
    },

    logout: function () {
      return auth.signOut();
    },

    alCambiarEstado: function (callback) {
      auth.onAuthStateChanged(callback);
    }
  };

/* ================= FORMULARIO DE LOGIN ================= */

var formulario = document.getElementById('formLogin');
var pantalla = document.getElementById('authPantalla');
var emailInput = document.getElementById('authEmail');
var passwordInput = document.getElementById('authPassword');
var errorLogin = document.getElementById('authError');
var botonLogin = document.getElementById('btnLogin');

if (formulario) {

  formulario.addEventListener('submit', function (e) {

    e.preventDefault();

    errorLogin.textContent = '';
    botonLogin.disabled = true;
    botonLogin.textContent = 'INGRESANDO...';

    auth.signInWithEmailAndPassword(
      emailInput.value.trim(),
      passwordInput.value
    )
    .catch(function () {

      errorLogin.textContent = 'Correo o contraseña incorrectos.';
      botonLogin.disabled = false;
      botonLogin.textContent = 'INGRESAR';

    });

  });

}


/* =============== COMPROBAR SI HAY USUARIO =============== */

auth.onAuthStateChanged(function (usuario) {

  if (usuario) {

    /* Login correcto: ocultamos la pantalla */
    pantalla.classList.add('oculto');

  } else {

    /* Sin usuario: mostramos el login */
    pantalla.classList.remove('oculto');

    if (botonLogin) {
      botonLogin.disabled = false;
      botonLogin.textContent = 'INGRESAR';
    }

  }

});
   
})();
