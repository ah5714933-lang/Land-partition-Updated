export type SurveyPoint = {
  id: string
  east: number
  north: number
}

export type Parcel = {
  id: string
  name: string
  points: SurveyPoint[]
  targetArea: string
}

export type Portion = {
  id: string
  label: string
  kind: string
  formula: string
  area: number
  points: SurveyPoint[]
  sides: Array<{ direction: CardinalDirection; length: number; from: string; to: string }>
}

export type CardinalDirection = 'East' | 'West' | 'South' | 'North'
export type NorthOrientation = CardinalDirection

const EPSILON = 1e-8

export function distance(a: SurveyPoint, b: SurveyPoint) {
  return Math.hypot(b.east - a.east, b.north - a.north)
}

export function polygonArea(points: SurveyPoint[]) {
  if (points.length < 3) return 0
  return Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]
      return sum + point.east * next.north - next.east * point.north
    }, 0),
  ) / 2
}

function cross(a: SurveyPoint, b: SurveyPoint, c: SurveyPoint) {
  return (b.east - a.east) * (c.north - a.north) - (b.north - a.north) * (c.east - a.east)
}

function near(a: number, b: number, tolerance = 0.03) {
  return Math.abs(a - b) <= tolerance
}

function isRightAngle(points: SurveyPoint[]) {
  return points.every((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]
    const next = points[(index + 1) % points.length]
    const ax = previous.east - point.east
    const ay = previous.north - point.north
    const bx = next.east - point.east
    const by = next.north - point.north
    const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by)
    return denominator > EPSILON && Math.abs((ax * bx + ay * by) / denominator) < 0.025
  })
}

function pointInTriangle(point: SurveyPoint, a: SurveyPoint, b: SurveyPoint, c: SurveyPoint, orientation: number) {
  const first = cross(a, b, point) * orientation
  const second = cross(b, c, point) * orientation
  const third = cross(c, a, point) * orientation
  return first >= -EPSILON && second >= -EPSILON && third >= -EPSILON
}

function triangulate(points: SurveyPoint[]) {
  const indexes = points.map((_, index) => index)
  const orientation = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point.east * next.north - next.east * point.north
  }, 0) >= 0 ? 1 : -1
  const triangles: SurveyPoint[][] = []

  while (indexes.length > 3) {
    const ears = indexes.flatMap((current, index) => {
      const previous = indexes[(index + indexes.length - 1) % indexes.length]
      const next = indexes[(index + 1) % indexes.length]
      const a = points[previous]
      const b = points[current]
      const c = points[next]
      if (cross(a, b, c) * orientation <= EPSILON) return []
      if (indexes.some((candidate) => candidate !== previous && candidate !== current && candidate !== next && pointInTriangle(points[candidate], a, b, c, orientation))) return []
      return [{ index, previous, current, next, diagonal: distance(a, c) }]
    })
    if (!ears.length) return []
    const ear = ears.sort((a, b) => b.diagonal - a.diagonal)[0]
    triangles.push([points[ear.previous], points[ear.current], points[ear.next]])
    indexes.splice(ear.index, 1)
  }

  if (indexes.length === 3) triangles.push(indexes.map((index) => points[index]))
  return triangles
}

function trianglePortion(points: SurveyPoint[], label: string, north: NorthOrientation): Portion {
  const edges = points.map((point, index) => ({
    a: point,
    b: points[(index + 1) % points.length],
    length: distance(point, points[(index + 1) % points.length]),
  }))
  const longest = edges.reduce((best, edge) => edge.length > best.length ? edge : best, edges[0])
  const opposite = points.find((point) => point.id !== longest.a.id && point.id !== longest.b.id) ?? points[2]
  const height = Math.abs(cross(longest.a, longest.b, opposite)) / Math.max(longest.length, EPSILON)
  const area = longest.length * height / 2
  return {
    id: label,
    label,
    kind: 'Triangle',
    formula: `${formatNumber(longest.length)} × ${formatNumber(height)} ÷ 2 = ${formatNumber(area)} sarsai`,
    area,
    points,
    sides: getSides(points, north),
  }
}

function getSides(points: SurveyPoint[], north: NorthOrientation) {
  const clockwise = ['North', 'East', 'South', 'West'] as const
  const northOffset = clockwise.indexOf(north)
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length]
    const deltaEast = next.east - point.east
    const deltaNorth = next.north - point.north
    const bearing = (Math.atan2(deltaEast, deltaNorth) * 180 / Math.PI + 360) % 360
    const quadrant = Math.floor(((bearing + 45) % 360) / 90)
    return {
      direction: clockwise[(quadrant + northOffset) % 4] as CardinalDirection,
      length: distance(point, next),
      from: point.id,
      to: next.id,
    }
  })
}

export function analyzeParcel(parcel: Parcel, north: NorthOrientation) {
  const points = parcel.points
  if (points.length < 3) return { area: 0, portions: [] as Portion[], method: 'Add at least three measured vertices.' }
  const area = polygonArea(points)
  if (area < EPSILON) return { area: 0, portions: [] as Portion[], method: 'These vertices do not enclose an area.' }

  const edges = points.map((point, index) => distance(point, points[(index + 1) % points.length]))
  let portions: Portion[]
  let method: string

  if (points.length === 3) {
    portions = [trianglePortion(points, 'a', north)]
    method = 'Triangle — longest side × perpendicular height ÷ 2.'
  } else if (points.length === 4) {
    const oppositeAverages = [(edges[0] + edges[2]) / 2, (edges[1] + edges[3]) / 2]
    const square = near(edges[0], edges[1]) && near(edges[1], edges[2]) && near(edges[2], edges[3]) && isRightAngle(points)
    const rectangle = near(edges[0], edges[2]) && near(edges[1], edges[3]) && isRightAngle(points)
    const opposingDifference = Math.max(Math.abs(edges[0] - edges[2]), Math.abs(edges[1] - edges[3]))

    if (square) {
      const side = edges.reduce((sum, value) => sum + value, 0) / 4
      const squareArea = side * side
      portions = [{ id: 'a', label: 'a', kind: 'Square', formula: `${formatNumber(side)} × ${formatNumber(side)} = ${formatNumber(squareArea)} sarsai`, area: squareArea, points, sides: getSides(points, north) }]
      method = 'Square — length × length.'
    } else if (rectangle) {
      const rectangleArea = oppositeAverages[0] * oppositeAverages[1]
      portions = [{ id: 'a', label: 'a', kind: 'Rectangle', formula: `${formatNumber(oppositeAverages[0])} × ${formatNumber(oppositeAverages[1])} = ${formatNumber(rectangleArea)} sarsai`, area: rectangleArea, points, sides: getSides(points, north) }]
      method = 'Regular rectangle — average opposite lengths multiplied.'
    } else if (opposingDifference <= 5) {
      const quadArea = oppositeAverages[0] * oppositeAverages[1]
      portions = [{ id: 'a', label: 'a', kind: 'Four-sided field formula', formula: `((${formatNumber(edges[0])} + ${formatNumber(edges[2])}) ÷ 2) × ((${formatNumber(edges[1])} + ${formatNumber(edges[3])}) ÷ 2) = ${formatNumber(quadArea)} sarsai`, area: quadArea, points, sides: getSides(points, north) }]
      method = `Four-sided Patwari formula — opposing averages multiplied (maximum opposing difference ${formatNumber(opposingDifference)} karam).`
    } else {
      const diagonal = [
        { first: 0, second: 2, length: distance(points[0], points[2]) },
        { first: 1, second: 3, length: distance(points[1], points[3]) },
      ].sort((a, b) => b.length - a.length)[0]
      const triangles = diagonal.first === 0
        ? [[points[0], points[1], points[2]], [points[0], points[2], points[3]]]
        : [[points[1], points[2], points[3]], [points[1], points[3], points[0]]]
      portions = triangles.map((triangle, index) => trianglePortion(triangle, String.fromCharCode(97 + index), north))
      method = `Irregular quadrilateral — split at the longer vertex-to-vertex diagonal (${formatNumber(diagonal.length)} karam).`
    }
  } else {
    const triangles = triangulate(points)
    portions = triangles.map((triangle, index) => trianglePortion(triangle, String.fromCharCode(97 + index), north))
    method = triangles.length
      ? 'Irregular polygon — divided into vertex-connected triangles; longest valid diagonals preferred.'
      : 'Unable to partition this outline. Check that vertices form one simple, non-crossing boundary.'
  }

  return { area: portions.reduce((sum, portion) => sum + portion.area, 0), portions, method }
}

export function formatNumber(value: number, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)).toLocaleString('en-US') : '—'
}

export function roundToMarla(sarsai: number) {
  return Math.max(0, Math.round(sarsai / 9))
}

export function formatKanalMarla(sarsai: number) {
  const marla = roundToMarla(sarsai)
  return `${Math.floor(marla / 20)}-${marla % 20}`
}

export function getBounds(parcels: Parcel[]) {
  const points = parcels.flatMap((parcel) => parcel.points)
  const east = points.map((point) => point.east)
  const north = points.map((point) => point.north)
  return {
    minEast: Math.min(...east, 0),
    maxEast: Math.max(...east, 1),
    minNorth: Math.min(...north, 0),
    maxNorth: Math.max(...north, 1),
  }
}

export function createParcelId(index: number) {
  let value = index + 1
  let label = ''
  while (value > 0) {
    value -= 1
    label = String.fromCharCode(65 + value % 26) + label
    value = Math.floor(value / 26)
  }
  return label
}

export function getNextVertexId(points: SurveyPoint[]) {
  return String.fromCharCode(65 + points.length)
}

export function formatFeet(karam: number) {
  return `${formatNumber(karam * 5.5)} ft`
}

export function asKaram(value: number, unit: 'karam' | 'feet') {
  return unit === 'feet' ? value / 5.5 : value
}

export function formatAreaRaw(sarsai: number) {
  return `${formatNumber(sarsai)} sarsai · ${formatKanalMarla(sarsai)} Kanal-Marla`
}

export function createInitialParcels(): Parcel[] {
  return [
    {
      id: 'A', name: 'Parcel 1', targetArea: '',
      points: [
        { id: 'A', east: 0, north: 0 },
        { id: 'B', east: 40, north: 0 },
        { id: 'C', east: 40, north: 40 },
        { id: 'D', east: 0, north: 40 },
      ],
    },
    {
      id: 'B', name: 'Parcel 2', targetArea: '',
      points: [
        { id: 'A', east: 40, north: 0 },
        { id: 'B', east: 80, north: 0 },
        { id: 'C', east: 80, north: 40 },
        { id: 'D', east: 40, north: 40 },
      ],
    },
  ]
}

export function createAdjacentParcel(parcels: Parcel[]) {
  const { maxEast, minNorth } = getBounds(parcels)
  const centerNorth = minNorth + (getBounds(parcels).maxNorth - minNorth) / 2
  const id = createParcelId(parcels.length)
  const name = `Parcel ${parcels.length + 1}`
  return {
    id,
    name,
    targetArea: '',
    points: [
      { id: 'A', east: maxEast, north: minNorth },
      { id: 'B', east: maxEast + 40, north: minNorth },
      { id: 'C', east: maxEast + 40, north: minNorth + Math.max(1, centerNorth - minNorth) * 2 },
      { id: 'D', east: maxEast, north: minNorth + Math.max(1, centerNorth - minNorth) * 2 },
    ],
  } satisfies Parcel
}

export function createNewVertex(points: SurveyPoint[]) {
  const last = points[points.length - 1]
  return { id: getNextVertexId(points), east: (last?.east ?? 0) + 40, north: last?.north ?? 0 }
}

export function sharesBoundary(first: Parcel, second: Parcel) {
  return first.points.some((a, index) => {
    const b = first.points[(index + 1) % first.points.length]
    return second.points.some((c, otherIndex) => {
      const d = second.points[(otherIndex + 1) % second.points.length]
      return (near(a.east, d.east, 0.001) && near(a.north, d.north, 0.001) && near(b.east, c.east, 0.001) && near(b.north, c.north, 0.001)) ||
        (near(a.east, c.east, 0.001) && near(a.north, c.north, 0.001) && near(b.east, d.east, 0.001) && near(b.north, d.north, 0.001))
    })
  })
}

export function describeUnitArea(sarsai: number) {
  const marla = roundToMarla(sarsai)
  const kanal = Math.floor(marla / 20)
  const remainder = marla % 20
  return { marla, kanal, remainder }
}

export const FIELD_UNITS = { feetPerKaram: 5.5, sarsaiPerSquareKaram: 1, sarsaiPerMarla: 9, marlaPerKanal: 20, printScale: 40 }
