# cryolite

The producer + consumer that wraps `nuna-middleware`.

Cryolite parses `.cryo` project manifests and `synth-xml` scenes, drives
a wasm engine (per-entity Lua state + transform table) on one side, and
renders the resulting transforms through three.js on the other.
`nuna-middleware` is statically linked into the same wasm and exposed
as a side-by-side ABI for any host that wants a flat scene_frame.

## Architecture

```
   ┌──────────────────────────  CRYOLITE  ──────────────────────────┐
   │                                                                │
   │   ┌────────────────┐                       ┌────────────────┐  │
   │   │  FrostEngine   │                       │ FrostRenderer  │  │
   │   │  (PRODUCER)    │                       │  (CONSUMER)    │  │
   │   │  Lua + state   │                       │  three.js      │  │
   │   └───────┬────────┘                       └───────▲────────┘  │
   │           │                                        │           │
   │           │  engine.getX/Y/Z, getScale*, getColor  │           │
   │           │  ── direct render path (every frame) ──┘           │
   │           │                                                    │
   │           │ engine state                                       │
   │           ▼                                                    │
   │   ┌────────────────────────────────────────────────────────┐   │
   │   │                   nuna-middleware                      │   │
   │   │   produce_frame_flat(t) → Float32Array(19)             │   │
   │   │   (PURE TRANSFORM — no callbacks into cryolite)        │   │
   │   └─────────────────────────┬──────────────────────────────┘   │
   │                             │  optional side path:             │
   │                             │  flat frame → external nuna      │
   │                             │  consumers / telemetry / tests   │
   │                             ▼                                  │
   │                  (off-engine observers)                        │
   │                                                                │
   └────────────────────────────────────────────────────────────────┘

      BEFORE middleware ────►  middleware  ────► AFTER middleware
      cryolite drives state    observes /        cryolite (or any
      (FrostEngine + Lua)      flattens one      external consumer)
                               scene_frame       reads the frame
```

Cryolite plays **both** roles around `nuna-middleware`. The wasm
exports two independent ABIs (`engine_*` and `nuna_middleware_*`); the
render loop reads engine transforms directly, while middleware is a
parallel observer that any host can pull from. Middleware can be
swapped, mocked, or skipped without touching producer or consumer code.

A `.cryo` file is a **project descriptor**, not a scene. It points at
a backend runtime, a renderer runtime, and a set of asset paths:

```xml
<synth version="1.0">
  <game-project version="1.0">
    <metadata><name>My Game</name>…</metadata>
    <backend><runtime>runtime.synth</runtime>…</backend>
    <renderer><runtime>runtime.frost</runtime>…</renderer>
    <paths><assets>assets/src</assets>…</paths>
    <launcher><startupOrder>sequential</startupOrder>…</launcher>
  </game-project>
</synth>
```

Scenes, components, and entity composition live in `synth-xml` files
that the manifest's renderer runtime points at.

## Install

```sh
npm install cryolite
```

`three` is an optional peer dependency — install it only if you use the
browser renderer:

```sh
npm install three @types/three
```

## Quick start (browser)

```ts
import Module from './path/to/cryolite-wasm/engine.mjs';
import 'three'; // ensure your bundler resolves the peer
import { Cryolite } from 'cryolite';

const h = await Cryolite.boot({
  cryoUrl: './assets/project.cryo',
  canvas: document.getElementById('canvas') as HTMLCanvasElement,
  moduleFactory: Module,
  log: console.log,
});
h.start();
// h.engine, h.renderer, h.manifest, h.runtime, h.scene available afterwards
```

> The wasm artifact (`engine.mjs` + `engine.wasm`) is **not** shipped in
> the npm package. Build it with `npm run build:wasm`, then host it
> alongside your app — see [WASM build](#wasm-build) below.

## Quick start (node, headless)

```ts
import Module from './path/to/cryolite-wasm/engine.mjs';
import { FrostEngine } from 'cryolite';

const engine = await FrostEngine.create({
  moduleFactory: Module,
  print: console.log,
});

engine.addEntity('player');
engine.setPosition('player', 0, 0, 0);
engine.attachScript('player', `
  function tick(dt)
    frost.setPosition('player', frost.getTime(), 0, 0)
  end
`);
engine.tick(1 / 60);

const x = engine.getX(0);
const frame = engine.copyMiddlewareFrame(0); // Float32Array(19)
```

## Public API

### `parse(xml)` / `parseUrl(url)` — `.cryo` manifest parser

Returns a `CryoManifest` (`metadata`, `backend`, `renderer`, `paths`,
`launcher`). Uses the runtime's native `DOMParser` (browsers, workers,
Deno, Bun). For Node, assign a polyfill to `globalThis.DOMParser` (e.g.
`@xmldom/xmldom`) before calling.

Aliases `parseCryo` / `loadCryo` are also exported for parity with the
broader cryolite naming.

### `SynthXmlParser` — runtime + scene + component parser

```ts
const parser = new SynthXmlParser('./assets/');
const runtime = await parser.loadRuntime('runtime.synth');
const scene = await parser.loadScene(runtime.sceneUri!);
```

Resolves `componentRef` composition. Yields a `ParsedScene` with
entities, transforms, components, an optional `scriptUri`, and
properties.

### `FrostEngine` — wasm wrapper (producer side)

| Method                                        | Maps to                                |
| --------------------------------------------- | -------------------------------------- |
| `FrostEngine.create({ moduleFactory, ... })`  | async ctor + `engine_init()`           |
| `addEntity(id)`                               | `engine_add_entity`                    |
| `setPosition(id, x, y, z)`                    | `engine_set_position`                  |
| `setScale(id, sx, sy, sz)`                    | `engine_set_scale`                     |
| `setColor(id, hex)`                           | `engine_set_color`                     |
| `setProperty(id, name, value)`                | `engine_set_property` (numeric)        |
| `attachScript(id, luaSource)`                 | `engine_attach_script`                 |
| `tick(dt)`                                    | `engine_tick`                          |
| `getEntityCount/Id/X/Y/Z/Scale*/Color`        | `engine_get_entity_*`                  |
| `produceMiddlewareFrame(t)`                   | `nuna_middleware_produce_frame_flat`   |
| `copyMiddlewareFrame(t)`                      | owned copy of the 19-float frame       |
| `uploadScene(parsedScene, parser)`            | replays scene → engine_set_* + scripts |
| `middlewareVersion`                           | `nuna_middleware_version()`            |

`FrostEngine` implements the `TransformReader` interface that
`FrostRenderer.sync()` expects — hosts can substitute their own
transform source if needed.

### `FrostRenderer` — three.js consumer side

```ts
const renderer = new FrostRenderer(canvas, runtime.renderer);
renderer.build(scene);
// per frame:
renderer.sync(engine);
renderer.render();
```

Builds one mesh/light per entity from parsed components, then re-reads
transforms from any `TransformReader` each frame.

### `Cryolite.boot({ cryoUrl, canvas, moduleFactory, log })`

Convenience one-liner. Returns `{ engine, renderer, manifest, runtime,
scene, start(), stop(), frame(now) }`. `start()` runs the
`requestAnimationFrame` loop end-to-end. Omit `canvas` for headless
boot (engine only, no renderer).

## WASM build

The wasm engine is built from `wasm-src/engine.cpp` + Lua 5.4 + a
checkout of `nuna-middleware`. It is **not** included in the npm
package — consumers ship it themselves (CDN, bundler asset, file URL).

```sh
# requires emcc on PATH (emsdk activated) and a nuna-middleware checkout
export NUNA_MIDDLEWARE_DIR=/path/to/nuna-middleware
npm run build:wasm     # → wasm/engine.mjs + wasm/engine.wasm
```

The build script statically links Lua and the middleware into a single
`engine.mjs` Emscripten module. Pass that module's default export as
`moduleFactory` to `FrostEngine.create` or `Cryolite.boot`.

## Build (TypeScript)

```sh
npm install
npm run build          # → dist/
```

## Layout

| Path                  | Role                                              |
| --------------------- | ------------------------------------------------- |
| `src/cryo.ts`         | `.cryo` manifest parser                           |
| `src/synth-xml.ts`    | runtime / scene / component parser                |
| `src/engine.ts`       | `FrostEngine` — wasm wrapper (producer)           |
| `src/renderer.ts`     | `FrostRenderer` — three.js consumer               |
| `src/cryolite.ts`     | `Cryolite.boot` one-liner                         |
| `src/index.ts`        | public re-exports                                 |
| `wasm-src/engine.cpp` | the wasm engine source                            |
| `wasm-src/build.sh`   | emcc build script                                 |

## License

Apache-2.0
