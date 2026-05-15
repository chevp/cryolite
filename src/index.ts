/**
 * cryolite — the producer + consumer that wraps nuna-middleware.
 *
 * Layers exported:
 *
 *   FrostEngine        wasm wrapper (browser + node). The PRODUCER side:
 *                      per-entity Lua state + transform table. Also
 *                      exposes the side-by-side nuna-middleware ABI
 *                      (produceMiddlewareFrame / copyMiddlewareFrame).
 *
 *   FrostRenderer      three.js scene builder + per-frame transform
 *                      sync. The CONSUMER side. Peer-deps `three`.
 *
 *   SynthXmlParser     runtime + scene + component parsers (browser
 *                      DOMParser; usable in any DOMParser-equipped env).
 *
 *   parse / parseUrl   .cryo project-manifest parser (re-exported via
 *                      the `./cryo` module).
 *
 *   Cryolite.boot      convenience: wires producer + consumer + asset
 *                      loaders end-to-end from a single .cryo URL.
 */

export * from './cryo.js';
export * from './synth-xml.js';
export * from './engine.js';
export * from './renderer.js';
export * from './cryolite.js';
