/**
 * FrostRenderer — three.js implementation of the frost-engine-api
 * consumer side. Owns the THREE.Scene and rebuilds one mesh/light per
 * entity from parsed components, then re-positions each frame from the
 * engine's transform table.
 *
 * `three` is a peer dependency — host projects supply their own copy.
 */

import * as THREE from 'three';

import type { ParsedScene, ParsedComponent, RendererConfig } from './synth-xml.js';
import type { TransformReader } from './engine.js';

const PLACEHOLDER_GEOMETRY: Record<string, () => THREE.BufferGeometry> = {
  sphere: () => new THREE.SphereGeometry(0.5, 24, 16),
  box: () => new THREE.BoxGeometry(1, 1, 1),
  plane: () => new THREE.PlaneGeometry(10, 10),
};

interface RenderedEntity {
  object3d: THREE.Object3D;
}

export class FrostRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly three: THREE.WebGLRenderer;

  private objects = new Map<string, RenderedEntity>();

  constructor(canvas: HTMLCanvasElement, config: Partial<RendererConfig> = {}) {
    const width = config.width ?? 800;
    const height = config.height ?? 600;

    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1116);
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    this.camera.position.set(6, 5, 8);
    this.camera.lookAt(0, 0, 0);

    this.three = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.three.setPixelRatio(window.devicePixelRatio);
    this.three.setSize(width, height, false);
  }

  build(parsedScene: ParsedScene): void {
    for (const entity of parsedScene.entities) {
      for (const comp of entity.components) {
        const obj = this.buildComponent(entity.id, comp);
        if (obj) {
          this.scene.add(obj);
          this.objects.set(entity.id, { object3d: obj });
          break;
        }
      }
    }
  }

  private buildComponent(entityId: string, comp: ParsedComponent): THREE.Object3D | null {
    switch (comp.kind) {
      case 'mesh': {
        const shape = comp.attrs.shape || 'sphere';
        const geom = (PLACEHOLDER_GEOMETRY[shape] ?? PLACEHOLDER_GEOMETRY.sphere)();
        const color = parseColor(comp.attrs.color || '#ffffff');
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1 });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.userData.entityId = entityId;
        return mesh;
      }
      case 'light': {
        const type = comp.attrs.type || 'point';
        const color = parseColor(comp.attrs.color || '#ffffff');
        const intensity = parseFloat(comp.attrs.intensity || '1');
        if (type === 'ambient') return new THREE.AmbientLight(color, intensity);
        if (type === 'directional') return new THREE.DirectionalLight(color, intensity);
        return new THREE.PointLight(color, intensity);
      }
      default:
        return null;
    }
  }

  /** Pull transforms from any TransformReader (typically a FrostEngine). */
  sync(engine: TransformReader): void {
    const n = engine.getEntityCount();
    for (let i = 0; i < n; i++) {
      const id = engine.getEntityId(i);
      const entry = this.objects.get(id);
      if (!entry) continue;
      const o = entry.object3d;
      o.position.set(engine.getX(i), engine.getY(i), engine.getZ(i));
      o.scale.set(engine.getScaleX(i), engine.getScaleY(i), engine.getScaleZ(i));
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (mat && mat.color) {
        mat.color.set(parseColor(engine.getColor(i)));
      }
    }
  }

  render(): void {
    this.three.render(this.scene, this.camera);
  }
}

function parseColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}
