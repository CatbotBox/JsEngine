# JsEngine

A TypeScript game engine, made for fun. It runs games in a terminal, a browser or a desktop window, with an archetype
ECS modelled on Unity DOTS, 2D and 3D rendering, and a project editor.

## Quick start

The engine, the games and the tests run on [node](https://nodejs.org) (>= 22) or [bun](https://bun.sh)
interchangeably. The `jsengine` CLI (building, serving, the editor, packaging) needs bun.

- Run a game in the terminal under node: add `--node` to the `--target terminal` command below.
- Tests: `bun run check` runs every suite under both runtimes; `bun run test:node` runs the unit tests under node only.

```sh
bun install
bun run demo --project demo/3d                    # browser (default target)
bun run demo --project demo/3d --target terminal  # real terminal
bun run demo --project demo/3d --target window    # Electron window
bun run editor                                    # project editor
bun run jsengine help                             # every command
```

Sample projects: `demo/2d`, `demo/3d`, `demo/swarm` (a twin-stick survival game), and `demo/libraryOnly` (using the
engine without the editor or a project manifest).

`--backend cells|pixels|gpu` picks the renderer: `cells` draws text cells, `pixels` an RGBA framebuffer, `gpu` is
experimental WebGPU (web and window only). The default is pixels on web and window, cells in the terminal.

## Features

- **3D**: `.obj` meshes with `.mtl` materials, directional/point/ambient lighting, mip-mapped textures,
  anti-aliasing, and a multithreaded rasterizer. Parsed meshes are cached in a hidden `.meshcache/` folder beside the obj.
- **Textures**: PNG, baseline JPEG and PPM, decoded in-engine with no dependencies.
- **2D**: text and pixel sprites plus HUD elements, drawn alongside 3D.
- **GPU**: custom WGSL surface shaders per entity (`GpuShaderLibrary`, `GpuSurfaceShader`).

Demo keys are listed in each demo's on-screen legend.

## Projects

A project is a folder with `jsengine.project.json`, its scenes, prefabs, data assets and code. `jsengine generate`
writes `<project>/generated/`, which `run`, `build` and the editor start from.

To use the engine from a project outside this checkout, run `jsengine link --project <dir>`; the editor's "Create
project here" sets this up for you.

```sh
bun run jsengine build --target web --project <dir>       # -> dist/web/<folder>/
bun run jsengine package --target window --project <dir>  # desktop app
```

## Deploying

`bun run web:deploy` builds the samples into `dist/web-prod` and uploads them to Cloudflare Pages (the first run opens
a browser to log in). `bun run web:serve --prod` serves the same build locally.

- Project name defaults to `jsengine` (`wrangler.toml`); pass `--project-name=<name>` to change it.
- In CI, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and create the project once with
  `bunx wrangler pages project create <name>`.

## Credits

- `src/hosts/web/coi-serviceworker.js`: [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) v0.1.7 by
  Guido Zuidhof and contributors, MIT License, vendored unmodified.
- `src/hosts/terminal/ansi/ansiKeyDecoder.ts`: a port of Node.js's readline key decoder, MIT License.
