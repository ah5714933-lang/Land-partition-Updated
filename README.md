# Land Partition Diverse — survey workspace

Next.js land tracing, area calculations, adjoining-plot division and measured 40-karam/inch PDF export.

## Getting started

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Use **Trace photo** to mark corners on the image and supply measured side lengths. The output plan now preserves the traced image's orientation, without the previous vertical mirroring. Additional plots can be attached to shared sides.

## Partitioning

Open **Free-cut partition** and choose **All adjacent plots collectively**. Draw cuts directly across the site plan; no parcel number, co-sharer count or share area is required. A stroke from one boundary to another divides the intervened parcel(s), retaining each parcel's calculated area. Turn on **Allow partial cuts** (enabled by default) to retain lines ending inside the parcel. Such lines are intentionally drawn as survey marks, **not** as closed, area-bearing parcels; they become actual divisions only when there is a boundary-to-boundary chord.

The separate **Target areas**, **Road frontage** and **Area-locked cut** modes still support allocation by specified shares and areas. These modes have their own additional data requirements.

## Measured area and diagonals

Enter a required area in the **Target area** field, then select **Auto-adjust internal lengths**. Where interior corners are adjustable, external vertices and any locked sides are kept fixed. For an independent four-sided parcel, the area or opposite-corner diagonal can be adjusted by flexing internal angles while keeping all four outer side lengths unchanged. A target that is geometrically impossible is reported rather than inventing a solution. Editing shared/locked boundaries independently is prohibited.

**Internal distance / diagonal** accepts two existing corners and a requested length (karam or feet). Arbitrary positions may be checked using **Measure between two points** on the plan; these free-click measurements are observations rather than unconstrained automatic deformation instructions.

## PDF export

Use **Download scaled PDF (40 K/in)** for a vector PDF with parcel outlines and cut lines **only**: no titles, owner labels, corner letters, measurements, header or footer. It uses precisely **40 karam per physical inch** (one karam = 1.8 PDF points). If a plan doesn't fit, it is tiled into A4 landscape pages **without changing its scale**. Page margins are clear safety space, not geometry scaling. The optional browser print option prints the additional annotated calculation sheets and depends on the browser's own page settings.

## Testing

```bash
pnpm test:geometry
pnpm build
```

The geometry smoke test covers orientation, partial and collective cuts, area conservation, diagonal lengths and fixed-perimeter target areas. Run the full production build after installing dependencies.
