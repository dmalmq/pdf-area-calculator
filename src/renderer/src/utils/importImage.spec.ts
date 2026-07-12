import { afterEach, describe, expect, it, vi } from 'vitest'

import { importImagePng } from './importImage'

// Stubs a decoded bitmap of the given source size and a canvas whose toBlob
// yields fixed PNG bytes; the canvas records the dimensions the function sets.
function setupCanvas(srcW: number, srcH: number): { canvas: { width: number; height: number } } {
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage: vi.fn() })),
    toBlob: vi.fn((callback: BlobCallback) =>
      callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
    )
  }
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: srcW, height: srcH, close: vi.fn() }))
  )
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
  return { canvas }
}

describe('importImagePng', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('downscales so the longest side is at most maxDim', async () => {
    setupCanvas(4000, 2000)
    const out = await importImagePng(new Blob(), 2000)
    expect(out.width).toBe(2000)
    expect(out.height).toBe(1000)
  })

  it('never upscales a small image', async () => {
    setupCanvas(300, 200)
    const out = await importImagePng(new Blob(), 2000)
    expect(out.width).toBe(300)
    expect(out.height).toBe(200)
  })

  it('uses a default max dimension of 2000', async () => {
    setupCanvas(6000, 3000)
    const out = await importImagePng(new Blob())
    expect(Math.max(out.width, out.height)).toBe(2000)
  })

  it('returns raw base64 without a data: prefix', async () => {
    setupCanvas(100, 100)
    const out = await importImagePng(new Blob())
    expect(out.dataBase64.length).toBeGreaterThan(0)
    expect(out.dataBase64.startsWith('data:')).toBe(false)
  })
})
