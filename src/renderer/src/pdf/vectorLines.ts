import { OPS } from 'pdfjs-dist'

import type { Segment } from '../geometry/snap'
import type { Pt } from '../state/types'

export interface PageVectorLines {
  segments: Segment[]
  truncated: boolean
}

type Mat = readonly [number, number, number, number, number, number]

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]
const BEZIER_CHORDS = 8

const PAINT_OPS = new Set<number>([
  OPS.stroke,
  OPS.closeStroke,
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke
])

type PageLike = {
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>
}

const cache = new WeakMap<object, Promise<PageVectorLines>>()

function multiply(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ]
}

function apply(m: Mat, x: number, y: number): Pt {
  return {
    x: x * m[0] + y * m[2] + m[4],
    y: x * m[1] + y * m[3] + m[5]
  }
}

function samePoint(a: Pt, b: Pt): boolean {
  return a.x === b.x && a.y === b.y
}

function cubicPoint(
  p0: Pt,
  p1: Pt,
  p2: Pt,
  p3: Pt,
  t: number
): Pt {
  const u = 1 - t
  const uu = u * u
  const tt = t * t
  const uuu = uu * u
  const ttt = tt * t
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
  }
}

function flattenCubic(
  p0: Pt,
  p1: Pt,
  p2: Pt,
  p3: Pt,
  emit: (a: Pt, b: Pt) => boolean
): boolean {
  let prev = p0
  for (let i = 1; i <= BEZIER_CHORDS; i += 1) {
    const next =
      i === BEZIER_CHORDS ? p3 : cubicPoint(p0, p1, p2, p3, i / BEZIER_CHORDS)
    if (!emit(prev, next)) return false
    prev = next
  }
  return true
}

function readMatrix(value: unknown): Mat | null {
  if (value == null) return null
  if (!Array.isArray(value) && !(value instanceof Float32Array)) return null
  const arr = value as ArrayLike<number>
  if (arr.length < 6) return null
  return [arr[0], arr[1], arr[2], arr[3], arr[4], arr[5]]
}

function walkConstructPath(
  subOps: number[],
  subArgs: ArrayLike<number>,
  ctm: Mat,
  emit: (a: Pt, b: Pt) => boolean
): boolean {
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let hasPoint = false
  let j = 0

  const map = (px: number, py: number): Pt => apply(ctm, px, py)

  for (let i = 0; i < subOps.length; i += 1) {
    switch (subOps[i] | 0) {
      case OPS.rectangle: {
        const rx = subArgs[j++]
        const ry = subArgs[j++]
        const width = subArgs[j++]
        const height = subArgs[j++]
        const xw = rx + width
        const yh = ry + height
        x = rx
        y = ry
        startX = rx
        startY = ry
        hasPoint = true
        if (width === 0 || height === 0) {
          if (!emit(map(rx, ry), map(xw, yh))) return false
        } else {
          if (!emit(map(rx, ry), map(xw, ry))) return false
          if (!emit(map(xw, ry), map(xw, yh))) return false
          if (!emit(map(xw, yh), map(rx, yh))) return false
          if (!emit(map(rx, yh), map(rx, ry))) return false
        }
        break
      }
      case OPS.moveTo: {
        x = subArgs[j++]
        y = subArgs[j++]
        startX = x
        startY = y
        hasPoint = true
        break
      }
      case OPS.lineTo: {
        const nx = subArgs[j++]
        const ny = subArgs[j++]
        if (hasPoint) {
          if (!emit(map(x, y), map(nx, ny))) return false
        }
        x = nx
        y = ny
        hasPoint = true
        break
      }
      case OPS.curveTo: {
        const c1x = subArgs[j++]
        const c1y = subArgs[j++]
        const c2x = subArgs[j++]
        const c2y = subArgs[j++]
        const ex = subArgs[j++]
        const ey = subArgs[j++]
        if (hasPoint) {
          const p0 = map(x, y)
          const p1 = map(c1x, c1y)
          const p2 = map(c2x, c2y)
          const p3 = map(ex, ey)
          if (!flattenCubic(p0, p1, p2, p3, emit)) return false
        }
        x = ex
        y = ey
        hasPoint = true
        break
      }
      case OPS.curveTo2: {
        const c2x = subArgs[j++]
        const c2y = subArgs[j++]
        const ex = subArgs[j++]
        const ey = subArgs[j++]
        if (hasPoint) {
          const p0 = map(x, y)
          const p1 = p0
          const p2 = map(c2x, c2y)
          const p3 = map(ex, ey)
          if (!flattenCubic(p0, p1, p2, p3, emit)) return false
        }
        x = ex
        y = ey
        hasPoint = true
        break
      }
      case OPS.curveTo3: {
        const c1x = subArgs[j++]
        const c1y = subArgs[j++]
        const ex = subArgs[j++]
        const ey = subArgs[j++]
        if (hasPoint) {
          const p0 = map(x, y)
          const p1 = map(c1x, c1y)
          const p3 = map(ex, ey)
          if (!flattenCubic(p0, p1, p3, p3, emit)) return false
        }
        x = ex
        y = ey
        hasPoint = true
        break
      }
      case OPS.closePath: {
        if (hasPoint && (x !== startX || y !== startY)) {
          if (!emit(map(x, y), map(startX, startY))) return false
          x = startX
          y = startY
        }
        break
      }
      default:
        break
    }
  }

  return true
}

export function collectSegments(
  fnArray: number[],
  argsArray: unknown[],
  limit = 60000
): PageVectorLines {
  const segments: Segment[] = []
  let truncated = false
  const stack: Mat[] = []
  let ctm: Mat = IDENTITY

  const emit = (a: Pt, b: Pt): boolean => {
    if (samePoint(a, b)) return true
    if (segments.length >= limit) {
      truncated = true
      return false
    }
    segments.push({ a, b })
    if (segments.length >= limit) {
      truncated = true
      return false
    }
    return true
  }

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i] | 0

    switch (fn) {
      case OPS.save: {
        stack.push(ctm)
        break
      }
      case OPS.restore: {
        if (stack.length > 0) ctm = stack.pop()!
        break
      }
      case OPS.transform: {
        const m = readMatrix(argsArray[i])
        if (m) ctm = multiply(ctm, m)
        break
      }
      case OPS.paintFormXObjectBegin: {
        stack.push(ctm)
        const args = argsArray[i]
        const matrixArg = Array.isArray(args) ? (args as unknown[])[0] : null
        const m = readMatrix(matrixArg)
        if (m) ctm = multiply(ctm, m)
        break
      }
      case OPS.paintFormXObjectEnd: {
        if (stack.length > 0) ctm = stack.pop()!
        break
      }
      case OPS.constructPath: {
        const next = i + 1 < fnArray.length ? fnArray[i + 1] | 0 : -1
        if (!PAINT_OPS.has(next)) break

        const packed = argsArray[i] as unknown[]
        const subOps = packed[0] as number[]
        const subArgs = packed[1] as ArrayLike<number>
        if (!walkConstructPath(subOps, subArgs, ctm, emit)) {
          return { segments, truncated }
        }
        break
      }
      default:
        break
    }
  }

  return { segments, truncated }
}

export function pageVectorLines(
  page: PageLike,
  limit = 60000
): Promise<PageVectorLines> {
  const key = page as object
  const hit = cache.get(key)
  if (hit) return hit

  const promise = page
    .getOperatorList()
    .then((list) => collectSegments(list.fnArray, list.argsArray, limit))
  cache.set(key, promise)
  return promise
}
