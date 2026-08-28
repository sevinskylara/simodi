/* =====================================================================
   nube.js · Base de datos compartida (Firebase Firestore).

   Sin esto, cada navegador guarda sus propios datos en localStorage
   (como al principio) y esta central no ve lo que carga otra compu. Con
   esto activado, PACIENTES, CAMAS y el REGISTRO DE EVENTOS se sincronizan
   en tiempo real entre todas las computadoras que abran la página.

   Lo que NO se sincroniza (a propósito): las lecturas crudas del sensor
   (peso/temp/color cada pocos segundos). Eso sigue siendo local a cada
   navegador — sincronizar cada muestra superaría la cuota gratuita de
   Firestore en un día y no aporta nada en el modo piloto, que es una
   demo por computadora. El instrumento real, cuando esté conectado,
   también guarda su historial local; lo que viaja a la nube es sólo el
   "quién está en qué cama" y el registro de auditoría.

   Para activarlo: completar FIREBASE_CONFIG más abajo con los datos que
   da la consola de Firebase (Configuración del proyecto → tus apps →
   config del SDK). Esos valores son públicos por diseño (no son un
   secreto: quien vea el código de la página los ve igual), la seguridad
   real la dan las reglas de Firestore, no ocultar esta config.
   ===================================================================== */

var Nube = (function () {

  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyAmrqTZmaoIPb0bM6WqVw4x4I7Wbsa6UB0",
    authDomain: "simodi-9b9f9.firebaseapp.com",
    projectId: "simodi-9b9f9",
    storageBucket: "simodi-9b9f9.firebasestorage.app",
    messagingSenderId: "273629499703",
    appId: "1:273629499703:web:92842de021ad6c424a4ab2"
  };

  var SALA = 'principal';   // por si en el futuro conviven varias salas en el mismo proyecto
  var db = null, activo = false, aplicandoRemoto = false;
  var oyentesEstado = [];
  var cachePacientes = {}, cacheCamas = {}, idsEventosVistos = {};

  function configurado() {
    return FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'PENDIENTE';
  }

  function col(nombre) { return db.collection('salas').doc(SALA).collection(nombre); }

  function avisarEstado(estado, detalle) {
    oyentesEstado.forEach(function (f) { f(estado, detalle); });
  }
  function alCambiarEstado(f) { oyentesEstado.push(f); }

  /* handlers: { pacientes(map), camas(map), evento(ev) } */
  function iniciar(handlers) {
    if (!configurado()) { avisarEstado('sin-configurar'); return false; }
    if (typeof firebase === 'undefined') { avisarEstado('error', 'SDK de Firebase no cargó (¿sin internet?)'); return false; }

    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
      db.enablePersistence({ synchronizeTabs: true }).catch(function () { /* ya habilitado en otra pestaña: no pasa nada */ });
    } catch (e) {
      avisarEstado('error', e.message); return false;
    }

    avisarEstado('conectando');

    col('pacientes').onSnapshot(function (snap) {
      snap.docChanges().forEach(function (c) {
        var p = c.doc.data();
        p.id = c.doc.id;
        cachePacientes[p.id] = p;
      });
      aplicandoRemoto = true;
      handlers.pacientes(cachePacientes);
      aplicandoRemoto = false;
      activo = true; avisarEstado('conectado');
    }, function (err) { avisarEstado('error', err.message); });

    col('camas').onSnapshot(function (snap) {
      snap.docChanges().forEach(function (c) {
        if (c.type === 'removed') { delete cacheCamas[c.doc.id]; return; }
        var d = c.doc.data(); d.id = c.doc.id; cacheCamas[d.id] = d;
      });
      aplicandoRemoto = true;
      handlers.camas(cacheCamas);
      aplicandoRemoto = false;
    }, function (err) { avisarEstado('error', err.message); });

    col('eventos').orderBy('t', 'desc').limit(300).onSnapshot(function (snap) {
      var nuevos = [];
      snap.docChanges().forEach(function (c) {
        if (c.type !== 'added') return;
        if (idsEventosVistos[c.doc.id]) return;
        idsEventosVistos[c.doc.id] = true;
        var ev = c.doc.data(); ev.id = c.doc.id;
        nuevos.push(ev);
      });
      if (nuevos.length) { aplicandoRemoto = true; handlers.eventos(nuevos); aplicandoRemoto = false; }
    }, function (err) { avisarEstado('error', err.message); });

    return true;
  }

  function estaAplicandoRemoto() { return aplicandoRemoto; }

  /* --- escritura: todas "fire and forget", con caché offline de Firestore de por medio --- */

  function guardarPaciente(p) {
    if (!db || aplicandoRemoto) return;
    var copia = Object.assign({}, p); delete copia.id;
    col('pacientes').doc(p.id).set(copia, { merge: true }).catch(function (e) { console.warn('Nube: paciente no sincronizado', e); });
  }

  function guardarCama(cama) {
    if (!db || aplicandoRemoto) return;
    col('camas').doc(cama.id).set({
      etiqueta: cama.etiqueta, pacienteId: cama.pacienteId, dispositivoId: cama.dispositivoId
    }, { merge: true }).catch(function (e) { console.warn('Nube: cama no sincronizada', e); });
  }

  function guardarDispositivoMeta(d) {
    if (!db || aplicandoRemoto) return;
    col('dispositivos').doc(d.id).set({
      serie: d.serie, tipo: d.tipo, escenario: d.escenario
    }, { merge: true }).catch(function (e) { console.warn('Nube: dispositivo no sincronizado', e); });
  }

  function agregarEvento(ev) {
    if (!db || aplicandoRemoto) return;
    col('eventos').add({
      t: ev.t, camaId: ev.camaId || null, tipo: ev.tipo, texto: ev.texto, operador: ev.operador || null
    }).catch(function (e) { console.warn('Nube: evento no sincronizado', e); });
  }

  return {
    configurado: configurado, iniciar: iniciar, activo: function () { return activo; },
    aplicandoRemoto: estaAplicandoRemoto, alCambiarEstado: alCambiarEstado,
    guardarPaciente: guardarPaciente, guardarCama: guardarCama,
    guardarDispositivoMeta: guardarDispositivoMeta, agregarEvento: agregarEvento
  };
})();
