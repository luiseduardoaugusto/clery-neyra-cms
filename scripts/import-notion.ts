// Importa a Payload el backup de Notion hecho con backup-notion.js (posts, categorías e imágenes).
// Se puede correr varias veces: actualiza los artículos por slug y reutiliza las imágenes ya subidas.
//
// Uso: npm run payload run scripts/import-notion.ts -- <carpeta-del-backup>

import fs from 'fs/promises'
import path from 'path'
import { getPayload, type Payload } from 'payload'

import config from '../src/payload.config'
import { slugify } from '../src/fields/slug'
import type { Post } from '../src/payload-types'

type RichText = {
  plain_text: string
  href: string | null
  annotations: Record<string, boolean | string>
}
type NotionBlock = { id: string; type: string; children?: NotionBlock[]; [key: string]: any }
type LexicalNode = Record<string, any>

// Las categorías en Notion eran texto libre (mayúsculas, espacios de más)
const CATEGORY_TITLES: Record<string, string> = {
  aprendizaje: 'Aprendizaje',
  investigacion: 'Investigación',
  'transformacion-digital': 'Transformación Digital',
}

const backupDir = process.argv.slice(2).find((arg) => !arg.startsWith('-') && !arg.endsWith('.ts'))
if (!backupDir) {
  console.error('Uso: npm run payload run scripts/import-notion.ts -- <carpeta-del-backup>')
  process.exit(1)
}

const plainText = (richText: RichText[] = []) =>
  richText
    .map((t) => t.plain_text)
    .join('')
    .trim()
const nodeId = () =>
  Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

// --- Texto ---------------------------------------------------------------------------------

const FORMAT = { bold: 1, italic: 2, strikethrough: 4, underline: 8, code: 16 } as const

function textNodes(richText: RichText[] = []): LexicalNode[] {
  const nodes: LexicalNode[] = []
  for (const item of richText) {
    const format = Object.entries(FORMAT).reduce(
      (sum, [key, bit]) => sum + (item.annotations[key] ? bit : 0),
      0,
    )
    const pieces: LexicalNode[] = []
    item.plain_text.split('\n').forEach((line, i) => {
      if (i > 0) pieces.push({ type: 'linebreak', version: 1 })
      if (line)
        pieces.push({
          type: 'text',
          version: 1,
          text: line,
          format,
          style: '',
          mode: 'normal',
          detail: 0,
        })
    })
    if (item.href && pieces.length) {
      nodes.push({
        type: 'link',
        version: 3,
        id: nodeId(),
        fields: {
          linkType: 'custom',
          url: item.href,
          newTab: !item.href.includes('cleryneyravera.com'),
        },
        children: pieces,
        direction: 'ltr',
        format: '',
        indent: 0,
      })
    } else {
      nodes.push(...pieces)
    }
  }
  return nodes
}

const element = (type: string, children: LexicalNode[], extra: LexicalNode = {}): LexicalNode => ({
  type,
  version: 1,
  children,
  direction: 'ltr',
  format: '',
  indent: 0,
  ...extra,
})

const paragraph = (children: LexicalNode[]) =>
  element('paragraph', children, { textFormat: 0, textStyle: '' })

// --- Imágenes ------------------------------------------------------------------------------

// Imagen pegada como texto: un "!" seguido de un enlace a la imagen
const isPastedImage = (block: NotionBlock) => {
  const rt: RichText[] = block.paragraph?.rich_text || []
  return rt.length >= 2 && rt[0].plain_text.trim() === '!' && rt.slice(1).every((t) => t.href)
}

async function findOrUploadMedia(
  payload: Payload,
  filePath: string,
  fileName: string,
  alt: string,
) {
  const existing = await payload.find({
    collection: 'media',
    where: { filename: { equals: fileName } },
    limit: 1,
  })
  if (existing.docs[0]) return existing.docs[0].id

  const data = await fs.readFile(filePath)
  const ext = path.extname(fileName).slice(1).toLowerCase()
  const mimetype = ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
  const doc = await payload.create({
    collection: 'media',
    data: { alt },
    file: { data, mimetype, name: fileName, size: data.length },
  })
  return doc.id
}

// --- Bloques -------------------------------------------------------------------------------

type Context = {
  payload: Payload
  slug: string
  title: string
  postDir: string
  imageRefs: string[] // referencias ![](...) del index.md del backup, en orden
  warnings: string[]
}

async function imageNode(ctx: Context, caption: string): Promise<LexicalNode | null> {
  const ref = ctx.imageRefs.shift()
  if (!ref?.startsWith('./images/')) {
    ctx.warnings.push(`imagen no recuperable (${ref?.split('?')[0] ?? 'sin referencia'})`)
    return null
  }
  const file = path.basename(ref)
  const id = await findOrUploadMedia(
    ctx.payload,
    path.join(ctx.postDir, 'images', file),
    `${ctx.slug}-${file}`,
    caption || ctx.title,
  )
  return {
    type: 'upload',
    version: 3,
    id: nodeId(),
    relationTo: 'media',
    value: id,
    fields: null,
    format: '',
  }
}

async function listItems(ctx: Context, items: NotionBlock[]): Promise<LexicalNode[]> {
  const result: LexicalNode[] = []
  let value = 1
  for (const item of items) {
    result.push(element('listitem', textNodes(item[item.type].rich_text), { value: value++ }))
    // Sublistas: en Lexical van en un listitem aparte que solo contiene la lista y no cuenta en la numeración
    if (item.children?.length) {
      for (const child of await convertBlocks(ctx, item.children)) {
        result.push(element('listitem', [child], { value }))
      }
    }
  }
  return result
}

async function convertBlocks(ctx: Context, blocks: NotionBlock[]): Promise<LexicalNode[]> {
  const nodes: LexicalNode[] = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const value = block[block.type] || {}

    switch (block.type) {
      case 'paragraph': {
        if (isPastedImage(block)) {
          const image = await imageNode(ctx, '')
          if (image) nodes.push(image)
          break
        }
        const children = textNodes(value.rich_text)
        if (children.length) nodes.push(paragraph(children))
        break
      }

      case 'heading_1':
      case 'heading_2':
      case 'heading_3': {
        // El título del artículo ya es el h1 de la página
        const tag = block.type === 'heading_3' ? 'h3' : 'h2'
        const children = textNodes(value.rich_text)
        if (children.length) nodes.push(element('heading', children, { tag }))
        break
      }

      case 'bulleted_list_item':
      case 'numbered_list_item': {
        const items = [block]
        while (blocks[i + 1]?.type === block.type) items.push(blocks[++i])
        const numbered = block.type === 'numbered_list_item'
        nodes.push(
          element('list', await listItems(ctx, items), {
            listType: numbered ? 'number' : 'bullet',
            tag: numbered ? 'ol' : 'ul',
            start: 1,
          }),
        )
        break
      }

      case 'quote':
      case 'callout': {
        const icon = block.type === 'callout' && value.icon?.emoji ? `${value.icon.emoji} ` : ''
        const children = textNodes(
          value.rich_text.map((t: RichText, n: number) => ({
            ...t,
            plain_text: (n === 0 ? icon : '') + t.plain_text,
          })),
        )
        // Notion deja espacios al inicio y al final de algunas citas
        const first = children[0]
        const last = children[children.length - 1]
        if (first?.type === 'text') first.text = first.text.trimStart()
        if (last?.type === 'text') last.text = last.text.trimEnd()
        if (children.length) nodes.push(element('quote', children))
        break
      }

      case 'image': {
        const image = await imageNode(ctx, plainText(value.caption))
        if (image) nodes.push(image)
        break
      }

      case 'video': {
        const url = value.external?.url
        if (url) {
          nodes.push({
            type: 'block',
            version: 2,
            format: '',
            fields: { id: nodeId(), blockName: '', blockType: 'youtube', url },
          })
        } else {
          ctx.warnings.push('video subido a Notion (no es de YouTube): omitido')
        }
        break
      }

      case 'pdf': {
        // El PDF se descarga para que quede en el CMS y no dependa de ImageKit
        const url = value.external?.url || value.file?.url
        const res = await fetch(url)
        if (!res.ok) {
          ctx.warnings.push(`no se pudo descargar el PDF ${url} (HTTP ${res.status})`)
          break
        }
        const fileName = `${ctx.slug}-${path.basename(new URL(url).pathname)}`
        const tmp = path.join(ctx.postDir, 'images', fileName)
        await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()))
        const id = await findOrUploadMedia(
          ctx.payload,
          tmp,
          fileName,
          plainText(value.caption) || ctx.title,
        )
        await fs.rm(tmp)
        nodes.push({
          type: 'upload',
          version: 3,
          id: nodeId(),
          relationTo: 'media',
          value: id,
          fields: null,
          format: '',
        })
        break
      }

      default:
        ctx.warnings.push(`bloque "${block.type}" no soportado: omitido`)
    }
  }

  return nodes
}

// --- Posts ---------------------------------------------------------------------------------

async function findOrCreateCategory(payload: Payload, raw: string) {
  const slug = slugify(raw)
  if (!slug) return undefined
  const existing = await payload.find({
    collection: 'categories',
    where: { slug: { equals: slug } },
    limit: 1,
  })
  if (existing.docs[0]) return existing.docs[0].id
  const doc = await payload.create({
    collection: 'categories',
    data: { title: CATEGORY_TITLES[slug] || raw.trim(), slug },
  })
  return doc.id
}

async function importPost(payload: Payload, postDir: string) {
  const page = JSON.parse(await fs.readFile(path.join(postDir, 'notion-page.json'), 'utf8'))
  const blocks: NotionBlock[] = JSON.parse(
    await fs.readFile(path.join(postDir, 'notion-blocks.json'), 'utf8'),
  )
  const markdown = await fs.readFile(path.join(postDir, 'index.md'), 'utf8')
  const props = page.properties

  const title = plainText(props.Page.title)
  const slug = slugify(plainText(props.Slug?.rich_text) || title)
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, '')
  const ctx: Context = {
    payload,
    slug,
    title,
    postDir,
    imageRefs: [...body.matchAll(/!\[[^\]]*\]\((\S+?)\)/g)].map((m) => m[1]),
    warnings: [],
  }

  const content = { root: element('root', await convertBlocks(ctx, blocks)) } as Post['content']
  if (ctx.imageRefs.length)
    ctx.warnings.push(`${ctx.imageRefs.length} imagen(es) del backup sin ubicar en el contenido`)

  const files = await fs.readdir(path.join(postDir, 'images'))
  const featuredFile = files.find((f) => f.startsWith('featured.'))
  const featuredImage = featuredFile
    ? await findOrUploadMedia(
        payload,
        path.join(postDir, 'images', featuredFile),
        `${slug}-${featuredFile}`,
        title,
      )
    : undefined

  const data = {
    title,
    slug,
    excerpt: plainText(props.Excerpt?.rich_text) || undefined,
    featuredImage,
    content,
    publishDate: new Date(props.Date.date.start).toISOString(),
    category: await findOrCreateCategory(payload, plainText(props.Category?.rich_text)),
    tags: (props.Tags?.multi_select || []).map((t: { name: string }) => t.name.trim()),
    _status: (props.Published?.checkbox ? 'published' : 'draft') as 'published' | 'draft',
  }

  // Sin deploy a Netlify por cada artículo importado
  const context = { skipDeploy: true }
  const existing = await payload.find({
    collection: 'posts',
    where: { slug: { equals: slug } },
    limit: 1,
    draft: true,
  })
  if (existing.docs[0]) {
    await payload.update({ collection: 'posts', id: existing.docs[0].id, data, context })
  } else {
    await payload.create({ collection: 'posts', data, context })
  }

  return { slug, warnings: ctx.warnings, updated: Boolean(existing.docs[0]) }
}

const payload = await getPayload({ config })
const postsDir = path.resolve(backupDir, 'posts')
const dirs = (await fs.readdir(postsDir)).sort()

let failed = 0
for (const dir of dirs) {
  try {
    const { slug, warnings, updated } = await importPost(payload, path.join(postsDir, dir))
    console.log(`${warnings.length ? '⚠' : '✔'} ${slug}${updated ? ' (actualizado)' : ''}`)
    warnings.forEach((w) => console.log(`    ${w}`))
  } catch (err) {
    failed++
    console.error(`✘ ${dir}: ${(err as Error).message}`)
  }
}

console.log(`\n${dirs.length - failed} de ${dirs.length} artículos importados`)
process.exit(failed ? 1 : 0)
