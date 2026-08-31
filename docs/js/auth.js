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

})();
