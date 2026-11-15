# JsEngine

A Typescript game engine, made entirely for fun.

Supported runtimes
- Node
- Bun

currently runs in console

## 3D

Renders `.obj` meshes with their `.mtl` materials (`Kd`/`map_Kd` diffuse, `Ks`/`Ns`/`map_Ks` Blinn-Phong specular,
`Ke` emissive), lit by directional, point and ambient lights with per-vertex Gouraud shading, perspective-correct
mip-mapped texturing, 2x4 supersampling and half-block cells (two vertical samples per terminal cell). The
rasterizer is multithreaded over shared memory.

Textures: PNG (any color type, non-interlaced), baseline JPEG (any chroma subsampling, restart intervals; not
progressive or CMYK) and binary PPM are decoded in-engine with no dependencies. `map_Kd` paths may contain spaces
and Windows backslashes. `bun run texture:generate-checker` regenerates the checkerboard used by
`demo/3d/cube.obj`. Textured models render with a white tint in the demo so the texture colors show unmodified.

Parsed meshes are cached in a binary `<file>.obj.meshcache` beside the obj (gitignored), so the second launch
loads the 83 MB bugatti in ~20 ms instead of ~2.6 s; delete the file or pass `{cache: false}` to `Mesh.fromFile`
to force a re-parse.

Run the demo in a real terminal: `bun demo/3d/index.ts` (keys are listed in its top-left legend; `t` textures,
`b` half-block, `1`-`4` anti-aliasing presets, `h`/`p` lights).

Every demo runs on four runtimes: `bun run demo:3d:bun` / `demo:3d:node` (terminal), `demo:3d:web` (browser, served
locally with cross-origin isolation) and `demo:3d:window` (Electron window); the same scripts exist for `2d`.

`?backend=gpu` (`demo:3d:gpu:web`, `demo:3d:gpu:window`) is an experimental WebGPU renderer for the 3D demo; it supports custom WGSL surface shaders, registered with `GpuShaderLibrary` and chosen per entity with `GpuSurfaceShader` (`o` cycles lit, toon and hologram in the demo).

2D sprites and HUD elements render alongside 3D through the same screen buffer.

## Deploying the web build

`bun run web:deploy` builds `dist/web-prod` and uploads it to Cloudflare Pages on the account you are logged in to
(the first run opens a browser to log in). The build fails if the site exceeds Pages' 25 MiB per-file or
20,000-file limits.

- The project name defaults to `jsengine` (from `wrangler.toml`); pass `--project-name=<name>` to use another. The
  site lands on `<name>.pages.dev`, or a suffixed subdomain if that one is taken.
- In CI, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` instead of logging in, and create the project once
  beforehand with `bunx wrangler pages project create <name>`.
- `bun run web:serve-prod` serves the same build locally.

## Credits

- `src/hosts/web/coi-serviceworker.js` is [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) v0.1.7 by
  Guido Zuidhof and contributors (MIT License), vendored unmodified with its license header.
- `src/hosts/terminal/ansi/ansiKeyDecoder.ts` is a port of Node.js's readline key decoder (`emitKeys`, behind
  `readline.emitKeypressEvents`), MIT License.
