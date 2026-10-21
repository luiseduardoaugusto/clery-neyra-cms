# CMS del blog de Clery Neyra

Panel de [Payload CMS](https://payloadcms.com) donde se escriben los artículos de [cleryneyravera.com](https://cleryneyravera.com).
El blog es un sitio estático en Astro (repo `clery-neyra-blog`) que lee los artículos publicados desde la API de este CMS en cada build.

## Contenido

- **Artículos** (`posts`): título, extracto, imagen destacada, contenido, slug, fecha, categoría, etiquetas y "Destacar en portada". Tienen borradores: solo lo publicado es visible en la API pública.
- **Categorías** (`categories`)
- **Imágenes** (`media`): se guardan en disco (`MEDIA_DIR`). El blog las descarga y optimiza en su build, así que el sitio no depende de que el CMS esté en línea.
- **Usuarios** (`users`): acceso al panel.

Al publicar, editar un artículo publicado o eliminarlo, el CMS llama al build hook de Netlify (`NETLIFY_BUILD_HOOK_URL`) para regenerar el blog.

## Desarrollo local

```bash
cp .env.example .env        # completar PAYLOAD_SECRET
docker compose up -d        # Postgres en localhost:5432
npm install
npm run payload migrate     # crea las tablas
npm run dev                 # http://localhost:3000/admin
```

El primer ingreso a `/admin` pide crear el usuario administrador.

## Cambios en las colecciones

El esquema de la base de datos se maneja con migraciones (no se sincroniza solo):

```bash
npm run payload migrate:create nombre-del-cambio
npm run generate:types
```

Las migraciones nuevas se aplican automáticamente al arrancar el contenedor en producción.

## Despliegue (Coolify)

1. Crear una base de datos **PostgreSQL 17** en el mismo proyecto de Coolify y activar sus respaldos programados.
2. Crear una aplicación desde este repo con build pack **Dockerfile** y puerto **3000**.
3. Variables de entorno: `DATABASE_URL` (URL interna de la base), `PAYLOAD_SECRET`, `PAYLOAD_PUBLIC_SERVER_URL` y `NETLIFY_BUILD_HOOK_URL`.
4. Montar un **volumen persistente** en `/app/media` (ahí quedan las imágenes; sin volumen se pierden en cada deploy).
5. Dominio: `https://cms.cleryneyravera.com`.
