# Despliegue del CMS en Coolify — instrucciones para Claude

Este documento es para una sesión de Claude Code con acceso al VPS de producción donde corre Coolify.
El objetivo es dejar el CMS en línea en `https://cms.cleryneyravera.com`, con los 34 artículos del blog importados.

## Contexto

- **Qué es:** Payload CMS 3 (Next.js 16) para el blog de Clery Neyra (`cleryneyravera.com`). El blog es un sitio estático en Astro, publicado en Netlify (repo `luiseduardoaugusto/clery-neyra-blog`), y hoy todavía lee los artículos desde Notion. Otra sesión cambiará el blog para que lea de este CMS cuando el despliegue esté listo.
- **Repo:** `https://github.com/luiseduardoaugusto/clery-neyra-cms` (privado), rama `main`. Lee el `README.md`.
- **Probado:** el build de producción, el arranque contra una base vacía (las migraciones se aplican solas en el primer arranque, gracias a `prodMigrations`) y la importación completa del backup (34 artículos, 70 imágenes y 1 PDF).
- **Base de datos:** Postgres 17.
- **Imágenes:** en disco, en `/app/media` dentro del contenedor (variable `MEDIA_DIR`). **Necesita un volumen persistente**; sin él se pierden en cada deploy.

## Reglas para esta sesión

- **El VPS tiene aplicaciones de otros clientes.** No modifiques, reinicies ni borres nada que no hayas creado tú para este CMS: ni proyectos de Coolify, ni contenedores, redes, volúmenes, proxy o firewall. Si algo compartido necesita cambios, pregúntale primero al usuario.
- Antes de cualquier acción difícil de revertir, confirma con el usuario.
- No muestres en el chat secretos, como contraseñas, `PAYLOAD_SECRET` o tokens. Si el usuario los necesita, indícale dónde verlos en Coolify.
- **No configures `NETLIFY_BUILD_HOOK_URL` todavía.** El blog aún lee de Notion; ese paso se hace cuando el blog lea de este CMS.

## Pasos

### 1. Revisar el servidor
- Verifica que haya recursos suficientes: el `next build` usa hasta unos 4 GB de RAM (`--max-old-space-size=4096`) y el volumen de imágenes ocupa unos 30 MB.
- Identifica el proyecto o entorno de Coolify donde crear los recursos. Lo ideal es un proyecto nuevo llamado "Clery Neyra".

### 2. Base de datos
1. En ese proyecto, crea un recurso **PostgreSQL 17**. Basta con la imagen `postgres:17-alpine`.
2. Anota la **URL interna** de conexión. La aplicación se conecta por la red interna de Coolify; **no expongas el puerto públicamente**.
3. **Respaldos programados:**
   - Actívalos en el recurso de base de datos, por ejemplo uno diario.
   - Si el usuario te da credenciales de Cloudflare R2, configúralas como S3 storage en Coolify y úsalas como destino de los respaldos.
   - Si no hay credenciales todavía, deja los respaldos solo en local y avísale al usuario.

### 3. Aplicación
1. Crea un recurso nuevo desde el repo de GitHub privado `luiseduardoaugusto/clery-neyra-cms`, rama `main`. Usa la GitHub App o una deploy key, según lo que tenga configurado Coolify.
2. Configúralo así:
   - **Build pack:** Dockerfile (está en la raíz del repo).
   - **Puerto expuesto:** `3000`.
3. Variables de entorno:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | URL interna de la base del paso 2 |
   | `PAYLOAD_SECRET` | Genérala con `openssl rand -hex 32`. Guárdala solo en Coolify |
   | `PAYLOAD_PUBLIC_SERVER_URL` | `https://cms.cleryneyravera.com` |

   `MEDIA_DIR` ya viene en el Dockerfile como `/app/media`.
4. **Almacenamiento persistente:** monta un volumen en `/app/media`.
5. **Dominio:** `https://cms.cleryneyravera.com`. El proxy de Coolify genera el certificado.
   - **DNS:** el dominio está en Namecheap y lo administra el usuario. Pídele que cree un registro **A** para `cms` que apunte a la IP pública de este VPS.
   - Espera a que resuelva (`dig +short cms.cleryneyravera.com`) antes de validar HTTPS.
6. **Health check**, opcional: `GET /admin` devuelve 200. La imagen es alpine, así que tiene `wget` pero no `curl`.
7. Despliega y revisa los logs. En el primer arranque, la primera petición debe mostrar `Migrating: 20261021_143331_initial` y luego `Migrated`.

### 4. Importar el contenido
El usuario te va a entregar el archivo `backup-2026-10-20.tar.gz` (unos 22 MB), un backup de Notion.

La imagen de producción es "standalone" y **no incluye** `scripts/` ni el CLI de Payload. Por eso la importación se corre en un **contenedor temporal**, con el repo completo, conectado a la misma base y al mismo volumen:

1. Sube el backup al VPS y descomprímelo en una carpeta temporal. Debe quedar `backup-2026-10-20/posts/<slug>/...`.
2. Identifica tres cosas: la red Docker de Coolify donde está la base de datos, el nombre real del volumen de `/app/media` y la `DATABASE_URL` interna.
3. Corre el script en un contenedor temporal. Ajusta los nombres; el clon necesita acceso al repo privado:
   ```bash
   docker run --rm \
     --network <red-de-coolify> \
     -v <volumen-media>:/app/media \
     -v /ruta/a/backup-2026-10-20:/backup:ro \
     -e DATABASE_URL='<url-interna>' \
     -e PAYLOAD_SECRET='<el mismo de la app>' \
     -e MEDIA_DIR=/app/media \
     node:22-alpine sh -c '
       apk add --no-cache git >/dev/null &&
       git clone --depth 1 https://<token-o-credencial>@github.com/luiseduardoaugusto/clery-neyra-cms.git /src &&
       cd /src && npm ci &&
       npm run payload run scripts/import-notion.ts -- /backup &&
       chown -R 1001:1001 /app/media'
   ```
   El `chown` es necesario porque la app corre con el usuario `nextjs` (uid 1001).
4. Resultado esperado: `34 de 34 artículos importados`.
   - Solo "organizacion-exponencial" debe mostrar ⚠, por 2 imágenes que ya estaban rotas en Notion. Es normal.
   - El script descarga un PDF desde `ik.imagekit.io`, así que necesita salida a internet.
   - Se puede repetir sin riesgo: actualiza por slug y no duplica imágenes.
5. Borra la carpeta temporal del backup del VPS.

### 5. Verificar
```bash
curl -s https://cms.cleryneyravera.com/api/posts?limit=1 | grep -o '"totalDocs":[0-9]*'   # → "totalDocs":34
curl -s -o /dev/null -w '%{http_code}\n' https://cms.cleryneyravera.com/api/media/file/kung-fu-panda-featured.webp   # → 200
curl -s -o /dev/null -w '%{http_code}\n' https://cms.cleryneyravera.com/admin   # → 200
```
Después, pídele al usuario que entre a `https://cms.cleryneyravera.com/admin` y cree el **primer usuario administrador**. El primero que se registra queda como admin, así que debe hacerlo en cuanto el sitio esté en línea. Luego se puede invitar a Clery desde Usuarios.

Haz también un redeploy de la app y confirma que los artículos y las imágenes siguen ahí. Así se comprueba que el volumen persiste.

## Qué reportar al terminar

Entrégale al usuario este resumen, sin secretos, para que lo pase a la sesión que integra el blog:

- URL del CMS y resultado de las 3 verificaciones.
- Resultado de la importación: los artículos importados y las advertencias.
- Si los respaldos de la base están activos y dónde se guardan.
- Que el volumen de `/app/media` **no** tiene respaldo automático en Coolify, si es el caso, y qué propones para respaldarlo. Por ejemplo, un cron con `rclone` hacia R2.
- Cualquier diferencia con estos pasos.
