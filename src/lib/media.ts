import { supabase } from './supabase'
import { safeFileName, uuid } from './format'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export function validateImage(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'Formato inválido. Use PNG, JPEG, WebP ou GIF.'
  if (file.size > MAX_IMAGE_BYTES) return 'Imagem muito grande (máximo 5 MB).'
  return null
}

/** URL pública de mídia no bucket "public-media" (avatares, banners, ícones). */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return supabase.storage.from('public-media').getPublicUrl(path).data.publicUrl
}

/** Envia imagem para o bucket público e retorna o caminho. */
export async function uploadPublicImage(folder: 'avatars' | 'banners' | 'servers', ownerId: string, file: File): Promise<string> {
  const err = validateImage(file)
  if (err) throw new Error(err)
  const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1]
  const path = `${folder}/${ownerId}/${uuid()}.${ext}`
  const { error } = await supabase.storage.from('public-media').upload(path, file, {
    contentType: file.type,
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) throw error
  return path
}

export async function removePublicFile(path: string | null | undefined): Promise<void> {
  if (!path) return
  await supabase.storage.from('public-media').remove([path])
}

export function attachmentPath(scope: { kind: 'channel' | 'dm'; id: string }, userId: string, fileName: string): string {
  return `${scope.kind === 'channel' ? 'c' : 'd'}/${scope.id}/${userId}/${uuid()}/${safeFileName(fileName)}`
}

export async function uploadAttachment(path: string, file: File): Promise<void> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('Arquivo muito grande (máximo 25 MB).')
  const { error } = await supabase.storage.from('attachments').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: true, // reenvio após falha
  })
  if (error) throw error
}

// Cache de URLs assinadas (anexos são privados).
const signed = new Map<string, { url: string; exp: number }>()
const pending = new Map<string, Promise<string>>()

export async function signedAttachmentUrl(path: string, download?: string | boolean): Promise<string> {
  const key = `${path}|${download ?? ''}`
  const hit = signed.get(key)
  if (hit && hit.exp > Date.now() + 60_000) return hit.url
  const inflight = pending.get(key)
  if (inflight) return inflight
  const p = (async () => {
    const { data, error } = await supabase.storage.from('attachments').createSignedUrl(path, 3600, { download })
    if (error || !data) throw error ?? new Error('Falha ao obter o arquivo.')
    signed.set(key, { url: data.signedUrl, exp: Date.now() + 3600_000 })
    return data.signedUrl
  })().finally(() => pending.delete(key))
  pending.set(key, p)
  return p
}

export const isImage = (type: string) => type.startsWith('image/') && type !== 'image/svg+xml'
