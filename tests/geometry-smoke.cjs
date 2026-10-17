/* No third-party dependencies; run with Node + TypeScript available globally.
   This fixture extracts the pure workspace geometry methods without rendering React. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const file = fs.readFileSync(path.join(__dirname, '../components/parcel-workspace.tsx'), 'utf8')
const source = ts.createSourceFile('workspace.tsx', file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const selected = ['pointInPolygon', 'projectToBoundary', 'splitPolygonByChord', 'clipStrokeToPolygon', 'isOnSegment', 'isSimplePolygon', 'quadrilateralAtDiagonal', 'fitQuadrilateralArea', 'rotated', 'svgPointToWorld']
const extract = source.statements.filter(st => ts.isFunctionDeclaration(st) && selected.includes(st.name?.text))
const definitions = `type Point = {x:number;y:number}; const EPS = 0.0001; const distance = (a:Point,b:Point) => Math.hypot(a.x-b.x,a.y-b.y); const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); const samePoint=(a:Point,b:Point)=>Math.abs(a.x-b.x)<EPS&&Math.abs(a.y-b.y)<EPS; const polygonArea=(pts:Point[])=>Math.abs(pts.reduce((sum,p,i)=>{const q=pts[(i+1)%pts.length];return sum+p.x*q.y-q.x*p.y},0))/2;`
const tsCode = definitions + extract.map(st => st.getFullText(source)).join('\n') + '\n' + `globalThis.geometry = {${selected.join(',')}};`
const compiled = ts.transpileModule(tsCode,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const sandbox = {Math, globalThis: {}}
vm.runInNewContext(compiled,sandbox)
const g = sandbox.globalThis.geometry
const box = [{x:0,y:0},{x:40,y:0},{x:40,y:30},{x:0,y:30}]
const eq = (n,v,tolerance=1e-6) => assert.ok(Math.abs(n-v)<tolerance,`${n} != ${v}`)
// No horizontal mirroring: photo coordinate is the screen coordinate.
assert.ok(g.rotated({x:5,y:12},0).x === 5 && g.rotated({x:5,y:12},0).y === 12)
assert.ok(g.svgPointToWorld({x:5,y:12},0).y === 12)
// Full chord splits the polygon and conserves its area.
const full=g.clipStrokeToPolygon(box,{x:-10,y:15},{x:50,y:15})
assert.equal(full.length,1)
eq(full[0][0].x,0);eq(full[0][1].x,40)
const split=g.splitPolygonByChord(box,...full[0])
assert.equal(split.length,2)
eq(split.map(p=>p.reduce((sum,v,i)=>{const q=p[(i+1)%p.length];return sum+v.x*q.y-q.x*v.y},0)).reduce((a,v)=>a+Math.abs(v)/2,0),1200)
// Interior endpoints must NOT be extended to the outside edge.
const partial=g.clipStrokeToPolygon(box,{x:10,y:12},{x:20,y:16})
assert.equal(partial.length,1)
eq(partial[0][0].x,10);eq(partial[0][1].x,20)
// A stroke across two neighboring plots clips to each plot separately.
const adjacent=[{x:40,y:0},{x:70,y:0},{x:70,y:30},{x:40,y:30}]
const first=g.clipStrokeToPolygon(box,{x:5,y:15},{x:60,y:15});const second=g.clipStrokeToPolygon(adjacent,{x:5,y:15},{x:60,y:15})
eq(first[0][1].x,40);eq(second[0][0].x,40);eq(second[0][1].x,60)
// A diagonal and area can be changed without altering outside lengths.
const reshape=g.quadrilateralAtDiagonal(box,43)
assert.ok(reshape)
for(let i=0;i<4;i++)eq(Math.hypot(reshape[i].x-reshape[(i+1)%4].x,reshape[i].y-reshape[(i+1)%4].y),Math.hypot(box[i].x-box[(i+1)%4].x,box[i].y-box[(i+1)%4].y))
eq(Math.hypot(reshape[0].x-reshape[2].x,reshape[0].y-reshape[2].y),43)
const areaFit=g.fitQuadrilateralArea(box,900)
assert.ok(areaFit.points)
const pts=areaFit.points
const actual=Math.abs(pts.reduce((sum,p,i)=>{const q=pts[(i+1)%pts.length];return sum+p.x*q.y-q.x*p.y},0))/2
eq(actual,900,0.05)
for(let i=0;i<4;i++)eq(Math.hypot(pts[i].x-pts[(i+1)%4].x,pts[i].y-pts[(i+1)%4].y),Math.hypot(box[i].x-box[(i+1)%4].x,box[i].y-box[(i+1)%4].y))
console.log('PASS: orientation, clipped partial strokes, collective clipping, area-conserving split, diagonal lengths, fixed-perimeter target area')
