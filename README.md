# JsEngine

A Typescript game engine, made entirely for fun.

Supported runtimes
- Node
- Bun

currently runs in console

## 3D

Renders `.obj` meshes with their `.mtl` materials (diffuse color and `map_Kd` textures), lit by directional, point
and ambient lights with per-vertex Gouraud shading, perspective-correct mip-mapped texturing, 2x4 supersampling
and half-block cells (two vertical samples per terminal cell). The rasterizer is multithreaded over shared memory.

Textures: PNG (any color type, non-interlaced), baseline JPEG (any chroma subsampling, restart intervals; not
progressive or CMYK) and binary PPM are decoded in-engine with no dependencies. `map_Kd` paths may contain spaces
and Windows backslashes. `bun scripts/makeCheckerTexture.ts` regenerates the checkerboard used by
`demo/3d/cube.obj`. Textured models render with a white tint in the demo so the texture colors show unmodified.

Run the demo in a real terminal: `bun demo/3d/index.ts` (keys are listed in its top-left legend; `t` textures,
`b` half-block, `1`-`4` anti-aliasing presets, `h`/`p` lights).

2D sprites and HUD elements render alongside 3D through the same screen buffer.
