const USERS_KEY = 'despensaUsuarios';
const CURRENT_USER_KEY = 'despensaUsuarioActual';
const BASE_STORAGE_KEY = 'despensaProductos';
const BASE_PRICE_HISTORY_KEY = 'despensaHistorialPrecios';
const BASE_SAVED_LISTS_KEY = 'despensaListasGuardadas';
const BASE_FINALIZADO_KEY = 'despensaFinalizada';

let finalizado = false;
let pendingConfirmCallback = null;
let currentUser = null;
let productosCache = null;
let historialPreciosCache = null;
let savedListsCache = null;
let isRegisterMode = false;
let changePasswordTargetUser = null;

function getUserKey(baseKey, username) {
    const user = username || currentUser;
    if (!user) return baseKey;
    return baseKey + '_' + user;
}

function getUsuarios() {
    try {
        const data = localStorage.getItem(USERS_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.warn('Error leyendo usuarios de localStorage:', e);
        return [];
    }
}

async function syncUsuariosFromFirebase() {
    if (!window.firebaseDb) return;
    try {
        console.log('Sincronizando usuarios desde Firebase');
        const db = window.firebaseDb;
        const docRef = window.firebaseSdk.doc(db, 'despensa', 'usuarios');
        const docSnap = await window.firebaseSdk.getDoc(docRef);
        if (docSnap.exists() && docSnap.data().usuarios) {
            localStorage.setItem(USERS_KEY, JSON.stringify(docSnap.data().usuarios));
            console.log('Usuarios actualizados desde Firebase');
        } else {
            console.log('No hay usuarios en Firebase');
        }
    } catch (e) {
        console.warn('Error sincronizando usuarios desde Firebase:', e);
    }
}

async function saveUsuarios(usuarios) {
    localStorage.setItem(USERS_KEY, JSON.stringify(usuarios));
    if (window.firebaseDb && window.firebaseSdk) {
        try {
            const db = window.firebaseDb;
            const docRef = window.firebaseSdk.doc(db, 'despensa', 'usuarios');
            await window.firebaseSdk.setDoc(docRef, { usuarios }, { merge: true });
            console.log('Usuarios sincronizados a Firebase correctamente');
        } catch (e) {
            console.warn('Error sincronizando usuarios a Firebase:', e);
        }
    }
}

function getUsuarioActual() {
    return localStorage.getItem(CURRENT_USER_KEY);
}

function setUsuarioActual(username) {
    if (username) {
        localStorage.setItem(CURRENT_USER_KEY, username);
    } else {
        localStorage.removeItem(CURRENT_USER_KEY);
    }
}

function initDevToolsProtection() {
    let devtoolsOpen = false;
    const threshold = 160;
    setInterval(() => {
        const widthDiff = window.outerWidth - window.innerWidth;
        const heightDiff = window.outerHeight - window.innerHeight;
        const isOpen = widthDiff > threshold || heightDiff > threshold;
        if (isOpen !== devtoolsOpen) {
            devtoolsOpen = isOpen;
            if (isOpen) {
                document.body.style.filter = 'blur(8px)';
                document.title = 'Herramientas de desarrollo detectadas';
            } else {
                document.body.style.filter = '';
                document.title = 'Registro de Despensa';
            }
        }
    }, 500);
}

function initUserContext() {
    const username = getUsuarioActual();
    if (username) {
        currentUser = username;
        productosCache = null;
        historialPreciosCache = null;
        savedListsCache = null;
        finalizado = getFinalizado();
        return true;
    }
    return false;
}

async function generateSalt() {
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    return btoa(String.fromCharCode.apply(null, salt));
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return btoa(String(Math.abs(hash)));
}

async function hashPassword(password, saltBase64) {
    try {
        if (!crypto || !crypto.subtle) {
            return simpleHash(saltBase64 + password);
        }
        const encoder = new TextEncoder();
        const saltBytes = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0));
        const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
        const derivedBits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
            keyMaterial,
            256
        );
        const bytes = new Uint8Array(derivedBits);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    } catch (e) {
        console.warn('Fallo crypto.subtle, usando fallback:', e);
        return simpleHash(saltBase64 + password);
    }
}

async function migratePlaintextUsers() {
    const usuarios = getUsuarios();
    let changed = false;
    for (const u of usuarios) {
        if (u.password && !u.salt && !u.hash) {
            const salt = await generateSalt();
            const hash = await hashPassword(u.password, salt);
            u.salt = salt;
            u.hash = hash;
            delete u.password;
            u.rol = u.rol || 'usuario';
            changed = true;
        } else if (!u.rol) {
            u.rol = 'usuario';
            changed = true;
        }
    }
    if (changed) {
        await saveUsuarios(usuarios);
    }
}

function handleLoginSubmitWrapper() {
    handleLoginSubmit();
}

function showLogoutConfirm() {
    console.log('Mostrando confirmación de logout');
    console.log('doLogout existe en showLogoutConfirm:', typeof window.doLogout);
    pendingConfirmCallback = function() {
        console.log('Ejecutando callback de logout');
        console.log('doLogout existe en callback:', typeof window.doLogout);
        try {
            window.doLogout();
        } catch (e) {
            console.error('Error ejecutando doLogout desde callback:', e);
        }
    };
    showConfirmModal('¿Cerrar Sesión?', '¿Está seguro que desea cerrar sesión?');
}

function doLogout() {
    console.log('Iniciando logout');
    try {
        setUsuarioActual(null);
        currentUser = null;
        finalizado = false;
        productosCache = null;
        historialPreciosCache = null;
        savedListsCache = null;
        habilitarControles();
        ocultarBotonNuevaDespensa();
        limpiarInputs();
        renderProductos();
        actualizarBotonUsuario();
    } catch (e) {
        console.warn('Error limpiando interfaz en logout:', e);
    }
    setSyncStatus('local');
    const adminView = document.getElementById('admin-view');
    if (adminView) adminView.style.display = 'none';
    const confirmModal = document.getElementById('confirm-modal');
    if (confirmModal) confirmModal.style.display = 'none';
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
    const savedListsModal = document.getElementById('saved-lists-modal');
    if (savedListsModal) savedListsModal.style.display = 'none';
    const resumenModal = document.getElementById('resumen-modal');
    if (resumenModal) resumenModal.style.display = 'none';
    const changePassModal = document.getElementById('change-password-modal');
    if (changePassModal) changePassModal.style.display = 'none';
    showLoginScreen();
}

function showMessage(msg, type) {
    const msgEl = document.getElementById('message');
    const temp = document.createElement('div');
    temp.textContent = msg;
    msgEl.textContent = '';
    msgEl.appendChild(temp);
    msgEl.className = `message ${type}`;
    msgEl.style.display = 'block';
    setTimeout(() => msgEl.style.display = 'none', 5000);
}

function toggleRegisterMode() {
    isRegisterMode = !isRegisterMode;
    const title = document.getElementById('login-title');
    const submitBtn = document.getElementById('login-submit');
    const toggleBtn = document.getElementById('login-toggle-btn');
    const confirmGroup = document.getElementById('login-confirm-group');
    const errorEl = document.getElementById('login-error');
    if (isRegisterMode) {
        title.textContent = 'Crear Cuenta';
        submitBtn.textContent = 'Crear Cuenta';
        toggleBtn.textContent = 'Ya tengo cuenta';
        confirmGroup.style.display = 'block';
    } else {
        title.textContent = 'Iniciar Sesión';
        submitBtn.textContent = 'Iniciar Sesión';
        toggleBtn.textContent = 'Crear Cuenta';
        confirmGroup.style.display = 'none';
    }
    errorEl.style.display = 'none';
}

function handleLoginKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleLoginSubmit();
    }
}

async function handleLoginSubmit() {
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const confirmInput = document.getElementById('login-password-confirm');
    const errorEl = document.getElementById('login-error');
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    const confirm = confirmInput ? confirmInput.value.trim() : '';

    if (!username || !password) {
        errorEl.textContent = 'Ingrese usuario y contraseña';
        errorEl.style.display = 'block';
        return;
    }

    if (isRegisterMode) {
        if (password !== confirm) {
            errorEl.textContent = 'Las contraseñas no coinciden';
            errorEl.style.display = 'block';
            return;
        }
        await doRegister(username, password);
    } else {
        await doLogin(username, password);
    }
}

async function doLogin(username, password) {
    console.log('doLogin iniciado');
    const errorEl = document.getElementById('login-error');
    if (!username || !password) {
        errorEl.textContent = 'Ingrese usuario y contraseña';
        errorEl.style.display = 'block';
        return;
    }
    const usuarios = getUsuarios();
    const usuario = usuarios.find(u => u.username === username);
    if (!usuario || !usuario.salt || !usuario.hash) {
        errorEl.textContent = 'Usuario o contraseña incorrectos';
        errorEl.style.display = 'block';
        return;
    }
    try {
        const hash = await hashPassword(password, usuario.salt);
        if (hash !== usuario.hash) {
            errorEl.textContent = 'Usuario o contraseña incorrectos';
            errorEl.style.display = 'block';
            return;
        }
        setUsuarioActual(username);
        currentUser = username;
        productosCache = null;
        historialPreciosCache = null;
        savedListsCache = null;
        finalizado = getFinalizado();
        try {
            await syncFromFirebase();
        } catch (e) {
            console.warn('Error sincronizando desde Firebase en login:', e);
        }
        hideLoginScreen();
        if (!esAdmin()) {
            actualizarDatalists();
            renderProductos();
            actualizarBotonUsuario();
        }
    } catch (error) {
        console.error('Error en login:', error);
        errorEl.textContent = 'Error al iniciar sesión';
        errorEl.style.display = 'block';
    }
}

async function doRegister(username, password) {
    const errorEl = document.getElementById('login-error');
    if (!username || !password) {
        errorEl.textContent = 'Ingrese usuario y contraseña';
        errorEl.style.display = 'block';
        return;
    }
    if (password.length < 4) {
        errorEl.textContent = 'La contraseña debe tener al menos 4 caracteres';
        errorEl.style.display = 'block';
        return;
    }
    const usuarios = getUsuarios();
    if (usuarios.some(u => u.username === username)) {
        errorEl.textContent = 'El usuario ya existe';
        errorEl.style.display = 'block';
        return;
    }
    try {
        const salt = await generateSalt();
        const hash = await hashPassword(password, salt);
        usuarios.push({ username, salt, hash, rol: 'usuario' });
        saveUsuarios(usuarios);
        setUsuarioActual(username);
        currentUser = username;
        productosCache = null;
        historialPreciosCache = null;
        savedListsCache = null;
        finalizado = getFinalizado();
        try {
            await syncFromFirebase();
        } catch (e) {
            console.warn('Error sincronizando desde Firebase en registro:', e);
        }
        hideLoginScreen();
        if (!esAdmin()) {
            actualizarDatalists();
            renderProductos();
            actualizarBotonUsuario();
        }
    } catch (error) {
        console.error('Error en registro:', error);
        const errorMsg = error && error.message ? error.message : 'Error desconocido';
        errorEl.textContent = 'Error al crear la cuenta: ' + errorMsg;
        errorEl.style.display = 'block';
    }
}

function showChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    const errorEl = document.getElementById('change-password-error');
    errorEl.style.display = 'none';
    document.getElementById('change-password-old').value = '';
    document.getElementById('change-password-new').value = '';
    document.getElementById('change-password-confirm').value = '';
    modal.style.display = 'flex';
}

function closeChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    if (modal) modal.style.display = 'none';
    changePasswordTargetUser = null;
}

function showAdminChangePasswordModal(username) {
    changePasswordTargetUser = username;
    const modal = document.getElementById('change-password-modal');
    const title = document.getElementById('change-password-title');
    const errorEl = document.getElementById('change-password-error');
    title.textContent = username === currentUser ? 'Cambiar Mi Contraseña' : `Cambiar Contraseña de ${username}`;
    errorEl.style.display = 'none';
    document.getElementById('change-password-old').value = '';
    document.getElementById('change-password-new').value = '';
    document.getElementById('change-password-confirm').value = '';
    if (username === currentUser) {
        document.getElementById('change-password-old').disabled = false;
    } else {
        document.getElementById('change-password-old').disabled = true;
        document.getElementById('change-password-old').placeholder = 'No requerido para admin';
    }
    modal.style.display = 'flex';
}

async function confirmChangePassword() {
    const errorEl = document.getElementById('change-password-error');
    const oldPass = document.getElementById('change-password-old').value.trim();
    const newPass = document.getElementById('change-password-new').value.trim();
    const confirmPass = document.getElementById('change-password-confirm').value.trim();
    const target = changePasswordTargetUser || currentUser;

    if (!newPass || newPass.length < 4) {
        errorEl.textContent = 'La nueva contraseña debe tener al menos 4 caracteres';
        errorEl.style.display = 'block';
        return;
    }
    if (newPass !== confirmPass) {
        errorEl.textContent = 'Las contraseñas no coinciden';
        errorEl.style.display = 'block';
        return;
    }

    const usuarios = getUsuarios();
    const usuario = usuarios.find(u => u.username === target);
    if (!usuario) {
        errorEl.textContent = 'Usuario no encontrado';
        errorEl.style.display = 'block';
        return;
    }

    if (target !== currentUser) {
        try {
            const salt = await generateSalt();
            const hash = await hashPassword(newPass, salt);
            usuario.salt = salt;
            usuario.hash = hash;
            await saveUsuarios(usuarios);
            showMessage(`Contraseña de "${target}" actualizada`, 'success');
            closeChangePasswordModal();
        } catch (error) {
            console.error('Error cambiando contraseña desde admin:', error);
            errorEl.textContent = 'Error al cambiar la contraseña';
            errorEl.style.display = 'block';
        }
        return;
    }

    if (!oldPass) {
        errorEl.textContent = 'Ingresa tu contraseña actual';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const hash = await hashPassword(oldPass, usuario.salt);
        if (hash !== usuario.hash) {
            errorEl.textContent = 'Contraseña actual incorrecta';
            errorEl.style.display = 'block';
            return;
        }
        const salt = await generateSalt();
        const newHash = await hashPassword(newPass, salt);
        usuario.salt = salt;
        usuario.hash = newHash;
        await saveUsuarios(usuarios);
        showMessage('Contraseña actualizada correctamente', 'success');
        closeChangePasswordModal();
    } catch (error) {
        console.error('Error cambiando contraseña:', error);
        errorEl.textContent = 'Error al cambiar la contraseña';
        errorEl.style.display = 'block';
    }
}

function firebaseEnabled() {
    return typeof window !== 'undefined' && window.firebaseDb && currentUser;
}

function setSyncStatus(status) {
    const el = document.getElementById('sync-indicator');
    if (!el) return;
    el.className = 'sync-indicator ' + status;
    const texts = {
        synced: 'Sincronizado',
        saving: 'Guardando...',
        local: 'Local',
        error: 'Error de sincronización'
    };
    el.textContent = texts[status] || '';
}

async function firebaseGetUserDoc(field) {
    if (!firebaseEnabled()) return null;
    try {
        const db = window.firebaseDb;
        const docRef = window.firebaseSdk.doc(db, 'despensa', currentUser);
        console.log('firebaseGetUserDoc leyendo campo:', field, 'en documento:', docRef.path);
        const docSnap = await window.firebaseSdk.getDoc(docRef);
        if (docSnap.exists()) {
            const value = docSnap.data()[field];
            console.log('firebaseGetUserDoc valor leído:', value);
            return value;
        }
        console.log('firebaseGetUserDoc: documento no existe para', currentUser);
    } catch (e) {
        console.warn('Error leyendo Firebase:', e);
    }
    return null;
}

async function firebaseSetUserDoc(field, value) {
    if (!firebaseEnabled()) return;
    try {
        const db = window.firebaseDb;
        const docRef = window.firebaseSdk.doc(db, 'despensa', currentUser);
        await window.firebaseSdk.setDoc(docRef, { [field]: value }, { merge: true });
    } catch (e) {
        console.warn('Error escribiendo Firebase:', e);
    }
}

async function syncFromFirebase() {
    if (!firebaseEnabled()) return;
    try {
        const db = window.firebaseDb;
        const docRef = window.firebaseSdk.doc(db, 'despensa', currentUser);
        const docSnap = await window.firebaseSdk.getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.productos !== undefined) {
                localStorage.setItem(getUserKey(BASE_STORAGE_KEY), JSON.stringify(data.productos));
            }
            if (data.historialPrecios !== undefined) {
                localStorage.setItem(getUserKey(BASE_PRICE_HISTORY_KEY), JSON.stringify(data.historialPrecios));
            }
            if (data.listasGuardadas !== undefined) {
                localStorage.setItem(getUserKey(BASE_SAVED_LISTS_KEY), JSON.stringify(data.listasGuardadas));
            }
            if (data.finalizado !== undefined) {
                localStorage.setItem(getUserKey(BASE_FINALIZADO_KEY), data.finalizado ? 'true' : 'false');
            }
        }
    } catch (e) {
        console.warn('Error sincronizando desde Firebase:', e);
    }
}

function getProductos() {
    if (!currentUser) return [];
    try {
        const key = getUserKey(BASE_STORAGE_KEY);
        if (productosCache === null) {
            let data = localStorage.getItem(key);
            productosCache = data ? JSON.parse(data) : [];
        }
        if (productosCache.length === 0 && firebaseEnabled()) {
            firebaseGetUserDoc('productos').then(remote => {
                if (Array.isArray(remote)) {
                    if (productosCache.length === 0) {
                        productosCache = remote;
                        localStorage.setItem(key, JSON.stringify(remote));
                        renderProductos();
                        actualizarDatalists();
                    }
                }
            });
        }
        return productosCache;
    } catch (e) {
        productosCache = [];
        console.warn('Error leyendo productos de localStorage:', e);
        return [];
    }
}

function saveProductos(productos) {
    const key = getUserKey(BASE_STORAGE_KEY);
    productosCache = productos;
    localStorage.setItem(key, JSON.stringify(productos));
    syncToFirebase();
}

async function syncToFirebase() {
    if (!firebaseEnabled()) return;
    setSyncStatus('saving');
    try {
        const key = getUserKey(BASE_STORAGE_KEY);
        const productos = JSON.parse(localStorage.getItem(key) || '[]');
        const historial = JSON.parse(localStorage.getItem(getUserKey(BASE_PRICE_HISTORY_KEY)) || '{}');
        const listas = JSON.parse(localStorage.getItem(getUserKey(BASE_SAVED_LISTS_KEY)) || '[]');
        const finalizadoVal = localStorage.getItem(getUserKey(BASE_FINALIZADO_KEY)) === 'true';
        const db = window.firebaseDb;
        const docRef = window.firebaseSdk.doc(db, 'despensa', currentUser);
        await window.firebaseSdk.setDoc(docRef, {
            productos,
            historialPrecios: historial,
            listasGuardadas: listas,
            finalizado: finalizadoVal,
            updatedAt: window.firebaseSdk.serverTimestamp()
        }, { merge: true });
        setSyncStatus('synced');
    } catch (e) {
        console.warn('Error sincronizando a Firebase:', e);
        setSyncStatus('error');
    }
}

function getHistorialPrecios() {
    if (!currentUser) return {};
    try {
        if (historialPreciosCache === null) {
            let data = localStorage.getItem(getUserKey(BASE_PRICE_HISTORY_KEY));
            historialPreciosCache = data ? JSON.parse(data) : {};
        }
        if (Object.keys(historialPreciosCache).length === 0 && firebaseEnabled()) {
            firebaseGetUserDoc('historialPrecios').then(remote => {
                if (remote && typeof remote === 'object') {
                    if (Object.keys(historialPreciosCache).length === 0) {
                        historialPreciosCache = remote;
                        localStorage.setItem(getUserKey(BASE_PRICE_HISTORY_KEY), JSON.stringify(remote));
                    }
                }
            });
        }
        return historialPreciosCache;
    } catch (e) {
        historialPreciosCache = {};
        console.warn('Error leyendo historial de precios de localStorage:', e);
        return {};
    }
}

function saveHistorialPrecios(historial) {
    historialPreciosCache = historial;
    localStorage.setItem(getUserKey(BASE_PRICE_HISTORY_KEY), JSON.stringify(historial));
    syncToFirebase();
}

function getSavedLists() {
    if (!currentUser) return [];
    try {
        if (savedListsCache === null) {
            let data = localStorage.getItem(getUserKey(BASE_SAVED_LISTS_KEY));
            savedListsCache = data ? JSON.parse(data) : [];
        }
        if (savedListsCache.length === 0 && firebaseEnabled()) {
            firebaseGetUserDoc('listasGuardadas').then(remote => {
                if (Array.isArray(remote)) {
                    if (savedListsCache.length === 0) {
                        savedListsCache = remote;
                        localStorage.setItem(getUserKey(BASE_SAVED_LISTS_KEY), JSON.stringify(remote));
                    }
                }
            });
        }
        return savedListsCache;
    } catch (e) {
        savedListsCache = [];
        console.warn('Error leyendo listas guardadas de localStorage:', e);
        return [];
    }
}

function saveSavedLists(listas) {
    savedListsCache = listas;
    localStorage.setItem(getUserKey(BASE_SAVED_LISTS_KEY), JSON.stringify(listas));
    syncToFirebase();
}

function getFinalizado() {
    if (!currentUser) return false;
    try {
        let val = localStorage.getItem(getUserKey(BASE_FINALIZADO_KEY));
        if (val === null && firebaseEnabled()) {
            firebaseGetUserDoc('finalizado').then(remote => {
                if (remote !== null && remote !== undefined) {
                    if (localStorage.getItem(getUserKey(BASE_FINALIZADO_KEY)) === null) {
                        localStorage.setItem(getUserKey(BASE_FINALIZADO_KEY), remote ? 'true' : 'false');
                    }
                }
            });
        }
        return val === 'true';
    } catch (e) {
        console.warn('Error leyendo finalizado de localStorage:', e);
        return false;
    }
}

function setFinalizado(val) {
    if (!currentUser) return;
    localStorage.setItem(getUserKey(BASE_FINALIZADO_KEY), val ? 'true' : 'false');
    syncToFirebase();
}

function getTodosLosNombresProductos() {
    const nombres = new Set();
    const productos = getProductos();
    productos.forEach(p => {
        if (p.nombre && p.nombre.trim()) {
            nombres.add(p.nombre.trim());
        }
    });
    const listas = getSavedLists();
    listas.forEach(lista => {
        lista.productos.forEach(p => {
            if (p.nombre && p.nombre.trim()) {
                nombres.add(p.nombre.trim());
            }
        });
    });
    const historial = getHistorialPrecios();
    Object.keys(historial).forEach(nombre => {
        if (nombre && nombre.trim()) {
            nombres.add(nombre.trim());
        }
    });
    return Array.from(nombres).sort();
}

function actualizarDatalists() {
    const nombres = getTodosLosNombresProductos();
    const shoppingDatalist = document.getElementById('shopping-names');
    const productDatalist = document.getElementById('product-names');
    if (shoppingDatalist) {
        shoppingDatalist.innerHTML = nombres.map(n => `<option value="${escapeHtml(n)}">`).join('');
    }
    if (productDatalist) {
        productDatalist.innerHTML = nombres.map(n => `<option value="${escapeHtml(n)}">`).join('');
    }
}

function actualizarBotonUsuario() {
    try {
        if (esAdmin()) {
            return;
        }
        const btnUsuario = document.getElementById('btn-usuario');
        const btnCambiarPass = document.getElementById('btn-cambiar-pass');
        const btnNuevaDespensa = document.getElementById('new-pantry-btn');
        if (btnUsuario && btnCambiarPass && btnNuevaDespensa) {
            if (currentUser) {
                btnUsuario.style.display = 'inline-block';
                btnUsuario.textContent = 'Cerrar Sesión';
                btnCambiarPass.style.display = 'inline-block';
                btnNuevaDespensa.style.display = finalizado ? 'inline-block' : 'none';
            } else {
                btnUsuario.style.display = 'none';
                btnCambiarPass.style.display = 'none';
                btnNuevaDespensa.style.display = 'none';
            }
        }
        if (esAdmin()) {
            deshabilitarControlesAdmin();
        } else if (finalizado) {
            deshabilitarControles();
            mostrarBotonNuevaDespensa();
        } else {
            habilitarControles();
            ocultarBotonNuevaDespensa();
        }
    } catch (e) {
        console.warn('Error actualizando botones de usuario:', e);
    }
}

function esAdmin() {
    if (!currentUser) return false;
    const usuarios = getUsuarios();
    const usuario = usuarios.find(u => u.username === currentUser);
    return usuario && usuario.rol === 'admin';
}

function deshabilitarControlesAdmin() {
    const ids = [
        'shopping-name', 'shopping-qty', 'shopping-approx-price',
        'product-name', 'product-price', 'product-qty',
        'add-btn', 'btn-finalizar-registro'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
    });
    const shoppingBtns = document.querySelectorAll('#shopping-inputs button');
    shoppingBtns.forEach(btn => btn.disabled = true);
    const productList = document.getElementById('product-list');
    if (productList) {
        productList.innerHTML = '<p style="color: #999; text-align: center;">Los administradores no pueden modificar despensas</p>';
    }
    const totalPrice = document.getElementById('total-price');
    if (totalPrice) totalPrice.textContent = '$0.00';
    const totalApprox = document.getElementById('total-approx');
    if (totalApprox) totalApprox.style.display = 'none';
    const btnVerAnteriores = document.getElementById('btn-ver-anteriores');
    if (btnVerAnteriores) btnVerAnteriores.disabled = false;
}

async function crearUsuarioAdminSiNoExiste() {
    const usuarios = getUsuarios();
    const existe = usuarios.some(u => u.username === 'admin');
    if (!existe) {
        const salt = await generateSalt();
        const hash = await hashPassword('admin123', salt);
        usuarios.push({ username: 'admin', salt, hash, rol: 'admin' });
        saveUsuarios(usuarios);
    } else {
        let changed = false;
        usuarios.forEach(u => {
            if (u.username === 'admin' && u.rol !== 'admin') {
                u.rol = 'admin';
                changed = true;
            }
        });
        if (changed) saveUsuarios(usuarios);
    }
}

function getUsuariosParaAdmin() {
    const usuarios = getUsuarios();
    return usuarios.map(u => ({
        username: u.username,
        rol: u.rol || 'usuario'
    }));
}

async function eliminarUsuarioPorAdmin(username) {
    if (!esAdmin()) {
        showMessage('No tienes permisos de administrador', 'error');
        return;
    }
    if (username === currentUser) {
        showMessage('No puedes eliminarte a ti mismo', 'error');
        return;
    }
    let usuarios = getUsuarios();
    usuarios = usuarios.filter(u => u.username !== username);
    await saveUsuarios(usuarios);
    if (window.firebaseDb && window.firebaseSdk) {
        try {
            const db = window.firebaseDb;
            const docRef = window.firebaseSdk.doc(db, 'despensa', username);
            await window.firebaseSdk.deleteDoc(docRef);
        } catch (e) {
            console.error('Error eliminando documento de Firebase:', e);
            showMessage('Usuario eliminado localmente, pero hubo un error al eliminar sus datos en la nube', 'error');
        }
    }
    const usuarioActual = getUsuarioActual();
    if (usuarioActual === username) {
        doLogout();
    }
    actualizarBotonUsuario();
    renderizarPanelAdmin();
    showMessage(`Usuario "${username}" eliminado`, 'success');
}

async function crearUsuarioDesdeAdmin() {
    if (!esAdmin()) {
        showMessage('No tienes permisos de administrador', 'error');
        return;
    }
    const usernameInput = document.getElementById('admin-new-username');
    const passwordInput = document.getElementById('admin-new-password');
    const confirmInput = document.getElementById('admin-new-password-confirm');
    const errorEl = document.getElementById('admin-create-error');
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    const confirm = confirmInput ? confirmInput.value.trim() : '';

    if (!username || !password) {
        errorEl.textContent = 'Ingrese usuario y contraseña';
        errorEl.style.display = 'block';
        return;
    }

    if (password.length < 4) {
        errorEl.textContent = 'La contraseña debe tener al menos 4 caracteres';
        errorEl.style.display = 'block';
        return;
    }

    if (password !== confirm) {
        errorEl.textContent = 'Las contraseñas no coinciden';
        errorEl.style.display = 'block';
        return;
    }

    const usuarios = getUsuarios();
    if (usuarios.some(u => u.username === username)) {
        errorEl.textContent = 'El usuario ya existe';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const salt = await generateSalt();
        const hash = await hashPassword(password, salt);
        usuarios.push({ username, salt, hash, rol: 'usuario' });
        saveUsuarios(usuarios);
        usernameInput.value = '';
        passwordInput.value = '';
        if (confirmInput) confirmInput.value = '';
        errorEl.style.display = 'none';
        renderizarPanelAdmin();
        showMessage(`Usuario "${username}" creado`, 'success');
    } catch (error) {
        console.error('Error creando usuario:', error);
        errorEl.textContent = 'Error al crear el usuario';
        errorEl.style.display = 'block';
    }
}

function renderizarPanelAdmin() {
    const container = document.getElementById('admin-users-container');
    if (!container) return;
    container.innerHTML = '';
    const errorEl = document.getElementById('admin-create-error');
    if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }
    const usuarios = getUsuariosParaAdmin();
    if (usuarios.length === 0) {
        container.innerHTML = '<p style="color: #999; text-align: center;">No hay usuarios registrados</p>';
        return;
    }
    const table = document.createElement('table');
    table.style.cssText = 'width: 100%; border-collapse: collapse; margin-top: 10px;';
    const headerRow = document.createElement('tr');
    headerRow.style.cssText = 'border-bottom: 2px solid #1a73e8;';
    ['Usuario', 'Rol', 'Registros', 'Acción', 'Contraseña'].forEach(text => {
        const th = document.createElement('th');
        th.style.cssText = 'padding: 8px; text-align: center; border-right: 1px solid #ddd;';
        th.textContent = text;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);
    usuarios.forEach(u => {
        const row = document.createElement('tr');
        row.style.cssText = 'border-bottom: 1px solid #eee;';
        const esAdminUser = u.rol === 'admin';
        const usernameCell = document.createElement('td');
        usernameCell.style.cssText = 'padding: 8px; text-align: center; border-right: 1px solid #ddd;';
        usernameCell.textContent = u.username + (esAdminUser ? ' (tú)' : '');
        row.appendChild(usernameCell);
        const rolCell = document.createElement('td');
        rolCell.style.cssText = 'padding: 8px; text-align: center; border-right: 1px solid #ddd;';
        rolCell.textContent = esAdminUser ? 'Administrador' : 'Usuario';
        rolCell.style.color = esAdminUser ? '#1a73e8' : '#555';
        rolCell.style.fontWeight = esAdminUser ? 'bold' : 'normal';
        row.appendChild(rolCell);
        const registrosCell = document.createElement('td');
        registrosCell.style.cssText = 'padding: 8px; text-align: center; border-right: 1px solid #ddd;';
        const cantidadRegistros = getCantidadRegistrosUsuario(u.username);
        registrosCell.textContent = cantidadRegistros;
        row.appendChild(registrosCell);
        const actionCell = document.createElement('td');
        actionCell.style.cssText = 'padding: 8px; text-align: center;';
        if (!esAdminUser) {
            const btnEliminar = document.createElement('button');
            btnEliminar.className = 'red small';
            btnEliminar.textContent = 'Eliminar';
            btnEliminar.style.cssText = 'padding: 6px 12px; font-size: 12px;';
            btnEliminar.onclick = () => {
                pendingConfirmCallback = function() {
                    eliminarUsuarioPorAdmin(u.username);
                };
                showConfirmModal('¿Está seguro?', `¿Desea eliminar al usuario "${escapeHtml(u.username)}"?`);
            };
            actionCell.appendChild(btnEliminar);
        } else {
            actionCell.textContent = '-';
            actionCell.style.color = '#999';
        }
        row.appendChild(actionCell);
        const changePassCell = document.createElement('td');
        changePassCell.style.cssText = 'padding: 8px; text-align: center;';
        if (!esAdminUser) {
            const btnChangePass = document.createElement('button');
            btnChangePass.className = 'outline small';
            btnChangePass.textContent = 'Cambiar';
            btnChangePass.style.cssText = 'padding: 6px 12px; font-size: 12px;';
            btnChangePass.onclick = () => {
                showAdminChangePasswordModal(u.username);
            };
            changePassCell.appendChild(btnChangePass);
        } else {
            changePassCell.textContent = '-';
            changePassCell.style.color = '#999';
        }
        row.appendChild(changePassCell);
        table.appendChild(row);
    });
    container.appendChild(table);
}

function getCantidadRegistrosUsuario(username) {
    const listas = getSavedListsForUser(username);
    return listas.length;
}

function getSavedListsForUser(username) {
    const data = localStorage.getItem(getUserKey(BASE_SAVED_LISTS_KEY, username));
    return data ? JSON.parse(data) : [];
}

function limpiarInputs() {
    const ids = [
        'product-name', 'product-price', 'product-qty',
        'shopping-name', 'shopping-qty', 'shopping-approx-price'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = id === 'product-qty' || id === 'shopping-qty' ? '1' : '';
    });
    const approxEl = document.getElementById('total-approx');
    if (approxEl) approxEl.style.display = 'none';
}

function deshabilitarControles() {
    const ids = [
        'shopping-name', 'shopping-qty', 'shopping-approx-price',
        'product-name', 'product-price', 'product-qty',
        'add-btn', 'btn-finalizar-registro'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
    });
    const shoppingBtn = document.querySelector('#shopping-inputs button');
    if (shoppingBtn) shoppingBtn.disabled = true;
}

function habilitarControles() {
    const ids = [
        'shopping-name', 'shopping-qty', 'shopping-approx-price',
        'product-name', 'product-price', 'product-qty',
        'add-btn', 'btn-finalizar-registro'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = false;
    });
    const shoppingBtn = document.querySelector('#shopping-inputs button');
    if (shoppingBtn) shoppingBtn.disabled = false;
}

async function nuevaDespensa() {
    finalizado = false;
    setFinalizado(false);
    productosCache = null;
    localStorage.removeItem(getUserKey(BASE_STORAGE_KEY));
    habilitarControles();
    ocultarBotonNuevaDespensa();
    limpiarInputs();
    renderProductos();
    await syncToFirebase();
}

function mostrarBotonNuevaDespensa() {
    const btn = document.getElementById('new-pantry-btn');
    if (btn) btn.style.display = 'inline-block';
}

function ocultarBotonNuevaDespensa() {
    const btn = document.getElementById('new-pantry-btn');
    if (btn) btn.style.display = 'none';
}

function calcularTotal(productos) {
    return productos.reduce((sum, p) => {
        const precio = parseFloat(p.precio) || 0;
        const cant = p.cantidadReal || p.cantidad || 1;
        return sum + (precio * cant);
    }, 0);
}

function getPrecioAnterior(nombre) {
    const listas = getSavedLists();
    if (listas.length > 0) {
        const ultimaLista = listas[0];
        const producto = ultimaLista.productos.find(p => p.nombre.toLowerCase() === nombre.toLowerCase());
        if (producto && producto.precio) {
            return parseFloat(producto.precio);
        }
    }
    const historial = getHistorialPrecios();
    if (historial[nombre] !== undefined) {
        return historial[nombre];
    }
    return null;
}

function handleShoppingKeypress(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        agregarDesdeShopping();
    }
}

function handleProductKeypress(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        agregarProducto();
    }
}

function agregarDesdeShopping() {
    if (finalizado) {
        showMessage('El registro ha sido finalizado. Crea una nueva despensa.', 'error');
        return;
    }
    const nameInput = document.getElementById('shopping-name');
    const qtyInput = document.getElementById('shopping-qty');
    const approxInput = document.getElementById('shopping-approx-price');
    const nombre = nameInput.value.trim();
    const cantidad = parseInt(qtyInput.value.trim()) || 1;
    const precioAproxStr = approxInput.value.trim();
    const precioAprox = precioAproxStr ? parseFloat(precioAproxStr) : null;

    if (!nombre) {
        showMessage('Ingrese el nombre del producto', 'error');
        return;
    }

    if (cantidad < 1) {
        showMessage('La cantidad debe ser al menos 1', 'error');
        return;
    }

    if (precioAprox !== null && (isNaN(precioAprox) || precioAprox < 0)) {
        showMessage('Ingrese un precio aproximado válido', 'error');
        return;
    }

    const productos = getProductos();
    const existe = productos.some(p => p.nombre.toLowerCase() === nombre.toLowerCase());
    if (existe) {
        showMessage('Este producto ya está en la lista', 'error');
        nameInput.value = '';
        qtyInput.value = '1';
        approxInput.value = '';
        return;
    }

    productos.push({
        id: Date.now(),
        nombre,
        precio: '',
        cantidad,
        cantidadReal: cantidad,
        precioAprox: precioAprox !== null ? precioAprox.toFixed(2) : null,
        cambio: 0,
        pendiente: true
    });
    saveProductos(productos);
    nameInput.value = '';
    qtyInput.value = '1';
    approxInput.value = '';
    actualizarDatalists();
    renderProductos();
}

function agregarProducto() {
    if (finalizado) {
        showMessage('El registro ha sido finalizado. Crea una nueva despensa.', 'error');
        return;
    }
    const nameInput = document.getElementById('product-name');
    const priceInput = document.getElementById('product-price');
    const qtyInput = document.getElementById('product-qty');
    const nombre = nameInput.value.trim();
    const precioStr = priceInput.value.trim();
    const cantidadStr = qtyInput.value.trim();
    const cantidad = parseInt(cantidadStr) || 1;

    if (!nombre) {
        showMessage('Ingrese el nombre del producto', 'error');
        return;
    }

    if (cantidad < 1) {
        showMessage('La cantidad debe ser al menos 1', 'error');
        return;
    }

    const precio = parseFloat(precioStr);
    if (isNaN(precio) || precio < 0) {
        showMessage('Ingrese un precio válido', 'error');
        return;
    }

    const precioAnterior = getPrecioAnterior(nombre);
    let cambio = 0;
    let mensajeCambio = '';

    if (precioAnterior !== null) {
        cambio = precio - precioAnterior;
        if (cambio > 0) {
            mensajeCambio = `Precio subió $${cambio.toFixed(2)} por unidad (anterior: $${precioAnterior.toFixed(2)} → $${precio.toFixed(2)})`;
        } else if (cambio < 0) {
            mensajeCambio = `Precio bajó $${Math.abs(cambio).toFixed(2)} por unidad (anterior: $${precioAnterior.toFixed(2)} → $${precio.toFixed(2)})`;
        } else {
            mensajeCambio = `El precio no cambió ($$${precio.toFixed(2)} por unidad)`;
        }
    } else {
        mensajeCambio = `Nuevo producto registrado ($$${precio.toFixed(2)} por unidad)`;
    }

    const productos = getProductos();
    const idx = productos.findIndex(p => p.nombre.toLowerCase() === nombre.toLowerCase());
    const cantidadReal = parseInt(cantidadStr) || 1;

    if (idx !== -1) {
        productos[idx].precio = precio.toFixed(2);
        productos[idx].cambio = cambio;
        productos[idx].pendiente = false;
        productos[idx].cantidadReal = cantidadReal;
    } else {
        productos.push({
            id: Date.now(),
            nombre,
            precio: precio.toFixed(2),
            cantidad,
            cantidadReal,
            cambio,
            pendiente: false
        });
    }
    const esNuevo = idx === -1;
    saveProductos(productos);
    renderProductos();

    nameInput.value = '';
    priceInput.value = '';
    qtyInput.value = '1';
    if (esNuevo) {
        actualizarDatalists();
    }
    showMessage(mensajeCambio, cambio !== 0 ? (cambio > 0 ? 'error' : 'success') : 'success');
}

function eliminarProducto(id) {
    const productos = getProductos();
    const index = productos.findIndex(p => p.id === id);
    if (index !== -1) {
        productos.splice(index, 1);
        saveProductos(productos);
        actualizarDatalists();
        renderProductos();
        showMessage('Producto eliminado', 'success');
    }
}

function confirmarEliminarProducto(id) {
    pendingConfirmCallback = function() {
        eliminarProducto(id);
    };
    showConfirmModal('¿Está seguro?', '¿Desea eliminar este producto de la lista?');
}

function renderProductos() {
    const productos = getProductos();
    const listEl = document.getElementById('product-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (productos.length === 0) {
        const p = document.createElement('p');
        p.style.cssText = 'color: #999; text-align: center;';
        p.textContent = 'No hay productos registrados';
        listEl.appendChild(p);
    } else {
        productos.forEach(p => {
            const cantidad = p.cantidad || 1;
            const cantidadReal = p.cantidadReal || cantidad;
            const precioVal = p.precio ? parseFloat(p.precio) : 0;
            const precioDisplay = p.precio
                ? `$${precioVal.toFixed(2)} x${cantidadReal === 1 ? '' : ' ' + cantidadReal}`
                : 'Pendiente...';
            const lineTotal = p.precio ? `(Total: $${(precioVal * cantidadReal).toFixed(2)})` : '';
            const changeSymbol = p.cambio > 0 ? '▲' : (p.cambio < 0 ? '▼' : '=');
            const changeText = !p.cambio
                ? ''
                : `${changeSymbol} ${Math.abs(p.cambio).toFixed(2)} (${p.cambio > 0 ? 'subió' : 'bajó'})`;
            const hasChange = p.cambio !== 0 && p.cambio !== undefined;
            const pendingBadge = p.pendiente ? 'Pendiente' : '';
            const approxText = p.precioAprox ? `(Aprox: $${parseFloat(p.precioAprox).toFixed(2)} /unidad x${cantidad === 1 ? '' : ' ' + cantidad}${p.precio ? ` | Real: $${precioVal.toFixed(2)} /unidad x${cantidadReal === 1 ? '' : ' ' + cantidadReal}` : ''})` : '';

            const item = document.createElement('div');
            item.className = 'product-item';

            const infoDiv = document.createElement('div');
            infoDiv.style.cssText = 'flex: 1;';

            const nameDiv = document.createElement('div');
            nameDiv.className = 'product-name';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = p.nombre + ' ';
            const qtySpan = document.createElement('span');
            qtySpan.className = 'qty-display';
            qtySpan.textContent = `x${cantidad}`;
            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'pending-badge';
            badgeSpan.textContent = pendingBadge;
            nameDiv.appendChild(nameSpan);
            nameDiv.appendChild(document.createTextNode(' '));
            nameDiv.appendChild(qtySpan);
            if (pendingBadge) nameDiv.appendChild(badgeSpan);

            infoDiv.appendChild(nameDiv);

            if (approxText) {
                const approxDiv = document.createElement('div');
                approxDiv.className = 'approx-price';
                approxDiv.textContent = approxText;
                infoDiv.appendChild(approxDiv);
            }

            const metaDiv = document.createElement('div');
            metaDiv.style.cssText = 'display: flex; align-items: center; flex-wrap: wrap; gap: 6px;';

            const priceSpan = document.createElement('span');
            priceSpan.className = 'product-price';
            priceSpan.textContent = precioDisplay;
            metaDiv.appendChild(priceSpan);

            if (p.precio) {
                const totalSpan = document.createElement('span');
                totalSpan.className = 'line-total';
                totalSpan.textContent = lineTotal;
                metaDiv.appendChild(totalSpan);
            }

            if (hasChange) {
                const changeSpan = document.createElement('span');
                changeSpan.className = `price-change ${p.cambio === 0 ? 'price-same' : (p.cambio > 0 ? 'price-up' : 'price-down')}`;
                changeSpan.textContent = changeText;
                metaDiv.appendChild(changeSpan);
            }

            infoDiv.appendChild(metaDiv);
            item.appendChild(infoDiv);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-btn';
            removeBtn.textContent = '✕';
            removeBtn.onclick = () => confirmarEliminarProducto(p.id);
            item.appendChild(removeBtn);

            listEl.appendChild(item);
        });
    }

    document.getElementById('total-price').textContent = `$${calcularTotal(productos).toFixed(2)}`;
    actualizarSumaAproximada();
}

function actualizarSumaAproximada() {
    const productos = getProductos();
    const sumaAproximada = productos.reduce((sum, p) => {
        const aprox = p.precioAprox ? parseFloat(p.precioAprox) : 0;
        const cantidad = p.cantidad || 1;
        return sum + (isNaN(aprox) ? 0 : aprox * cantidad);
    }, 0);
    const el = document.getElementById('total-approx');
    if (el) {
        if (sumaAproximada > 0) {
            el.style.display = 'block';
            el.textContent = `Suma aproximada estimada: $${sumaAproximada.toFixed(2)}`;
        } else {
            el.style.display = 'none';
        }
    }
}

function confirmarFinalizarCompleto() {
    const productos = getProductos();
    if (productos.length === 0) {
        showMessage('No hay productos en la lista', 'error');
        return;
    }
    const pendientes = productos.filter(p => p.pendiente || !p.precio);
    let mensaje = 'Una vez finalizado, no podrá agregar más productos.';
    if (pendientes.length > 0) {
        const items = pendientes.map(p => `<li>${escapeHtml(p.nombre)}</li>`).join('');
        mensaje = `Hay productos pendientes por surtir:<br><ul style="text-align:left; display:inline-block;">${items}</ul><br>Una vez finalizado, no podrá agregar más productos.`;
    }
    pendingConfirmCallback = function() {
        finalizarRegistroCompleto();
    };
    showConfirmModal('¿Seguro que desea finalizar el registro?', mensaje);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showConfirmModal(title, message) {
    document.getElementById('confirm-title').textContent = title;
    const messageEl = document.getElementById('confirm-message');
    messageEl.textContent = '';
    const temp = document.createElement('div');
    temp.innerHTML = message;
    messageEl.innerHTML = temp.innerHTML || '';
    
    const modal = document.getElementById('confirm-modal');
    modal.style.display = 'flex';
    
    const clickHandler = (e) => {
        if (e.target === modal) {
            console.log('Clic fuera del modal de confirmación, cerrando');
            confirmarNo();
        }
    };
    modal.addEventListener('click', clickHandler);
    modal._outsideClickHandler = clickHandler;
}

function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (modal && modal._outsideClickHandler) {
        modal.removeEventListener('click', modal._outsideClickHandler);
        modal._outsideClickHandler = null;
    }
    if (modal) modal.style.display = 'none';
    pendingConfirmCallback = null;
}

async function confirmarSi() {
    const cb = pendingConfirmCallback;
    console.log('confirmarSi llamado, callback:', typeof cb);
    closeConfirmModal();
    if (cb) {
        console.log('Ejecutando callback de confirmación');
        try {
            await cb();
        } catch (e) {
            console.error('Error en callback de confirmación:', e);
        }
    } else {
        console.warn('No hay callback de confirmación');
    }
}

function confirmarNo() {
    closeConfirmModal();
}

function showResumenModal(bodyHtml) {
    document.getElementById('resumen-title').textContent = 'Resumen de Despensa';
    const bodyEl = document.getElementById('resumen-body');
    bodyEl.textContent = '';
    const temp = document.createElement('div');
    temp.innerHTML = bodyHtml;
    bodyEl.textContent = temp.textContent || '';
    document.getElementById('resumen-modal').style.display = 'flex';
}

function closeResumenModal() {
    document.getElementById('resumen-modal').style.display = 'none';
}

function showLoginScreen() {
    const loginScreen = document.getElementById('login-screen');
    const app = document.getElementById('app');
    const adminView = document.getElementById('admin-view');
    const confirmModal = document.getElementById('confirm-modal');
    const savedListsModal = document.getElementById('saved-lists-modal');
    const resumenModal = document.getElementById('resumen-modal');
    
    if (loginScreen) {
        loginScreen.style.display = 'flex';
        loginScreen.style.visibility = 'visible';
        loginScreen.style.opacity = '1';
    }
    if (app) app.style.display = 'none';
    if (adminView) adminView.style.display = 'none';
    if (confirmModal) confirmModal.style.display = 'none';
    if (savedListsModal) savedListsModal.style.display = 'none';
    if (resumenModal) resumenModal.style.display = 'none';
    
    setSyncStatus('local');
    pendingConfirmCallback = null;
    
    const body = document.body;
    if (body) {
        body.style.overflow = 'auto';
    }
    
    setTimeout(() => {
        if (loginScreen) {
            loginScreen.style.display = 'flex';
            loginScreen.style.visibility = 'visible';
            loginScreen.style.opacity = '1';
        }
        if (app) app.style.display = 'none';
        if (adminView) adminView.style.display = 'none';
        if (confirmModal) confirmModal.style.display = 'none';
        if (savedListsModal) savedListsModal.style.display = 'none';
        if (resumenModal) resumenModal.style.display = 'none';
    }, 50);
}

function hideLoginScreen() {
    const loginScreen = document.getElementById('login-screen');
    const app = document.getElementById('app');
    const adminView = document.getElementById('admin-view');
    const confirmModal = document.getElementById('confirm-modal');
    const savedListsModal = document.getElementById('saved-lists-modal');
    const resumenModal = document.getElementById('resumen-modal');
    
    if (loginScreen) loginScreen.style.display = 'none';
    if (confirmModal) confirmModal.style.display = 'none';
    if (savedListsModal) savedListsModal.style.display = 'none';
    if (resumenModal) resumenModal.style.display = 'none';
    
    if (esAdmin()) {
        if (app) app.style.display = 'none';
        if (adminView) adminView.style.display = 'block';
        renderizarPanelAdmin();
    } else {
        if (app) app.style.display = 'block';
        if (adminView) adminView.style.display = 'none';
    }

    if (firebaseEnabled()) {
        setSyncStatus('synced');
    } else {
        setSyncStatus('local');
    }
}

function finalizarRegistroCompleto() {
    finalizado = true;
    setFinalizado(true);
    deshabilitarControles();
    mostrarBotonNuevaDespensa();
    const productos = getProductos();
    const productosConPrecio = productos.filter(p => p.precio && !isNaN(parseFloat(p.precio)));

    if (productosConPrecio.length === 0) {
        showMessage('No hay productos con precio registrado', 'error');
        finalizado = false;
        habilitarControles();
        return;
    }

    const productosConCambio = productosConPrecio.map(p => {
        const precioAnterior = getPrecioAnterior(p.nombre);
        let cambio = 0;
        if (precioAnterior !== null) {
            cambio = parseFloat(p.precio) - precioAnterior;
        }
        return { ...p, cambio, precioAnterior: precioAnterior };
    });

    const total = calcularTotal(productosConPrecio);
    const listaGuardada = {
        id: Date.now(),
        fecha: new Date().toLocaleString('es-ES'),
        productos: productosConCambio,
        total
    };

    const listas = getSavedLists();
    listas.unshift(listaGuardada);
    if (listas.length > 50) listas.pop();
    saveSavedLists(listas);

    localStorage.removeItem(getUserKey(BASE_STORAGE_KEY));
    limpiarInputs();
    syncToFirebase();

    let resumen = `<p><strong>¡Despensa finalizada!</strong></p>`;
    resumen += `<p><strong>Total a pagar: $${total.toFixed(2)}</strong></p>`;
    const cambios = productosConCambio.filter(p => p.cambio !== 0);
    if (cambios.length > 0) {
        resumen += `<p><strong>Comparación de precios (por unidad):</strong></p><ul>`;
        cambios.forEach(p => {
            const dir = p.cambio > 0 ? 'subió' : 'bajó';
            const anteriorStr = p.precioAnterior !== null ? `$${p.precioAnterior.toFixed(2)}` : 'sin registro anterior';
            resumen += `<li>${p.nombre}: ${dir} $${Math.abs(p.cambio).toFixed(2)} (${anteriorStr} → $${parseFloat(p.precio).toFixed(2)})</li>`;
        });
        resumen += `</ul>`;
    } else {
        resumen += `<p><em>Primera compra de todos los productos</em></p>`;
    }

    showResumenModal(resumen);

    setTimeout(() => {
        renderProductos();
    }, 5500);
}

function toggleSavedLists() {
    const modal = document.getElementById('saved-lists-modal');
    modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    if (modal.style.display === 'flex') {
        renderSavedLists();
    }
}

function closeSavedLists() {
    document.getElementById('saved-lists-modal').style.display = 'none';
}

function limpiarHistorialDespensas() {
    localStorage.removeItem(getUserKey(BASE_SAVED_LISTS_KEY));
    saveSavedLists([]);
    renderSavedLists();
    showMessage('Historial de despensas eliminado', 'success');
}

function eliminarDespensaGuardada(id) {
    const listas = getSavedLists();
    const nuevasListas = listas.filter(l => l.id !== id);
    saveSavedLists(nuevasListas);
    renderSavedLists();
    actualizarDatalists();
    showMessage('Registro eliminado', 'success');
}

function confirmarEliminarDespensa(id) {
    closeSavedLists();
    pendingConfirmCallback = function() {
        eliminarDespensaGuardada(id);
    };
    showConfirmModal('¿Está seguro?', '¿Desea eliminar este registro de despensa?');
}

function renderSavedLists() {
    const listas = getSavedLists();
    const container = document.getElementById('saved-lists-container');
    container.innerHTML = '';

    if (listas.length === 0) {
        container.classList.remove('saved-lists-scroll--scroll');
        container.classList.add('saved-lists-scroll');
        const p = document.createElement('p');
        p.style.cssText = 'color: #999;';
        p.textContent = 'No hay despensas anteriores';
        container.appendChild(p);
    } else {
        container.classList.remove('saved-lists-scroll');
        if (listas.length >= 3) {
            container.classList.add('saved-lists-scroll--scroll');
        }
        listas.forEach(lista => {
            const item = document.createElement('div');
            item.className = 'saved-list-item';

            const title = document.createElement('h3');
            title.textContent = `Despensa del ${lista.fecha}`;

            const date = document.createElement('div');
            date.className = 'date';
            date.textContent = lista.fecha;

            const total = document.createElement('div');
            total.className = 'total';
            total.textContent = `Total: $${lista.total.toFixed(2)}`;

            item.appendChild(title);
            item.appendChild(date);
            item.appendChild(total);
            item.onclick = () => verDespensaGuardada(lista.id);
            container.appendChild(item);
        });

        const btnLimpiar = document.createElement('button');
        btnLimpiar.className = 'red small';
        btnLimpiar.textContent = 'Limpiar historial';
        btnLimpiar.style.marginTop = '10px';
        btnLimpiar.onclick = function() {
            pendingConfirmCallback = function() {
                limpiarHistorialDespensas();
            };
            showConfirmModal('¿Está seguro?', 'Esta acción eliminará todas las despensas anteriores guardadas.');
        };
        container.appendChild(btnLimpiar);
    }
}

        function volverALista() {
            const modal = document.getElementById('saved-lists-modal');
            modal.innerHTML = '';
            const content = document.createElement('div');
            content.className = 'modal-content';

            const closeBtn = document.createElement('span');
            closeBtn.className = 'modal-close';
            closeBtn.textContent = '×';
            closeBtn.onclick = closeSavedLists;
            content.appendChild(closeBtn);

            const title = document.createElement('h2');
            title.style.cssText = 'margin-bottom: 15px;';
            title.textContent = 'Despensas Anteriores';
            content.appendChild(title);

            const container = document.createElement('div');
            container.id = 'saved-lists-container';
            content.appendChild(container);

            modal.appendChild(content);
            renderSavedLists();
        }

        function verDespensaGuardada(id) {
            const listas = getSavedLists();
            const lista = listas.find(l => l.id === id);
            if (!lista) return;

            const modal = document.getElementById('saved-lists-modal');
            modal.innerHTML = '';
            const content = document.createElement('div');
            content.className = 'modal-content';

            const closeBtn = document.createElement('span');
            closeBtn.className = 'modal-close';
            closeBtn.textContent = '×';
            closeBtn.onclick = closeSavedLists;
            content.appendChild(closeBtn);

            const title = document.createElement('h2');
            title.style.cssText = 'margin-bottom: 15px;';
            title.textContent = `Despensa del ${lista.fecha}`;
            content.appendChild(title);

            const totalP = document.createElement('p');
            totalP.style.cssText = 'margin-bottom:15px;';
            const strong = document.createElement('strong');
            strong.textContent = `Total a pagar: $${lista.total.toFixed(2)}`;
            totalP.appendChild(strong);
            content.appendChild(totalP);

            const scrollDiv = document.createElement('div');
            scrollDiv.className = 'saved-lists-scroll';
            scrollDiv.style.cssText = 'max-height: 60vh; overflow-y: auto; text-align: left;';

            const table = document.createElement('table');
            table.style.cssText = 'width:100%; border-collapse: collapse;';

            const headerRow = document.createElement('tr');
            headerRow.style.cssText = 'border-bottom: 2px solid #1a73e8;';
            const headers = ['Producto', 'Cant.', 'Precio Unit.', 'Total', 'Cambio'];
            headers.forEach((text, index) => {
                const th = document.createElement('th');
                th.align = 'center';
                th.style.cssText = `border-right: 2px solid #ddd; padding: 8px 6px;`;
                if (index === headers.length - 1) th.style.borderRight = 'none';
                th.textContent = text;
                headerRow.appendChild(th);
            });
            table.appendChild(headerRow);

            lista.productos.forEach(p => {
                const precio = p.precio ? parseFloat(p.precio).toFixed(2) : '-';
                const cant = p.cantidadReal || p.cantidad || 1;
                const lineTotal = p.precio ? (parseFloat(p.precio) * cant).toFixed(2) : '-';
                const dir = p.cambio > 0 ? 'subió' : (p.cambio < 0 ? 'bajó' : 'sin cambio');
                const changeText = p.cambio !== 0 && p.cambio !== undefined
                    ? `${p.cambio > 0 ? '▲' : '▼'} $${Math.abs(p.cambio).toFixed(2)} (${dir}/unidad)`
                    : dir;

                const row = document.createElement('tr');
                row.style.cssText = 'border-bottom: 1px solid #eee;';

                const cells = [
                    { text: p.nombre, align: 'center' },
                    { text: String(cant), align: 'center' },
                    { text: p.precio ? '$' + precio : 'Pendiente', align: 'center', color: p.precio ? '' : '#999' },
                    { text: p.precio ? '$' + lineTotal : '-', align: 'center' },
                    { text: changeText, align: 'center' }
                ];

                cells.forEach((cell, index) => {
                    const td = document.createElement('td');
                    td.align = cell.align;
                    td.style.cssText = `border-right: 2px solid #ddd; padding: 8px 6px;`;
                    if (index === cells.length - 1) td.style.borderRight = 'none';
                    if (cell.color) td.style.color = cell.color;
                    td.textContent = cell.text;
                    row.appendChild(td);
                });

                table.appendChild(row);
            });

            scrollDiv.appendChild(table);
            content.appendChild(scrollDiv);

            const btnGroup = document.createElement('div');
            btnGroup.style.cssText = 'margin-top: 15px;';

            const btnVolver = document.createElement('button');
            btnVolver.className = 'small';
            btnVolver.textContent = 'Volver a la lista';
            btnVolver.style.cssText = 'background:#1a73e8; margin-right: 8px;';
            btnVolver.onclick = volverALista;
            btnGroup.appendChild(btnVolver);

            const btnEliminar = document.createElement('button');
            btnEliminar.className = 'small red';
            btnEliminar.textContent = 'Eliminar';
            btnEliminar.style.cssText = 'margin-right: 8px;';
            btnEliminar.onclick = () => confirmarEliminarDespensa(lista.id);
            btnGroup.appendChild(btnEliminar);

            const btnCerrar = document.createElement('button');
            btnCerrar.className = 'small outline';
            btnCerrar.textContent = 'Cerrar';
            btnCerrar.onclick = closeSavedLists;
            btnGroup.appendChild(btnCerrar);

            content.appendChild(btnGroup);
            modal.appendChild(content);
        }

function togglePassword() {
    const passwordInput = document.getElementById('login-password');
    const confirmInput = document.getElementById('login-password-confirm');
    const toggleBtn = document.getElementById('toggle-password');
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    if (confirmInput) confirmInput.type = isPassword ? 'text' : 'password';
    toggleBtn.textContent = isPassword ? '🙈' : '👁';
}

function toggleChangePassword(btn) {
    const wrapper = btn.closest('.password-wrapper');
    const input = wrapper ? wrapper.querySelector('input') : null;
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.textContent = isPassword ? '🙈' : '👁';
}

const firebaseConfig = {
    apiKey: "AIzaSyDYJd_lMdv181P9mjs04C6qEo1A-E0WFaM",
    authDomain: "registrodespensa.firebaseapp.com",
    projectId: "registrodespensa",
    storageBucket: "registrodespensa.firebasestorage.app",
    messagingSenderId: "5408982159",
    appId: "1:5408982159:web:5c5aa852add2617a509cfa"
};

async function initFirebase() {
    console.log('Iniciando Firebase...');
    try {
        const appModule = await import('https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js');
        const dbModule = await import('https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js');
        const app = appModule.initializeApp(firebaseConfig);
        const db = dbModule.getFirestore(app);
        window.firebaseApp = app;
        window.firebaseDb = db;
        window.firebaseSdk = {
            initializeApp: appModule.initializeApp,
            getFirestore: dbModule.getFirestore,
            doc: dbModule.doc,
            getDoc: dbModule.getDoc,
            setDoc: dbModule.setDoc,
            deleteDoc: dbModule.deleteDoc,
            serverTimestamp: dbModule.serverTimestamp
        };
        console.log('Firebase inicializado correctamente, firebaseDb disponible:', !!window.firebaseDb);
    } catch (e) {
        console.warn('Firebase no disponible:', e);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const addBtn = document.getElementById('add-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            agregarProducto();
        });
    }

    const productNameInput = document.getElementById('product-name');
    if (productNameInput) {
        productNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const productPriceInput = document.getElementById('product-price');
                if (productPriceInput) productPriceInput.focus();
            }
        });
    }

    const productPriceInput = document.getElementById('product-price');
    if (productPriceInput) {
        productPriceInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                agregarProducto();
            }
        });
    }

    const loginSubmitBtn = document.getElementById('login-submit');
    if (loginSubmitBtn) {
        loginSubmitBtn.addEventListener('click', (e) => {
            handleLoginSubmit();
        });
    }

    const loginPasswordInput = document.getElementById('login-password');
    if (loginPasswordInput) {
        loginPasswordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleLoginSubmit();
            }
        });
    }

    initDevToolsProtection();

    initFirebase().then(() => {
        return migratePlaintextUsers();
    }).then(() => {
        return syncUsuariosFromFirebase();
    }).then(() => {
        return crearUsuarioAdminSiNoExiste();
    }).then(() => {
        return syncUsuariosFromFirebase();
    }).then(() => {
        const loggedIn = initUserContext();
        if (loggedIn && currentUser) {
            return syncFromFirebase();
        }
    }).then(() => {
        showLoginScreen();
    }).catch((error) => {
        console.error('Error en inicialización:', error);
        showLoginScreen();
    });
});
