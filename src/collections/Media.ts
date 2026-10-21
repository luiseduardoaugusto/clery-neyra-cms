import path from 'path'
import type { CollectionConfig } from 'payload'

export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: 'Imagen', plural: 'Imágenes' },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'alt',
      label: 'Texto alternativo',
      type: 'text',
      required: true,
      admin: {
        description: 'Describe la imagen para lectores de pantalla y Google.',
      },
    },
  ],
  upload: {
    // En producción es un volumen persistente de Coolify (ver README)
    staticDir: process.env.MEDIA_DIR || path.resolve(process.cwd(), 'media'),
    mimeTypes: ['image/*', 'application/pdf'],
    adminThumbnail: 'thumbnail',
    imageSizes: [{ name: 'thumbnail', width: 400 }],
  },
}
