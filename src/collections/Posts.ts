import type { CollectionConfig } from 'payload'

import { slugField } from '../fields/slug'
import { deployAfterChange, deployAfterDelete } from '../hooks/triggerDeploy'

export const Posts: CollectionConfig = {
  slug: 'posts',
  labels: { singular: 'Artículo', plural: 'Artículos' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', 'publishDate', '_status'],
    listSearchableFields: ['title', 'slug'],
  },
  defaultSort: '-publishDate',
  versions: {
    drafts: true,
    maxPerDoc: 20,
  },
  access: {
    // El público (y el build del blog) solo ve lo publicado; con sesión se ven también los borradores
    read: ({ req }) => (req.user ? true : { _status: { equals: 'published' } }),
  },
  hooks: {
    afterChange: [deployAfterChange],
    afterDelete: [deployAfterDelete],
  },
  fields: [
    {
      name: 'title',
      label: 'Título',
      type: 'text',
      required: true,
    },
    {
      name: 'excerpt',
      label: 'Extracto',
      type: 'textarea',
      admin: {
        description: 'Resumen corto que aparece en el listado del blog y al compartir en redes.',
      },
    },
    {
      name: 'featuredImage',
      label: 'Imagen destacada',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'content',
      label: 'Contenido',
      type: 'richText',
      required: true,
    },
    slugField(),
    {
      name: 'publishDate',
      label: 'Fecha de publicación',
      type: 'date',
      required: true,
      defaultValue: () => new Date().toISOString(),
      admin: {
        position: 'sidebar',
        date: { pickerAppearance: 'dayAndTime' },
        description:
          'Si es una fecha futura, el artículo aparece en el blog a partir de ese día (en el siguiente deploy).',
      },
    },
    {
      name: 'category',
      label: 'Categoría',
      type: 'relationship',
      relationTo: 'categories',
      admin: { position: 'sidebar' },
    },
    {
      name: 'tags',
      label: 'Etiquetas',
      type: 'text',
      hasMany: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'featured',
      label: 'Destacar en portada',
      type: 'checkbox',
      defaultValue: false,
      admin: { position: 'sidebar' },
    },
  ],
}
