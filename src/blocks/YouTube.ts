import type { Block } from 'payload'

// Video embebido dentro del contenido de un artículo
export const YouTube: Block = {
  slug: 'youtube',
  labels: { singular: 'Video de YouTube', plural: 'Videos de YouTube' },
  fields: [
    {
      name: 'url',
      label: 'URL del video',
      type: 'text',
      required: true,
      validate: (value: string | null | undefined) =>
        /^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/.test(value || '') ||
        'Pega el enlace de YouTube, por ejemplo https://www.youtube.com/watch?v=…',
    },
  ],
}
