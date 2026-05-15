# cryolite

Isomorphic parser for `.cryo` project manifests.

A `.cryo` file is a **project descriptor**, not a scene. It points at a
backend runtime, a renderer runtime, and a set of asset paths.

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

For scenes, components, and routes see `synth-xml`.

## Install

```sh
npm install cryolite
```

## Usage

```ts
import { parse, parseUrl } from 'cryolite';

const manifest = parse(xmlString);
console.log(manifest.metadata.name, manifest.backend?.runtime);

// Or by URL:
const m = await parseUrl('/my-game.cryo');
```

## API

- `parse(xml)` → `CryoManifest`
- `parseUrl(url, init?)` → `Promise<CryoManifest>`

`CryoManifest` exposes `metadata`, `backend`, `renderer`, `paths`, `launcher`.

Uses the runtime's native `DOMParser` (browsers, workers, Deno, Bun).
For Node, assign a DOMParser polyfill to `globalThis.DOMParser` first.

## License

MIT
