/**
 * Cryolite.boot — convenience one-liner that wires the producer
 * (FrostEngine) and consumer (FrostRenderer) around nuna-middleware
 * from a single .cryo URL + canvas.
 *
 * For more control, instantiate FrostEngine / SynthXmlParser /
 * FrostRenderer directly.
 */

import { loadCryo, type CryoManifest } from './cryo.js';
import { SynthXmlParser, type ParsedScene, type ParsedRuntime } from './synth-xml.js';
import { FrostEngine, type EmscriptenModuleFactory } from './engine.js';
import { FrostRenderer } from './renderer.js';

export interface CryoliteBootOpts {
  cryoUrl: string;
  /** Emscripten module factory for the cryolite wasm. */
  moduleFactory: EmscriptenModuleFactory;
  /** Canvas to render into. Omit for headless boot (engine only). */
  canvas?: HTMLCanvasElement;
  log?: (msg: string) => void;
  locateFile?: (path: string) => string;
}

export interface CryoliteHandle {
  engine: FrostEngine;
  renderer: FrostRenderer | null;
  manifest: CryoManifest;
  runtime: ParsedRuntime;
  scene: ParsedScene;
  start(): void;
  stop(): void;
  frame(now: number): void;
}

export const Cryolite = {
  async boot(opts: CryoliteBootOpts): Promise<CryoliteHandle> {
    const log = opts.log ?? (() => {});

    const engine = await FrostEngine.create({
      moduleFactory: opts.moduleFactory,
      print: log,
      locateFile: opts.locateFile,
    });

    log(`loading ${opts.cryoUrl}…`);
    const manifest = await loadCryo(opts.cryoUrl);
    log(`  project: ${manifest.metadata.name} (${manifest.metadata.version})`);

    const baseUrl = opts.cryoUrl.substring(0, opts.cryoUrl.lastIndexOf('/') + 1);
    const parser = new SynthXmlParser(baseUrl);

    if (!manifest.renderer) throw new Error('.cryo manifest has no <renderer> binding');
    const runtime = await parser.loadRuntime(manifest.renderer.runtime);
    log(`  renderer api: ${runtime.renderer.api}  (${runtime.renderer.width}x${runtime.renderer.height})`);

    if (!runtime.sceneUri) throw new Error('runtime did not declare a <scene>');
    const scene = await parser.loadScene(runtime.sceneUri);
    log(`  scene: ${scene.id} — ${scene.entities.length} entities`);

    await engine.uploadScene(scene, parser, { onLog: (s) => log('  + ' + s) });

    let renderer: FrostRenderer | null = null;
    if (opts.canvas) {
      renderer = new FrostRenderer(opts.canvas, runtime.renderer);
      renderer.build(scene);
    }

    let raf: number | null = null;
    let last = 0;

    const handle: CryoliteHandle = {
      engine,
      renderer,
      manifest,
      runtime,
      scene,
      frame(now: number): void {
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        engine.tick(dt);
        if (renderer) {
          renderer.sync(engine);
          renderer.render();
        }
      },
      start(): void {
        if (raf != null) return;
        last = performance.now();
        const loop = (now: number): void => {
          this.frame(now);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      },
      stop(): void {
        if (raf != null) cancelAnimationFrame(raf);
        raf = null;
      },
    };
    return handle;
  },
};
