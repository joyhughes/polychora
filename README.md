# Polychoron Viewer

Interactive WebGL2 viewer for the 16 regular polychora: the 6 convex regular 4-polytopes and all 10 Schläfli–Hess star polychora (the regular stellations of the 120-cell and 600-cell).

**Live:** https://joyhughes.github.io/polychora/

## Features

- Projection (4D → 3D, perspective or orthographic) or hyperplane slicing at any w, with an automatic sweep
- 4D spin in all six rotation planes, with simple, double and isoclinic presets; Shift-drag rotates in 4D by hand
- Solid, translucent (depth-sorted) or wireframe surfaces
- Flat colours (by Hopf fibre) or colours by 4D depth (kata −w → ana +w)
- Perspective or orthographic 3D camera

Keys: Space pause, `[` `]` change polytope, `S` toggle slice.

## How the geometry is built

`geometry.js` builds every polytope the same way: a vertex set on the unit 3-sphere (600-cell or 120-cell vertices for the H4 family), a set of cell-centre directions, a cell hyperplane height `h` and an edge cosine `e`. Each cell is the vertex layer `{v : v·n = h}`, and its faces are the planar p-cycles of the edge graph inside that layer. Counts of cells, faces, edges and vertices, and vertex figures, match the published tables for all 16.

Slices are exact: each cell is decomposed into tetrahedra (cell centre + fan triangle of each face), and those are cut by the hyperplane every frame.

No build step; open `index.html` from any static server.
