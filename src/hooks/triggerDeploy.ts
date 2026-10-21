import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'

// Llama al build hook de Netlify para regenerar el blog estático.
// Solo cuando el cambio afecta al sitio público: publicar, editar algo publicado o despublicar.
async function deploy(
  reason: string,
  logger: { info: (msg: string) => void; error: (msg: string) => void },
) {
  const url = process.env.NETLIFY_BUILD_HOOK_URL
  if (!url) return

  try {
    const res = await fetch(`${url}?trigger_title=${encodeURIComponent(reason)}`, {
      method: 'POST',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    logger.info(`Deploy de Netlify solicitado: ${reason}`)
  } catch (err) {
    logger.error(`No se pudo solicitar el deploy de Netlify: ${(err as Error).message}`)
  }
}

export const deployAfterChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
  context,
}) => {
  if (context.skipDeploy) return doc

  // Guardar un borrador de un artículo ya publicado también entra aquí; un deploy de más no hace daño
  const isPublished = doc._status === 'published'
  const wasPublished = previousDoc?._status === 'published'
  if (isPublished || wasPublished) {
    await deploy(
      `${isPublished ? 'Publicado' : 'Cambio en artículo publicado'}: ${doc.title}`,
      req.payload.logger,
    )
  }
  return doc
}

export const deployAfterDelete: CollectionAfterDeleteHook = async ({ doc, req, context }) => {
  if (!context.skipDeploy && doc._status === 'published') {
    await deploy(`Eliminado: ${doc.title}`, req.payload.logger)
  }
  return doc
}
