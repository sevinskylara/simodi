/* =========================================================
   SÍMODI · Autenticación de usuarios con Firebase
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


  /* Inicializar Firebase solamente si todavía no fue inicializado */

  if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }


  var auth = firebase.auth();


  /* ================= ELEMENTOS DE LA PANTALLA ================= */

  var formulario =
    document.getElementById('formLogin');

  var pantalla =
    document.getElementById('authPantalla');

  var emailInput =
    document.getElementById('authEmail');

  var passwordInput =
    document.getElementById('authPassword');

  var errorLogin =
    document.getElementById('authError');

  var botonLogin =
    document.getElementById('btnLogin');


  /* ================= FORMULARIO DE LOGIN ================= */

  if (formulario) {

    formulario.addEventListener(
      'submit',
      function (e) {

        e.preventDefault();

        errorLogin.textContent = '';

        botonLogin.disabled = true;

        botonLogin.textContent =
          'INGRESANDO...';


        auth.signInWithEmailAndPassword(
          emailInput.value.trim(),
          passwordInput.value
        )

        .catch(function (err) {

          console.error(
            'Error de autenticación:',
            err
          );


          if (
            err.code === 'auth/invalid-credential' ||
            err.code === 'auth/wrong-password' ||
            err.code === 'auth/user-not-found'
          ) {

            errorLogin.textContent =
              'Correo o contraseña incorrectos.';

          } else if (
            err.code === 'auth/too-many-requests'
          ) {

            errorLogin.textContent =
              'Demasiados intentos. Intentá nuevamente más tarde.';

          } else {

            errorLogin.textContent =
              'No se pudo iniciar sesión.';

          }


          botonLogin.disabled = false;

          botonLogin.textContent =
            'INGRESAR';

        });

      }
    );

  }


  /* ================= ESTADO DE AUTENTICACIÓN ================= */

  auth.onAuthStateChanged(
    function (usuario) {

      if (usuario) {

        /*
         * Firebase confirmó que existe una sesión válida.
         * Ocultamos el login.
         */

        if (pantalla) {
          pantalla.classList.add('oculto');
        }


        /*
         * Ahora recién arranca la central SÍMODI.
         *
         * __simodiIniciada evita que la inicialización ocurra
         * más de una vez en la misma página.
         */

        if (
          !window.__simodiIniciada &&
          typeof window.iniciarSimodi === 'function'
        ) {

          window.__simodiIniciada = true;

          window.iniciarSimodi();

        }

      } else {

        /*
         * No existe una sesión válida.
         * Se muestra la pantalla de login.
         */

        if (pantalla) {
          pantalla.classList.remove('oculto');
        }


        if (botonLogin) {

          botonLogin.disabled = false;

          botonLogin.textContent =
            'INGRESAR';

        }

      }

    }
  );


  /* ================= CERRAR SESIÓN ================= */

  window.cerrarSesionSimodi =
    function () {

      return auth
        .signOut()
        .then(function () {

          /*
           * Recargamos la página para limpiar la central
           * y volver a mostrar el login.
           */

          window.location.reload();

        });

    };
/* ================= BOTÓN CERRAR SESIÓN ================= */

var botonCerrarSesion =
  document.getElementById('btnCerrarSesion');

if (botonCerrarSesion) {

  botonCerrarSesion.addEventListener(
    'click',
    function () {

      window.cerrarSesionSimodi();

    }
  );

}

})();
