'use client'

import { useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { makeScaledSurveyPdf } from '../lib/export-scaled-pdf'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, CircleHelp, ClipboardList, Compass, ImagePlus, Lock, Map, Plus, Printer, RotateCcw, RotateCw, Ruler, Trash2, Undo2, Unlock, Upload } from 'lucide-react'

type Point = { x: number; y: number }
type Parcel = { id: string; name: string; owner: string; points: Point[]; fixedEdges: boolean[]; sameEdges?: boolean[]; targetMarla: string; isShare?: boolean }
type PathShape = { id: string; name: string; mode: 'free' | 'attached'; points: Point[]; attachedParcelId: string; attachedParcelIds?: string[]; attachedEdgeIndex?: number; widthKaram: number; isPartitionedParcel?: boolean; owner?: string; deductionMode?: 'proportionate' | 'owner'; deductionOwner?: string }
type PartialCut = { id: string; parcelId: string; start: Point; end: Point }
type WorkspaceSnapshot = { partialCuts?: PartialCut[]; parcels: Parcel[]; customPartitions: Record<string, Point[][]>; paths: PathShape[]; freeCutTargetAreas: Record<string, FreeCutTarget[]>; freeCutShareCounts: Record<string, string> }
type Direction = 'top' | 'right' | 'bottom' | 'left'
type Portion = { label: string; points: Point[]; formula: string; area: number; kind: string }
type TraceCandidate = { photoPoints: Point[]; points: Point[] }
type FreeCutTarget = { owner: string; mode: 'area' | 'percentage'; kanal: string; marla: string; percentage: string; frontage: string; frontageMode?: 'length' | 'percentage' }
const emptyFreeCutTarget = (): FreeCutTarget => ({ owner: '', mode: 'area', kanal: '', marla: '', percentage: '', frontage: '' })
const targetAreaMarla = (target: FreeCutTarget, sourceAreaMarla: number) => target.mode === 'percentage'
  ? sourceAreaMarla * Number(target.percentage || 0) / 100
  : Number(target.kanal || 0) * 20 + Number(target.marla || 0)
function hasCompleteShareTargets(targets: FreeCutTarget[], shareCount: number, sourceAreaMarla: number) {
  if (shareCount < 2 || targets.length < shareCount) return false
  const shareTargets = targets.slice(0, shareCount)
  const areas = shareTargets.map(target => targetAreaMarla(target, sourceAreaMarla))
  return shareTargets.every(target => target.owner.trim().length > 0) && areas.every(area => Number.isFinite(area) && area > EPS) && Math.abs(areas.reduce((sum, area) => sum + area, 0) - sourceAreaMarla) <= 0.05
}

const starterParcels: Parcel[] = [
  { id: 'p1', name: 'Parcel 01', owner: 'Owner 1', targetMarla: '', fixedEdges: [false, false, false, false], sameEdges: [false, false, false, false], points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }] },
  { id: 'p2', name: 'Parcel 02', owner: 'Owner 2', targetMarla: '', fixedEdges: [false, false, false, false], sameEdges: [false, false, false, false], points: [{ x: 40, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 30 }, { x: 40, y: 30 }] },
]
const parcelColors = ['#375c48', '#aa7a37', '#597b81', '#8a6555', '#74734e']
  const partitionColors = ['#b9d9c2', '#b8d7e8', '#ead09f', '#e5b8b0', '#d0c69b', '#c4c0e6', '#e5bd93', '#a9d8d0']
const pathColors = ['#a87835', '#587b8d', '#6d8353', '#9a665f', '#786495', '#45817c']
function ownerColor(owner: string, targets: Record<string, FreeCutTarget[]>, fallbackIndex: number) {
  const normalizedOwner = owner.trim().toLocaleLowerCase()
  const owners = Array.from(new Set(Object.values(targets).flatMap(items => items.map(item => item.owner.trim().toLocaleLowerCase()).filter(Boolean)))).sort()
  const ownerIndex = owners.indexOf(normalizedOwner)
  return partitionColors[(ownerIndex >= 0 ? ownerIndex : fallbackIndex) % partitionColors.length]
}
const EPS = 0.0001
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const polygonArea = (pts: Point[]) => Math.abs(pts.reduce((sum, p, i) => { const q = pts[(i + 1) % pts.length]; return sum + p.x * q.y - q.x * p.y }, 0)) / 2
const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
const edgeIndexBetween = (points: Point[], a: Point, b: Point) => points.findIndex((point, i) => (samePoint(point, a) && samePoint(points[(i + 1) % points.length], b)) || (samePoint(point, b) && samePoint(points[(i + 1) % points.length], a)))
const isFixedEdge = (parcel: Parcel, a: Point, b: Point) => parcel.points.some((point, i) => { const next = parcel.points[(i + 1) % parcel.points.length]; return Boolean(parcel.fixedEdges[i]) && isOnSegment(a, point, next) && isOnSegment(b, point, next) })
const fmt = (n: number, digits = 2) => Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—'
const roundMarla = (sqKaram: number) => Math.max(0, Math.floor(sqKaram / 9 + 0.5))
const formatArea = (sqKaram: number) => { const marla = roundMarla(sqKaram); return `${Math.floor(marla / 20)}-${String(marla % 20).padStart(2, '0')}` }
const marlaFromSqKaram = (area: number) => area / 9
const toFeet = (karam: number) => karam * 5.5
const fromFeet = (feet: number) => feet / 5.5
const formatLengthValue = (karam: number, unit: 'karam' | 'feet') => `${fmt(Math.round(unit === 'feet' ? toFeet(karam) : karam), 0)} ${unit === 'feet' ? 'ft' : 'K'}`

function classifyPortion(points: Point[], label: string, unit: 'karam' | 'feet' = 'karam', measuredPartition = false): Portion {
  const edges = points.map((p, i) => distance(p, points[(i + 1) % points.length]))
  const area = polygonArea(points)
  const displayLength = (lengthK: number) => Math.round(unit === 'feet' ? toFeet(lengthK) : lengthK)
  const lengthAsKaram = (displayed: number) => unit === 'feet' ? displayed / 5.5 : displayed
  const lengthUnit = unit === 'feet' ? 'ft' : 'K'
  const areaSuffix = unit === 'feet' ? '÷ 30.25 sq ft/sarsai' : ''
  if (measuredPartition) {
    const measuredEdges = edges.map(edge => `${fmt(unit === 'feet' ? toFeet(edge) : edge, 2)} ${lengthUnit}`)
    return { label, points, formula: `Boundary lengths ${measuredEdges.join(' · ')} · shoelace area = ${fmt(area, 2)} sarsai${unit === 'feet' ? ` (${fmt(area * 30.25, 2)} sq ft)` : ''} · ${formatArea(area)} K–M (1 marla least count)`, area, kind: 'Measured partition' }
  }
  if (points.length === 3) {
    const baseIndex = edges.indexOf(Math.max(...edges))
    const a = points[baseIndex]
    const b = points[(baseIndex + 1) % 3]
    const c = points[(baseIndex + 2) % 3]
    const baseDisplay = displayLength(distance(a, b))
    const exactHeight = distance(a, b) > EPS ? Math.abs(cross(a, b, c)) / distance(a, b) : 0
    const heightDisplay = displayLength(exactHeight)
    const calculatedArea = (lengthAsKaram(baseDisplay) * lengthAsKaram(heightDisplay)) / 2
    const displayedArea = unit === 'feet' ? `${fmt(baseDisplay * heightDisplay / 2, 2)} sq ft ${areaSuffix} = ${fmt(calculatedArea, 0)} sarsai` : `${fmt(calculatedArea, 0)} sarsai`
    return { label, points, formula: `${baseDisplay} ${lengthUnit} × ${heightDisplay} ${lengthUnit} ÷ 2 = ${displayedArea} · ${formatArea(calculatedArea)} K–M (1 marla least count)`, area: calculatedArea, kind: 'Triangle' }
  }
  if (points.length === 4) {
    const measuredEdges = edges.map(displayLength)
    const karamEdges = edges.map(Math.round)
    const allEqual = Math.max(...measuredEdges) - Math.min(...measuredEdges) < 1
    const dot = (points[1].x - points[0].x) * (points[3].x - points[0].x) + (points[1].y - points[0].y) * (points[3].y - points[0].y)
    const rightAngle = Math.abs(dot) < Math.max(1, edges[0] * edges[3] * 0.015)
    const regularRectangle = rightAngle && Math.abs(measuredEdges[0] - measuredEdges[2]) < 1 && Math.abs(measuredEdges[1] - measuredEdges[3]) < 1
    if (allEqual && rightAngle) {
      const sideDisplay = Math.round(measuredEdges.reduce((sum, n) => sum + n, 0) / 4)
      const calculatedArea = lengthAsKaram(sideDisplay) ** 2
      const areaText = unit === 'feet' ? `${fmt(sideDisplay * sideDisplay, 2)} sq ft ${areaSuffix} = ${fmt(calculatedArea, 0)} sarsai` : `${fmt(calculatedArea, 0)} sarsai`
      return { label, points, formula: `${sideDisplay} ${lengthUnit} × ${sideDisplay} ${lengthUnit} = ${areaText} · ${formatArea(calculatedArea)} K–M (1 marla least count)`, area: calculatedArea, kind: 'Square' }
    }
    const oppA = (measuredEdges[0] + measuredEdges[2]) / 2
    const oppB = (measuredEdges[1] + measuredEdges[3]) / 2
    if (Math.abs(karamEdges[0] - karamEdges[2]) <= 5 && Math.abs(karamEdges[1] - karamEdges[3]) <= 5) {
      const calculatedArea = lengthAsKaram(oppA) * lengthAsKaram(oppB)
      const areaText = unit === 'feet' ? `${fmt(oppA * oppB, 2)} sq ft ${areaSuffix} = ${fmt(calculatedArea, 0)} sarsai` : `${fmt(calculatedArea, 0)} sarsai`
      return { label, points, formula: `(${measuredEdges[0]} + ${measuredEdges[2]}) ÷ 2 × (${measuredEdges[1]} + ${measuredEdges[3]}) ÷ 2 ${lengthUnit}² = ${areaText} · ${formatArea(calculatedArea)} K–M (1 marla least count)`, area: calculatedArea, kind: regularRectangle ? 'Regular rectangle' : 'Four-sided field formula' }
    }
  }
  const calculatedArea = Math.round(area)
  return { label, points, formula: `${fmt(calculatedArea, 0)} sarsai by vertex calculation · ${formatArea(calculatedArea)} K–M (1 marla least count)`, area: calculatedArea, kind: 'Irregular portion' }
}

function isConvex(points: Point[]) {
  const signs = points.map((p, i) => cross(p, points[(i + 1) % points.length], points[(i + 2) % points.length])).filter(v => Math.abs(v) > EPS).map(Math.sign)
  return signs.length > 0 && signs.every(v => v === signs[0])
}

function triangulate(points: Point[]): Point[][] {
  if (points.length === 3) return [points]
  if (isConvex(points)) {
    let pair: [number, number] = [0, Math.floor(points.length / 2)]
    let farthest = -1
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const d = distance(points[i], points[j])
      if (d > farthest) { farthest = d; pair = [i, j] }
    }
    const [a, b] = pair
    const pathBetween = (start: number, end: number) => {
      const path = [start]
      let cursor = start
      while (cursor !== end) { cursor = (cursor + 1) % points.length; path.push(cursor) }
      return path
    }
    const paths = [pathBetween(a, b), pathBetween(b, a)]
    return paths.flatMap(path => Array.from({ length: Math.max(0, path.length - 2) }, (_, i) => [points[path[0]], points[path[i + 1]], points[path[i + 2]]])).filter(triangle => polygonArea(triangle) > EPS)
  }
  const remaining = points.map((_, i) => i)
  const orientation = Math.sign(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y }, 0)) || 1
  const triangles: Point[][] = []
  let guard = points.length * points.length
  while (remaining.length > 3 && guard-- > 0) {
    let bestEar: { index: number; previous: number; current: number; next: number; diagonal: number } | null = null
    for (let k = 0; k < remaining.length; k++) {
      const prev = remaining[(k - 1 + remaining.length) % remaining.length]
      const current = remaining[k]
      const next = remaining[(k + 1) % remaining.length]
      if (cross(points[prev], points[current], points[next]) * orientation <= EPS) continue
      const inside = remaining.some(i => i !== prev && i !== current && i !== next && pointInTriangle(points[i], points[prev], points[current], points[next]))
      if (inside) continue
      const diagonal = distance(points[prev], points[next])
      if (!bestEar || diagonal > bestEar.diagonal) bestEar = { index: k, previous: prev, current, next, diagonal }
    }
    if (!bestEar) break
    triangles.push([points[bestEar.previous], points[bestEar.current], points[bestEar.next]])
    remaining.splice(bestEar.index, 1)
  }
  if (remaining.length === 3) triangles.push(remaining.map(i => points[i]))
  return triangles.length ? triangles : []
}

function clipConvexPolygon(subject: Point[], clip: Point[]) {
  let output = subject
  const orientation = Math.sign(clip.reduce((sum, point, index) => sum + point.x * clip[(index + 1) % clip.length].y - clip[(index + 1) % clip.length].x * point.y, 0)) || 1
  for (let index = 0; index < clip.length && output.length; index++) {
    const edgeStart = clip[index], edgeEnd = clip[(index + 1) % clip.length]
    const input = output
    output = []
    const inside = (point: Point) => orientation * cross(edgeStart, edgeEnd, point) >= -EPS
    const intersection = (start: Point, end: Point) => {
      const direction = { x: end.x - start.x, y: end.y - start.y }
      const edge = { x: edgeEnd.x - edgeStart.x, y: edgeEnd.y - edgeStart.y }
      const denominator = direction.x * edge.y - direction.y * edge.x
      if (Math.abs(denominator) < EPS) return end
      const offset = { x: edgeStart.x - start.x, y: edgeStart.y - start.y }
      const ratio = (offset.x * edge.y - offset.y * edge.x) / denominator
      return { x: start.x + ratio * direction.x, y: start.y + ratio * direction.y }
    }
    for (let pointIndex = 0; pointIndex < input.length; pointIndex++) {
      const current = input[pointIndex], previous = input[(pointIndex - 1 + input.length) % input.length]
      if (inside(current)) {
        if (!inside(previous)) output.push(intersection(previous, current))
        output.push(current)
      } else if (inside(previous)) output.push(intersection(previous, current))
    }
  }
  return output
}

function polygonIntersectionArea(first: Point[], second: Point[]) {
  if (first.length < 3 || second.length < 3) return 0
  return triangulate(first).reduce((sum, firstTriangle) => sum + triangulate(second).reduce((innerSum, secondTriangle) => {
    const overlap = clipConvexPolygon(firstTriangle, secondTriangle)
    return innerSum + (overlap.length >= 3 ? polygonArea(overlap) : 0)
  }, 0), 0)
}

function portionsWithPathDeductions(portions: Portion[], parcelId: string, paths: PathShape[] = []) {
  const sourceParcelId = parcelId.split('-share-')[0]
  const parcelPaths = paths.filter(path => {
    const appliesToParcel = path.attachedParcelId === sourceParcelId || path.attachedParcelIds?.includes(sourceParcelId) === true
    return appliesToParcel && (path.deductionMode !== 'owner' || path.deductionOwner === parcelId)
  })
  if (!parcelPaths.length) return portions
  return portions.map(portion => {
    const deducted = parcelPaths.reduce((sum, path) => sum + polygonIntersectionArea(portion.points, path.points), 0)
    if (deducted <= EPS) return portion
    const area = Math.max(0, portion.area - deducted)
    return { ...portion, area, formula: `${portion.formula} − ${fmt(deducted, 2)} sarsai separate feature area = ${fmt(area, 2)} sarsai` }
  })
}

function pointInTriangle(p: Point, a: Point, b: Point, c: Point) {
  const d1 = cross(p, a, b), d2 = cross(p, b, c), d3 = cross(p, c, a)
  return !(d1 < -EPS || d2 < -EPS || d3 < -EPS) || !(d1 > EPS || d2 > EPS || d3 > EPS)
}

function portionsFor(parcel: Parcel, pieces?: Point[][], unit: 'karam' | 'feet' = 'karam'): Portion[] {
  const polygons = pieces?.length ? pieces : [parcel.points]
  let labelIndex = 0
  return polygons.flatMap(polygon => {
    if (polygon.length < 3) return []
    const portions = polygon.length <= 4 ? [polygon] : triangulate(polygon)
    return portions.map(points => classifyPortion(points, String.fromCharCode(97 + labelIndex++), unit, Boolean(pieces?.length)))
  })
}

function reportPortionsFor(parcel: Parcel, unit: 'karam' | 'feet', paths: PathShape[] = []) {
  return portionsWithPathDeductions(portionsFor(parcel, parcel.isShare ? [parcel.points] : undefined, unit), parcel.id, paths)
}

function pointInPolygon(point: Point, polygon: Point[]) {
  if (polygon.some((vertex, i) => isOnSegment(point, vertex, polygon[(i + 1) % polygon.length]))) return true
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function offsetPolylineSide(points: Point[], offset: number) {
  return points.map((point, index) => {
    const previous = points[index - 1], next = points[index + 1]
    const previousLength = previous ? distance(previous, point) : 0
    const nextLength = next ? distance(point, next) : 0
    const previousNormal = previous && previousLength > EPS ? { x: -(point.y - previous.y) / previousLength, y: (point.x - previous.x) / previousLength } : null
    const nextNormal = next && nextLength > EPS ? { x: -(next.y - point.y) / nextLength, y: (next.x - point.x) / nextLength } : null
    if (!previousNormal && !nextNormal) return point
    if (!previousNormal || !nextNormal) {
      const normal = previousNormal ?? nextNormal!
      return { x: point.x + normal.x * offset, y: point.y + normal.y * offset }
    }
    const normal = { x: previousNormal.x + nextNormal.x, y: previousNormal.y + nextNormal.y }
    const magnitude = Math.hypot(normal.x, normal.y)
    if (magnitude < EPS) return { x: point.x + previousNormal.x * offset, y: point.y + previousNormal.y * offset }
    const unitNormal = { x: normal.x / magnitude, y: normal.y / magnitude }
    const denominator = Math.abs(unitNormal.x * nextNormal.x + unitNormal.y * nextNormal.y)
    const miter = Math.sign(offset) * Math.min(Math.abs(offset) / Math.max(denominator, 0.25), Math.abs(offset) * 4)
    return { x: point.x + unitNormal.x * miter, y: point.y + unitNormal.y * miter }
  })
}

function bufferPolyline(points: Point[], width: number, side: 'left' | 'right' | 'both' = 'both') {
  if (points.length < 2 || width <= EPS) return []
  const centerline = [...points]
  const first = centerline[0], last = centerline[centerline.length - 1]
  const before = centerline[1], after = centerline[centerline.length - 2]
  const startDirection = { x: (first.x - before.x) / distance(first, before), y: (first.y - before.y) / distance(first, before) }
  const endDirection = { x: (last.x - after.x) / distance(last, after), y: (last.y - after.y) / distance(last, after) }
  centerline[0] = { x: first.x + startDirection.x * width / 2, y: first.y + startDirection.y * width / 2 }
  centerline[centerline.length - 1] = { x: last.x + endDirection.x * width / 2, y: last.y + endDirection.y * width / 2 }
  const left = offsetPolylineSide(centerline, side === 'right' ? 0 : width)
  const right = offsetPolylineSide(centerline, side === 'left' ? 0 : -width).reverse()
  return side === 'left' ? [...centerline, ...left.reverse()] : side === 'right' ? [...right, ...centerline] : [...left, ...right]
}

function isSimplePolygon(points: Point[]) {
  if (points.length < 3 || polygonArea(points) < EPS) return false
  for (let first = 0; first < points.length; first++) {
    const firstEnd = (first + 1) % points.length
    for (let second = first + 1; second < points.length; second++) {
      const secondEnd = (second + 1) % points.length
      if (first === second || firstEnd === second || secondEnd === first) continue
      const a = points[first], b = points[firstEnd], c = points[second], d = points[secondEnd]
      const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
      if (abC * abD < -EPS && cdA * cdB < -EPS) return false
      if ((Math.abs(abC) < EPS && isOnSegment(c, a, b)) || (Math.abs(abD) < EPS && isOnSegment(d, a, b)) || (Math.abs(cdA) < EPS && isOnSegment(a, c, d)) || (Math.abs(cdB) < EPS && isOnSegment(b, c, d))) return false
    }
  }
  return true
}

function polygonsOverlapOrCross(first: Point[], second: Point[]) {
  if (first.some(point => pointInPolygon(point, second)) || second.some(point => pointInPolygon(point, first))) return true
  return first.some((start, index) => {
    const end = first[(index + 1) % first.length]
    return second.some((otherStart, otherIndex) => {
      const otherEnd = second[(otherIndex + 1) % second.length]
      const abC = cross(start, end, otherStart), abD = cross(start, end, otherEnd), cdA = cross(otherStart, otherEnd, start), cdB = cross(otherStart, otherEnd, end)
      return abC * abD < -EPS && cdA * cdB < -EPS
    })
  })
}

function isAreaContained(path: Point[], parcel: Parcel) {
  if (path.length < 3 || path.some(point => !pointInPolygon(point, parcel.points))) return false
  for (let index = 0; index < path.length; index++) {
    const start = path[index], end = path[(index + 1) % path.length]
    for (let step = 1; step < 8; step++) {
      const point = { x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 }
      if (!pointInPolygon(point, parcel.points)) return false
    }
    for (let edgeIndex = 0; edgeIndex < parcel.points.length; edgeIndex++) {
      const edgeStart = parcel.points[edgeIndex], edgeEnd = parcel.points[(edgeIndex + 1) % parcel.points.length]
      const pathX = end.x - start.x, pathY = end.y - start.y
      const edgeX = edgeEnd.x - edgeStart.x, edgeY = edgeEnd.y - edgeStart.y
      const denominator = pathX * edgeY - pathY * edgeX
      if (Math.abs(denominator) < EPS) continue
      const dx = edgeStart.x - start.x, dy = edgeStart.y - start.y
      const alongPath = (dx * edgeY - dy * edgeX) / denominator
      const alongEdge = (dx * pathY - dy * pathX) / denominator
      if (alongPath > EPS && alongPath < 1 - EPS && alongEdge > EPS && alongEdge < 1 - EPS) return false
    }
  }
  return true
}

function projectToBoundary(point: Point, polygon: Point[]) {
  let best = { point: polygon[0], edgeIndex: 0, t: 0, distance: Infinity }
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const dx = b.x - a.x, dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared > EPS ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0
    const projected = { x: a.x + t * dx, y: a.y + t * dy }
    const candidateDistance = distance(point, projected)
    if (candidateDistance < best.distance) best = { point: projected, edgeIndex: i, t, distance: candidateDistance }
  }
  return best
}

function splitPolygonByChord(polygon: Point[], start: Point, end: Point): Point[][] | null {
  if (distance(start, end) < 0.01) return null
  const startPosition = projectToBoundary(start, polygon), endPosition = projectToBoundary(end, polygon)
  if (distance(startPosition.point, endPosition.point) < 0.01) return null
  const ring: Point[] = []
  for (let i = 0; i < polygon.length; i++) {
    ring.push(polygon[i])
    const insertions = [startPosition, endPosition].filter(position => position.edgeIndex === i && position.t > EPS && position.t < 1 - EPS).sort((a, b) => a.t - b.t)
    for (const position of insertions) if (!ring.some(point => samePoint(point, position.point))) ring.push(position.point)
  }
  const startIndex = ring.findIndex(point => samePoint(point, startPosition.point))
  const endIndex = ring.findIndex(point => samePoint(point, endPosition.point))
  if (startIndex < 0 || endIndex < 0 || startIndex === endIndex) return null
  const pathBetween = (from: number, to: number) => {
    const path: Point[] = [ring[from]]
    for (let index = from; index !== to;) { index = (index + 1) % ring.length; path.push(ring[index]) }
    return path
  }
  const pieces = [pathBetween(startIndex, endIndex), pathBetween(endIndex, startIndex)]
  return pieces.every(piece => piece.length >= 3 && polygonArea(piece) > EPS) ? pieces : null
}

function splitPolygonByCutLine(polygon: Point[], start: Point, end: Point): Point[][] | null {
  const dx = end.x - start.x, dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 0.01) return null
  const direction = { x: dx / length, y: dy / length }
  const intersections: { point: Point; t: number; edgeIndex: number; edgeRatio: number }[] = []
  for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex++) {
    const a = polygon[edgeIndex], b = polygon[(edgeIndex + 1) % polygon.length]
    const ex = b.x - a.x, ey = b.y - a.y
    const denominator = direction.x * ey - direction.y * ex
    if (Math.abs(denominator) < EPS) continue
    const ax = a.x - start.x, ay = a.y - start.y
    const t = (ax * ey - ay * ex) / denominator
    const edgeRatio = (ax * direction.y - ay * direction.x) / denominator
    if (edgeRatio < -EPS || edgeRatio > 1 + EPS) continue
    const point = { x: start.x + direction.x * t, y: start.y + direction.y * t }
    if (!intersections.some(item => samePoint(item.point, point))) intersections.push({ point, t, edgeIndex, edgeRatio })
  }
  if (intersections.length < 2) return null
  const startOnBoundary = polygon.some((point, index) => isOnSegment(start, point, polygon[(index + 1) % polygon.length]))
  const endOnBoundary = polygon.some((point, index) => isOnSegment(end, point, polygon[(index + 1) % polygon.length]))
  const startHit = startOnBoundary
    ? intersections.reduce((best, item) => distance(item.point, start) < distance(best.point, start) ? item : best, intersections[0])
    : intersections.filter(item => item.t < -EPS).sort((a, b) => b.t - a.t)[0] ?? intersections.sort((a, b) => Math.abs(a.t) - Math.abs(b.t))[0]
  const endHit = endOnBoundary
    ? intersections.reduce((best, item) => distance(item.point, end) < distance(best.point, end) ? item : best, intersections[0])
    : intersections.filter(item => item.t > length + EPS).sort((a, b) => a.t - b.t)[0] ?? intersections.sort((a, b) => Math.abs(a.t - length) - Math.abs(b.t - length))[0]
  if (!startHit || !endHit || samePoint(startHit.point, endHit.point)) return null
  if (startOnBoundary && endOnBoundary && samePoint(startHit.point, start) && samePoint(endHit.point, end)) return splitPolygonByChord(polygon, start, end)
  const ring: Point[] = []
  for (let i = 0; i < polygon.length; i++) {
    ring.push(polygon[i])
    const insertions = [startHit, endHit].filter(hit => hit.edgeIndex === i && hit.edgeRatio > EPS && hit.edgeRatio < 1 - EPS).sort((a, b) => a.edgeRatio - b.edgeRatio)
    for (const hit of insertions) if (!ring.some(point => samePoint(point, hit.point))) ring.push(hit.point)
  }
  const startIndex = ring.findIndex(point => samePoint(point, startHit.point))
  const endIndex = ring.findIndex(point => samePoint(point, endHit.point))
  if (startIndex < 0 || endIndex < 0 || startIndex === endIndex) return null
  const pathBetween = (from: number, to: number) => {
    const path: Point[] = [ring[from]]
    for (let index = from; index !== to;) { index = (index + 1) % ring.length; path.push(ring[index]) }
    return path
  }
  const interiorPoints = [start, end].filter(point => pointInPolygon(point, polygon) && !samePoint(point, startHit.point) && !samePoint(point, endHit.point)).filter((point, index, all) => all.findIndex(other => samePoint(point, other)) === index).sort((a, b) => ((b.x - start.x) * direction.x + (b.y - start.y) * direction.y) - ((a.x - start.x) * direction.x + (a.y - start.y) * direction.y))
  const pieces = [
    [...pathBetween(startIndex, endIndex), ...interiorPoints],
    [...pathBetween(endIndex, startIndex), ...interiorPoints.slice().reverse()],
  ]
  return pieces.every(piece => piece.length >= 3 && polygonArea(piece) > EPS) ? pieces : null
}

/** Clip a finite stroke against a parcel. Unlike an infinite cut line, endpoints
 * strictly inside the field remain where the user placed them. */
function clipStrokeToPolygon(polygon: Point[], start: Point, end: Point): [Point, Point][] {
  const dx = end.x - start.x, dy = end.y - start.y
  if (Math.hypot(dx, dy) < 0.01) return []
  const tValues = [0, 1]
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const ex = b.x - a.x, ey = b.y - a.y
    const determinant = dx * ey - dy * ex
    if (Math.abs(determinant) < EPS) continue
    const rx = a.x - start.x, ry = a.y - start.y
    const t = (rx * ey - ry * ex) / determinant
    const u = (rx * dy - ry * dx) / determinant
    if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) tValues.push(Math.max(0, Math.min(1, t)))
  }
  const sorted = [...new Set(tValues.map(t => Math.round(t * 1e8) / 1e8))].sort((a, b) => a - b)
  const at = (t: number): Point => ({ x: start.x + dx * t, y: start.y + dy * t })
  const pieces: [Point, Point][] = []
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = at(sorted[i]), b = at(sorted[i + 1])
    if (distance(a, b) > 0.01 && (pointInPolygon(at((sorted[i] + sorted[i + 1]) / 2), polygon) || polygon.some((p, j) => isOnSegment(at((sorted[i] + sorted[i + 1]) / 2), p, polygon[(j + 1) % polygon.length])))) pieces.push([a, b])
  }
  return pieces
}

function findTargetAreaGuide(polygon: Point[], start: Point, cursor: Point, targetMarla: number, requiredPoint?: Point) {
  const targetArea = targetMarla * 9
  if (targetArea <= EPS || targetArea >= polygonArea(polygon) - EPS) return null
  const startPoint = projectToBoundary(start, polygon).point
  const cursorPoint = projectToBoundary(cursor, polygon).point
  let best: { start: Point; end: Point; area: number; error: number; cursorDistance: number } | null = null
  const updateBest = (end: Point, pieces: Point[][]) => {
    const areas = pieces.map(polygonArea)
    const selectedIndex = requiredPoint
      ? pieces.findIndex(piece => pointInPolygon(requiredPoint, piece))
      : areas.reduce((bestIndex, area, index) => Math.abs(area - targetArea) < Math.abs(areas[bestIndex] - targetArea) ? index : bestIndex, 0)
    if (selectedIndex < 0) return
    const area = areas[selectedIndex]
    const error = Math.abs(area - targetArea)
    const cursorDistance = distance(end, cursorPoint)
    if (!best || error < best.error - 0.01 || (Math.abs(error - best.error) <= 0.01 && cursorDistance < best.cursorDistance)) best = { start: startPoint, end, area, error, cursorDistance }
  }
  const subdivisions = 32
  for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex++) {
    const a = polygon[edgeIndex], b = polygon[(edgeIndex + 1) % polygon.length]
    const samples: { ratio: number; areas: number[] }[] = []
    for (let sample = 0; sample <= subdivisions; sample++) {
      const ratio = sample / subdivisions
      const end = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }
      const pieces = splitPolygonByChord(polygon, startPoint, end)
      if (!pieces) { samples.push({ ratio, areas: [] }); continue }
      const areas = pieces.map(polygonArea)
      samples.push({ ratio, areas })
      updateBest(end, pieces)
    }
    for (let sample = 1; sample < samples.length; sample++) {
      const previous = samples[sample - 1], current = samples[sample]
      if (previous.areas.length !== 2 || current.areas.length !== 2) continue
      for (let pieceIndex = 0; pieceIndex < 2; pieceIndex++) {
        let left = previous.ratio, right = current.ratio
        let leftArea = previous.areas[pieceIndex] - targetArea
        let rightArea = current.areas[pieceIndex] - targetArea
        if (leftArea * rightArea > 0) continue
        for (let iteration = 0; iteration < 36; iteration++) {
          const ratio = (left + right) / 2
          const end = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }
          const pieces = splitPolygonByChord(polygon, startPoint, end)
          if (!pieces) break
          updateBest(end, pieces)
          const middleArea = polygonArea(pieces[pieceIndex]) - targetArea
          if (Math.abs(middleArea) < 0.01) break
          if (leftArea * middleArea <= 0) { right = ratio; rightArea = middleArea }
          else { left = ratio; leftArea = middleArea }
        }
      }
    }
  }
  const result = best as { start: Point; end: Point; area: number; error: number; cursorDistance: number } | null
  if (!result || result.error > 0.05) return null
  return result
}

function splitToCount(pieces: Point[][], targetCount: number, splitPiece: (piece: Point[]) => Point[][] | null) {
  const result = [...pieces]
  while (result.length < targetCount) {
    const candidates = result.map((piece, index) => ({ piece, index, area: polygonArea(piece) })).sort((a, b) => b.area - a.area)
    let splitIndex = -1
    let split: Point[][] | null = null
    for (const candidate of candidates) {
      split = splitPiece(candidate.piece)
      if (split) { splitIndex = candidate.index; break }
    }
    if (!split || splitIndex < 0) break
    result.splice(splitIndex, 1, ...split)
  }
  return result
}

function sharedEdgeOrientation(parcel: Parcel, edgeIndex: number, parcels: Parcel[]) {
  const start = parcel.points[edgeIndex]
  const end = parcel.points[(edgeIndex + 1) % parcel.points.length]
  const ownStart = String.fromCharCode(65 + edgeIndex)
  const ownEnd = String.fromCharCode(65 + (edgeIndex + 1) % parcel.points.length)
  for (const other of parcels) {
    if (other.id === parcel.id || parcel.name.localeCompare(other.name) > 0) continue
    for (let index = 0; index < other.points.length; index++) {
      const otherStart = other.points[index]
      const otherEnd = other.points[(index + 1) % other.points.length]
      if (samePoint(start, otherStart) && samePoint(end, otherEnd)) return `${ownStart}→${ownEnd} · ${other.name.replace('Parcel ', 'P')} ${String.fromCharCode(65 + index)}→${String.fromCharCode(65 + (index + 1) % other.points.length)}`
      if (samePoint(start, otherEnd) && samePoint(end, otherStart)) return `${ownStart}→${ownEnd} · ${other.name.replace('Parcel ', 'P')} ${String.fromCharCode(65 + (index + 1) % other.points.length)}→${String.fromCharCode(65 + index)}`
    }
  }
  return ''
}

function splitAtMeasuredSide(points: Point[], edgeIndex: number, requestedLength: number, unit: 'karam' | 'feet'): Point[][] | null {
  const start = points[edgeIndex]
  const end = points[(edgeIndex + 1) % points.length]
  const edgeLength = distance(start, end)
  const length = unit === 'feet' ? fromFeet(requestedLength) : requestedLength
  if (length <= EPS || length >= edgeLength - EPS) return null
  const ratio = length / edgeLength
  const cutStart = { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio }
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 })
  const sideMidpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const dx = center.x - sideMidpoint.x
  const dy = center.y - sideMidpoint.y
  const magnitude = Math.hypot(dx, dy)
  if (magnitude < EPS) return null
  const direction = { x: dx / magnitude, y: dy / magnitude }
  const intersections: { point: Point; distance: number }[] = [{ point: cutStart, distance: 0 }]
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    const sx = b.x - a.x, sy = b.y - a.y
    const denominator = direction.x * sy - direction.y * sx
    if (Math.abs(denominator) < EPS) continue
    const qx = a.x - cutStart.x, qy = a.y - cutStart.y
    const alongCut = (qx * sy - qy * sx) / denominator
    const alongEdge = (qx * direction.y - qy * direction.x) / denominator
    if (alongCut > EPS && alongEdge >= -EPS && alongEdge <= 1 + EPS) intersections.push({ point: { x: cutStart.x + direction.x * alongCut, y: cutStart.y + direction.y * alongCut }, distance: alongCut })
  }
  const exit = intersections.sort((a, b) => b.distance - a.distance)[0]
  return exit && exit.distance > EPS ? splitPolygonByChord(points, cutStart, exit.point) : null
}

function clipBySideDistance(points: Point[], edgeIndex: number, depth: number, keepNearSide: boolean): Point[] {
  const edgeStart = points[edgeIndex]
  const edgeEnd = points[(edgeIndex + 1) % points.length]
  const edgeLength = distance(edgeStart, edgeEnd)
  const signedOrientation = Math.sign(points.reduce((sum, point, index) => sum + point.x * points[(index + 1) % points.length].y - points[(index + 1) % points.length].x * point.y, 0)) || 1
  const sideDistance = (point: Point) => signedOrientation * cross(edgeStart, edgeEnd, point) / edgeLength
  const isInside = (point: Point) => keepNearSide ? sideDistance(point) <= depth + EPS : sideDistance(point) >= depth - EPS
  const clipped: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const previous = points[(i - 1 + points.length) % points.length]
    const currentDistance = sideDistance(current)
    const previousDistance = sideDistance(previous)
    if (isInside(current) !== isInside(previous)) {
      const ratio = (depth - previousDistance) / (currentDistance - previousDistance)
      clipped.push({ x: previous.x + (current.x - previous.x) * ratio, y: previous.y + (current.y - previous.y) * ratio })
    }
    if (isInside(current)) clipped.push(current)
  }
  return clipped.filter((point, index) => !samePoint(point, clipped[(index + 1) % clipped.length]))
}

function splitByPercentage(points: Point[], edgeIndex: number, percentage: number): Point[][] | null {
  if (!isConvex(points) || percentage <= 0 || percentage >= 100) return null
  const edgeStart = points[edgeIndex]
  const edgeEnd = points[(edgeIndex + 1) % points.length]
  const edgeLength = distance(edgeStart, edgeEnd)
  if (edgeLength < EPS) return null
  const signedOrientation = Math.sign(points.reduce((sum, point, index) => sum + point.x * points[(index + 1) % points.length].y - points[(index + 1) % points.length].x * point.y, 0)) || 1
  const maxDepth = Math.max(...points.map(point => signedOrientation * cross(edgeStart, edgeEnd, point) / edgeLength))
  const targetArea = polygonArea(points) * percentage / 100
  let low = 0, high = maxDepth
  for (let iteration = 0; iteration < 52; iteration++) {
    const middle = (low + high) / 2
    if (polygonArea(clipBySideDistance(points, edgeIndex, middle, true)) < targetArea) low = middle
    else high = middle
  }
  const depth = (low + high) / 2
  const pieces = [clipBySideDistance(points, edgeIndex, depth, true), clipBySideDistance(points, edgeIndex, depth, false)]
  return pieces.every(piece => piece.length >= 3 && polygonArea(piece) > EPS) ? pieces : null
}

function fitMeasuredSides(imagePoints: Point[], enteredLengths: number[], unit: 'karam' | 'feet'): Point[] | null {
  if (imagePoints.length < 3 || enteredLengths.length !== imagePoints.length) return null
  const targetLengths = enteredLengths.map(length => unit === 'feet' ? fromFeet(length) : length)
  if (targetLengths.some(length => !Number.isFinite(length) || length <= 0) || Math.max(...targetLengths) >= targetLengths.reduce((sum, length) => sum + length, 0) - Math.max(...targetLengths)) return null
  const imageLengths = imagePoints.map((point, index) => distance(point, imagePoints[(index + 1) % imagePoints.length]))
  if (imageLengths.some(length => length < EPS)) return null
  const scale = targetLengths.reduce((sum, length, index) => sum + length / imageLengths[index], 0) / targetLengths.length
  const original = imagePoints.map(point => ({ x: point.x * scale, y: point.y * scale }))
  const points = original.map(point => ({ ...point }))
  for (let iteration = 0; iteration < 5000; iteration++) {
    for (let i = 0; i < points.length; i++) {
      const next = (i + 1) % points.length
      const dx = points[next].x - points[i].x
      const dy = points[next].y - points[i].y
      const currentLength = Math.hypot(dx, dy)
      if (currentLength < EPS) continue
      const correction = (currentLength - targetLengths[i]) / currentLength / 2
      const offset = { x: dx * correction, y: dy * correction }
      points[i].x += offset.x
      points[i].y += offset.y
      points[next].x -= offset.x
      points[next].y -= offset.y
    }
    const centroid = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 })
    const originalCentroid = original.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 })
    for (let i = 0; i < points.length; i++) {
      points[i].x += originalCentroid.x - centroid.x
      points[i].y += originalCentroid.y - centroid.y
    }
  }
  const maxError = Math.max(...points.map((point, index) => Math.abs(distance(point, points[(index + 1) % points.length]) - targetLengths[index])))
  if (maxError > Math.max(...targetLengths) * 0.001) return null
  // Length-only fitting must never reverse the handedness of the original photo.
  const signed = (vertices: Point[]) => vertices.reduce((sum, p, i) => {
    const q = vertices[(i + 1) % vertices.length]
    return sum + p.x * q.y - q.x * p.y
  }, 0)
  if (signed(points) * signed(imagePoints) <= 0) return null
  const origin = points[0]
  return points.map(point => unit === 'feet'
    ? { x: fromFeet(Math.round(toFeet(point.x - origin.x))), y: fromFeet(Math.round(toFeet(point.y - origin.y))) }
    : { x: point.x - origin.x, y: point.y - origin.y })
}

/** Flex an isolated quadrilateral while preserving all four outside lengths.
 * Its internal diagonal is the free variable; orientation stays the same. */
function quadrilateralAtDiagonal(points: Point[], diagonal: number): Point[] | null {
  if (points.length !== 4 || diagonal <= EPS) return null
  const [a, b, c, d] = points
  const originalDiagonal = distance(a, c)
  if (originalDiagonal < EPS) return null
  const ex = (c.x - a.x) / originalDiagonal, ey = (c.y - a.y) / originalDiagonal
  const solve = (near: number, far: number, original: Point): Point | null => {
    if (diagonal >= near + far - EPS || diagonal <= Math.abs(near - far) + EPS) return null
    const along = (near * near - far * far + diagonal * diagonal) / (2 * diagonal)
    const height = Math.sqrt(Math.max(0, near * near - along * along))
    const sign = Math.sign(cross(a, c, original)) || 1
    return { x: a.x + ex * along - ey * height * sign, y: a.y + ey * along + ex * height * sign }
  }
  const nextB = solve(distance(a, b), distance(b, c), b)
  const nextD = solve(distance(a, d), distance(d, c), d)
  if (!nextB || !nextD) return null
  const nextC = { x: a.x + ex * diagonal, y: a.y + ey * diagonal }
  const next = [a, nextB, nextC, nextD]
  return isSimplePolygon(next) ? next : null
}

function fitQuadrilateralArea(points: Point[], requestedArea: number): { points: Point[] | null; min: number; max: number } {
  if (points.length !== 4) return { points: null, min: 0, max: 0 }
  const [a, b, c, d] = points
  const min = Math.max(Math.abs(distance(a, b) - distance(b, c)), Math.abs(distance(a, d) - distance(d, c))) + 1e-4
  const max = Math.min(distance(a, b) + distance(b, c), distance(a, d) + distance(d, c)) - 1e-4
  if (min >= max) return { points: null, min: 0, max: 0 }
  let minimum = Infinity, maximum = -Infinity
  let prior: { area: number; diag: number } | null = null
  let best: { points: Point[]; error: number } | null = null
  for (let i = 0; i <= 500; i++) {
    const diag = min + (max - min) * i / 500
    const result = quadrilateralAtDiagonal(points, diag)
    if (!result) continue
    const area = polygonArea(result)
    minimum = Math.min(minimum, area)
    maximum = Math.max(maximum, area)
    const error = Math.abs(area - requestedArea)
    if (!best || error < best.error) best = { points: result, error }
    if (prior && (prior.area - requestedArea) * (area - requestedArea) <= 0) {
      let lo = prior.diag, hi = diag
      const ascending = area >= prior.area
      for (let step = 0; step < 50; step++) {
        const mid = (lo + hi) / 2
        const fitted = quadrilateralAtDiagonal(points, mid)
        if (!fitted) break
        if ((polygonArea(fitted) < requestedArea) === ascending) lo = mid
        else hi = mid
      }
      const fitted = quadrilateralAtDiagonal(points, (lo + hi) / 2)
      if (fitted && Math.abs(polygonArea(fitted) - requestedArea) < 0.05) return { points: fitted, min: minimum, max: maximum }
    }
    prior = { diag, area }
  }
  return { points: best && best.error < 0.05 ? best.points : null, min: minimum === Infinity ? 0 : minimum, max: maximum === -Infinity ? 0 : maximum }
}

function interiorCutLines(parcel: Parcel, pieces: Point[][]) {
  return pieces.flatMap((piece, pieceIndex) => piece.flatMap((point, i) => {
    const next = piece[(i + 1) % piece.length]
    const shared = pieces.slice(pieceIndex + 1).some(other => edgeIndexBetween(other, point, next) >= 0)
    const followsParcelBoundary = parcel.points.some((vertex, edgeIndex) => isOnSegment(point, vertex, parcel.points[(edgeIndex + 1) % parcel.points.length]) && isOnSegment(next, vertex, parcel.points[(edgeIndex + 1) % parcel.points.length]))
    return shared && !followsParcelBoundary ? [[point, next] as [Point, Point]] : []
  }))
}

function svgPointToWorld(point: Point, angle: number) {
  const radians = -angle * Math.PI / 180
  const x = point.x * Math.cos(radians) - point.y * Math.sin(radians)
  const y = point.x * Math.sin(radians) + point.y * Math.cos(radians)
  return { x, y }
}

function pointerWorldPoint(event: ReactPointerEvent<SVGSVGElement>, angle: number) {
  const svg = event.currentTarget
  const matrix = svg.getScreenCTM()
  if (!matrix) return null
  const point = svg.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  const local = point.matrixTransform(matrix.inverse())
  return svgPointToWorld({ x: local.x, y: local.y }, angle)
}

function roundedPortionArea(area: number) { return roundMarla(area) * 9 }
function portionsAreaTotal(portions: Portion[]) { return portions.reduce((sum, portion) => sum + roundedPortionArea(portion.area), 0) }

function rotated(p: Point, angle: number): Point {
  const radians = angle * Math.PI / 180
  const x = p.x, y = p.y
  return { x: x * Math.cos(radians) - y * Math.sin(radians), y: x * Math.sin(radians) + y * Math.cos(radians) }
}
function directionAfterRotation(direction: Direction, rotation: number): Direction {
  const directions: Direction[] = ['top', 'right', 'bottom', 'left']
  const start = directions.indexOf(direction)
  const quarterTurns = Math.round(rotation / 90)
  return directions[((start + quarterTurns) % 4 + 4) % 4]
}

function cardinalForEdge(a: Point, b: Point, direction: Direction) {
  const angle = { top: 0, right: 90, bottom: 180, left: 270 }[direction] * Math.PI / 180
  const x = b.x - a.x, y = b.y - a.y
  const sx = x * Math.cos(angle) - y * Math.sin(angle)
  const sy = x * Math.sin(angle) + y * Math.cos(angle)
  if (Math.abs(sx) >= Math.abs(sy)) return sx >= 0 ? 'East' : 'West'
  return sy < 0 ? 'North' : 'South'
}

function convexHull(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length < 3) return sorted
  const half = (items: Point[]) => {
    const out: Point[] = []
    for (const p of items) { while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], p) <= EPS) out.pop(); out.push(p) }
    return out
  }
  return [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)]
}
function isOnSegment(p: Point, a: Point, b: Point) {
  return Math.abs(cross(a, b, p)) < 0.001 && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS
}
function isExternalPoint(p: Point, hull: Point[]) {
  return hull.some((a, i) => isOnSegment(p, a, hull[(i + 1) % hull.length]))
}
function sharedEdge(a: Point, b: Point, parcels: Parcel[]) {
  const matchingEdges = parcels.reduce((count, parcel) => count + parcel.points.filter((point, index) => {
    const next = parcel.points[(index + 1) % parcel.points.length]
    return (samePoint(point, a) && samePoint(next, b)) || (samePoint(point, b) && samePoint(next, a))
  }).length, 0)
  return matchingEdges > 1
}
/** Exterior vertices include concave outside corners and points along the hull.
 * Merely being inside the convex hull does not make a vertex internal. */
function isPlanExteriorVertex(point: Point, parcels: Parcel[]) {
  return parcels.some(parcel => parcel.points.some((a, index) => {
    const b = parcel.points[(index + 1) % parcel.points.length]
    return (samePoint(point, a) || samePoint(point, b)) && !sharedEdge(a, b, parcels)
  }))
}

function partitionLines(points: Point[]) {
  if (points.length <= 4) return []
  const seen = new Set<string>()
  return triangulate(points).flatMap(triangle => triangle.flatMap((point, i) => {
    const next = triangle[(i + 1) % triangle.length]
    const isBoundary = points.some((vertex, index) => {
      const neighbor = points[(index + 1) % points.length]
      return (samePoint(vertex, point) && samePoint(neighbor, next)) || (samePoint(vertex, next) && samePoint(neighbor, point))
    })
    if (isBoundary) return []
    const key = [point, next].sort((a, b) => a.x - b.x || a.y - b.y).map(p => `${p.x}:${p.y}`).join('|')
    if (seen.has(key)) return []
    seen.add(key)
    return [[point, next] as [Point, Point]]
  }))
}
function altitudeForTriangle(points: Point[]) {
  const edges = points.map((point, i) => distance(point, points[(i + 1) % 3]))
  const index = edges.indexOf(Math.max(...edges))
  const a = points[index], b = points[(index + 1) % 3], c = points[(index + 2) % 3]
  const dx = b.x - a.x, dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared > EPS ? ((c.x - a.x) * dx + (c.y - a.y) * dy) / lengthSquared : 0
  return { from: c, to: { x: a.x + t * dx, y: a.y + t * dy } }
}
function meanDimensionGuides(points: Point[]): [Point, Point][] {
  if (points.length !== 4) return []
  const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  return [[midpoint(points[0], points[1]), midpoint(points[2], points[3])], [midpoint(points[1], points[2]), midpoint(points[3], points[0])]]
}

type DraftCut = { parcelId: string; start: Point; end: Point; targetAreaMarla?: number; lockTargetArea?: boolean }
function Plot({ parcels, direction, drawingRotation = 0, freeCutParcelId, partitionScope = 'selected', targetAreaMarla, lockTargetArea = false, showLabels = true, drawCalculations = true, annotateAreas = false, printDetail = false, scaleKaramPerInch = 40, unit = 'karam', partitionPieces = {}, shareTargets = {}, paths = [], partialCuts = [], pathDraftPoints = [], pathDrawingEnabled = false, pathDraftClosed = false, onPathVertex, freeCutEnabled = false, draftCut = null, onDraftChange, onCutComplete, measurementPoints = [], measureMode = false, onMeasurePoint }: { parcels: Parcel[]; direction: Direction; drawingRotation?: number; freeCutParcelId?: string; partitionScope?: 'selected' | 'all'; targetAreaMarla?: number; lockTargetArea?: boolean; showLabels?: boolean; drawCalculations?: boolean; annotateAreas?: boolean; printDetail?: boolean; scaleKaramPerInch?: number; unit?: 'karam' | 'feet'; partitionPieces?: Record<string, Point[][]>; shareTargets?: Record<string, FreeCutTarget[]>; paths?: PathShape[]; partialCuts?: PartialCut[]; pathDraftPoints?: Point[]; pathDrawingEnabled?: boolean; pathDraftClosed?: boolean; onPathVertex?: (point: Point) => void; freeCutEnabled?: boolean; draftCut?: DraftCut | null; onDraftChange?: (cut: DraftCut | null) => void; onCutComplete?: (cut: DraftCut) => void; measurementPoints?: Point[]; measureMode?: boolean; onMeasurePoint?: (point: Point) => void }) {
  const angle = { top: 0, right: 90, bottom: 180, left: 270 }[direction] + drawingRotation
  const allPoints = [...parcels.flatMap(p => p.points), ...paths.flatMap(path => path.points)].map(p => rotated(p, angle))
  if (!allPoints.length) return null
  const minX = Math.min(...allPoints.map(p => p.x)), maxX = Math.max(...allPoints.map(p => p.x))
  const minY = Math.min(...allPoints.map(p => p.y)), maxY = Math.max(...allPoints.map(p => p.y))
  const pad = Math.max(maxX - minX, maxY - minY) * 0.13 + 5
  const vbX = minX - pad, vbY = minY - pad, vbW = Math.max(maxX - minX, 10) + pad * 2, vbH = Math.max(maxY - minY, 10) + pad * 2
  const toSvg = (point: Point) => { const p = rotated(point, angle); return { x: p.x, y: p.y } }
  const worldPoint = (event: ReactPointerEvent<SVGSVGElement>) => pointerWorldPoint(event, angle)
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null)
  const [hoverEdge, setHoverEdge] = useState<{ parcelId: string; edgeIndex: number } | null>(null)
  const handlePlotPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = worldPoint(event)
    setHoverPoint(point)
    const target = event.target instanceof Element ? event.target.closest('[data-edge-index]') : null
    const parcelId = target?.closest('[data-parcel-id]')?.getAttribute('data-parcel-id')
    const edgeIndex = target?.getAttribute('data-edge-index')
    setHoverEdge(parcelId && edgeIndex !== null ? { parcelId, edgeIndex: Number(edgeIndex) } : null)
    moveFreeCut(event)
  }
  const draftParcel = draftCut ? parcels.find(parcel => parcel.id === draftCut.parcelId) : undefined
  const draftPolygons = draftParcel ? partitionPieces[draftParcel.id] ?? [draftParcel.points] : []
  const draftMidpoint = draftCut ? { x: (draftCut.start.x + draftCut.end.x) / 2, y: (draftCut.start.y + draftCut.end.y) / 2 } : null
  const draftPolygon = draftCut && draftMidpoint ? draftPolygons.find(piece => pointInPolygon(draftMidpoint, piece)) : undefined
  const targetAreaGuide = draftCut && draftPolygon && targetAreaMarla && partitionScope !== 'all' ? findTargetAreaGuide(draftPolygon, draftCut.start, draftCut.end, targetAreaMarla) : null
  const displayedCutStart = lockTargetArea && targetAreaGuide ? targetAreaGuide.start : draftCut?.start
  const displayedCutEnd = lockTargetArea && targetAreaGuide ? targetAreaGuide.end : draftCut?.end
  const displayedCutSplit = draftPolygon && displayedCutStart && displayedCutEnd ? splitPolygonByCutLine(draftPolygon, displayedCutStart, displayedCutEnd) : null
  const displayedCutIntersections = displayedCutSplit ? displayedCutSplit[0].filter((point, index, points) => !points.slice(0, index).some(previous => samePoint(previous, point)) && displayedCutSplit[1].some(other => samePoint(other, point))) : []
  const displayedCutChord = displayedCutIntersections.length >= 2 ? [displayedCutIntersections[0], displayedCutIntersections[1]] as const : null
  const beginFreeCut = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (measureMode) {
      const point = worldPoint(event)
      if (point) { event.preventDefault(); onMeasurePoint?.(point) }
      return
    }
    if (pathDrawingEnabled) {
      const point = worldPoint(event)
      if (point) { event.preventDefault(); onPathVertex?.(point) }
      return
    }
    if (!freeCutEnabled) return
    const target = event.target instanceof Element ? event.target : null
    const parcelId = target?.closest('[data-parcel-id]')?.getAttribute('data-parcel-id')
    const point = worldPoint(event)
    if (!parcelId || (partitionScope !== 'all' && freeCutParcelId && parcelId !== freeCutParcelId) || !point) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    onDraftChange?.({ parcelId, start: point, end: point })
  }
  const moveFreeCut = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!freeCutEnabled || !draftCut) return
    const point = worldPoint(event)
    if (point) onDraftChange?.({ ...draftCut, end: point })
  }
  const finishFreeCut = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!freeCutEnabled || !draftCut) return
    const point = worldPoint(event)
    if (point) onCutComplete?.({
      ...draftCut,
      start: lockTargetArea && targetAreaGuide ? targetAreaGuide.start : draftCut.start,
      end: lockTargetArea && targetAreaGuide ? targetAreaGuide.end : point,
      targetAreaMarla,
      lockTargetArea,
    })
    onDraftChange?.(null)
  }
  return <svg className={`survey-plot${freeCutEnabled || pathDrawingEnabled || measureMode ? ' free-cut-enabled' : ''}${printDetail ? ' print-detail-plot' : ''}`} style={{ '--print-width': `${vbW / scaleKaramPerInch}in`, '--print-height': `${vbH / scaleKaramPerInch}in` } as CSSProperties} viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} role="img" aria-label="Measured plan of adjacent land parcels and paths" onPointerDown={beginFreeCut} onPointerMove={handlePlotPointerMove} onPointerUp={finishFreeCut} onPointerLeave={() => { setHoverPoint(null); setHoverEdge(null) }} onPointerCancel={() => onDraftChange?.(null)}>
    <defs><pattern id="draft-grid" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M 4 0 L 0 0 0 4" fill="none" stroke="#b7c2b6" strokeWidth="0.04" opacity=".5" /></pattern></defs>
    {!printDetail && <rect x={vbX} y={vbY} width={vbW} height={vbH} fill="url(#draft-grid)" pointerEvents="none" className="plot-grid" />}
    {parcels.map((parcel, parcelIndex) => {
      const pts = parcel.points.map(toSvg)
      const centroid = { x: pts.reduce((s,p)=>s+p.x,0)/pts.length, y: pts.reduce((s,p)=>s+p.y,0)/pts.length }
      const pieces = partitionPieces[parcel.id]
      const cutPoints = (pieces ?? []).flat().filter(point => !parcel.points.some(vertex => samePoint(vertex, point))).filter((point, i, all) => all.findIndex(other => samePoint(point, other)) === i)
      const parcelPortions = portionsWithPathDeductions(portionsFor(parcel, pieces, unit), parcel.id, paths)
      const customCutLines = pieces ? interiorCutLines(parcel, pieces) : []
      const calculationLines = drawCalculations ? (pieces ? pieces.flatMap(piece => partitionLines(piece)) : partitionLines(parcel.points)) : []
      const cutLines = [...customCutLines, ...calculationLines]
      const guidePortions = drawCalculations ? parcelPortions.filter(portion => portion.points.length === 4) : []
      return <g key={parcel.id} data-parcel-id={parcel.id}>
        <polygon points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill={parcelColors[parcelIndex % parcelColors.length]} fillOpacity=".15" stroke="none" pointerEvents="all" />
        {pieces?.map((piece, pieceIndex) => <polygon key={`${parcel.id}-partition-fill-${pieceIndex}`} points={piece.map(toSvg).map(point => `${point.x},${point.y}`).join(' ')} className="app-only-fill plot-partition-fill" fill={ownerColor(shareTargets[parcel.id]?.[pieceIndex]?.owner ?? '', shareTargets, pieceIndex)} pointerEvents="none" />)}
        {pts.map((p, i) => { const q = pts[(i + 1) % pts.length], original = parcel.points[i], next = parcel.points[(i + 1) % parcel.points.length], fixed = isFixedEdge(parcel, original, next), isShared = sharedEdge(original, next, parcels), orientation = sharedEdgeOrientation(parcel, i, parcels); return <g key={`${parcel.id}-edge-${i}`} className="plot-edge-hover" data-edge-index={i}><title>{`Side ${String.fromCharCode(65 + i)}–${String.fromCharCode(65 + (i + 1) % parcel.points.length)} · ${formatLengthValue(distance(original, next), unit)}`}</title><line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={isShared ? '#b38341' : parcelColors[parcelIndex % parcelColors.length]} strokeWidth={fixed ? '.9' : isShared ? '.68' : '.42'} strokeDasharray={parcel.sameEdges?.[i] ? '2 1' : undefined} />
          <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 1.2} className="plot-edge-hover-label" textAnchor="middle" dominantBaseline="middle">{formatLengthValue(distance(original, next), unit)}</text>
          {showLabels && orientation && <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - 1.3} className="plot-shared-edge-label" textAnchor="middle" dominantBaseline="middle" aria-label={`Shared edge orientation: ${orientation}`}>{orientation}</text>}
          {showLabels && (() => {
          const edgePoints = [original, ...cutPoints.filter(point => isOnSegment(point, original, next)).sort((a, b) => distance(original, a) - distance(original, b)), next]
          const splitEdge = edgePoints.length > 2
          return <>
            {splitEdge && <text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 + (orientation ? 1.35 : 0)} className="plot-dimension plot-dimension-original" textAnchor="middle" dominantBaseline="middle">{formatLengthValue(distance(original, next), unit)}{fixed ? ' · FIXED' : ''}</text>}
            {edgePoints.slice(0, -1).map((segmentStart, segmentIndex) => {
              const segmentEnd = edgePoints[segmentIndex + 1]
              const a = toSvg(segmentStart), b = toSvg(segmentEnd)
              return <text key={`${parcel.id}-edge-measure-${i}-${segmentIndex}`} x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + (orientation ? 1.35 : 0)} className="plot-dimension" textAnchor="middle" dominantBaseline="middle">{formatLengthValue(distance(segmentStart, segmentEnd), unit)}{fixed ? ' · FIXED' : ''}</text>
            })}
          </>
        })()}
          <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="plot-edge-hit-area" pointerEvents="stroke" />
        </g> })}
        {cutLines.map(([start, end], i) => { const a = toSvg(start), b = toSvg(end); return <line key={`${parcel.id}-partition-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="plot-partition-line" style={{ stroke: pathColors[(parcelIndex + i) % pathColors.length] }} /> })}
        {guidePortions.flatMap((portion, portionIndex) => meanDimensionGuides(portion.points).map(([start, end], guideIndex) => { const a = toSvg(start), b = toSvg(end); return <g key={`${parcel.id}-mean-guide-${portionIndex}-${guideIndex}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="plot-measure-guide" />{showLabels && <text x={(a.x + b.x) / 2 + .8} y={(a.y + b.y) / 2} className="plot-guide-label">M{guideIndex + 1}</text>}</g> }))}
        {drawCalculations && parcelPortions.filter(portion => portion.points.length === 3).map(portion => { const altitude = altitudeForTriangle(portion.points), a = toSvg(altitude.from), b = toSvg(altitude.to); return <g key={`${parcel.id}-altitude-${portion.label}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="plot-altitude" />{showLabels && <text x={(a.x + b.x) / 2 + .7} y={(a.y + b.y) / 2} className="plot-altitude-label">h</text>}<circle cx={b.x} cy={b.y} r=".38" className="plot-altitude-foot" /></g> })}
        {showLabels && pieces?.length ? pieces.map((piece, shareIndex) => {
          const center = toSvg({ x: piece.reduce((sum, point) => sum + point.x, 0) / piece.length, y: piece.reduce((sum, point) => sum + point.y, 0) / piece.length })
          const owner = shareTargets[parcel.id]?.[shareIndex]?.owner.trim() || `Co-sharer ${shareIndex + 1}`
          return <text key={`${parcel.id}-share-label-${shareIndex}`} x={center.x} y={center.y - (annotateAreas ? 2.4 : 0)} className="plot-parcel-label" textAnchor="middle" dominantBaseline="middle">S{shareIndex + 1} · {owner}</text>
        }) : showLabels && <text x={centroid.x} y={centroid.y - (annotateAreas ? 2.4 : 0)} className="plot-parcel-label" textAnchor="middle" dominantBaseline="middle">Land plot {parcel.name.replace('Parcel ', '')} · {parcel.owner || 'Shared land'}</text>}
        {showLabels && annotateAreas && parcelPortions.map(portion => { const center = toSvg({ x: portion.points.reduce((sum, point) => sum + point.x, 0) / portion.points.length, y: portion.points.reduce((sum, point) => sum + point.y, 0) / portion.points.length }); return <text key={`${parcel.id}-area-${portion.label}`} x={center.x} y={center.y + 2.7} className="plot-area-label" textAnchor="middle" dominantBaseline="middle">{portion.label} · {formatArea(portion.area)} K–M</text> })}
        {pts.map((p, i) => <g key={`${parcel.id}-point-${i}`}><circle cx={p.x} cy={p.y} r=".7" fill="#fcfbf7" stroke={parcelColors[parcelIndex % parcelColors.length]} strokeWidth=".24" />{showLabels && <text x={p.x + 1.15} y={p.y - 1.3} className="plot-point-label">{String.fromCharCode(65 + i)}</text>}</g>)}
        {showLabels && cutPoints.map((point, i) => { const p = toSvg(point); return <g key={`${parcel.id}-cut-point-${i}`}><circle cx={p.x} cy={p.y} r=".55" fill="#fffefa" stroke="#a67c42" strokeWidth=".24"/><text x={p.x + 1.1} y={p.y - 1.1} className="plot-point-label">X{i + 1}</text></g>})}
      </g>
    })}
    {partialCuts.map(cut => { const a = toSvg(cut.start), b = toSvg(cut.end); return <line key={cut.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="plot-partial-cut" pointerEvents="none" /> })}
    {hoverPoint && hoverEdge && (() => {
      const hoveredParcel = parcels.find(parcel => parcel.id === hoverEdge.parcelId)
      if (!hoveredParcel) return null
      const start = hoveredParcel.points[hoverEdge.edgeIndex]
      const end = hoveredParcel.points[(hoverEdge.edgeIndex + 1) % hoveredParcel.points.length]
      const cursor = toSvg(hoverPoint)
      const startSvg = toSvg(start)
      const endSvg = toSvg(end)
      return <g className="plot-hover-distance" pointerEvents="none">
        <line x1={cursor.x} y1={cursor.y} x2={startSvg.x} y2={startSvg.y} />
        <line x1={cursor.x} y1={cursor.y} x2={endSvg.x} y2={endSvg.y} />
        <text x={cursor.x} y={cursor.y - 1.6} textAnchor="middle">{formatLengthValue(distance(hoverPoint, start), unit)} · {formatLengthValue(distance(hoverPoint, end), unit)}</text>
      </g>
    })()}
    {(pathDrawingEnabled || freeCutEnabled) && hoverPoint && (() => {
      const previous = pathDrawingEnabled ? pathDraftPoints[pathDraftPoints.length - 1] : draftCut?.start
      if (!previous) return null
      const cursor = toSvg(hoverPoint)
      const previousSvg = toSvg(previous)
      return <g className="plot-hover-distance plot-hover-segment" pointerEvents="none"><line x1={cursor.x} y1={cursor.y} x2={previousSvg.x} y2={previousSvg.y} /><text x={(cursor.x + previousSvg.x) / 2} y={(cursor.y + previousSvg.y) / 2 - 1.4} textAnchor="middle">{formatLengthValue(distance(hoverPoint, previous), unit)}</text></g>
    })()}
    {paths.map((path, index) => {
      const points = path.points.map(toSvg)
      const center = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 })
      const pathArea = portionsAreaTotal(portionsFor({ id: path.id, name: path.name, owner: path.owner || 'Path', points: path.points, fixedEdges: [], targetMarla: '' }, undefined, unit))
      return <g key={path.id} className="plot-path-shape" aria-label={`${path.isPartitionedParcel ? `${path.name} for ${path.owner}` : path.name}, ${formatArea(pathArea)} Kanal–Marla ${path.isPartitionedParcel ? 'parcel' : 'path'}`}>
        <polygon points={points.map(point => `${point.x},${point.y}`).join(' ')} className={`plot-path-fill app-only-fill${path.isPartitionedParcel ? ' plot-partition-parcel' : ''}`} style={{ fill: pathColors[index % pathColors.length], stroke: pathColors[index % pathColors.length] }} />
        {showLabels && points.map((point, pointIndex) => { const next = points[(pointIndex + 1) % points.length]; return <text key={`${path.id}-side-${pointIndex}`} x={(point.x + next.x) / 2} y={(point.y + next.y) / 2 - .7} className="plot-path-dimension" textAnchor="middle" dominantBaseline="middle">{formatLengthValue(distance(path.points[pointIndex], path.points[(pointIndex + 1) % path.points.length]), unit)}</text> })}
        {showLabels && <text x={center.x} y={center.y} className="plot-path-label" textAnchor="middle" dominantBaseline="middle">{path.isPartitionedParcel ? `${path.name} · ${path.owner}` : path.name} · {formatArea(pathArea)}</text>}
      </g>
    })}
    {pathDraftPoints.length > 0 && <g className="plot-path-draft" pointerEvents="none">{pathDraftClosed && pathDraftPoints.length >= 3 && <polygon points={pathDraftPoints.map(point => toSvg(point)).map(point => `${point.x},${point.y}`).join(' ')} />}<polyline points={pathDraftPoints.map(point => toSvg(point)).map(point => `${point.x},${point.y}`).join(' ')} /><circle cx={toSvg(pathDraftPoints[pathDraftPoints.length - 1]).x} cy={toSvg(pathDraftPoints[pathDraftPoints.length - 1]).y} r=".7" /></g>}
    {measurementPoints.length > 0 && <g className="app-only-fill plot-measurement" pointerEvents="none">{measurementPoints.map((point, index) => { const svgPoint = toSvg(point); return <circle key={`measure-point-${index}`} cx={svgPoint.x} cy={svgPoint.y} r=".9" className="plot-measurement-point" /> })}{measurementPoints.length === 2 && (() => { const start = toSvg(measurementPoints[0]), end = toSvg(measurementPoints[1]), middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }; return <><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} className="plot-measurement-line"/><text x={middle.x} y={middle.y - 1.3} className="plot-measurement-label" textAnchor="middle">{formatLengthValue(distance(measurementPoints[0], measurementPoints[1]), unit)}</text></> })()}</g>}
    {targetAreaGuide && <line x1={toSvg(targetAreaGuide.start).x} y1={toSvg(targetAreaGuide.start).y} x2={toSvg(targetAreaGuide.end).x} y2={toSvg(targetAreaGuide.end).y} className="plot-target-guide" pointerEvents="none" />}
    {draftCut && <line x1={toSvg(displayedCutChord?.[0] ?? displayedCutStart ?? draftCut.start).x} y1={toSvg(displayedCutChord?.[0] ?? displayedCutStart ?? draftCut.start).y} x2={toSvg(displayedCutChord?.[1] ?? displayedCutEnd ?? draftCut.end).x} y2={toSvg(displayedCutChord?.[1] ?? displayedCutEnd ?? draftCut.end).y} className="plot-draft-cut" pointerEvents="none" />}
    {showLabels && <g className="north-indicator" transform={`translate(${vbX + vbW - pad * .7} ${vbY + pad * .8})`}>
      <path d="M 0 4 L 0 -2 M 0 -2 L -1.4 .5 M 0 -2 L 1.4 .5" fill="none" stroke="#294c3b" strokeWidth=".32" />
      {showLabels && <text x="0" y="6" textAnchor="middle" className="north-label">N</text>}
    </g>}
  </svg>
}

function alignTraceToEdge(points: Point[], targetStart: Point, targetEnd: Point) {
  const start = points[0], next = points[1]
  const sourceAngle = Math.atan2(next.y - start.y, next.x - start.x)
  const targetAngle = Math.atan2(targetEnd.y - targetStart.y, targetEnd.x - targetStart.x)
  const rotation = targetAngle - sourceAngle
  const cos = Math.cos(rotation), sin = Math.sin(rotation)
  return points.map((point, index) => {
    if (index === 0) return targetStart
    if (index === 1) return targetEnd
    const dx = point.x - start.x, dy = point.y - start.y
    return { x: targetStart.x + dx * cos - dy * sin, y: targetStart.y + dx * sin + dy * cos }
  })
}

function DiagramTrace({ unit, onApply, onCancel }: { unit: 'karam' | 'feet'; onApply: (shapes: Point[][]) => void; onCancel: () => void }) {
  const [imageUrl, setImageUrl] = useState('')
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [tracePoints, setTracePoints] = useState<Point[]>([])
  const [sideLengths, setSideLengths] = useState<string[]>([])
  const [completedTraces, setCompletedTraces] = useState<TraceCandidate[]>([])
  const [traceUndo, setTraceUndo] = useState<TraceCandidate[][]>([])
  const [traceRedo, setTraceRedo] = useState<TraceCandidate[][]>([])
  const [attachmentShapeIndex, setAttachmentShapeIndex] = useState(0)
  const [attachmentEdgeIndex, setAttachmentEdgeIndex] = useState(0)
  const [selectedSharedEdges, setSelectedSharedEdges] = useState<number[]>([0])
  const [keyboardPoint, setKeyboardPoint] = useState<Point>({ x: 0, y: 0 })
  const [error, setError] = useState('')
  const lengthUnit = unit === 'feet' ? 'ft' : 'Karam'
  const activeShapeIndex = completedTraces.length
  const attachedShape = completedTraces[attachmentShapeIndex]
  const attachedEdgeEndIndex = attachedShape ? (attachmentEdgeIndex + 1) % attachedShape.points.length : 0
  const attachedLength = attachedShape ? distance(attachedShape.points[attachmentEdgeIndex], attachedShape.points[attachedEdgeEndIndex]) : 0
  const attachedLengthInput = attachedLength ? String(Number((unit === 'feet' ? toFeet(attachedLength) : attachedLength).toFixed(4))) : ''
  const effectiveSideLengths = sideLengths.map((value, index) => completedTraces.length && index === 0 ? attachedLengthInput : value)

  function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    if (!file.type.startsWith('image/')) { setError('Choose an image file to trace.'); return }
    if (file.size > 12 * 1024 * 1024) { setError('Choose an image smaller than 12 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') { setError('This image could not be opened. Try another file.'); return }
      setImageUrl(reader.result)
      setTracePoints([])
      setSideLengths([])
      setCompletedTraces([])
      setAttachmentShapeIndex(0)
      setAttachmentEdgeIndex(0)
      setImageSize({ width: 0, height: 0 })
      setKeyboardPoint({ x: 0, y: 0 })
      setError('')
    }
    reader.onerror = () => setError('This image could not be opened. Try another file.')
    reader.readAsDataURL(file)
  }

  function addMark(point: Point) {
    setTraceUndo(current => [...current, completedTraces.map(trace => ({ photoPoints: [...trace.photoPoints], points: [...trace.points] }))].slice(-50))
    setTraceRedo([])
    setTracePoints(current => [...current, point])
    setSideLengths(current => {
      const next = [...current, '']
      if (completedTraces.length && tracePoints.length === 1) next[0] = attachedLengthInput
      return next
    })
    setError('')
  }

  function markPoint(event: MouseEvent<HTMLDivElement>) {
    if (!imageSize.width || !imageSize.height) return
    const bounds = event.currentTarget.getBoundingClientRect()
    addMark({ x: (event.clientX - bounds.left) / bounds.width * imageSize.width, y: (event.clientY - bounds.top) / bounds.height * imageSize.height })
  }

  function handleStageKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!imageSize.width || !imageSize.height) return
    const step = event.shiftKey ? .05 : .01
    const offsets: Record<string, Point> = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } }
    if (offsets[event.key]) {
      event.preventDefault()
      setKeyboardPoint(current => ({ x: Math.max(0, Math.min(imageSize.width, current.x + offsets[event.key].x * imageSize.width * step)), y: Math.max(0, Math.min(imageSize.height, current.y + offsets[event.key].y * imageSize.height * step)) }))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      addMark(keyboardPoint)
    }
  }

  function undoPoint() {
    if (!tracePoints.length) return
    setTraceRedo(current => [...current, completedTraces.map(trace => ({ photoPoints: [...trace.photoPoints], points: [...trace.points] }))])
    setTracePoints(current => current.slice(0, -1))
    setSideLengths(current => current.slice(0, -1))
    setError('')
  }

  function redoPoint() {
    const snapshot = traceRedo.at(-1)
    if (!snapshot) return
    setTraceRedo(current => current.slice(0, -1))
    setTraceUndo(current => [...current, snapshot])
    setCompletedTraces(snapshot)
    setError('')
  }

  function fitCurrentTrace() {
    if (tracePoints.length < 3 || effectiveSideLengths.length !== tracePoints.length || effectiveSideLengths.some(value => !value.trim() || !Number.isFinite(Number(value)) || Number(value) <= 0)) {
      setError('Enter a positive measured length for every side before using the traced parcel.')
      return null
    }
    const points = fitMeasuredSides(tracePoints, effectiveSideLengths.map(Number), unit)
    if (!points) { setError('These side lengths cannot form a closed parcel, or the traced sides need clearer corner marks. Check the entered measurements.'); return null }
    if (polygonArea(points) <= EPS) { setError('These marks do not enclose an area. Adjust the corner marks and try again.'); return null }
    if (completedTraces.length) {
      if (tracePoints.length < 2 || !attachedShape) { setError('Mark the selected shared boundary first, then trace the other parcel corners.'); return null }
      return { photoPoints: tracePoints, points: alignTraceToEdge(points, attachedShape.points[attachmentEdgeIndex], attachedShape.points[attachedEdgeEndIndex]) }
    }
    return { photoPoints: tracePoints, points }
  }

  function selectSharedEdge(edgeIndex: number, checked: boolean) {
    if (!attachedShape) return
    const nextEdges = checked ? Array.from(new Set([...selectedSharedEdges, edgeIndex])) : selectedSharedEdges.filter(index => index !== edgeIndex)
    if (!nextEdges.length) return
    const primaryEdge = nextEdges[0]
    const endIndex = (primaryEdge + 1) % attachedShape.points.length
    const sharedStart = attachedShape.points[primaryEdge]
    const sharedEnd = attachedShape.points[endIndex]
    const sharedLength = distance(sharedStart, sharedEnd)
    setSelectedSharedEdges(nextEdges)
    setAttachmentEdgeIndex(primaryEdge)
    setTracePoints([sharedStart, sharedEnd])
    setSideLengths([String(Number((unit === 'feet' ? toFeet(sharedLength) : sharedLength).toFixed(4))), ''])
    setTraceRedo([])
    setKeyboardPoint(sharedEnd)
    setError('')
  }

  function startAdjacentTrace() {
    const candidate = fitCurrentTrace()
    if (!candidate) return
    const nextTraces = [...completedTraces, candidate]
    const sharedStart = candidate.photoPoints[0]
    const sharedEnd = candidate.photoPoints[1]
    setCompletedTraces(nextTraces)
    setAttachmentShapeIndex(nextTraces.length - 1)
    setAttachmentEdgeIndex(0)
    setSelectedSharedEdges([0])
    setTracePoints([sharedStart, sharedEnd])
    setSideLengths([attachedLengthInput, ''])
    setKeyboardPoint(sharedEnd)
    setError('')
  }

  function applyTrace() {
    const candidate = fitCurrentTrace()
    if (!candidate) return
    onApply([...completedTraces, candidate].map(trace => trace.points))
  }

  const aspect = imageSize.width && imageSize.height ? imageSize.width / imageSize.height : 1
  const canApply = tracePoints.length >= 3 && effectiveSideLengths.length === tracePoints.length && effectiveSideLengths.every(value => Number(value) > 0)
  const displayedTraces = [...completedTraces.map((trace, index) => ({ points: trace.photoPoints, index })), { points: tracePoints, index: activeShapeIndex }]

  return <section className="diagram-trace-panel" aria-label="Trace parcels from a diagram photo">
    <div className="trace-panel-heading"><div><span className="eyebrow">PHOTO-ASSISTED DRAWING</span><h3>Trace adjacent plots from one photo</h3><p>Mark each plot&apos;s corners and measured sides. After the first plot, add adjacent plots here without uploading the photo again.</p></div><button className="trace-close-button" onClick={onCancel} aria-label="Close photo tracing">×</button></div>
    <label className="trace-upload-button"><ImagePlus /><span>{imageUrl ? 'Choose a different photo' : 'Upload diagram photo'}</span><input className="sr-only" type="file" accept="image/*" onChange={handleImage} aria-label="Upload diagram photo" /></label>
    {imageUrl ? <>
      {completedTraces.length > 0 && <fieldset className="trace-attachment-controls"><legend>Attach plot {activeShapeIndex + 1} to an existing plot</legend><label>Adjacent to<select value={attachmentShapeIndex} onChange={event => { const nextShape = Number(event.target.value); setAttachmentShapeIndex(nextShape); setAttachmentEdgeIndex(0); setSelectedSharedEdges([0]); setTracePoints([]); setSideLengths([]); setTraceRedo([]) }}>{completedTraces.map((_, index) => <option key={`trace-target-${index}`} value={index}>Parcel {String(index + 1).padStart(2, '0')}</option>)}</select></label><div className="trace-shared-side-list"><span>Shared side(s)</span>{attachedShape?.points.map((point, index) => { const endIndex = (index + 1) % attachedShape.points.length; return <label key={`trace-edge-${index}`}><input type="checkbox" checked={selectedSharedEdges.includes(index)} onChange={event => selectSharedEdge(index, event.target.checked)} /><span>Side {String.fromCharCode(65 + index)}–{String.fromCharCode(65 + endIndex)} · {formatLengthValue(distance(point, attachedShape.points[endIndex]), unit)}</span></label> })}</div><small className="trace-attachment-help">Shared edges are already marked. Select every side this plot shares, then continue from the first shared side&apos;s end point.</small></fieldset>}
      <p className="trace-instruction" id="trace-instruction" aria-live="polite">{completedTraces.length && tracePoints.length < 3 ? `Plot ${activeShapeIndex + 1}: the shared side is already marked. Continue from its end point and add the remaining corners.` : tracePoints.length < 3 ? `Plot ${activeShapeIndex + 1}: mark at least 3 corners in boundary order. ${tracePoints.length} marked.` : `Enter each actual side length in ${lengthUnit}; the photo is used for shape and direction, not a fixed 40-unit scale.`}</p>
      <p className="trace-keyboard-help" id="trace-keyboard-help">Click or tap the photo, or focus it and use arrow keys then Enter to mark. Hold Shift for larger keyboard steps.</p>
      <div className="trace-image-stage" style={{ aspectRatio: `${imageSize.width || 4} / ${imageSize.height || 3}`, width: `min(100%, ${Math.round(360 * aspect)}px)` }} onClick={markPoint} onKeyDown={handleStageKeyDown} role="application" tabIndex={0} aria-describedby="trace-instruction trace-keyboard-help" aria-label="Diagram marking surface">
        <img src={imageUrl} alt="Uploaded parcel diagram for tracing" onLoad={event => { const { naturalWidth, naturalHeight } = event.currentTarget; setImageSize({ width: naturalWidth, height: naturalHeight }); setKeyboardPoint({ x: naturalWidth / 2, y: naturalHeight / 2 }) }} />
        {imageSize.width > 0 && <svg className="trace-overlay" viewBox={`0 0 ${imageSize.width} ${imageSize.height}`} preserveAspectRatio="none" aria-hidden="true">
          {displayedTraces.map(({ points, index }) => <g key={`trace-shape-${index}`} style={{ color: parcelColors[index % parcelColors.length] }}>{points.length > 2 && <polygon points={points.map(point => `${point.x},${point.y}`).join(' ')} className="trace-parcel-fill" style={{ fill: parcelColors[index % parcelColors.length], stroke: parcelColors[index % parcelColors.length] }} />}{points.length > 1 && <polyline points={points.map(point => `${point.x},${point.y}`).join(' ')} className="trace-parcel-line" style={{ stroke: parcelColors[index % parcelColors.length] }} />}{points.map((point, pointIndex) => <g key={`vertex-${pointIndex}`}><circle cx={point.x} cy={point.y} r={Math.min(imageSize.width, imageSize.height) * .018} className="trace-vertex-point" /><text x={point.x} y={point.y} fontSize={Math.min(imageSize.width, imageSize.height) * .045} strokeWidth={Math.min(imageSize.width, imageSize.height) * .006} className="trace-point-label">{String.fromCharCode(65 + pointIndex)}</text></g>)}</g>)}
          <g className="trace-keyboard-cursor"><circle cx={keyboardPoint.x} cy={keyboardPoint.y} r={Math.min(imageSize.width, imageSize.height) * .024} /><path d={`M ${keyboardPoint.x - Math.min(imageSize.width, imageSize.height) * .04} ${keyboardPoint.y} H ${keyboardPoint.x + Math.min(imageSize.width, imageSize.height) * .04} M ${keyboardPoint.x} ${keyboardPoint.y - Math.min(imageSize.width, imageSize.height) * .04} V ${keyboardPoint.y + Math.min(imageSize.width, imageSize.height) * .04}`} /></g>
        </svg>}
      </div>
      {tracePoints.length >= 3 && <fieldset className="trace-side-lengths"><legend>Parcel {activeShapeIndex + 1} · measured sides <span>· {lengthUnit}</span></legend>{tracePoints.map((point, index) => {
        const next = tracePoints[(index + 1) % tracePoints.length]
        const startName = String.fromCharCode(65 + index)
        const endName = String.fromCharCode(65 + (index + 1) % tracePoints.length)
        const sharedSide = completedTraces.length > 0 && index === 0
        return <label className="trace-side-row" key={`trace-side-${index}`} htmlFor={`trace-side-${index}`}><span>{startName}–{endName}<small>{sharedSide ? 'Shared edge · traced in photo' : `${fmt(distance(point, next), 0)} px in photo`}</small></span><input id={`trace-side-${index}`} type="number" min="0.1" step="0.1" inputMode="decimal" placeholder={`Length in ${lengthUnit}`} value={sharedSide ? attachedLengthInput : sideLengths[index] ?? ''} disabled={sharedSide} onChange={event => setSideLengths(current => current.map((value, sideIndex) => sideIndex === index ? event.target.value : value))} /><span>{lengthUnit}</span></label>
      })}</fieldset>}
      <div className="trace-actions"><button className="text-action" onClick={undoPoint} disabled={!tracePoints.length}><Undo2 /> Undo last corner</button><button className="text-action" onClick={redoPoint} disabled={!traceRedo.length}><RotateCw /> Redo</button><span>{completedTraces.length + 1} plot{completedTraces.length ? 's' : ''} · {fmt(tracePoints.length, 0)} current corners</span>{canApply && <button className="trace-add-shape-button" onClick={startAdjacentTrace}><Plus /> Add adjacent plot</button>}<button className="trace-apply-button" onClick={applyTrace} disabled={!canApply}>{completedTraces.length ? `Use ${completedTraces.length + 1} parcels` : 'Use measured trace'}</button></div>
      <p className="trace-replacement-note">Applying replaces the current plan with these traced parcels.</p>
    </> : <p className="trace-empty-hint">Use a clear, top-down diagram. Mark all parcel corners clockwise or counter-clockwise; you&apos;ll enter every measured side separately.</p>}
    {error && <p className="trace-error" role="alert">{error}</p>}
  </section>
}

function PrintColorKey({ parcels, partitionPieces, shareTargets, paths }: { parcels: Parcel[]; partitionPieces: Record<string, Point[][]>; shareTargets: Record<string, FreeCutTarget[]>; paths: PathShape[] }) {
  const entries = parcels.flatMap((parcel, parcelIndex) => {
    const pieces = partitionPieces[parcel.id]
    if (!pieces?.length) return [{ name: parcel.owner.trim() || parcel.name, color: parcelColors[parcelIndex % parcelColors.length] }]
    return pieces.map((_, pieceIndex) => {
      const owner = shareTargets[parcel.id]?.[pieceIndex]?.owner.trim() || `Co-sharer ${pieceIndex + 1}`
      return { name: owner, color: ownerColor(shareTargets[parcel.id]?.[pieceIndex]?.owner ?? '', shareTargets, pieceIndex) }
    })
  })
  const owners = Array.from(new globalThis.Map<string, { name: string; color: string }>(entries.map(entry => [entry.name.toLocaleLowerCase(), entry])).values())
  return <div className="print-color-key"><strong>Owner &amp; path colors</strong>{owners.map(owner => <span key={`owner-${owner.name}`}><i style={{ backgroundColor: owner.color }} />{owner.name}</span>)}{paths.filter(path => path.isPartitionedParcel && !owners.some(owner => owner.name.toLocaleLowerCase() === (path.owner || path.name).toLocaleLowerCase())).map((path, index) => <span key={`parcel-${path.id}`}><i style={{ backgroundColor: pathColors[index % pathColors.length] }} />{path.owner || path.name}</span>)}{paths.filter(path => !path.isPartitionedParcel).map((path, index) => <span key={`path-${path.id}`}><i className="print-path-swatch" style={{ backgroundColor: pathColors[index % pathColors.length] }} />{path.name} · path</span>)}</div>
}

function ShareTargetEditor({ shareCount, targets, sourceAreaMarla, showFrontage = false, lengthUnit = 'karam', onChange }: { shareCount: number; targets: FreeCutTarget[]; sourceAreaMarla: number; showFrontage?: boolean; lengthUnit?: 'karam' | 'feet'; onChange: (index: number, key: keyof FreeCutTarget, value: string) => void }) {
  if (shareCount < 2) return null
  const assignedArea = targets.slice(0, shareCount).reduce((sum, target) => sum + targetAreaMarla(target, sourceAreaMarla), 0)
  return <fieldset className="share-target-editor">
    <legend>Co-sharer allocation · enter every resulting share</legend>
    <p>Enter an owner and target area for every share. In collective mode, the cut runs continuously across the selected plots while each plot keeps its own calculation record and frontage contribution.</p><p>Targets should total {fmt(sourceAreaMarla, 2)} marla for {sourceAreaMarla === 0 ? 'this land plot' : 'the selected calculation scope'}.</p>
    {Array.from({ length: shareCount }, (_, index) => {
      const target = targets[index] ?? emptyFreeCutTarget()
      return <div className="share-target-row" key={`share-target-${index}`}>
        <label>Share {String(index + 1).padStart(2, '0')} owner<input required aria-label={`Share ${index + 1} owner`} value={target.owner} onChange={event => onChange(index, 'owner', event.target.value)} placeholder={`Co-sharer ${index + 1}`} /></label>
        <label>Target unit<select aria-label={`Share ${index + 1} target unit`} value={target.mode} onChange={event => onChange(index, 'mode', event.target.value)}><option value="area">Kanal–Marla</option><option value="percentage">Percent of plot</option></select></label>
        {target.mode === 'percentage'
          ? <label>Share area<input aria-label={`Share ${index + 1} area percentage`} type="number" min="0.01" max="99.99" step="0.01" value={target.percentage} onChange={event => onChange(index, 'percentage', event.target.value)} placeholder="% of plot" /></label>
          : <div className="share-area-fields"><label>Kanals<input aria-label={`Share ${index + 1} area in kanal`} type="number" min="0" step="0.01" value={target.kanal} onChange={event => onChange(index, 'kanal', event.target.value)} placeholder="Kanals" /></label><label>Marlas<input aria-label={`Share ${index + 1} area in marla`} type="number" min="0" step="0.01" value={target.marla} onChange={event => onChange(index, 'marla', event.target.value)} placeholder="Marlas" /></label></div>}
        {showFrontage && <div className="frontage-input-group"><label>Frontage basis<select aria-label={`Share ${index + 1} frontage basis`} value={target.frontageMode ?? 'length'} onChange={event => onChange(index, 'frontageMode', event.target.value)}><option value="length">Length</option><option value="percentage">Proportion / percentage</option></select></label><label>Road frontage<input aria-label={`Share ${index + 1} road frontage`} type="number" min="0.01" max={target.frontageMode === 'percentage' ? 100 : undefined} step="0.01" value={target.frontage} onChange={event => onChange(index, 'frontage', event.target.value)} placeholder={target.frontageMode === 'percentage' ? '% of road' : lengthUnit === 'feet' ? 'ft' : 'Karams'} /><span>{target.frontageMode === 'percentage' ? '%' : lengthUnit === 'feet' ? 'ft' : 'Karam'}</span></label></div>}
      </div>
    })}
    <p className="share-target-total" aria-live="polite">Entered: {fmt(assignedArea, 2)} / {fmt(sourceAreaMarla, 2)} marla</p>
  </fieldset>
}

function FieldSheet({ parcels, paths = [], direction, unit, areaUnit }: { parcels: Parcel[]; paths?: PathShape[]; direction: Direction; unit: 'karam' | 'feet'; areaUnit: 'marla' | 'sqft' }) {
  return <section className="field-sheet" aria-label="Patwari field calculations">
    <div className="sheet-heading"><div><p className="eyebrow">FIELD BOOK · AREA STATEMENT</p><h2>Patwari calculation sheet</h2><p className="muted">Each portion is reported to the nearest whole marla (least count 1 marla). Lengths are reported to the nearest whole {unit === 'feet' ? 'foot' : 'Karam'}.</p></div><span className="sheet-scale">1 inch = 40 Karam · 1 : 2,640</span></div>
    <section className="owner-area-summary" aria-label="Areas by owner"><div className="sheet-heading"><div><p className="eyebrow">OWNER-WISE SUMMARY</p><h3>Area by owner</h3><p className="muted">Combined measured area for each owner, grouped across all resulting plots.</p></div></div><div className="owner-area-grid">{Array.from(parcels.reduce((totals, parcel) => { const owner = parcel.owner.trim() || 'Owner not named'; totals.set(owner, (totals.get(owner) ?? 0) + portionsAreaTotal(reportPortionsFor(parcel, unit, paths))); return totals }, new globalThis.Map<string, number>()).entries()).map(([owner, area]) => <div className="owner-area-card" key={owner}><span>{owner}</span><strong>{formatArea(area)} <small>Kanal–Marla</small></strong><em>{fmt(marlaFromSqKaram(area), 2)} marla</em></div>)}</div></section>
    {parcels.map((parcel, index) => {
      const portions = reportPortionsFor(parcel, unit, paths)
      const total = portionsAreaTotal(portions)
      const formatLength = (v: number) => formatLengthValue(v, unit)
      const namePoint = (point: Point) => { const originalIndex = parcel.points.findIndex(vertex => samePoint(vertex, point)); return originalIndex >= 0 ? String.fromCharCode(65 + originalIndex) : 'X' }
      return <div className="parcel-calculation" key={parcel.id}>
        <h3><span className="parcel-index">{String(index + 1).padStart(2, '0')}</span>{parcel.name}<span className="owner-name">· {parcel.owner || 'Owner not named'}</span><span className="sheet-total">{formatArea(total)} <small>Kanal–Marla</small></span></h3>
        {portions.map(portion => <div className="portion-block" key={`${parcel.id}-${portion.label}`}>
          <div className="portion-heading"><span className="portion-tag">{portion.label}</span><strong>{portion.kind}</strong><span>{roundMarla(portion.area)} marla · least count 1 marla</span></div>
          <div className="sheet-table-wrap"><table className="sheet-table"><thead><tr><th>East</th><th>West</th><th>South</th><th>North</th><th>Formula / measured values</th><th>Area · Kanal–Marla</th></tr></thead><tbody><tr>
            {(['East', 'West', 'South', 'North'] as const).map(side => <td key={side}>{portion.points.map((p, i) => { const q = portion.points[(i + 1) % portion.points.length]; return cardinalForEdge(p, q, direction) === side ? `${namePoint(p)}–${namePoint(q)} · ${formatLength(distance(p, q))}${isFixedEdge(parcel, p, q) ? ' · FIXED' : ''}` : null }).filter(Boolean).join('; ') || '—'}</td>)}
            <td className="formula-cell">{portion.formula}<small>Reported to nearest 1 marla: {formatArea(portion.area)} Kanal–Marla</small></td><td className="area-cell">{formatArea(portion.area)}<small>{areaUnit === 'sqft' ? `${fmt(roundMarla(portion.area) * 272.25, 2)} sq ft · 1 marla least count` : '1 marla least count'}</small></td>
          </tr></tbody></table></div>
        </div>)}
        {parcel.targetMarla && <p className="target-note">Entered target: {fmt(Number(parcel.targetMarla))} marla · measured result: {fmt(marlaFromSqKaram(total))} marla · difference: {fmt(Number(parcel.targetMarla) - marlaFromSqKaram(total))} marla</p>}
        <div className="parcel-subtotal"><span>Total {parcel.name} ({portions.map(p => p.label).join(' + ')})</span><span>{portions.map(p => fmt(roundedPortionArea(p.area), 0)).join(' + ')} = {fmt(total, 0)} sarsai · <strong>{formatArea(total)} Kanal–Marla</strong></span></div>
      </div>
    })}
    {paths.some(path => !path.isPartitionedParcel) && <section className="path-calculation-section" aria-label="Path area calculations"><div className="sheet-heading"><div><p className="eyebrow">SEPARATE MEASURED FEATURE</p><h2>Path area calculations</h2><p className="muted">Path areas use the same Patwari field formulas and are listed separately, not added to parcel-share totals.</p></div></div>{paths.filter(path => !path.isPartitionedParcel).map((path, pathIndex) => {
      const pathParcel: Parcel = { id: path.id, name: path.name, owner: 'Path', points: path.points, fixedEdges: [], targetMarla: '' }
      const portions = portionsFor(pathParcel, undefined, unit)
      const pathTotal = portionsAreaTotal(portions)
      const namePoint = (point: Point) => String.fromCharCode(65 + path.points.findIndex(vertex => samePoint(vertex, point)))
      return <div className="parcel-calculation path-calculation" key={path.id}><h3><span className="parcel-index">P{pathIndex + 1}</span>{path.name}<span className="owner-name">· {path.mode === 'attached' ? 'Attached to parcel side' : 'Free-drawn'}</span><span className="sheet-total">{formatArea(pathTotal)} <small>Kanal–Marla</small></span></h3>{portions.map(portion => <div className="portion-block" key={`${path.id}-${portion.label}`}><div className="portion-heading"><span className="portion-tag">{portion.label}</span><strong>{portion.kind}</strong><span>{roundMarla(portion.area)} marla · least count 1 marla</span></div><div className="sheet-table-wrap"><table className="sheet-table"><thead><tr><th>East</th><th>West</th><th>South</th><th>North</th><th>Formula / measured values</th><th>Area · Kanal–Marla</th></tr></thead><tbody><tr>{(['East', 'West', 'South', 'North'] as const).map(side => <td key={side}>{portion.points.map((point, index) => { const next = portion.points[(index + 1) % portion.points.length]; return cardinalForEdge(point, next, direction) === side ? `${namePoint(point)}–${namePoint(next)} · ${formatLengthValue(distance(point, next), unit)}` : null }).filter(Boolean).join('; ') || '—'}</td>)}<td className="formula-cell">{portion.formula}<small>Reported to nearest 1 marla: {formatArea(portion.area)} Kanal–Marla</small></td><td className="area-cell">{formatArea(portion.area)}<small>{areaUnit === 'sqft' ? `${fmt(roundMarla(portion.area) * 272.25, 2)} sq ft` : '1 marla least count'}</small></td></tr></tbody></table></div></div>)}<div className="parcel-subtotal"><span>Total {path.name}</span><span>{portions.map(portion => fmt(roundedPortionArea(portion.area), 0)).join(' + ')} = {fmt(pathTotal, 0)} sarsai · <strong>{formatArea(pathTotal)} Kanal–Marla</strong></span></div></div>
    })}</section>}
    <div className="all-parcels-total"><span>Combined area · {parcels.length} resulting parcels</span><strong>{formatArea(parcels.reduce((sum, parcel) => sum + portionsAreaTotal(reportPortionsFor(parcel, unit, paths)), 0))} Kanal–Marla{areaUnit === 'sqft' && <small className="combined-square-feet">{fmt(parcels.reduce((sum, parcel) => sum + portionsAreaTotal(reportPortionsFor(parcel, unit, paths)), 0) * 30.25, 0)} sq ft</small>}</strong></div>
    {paths.some(path => !path.isPartitionedParcel) && <div className="all-parcels-total path-area-total"><span>Separately measured paths · {paths.filter(path => !path.isPartitionedParcel).length}</span><strong>{formatArea(paths.filter(path => !path.isPartitionedParcel).reduce((sum, path) => sum + portionsAreaTotal(portionsFor({ id: path.id, name: path.name, owner: 'Path', points: path.points, fixedEdges: [], targetMarla: '' }, undefined, unit)), 0))} Kanal–Marla</strong></div>}
    <p className="sheet-footnote">Length least count: 1 Karam (or 1 foot when feet are selected) · area least count: 1 marla per portion · 1 Karam = 5.5 feet · 1 square Karam = 1 sarsai · 9 sarsai = 1 marla · 20 marla = 1 kanal.</p>
  </section>
}

export function ParcelWorkspace() {
  const [parcels, setParcels] = useState<Parcel[]>(starterParcels)
  const [unit, setUnit] = useState<'karam' | 'feet'>('karam')
  const [areaUnit, setAreaUnit] = useState<'marla' | 'sqft'>('marla')
  const [direction, setDirection] = useState<Direction>('top')
  const [drawingRotation, setDrawingRotation] = useState(0)
  const [activeTab, setActiveTab] = useState<'survey' | 'calculations'>('survey')
  const [partitionMode, setPartitionMode] = useState<'area-lock' | 'side-length' | 'percentage-share' | 'free-cut' | 'freeform-parcel'>('free-cut')
  const [partitionScope, setPartitionScope] = useState<'selected' | 'all'>('selected')
  const [partitionInputs, setPartitionInputs] = useState<Record<string, { edgeIndex: number; length: string; percentage: string }>>({})
  const [freeCutParcelId, setFreeCutParcelId] = useState(starterParcels[0].id)
  const [freeCutShareCounts, setFreeCutShareCounts] = useState<Record<string, string>>({})
  const [freeCutTargetAreas, setFreeCutTargetAreas] = useState<Record<string, FreeCutTarget[]>>({})
  const [lockFreeCutArea, setLockFreeCutArea] = useState(false)
  const [customPartitions, setCustomPartitions] = useState<Record<string, Point[][]>>({})
  const [paths, setPaths] = useState<PathShape[]>([])
  const [pathMode, setPathMode] = useState<'free' | 'attached'>('free')
  const [collectivePathCut, setCollectivePathCut] = useState(false)
  const [pathDrawingEnabled, setPathDrawingEnabled] = useState(false)
  const [pathDraftPoints, setPathDraftPoints] = useState<Point[]>([])
  const [pathParcelId, setPathParcelId] = useState(starterParcels[0].id)
  const [pathEdgeIndex, setPathEdgeIndex] = useState(0)
  const [pathWidth, setPathWidth] = useState('')
  const [pathWidenSide, setPathWidenSide] = useState<'left' | 'right'>('left')
  const [pathDeductionMode, setPathDeductionMode] = useState<'proportionate' | 'owner'>('proportionate')
  const [pathDeductionOwner, setPathDeductionOwner] = useState('')
  const [partitionParcelOwner, setPartitionParcelOwner] = useState('')
  const [measureMode, setMeasureMode] = useState(false)
  const [measurementPoints, setMeasurementPoints] = useState<Point[]>([])
  const [targetTotalAreaMarla, setTargetTotalAreaMarla] = useState('')
  const [keepOuterVertices, setKeepOuterVertices] = useState(true)
  const [draftCut, setDraftCut] = useState<DraftCut | null>(null)
  const [partialCuts, setPartialCuts] = useState<PartialCut[]>([])
  const [allowPartialCuts, setAllowPartialCuts] = useState(true)
  const [distanceParcelId, setDistanceParcelId] = useState('')
  const [distanceStartIndex, setDistanceStartIndex] = useState(0)
  const [distanceEndIndex, setDistanceEndIndex] = useState(2)
  const [distanceTarget, setDistanceTarget] = useState('')
  const [isTracing, setIsTracing] = useState(false)
  const [message, setMessage] = useState('')
  const undoHistory = useRef<WorkspaceSnapshot[]>([])
  const [undoCount, setUndoCount] = useState(0)
  const reportParcels = useMemo(() => parcels.flatMap(parcel => {
    const pieces = customPartitions[parcel.id]
    if (!pieces?.length) return [parcel]
    const sourceAreaMarla = polygonArea(parcel.points) / 9
    return pieces.map((points, index) => {
      const target = freeCutTargetAreas[parcel.id]?.[index]
      const areaMarla = target ? targetAreaMarla(target, sourceAreaMarla) : 0
      return { ...parcel, id: `${parcel.id}-share-${index + 1}`, name: `Share ${String(index + 1).padStart(2, '0')} · ${parcel.name}`, owner: target?.owner.trim() || `Co-sharer ${index + 1}`, targetMarla: areaMarla > 0 ? String(areaMarla) : '', points, fixedEdges: Array(points.length).fill(false), sameEdges: Array(points.length).fill(false), isShare: true }
    })
  }).concat(paths.filter(path => path.isPartitionedParcel).map(path => ({ id: path.id, name: path.name, owner: path.owner || 'New owner', points: path.points, fixedEdges: Array(path.points.length).fill(false), sameEdges: Array(path.points.length).fill(false), targetMarla: '', isShare: true }))), [parcels, customPartitions, freeCutTargetAreas, paths])
  const portions = useMemo(() => parcels.map(parcel => portionsFor(parcel, customPartitions[parcel.id], unit)), [parcels, customPartitions, unit])
  const reportPortions = useMemo(() => reportParcels.map(parcel => reportPortionsFor(parcel, unit, paths)), [reportParcels, unit, paths])
  const collectiveMeasuredArea = parcels.reduce((sum, sourceParcel) => sum + polygonArea(sourceParcel.points), 0)
  const totalArea = partitionScope === 'all' ? collectiveMeasuredArea : reportPortions.flat().reduce((sum, portion) => sum + roundedPortionArea(portion.area), 0)
  const hull = useMemo(() => convexHull(parcels.flatMap(p => p.points)), [parcels])
  const sharedSides = parcels.reduce((count, parcel) => count + parcel.points.filter((point, i) => sharedEdge(point, parcel.points[(i + 1) % parcel.points.length], parcels)).length, 0) / 2
  const traceApplied = parcels.some(parcel => parcel.id.startsWith('p-photo-'))
  const selectedFreeCutParcel = parcels.find(parcel => parcel.id === freeCutParcelId)
  const selectedPathParcel = parcels.find(parcel => parcel.id === pathParcelId) ?? parcels[0]
  const measuredPaths = paths.filter(path => !path.isPartitionedParcel)
  const pathAreaTotal = measuredPaths.reduce((sum, path) => sum + portionsAreaTotal(portionsFor({ id: path.id, name: path.name, owner: 'Path', points: path.points, fixedEdges: [], targetMarla: '' }, undefined, unit)), 0)
  const requestedShareCount = Number(freeCutShareCounts[freeCutParcelId])
  const currentFreeCutPieces = selectedFreeCutParcel ? (customPartitions[selectedFreeCutParcel.id] ?? [selectedFreeCutParcel.points]).length : 0
  const freeCutTargetInputs = freeCutTargetAreas[freeCutParcelId] ?? []
  const freeCutTargetCount = Number.isInteger(requestedShareCount) && requestedShareCount >= 2 && requestedShareCount <= 20 ? requestedShareCount : 0
  const nextTargetIndex = Math.min(Math.max(currentFreeCutPieces - 1, 0), Math.max(freeCutTargetCount - 2, 0))
  const nextTargetInput = freeCutTargetInputs[nextTargetIndex] ?? emptyFreeCutTarget()
  const selectedPartitionInput = partitionInputs[freeCutParcelId] ?? { edgeIndex: 0, length: '', percentage: '50' }
  const selectedParcelAreaMarla = selectedFreeCutParcel ? polygonArea(selectedFreeCutParcel.points) / 9 : 0
  const collectiveAreaMarla = parcels.reduce((sum, sourceParcel) => sum + polygonArea(sourceParcel.points) / 9, 0)
  const shareTargetSourceAreaMarla = partitionScope === 'all' ? collectiveAreaMarla : selectedParcelAreaMarla
  const targetFreeCutAreaMarla = selectedFreeCutParcel ? targetAreaMarla(nextTargetInput, partitionScope === 'all' ? collectiveAreaMarla : selectedParcelAreaMarla) : 0
  const shareTargetsComplete = hasCompleteShareTargets(freeCutTargetInputs, freeCutTargetCount, shareTargetSourceAreaMarla)
  const hasTargetFreeCutArea = Number.isFinite(targetFreeCutAreaMarla) && targetFreeCutAreaMarla > 0 && targetFreeCutAreaMarla < selectedParcelAreaMarla
  const freeCutSetupReady = Number.isInteger(requestedShareCount) && requestedShareCount >= 2 && requestedShareCount <= 20
  const freeCutEnabled = partitionMode === 'free-cut' && (partitionScope === 'all' || allowPartialCuts || (freeCutSetupReady && shareTargetsComplete && currentFreeCutPieces < requestedShareCount)) || partitionMode === 'area-lock' && freeCutSetupReady && shareTargetsComplete && currentFreeCutPieces < requestedShareCount
  const effectiveDirection = directionAfterRotation(direction, drawingRotation)

  function downloadScaledPdf() {
    const angle = { top: 0, right: 90, bottom: 180, left: 270 }[direction] + drawingRotation
    const transform = (point: Point) => rotated(point, angle)
    try {
      const outlines = [...parcels.map(parcel => parcel.points), ...paths.filter(path => path.isPartitionedParcel).map(path => path.points)].map(shape => shape.map(transform))
      const cuts = [
        ...parcels.flatMap(parcel => interiorCutLines(parcel, customPartitions[parcel.id] ?? [])),
        ...partialCuts.map(cut => [cut.start, cut.end] as [Point, Point]),
      ].map(([a, b]) => [transform(a), transform(b)] as [Point, Point])
      const result = makeScaledSurveyPdf({ outlines, cuts })
      const blob = new Blob([new Uint8Array(result)], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'land-parcels-scaled-40-karam-per-inch.pdf'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('True-scale vector PDF exported: 40 karam per inch, no labels, header or footer. The plan is tiled onto A4 landscape pages when needed.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create the scaled PDF.') }
  }

  function applyEnteredDistance() {
    const parcel = parcels.find(p => p.id === (distanceParcelId || parcels[0]?.id))
    const desired = unit === 'feet' ? fromFeet(Number(distanceTarget)) : Number(distanceTarget)
    if (!parcel || !distanceTarget.trim() || !Number.isFinite(desired) || desired <= 0) { setMessage('Enter a positive distance between two selected corners.'); return }
    const first = parcel.points[distanceStartIndex], second = parcel.points[distanceEndIndex]
    if (!first || !second || distanceStartIndex === distanceEndIndex) { setMessage('Choose two different existing corner points.'); return }
    // Exterior vertices are anchored; only an interior corner may move to
    // satisfy a new diagonal or other requested two-point distance.
    const fixedPoints = parcels.flatMap(p => p.fixedEdges.flatMap((locked, i) => locked ? [p.points[i], p.points[(i + 1) % p.points.length]] : []))
    const movable = [second, first].find(point => !isPlanExteriorVertex(point, parcels) && !fixedPoints.some(fixed => samePoint(fixed, point)))
    if (!movable) {
      // A four-sided plot's diagonal can change while *every perimeter side*
      // retains its measured length. Solve the two side triangles by circles.
      const opposite = parcel.points.length === 4 && (distanceStartIndex + 2) % 4 === distanceEndIndex
      const sharesCorner = parcels.some(other => other.id !== parcel.id && parcel.points.some(point => other.points.some(otherPoint => samePoint(point, otherPoint))))
      if (opposite && distance(first, second) > EPS && !sharesCorner && !parcel.fixedEdges.some(Boolean)) {
        const order = [0, 1, 2, 3].map(offset => (distanceStartIndex + offset) % 4)
        const [iA, iB, iC, iD] = order
        const [a, b, c, d] = order.map(index => parcel.points[index])
        const originalDiagonal = distance(a, c)
        const lengths = [distance(a, b), distance(b, c), distance(c, d), distance(d, a)]
        const trianglePoint = (ab: number, bc: number, originalPoint: Point): Point | null => {
          if (desired >= ab + bc - EPS || desired <= Math.abs(ab - bc) + EPS) return null
          const along = (ab * ab - bc * bc + desired * desired) / (2 * desired)
          const normal = Math.sqrt(Math.max(0, ab * ab - along * along))
          const ex = (c.x - a.x) / originalDiagonal, ey = (c.y - a.y) / originalDiagonal
          const sign = Math.sign(cross(a, c, originalPoint)) || 1
          return { x: a.x + ex * along - ey * normal * sign, y: a.y + ey * along + ex * normal * sign }
        }
        const newB = trianglePoint(lengths[0], lengths[1], b)
        const newD = trianglePoint(lengths[3], lengths[2], d)
        if (newB && newD && originalDiagonal > EPS) {
          const newC = { x: a.x + (c.x - a.x) * desired / originalDiagonal, y: a.y + (c.y - a.y) * desired / originalDiagonal }
          const updatedPoints = [...parcel.points]
          updatedPoints[iB] = newB; updatedPoints[iC] = newC; updatedPoints[iD] = newD
          if (isSimplePolygon(updatedPoints)) {
            recordUndo()
            clearCuts()
            setParcels(current => current.map(p => p.id === parcel.id ? { ...p, points: updatedPoints } : p))
            setMessage(`Diagonal updated to ${fmt(Number(distanceTarget), 2)} ${unit}. All four external side lengths remain unchanged; the parcel angles and enclosed area were recalculated.`)
            return
          }
        }
        setMessage('These four fixed side lengths cannot enclose the requested diagonal. Enter a feasible diagonal distance.')
        return
      }
      setMessage(`Existing length: ${fmt(unit === 'feet' ? toFeet(distance(first, second)) : distance(first, second), 2)} ${unit}. No movable interior point is available. For a standalone four-sided plot, select opposite corners to change the diagonal without changing its four external side lengths. Shared or locked boundary geometry cannot be changed independently.`)
      return
    }
    const fixed = samePoint(movable, second) ? first : second
    const old = distance(fixed, movable)
    if (old < EPS) { setMessage('The selected points coincide. Choose different corners.'); return }
    const replacement = { x: fixed.x + (movable.x - fixed.x) * desired / old, y: fixed.y + (movable.y - fixed.y) * desired / old }
    const proposed = parcels.map(p => ({ ...p, points: p.points.map(point => samePoint(point, movable) ? replacement : point) }))
    if (proposed.some(p => !isSimplePolygon(p.points) || polygonArea(p.points) < EPS)) { setMessage('That distance would fold or invalidate a parcel. Try a different distance.'); return }
    if (proposed.some((p, index) => proposed.slice(index + 1).some(q => polygonIntersectionArea(p.points, q.points) > 0.001))) { setMessage('That distance causes parcels to overlap. Adjust another internal corner instead.'); return }
    recordUndo()
    clearCuts()
    setParcels(proposed)
    setMessage(`Distance set to ${fmt(Number(distanceTarget), 2)} ${unit}, with external vertices and fixed sides unchanged. Review the updated interior side measurements.`)
  }

  function saveDraft() {
    const snapshot: WorkspaceSnapshot = { parcels, customPartitions, paths, partialCuts, freeCutTargetAreas, freeCutShareCounts }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'fieldline-parcel-draft.json'
    link.click()
    URL.revokeObjectURL(url)
    setMessage('Draft saved as a JSON file.')
  }

  function loadDraft(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    file.text().then(text => {
      try {
        const snapshot = JSON.parse(text) as WorkspaceSnapshot
        if (!Array.isArray(snapshot.parcels) || !Array.isArray(snapshot.paths)) throw new Error('invalid')
        recordUndo()
        setParcels(snapshot.parcels)
        setCustomPartitions(snapshot.customPartitions ?? {})
        setPaths(snapshot.paths)
        setPartialCuts(snapshot.partialCuts ?? [])
        setFreeCutTargetAreas(snapshot.freeCutTargetAreas ?? {})
        setFreeCutShareCounts(snapshot.freeCutShareCounts ?? {})
        setFreeCutParcelId(snapshot.parcels[0]?.id ?? starterParcels[0].id)
        setMessage('Saved draft loaded.')
      } catch { setMessage('That file is not a valid Fieldline draft.') }
    })
  }

  function recordUndo() {
    undoHistory.current = [...undoHistory.current, { parcels, customPartitions, paths, partialCuts, freeCutTargetAreas, freeCutShareCounts }].slice(-50)
    setUndoCount(undoHistory.current.length)
  }

  function undoLastEdit() {
    const previous = undoHistory.current.pop()
    if (!previous) return
    setParcels(previous.parcels)
    setCustomPartitions(previous.customPartitions)
    setPaths(previous.paths)
    setPartialCuts(previous.partialCuts ?? [])
    setFreeCutTargetAreas(previous.freeCutTargetAreas)
    setFreeCutShareCounts(previous.freeCutShareCounts)
    setDraftCut(null)
    setPathDraftPoints([])
    setPathDrawingEnabled(false)
    setUndoCount(undoHistory.current.length)
    setMessage('Last plan edit undone.')
  }

  function clearCuts() { setPartialCuts([]); setCustomPartitions({}); setPaths(current => current.filter(path => !path.isPartitionedParcel)); setDraftCut(null) }
  function addPath(points: Point[], mode: PathShape['mode'], parcelId: string, widthKaram: number, edgeIndex?: number, isPartitionedParcel = false, owner = '') {
  const parcel = parcels.find(candidate => candidate.id === parcelId)
  const minimumPoints = isPartitionedParcel ? 3 : 2
  const hasDistinctPathPoints = points.length >= 2 && distance(points[0], points[1]) > EPS
  const hasRequiredShape = isPartitionedParcel ? polygonArea(points) >= EPS : (points.length === 2 ? hasDistinctPathPoints : polygonArea(points) >= EPS)
  if (!parcel || points.length < minimumPoints || !hasRequiredShape) { setMessage(isPartitionedParcel ? 'Draw at least three distinct corners for the parcel outline.' : 'Mark at least two distinct points along the path.'); return }
  if (isPartitionedParcel && !isSimplePolygon(points)) { setMessage('The parcel outline must be a simple closed shape without crossing edges.'); return }
  const intersectingParcels = parcels.filter(candidate => polygonIntersectionArea(points, candidate.points) > EPS || polygonsOverlapOrCross(points, candidate.points) || isAreaContained(points, candidate))
  const collectivePath = !isPartitionedParcel && collectivePathCut && intersectingParcels.length > 1
  if (!collectivePath && !isAreaContained(points, parcel)) { setMessage(`Keep the full ${isPartitionedParcel ? 'parcel outline' : mode === 'free' ? 'path-width outline' : 'attached path'} inside ${parcel.name}.`); return }
  if (paths.some(path => intersectingParcels.some(candidate => candidate.id === path.attachedParcelId) && polygonIntersectionArea(path.points, points) > EPS)) { setMessage('This outline overlaps an existing path or parcel feature.'); return }
    const partitionNumber = parcels.length + paths.filter(path => path.isPartitionedParcel).length + 1
    const path: PathShape = { id: `path-${Date.now()}`, name: isPartitionedParcel ? `Parcel ${String(partitionNumber + paths.filter(path => path.isPartitionedParcel && path.name === parcel.name).length).padStart(2, '0')}` : `Path ${paths.filter(item => !item.isPartitionedParcel).length + 1}`, mode, points, attachedParcelId: parcelId, attachedParcelIds: intersectingParcels.map(candidate => candidate.id), attachedEdgeIndex: edgeIndex, widthKaram, isPartitionedParcel, owner: owner.trim(), deductionMode: isPartitionedParcel ? undefined : pathDeductionMode, deductionOwner: isPartitionedParcel ? undefined : pathDeductionOwner.trim() }
    recordUndo()
    setPaths(current => [...current, path])
    setPathDraftPoints([])
    setPathDrawingEnabled(false)
    setMessage(isPartitionedParcel ? `${path.name} for ${path.owner} created inside ${parcel.name}. Its area is deducted from the surrounding plot and reported as a separate parcel.` : `${path.name} added inside ${parcel.name}. Its area is deducted from that plot and shown separately.`)
  }
  function addPathVertex(point: Point) {
    if (pathMode === 'free' && partitionMode !== 'freeform-parcel') {
      const widthInput = Number(pathWidth)
      if (!Number.isFinite(widthInput) || widthInput <= 0) {
        setMessage('Enter a positive path width before marking the path centerline.')
        return
      }
    }
    setPathDraftPoints(current => [...current, point])
  }
  function addMeasurementPoint(point: Point) { setMeasurementPoints(current => current.length >= 2 ? [point] : [...current, point]) }
  function finishFreePath() {
    const widthInput = Number(pathWidth)
    const width = unit === 'feet' ? fromFeet(widthInput) : widthInput
    if (!selectedPathParcel || !Number.isFinite(width) || width <= EPS) { setMessage('Enter a positive path width before drawing the free path.'); return }
    const centerline = pathDraftPoints.filter((point, index, points) => index === 0 || distance(point, points[index - 1]) > EPS)
    if (centerline.length < 2) { setMessage('Mark at least two distinct points along the path centerline.'); return }
const outline = bufferPolyline(centerline, width, pathWidenSide)
  addPath(outline, 'free', selectedPathParcel.id, width)
  }
  function finishFreeformParcel() {
    if (!selectedPathParcel) return
    const owner = partitionParcelOwner.trim()
    if (!owner) { setMessage('Enter the new parcel owner before drawing its boundary.'); return }
    const outline = pathDraftPoints.filter((point, index, points) => index === 0 || !samePoint(point, points[index - 1]))
    if (outline.length > 2 && samePoint(outline[0], outline[outline.length - 1])) outline.pop()
    if (!isSimplePolygon(outline)) { setMessage('Mark at least three distinct corners and keep the closed outline free of crossing edges.'); return }
    addPath(outline, 'free', selectedPathParcel.id, 0, undefined, true, owner)
  }
  function addAttachedPath() {
    if (!selectedPathParcel) return
    const widthInput = Number(pathWidth)
    const width = unit === 'feet' ? fromFeet(widthInput) : widthInput
    const edgeIndex = Math.max(0, Math.min(pathEdgeIndex, selectedPathParcel.points.length - 1))
    const start = selectedPathParcel.points[edgeIndex]
    const end = selectedPathParcel.points[(edgeIndex + 1) % selectedPathParcel.points.length]
    const edgeLength = distance(start, end)
    if (!Number.isFinite(width) || width <= EPS || edgeLength <= EPS) { setMessage('Enter a positive path width before adding the path.'); return }
    const orientation = Math.sign(selectedPathParcel.points.reduce((sum, point, index) => sum + point.x * selectedPathParcel.points[(index + 1) % selectedPathParcel.points.length].y - selectedPathParcel.points[(index + 1) % selectedPathParcel.points.length].x * point.y, 0)) || 1
    const offset = { x: -orientation * (end.y - start.y) / edgeLength * width, y: -orientation * (start.x - end.x) / edgeLength * width }
    const points = [start, end, { x: end.x + offset.x, y: end.y + offset.y }, { x: start.x + offset.x, y: start.y + offset.y }]
    addPath(points, 'attached', selectedPathParcel.id, width, edgeIndex)
  }
  function updateFreeCutTarget(parcelId: string, targetIndex: number, key: keyof FreeCutTarget, value: string) {
    setFreeCutTargetAreas(current => {
      const targets = [...(current[parcelId] ?? [])]
      const target = { ...(targets[targetIndex] ?? emptyFreeCutTarget()) }
      if (key === 'mode') target.mode = value as FreeCutTarget['mode']
      else if (key === 'kanal') target.kanal = value
      else if (key === 'marla') target.marla = value
      else if (key === 'owner') target.owner = value
      else if (key === 'percentage') target.percentage = value
      else target.frontage = value
      targets[targetIndex] = target
      return { ...current, [parcelId]: targets }
    })
  }
  function useTracedPoints(shapes: Point[][]) {
    recordUndo()
    clearCuts()
    const timestamp = Date.now()
    const tracedParcels = shapes.map((points, index) => ({ id: `p-photo-${timestamp}-${index}`, name: `Parcel ${String(index + 1).padStart(2, '0')}`, owner: '', targetMarla: '', fixedEdges: Array(points.length).fill(false), points }))
    setParcels(tracedParcels)
    setFreeCutParcelId(tracedParcels[0].id)
    setFreeCutShareCounts({})
    setPartitionMode('free-cut')
    setIsTracing(false)
    setMessage(`${tracedParcels.length} parcel${tracedParcels.length === 1 ? '' : 's'} traced from the photo. Shared sides stay aligned; measured areas are calculated separately.`)
  }
  function completeFreeCut(cut: DraftCut) {
    // Free collective mode draws directly on the assembled geometry. No parcel
    // selection, owners, count or area-target configuration is required.
    if (partitionMode === 'free-cut' && (partitionScope === 'all' || allowPartialCuts)) {
      const sourceParcels = partitionScope === 'all' ? parcels : parcels.filter(parcel => parcel.id === cut.parcelId)
      const staged: Record<string, Point[][]> = {}
      const strokes: PartialCut[] = []
      let splitCount = 0
      for (const sourceParcel of sourceParcels) {
        const currentPieces = customPartitions[sourceParcel.id] ?? [sourceParcel.points]
        const nextPieces: Point[][] = []
        for (const piece of currentPieces) {
          const clipped = clipStrokeToPolygon(piece, cut.start, cut.end)
          if (!clipped.length) { nextPieces.push(piece); continue }
          // A chord really divides only when the user drew all the way from
          // boundary to boundary. Interior endpoints never extend implicitly.
          let split: Point[][] | null = null
          if (clipped.length === 1) {
            const [a, b] = clipped[0]
            const onEdge = (p: Point) => piece.some((v, i) => isOnSegment(p, v, piece[(i + 1) % piece.length]))
            if (onEdge(a) && onEdge(b)) split = splitPolygonByChord(piece, a, b)
          }
          if (split) { nextPieces.push(...split); splitCount++ }
          else {
            nextPieces.push(piece)
            if (allowPartialCuts) for (const [start, end] of clipped) strokes.push({ id: `partial-${Date.now()}-${strokes.length}`, parcelId: sourceParcel.id, start, end })
          }
        }
        staged[sourceParcel.id] = nextPieces
      }
      if (!splitCount && !strokes.length) { setMessage('No valid cut fell within the land boundaries. Enable partial cuts to retain interior-ended strokes.'); return }
      recordUndo()
      setCustomPartitions(current => ({ ...current, ...staged }))
      if (strokes.length) setPartialCuts(current => [...current, ...strokes])
      setMessage(`${splitCount} boundary-to-boundary division${splitCount === 1 ? '' : 's'} created; ${strokes.length} partial segment${strokes.length === 1 ? '' : 's'} retained. Interior-ended segments are survey marks, not enclosed new parcels.`)
      return
    }
    const parcel = parcels.find(candidate => candidate.id === cut.parcelId)
    if (!parcel || cut.parcelId !== freeCutParcelId) return
    const targetShareCount = Number(freeCutShareCounts[parcel.id])
    const targets = freeCutTargetAreas[parcel.id] ?? []
    const sourceAreaMarla = polygonArea(parcel.points) / 9
    const pieces = customPartitions[parcel.id] ?? [parcel.points]
    if (!Number.isInteger(targetShareCount) || targetShareCount < 2 || targetShareCount > 20) { setMessage('Choose a target of 2–20 shares before drawing a free-style cut.'); return }
    if (!hasCompleteShareTargets(targets, targetShareCount, sourceAreaMarla)) { setMessage('Enter an owner and area target for every share; all targets must add up to the land plot area.'); return }
    if (pieces.length >= targetShareCount) { setMessage(`This land plot already has the requested ${targetShareCount} shares.`); return }
    const targetShareIndex = pieces.length - 1
    const targetMarla = targetAreaMarla(targets[targetShareIndex], sourceAreaMarla)
    const midpoint = { x: (cut.start.x + cut.end.x) / 2, y: (cut.start.y + cut.end.y) / 2 }
    const targetPieceIndex = pieces.findIndex(piece => pointInPolygon(midpoint, piece))
    if (targetPieceIndex < 0) { setMessage('Place both cut points inside the selected plot; the cut continues to its boundary automatically.'); return }
    if (targetPieceIndex !== pieces.length - 1) { setMessage('Continue dividing the unassigned remainder; completed co-sharer shares stay unchanged.'); return }
    const guide = cut.lockTargetArea ? findTargetAreaGuide(pieces[targetPieceIndex], cut.start, cut.end, targetMarla) : null
    const cutStart = cut.lockTargetArea && guide ? guide.start : cut.start
    const cutEnd = cut.lockTargetArea && guide ? guide.end : cut.end
    const split = splitPolygonByCutLine(pieces[targetPieceIndex], cutStart, cutEnd)
    if (!split) { setMessage('That line could not divide the land plot. Place both points inside the remaining area and try a different angle.'); return }
    const targetIndex = split.reduce((bestIndex, piece, index) => Math.abs(polygonArea(piece) - targetMarla * 9) < Math.abs(polygonArea(split[bestIndex]) - targetMarla * 9) ? index : bestIndex, 0)
    if (cut.lockTargetArea && Math.abs(polygonArea(split[targetIndex]) - targetMarla * 9) > 0.05) { setMessage(`The locked target of ${fmt(targetMarla, 2)} marla is not reachable from this point. Move the start point or turn off Area lock.`); return }
    const orderedSplit = [split[targetIndex], split[1 - targetIndex]]
    const updatedPieces = [...pieces.slice(0, targetPieceIndex), ...orderedSplit, ...pieces.slice(targetPieceIndex + 1)]
    recordUndo()
    setCustomPartitions(current => ({ ...current, [parcel.id]: updatedPieces }))
    const updatedAreas = updatedPieces.map((piece, index) => `${targets[index]?.owner.trim() || `Share ${index + 1}`} · ${formatArea(polygonArea(piece))}`).join(' · ')
    setMessage(updatedPieces.length === targetShareCount
      ? `${parcel.name} is now divided into ${targetShareCount} shares. Resulting parcels: ${updatedAreas}.`
      : `Cut ${updatedPieces.length - 1} of ${targetShareCount - 1} complete · ${updatedPieces.length} resulting shares. Draw the next cut.`)
  }

  function setPartitionInput(parcelId: string, key: 'edgeIndex' | 'length' | 'percentage', value: number | string) {
    setPartitionInputs(current => ({ ...current, [parcelId]: { edgeIndex: current[parcelId]?.edgeIndex ?? 0, length: current[parcelId]?.length ?? '', percentage: current[parcelId]?.percentage ?? '50', [key]: value } }))
  }

  function buildCollectiveAreaPieces(parcel: Parcel, targets: FreeCutTarget[], targetCount: number, totalAreaMarla: number) {
    const localAreaMarla = polygonArea(parcel.points) / 9
    const localTargets = targets.map(target => ({ ...target, mode: 'percentage' as const, percentage: String(targetAreaMarla(target, totalAreaMarla) / totalAreaMarla * 100) }))
    if (!hasCompleteShareTargets(localTargets, targetCount, localAreaMarla)) return null
    const settings = partitionInputs[parcel.id] ?? { edgeIndex: 0, length: '', percentage: '50' }
    const pieces: Point[][] = [parcel.points]
    for (let shareIndex = 0; shareIndex < targetCount - 1; shareIndex++) {
      const targetArea = targetAreaMarla(localTargets[shareIndex], localAreaMarla)
      const candidate = pieces[pieces.length - 1]
      const edgeIndex = settings.edgeIndex % candidate.length
      const edgeStart = candidate[edgeIndex], edgeEnd = candidate[(edgeIndex + 1) % candidate.length]
      const start = { x: (edgeStart.x + edgeEnd.x) / 2, y: (edgeStart.y + edgeEnd.y) / 2 }
      if (targetArea * 9 >= polygonArea(candidate) - EPS) return null
      const cursor = candidate.reduce((farthest, point) => distance(start, point) > distance(start, farthest) ? point : farthest, candidate[0])
      const guide = findTargetAreaGuide(candidate, start, cursor, targetArea)
      const split = guide ? splitPolygonByChord(candidate, guide.start, guide.end) : null
      if (!split) return null
      const targetIndex = split.reduce((bestIndex, piece, index) => Math.abs(polygonArea(piece) - targetArea * 9) < Math.abs(polygonArea(split[bestIndex]) - targetArea * 9) ? index : bestIndex, 0)
      if (Math.abs(polygonArea(split[targetIndex]) - targetArea * 9) > 0.05) return null
      pieces.splice(pieces.length - 1, 1, split[targetIndex], split[1 - targetIndex])
    }
    return pieces
  }

  function applyAreaGuidedShares(parcel: Parcel, useRoadFrontage: boolean) {
    const collective = partitionScope === 'all' && !useRoadFrontage
    const targetCount = Number(freeCutShareCounts[freeCutParcelId])
    const targetsForCollective = freeCutTargetAreas[freeCutParcelId] ?? []
    const totalAreaMarla = parcels.reduce((sum, sourceParcel) => sum + polygonArea(sourceParcel.points) / 9, 0)
    if (collective) {
      if (!Number.isInteger(targetCount) || targetCount < 2 || targetCount > 20 || !hasCompleteShareTargets(targetsForCollective, targetCount, totalAreaMarla)) {
        setMessage('Enter owners and area targets for all shares; their total must match the combined area of every plot.')
        return
      }
      const staged: Record<string, Point[][]> = {}
      for (const sourceParcel of parcels) {
        const pieces = buildCollectiveAreaPieces(sourceParcel, targetsForCollective, targetCount, totalAreaMarla)
        if (!pieces) { setMessage(`Could not match all collective share targets within ${sourceParcel.name}. Try a different cut side or revise the target areas.`); return }
        staged[sourceParcel.id] = pieces
      }
      const localTargetsByParcel = Object.fromEntries(parcels.map(sourceParcel => [sourceParcel.id, targetsForCollective.map(target => ({ ...target, mode: 'percentage' as const, percentage: String(targetAreaMarla(target, totalAreaMarla) / totalAreaMarla * 100) }))]))
      recordUndo()
      setCustomPartitions(current => ({ ...current, ...staged }))
      setFreeCutTargetAreas(current => ({ ...current, ...localTargetsByParcel }))
      setFreeCutShareCounts(current => ({ ...current, ...Object.fromEntries(parcels.map(sourceParcel => [sourceParcel.id, String(targetCount)])) }))
      setMessage(`All ${parcels.length} plots are partitioned collectively into ${targetCount} co-shares. Each owner’s area target is distributed proportionally across the plots.`)
      return
    }
    const settings = partitionInputs[parcel.id] ?? { edgeIndex: 0, length: '', percentage: '50' }
    const targets = freeCutTargetAreas[parcel.id] ?? []
    const sourceAreaMarla = polygonArea(parcel.points) / 9
    const pieces = [parcel.points]
    const referenceStart = parcel.points[settings.edgeIndex % parcel.points.length]
    const referenceEnd = parcel.points[(settings.edgeIndex + 1) % parcel.points.length]
    const referenceLength = distance(referenceStart, referenceEnd)
    const referenceDirection = referenceLength > EPS ? { x: (referenceEnd.x - referenceStart.x) / referenceLength, y: (referenceEnd.y - referenceStart.y) / referenceLength } : { x: 0, y: 0 }
    const requestedFrontages = targets.slice(0, targetCount).map(target => unit === 'feet' ? fromFeet(Number(target.frontage)) : Number(target.frontage))
    if (!Number.isInteger(targetCount) || targetCount < 2 || targetCount > 20) { setMessage('Enter a target share count from 2 to 20 before applying this partition.'); return }
    if (!hasCompleteShareTargets(targets, targetCount, sourceAreaMarla)) { setMessage('Enter an owner and area target for every share; all targets must add up to the land plot area.'); return }
    if (useRoadFrontage && (requestedFrontages.some(frontage => !Number.isFinite(frontage) || frontage <= EPS) || Math.abs(requestedFrontages.reduce((sum, frontage) => sum + frontage, 0) - referenceLength) > 0.05)) { setMessage(`Enter a positive roadside frontage for every co-sharer; the frontages must total ${formatLengthValue(referenceLength, unit)}.`); return }
    let frontageCursor = referenceStart
    for (let shareIndex = 0; shareIndex < targetCount - 1; shareIndex++) {
      const targetArea = targetAreaMarla(targets[shareIndex], sourceAreaMarla)
      const candidateIndex = pieces.length - 1
      const candidate = pieces[candidateIndex]
      let edgeIndex = settings.edgeIndex % candidate.length
      let start: Point
      let requiredPoint: Point | undefined
      if (useRoadFrontage) {
        edgeIndex = candidate.findIndex((point, index) => {
          const next = candidate[(index + 1) % candidate.length]
          return isOnSegment(frontageCursor, point, next) && isOnSegment(point, referenceStart, referenceEnd) && isOnSegment(next, referenceStart, referenceEnd)
        })
        if (edgeIndex < 0) { setMessage(`The remaining shape no longer has a continuous frontage for ${targets[shareIndex].owner}.`); return }
        const frontage = requestedFrontages[shareIndex]
        const edgeStart = candidate[edgeIndex], edgeEnd = candidate[(edgeIndex + 1) % candidate.length]
        const nextFrontagePoint = { x: frontageCursor.x + referenceDirection.x * frontage, y: frontageCursor.y + referenceDirection.y * frontage }
        if (!isOnSegment(nextFrontagePoint, edgeStart, edgeEnd) || distance(frontageCursor, referenceEnd) + EPS < frontage) { setMessage(`${targets[shareIndex].owner}’s roadside frontage does not fit the remaining boundary.`); return }
        start = nextFrontagePoint
        requiredPoint = frontageCursor
      } else {
        const edgeStart = candidate[edgeIndex], edgeEnd = candidate[(edgeIndex + 1) % candidate.length]
        start = { x: (edgeStart.x + edgeEnd.x) / 2, y: (edgeStart.y + edgeEnd.y) / 2 }
      }
      if (targetArea * 9 >= polygonArea(candidate) - EPS) { setMessage(`Share ${shareIndex + 1} is larger than the remaining area.`); return }
      const cursor = candidate.reduce((farthest, point) => distance(start, point) > distance(start, farthest) ? point : farthest, candidate[0])
      const guide = findTargetAreaGuide(candidate, start, cursor, targetArea, requiredPoint)
      const split = guide ? splitPolygonByChord(candidate, guide.start, guide.end) : null
      if (!split) { setMessage(`Could not place share ${shareIndex + 1} at its target area from the selected side. Try a different frontage or free-style cut.`); return }
      const targetIndex = requiredPoint ? split.findIndex(piece => pointInPolygon(requiredPoint, piece)) : split.reduce((bestIndex, piece, index) => Math.abs(polygonArea(piece) - targetArea * 9) < Math.abs(polygonArea(split[bestIndex]) - targetArea * 9) ? index : bestIndex, 0)
      if (targetIndex < 0 || Math.abs(polygonArea(split[targetIndex]) - targetArea * 9) > 0.05) { setMessage(`Could not match share ${shareIndex + 1} to its entered area on this side.`); return }
      pieces.splice(candidateIndex, 1, split[targetIndex], split[1 - targetIndex])
      if (useRoadFrontage) frontageCursor = start
    }
    recordUndo()
    setCustomPartitions(current => ({ ...current, [parcel.id]: pieces }))
    setMessage(`${parcel.name} divided into ${pieces.length} co-sharer parcels. ${useRoadFrontage ? 'Each owner receives the entered roadside frontage and target area.' : 'Each entered target area is preserved.'}`)
  }

  function applySideLengthShare(parcel: Parcel) { applyAreaGuidedShares(parcel, true) }
  function applyPercentageShare(parcel: Parcel) { applyAreaGuidedShares(parcel, false) }

  function hasParcelOverlap(nextParcels: Parcel[]) {
    return nextParcels.some((parcel, index) => nextParcels.slice(index + 1).some(other => polygonIntersectionArea(parcel.points, other.points) > EPS))
  }

  function changePoint(parcelId: string, pointIndex: number, axis: 'x' | 'y', raw: string) {
    if (raw.trim() === '') return
    const entered = Math.round(Number(raw))
    if (!Number.isFinite(entered)) return
    const value = unit === 'feet' ? fromFeet(entered) : entered
    recordUndo()
    clearCuts()
    setParcels(current => {
      const old = current.find(p => p.id === parcelId)?.points[pointIndex]
      if (!old) return current
      const nextPoint = { ...old, [axis]: value }
      const nextParcels = current.map(parcel => ({ ...parcel, points: parcel.points.map(point => samePoint(point, old) ? nextPoint : point) }))
      if (hasParcelOverlap(nextParcels)) { setMessage('That external side change would overlap an adjacent plot, so the boundary was left unchanged.'); return current }
      return nextParcels
    })
  }
  function changeEdgeLength(parcelId: string, edgeIndex: number, raw: string) {
    if (raw.trim() === '') return
    const entered = Math.round(Number(raw))
    if (!Number.isFinite(entered) || entered <= 0) return
    const desiredLength = unit === 'feet' ? fromFeet(entered) : entered
    const parcel = parcels.find(candidate => candidate.id === parcelId)
    if (!parcel) return
    const points = parcel.points
    const start = points[edgeIndex]
    const nextIndex = (edgeIndex + 1) % points.length
    const end = points[nextIndex]
    const currentLength = distance(start, end)
    if (currentLength < EPS) return
    const delta = { x: (end.x - start.x) / currentLength * (desiredLength - currentLength), y: (end.y - start.y) / currentLength * (desiredLength - currentLength) }
    const movedPoints = new globalThis.Map<string, Point>()
    for (let index = nextIndex; index !== edgeIndex; index = (index + 1) % points.length) {
      const point = points[index]
      movedPoints.set(`${point.x}:${point.y}`, { x: point.x + delta.x, y: point.y + delta.y })
    }
    recordUndo()
    clearCuts()
    setParcels(current => {
      const nextParcels = current.map(currentParcel => ({ ...currentParcel, points: currentParcel.points.map(point => movedPoints.get(`${point.x}:${point.y}`) ?? point) }))
      if (hasParcelOverlap(nextParcels)) { setMessage('That external side change would overlap an adjacent plot, so the boundary was left unchanged.'); return current }
      return nextParcels
    })
    const adjustedClosingIndex = (edgeIndex - 1 + points.length) % points.length
    const oldClosingPoint = points[adjustedClosingIndex]
    const adjustedClosingPoint = movedPoints.get(`${oldClosingPoint.x}:${oldClosingPoint.y}`) ?? oldClosingPoint
    const closingLength = distance(adjustedClosingPoint, start)
    setMessage(`Side ${String.fromCharCode(65 + edgeIndex)}–${String.fromCharCode(65 + nextIndex)} set to ${entered} ${unit === 'feet' ? 'ft' : 'K'}. Other downstream edges stayed the same; the closing side is now ${formatLengthValue(closingLength, unit)}.`)
  }

  function addParcel() {
    recordUndo()
    clearCuts()
    const allPoints = parcels.flatMap(parcel => parcel.points)
    const maxX = Math.max(...allPoints.map(point => point.x), 0)
    const minY = Math.min(...allPoints.map(point => point.y), 0)
    const maxY = Math.max(...allPoints.map(point => point.y), 30)
    const id = `p${Date.now()}`
    setParcels(current => [...current, { id, name: `Parcel ${String(current.length + 1).padStart(2, '0')}`, owner: `Owner ${current.length + 1}`, targetMarla: '', fixedEdges: [false, false, false, false], sameEdges: [false, false, false, false], points: [{ x: maxX, y: minY }, { x: maxX + 30, y: minY }, { x: maxX + 30, y: maxY }, { x: maxX, y: maxY }] }])
    setMessage('A new adjacent parcel was added. Enter its boundary lengths; corner coordinates remain available in advanced controls.')
  }
  function addVertex(parcelId: string) {
    recordUndo()
    clearCuts()
    setParcels(current => current.map(parcel => {
      if (parcel.id !== parcelId) return parcel
      const edgeIndex = parcel.points.reduce((best, point, i) => distance(point, parcel.points[(i + 1) % parcel.points.length]) > distance(parcel.points[best], parcel.points[(best + 1) % parcel.points.length]) ? i : best, 0)
      const start = parcel.points[edgeIndex], end = parcel.points[(edgeIndex + 1) % parcel.points.length]
      const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      const points = [...parcel.points]
      points.splice(edgeIndex + 1, 0, midpoint)
      const fixedEdges = [...parcel.fixedEdges]
      const sameEdges = [...(parcel.sameEdges ?? Array(parcel.points.length).fill(false))]
      const splitEdgeIsFixed = Boolean(fixedEdges[edgeIndex])
      const splitEdgeIsSame = Boolean(sameEdges[edgeIndex])
      fixedEdges.splice(edgeIndex, 1, splitEdgeIsFixed, splitEdgeIsFixed)
      sameEdges.splice(edgeIndex, 1, splitEdgeIsSame, splitEdgeIsSame)
      return { ...parcel, points, fixedEdges, sameEdges }
    }))
  }
  function removeVertex(parcelId: string, index: number) {
    if ((parcels.find(parcel => parcel.id === parcelId)?.points.length ?? 0) <= 3) return
    recordUndo()
    clearCuts()
    setParcels(current => current.map(parcel => {
      if (parcel.id !== parcelId || parcel.points.length <= 3) return parcel
      const fixedEdges = [...parcel.fixedEdges]
      const sameEdges = [...(parcel.sameEdges ?? Array(parcel.points.length).fill(false))]
      const previous = (index - 1 + fixedEdges.length) % fixedEdges.length
      fixedEdges[previous] = Boolean(fixedEdges[previous] || fixedEdges[index])
      sameEdges[previous] = Boolean(sameEdges[previous] || sameEdges[index])
      fixedEdges.splice(index, 1)
      sameEdges.splice(index, 1)
      return { ...parcel, points: parcel.points.filter((_, i) => i !== index), fixedEdges, sameEdges }
    }))
  }
  function toggleFixedEdge(parcelId: string, edgeIndex: number) {
    recordUndo()
    setParcels(current => current.map(parcel => parcel.id === parcelId ? { ...parcel, fixedEdges: parcel.fixedEdges.map((fixed, i) => i === edgeIndex ? !fixed : fixed) } : parcel))
  }
  function toggleSameEdge(parcelId: string, edgeIndex: number) {
    const selected = parcels.find(parcel => parcel.id === parcelId)
    if (!selected || !sharedEdge(selected.points[edgeIndex], selected.points[(edgeIndex + 1) % selected.points.length], parcels)) return
    const isMarked = Boolean(selected.sameEdges?.[edgeIndex])
    const nextValue = !isMarked
    const start = selected.points[edgeIndex], end = selected.points[(edgeIndex + 1) % selected.points.length]
    recordUndo()
    setParcels(current => current.map(parcel => {
      const sameEdges = Array.from({ length: parcel.points.length }, (_, index) => Boolean(parcel.sameEdges?.[index]))
      for (let index = 0; index < parcel.points.length; index++) {
        const edgeStart = parcel.points[index], edgeEnd = parcel.points[(index + 1) % parcel.points.length]
        if ((samePoint(start, edgeStart) && samePoint(end, edgeEnd)) || (samePoint(start, edgeEnd) && samePoint(end, edgeStart))) sameEdges[index] = nextValue
      }
      return { ...parcel, sameEdges }
    }))
  }
  function removeParcel(parcelId: string) {
    if (parcels.length <= 1 || !parcels.some(parcel => parcel.id === parcelId)) return
    recordUndo()
    clearCuts()
    setParcels(current => current.filter(p => p.id !== parcelId))
  }
  function adjustToTarget(parcelId: string) {
    const parcel = parcels.find(p => p.id === parcelId)
    const targetMarla = Number(parcel?.targetMarla)
    const eligible = parcel?.points.filter(point => !isPlanExteriorVertex(point, parcels)) ?? []
    if (!parcel || !Number.isFinite(targetMarla) || targetMarla <= 0) { setMessage('Enter a positive target area in marla.'); return }
    if (!eligible.length) {
      const attached = parcels.some(other => other.id !== parcel.id && parcel.points.some(point => other.points.some(otherPoint => samePoint(point, otherPoint))))
      if (!attached && parcel.points.length === 4 && !parcel.fixedEdges.some(Boolean)) {
        const fitted = fitQuadrilateralArea(parcel.points, targetMarla * 9)
        if (!fitted.points) {
          setMessage(`${parcel.name}: the requested area is not attainable while preserving all four measured outside lengths. Feasible sampled area range: ${fmt(fitted.min / 9, 2)}–${fmt(fitted.max / 9, 2)} marla.`)
          return
        }
        recordUndo()
        clearCuts()
        setParcels(current => current.map(p => p.id === parcelId ? { ...p, points: fitted.points! } : p))
        setMessage(`${parcel.name}: auto-adjusted the interior diagonal and angles to ${fmt(targetMarla, 2)} marla, keeping every outside side length fixed.`)
        return
      }
      setMessage('There are no free interior corners to adjust. An independent four-sided parcel can flex its diagonal while retaining all outside lengths; shared or locked boundaries require additional survey constraints.')
      return
    }
    const fixedVertices = parcels.flatMap(ownerParcel => ownerParcel.fixedEdges.flatMap((isFixed, i) => isFixed ? [ownerParcel.points[i], ownerParcel.points[(i + 1) % ownerParcel.points.length]] : []))
    const uniqueEligible = eligible.filter((point, i, arr) => !fixedVertices.some(locked => samePoint(locked, point)) && arr.findIndex(other => samePoint(other, point)) === i)
    if (!uniqueEligible.length) { setMessage('No adjustable interior vertices remain after respecting fixed sides.'); return }
    const pivot = { x: uniqueEligible.reduce((s,p)=>s+p.x,0)/uniqueEligible.length, y: uniqueEligible.reduce((s,p)=>s+p.y,0)/uniqueEligible.length }
    const areaAt = (factor: number) => {
      const points = parcel.points.map(point => uniqueEligible.some(p => samePoint(point, p)) ? { x: pivot.x + (point.x - pivot.x) * factor, y: pivot.y + (point.y - pivot.y) * factor } : point)
      return portionsFor({ ...parcel, points }, undefined, unit).reduce((sum, portion) => sum + portion.area, 0)
    }
    let low = 0, high = 20
    const lowArea = areaAt(low), highArea = areaAt(high)
    const increasing = highArea >= lowArea
    const minimumArea = Math.min(lowArea, highArea)
    const maximumArea = Math.max(lowArea, highArea)
    const requestedArea = targetMarla * 9
    if (requestedArea < minimumArea - 0.05 || requestedArea > maximumArea + 0.05) {
      setMessage(`${parcel.name} can cover between ${formatArea(minimumArea)} and ${formatArea(maximumArea)} Kanal–Marla while its external vertices stay fixed. Enter a target inside that range.`)
      return
    }
    const targetArea = Math.max(minimumArea, Math.min(maximumArea, requestedArea))
    for (let step = 0; step < 60; step++) {
      const middle = (low + high) / 2
      if ((areaAt(middle) < targetArea) === increasing) low = middle
      else high = middle
    }
    const factor = (low + high) / 2
    recordUndo()
    clearCuts()
    setParcels(current => current.map(other => ({ ...other, points: other.points.map(point => {
      if (!uniqueEligible.some(p => samePoint(point, p))) return point
      return { x: pivot.x + (point.x - pivot.x) * factor, y: pivot.y + (point.y - pivot.y) * factor }
    }) })))
    setMessage('Interior/shared vertices were adjusted while convex-hull boundary vertices remained fixed. Review adjoining parcel areas before printing.')
  }

  function adjustTotalAreaToTarget() {
    const targetMarla = Number(targetTotalAreaMarla)
    if (!Number.isFinite(targetMarla) || targetMarla <= 0) { setMessage('Enter a positive total target area in marla.'); return }
    if (parcels.length === 1 && parcels[0].points.length === 4 && !parcels[0].fixedEdges.some(Boolean)) {
      const fit = fitQuadrilateralArea(parcels[0].points, targetMarla * 9)
      if (!fit.points) { setMessage(`Area target is not attainable with four fixed external side lengths. Possible sampled range: ${fmt(fit.min / 9, 2)}–${fmt(fit.max / 9, 2)} marla.`); return }
      recordUndo()
      clearCuts()
      setParcels(current => [{ ...current[0], points: fit.points! }])
      setMessage(`Enclosed area adjusted to ${fmt(targetMarla, 2)} marla by changing the internal diagonal and angles. External side lengths remain unchanged.`)
      return
    }
    const points = parcels.flatMap(parcel => parcel.points).filter((point, index, all) => all.findIndex(other => samePoint(point, other)) === index)
    const fixedPoints = parcels.flatMap(parcel => parcel.fixedEdges.flatMap((fixed, index) => fixed ? [parcel.points[index], parcel.points[(index + 1) % parcel.points.length]] : []))
    const adjustable = points.filter(point => !fixedPoints.some(fixed => samePoint(fixed, point)) && (!keepOuterVertices || !isPlanExteriorVertex(point, parcels)))
    if (!adjustable.length) { setMessage(keepOuterVertices ? 'No internal vertices are available to adjust while keeping the external vertices fixed.' : 'All vertices are fixed by locked boundary sides. Unlock sides before adjusting the total area.'); return }
    const pivot = { x: adjustable.reduce((sum, point) => sum + point.x, 0) / adjustable.length, y: adjustable.reduce((sum, point) => sum + point.y, 0) / adjustable.length }
    const transform = (point: Point, factor: number) => adjustable.some(candidate => samePoint(candidate, point)) ? { x: pivot.x + (point.x - pivot.x) * factor, y: pivot.y + (point.y - pivot.y) * factor } : point
    const areaAt = (factor: number) => {
      const adjustedPaths = paths.map(path => ({ ...path, points: path.points.map(point => transform(point, factor)) }))
      return parcels.reduce((sum, parcel) => {
        const adjusted = { ...parcel, points: parcel.points.map(point => transform(point, factor)) }
        const portions = portionsWithPathDeductions(portionsFor(adjusted, undefined, unit), parcel.id, adjustedPaths)
        return sum + portions.reduce((portionSum, portion) => portionSum + portion.area, 0)
      }, 0)
    }
    let low = 0, high = 30
    const lowArea = areaAt(low), highArea = areaAt(high)
    const minimum = Math.min(lowArea, highArea), maximum = Math.max(lowArea, highArea), requestedArea = targetMarla * 9
    if (requestedArea < minimum - 0.05 || requestedArea > maximum + 0.05) { setMessage(`That total target is outside the adjustable range of ${formatArea(minimum)}–${formatArea(maximum)}. ${keepOuterVertices ? 'Unlock external vertices or revise the target.' : 'Unlock fixed sides or revise the target.'}`); return }
    const increasing = highArea >= lowArea
    for (let step = 0; step < 60; step++) {
      const middle = (low + high) / 2
      if ((areaAt(middle) < requestedArea) === increasing) low = middle
      else high = middle
    }
    const factor = (low + high) / 2
    recordUndo()
    clearCuts()
    setParcels(current => current.map(parcel => ({ ...parcel, points: parcel.points.map(point => transform(point, factor)) })))
    setPaths(current => current.map(path => ({ ...path, points: path.points.map(point => transform(point, factor)) })))
    setMessage(`The plan was adjusted to the requested total area of ${fmt(targetMarla, 2)} marla. ${keepOuterVertices ? 'External vertices and locked sides stayed fixed.' : 'Locked sides stayed fixed; external vertices were allowed to move.'}`)
  }

  const directionIcon = { top: ArrowUp, right: ArrowRight, bottom: ArrowDown, left: ArrowLeft }[direction]
  const NorthIcon = directionIcon
  return <main className="workspace-shell">
    <header className="app-header">
      <a className="brand" href="#workspace" aria-label="Fieldline survey desk home"><span className="brand-mark"><Map /></span><span>FIELDLINE <small>SURVEY DESK</small></span></a>
      <div className="header-center"><span className="status-dot" /> FIELD BOOK <span className="header-divider">/</span> PARCEL PLAN</div>
      <div className="header-actions"><span className="scale-chip"><Ruler /> 1″ = 40 K</span><button className="quiet-button" onClick={saveDraft}>Save work</button><label className="quiet-button">Load work<input className="sr-only" type="file" accept="application/json" onChange={loadDraft} /></label><button className="print-button" type="button" onClick={downloadScaledPdf}><Printer /> <span>Download scaled PDF (40 K/in)</span></button><button className="quiet-button" onClick={() => window.print()}>Print calculations</button></div>
    </header>

    <div className="page-content" id="workspace">
      <section className="page-intro"><div><p className="eyebrow">CADASTRAL MEASUREMENT WORKSPACE <span>·</span> PUNJAB FIELD STANDARD</p><h1>Parcel <em>survey</em></h1><p className="intro-copy">Enter measured boundary lengths in whole Karams by default, or switch to feet. Coordinates are available under each parcel&apos;s advanced controls; parcel areas follow Patwari formulas.</p></div><div className="intro-number"><span>PLAN NO.</span><strong>FS—0248</strong><span>FIELD DRAFT · 01</span></div></section>

      <div className="workbench-tabs" role="tablist" aria-label="Survey sections"><button className={activeTab === 'survey' ? 'active' : ''} role="tab" aria-selected={activeTab === 'survey'} onClick={() => setActiveTab('survey')}><Compass /> Survey plan <span>01</span></button><button className={activeTab === 'calculations' ? 'active' : ''} role="tab" aria-selected={activeTab === 'calculations'} onClick={() => setActiveTab('calculations')}><ClipboardList /> Field calculations <span>02</span></button><div className="tab-spacer"/><span className="saved-indicator"><span/> All changes are in this draft</span></div>

      {activeTab === 'survey' && <section className="partition-mode-bar" aria-label="Partition measured area"><div className="partition-mode-heading"><div><span className="eyebrow">{traceApplied ? 'TRACE COMPLETE · AREA CALCULATED' : 'NEXT STEP · DIVIDE YOUR AREA'}</span><h2>Partition measured area</h2><p>{traceApplied ? `Measured area: ${formatArea(partitionScope === 'all' ? collectiveAreaMarla * 9 : totalArea)} Kanal–Marla. Choose a method and the total number of parcels to create.` : partitionMode === 'free-cut' ? 'Enter each co-sharer’s target area, then draw cuts that create separate resulting parcels.' : partitionMode === 'freeform-parcel' ? 'Draw a closed boundary inside a plot to create a separately owned parcel; its area is deducted from the surrounding plot.' : partitionMode === 'side-length' ? 'Enter every target area and each co-sharer’s roadside frontage length.' : partitionMode === 'percentage-share' ? 'Enter each co-sharer’s area as Kanal–Marla or a percentage of this land plot.' : 'Draw a free-style cut; the line adjusts to the current co-sharer’s entered target area.'}</p></div><button className="clear-cuts-button" onClick={() => { recordUndo(); clearCuts() }} disabled={!Object.keys(customPartitions).length && !paths.some(path => path.isPartitionedParcel)}>Clear cuts</button></div><div className="partition-method-options" role="group" aria-label="Choose a partition method">
        <button className={partitionMode === 'side-length' ? 'selected' : ''} aria-pressed={partitionMode === 'side-length'} onClick={() => { setPartitionMode('side-length'); setDraftCut(null); setPathDrawingEnabled(false); setPathDraftPoints([]) }}><strong>Road frontage</strong><span>Use the road frontage continuously across all plots while retaining separate area calculations.</span></button>
        <button className={partitionMode === 'percentage-share' ? 'selected' : ''} aria-pressed={partitionMode === 'percentage-share'} onClick={() => { setPartitionMode('percentage-share'); setDraftCut(null); setPathDrawingEnabled(false); setPathDraftPoints([]) }}><strong>Target areas</strong><span>Use each owner&apos;s area target to place the cuts.</span></button>
        <button className={partitionMode === 'free-cut' ? 'selected' : ''} aria-pressed={partitionMode === 'free-cut'} onClick={() => { setPartitionMode('free-cut'); setLockFreeCutArea(false); setDraftCut(null); setPathDrawingEnabled(false); setPathDraftPoints([]) }}><strong>Free-cut partition</strong><span>Cut across all plots freely, or use partial strokes ending inside a parcel.</span></button>
        <button className={partitionMode === 'area-lock' ? 'selected' : ''} aria-pressed={partitionMode === 'area-lock'} onClick={() => { setPartitionMode('area-lock'); setLockFreeCutArea(true); setDraftCut(null); setPathDrawingEnabled(false); setPathDraftPoints([]) }}><strong>Area-locked cut</strong><span>Adjust the free-cut line to match each co-sharer&apos;s target area.</span></button><button className={partitionMode === 'freeform-parcel' ? 'selected' : ''} aria-pressed={partitionMode === 'freeform-parcel'} onClick={() => { setPartitionMode('freeform-parcel'); setLockFreeCutArea(false); setDraftCut(null); setPathParcelId(freeCutParcelId); setPathDrawingEnabled(false); setPathDraftPoints([]) }}><strong>Closed-outline parcel</strong><span>Draw a closed boundary to create a new parcel inside the selected plot.</span></button>
      </div>{partitionMode === 'freeform-parcel' && <div className="freeform-parcel-setup"><label htmlFor="freeform-parcel-source">Plot to divide</label><select id="freeform-parcel-source" value={pathParcelId} onChange={event => { setPathParcelId(event.target.value); setPathDraftPoints([]); setPathDrawingEnabled(false) }}>{parcels.map(parcel => <option key={parcel.id} value={parcel.id}>{parcel.name} · {parcel.owner || 'Unassigned'}</option>)}</select><label htmlFor="freeform-parcel-owner">New parcel owner</label><input id="freeform-parcel-owner" value={partitionParcelOwner} onChange={event => setPartitionParcelOwner(event.target.value)} placeholder="Enter owner name" /><div className="freeform-parcel-actions"><button type="button" onClick={() => { setPathDraftPoints([]); setPathDrawingEnabled(true); setMessage(`Click at least three parcel corners inside ${selectedPathParcel?.name ?? 'the selected plot'}, then create the parcel.`) }}><Map /> {pathDrawingEnabled && partitionMode === 'freeform-parcel' ? 'Redraw outline' : 'Draw parcel boundary'}</button><button type="button" onClick={finishFreeformParcel} disabled={!pathDrawingEnabled}>Create parcel</button><button type="button" onClick={() => { setPathDraftPoints([]); setPathDrawingEnabled(false) }} disabled={!pathDraftPoints.length}>Clear outline</button></div><p>Click the boundary corners in order. The last point connects to the first to close the parcel; crossing or overlapping outlines are rejected.</p></div>}<div className="free-cut-setup" style={{ display: partitionMode === 'freeform-parcel' ? 'none' : undefined }}><label htmlFor="partition-scope">Partition scope</label><select id="partition-scope" value={partitionScope} onChange={event => setPartitionScope(event.target.value as 'selected' | 'all')}><option value="selected">One selected plot</option><option value="all">All adjacent plots collectively</option></select>{partitionMode === 'free-cut' && <label className="keep-boundary-option"><input type="checkbox" checked={allowPartialCuts} onChange={event => setAllowPartialCuts(event.target.checked)} /> Allow partial cuts (endpoints inside the parcel)</label>}
{partitionMode === 'free-cut' && (partitionScope === 'all' || allowPartialCuts) ? <p className="partition-active-help">Draw directly on the plan. No parcel number, share count, owner or area target is required. Boundary-to-boundary strokes split parcels; interior-ended strokes remain visible partial cuts and do not invent enclosed areas. Collective lines can span multiple plots.</p> : <><label htmlFor="free-cut-parcel">Target owner set</label><select id="free-cut-parcel" value={freeCutParcelId} onChange={event => setFreeCutParcelId(event.target.value)}>{parcels.map(parcel => <option key={parcel.id} value={parcel.id}>{parcel.name}{parcel.owner ? ` · ${parcel.owner}` : ''}</option>)}</select><label htmlFor="free-cut-share-count">Resulting shares</label><input id="free-cut-share-count" type="number" min="2" max="20" step="1" inputMode="numeric" value={freeCutShareCounts[freeCutParcelId] ?? ''} onChange={event => setFreeCutShareCounts(current => ({ ...current, [freeCutParcelId]: event.target.value }))} placeholder="2–20 shares" />{selectedFreeCutParcel && freeCutTargetCount >= 2 && <ShareTargetEditor shareCount={freeCutTargetCount} targets={freeCutTargetInputs} sourceAreaMarla={shareTargetSourceAreaMarla} showFrontage={partitionMode === 'side-length'} lengthUnit={unit} onChange={(index, key, value) => updateFreeCutTarget(freeCutParcelId, index, key, value)} />}{selectedFreeCutParcel && freeCutTargetCount >= 2 && <p className={`partition-active-help${shareTargetsComplete ? ' allocation-valid' : ''}`}>{shareTargetsComplete ? `Share areas balance to ${fmt(shareTargetSourceAreaMarla, 2)} marla. ${partitionScope === 'all' && partitionMode === 'percentage-share' ? 'Each share target is distributed across all plots by area.' : partitionMode === 'free-cut' || partitionMode === 'area-lock' ? 'Draw the next partition line on the selected plot.' : 'Apply the selected frontage-based partition.'}` : `Complete every owner share area and make the entered targets equal ${partitionScope === 'all' && partitionMode === 'percentage-share' ? 'all plots’ combined area' : 'this land plot’s total area'} before partitioning.`}</p>}{partitionMode === 'side-length' && selectedFreeCutParcel && <div className="partition-action-row"><button type="button" onClick={() => applySideLengthShare(selectedFreeCutParcel)} disabled={!shareTargetsComplete}>Create frontage-based shares</button></div>}{partitionMode === 'percentage-share' && selectedFreeCutParcel && <div className="partition-action-row"><button type="button" onClick={() => applyPercentageShare(selectedFreeCutParcel)} disabled={!shareTargetsComplete}>Create target-area shares</button></div>}{(partitionMode === 'side-length' || partitionMode === 'percentage-share') && selectedFreeCutParcel && <div className="partition-method-controls"><div className="partition-control-field"><label htmlFor="partition-reference-side">Reference side</label><select id="partition-reference-side" value={selectedPartitionInput.edgeIndex} onChange={event => setPartitionInput(freeCutParcelId, 'edgeIndex', Number(event.target.value))}>{selectedFreeCutParcel.points.map((point, index) => <option key={`${freeCutParcelId}-reference-${index}`} value={index}>Side {String.fromCharCode(65 + index)}–{String.fromCharCode(65 + (index + 1) % selectedFreeCutParcel.points.length)} · {formatLengthValue(distance(point, selectedFreeCutParcel.points[(index + 1) % selectedFreeCutParcel.points.length]), unit)}</option>)}</select></div>{partitionMode === 'side-length' ? <><div className="partition-control-field"><label htmlFor="partition-side-length">Road frontage for first share</label><div className="partition-input-with-unit"><input id="partition-side-length" type="number" min="0.1" step="0.1" inputMode="decimal" value={selectedPartitionInput.length} onChange={event => setPartitionInput(freeCutParcelId, 'length', event.target.value)} placeholder="Enter length" /><span>{unit === 'feet' ? 'ft' : 'Karam'}</span></div></div><button type="button" onClick={() => applySideLengthShare(selectedFreeCutParcel)}>Create target parcels</button></> : <><div className="partition-control-field"><label htmlFor="partition-share-percent">Area share</label><div className="partition-input-with-unit"><input id="partition-share-percent" type="number" min="1" max="99" step="1" inputMode="decimal" value={selectedPartitionInput.percentage} onChange={event => setPartitionInput(freeCutParcelId, 'percentage', event.target.value)} /><span>%</span></div></div><button type="button" onClick={() => applyPercentageShare(selectedFreeCutParcel)}>Create target parcels</button></>}</div>}{partitionMode === 'free-cut' && <div className="free-cut-targets"><strong>Target each new parcel&apos;s share</strong>{Array.from({ length: Math.max(0, freeCutTargetCount - 1) }, (_, targetIndex) => { const target = freeCutTargetInputs[targetIndex] ?? emptyFreeCutTarget(); const parcelNumber = targetIndex + 2; return <div className={`free-cut-target-row${freeCutEnabled && targetIndex === nextTargetIndex ? ' next-target' : ''}`} key={`${freeCutParcelId}-target-${targetIndex}`}><label htmlFor={`${freeCutParcelId}-target-mode-${targetIndex}`}>Parcel {String(parcelNumber).padStart(2, '0')} {freeCutEnabled && targetIndex === nextTargetIndex ? '· next cut' : ''}</label><select id={`${freeCutParcelId}-target-mode-${targetIndex}`} aria-label={`Target format for Parcel ${parcelNumber}`} value={target.mode} onChange={event => updateFreeCutTarget(freeCutParcelId, targetIndex, 'mode', event.target.value)}><option value="area">Area</option><option value="percentage">Percentage</option></select>{target.mode === 'area' ? <div className="free-cut-area-fields"><label className="sr-only" htmlFor={`${freeCutParcelId}-target-kanal-${targetIndex}`}>Parcel {parcelNumber} target area in kanal</label><input id={`${freeCutParcelId}-target-kanal-${targetIndex}`} type="number" min="0" step="1" inputMode="numeric" aria-label={`Parcel ${parcelNumber} target area in kanal`} value={target.kanal} onChange={event => updateFreeCutTarget(freeCutParcelId, targetIndex, 'kanal', event.target.value)} placeholder="Kanal" /><label className="sr-only" htmlFor={`${freeCutParcelId}-target-marla-${targetIndex}`}>Parcel {parcelNumber} target area in marla</label><input id={`${freeCutParcelId}-target-marla-${targetIndex}`} type="number" min="0" max="19.9" step="0.1" inputMode="decimal" aria-label={`Parcel ${parcelNumber} target area in marla`} value={target.marla} onChange={event => updateFreeCutTarget(freeCutParcelId, targetIndex, 'marla', event.target.value)} placeholder="Marla" /></div> : <><label className="sr-only" htmlFor={`${freeCutParcelId}-target-percent-${targetIndex}`}>Parcel {parcelNumber} target share percentage</label><input id={`${freeCutParcelId}-target-percent-${targetIndex}`} type="number" min="0.1" max="99.9" step="0.1" inputMode="decimal" aria-label={`Parcel ${parcelNumber} target area percentage`} value={target.percentage} onChange={event => updateFreeCutTarget(freeCutParcelId, targetIndex, 'percentage', event.target.value)} placeholder="% of original" /></>}</div>})}<p className="free-cut-target-note">Area targets use Kanal–Marla; percentages use the original selected parcel area.</p></div>}{partitionMode === 'free-cut' && <label className="free-cut-lock-control"><input type="checkbox" checked={lockFreeCutArea} onChange={event => setLockFreeCutArea(event.target.checked)} disabled={!hasTargetFreeCutArea} /><span>Lock target area for next cut</span></label>}<p id="free-cut-progress" className="partition-active-help">{partitionMode === 'free-cut' ? !freeCutSetupReady ? 'Set the total parcel count (2–20). Draw each cut from boundary to boundary; parcel area and total area are recalculated.' : currentFreeCutPieces >= requestedShareCount ? `Target reached: ${currentFreeCutPieces} of ${requestedShareCount} parcels. Calculated areas are shown below.` : `${requestedShareCount - currentFreeCutPieces} cut${requestedShareCount - currentFreeCutPieces === 1 ? '' : 's'} remaining. ${hasTargetFreeCutArea ? `Green guide marks approximately ${fmt(targetFreeCutAreaMarla, 1)} marla; ${lockFreeCutArea ? 'the cut follows the guide.' : 'the cut remains free to move.'}` : 'Add a target area for an optional guide.'}` : partitionMode === 'area-lock' ? 'Choose the parcel count for a later cut; Area lock adjusts its boundary to the target area without creating parcel divisions.' : !freeCutSetupReady ? 'Enter a target parcel count from 2–20. This count is used when applying the selected cut method.' : `Selected parcel target: ${requestedShareCount} total parcels. ${currentFreeCutPieces} currently defined.`}</p></>}</div></section>}

      {activeTab === 'survey' ? <div className="survey-layout">
        <aside className="input-panel">
          <div className="panel-heading"><div><span className="eyebrow">01 / FIELD INPUT</span><h2>Measured side lengths</h2></div><div className="panel-actions"><button className="undo-plan-button" onClick={undoLastEdit} disabled={!undoCount} aria-label="Undo last plan edit"><Undo2 /><span>Undo</span></button><button className="quiet-button" onClick={() => { recordUndo(); setParcels(starterParcels); clearCuts(); setPaths([]); setPathDraftPoints([]); setPathDrawingEnabled(false); setMessage('Example field plan restored.') }} aria-label="Restore example plan" title="Restore example plan"><RotateCcw /></button></div></div>
          <p className="panel-description">Edit each boundary side by length. Coordinates remain available in the advanced section; shared corners stay joined across adjoining parcels.</p>
          <div className="unit-control"><span>Side-length input · least count {unit === 'karam' ? '1 Karam' : '1 foot'}</span><div className="segmented"><button className={unit === 'karam' ? 'selected' : ''} onClick={() => setUnit('karam')}>Karam</button><button className={unit === 'feet' ? 'selected' : ''} onClick={() => setUnit('feet')}>Feet</button></div></div>
          <section className="total-area-adjust" aria-label="Adjust total plan area"><label htmlFor="target-total-area">Target total plan area · marla</label><div className="total-area-input-row"><input id="target-total-area" type="number" min="0.01" step="0.01" inputMode="decimal" value={targetTotalAreaMarla} onChange={event => setTargetTotalAreaMarla(event.target.value)} placeholder={`Current ${fmt(parcels.reduce((sum, parcel) => sum + polygonArea(parcel.points) / 9, 0), 2)} marla`} /><button type="button" onClick={adjustTotalAreaToTarget}>Adjust total area</button></div><label className="keep-boundary-option"><input type="checkbox" checked={keepOuterVertices} onChange={event => setKeepOuterVertices(event.target.checked)} /> Keep external vertices fixed</label><p>If the current geometry does not enclose the entered area, select Adjust total area to try changing internal dimensions. Fixed external sides are preserved. An impossible target will be rejected.</p></section>
          <section className="total-area-adjust" aria-label="Input an internal or diagonal distance">
            <strong>Internal distance / diagonal</strong>
            <p>Choose any two existing parcel corners. An interior point can be moved to meet the entered distance; an isolated four-sided parcel can also be flexed to match a diagonal while all four perimeter lengths stay fixed. For arbitrary positions, use “Measure between two points” on the drawing.</p>
            <label htmlFor="distance-parcel">Parcel</label>
            <select id="distance-parcel" value={distanceParcelId || parcels[0]?.id || ''} onChange={event => { setDistanceParcelId(event.target.value); setDistanceStartIndex(0); setDistanceEndIndex(2) }}>
              {parcels.map(parcel => <option key={parcel.id} value={parcel.id}>{parcel.name}</option>)}
            </select>
            <div className="total-area-input-row">
              <label>From <select value={distanceStartIndex} onChange={event => setDistanceStartIndex(Number(event.target.value))}>{(parcels.find(p => p.id === (distanceParcelId || parcels[0]?.id))?.points ?? []).map((_, i) => <option key={i} value={i}>Point {String.fromCharCode(65 + i)}</option>)}</select></label>
              <label>To <select value={distanceEndIndex} onChange={event => setDistanceEndIndex(Number(event.target.value))}>{(parcels.find(p => p.id === (distanceParcelId || parcels[0]?.id))?.points ?? []).map((_, i) => <option key={i} value={i}>Point {String.fromCharCode(65 + i)}</option>)}</select></label>
            </div>
            <div className="total-area-input-row">
              <input type="number" min="0.01" step="0.01" inputMode="decimal" aria-label={`Requested internal distance in ${unit}`} value={distanceTarget} onChange={event => setDistanceTarget(event.target.value)} placeholder={`Distance (${unit})`} />
              <button type="button" onClick={applyEnteredDistance}>Apply distance</button>
            </div>
            <small>Current distance: {(() => { const points = parcels.find(p => p.id === (distanceParcelId || parcels[0]?.id))?.points ?? []; return points[distanceStartIndex] && points[distanceEndIndex] ? formatLengthValue(distance(points[distanceStartIndex], points[distanceEndIndex]), unit) : 'Choose two points' })()}</small>
          </section>
          <div className="length-header"><span>BOUNDARY SIDE</span><span>LENGTH ({unit === 'karam' ? 'K' : 'FT'})</span><span>FIX</span><span>SAME</span></div>
          <div className="parcel-inputs">{parcels.map((parcel, parcelIndex) => <section className="parcel-input-card" key={parcel.id}>
            <div className="parcel-input-title"><span className="parcel-color" style={{ backgroundColor: parcelColors[parcelIndex % parcelColors.length] }} /><strong>{parcel.name}</strong><span className="shared-badge">{parcel.points.filter((p,i)=>sharedEdge(p,parcel.points[(i+1)%parcel.points.length],parcels)).length > 0 ? 'ADJOINING' : 'PARCEL'}</span><button className="icon-button remove-parcel" onClick={() => removeParcel(parcel.id)} aria-label={`Remove ${parcel.name}`} disabled={parcels.length <= 1}><Trash2 /></button></div>
            <label className="owner-row" htmlFor={`${parcel.id}-owner`}><span>OWNER / HOLDER</span><input id={`${parcel.id}-owner`} value={parcel.owner} onChange={event => { recordUndo(); setParcels(current => current.map(p => p.id === parcel.id ? { ...p, owner: event.target.value } : p)) }} placeholder="Enter owner name" /></label>
            <div className="parcel-area-adjust"><label htmlFor={`${parcel.id}-target-area`}>TARGET AREA · MARLA<input id={`${parcel.id}-target-area`} type="number" min="0.01" step="0.01" value={parcel.targetMarla} onChange={event => setParcels(current => current.map(p => p.id === parcel.id ? { ...p, targetMarla: event.target.value } : p))} placeholder={fmt(polygonArea(parcel.points) / 9, 2)} /></label><button type="button" className="text-action" onClick={() => adjustToTarget(parcel.id)} disabled={!Number(parcel.targetMarla)}><Ruler /> Auto-adjust internal lengths</button><small>External vertices remain fixed. If the target is outside the possible range, the minimum and maximum are shown.</small></div>
            <div className="vertex-list">{parcel.points.map((point, pointIndex) => { const next = parcel.points[(pointIndex + 1) % parcel.points.length]; const length = distance(point, next); const endIndex = (pointIndex + 1) % parcel.points.length; const sideName = `${String.fromCharCode(65 + pointIndex)}–${String.fromCharCode(65 + endIndex)}`; return <div className="vertex-row" key={`${parcel.id}-${pointIndex}`}>
              <div className="corner-name"><span>{sideName}</span><small>Side</small></div>
              <label className="sr-only" htmlFor={`${parcel.id}-length-${pointIndex}`}>{parcel.name} side {sideName} length in {unit === 'feet' ? 'feet' : 'karams'}</label><input id={`${parcel.id}-length-${pointIndex}`} className="side-length-input" type="number" min="1" step="1" inputMode="numeric" value={String(Math.round(unit === 'feet' ? toFeet(length) : length))} onChange={event => changeEdgeLength(parcel.id, pointIndex, event.target.value)} />
              <span className="edge-unit">{unit === 'feet' ? 'FT' : 'K'}</span><button className={`side-lock-button${parcel.fixedEdges[pointIndex] ? ' locked' : ''}`} aria-pressed={Boolean(parcel.fixedEdges[pointIndex])} onClick={() => toggleFixedEdge(parcel.id, pointIndex)} aria-label={`${parcel.fixedEdges[pointIndex] ? 'Unfix' : 'Fix'} side ${sideName} for ${parcel.owner || parcel.name}`} title={parcel.fixedEdges[pointIndex] ? 'This owner side is fixed for area adjustment' : 'Click to fix this owner side for area adjustment'}>{parcel.fixedEdges[pointIndex] ? <Lock /> : <Unlock />}</button><label className="same-side-control" title={sharedEdge(point, next, parcels) ? 'Mark this shared side as matching the adjacent plot' : 'Only adjoining shared sides can be marked'}><input type="checkbox" className="same-side-checkbox" checked={Boolean(parcel.sameEdges?.[pointIndex])} disabled={!sharedEdge(point, next, parcels)} onChange={() => toggleSameEdge(parcel.id, pointIndex)} aria-label={`${parcel.sameEdges?.[pointIndex] ? 'Unmark' : 'Mark'} side ${sideName} as the same side as the adjoining plot`} /></label><button className="delete-vertex" onClick={() => removeVertex(parcel.id, pointIndex)} aria-label={`Remove corner ${String.fromCharCode(65 + pointIndex)}`} disabled={parcel.points.length <= 3}><Trash2 /></button>
            </div>})}</div>
            <details className="coordinate-details"><summary>Advanced · corner coordinates</summary><div className="coordinate-header"><span>CORNER</span><span>EASTING ({unit === 'karam' ? 'K' : 'FT'})</span><span>NORTHING ({unit === 'karam' ? 'K' : 'FT'})</span></div><div className="coordinate-list">{parcel.points.map((point, pointIndex) => <div className="coordinate-row" key={`${parcel.id}-coordinate-${pointIndex}`}><span>{String.fromCharCode(65 + pointIndex)}</span><label className="sr-only" htmlFor={`${parcel.id}-e-${pointIndex}`}>{parcel.name} corner {String.fromCharCode(65 + pointIndex)} easting</label><input id={`${parcel.id}-e-${pointIndex}`} type="number" step="1" value={fmt(unit === 'feet' ? toFeet(point.x) : point.x, 0).replaceAll(',', '')} onChange={event => changePoint(parcel.id, pointIndex, 'x', event.target.value)} /><label className="sr-only" htmlFor={`${parcel.id}-n-${pointIndex}`}>{parcel.name} corner {String.fromCharCode(65 + pointIndex)} northing</label><input id={`${parcel.id}-n-${pointIndex}`} type="number" step="1" value={fmt(unit === 'feet' ? toFeet(point.y) : point.y, 0).replaceAll(',', '')} onChange={event => changePoint(parcel.id, pointIndex, 'y', event.target.value)} /></div>)}</div></details>
            <div className="parcel-card-footer"><button className="text-action" onClick={() => addVertex(parcel.id)}><Plus /> Add corner</button><span>{fmt(polygonArea(parcel.points))} sarsai</span></div>
            <label className="target-label" htmlFor={`${parcel.id}-target`}>Target area · whole marla <span>1 MARLA LEAST COUNT</span></label><div className="target-row"><input id={`${parcel.id}-target`} type="number" min="0" step="1" placeholder="e.g. 7" disabled={partitionMode !== 'area-lock'} value={parcel.targetMarla} onChange={event => { recordUndo(); setParcels(current => current.map(p => p.id === parcel.id ? { ...p, targetMarla: event.target.value ? String(Math.round(Number(event.target.value))) : '' } : p)) }} /><button onClick={() => adjustToTarget(parcel.id)} disabled={partitionMode !== 'area-lock' || !parcel.targetMarla || !parcel.points.some(p => !isExternalPoint(p, hull))}>Adjust interior points</button></div>
            {partitionMode === 'area-lock' ? <p className="target-help">Area-lock mode scales adjustable interior corners toward this target; fixed sides stay put.</p> : <p className="target-help">Switch to Area lock to adjust an interior-vertex area target.</p>}
            {parcel.targetMarla && !parcel.points.some(p => !isExternalPoint(p, hull)) && <p className="target-help">Target retained for comparison. Adjustment needs internal vertices; the exterior boundary is fixed.</p>}
          </section>)}</div>
          <button className="add-parcel-button" onClick={addParcel}><Plus /> Add adjacent parcel</button>
          <div className="input-footnote"><CircleHelp /><p>Enter each owner / holder and mark any boundary side fixed. Fixed sides stay unchanged during target-area adjustment. Shared corners update together; top of plan is North by default.</p></div>
        </aside>

        <section className="drawing-column">
          <div className="drawing-card"><section className="path-tool-panel" aria-label="Optional path area"><div className="path-tool-heading"><div><span className="eyebrow">OPTIONAL FEATURE</span><h3>Measure a path</h3><p>Draw a free outline or attach a rectangular path to a parcel side. Path area is calculated separately.</p></div><label className="collective-path-option"><input type="checkbox" checked={collectivePathCut} onChange={event => setCollectivePathCut(event.target.checked)} /> Collective cut across adjacent plots</label><label htmlFor="path-mode">Path method<select id="path-mode" value={pathMode} onChange={event => { setPathMode(event.target.value as 'free' | 'attached'); setPathDrawingEnabled(false); setPathDraftPoints([]) }}><option value="free">Free-drawn outline</option><option value="attached">Attach to a side</option></select></label></div>{pathMode === 'attached' ? <div className="path-tool-controls"><label htmlFor="path-parcel">Parcel<select id="path-parcel" value={selectedPathParcel?.id ?? ''} onChange={event => { setPathParcelId(event.target.value); setPathEdgeIndex(0) }}>{parcels.map(parcel => <option key={parcel.id} value={parcel.id}>{parcel.name}</option>)}</select></label><label htmlFor="path-side">Attached side<select id="path-side" value={pathEdgeIndex} onChange={event => setPathEdgeIndex(Number(event.target.value))}>{selectedPathParcel?.points.map((point, index) => <option key={`${selectedPathParcel.id}-path-edge-${index}`} value={index}>Side {String.fromCharCode(65 + index)}–{String.fromCharCode(65 + (index + 1) % selectedPathParcel.points.length)} · {formatLengthValue(distance(point, selectedPathParcel.points[(index + 1) % selectedPathParcel.points.length]), unit)}</option>)}</select></label><label htmlFor="path-width">Path width<input id="path-width" type="number" min="0.1" step="0.1" value={pathWidth} onChange={event => setPathWidth(event.target.value)} /><span>{unit === 'feet' ? 'ft' : 'Karam'}</span></label><label htmlFor="path-widen-side">Widen toward<select id="path-widen-side" value={pathWidenSide} onChange={event => setPathWidenSide(event.target.value as 'left' | 'right')}><option value="left">Left side of marked path</option><option value="right">Right side of marked path</option></select></label><label htmlFor="path-deduction-mode">Deduct path area<select id="path-deduction-mode" value={pathDeductionMode} onChange={event => setPathDeductionMode(event.target.value as 'proportionate' | 'owner')}><option value="proportionate">Proportionately from all owners</option><option value="owner">From one owner only</option></select></label>{pathDeductionMode === 'owner' && <label htmlFor="path-deduction-owner">Owner to deduct<input id="path-deduction-owner" value={pathDeductionOwner} onChange={event => setPathDeductionOwner(event.target.value)} placeholder="Owner name" /></label>}<button type="button" onClick={addAttachedPath}>Add attached path</button></div> : <div className="path-tool-controls"><label htmlFor="path-free-parcel">Plot containing path<select id="path-free-parcel" value={selectedPathParcel?.id ?? ''} onChange={event => setPathParcelId(event.target.value)}>{parcels.map(parcel => <option key={parcel.id} value={parcel.id}>{parcel.name}</option>)}</select></label><label htmlFor="path-width">Path width<input id="path-width" type="number" min="0.1" step="0.1" value={pathWidth} onChange={event => setPathWidth(event.target.value)} /><span>{unit === 'feet' ? 'ft' : 'Karam'}</span></label><label htmlFor="path-widen-side">Widen toward<select id="path-widen-side" value={pathWidenSide} onChange={event => setPathWidenSide(event.target.value as 'left' | 'right')}><option value="left">Left side of marked path</option><option value="right">Right side of marked path</option></select></label><label htmlFor="path-deduction-mode">Deduct path area<select id="path-deduction-mode" value={pathDeductionMode} onChange={event => setPathDeductionMode(event.target.value as 'proportionate' | 'owner')}><option value="proportionate">Proportionately from all owners</option><option value="owner">From one owner only</option></select></label>{pathDeductionMode === 'owner' && <label htmlFor="path-deduction-owner">Owner to deduct<input id="path-deduction-owner" value={pathDeductionOwner} onChange={event => setPathDeductionOwner(event.target.value)} placeholder="Owner name" /></label>}<p className="path-draw-instruction" aria-live="polite">{pathDrawingEnabled ? `Mark at least 2 centerline points on the plan (${pathDraftPoints.length} marked).` : 'Start drawing, then mark at least 2 points along the path centerline.'}</p>{pathDrawingEnabled ? <><button type="button" onClick={() => setPathDraftPoints(current => current.slice(0, -1))} disabled={!pathDraftPoints.length}>Undo corner</button><button type="button" onClick={finishFreePath} disabled={pathDraftPoints.length < 3}>Finish path</button><button type="button" className="path-cancel-button" onClick={() => { setPathDrawingEnabled(false); setPathDraftPoints([]) }}>Cancel</button></> : <button type="button" onClick={() => { setDraftCut(null); setPathDraftPoints([]); setPathDrawingEnabled(true) }}>Draw free path</button>}</div>}{paths.length > 0 && <div className="path-list" aria-live="polite">{paths.map(path => { const area = portionsAreaTotal(portionsFor({ id: path.id, name: path.name, owner: 'Path', points: path.points, fixedEdges: [], targetMarla: '' }, undefined, unit)); return <div key={path.id}><span><strong>{path.name}</strong> · {path.mode === 'attached' ? 'Attached' : 'Free'} · {formatArea(area)} K–M</span><button type="button" className="path-remove-button" onClick={() => { recordUndo(); setPaths(current => current.filter(item => item.id !== path.id)) }} aria-label={`Remove ${path.name}`}>Remove</button></div> })}<strong className="path-total">Path total: {formatArea(pathAreaTotal)} K–M</strong></div>}</section><div className="drawing-toolbar"><div><span className="eyebrow">02 / DRAWING BOARD</span><h2>Measured site plan</h2></div><div className="drawing-tools"><button className={`trace-launch-button${isTracing ? ' selected' : ''}`} onClick={() => setIsTracing(current => !current)} aria-pressed={isTracing}><Upload /><span>{isTracing ? 'Close trace' : 'Trace photo'}</span></button><div className="rotation-control" role="group" aria-label="Rotate drawing"><span>ROTATE</span><button onClick={() => setDrawingRotation(current => (current + 359) % 360)} aria-label="Rotate drawing counterclockwise one degree" title="Rotate counterclockwise one degree"><RotateCcw /></button><input type="range" min="0" max="359" step="1" value={drawingRotation} aria-label="Drawing rotation in degrees" onChange={event => setDrawingRotation(Number(event.target.value))} /><output aria-live="polite">{drawingRotation}°</output><button onClick={() => setDrawingRotation(current => (current + 1) % 360)} aria-label="Rotate drawing clockwise one degree" title="Rotate clockwise one degree"><RotateCw /></button></div><label htmlFor="north-select">NORTH</label><div className="select-wrap"><NorthIcon /><select id="north-select" value={direction} onChange={event => setDirection(event.target.value as Direction)}><option value="top">Top of page</option><option value="right">Right of page</option><option value="bottom">Bottom of page</option><option value="left">Left of page</option></select><ChevronDown /></div></div></div>
            {isTracing ? <DiagramTrace unit={unit} onApply={useTracedPoints} onCancel={() => setIsTracing(false)} /> : <div className="plot-wrap"><Plot parcels={parcels} paths={paths} partialCuts={partialCuts} pathDraftPoints={pathDraftPoints} pathDrawingEnabled={pathDrawingEnabled} pathDraftClosed={partitionMode === 'freeform-parcel'} onPathVertex={addPathVertex} annotateAreas direction={direction} drawingRotation={drawingRotation} freeCutParcelId={freeCutParcelId} partitionScope={partitionScope} targetAreaMarla={hasTargetFreeCutArea ? targetFreeCutAreaMarla : undefined} lockTargetArea={lockFreeCutArea || partitionMode === 'area-lock'} unit={unit} partitionPieces={customPartitions} shareTargets={freeCutTargetAreas} freeCutEnabled={freeCutEnabled} draftCut={draftCut} onDraftChange={setDraftCut} onCutComplete={completeFreeCut} measurementPoints={measurementPoints} measureMode={measureMode} onMeasurePoint={addMeasurementPoint} /></div>}
            <div className="distance-measure-toolbar"><button type="button" className={measureMode ? 'active' : ''} aria-pressed={measureMode} onClick={() => { setMeasureMode(current => !current); setMeasurementPoints([]) }}><Ruler /> {measureMode ? 'Cancel distance measure' : 'Measure between two points'}</button>{measurementPoints.length === 2 && <span>Measured distance · <strong>{formatLengthValue(distance(measurementPoints[0], measurementPoints[1]), unit)}</strong></span>}{measureMode && <p>Click two points on the plan to measure their straight-line distance.</p>}</div>
            <div className="drawing-footer"><span><i className="legend-line"/> Measured boundary</span><span><i className="legend-line shared"/> Shared parcel edge</span><span className="drawing-foot-note">Drawing geometry follows entered dimensions</span></div>
          </div>
          <div className="summary-strip"><div className="summary-cell"><span>PARCELS</span><strong>{String(reportParcels.length).padStart(2, '0')}</strong><small>{sharedSides} shared sides · {parcels.length} source plots · {measuredPaths.length} paths</small></div><div className="summary-cell"><span>COMBINED AREA</span><strong>{areaUnit === 'marla' ? formatArea(totalArea) : fmt(totalArea * 30.25)} <small>{areaUnit === 'marla' ? 'K–M' : 'SQ FT'}</small></strong><small>Sum of portions rounded to 1 marla</small></div><div className="summary-cell"><span>PRINT SCALE</span><strong>1 : 2,640</strong><small>1 inch = 40 Karam</small></div><div className="summary-cell area-toggle-cell"><span>AREA DISPLAY</span><div className="segmented compact"><button className={areaUnit === 'marla' ? 'selected' : ''} onClick={() => setAreaUnit('marla')}>K–M</button><button className={areaUnit === 'sqft' ? 'selected' : ''} onClick={() => setAreaUnit('sqft')}>Sq ft</button></div><small>9 sarsai / marla</small></div></div>
          {message && <p className="inline-message" role="status">{message}</p>}
          <div className="calculation-preview"><div className="preview-heading"><span className="eyebrow">03 / CALCULATION PREVIEW</span><button className="text-action" onClick={() => setActiveTab('calculations')}>Open field sheet <ArrowRight /></button></div>{reportParcels.map((parcel, i) => <div className="preview-row" key={parcel.id}><span className="preview-color" style={{ backgroundColor: parcelColors[i % parcelColors.length] }}/><strong>{parcel.name} · {parcel.owner || 'Owner not named'}</strong><span>{reportPortions[i].map(p => `${p.label}: ${p.formula}`).join(' · ')}</span><b>{formatArea(portionsAreaTotal(reportPortions[i]))} <small>K–M</small></b></div>)}{paths.map((path, index) => { const pathPortions = portionsFor({ id: path.id, name: path.name, owner: path.owner || 'Path', points: path.points, fixedEdges: [], targetMarla: '' }, undefined, unit); return <div className={`preview-row path-preview-row${path.isPartitionedParcel ? ' parcel-preview-row' : ''}`} key={path.id}><span className="path-preview-marker">{path.isPartitionedParcel ? `L${reportParcels.findIndex(parcel => parcel.id === path.id) + 1}` : `P${index + 1}`}</span><strong>{path.isPartitionedParcel ? `${path.name} · ${path.owner}` : `${path.name} · ${path.mode === 'attached' ? 'Attached' : 'Free-drawn'}`}</strong><span>{pathPortions.map(portion => `${portion.label}: ${portion.formula}`).join(' · ')}</span><b>{formatArea(portionsAreaTotal(pathPortions))} <small>K–M</small></b></div> })}<div className="preview-total"><span>Total measured parcel area</span><strong>{formatArea(totalArea)} <small>Kanal–Marla</small></strong></div>{measuredPaths.length > 0 && <div className="preview-total path-preview-total"><span>Separately measured path area</span><strong>{formatArea(pathAreaTotal)} <small>Kanal–Marla</small></strong></div>}</div>
        </section>
      </div> : <div className="calculations-view"><div className="calculation-toolbar"><div><span className="eyebrow">SEPARATE PRINT PAGE · 02</span><h2>Field calculations</h2><p>Numbered parcels and lettered portions for clear survey paperwork.</p></div><button className="print-button" onClick={() => window.print()}><Printer /> Print calculation sheet</button></div><FieldSheet parcels={reportParcels} paths={paths} direction={effectiveDirection} unit={unit} areaUnit={areaUnit} /></div>}

      <footer className="app-footer"><span>FIELDLINE SURVEY DESK <span className="footer-divider">/</span> LAND MEASUREMENT RECORD</span><span>1 Karam = 5.5 ft <span>·</span> 1 sq Karam = 1 sarsai</span></footer>
    </div>

    <div className="print-only print-plan-page scaled-only-page"><div className="print-map"><Plot parcels={parcels} paths={paths.filter(path => path.isPartitionedParcel)} partialCuts={partialCuts} direction={direction} drawingRotation={drawingRotation} unit={unit} partitionPieces={customPartitions} showLabels={false} drawCalculations={false} scaleKaramPerInch={40} /></div></div>
    <div className="print-only print-annotated-page print-plan-page"><div className="print-header"><div><p className="eyebrow">FIELDLINE · ENLARGED PARTITION DETAIL</p><h1>Owner, side &amp; area annotations</h1></div><span>PLAN NO. FS—0248<br/>ENLARGED SCALE 1″ = 11 KARAM</span></div><PrintColorKey parcels={parcels} partitionPieces={customPartitions} shareTargets={freeCutTargetAreas} paths={paths} /><div className="print-map print-map-large"><Plot parcels={parcels} paths={paths} direction={direction} drawingRotation={drawingRotation} unit={unit} partitionPieces={customPartitions} partialCuts={partialCuts} shareTargets={freeCutTargetAreas} showLabels drawCalculations annotateAreas printDetail scaleKaramPerInch={11} /></div><div className="print-annotation-key"><strong>Reading the drawing</strong><span>Dotted line = partition, altitude or mean-dimension guide</span><span><b>h</b> = perpendicular triangle height · M1/M2 = mean side guides</span><span>FIXED = owner side held during area-lock adjustment</span><span>Portion areas rounded to 1 marla; dimensions rounded to 1 {unit === 'feet' ? 'foot' : 'Karam'}.</span></div><div className="print-formula-key">{reportParcels.map((parcel, i) => <div key={parcel.id}><strong>{parcel.name} · {parcel.owner || 'Owner not named'}</strong>{reportPortions[i].map(portion => <span key={`${parcel.id}-${portion.label}`}>{portion.label}: {portion.formula}</span>)}</div>)}{paths.map(path => <div key={path.id}><strong>{path.name} · Path area</strong>{portionsFor({ id: path.id, name: path.name, owner: 'Path', points: path.points, fixedEdges: [], targetMarla: '' }, undefined, unit).map(portion => <span key={`${path.id}-${portion.label}`}>{portion.label}: {portion.formula}</span>)}</div>)}</div><div className="print-scale-note">This enlarged detail is for reading labels only. Measure from the unlabeled 40-Karam-per-inch plan on page 1. Print at 100% / Actual size.</div></div>
    <div className="print-only print-calculation-page"><FieldSheet parcels={reportParcels} paths={paths} direction={effectiveDirection} unit={unit} areaUnit={areaUnit} /></div>
  </main>
}
export default ParcelWorkspace
