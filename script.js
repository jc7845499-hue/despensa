const USERS_KEY = 'despensaUsuarios';
const CURRENT_USER_KEY = 'despensaUsuarioActual';
const BASE_STORAGE_KEY = 'despensaProductos';
const BASE_PRICE_HISTORY_KEY = 'despensaHistorialPrecios';
const BASE_SAVED_LISTS_KEY = 'despensaListasGuardadas';
const BASE_FINALIZADO_KEY = 'despensaFinalizada';

let finalizado = false;
let pendingConfirmCallback = null;
let currentUser = null;

function getUserKey(baseKey) {
    if (!currentUser) return baseKey;
    return baseKey + '_' + currentUser;
}

function getUsuarios() {
    const data = localStorage.getItem(USERS_KEY);
    return data ? JSON.parse(data) : [];
}

function saveUsuarios(usuarios) {
    localStorage.setItem(USERS_KEY, JSON.stringify(usuarios));
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
        return btoa(String.fromCharCode.apply(null, new Uint8Array(derivedBits)));
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
        saveUsuarios(usuarios);
    }
}

async function doLogin() {
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error');
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
        errorEl.textContent = 'Ingrese usuario y contraseña';
        errorEl.style.display = 'block';
        return;
    }

    if (typeof localStorage === 'undefined') {
        errorEl.textContent = 'El navegador no soporta almacenamiento local';
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
        finalizado = getFinalizado();
        hideLoginScreen();
        actualizarDatalists();
        renderProductos();
        actualizarBotonUsuario();
    } catch (error) {
        console.error('Error en login:', error);
        errorEl.textContent = 'Error al iniciar sesión';
        errorEl.style.display = 'block';
    }
}

async function doRegister() {
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error');
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

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

    if (typeof localStorage === 'undefined') {
        errorEl.textContent = 'El navegador no soporta almacenamiento local';
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
        finalizado = getFinalizado();
        hideLoginScreen();
        actualizarDatalists();
        renderProductos();
        actualizarBotonUsuario();
    } catch (error) {
        console.error('Error en registro:', error);
        const errorMsg = error && error.message ? error.message : 'Error desconocido';
        errorEl.textContent = 'Error al crear la cuenta: ' + errorMsg;
        errorEl.style.display = 'block';
    }
}

function showLogoutConfirm() {
    pendingConfirmCallback = function() {
        doLogout();
    };
    showConfirmModal('¿Cerrar Sesión?', '¿Está seguro que desea cerrar sesión?');
}

function doLogout() {
    setUsuarioActual(null);
    currentUser = null;
    finalizado = false;
    habilitarControles();
    ocultarBotonNuevaDespensa();
    limpiarInputs();
    renderProductos();
    actualizarBotonUsuario();
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

function getProductos() {
    if (!currentUser) return [];
    const data = localStorage.getItem(getUserKey(BASE_STORAGE_KEY));
    return data ? JSON.parse(data) : [];
}

function saveProductos(productos) {
    localStorage.setItem(getUserKey(BASE_STORAGE_KEY), JSON.stringify(productos));
}

function getHistorialPrecios() {
    if (!currentUser) return {};
    const data = localStorage.getItem(getUserKey(BASE_PRICE_HISTORY_KEY));
    return data ? JSON.parse(data) : {};
}

function saveHistorialPrecios(historial) {
    localStorage.setItem(getUserKey(BASE_PRICE_HISTORY_KEY), JSON.stringify(historial));
}

function getSavedLists() {
    if (!currentUser) return [];
    const data = localStorage.getItem(getUserKey(BASE_SAVED_LISTS_KEY));
    return data ? JSON.parse(data) : [];
}

function saveSavedLists(listas) {
    localStorage.setItem(getUserKey(BASE_SAVED_LISTS_KEY), JSON.stringify(listas));
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
        shoppingDatalist.innerHTML = nombres.map(n => `<option value="${n}">`).join('');
    }
    if (productDatalist) {
        productDatalist.innerHTML = nombres.map(n => `<option value="${n}">`).join('');
    }
}

function actualizarBotonUsuario() {
    const btnUsuario = document.getElementById('btn-usuario');
    const btnNuevaDespensa = document.getElementById('new-pantry-btn');
    const btnAdmin = document.getElementById('btn-admin');
    if (btnUsuario && btnNuevaDespensa) {
        if (currentUser) {
            btnUsuario.style.display = 'inline-block';
            btnUsuario.textContent = 'Cerrar Sesión';
            if (esAdmin()) {
                btnNuevaDespensa.style.display = 'none';
            } else {
                btnNuevaDespensa.style.display = finalizado ? 'inline-block' : 'none';
            }
        } else {
            btnUsuario.style.display = 'none';
            btnNuevaDespensa.style.display = 'none';
        }
    }
    if (btnAdmin) {
        btnAdmin.style.display = (currentUser && esAdmin()) ? 'inline-block' : 'none';
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
        'add-btn', 'btn-finalizar-registro', 'btn-ver-anteriores'
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

function eliminarUsuarioPorAdmin(username) {
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
    saveUsuarios(usuarios);
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
    const errorEl = document.getElementById('admin-create-error');
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

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
        usernameInput.value = '';
        passwordInput.value = '';
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
    ['Usuario', 'Rol', 'Acción'].forEach(text => {
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
                showConfirmModal('¿Está seguro?', `¿Desea eliminar al usuario "${u.username}"?`);
            };
            actionCell.appendChild(btnEliminar);
        } else {
            actionCell.textContent = '-';
            actionCell.style.color = '#999';
        }
        row.appendChild(actionCell);
        table.appendChild(row);
    });
    container.appendChild(table);
}

function togglePanelAdmin() {
    const modal = document.getElementById('admin-modal');
    modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    if (modal.style.display === 'flex') {
        renderizarPanelAdmin();
    }
}

function closePanelAdmin() {
    document.getElementById('admin-modal').style.display = 'none';
}

function getFinalizado() {
    if (!currentUser) return false;
    return localStorage.getItem(getUserKey(BASE_FINALIZADO_KEY)) === 'true';
}

function setFinalizado(val) {
    if (!currentUser) return;
    localStorage.setItem(getUserKey(BASE_FINALIZADO_KEY), val ? 'true' : 'false');
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

function nuevaDespensa() {
    finalizado = false;
    setFinalizado(false);
    localStorage.removeItem(getUserKey(BASE_STORAGE_KEY));
    habilitarControles();
    ocultarBotonNuevaDespensa();
    limpiarInputs();
    renderProductos();
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
    saveProductos(productos);

    nameInput.value = '';
    priceInput.value = '';
    qtyInput.value = '1';
    actualizarDatalists();
    renderProductos();
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
    pendingConfirmCallback = function() {
        finalizarRegistroCompleto();
    };
    showConfirmModal('¿Seguro que desea finalizar el registro?', 'Una vez finalizado, no podrá agregar más productos.');
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
    messageEl.textContent = temp.textContent || '';
    document.getElementById('confirm-modal').style.display = 'flex';
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').style.display = 'none';
    pendingConfirmCallback = null;
}

function confirmarSi() {
    const cb = pendingConfirmCallback;
    closeConfirmModal();
    if (cb) cb();
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
    if (loginScreen) loginScreen.style.display = 'flex';
    if (app) app.style.display = 'none';
}

function hideLoginScreen() {
    const loginScreen = document.getElementById('login-screen');
    const app = document.getElementById('app');
    if (loginScreen) loginScreen.style.display = 'none';
    if (app) app.style.display = 'block';
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

document.getElementById('add-btn').addEventListener('click', agregarProducto);

document.getElementById('product-name').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('product-price').focus();
    }
});

document.getElementById('product-price').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        agregarProducto();
    }
});

function togglePassword() {
    const passwordInput = document.getElementById('login-password');
    const toggleBtn = document.getElementById('toggle-password');
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleBtn.textContent = '🙈';
    } else {
        passwordInput.type = 'password';
        toggleBtn.textContent = '👁';
    }
}

initDevToolsProtection();

migratePlaintextUsers().then(() => {
    crearUsuarioAdminSiNoExiste().then(() => {
        const loggedIn = initUserContext();
        if (!loggedIn) {
            showLoginScreen();
        } else {
            actualizarDatalists();
            renderProductos();
            actualizarBotonUsuario();
        }
    });
});
