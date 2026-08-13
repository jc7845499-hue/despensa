# Registro de Despensa

Aplicación web para el registro y seguimiento de precios de despensa con sistema de usuarios.

## Características

- Registro de productos con precio aproximado y real
- Comparativa de precios contra registros anteriores
- Historial de despensas guardadas
- Sistema de usuarios con autenticación segura
- Contraseñas hasheadas con PBKDF2-SHA256 (Web Crypto API)
- Persistencia local en el navegador (localStorage)
- Sincronización entre dispositivos con Firebase Firestore (opcional)
- Diseño responsive

## Despliegue en GitHub Pages

1. Crea un nuevo repositorio en GitHub
2. Sube estos archivos al repositorio
3. Ve a Settings → Pages
4. En "Source" selecciona la rama `main` (o `master`) y la carpeta `/root`
5. Guarda los cambios
6. Tu sitio estará disponible en `https://<tu-usuario>.github.io/<nombre-repositorio>/`

La página se servirá automáticamente con HTTPS.

## Sincronización entre dispositivos (Firebase)

Por defecto, la app funciona solo con localStorage. Para sincronizar datos entre PC y móvil:

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com/)
2. Habilita **Firestore Database**
3. Crea una **Web App** y copia la configuración
4. Pega la configuración en `firebase-config.js`

Si no configuras Firebase, la app sigue funcionando normalmente con almacenamiento local.

## Uso local

Abre `index.html` en tu navegador. No necesitas servidor local.

## Notas de seguridad

- Las contraseñas se hashean en el navegador usando PBKDF2 con 100,000 iteraciones
- Los datos se almacenan en localStorage por usuario
- Si usas Firebase, los datos también se sincronizan en la nube
- Para producción en red, asegúrate de servir el sitio exclusivamente por HTTPS
