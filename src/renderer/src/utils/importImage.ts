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
  if (!Number.isFinite(maxDim) || maxDim < 1) {
    throw new Error(`maxDim must be a finite number >= 1, got ${maxDim}`)
  }
  const cap = Math.floor(maxDim)
  const bitmap = await createImageBitmap(blob)
  const factor = Math.min(1, cap / Math.max(bitmap.width, bitmap.height))
  const width = Math.min(cap, Math.max(1, Math.round(bitmap.width * factor)))
  const height = Math.min(cap, Math.max(1, Math.round(bitmap.height * factor)))

  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0, width, height)

    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('PNG encoding failed'))),
        'image/png'
      )
    })
    const bytes = new Uint8Array(await png.arrayBuffer())
    return { dataBase64: base64FromBytes(bytes), width, height }
  } finally {
    bitmap.close()
  }
}
