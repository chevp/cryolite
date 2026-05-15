/**
 * cryolite — isomorphic .cryo project-manifest parser.
 *
 * A `.cryo` file is a small project descriptor that points at a
 * backend runtime, a renderer runtime, and a set of asset paths.
 * It is NOT the scene format (see synth-xml for that).
 */

export interface CryoManifest {
  version: string;
  metadata: Metadata;
  backend?: RuntimeBinding;
  renderer?: RuntimeBinding;
  paths: Paths;
  launcher: Launcher;
}

export interface Metadata {
  name: string;
  description: string;
  version: string;
  author: string;
  created: string;
}

export interface RuntimeBinding {
  runtime: string;
  autoStart: boolean;
  waitForReady: boolean;
  startupTimeout: number;
}

export interface Paths {
  assets: string;
  scenes: string;
  components: string;
  scripts: string;
  data: string;
  config: string;
}

export interface Launcher {
  startupOrder: 'sequential' | 'parallel';
  showConsole: boolean;
  workingDirectory: string;
}

/**
 * Parse a `.cryo` manifest from its XML source.
 *
 * Requires a runtime with a global `DOMParser` (browsers, web workers,
 * Deno, Bun). For Node, install a DOMParser polyfill (e.g. `@xmldom/xmldom`)
 * and assign it to `globalThis.DOMParser` before calling.
 */
export function parse(xml: string): CryoManifest {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`Invalid .cryo XML: ${parseError.textContent ?? 'unknown'}`);
  }

  const project = doc.querySelector('game-project');
  if (!project) {
    throw new Error('Missing <game-project> element');
  }

  return {
    version: project.getAttribute('version') ?? '1.0',
    metadata: parseMetadata(project.querySelector('metadata')),
    backend: parseRuntimeBinding(project.querySelector('backend')),
    renderer: parseRuntimeBinding(project.querySelector('renderer')),
    paths: parsePaths(project.querySelector('paths')),
    launcher: parseLauncher(project.querySelector('launcher')),
  };
}

/** Fetch a `.cryo` file by URL and parse it. */
export async function parseUrl(
  url: string | URL,
  init?: RequestInit
): Promise<CryoManifest> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return parse(await response.text());
}

function text(el: Element | null, tag: string, fallback = ''): string {
  return el?.querySelector(tag)?.textContent?.trim() ?? fallback;
}

function bool(el: Element | null, tag: string, fallback = false): boolean {
  const v = text(el, tag);
  return v === '' ? fallback : v.toLowerCase() === 'true';
}

function num(el: Element | null, tag: string, fallback = 0): number {
  const v = text(el, tag);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseMetadata(el: Element | null): Metadata {
  return {
    name: text(el, 'name'),
    description: text(el, 'description'),
    version: text(el, 'version'),
    author: text(el, 'author'),
    created: text(el, 'created'),
  };
}

function parseRuntimeBinding(el: Element | null): RuntimeBinding | undefined {
  if (!el) return undefined;
  return {
    runtime: text(el, 'runtime'),
    autoStart: bool(el, 'autoStart', true),
    waitForReady: bool(el, 'waitForReady', false),
    startupTimeout: num(el, 'startupTimeout', 30),
  };
}

function parsePaths(el: Element | null): Paths {
  return {
    assets: text(el, 'assets', 'assets'),
    scenes: text(el, 'scenes', 'assets/scenes'),
    components: text(el, 'components', 'assets/components'),
    scripts: text(el, 'scripts', 'scripts'),
    data: text(el, 'data', 'data'),
    config: text(el, 'config', 'config'),
  };
}

function parseLauncher(el: Element | null): Launcher {
  const order = text(el, 'startupOrder', 'sequential');
  return {
    startupOrder: order === 'parallel' ? 'parallel' : 'sequential',
    showConsole: bool(el, 'showConsole', false),
    workingDirectory: text(el, 'workingDirectory', '.'),
  };
}
