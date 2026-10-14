# Usar Mis Finanzas en el teléfono (con sincronización)

Tiempo: unos 15 minutos, una sola vez. Todo es gratuito.

## 1. Crear la base de datos (Supabase)
1. Entra en https://supabase.com → **Start your project** → crea una cuenta.
2. **New project**: nombre `mis-finanzas`, una contraseña de base de datos (guárdala), región cercana.
3. Cuando termine de crearse: menú **SQL Editor** → **New query** → pega todo el contenido de
   `supabase/setup.sql` → **Run**. Debe decir *Success*.
4. Menú **Project Settings → API**: copia la **Project URL** y la clave **anon public**.
5. Abre `js/config.js` y pega esos dos valores entre las comillas. (O pásamelos y lo hago yo.)

## 2. Publicar la app (GitHub Pages)
1. Crea una cuenta en https://github.com.
2. **New repository** → nombre `mis-finanzas` → **Public** → **Create repository**.
3. En la página del repositorio: **uploading an existing file** → arrastra **todo el contenido** de la
   carpeta `MisFinanzas` (index.html, css, js, icons, sw.js, manifest.webmanifest…) → **Commit changes**.
4. **Settings → Pages** → *Source*: **Deploy from a branch** → rama `main`, carpeta `/ (root)` → **Save**.
5. En 1–2 minutos tendrás tu enlace: `https://TU-USUARIO.github.io/mis-finanzas/`.

> El código es público, **tus datos no**: viven cifrados en Supabase y solo tu cuenta y tu contraseña de cifrado los abren.

## 3. Activar la sincronización en el PC (primero)
1. Abre tu enlace de GitHub Pages en el navegador del PC.
2. Como es otra dirección, empieza vacía: **Ajustes → Restaurar copia** con tu última copia JSON
   (hazla antes desde la app que usas ahora: **Ajustes → Copia de seguridad**).
3. **Ajustes → Sincronizar con el teléfono** → *Crear cuenta* (correo + contraseña) → confirma el correo
   que te llega → *Iniciar sesión*.
4. Crea tu **contraseña de cifrado** (no se puede recuperar: anótala en un lugar seguro) → *Activar*.

## 4. Instalar en el teléfono
1. Abre el mismo enlace en el móvil (Chrome en Android, Safari en iPhone).
2. Instálala: Android → menú ⋮ → **Instalar app** · iPhone → Compartir → **Añadir a pantalla de inicio**.
3. Abre la app → **Ajustes → Sincronizar** → *Iniciar sesión* con el mismo correo → escribe tu
   contraseña de cifrado → *Conectar este dispositivo*. En segundos verás todos tus datos.

## Cómo funciona
- Los cambios se suben solos unos segundos después de guardarlos; el punto del engranaje indica el estado
  (verde sincronizado, azul subiendo, amarillo sin conexión, rojo error).
- Sin señal puedes registrar igual: se sincroniza al volver la conexión.
- Si editas en dos dispositivos, se combinan movimiento por movimiento (gana el cambio más reciente).
- Supabase pausa los proyectos gratuitos tras 7 días sin uso: si pasa, entra en supabase.com y pulsa *Restore*.
- **Nunca guardes contraseñas en esta carpeta**: se publica en GitHub. Usa un gestor de contraseñas.
