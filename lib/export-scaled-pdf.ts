/** Label-free, vector survey PDF. Every karam is exactly 72 / 40 points on paper. */
export type SurveyPoint = { x: number; y: number }
export type SurveyLine = [SurveyPoint, SurveyPoint]
export type SurveyPdfData = {
  outlines: SurveyPoint[][]
  cuts: SurveyLine[]
}
const A4_LANDSCAPE = { width: 841.8898, height: 595.2756 } // PDF points
const POINTS_PER_KARAM = 72 / 40
const PAGE_INSET = 18 // 1/4 inch white safety margin; geometry itself stays at scale

const compact = (n: number) => (Math.round(n * 10000) / 10000).toString()
const ascii = (value: string) => new TextEncoder().encode(value)

/** Returns a true-size, automatically tiled A4 landscape PDF, without any text. */
export function makeScaledSurveyPdf(data: SurveyPdfData): Uint8Array {
  const segments: SurveyLine[] = [
    ...data.outlines.flatMap(points => points.map((point, i): SurveyLine => [point, points[(i + 1) % points.length]])),
    ...data.cuts,
  ].filter(([a, b]) => Number.isFinite(a.x + a.y + b.x + b.y) && Math.hypot(b.x - a.x, b.y - a.y) > 1e-8)
  if (!segments.length) throw new Error('There are no parcel boundaries to export.')
  const coords = segments.flat()
  const minX = Math.min(...coords.map(p => p.x)), maxX = Math.max(...coords.map(p => p.x))
  const minY = Math.min(...coords.map(p => p.y)), maxY = Math.max(...coords.map(p => p.y))
  const printableWidth = A4_LANDSCAPE.width - PAGE_INSET * 2
  const printableHeight = A4_LANDSCAPE.height - PAGE_INSET * 2
  const tileWidth = printableWidth / POINTS_PER_KARAM
  const tileHeight = printableHeight / POINTS_PER_KARAM
  const nx = Math.max(1, Math.ceil(((maxX - minX) * POINTS_PER_KARAM - 1e-6) / printableWidth))
  const ny = Math.max(1, Math.ceil(((maxY - minY) * POINTS_PER_KARAM - 1e-6) / printableHeight))
  if (nx * ny > 200) throw new Error('The plan requires over 200 A4 pages at the requested true scale.')

  const objects: string[] = []
  const add = (s: string) => { objects.push(s); return objects.length }
  const catalog = add('')
  const pagesRef = add('')
  const pageIds: number[] = []
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const x0 = minX + x * tileWidth
    const y0 = minY + y * tileHeight
    // PDF origin is bottom-left; the UI map uses top-left. Flip Y on paper
    // without reflecting the traced geometry horizontally.
    const lineCommands = segments.map(([a, b]) => `${compact(PAGE_INSET + (a.x - x0) * POINTS_PER_KARAM)} ${compact(A4_LANDSCAPE.height - PAGE_INSET - (a.y - y0) * POINTS_PER_KARAM)} m ${compact(PAGE_INSET + (b.x - x0) * POINTS_PER_KARAM)} ${compact(A4_LANDSCAPE.height - PAGE_INSET - (b.y - y0) * POINTS_PER_KARAM)} l S`).join('\n')
    const stream = `q\n${compact(PAGE_INSET)} ${compact(PAGE_INSET)} ${compact(printableWidth)} ${compact(printableHeight)} re W n\n0 0 0 RG\n0.65 w\n${lineCommands}\nQ\n`
    const content = add(`<< /Length ${ascii(stream).length} >>\nstream\n${stream}endstream`)
    const page = add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${compact(A4_LANDSCAPE.width)} ${compact(A4_LANDSCAPE.height)}] /Contents ${content} 0 R /Resources << >> >>`)
    pageIds.push(page)
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRef} 0 R >>`
  objects[pagesRef - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(ascii(pdf).length)
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xref = ascii(pdf).length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return ascii(pdf)
}
