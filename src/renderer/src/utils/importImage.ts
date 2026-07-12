export interface ImportedImage {
  dataBase64: string // raw base64 PNG, no data: prefix
  width: number
  height: number
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// Decode an image blob, downscale so max(width, height) <= maxDim (never
// upscaling), re-encode as PNG, and return raw base64 plus the final size.
export async function importImagePng(blob: Blob, maxDim = 2000): Promise<ImportedImage> {
  const bitmap = await createImageBitmap(blob)
  const factor = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * factor))
  const height = Math.max(1, Math.round(bitmap.height * factor))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('PNG encoding failed'))),
      'image/png'
    )
  })
  const bytes = new Uint8Array(await png.arrayBuffer())
  return { dataBase64: base64FromBytes(bytes), width, height }
}
