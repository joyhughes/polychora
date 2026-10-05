# Polychoron Viewer

Interactive WebGL2 viewer for 4D objects:

- **The 16 regular polychora**: the 6 convex regular 4-polytopes and all 10 Schläfli–Hess star polychora (the regular stellations of the 120-cell and 600-cell), with adjustable cell shrink
- **Clifford torus** and the family of flat tori in S³: torus angle η, solid-shell thickness, mesh resolution, grid lines, and a (p, q) torus knot or link drawn on the surface
- **Hopf fibration**: fibres over latitude rings, a Fibonacci spread over S², or one tilted great circle; ring count, latitude, spread, phase, animated flow, tube radius, and optional Hopf tori
- **Sierpinski fractals**: pentatope, 16-cell, Cantor tesseract, Menger tesseract and Vicsek tesseract, with fractal depth and (where it applies) the scale ratio; the similarity dimension is shown live

**Combine them:** stack any number of shapes, each with its own type, parameters, 4D placement (offset, scale, rotation in all six planes) and colour, and add, subtract or intersect them in 4D.

**Live:** https://joyhughes.github.io/polychora/

## Features

- Projection (4D → 3D: perspective, orthographic or stereographic) or hyperplane slicing at any w, with an automatic sweep
- 4D spin in all six rotation planes, with simple, double and isoclinic presets; Shift-drag rotates in 4D by hand
- Off-centre rotation: set the centre of rotation anywhere in 4D (or snap it to a vertex), and the object swings around it, through the slice and toward or away from the 4D eye
- Capture: save PNG snapshots (screen size, 2× or 4×) and record the canvas as MP4 or WebM video (`P` and `R` keys)
- Solid, translucent (depth-sorted) or wireframe surfaces
- Flat colours (by Hopf fibre) or colours by 4D depth (kata −w → ana +w)
- Perspective or orthographic 3D camera

Spins act in the object's own frame, so the Isoclinic preset (equal XY and ZW) slides every point along its Hopf fibre.

Deep links: `#clifford`, `#hopf`, `#menger`, `#sierpinski-5`, `#great-grand` …, add `.sliced` to open in slice view and `.pivot=x,y,z,w` to set the centre of rotation (e.g. `#tesseract.sliced.pivot=0.5,0.5,0.5,0.5`).

Keys: Space pause, `[` `]` change polytope, `S` toggle slice.

## How the geometry is built

`geometry.js` builds every polytope the same way: a vertex set on the unit 3-sphere (600-cell or 120-cell vertices for the H4 family), a set of cell-centre directions, a cell hyperplane height `h` and an edge cosine `e`. Each cell is the vertex layer `{v : v·n = h}`, and its faces are the planar p-cycles of the edge graph inside that layer. Counts of cells, faces, edges and vertices, and vertex figures, match the published tables for all 16.

`objects.js` turns every object into one generic 4D mesh: surface triangles (drawn in projection, sliced into curves), solid tetrahedra (sliced into surfaces), edges, and polylines (drawn as tubes, sliced into points). Fractals are built by iterating their maps; cells shared by two copies are interior and removed.

Slices are exact: each cell is decomposed into tetrahedra (cell centre + fan triangle of each face), and those are cut by the hyperplane every frame.

`csg.js` combines shapes in 4D. Every solid gets a field that is negative inside: the largest `n·p − h` over the cells for a convex polytope; `|p| − r(p/|p|)` for a star polytope, whose solid is everything its cells hide from the centre; and the iterated maps applied to the base polytope for a fractal. Each field also reports the hyperplane it is resting on. Shapes are combined from the top down, one at a time. The result so far is clipped against the new shape, and the new shape against the result so far. A simplex the cut crosses on one flat piece is cut exactly. One where the cut bends is first split along the hyperplane of a boundary piece. Corners of the other shape that poke into a simplex are found exactly, by testing its cell, faces and edges against the other mesh's edges, faces and cells. The cut through each cell becomes new faces and edges, so projection, slicing and wireframe all show the combined shape. Faces two shapes share are kept exactly once. Surfaces and curves (Clifford torus, Hopf fibres) have no inside: they are cut by solids but cut nothing. Star polytopes keep their inner faces, as they do when shown alone. The work runs in a Web Worker (`worker.js`), so the view stays responsive while big combinations are computed.

No build step; open `index.html` from any static server.
