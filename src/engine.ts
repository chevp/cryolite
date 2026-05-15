/**
 * FrostEngine — TypeScript wrapper around the cryolite wasm.
 *
 * The wasm exports two side-by-side ABIs: `engine_*` (per-entity Lua
 * state + transform table) and `nuna_middleware_*` (flat scene_frame
 * producer). They do not call each other; cryolite drives both ends.
 *
 * The wasm module itself is NOT shipped with this TS package — callers
 * supply an Emscripten module factory (e.g. `import Module from
 * 'cryolite-wasm/engine.mjs'`). This keeps the npm package pure
 * TypeScript and lets hosts wire the wasm artifact however they want
 * (CDN, bundler, file system, etc.).
 */

import type { ParsedScene } from './synth-xml.js';
import type { SynthXmlParser } from './synth-xml.js';

/** Minimal Emscripten module surface cryolite uses. */
export interface EmscriptenModule {
  cwrap(name: string, returnType: string | null, argTypes: string[]): (...args: unknown[]) => unknown;
  UTF8ToString(ptr: number): string;
  HEAPF32: Float32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _nuna_middleware_version(): number;
  _nuna_middleware_produce_frame_flat(t: number, outPtr: number): void;
}

export interface EmscriptenModuleOpts {
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
  locateFile?: (path: string) => string;
  [key: string]: unknown;
}

export type EmscriptenModuleFactory = (opts?: EmscriptenModuleOpts) => Promise<EmscriptenModule>;

/** Read-only transform view consumed by FrostRenderer.sync(). */
export interface TransformReader {
  getEntityCount(): number;
  getEntityId(i: number): string;
  getX(i: number): number;
  getY(i: number): number;
  getZ(i: number): number;
  getScaleX(i: number): number;
  getScaleY(i: number): number;
  getScaleZ(i: number): number;
  getColor(i: number): string;
}

export interface FrostEngineCreateOpts {
  moduleFactory: EmscriptenModuleFactory;
  print?: (msg: string) => void;
  locateFile?: (path: string) => string;
}

const FRAME_FLOATS = 19;

export class FrostEngine implements TransformReader {
  private readonly m: EmscriptenModule;
  private readonly engineInit: () => void;
  private readonly engineAddEntity: (id: string) => number;
  private readonly engineSetPosition: (id: string, x: number, y: number, z: number) => void;
  private readonly engineSetScale: (id: string, sx: number, sy: number, sz: number) => void;
  private readonly engineSetColor: (id: string, hex: string) => void;
  private readonly engineSetProperty: (id: string, name: string, value: number) => void;
  private readonly engineAttachScript: (id: string, lua: string) => number;
  private readonly engineTick: (dt: number) => void;
  private readonly engineCount: () => number;
  private readonly engineGetId: (i: number) => string;
  private readonly engineGetX: (i: number) => number;
  private readonly engineGetY: (i: number) => number;
  private readonly engineGetZ: (i: number) => number;
  private readonly engineGetSX: (i: number) => number;
  private readonly engineGetSY: (i: number) => number;
  private readonly engineGetSZ: (i: number) => number;
  private readonly engineGetColor: (i: number) => string;

  private readonly framePtr: number;
  private frameView: Float32Array;
  private readonly _middlewareVersion: string;

  static async create(opts: FrostEngineCreateOpts): Promise<FrostEngine> {
    const moduleOpts: EmscriptenModuleOpts = {};
    if (opts.print) {
      moduleOpts.print = opts.print;
      moduleOpts.printErr = opts.print;
    }
    if (opts.locateFile) moduleOpts.locateFile = opts.locateFile;

    const m = await opts.moduleFactory(moduleOpts);
    const inst = new FrostEngine(m);
    inst.engineInit();
    return inst;
  }

  private constructor(m: EmscriptenModule) {
    this.m = m;
    const w = m.cwrap.bind(m);
    this.engineInit = w('engine_init', null, []) as () => void;
    this.engineAddEntity = w('engine_add_entity', 'number', ['string']) as (id: string) => number;
    this.engineSetPosition = w('engine_set_position', null, ['string', 'number', 'number', 'number']) as (id: string, x: number, y: number, z: number) => void;
    this.engineSetScale = w('engine_set_scale', null, ['string', 'number', 'number', 'number']) as (id: string, sx: number, sy: number, sz: number) => void;
    this.engineSetColor = w('engine_set_color', null, ['string', 'string']) as (id: string, hex: string) => void;
    this.engineSetProperty = w('engine_set_property', null, ['string', 'string', 'number']) as (id: string, name: string, value: number) => void;
    this.engineAttachScript = w('engine_attach_script', 'number', ['string', 'string']) as (id: string, lua: string) => number;
    this.engineTick = w('engine_tick', null, ['number']) as (dt: number) => void;
    this.engineCount = w('engine_get_entity_count', 'number', []) as () => number;
    this.engineGetId = w('engine_get_entity_id', 'string', ['number']) as (i: number) => string;
    this.engineGetX = w('engine_get_entity_x', 'number', ['number']) as (i: number) => number;
    this.engineGetY = w('engine_get_entity_y', 'number', ['number']) as (i: number) => number;
    this.engineGetZ = w('engine_get_entity_z', 'number', ['number']) as (i: number) => number;
    this.engineGetSX = w('engine_get_entity_scale_x', 'number', ['number']) as (i: number) => number;
    this.engineGetSY = w('engine_get_entity_scale_y', 'number', ['number']) as (i: number) => number;
    this.engineGetSZ = w('engine_get_entity_scale_z', 'number', ['number']) as (i: number) => number;
    this.engineGetColor = w('engine_get_entity_color', 'string', ['number']) as (i: number) => string;

    this.framePtr = m._malloc(FRAME_FLOATS * 4);
    this.frameView = new Float32Array(m.HEAPF32.buffer, this.framePtr, FRAME_FLOATS);
    this._middlewareVersion = m.UTF8ToString(m._nuna_middleware_version());
  }

  reset(): void {
    this.engineInit();
  }

  addEntity(id: string): number {
    return this.engineAddEntity(id);
  }
  setPosition(id: string, x: number, y: number, z: number): void {
    this.engineSetPosition(id, x, y, z);
  }
  setScale(id: string, sx: number, sy: number, sz: number): void {
    this.engineSetScale(id, sx, sy, sz);
  }
  setColor(id: string, hex: string): void {
    this.engineSetColor(id, hex);
  }
  setProperty(id: string, name: string, value: number): void {
    this.engineSetProperty(id, name, value);
  }
  attachScript(id: string, luaSource: string): number {
    return this.engineAttachScript(id, luaSource);
  }
  tick(dt: number): void {
    this.engineTick(dt);
  }

  getEntityCount(): number { return this.engineCount(); }
  getEntityId(i: number): string { return this.engineGetId(i); }
  getX(i: number): number { return this.engineGetX(i); }
  getY(i: number): number { return this.engineGetY(i); }
  getZ(i: number): number { return this.engineGetZ(i); }
  getScaleX(i: number): number { return this.engineGetSX(i); }
  getScaleY(i: number): number { return this.engineGetSY(i); }
  getScaleZ(i: number): number { return this.engineGetSZ(i); }
  getColor(i: number): string { return this.engineGetColor(i); }

  /**
   * Zero-copy view into the wasm heap, refreshed in place each call.
   * Float32Array(19): the flat nuna scene_frame. View is rebuilt
   * automatically if memory grows.
   */
  produceMiddlewareFrame(timeSeconds: number): Float32Array {
    this.m._nuna_middleware_produce_frame_flat(timeSeconds, this.framePtr);
    if (this.frameView.buffer !== this.m.HEAPF32.buffer) {
      this.frameView = new Float32Array(this.m.HEAPF32.buffer, this.framePtr, FRAME_FLOATS);
    }
    return this.frameView;
  }

  /** Owned copy of the middleware frame — safe across heap growth. */
  copyMiddlewareFrame(timeSeconds: number, out?: Float32Array): Float32Array {
    const v = this.produceMiddlewareFrame(timeSeconds);
    const dst = out ?? new Float32Array(FRAME_FLOATS);
    dst.set(v);
    return dst;
  }

  get middlewareVersion(): string {
    return this._middlewareVersion;
  }

  /** Replay a parsed scene into the engine and attach its Lua scripts. */
  async uploadScene(
    parsedScene: ParsedScene,
    parser: SynthXmlParser,
    { onLog }: { onLog?: (msg: string) => void } = {}
  ): Promise<void> {
    for (const e of parsedScene.entities) {
      this.addEntity(e.id);
      const p = e.transform.position;
      const s = e.transform.scale;
      this.setPosition(e.id, p.x, p.y, p.z);
      this.setScale(e.id, s.x, s.y, s.z);
      for (const comp of e.components) {
        if (comp.kind === 'mesh' && comp.attrs.color) {
          this.setColor(e.id, comp.attrs.color);
        }
      }
      for (const [name, value] of Object.entries(e.properties)) {
        if (typeof value === 'number') this.setProperty(e.id, name, value);
      }
      if (e.scriptUri) {
        const src = await parser.fetchText(e.scriptUri);
        const rc = this.attachScript(e.id, src);
        if (onLog) {
          if (rc !== 0) onLog(`script attach failed for ${e.id} (rc=${rc})`);
          else onLog(`${e.id} ← ${e.scriptUri}`);
        }
      }
    }
  }
}
