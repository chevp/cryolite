/**
 * synth-xml parser — runtime config, scenes, and components with
 * componentRef composition. Browser-native DOMParser, no deps.
 *
 * Mirrors the API shape used by `synth-playground` so scenes authored
 * against cryolite are portable.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position: Vec3;
  scale: Vec3;
}

export interface ParsedComponent {
  kind: string;
  attrs: Record<string, string>;
}

export type PropertyValue = string | number | boolean | null;

export interface ParsedEntity {
  id: string;
  componentRef: string | null;
  transform: Transform;
  components: ParsedComponent[];
  scriptUri: string | null;
  properties: Record<string, PropertyValue>;
}

export interface ParsedScene {
  id: string;
  name: string;
  entities: ParsedEntity[];
}

export interface RendererConfig {
  api: string;
  width: number;
  height: number;
}

export interface ParsedRuntime {
  renderer: RendererConfig;
  sceneUri: string | null;
}

interface CachedComponent {
  scriptUri: string | null;
  components: ParsedComponent[];
  properties: Record<string, PropertyValue>;
  transform?: Transform;
}

export class SynthXmlParser {
  readonly baseUrl: string;
  private componentCache = new Map<string, CachedComponent>();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  }

  async loadRuntime(relPath: string): Promise<ParsedRuntime> {
    const root = await this.fetchRoot(relPath);
    const renderer = root.querySelector('renderer');
    const scene = root.querySelector('scene');
    return {
      renderer: {
        api: renderer?.querySelector('api')?.getAttribute('type') || 'three.js',
        width: parseInt(renderer?.querySelector('window')?.getAttribute('width') || '800', 10),
        height: parseInt(renderer?.querySelector('window')?.getAttribute('height') || '600', 10),
      },
      sceneUri: scene?.getAttribute('uri') || null,
    };
  }

  async loadScene(relPath: string): Promise<ParsedScene> {
    const root = await this.fetchRoot(relPath);
    const scene = root.querySelector('scene');
    if (!scene) throw new Error(`no <scene> in ${relPath}`);

    const entities: ParsedEntity[] = [];
    for (const el of Array.from(scene.querySelectorAll(':scope > entities > entity'))) {
      entities.push(await this.parseEntity(el));
    }
    return {
      id: scene.getAttribute('id') || 'unnamed',
      name: scene.getAttribute('name') || scene.getAttribute('id') || '',
      entities,
    };
  }

  async fetchText(relPath: string): Promise<string> {
    const url = this.baseUrl + relPath;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    return res.text();
  }

  private async parseEntity(el: Element): Promise<ParsedEntity> {
    const id = el.getAttribute('id') || '';
    const componentRef = el.getAttribute('componentRef');

    const base: CachedComponent = componentRef
      ? await this.loadComponent(componentRef)
      : { scriptUri: null, components: [], properties: {} };

    const transformEl = el.querySelector(':scope > transform');
    const transform = parseTransform(transformEl) ?? base.transform ?? defaultTransform();

    const componentsEl = el.querySelector(':scope > components');
    const localComponents = componentsEl ? parseComponents(componentsEl) : [];
    const components = localComponents.length ? localComponents : base.components;

    const scriptEl = el.querySelector(':scope > script');
    const scriptUri = scriptEl?.getAttribute('uri') ?? base.scriptUri ?? null;

    return {
      id,
      componentRef,
      transform,
      components,
      scriptUri,
      properties: { ...base.properties },
    };
  }

  private async loadComponent(ref: string): Promise<CachedComponent> {
    const cached = this.componentCache.get(ref);
    if (cached) return cached;

    const root = await this.fetchRoot(ref);
    const comp = root.querySelector('component');
    if (!comp) throw new Error(`no <component> in ${ref}`);

    const scriptUri = comp.querySelector(':scope > script')?.getAttribute('uri') ?? null;
    const componentsEl = comp.querySelector(':scope > components');
    const components = componentsEl ? parseComponents(componentsEl) : [];

    const properties: Record<string, PropertyValue> = {};
    for (const prop of Array.from(comp.querySelectorAll(':scope > properties > property'))) {
      const name = prop.getAttribute('name');
      if (!name) continue;
      properties[name] = parsePropertyValue(prop.getAttribute('type'), prop.getAttribute('value'));
    }

    const parsed: CachedComponent = { scriptUri, components, properties };
    this.componentCache.set(ref, parsed);
    return parsed;
  }

  private async fetchRoot(relPath: string): Promise<Element> {
    const url = this.baseUrl + relPath;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error(`invalid XML in ${relPath}: ${err.textContent ?? 'unknown'}`);
    return doc.documentElement;
  }
}

function defaultTransform(): Transform {
  return { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
}

function parseTransform(el: Element | null): Transform | null {
  if (!el) return null;
  return {
    position: parseVec3(el.getAttribute('position'), 0),
    scale: parseVec3(el.getAttribute('scale'), 1),
  };
}

function parseVec3(str: string | null, fallback: number): Vec3 {
  if (!str) return { x: fallback, y: fallback, z: fallback };
  const parts = str.split(',').map((s) => parseFloat(s.trim()));
  return {
    x: Number.isFinite(parts[0]) ? parts[0] : fallback,
    y: Number.isFinite(parts[1]) ? parts[1] : fallback,
    z: Number.isFinite(parts[2]) ? parts[2] : fallback,
  };
}

function parseComponents(el: Element): ParsedComponent[] {
  const out: ParsedComponent[] = [];
  for (const child of Array.from(el.children)) {
    const attrs: Record<string, string> = {};
    for (const a of Array.from(child.attributes)) attrs[a.name] = a.value;
    out.push({ kind: child.tagName, attrs });
  }
  return out;
}

function parsePropertyValue(type: string | null, raw: string | null): PropertyValue {
  if (raw == null) return null;
  switch ((type || 'string').toLowerCase()) {
    case 'float':
    case 'double':
    case 'number':
      return parseFloat(raw);
    case 'int':
    case 'integer':
      return parseInt(raw, 10);
    case 'bool':
    case 'boolean':
      return raw.toLowerCase() === 'true';
    default:
      return raw;
  }
}
