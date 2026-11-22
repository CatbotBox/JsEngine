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
and Windows backslashes. `bun scripts/generateCheckerTexture.ts` regenerates the checkerboard used by
`demo/3d/cube.obj`. Textured models render with a white tint in the demo so the texture colors show unmodified.

Parsed meshes are cached in a binary `<file>.obj.meshcache` beside the obj (gitignored), so the second launch
loads the 83 MB bugatti in ~20 ms instead of ~2.6 s; delete the file or pass `{cache: false}` to `Mesh.fromFile`
to force a re-parse.

Run the demo in a real terminal: `bun run demo --project demo/3d --target terminal` (keys are listed in its top-left legend; `t` textures,
`b` half-block, `1`-`4` anti-aliasing presets, `h`/`p` lights).

Every demo runs on four runtimes through the `jsengine` CLI (`src/toolchain/cli.ts`, bun only; `bun run demo` is
`jsengine run`): `bun run demo --project demo/3d --target terminal` (add `--node` for node), `--target web` (the
default: browser, served locally with cross-origin isolation) and `--target window` (Electron window). `--backend
cells|pixels|gpu` picks the renderer (default pixels on web and window, cells in the terminal); `bun run jsengine help`
lists every command.

`?backend=gpu` (`--backend gpu` on `demo/3d`) is an experimental WebGPU renderer for the 3D demo; it supports custom WGSL surface shaders, registered with `GpuShaderLibrary` and chosen per entity with `GpuSurfaceShader` (`o` cycles lit, toon and hologram in the demo).
The project editor takes the same `?backend=gpu`, which `bun run editor` (`jsengine edit [--project <dir>] [--target web|window]`) opens by default, falling back to pixels when WebGPU is unusable; `--backend pixels` opens it on pixels. It names its renderer next to the Scene/Game tabs.

A project is `jsengine.project.json`, scenes, prefabs, data assets and its own classes; `jsengine generate` writes
`<project>/generated/` (schema and system lists, `game.ts` with `startProject(world)`, and one bootstrap per target:
`main.terminal.ts`, `main.web*.ts`, `main.editor.worker.ts`), which `run`, `build` and the editor start from. The manifest's
optional `entry` names a module of your own exporting the same `startProject`; without one the generated `game.ts` runs.
Without the editor or a manifest, call `startGame(world, {schemas, systems, resources, startScene})` from your own entry
(`demo/libraryOnly`).

`jsengine build --target web --project <dir>` (or `--target window`) writes that one project to
`dist/web/<folder>/`: its page, bundles, data files and assets, served at `/<folder>/?backend=pixels`. The page is
`<dir>/web/index.html` when the project has one (the samples do), else one made from the manifest's `name` and
`targets.web.backend`. Without `--project` the build covers every sample project, each in its own folder beside the
landing page. `jsengine package --target window --project <dir>` makes a desktop app of that project alone, named after
the manifest's `name`.

2D sprites and HUD elements render alongside 3D through the same screen buffer.

## Deploying the web build

`bun run web:deploy` builds the sample projects into `dist/web-prod` (the landing page at `/`, the games at `/2d/`,
`/3d/` and `/swarm/`) and uploads it to Cloudflare Pages on the account you are logged in to
(the first run opens a browser to log in). The build fails if the site exceeds Pages' 25 MiB per-file or
20,000-file limits.

- The project name defaults to `jsengine` (from `wrangler.toml`); pass `--project-name=<name>` to use another. The
  site lands on `<name>.pages.dev`, or a suffixed subdomain if that one is taken.
- In CI, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` instead of logging in, and create the project once
  beforehand with `bunx wrangler pages project create <name>`.
- `bun run web:serve --prod` serves the same build locally.

## Credits

- `src/hosts/web/coi-serviceworker.js` is [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) v0.1.7 by
  Guido Zuidhof and contributors (MIT License), vendored unmodified with its license header.
- `src/hosts/terminal/ansi/ansiKeyDecoder.ts` is a port of Node.js's readline key decoder (`emitKeys`, behind
  `readline.emitKeypressEvents`), MIT License.
