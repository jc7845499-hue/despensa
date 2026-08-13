// Configuración de Firebase para sincronización entre dispositivos
const firebaseConfig = {
    apiKey: "AIzaSyDYJd_lMdv181P9mjs04C6qEo1A-E0WFaM",
    authDomain: "registrodespensa.firebaseapp.com",
    projectId: "registrodespensa",
    storageBucket: "registrodespensa.firebasestorage.app",
    messagingSenderId: "5408982159",
    appId: "1:5408982159:web:5c5aa852add2617a509cfa"
};

if (typeof window !== 'undefined' && window.firebaseSdk) {
    window.firebaseApp = window.firebaseSdk.initializeApp(firebaseConfig);
    window.firebaseDb = window.firebaseSdk.getFirestore();
}
