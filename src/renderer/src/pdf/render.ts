import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'

import { pdfjsLib } from './pdfjs'

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjsLib.getDocument({ data: bytes }).promise
}

export async function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number
): Promise<PageViewport> {
  const viewport = page.getViewport({ scale })
  const ctx = canvas.getContext('2d')

  if (!ctx) throw new Error('Canvas 2D context unavailable')

  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvasContext: ctx, viewport }).promise

  return viewport
}
