# Polychoron Viewer

Interactive WebGL2 viewer for 4D objects:

- **The 16 regular polychora**: the 6 convex regular 4-polytopes and all 10 Schläfli–Hess star polychora (the regular stellations of the 120-cell and 600-cell), with adjustable cell shrink
- **The permutohedron** (omnitruncated 5-cell): the 120 orderings of (1, 2, 3, 4, 5), with 10 truncated-octahedron and 20 hexagonal-prism cells
- **Clifford torus** and the family of flat tori in S³: torus angle η, solid-shell thickness, mesh resolution, grid lines, and a (p, q) torus knot or link drawn on the surface
- **Black hole**: the curved 3D space around a Schwarzschild black hole, which fits exactly in flat 4D as the hypersurface w = 2√(rₛ(r − rₛ)) (Flamm's paraboloid one dimension up), coloured by how fast a clock runs there; optionally both sheets of the Einstein–Rosen bridge. Light rays follow the photon orbit equation u'' + u = (3/2) rₛ u²: they bend, wind round the photon sphere at 1.5 rₛ, or fall in below the capture limit (3√3/2) rₛ. The slice y = 0 is the textbook funnel diagram. Optionally rotating (Kerr), with spin up to 0.99: the equator is embedded exactly (computed numerically), the horizon becomes an oblate spheroid, the ergosphere is tinted violet, and equatorial light rays follow exact Kerr null geodesics, so rays passing on the side turning with the hole get closer before they are captured; off the equator the shape is a picture rather than an exact embedding
- **Hopf chord (4D music)**: a point travels round one Hopf fibre, and its four coordinates are four voices. Each coordinate from −1 to +1 sweeps one octave of its voice (voices stacked a chosen number of octaves apart, from a chosen root), played live with Web Audio: glide or snap to chromatic, major, pentatonic or just notes; sine, triangle, reed or glass tone; equal voices or loudness from coordinate² (always summing to one); and the chord can follow the shape's coordinates or the spinning view. The fibre's base point on S² sets how far each pair of voices swings
- **Hopf fibration**: fibres over latitude rings, a Fibonacci spread over S², or one tilted great circle; ring count, latitude, spread, phase, animated flow, tube radius, and optional Hopf tori
- **Sierpinski fractals**: pentatope, 16-cell, Cantor tesseract, Menger tesseract and Vicsek tesseract, with fractal depth and (where it applies) the scale ratio; the similarity dimension is shown live
- **Fractal mountain**: a 4D landscape, the solid under a height y = h(x, z, w) over a cube of ground, grown by diamond–square on a 3D grid; seed, detail, roughness, height, sea level and snow line. Each slice across w is an ordinary 3D mountain, and sweeping the slice moves through the range
- **L-system tree**: a bracketed L-system drawn by a 4D turtle. Edit the axiom and rules (several rules for one symbol choose at random), iterations, angle, length and width ratios, thickness and leaves, or start from a preset. `F` draws a branch (a 4D prism over an icosahedron), `[ ]` forks, `+ −` turn, `& ^` pitch, `< >` turn into w, `\ /` and `{ }` roll, `|` turns around, `!` and `"` thin and shorten, `L` puts down a 16-cell leaf, and `+(30)` gives a turn its own angle

**Melodies as shapes:** a tune becomes a 4D shape. In Tymoczko's four-note chord space each run of four notes is a chord with its voices sorted, drawn with its shape in x, y, z and its register (the (1,1,1,1) direction) in w, so each step of the tune is a voice leading; or each pair of notes is a point on the Clifford torus (pitch classes on the chromatic circle or the circle of fifths). The shape is the 4D convex hull of every point the tune visits, with the melody's path inside it, and the tune can be played while a ball follows the path. Pieces: Für Elise, Ode to Joy, the opening of Beethoven's 5th, Eine kleine Nachtmusik, Bach's Toccata in D minor, Holst's Jupiter (the Thaxted tune) and the Minute Waltz from public-domain scores, and (approximately, from memory) Brandenburg Concerto 3.

**Play them:** up to four walkers step through the vertices of whatever is shown, each singing one view coordinate (x, y, z or w) of where it stands. Patterns: straight on along the edges, winding (the k-th straightest turn), leaping by a stride through the vertex list, across to the farthest vertex and back, or a seeded random walk that repeats. Each walker plucks a note per vertex or slides along the edges, at its own speed and octave, over a shared tempo, scale, root, range and tone. The walk depends only on the shape, so a still shape repeats its melody; turning it in 4D changes the notes.

**Combine them:** stack any number of shapes, each with its own type, parameters, 4D placement (offset, scale, rotation in all six planes) and colour, and add, subtract or intersect them in 4D.

**Live:** https://joyhughes.github.io/polychora/

## Features

- Projection (4D → 3D: perspective, orthographic or stereographic) or hyperplane slicing at any w, with an automatic sweep
- 4D spin in all six rotation planes, with simple, double and isoclinic presets; Shift-drag rotates in 4D by hand
- Off-centre rotation: set the centre of rotation anywhere in 4D (or snap it to a vertex), and the object swings around it, through the slice and toward or away from the 4D eye
- GPU ray-traced slices: an alternative renderer that draws the slice straight from the shapes on the GPU, so combined shapes can move through each other in real time (give a shape its own Spin under Placement and colour)
- Capture: save PNG snapshots (screen size, 2× or 4×) and record the canvas as MP4 video (H.264 through WebCodecs and the vendored [mp4-muxer](https://github.com/Vanilagy/mp4-muxer); browsers without WebCodecs fall back to MediaRecorder, which may give WebM) (`P` and `R` keys)
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

`gpu.js` is the real-time alternative for the slice view. Each pixel's ray through the slice hyperplane is a line in 4D. Each shape turns that line into inside intervals:
- **Convex polytopes:** by clipping against every cell's half-space.
- **Star polytopes:** by clipping against the cones from the centre over each cell's fan tetrahedra, culled by the cone over the cell's convex hull.
- **Fractals:** by walking the map tree, pruning by each copy's bounding polytope.
- **Fractal mountain:** by walking the grid cubes under the ray's shadow on the ground; the height is linear on each cube's six Kuhn tetrahedra, so each piece of the ray meets the surface exactly once at most.
- **L-system tree:** by clipping against each branch's 22 half-spaces and each leaf's 16, skipping any subtree whose bounding ball the ray misses.
- **Clifford torus, Hopf fibres and black hole:** by marching their distance fields as thin solid tubes (or, for the black hole, a thin shell about its space).

The interval lists are combined from the top down, and the surfaces where the result starts and stops are shaded (all of them, front to back, when translucent).

`csg.js` combines shapes in 4D. Every solid gets a field that is negative inside: the largest `n·p − h` over the cells for a convex polytope; `|p| − r(p/|p|)` for a star polytope, whose solid is everything its cells hide from the centre; the iterated maps applied to the base polytope for a fractal; and, for the fractal mountain, the height above the ground (scaled by its steepest slope) against the floor and the sides of the ground. Each field also reports the hyperplane it is resting on. Shapes are combined from the top down, one at a time. The result so far is clipped against the new shape, and the new shape against the result so far. A simplex the cut crosses on one flat piece is cut exactly. One where the cut bends is first split along the hyperplane of a boundary piece. Corners of the other shape that poke into a simplex are found exactly, by testing its cell, faces and edges against the other mesh's edges, faces and cells. The cut through each cell becomes new faces and edges, so projection, slicing and wireframe all show the combined shape. Faces two shapes share are kept exactly once. Surfaces and curves (Clifford torus, Hopf fibres) have no inside: they are cut by solids but cut nothing. Star polytopes keep their inner faces, as they do when shown alone. The work runs in a Web Worker (`worker.js`), so the view stays responsive. A combination that takes longer than about a second shows a coarse draft first, and then the full result (capped at about 15 s of refining). Changing the scene restarts the work at once.

No build step; open `index.html` from any static server.
