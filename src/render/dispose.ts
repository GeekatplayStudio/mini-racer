import * as THREE from 'three';

/**
 * Frees the GPU side of everything under an object: geometries, materials,
 * their textures and instance buffers. Three keeps per-geometry state until
 * dispose() is called, so models that are thrown away must come through here.
 * Shared resources may be disposed too: three uploads them again on next use.
 */
export function disposeTree(root: THREE.Object3D): void {
  const done = new Set<object>();
  const once = (x: { dispose(): void } | null | undefined): void => {
    if (!x || done.has(x)) return;
    done.add(x);
    x.dispose();
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    once(mesh.geometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const mat of materials) {
      for (const value of Object.values(mat)) {
        if (value instanceof THREE.Texture) once(value);
      }
      once(mat);
    }
    if ((o as THREE.InstancedMesh).isInstancedMesh) once(o as THREE.InstancedMesh);
  });
}

/**
 * The frame just drawn as a JPEG small enough to keep: photos live in browser
 * storage, which holds only a few megabytes for the whole team.
 */
export function photoOf(canvas: HTMLCanvasElement, maxWidth = 800): string {
  const scale = Math.min(1, maxWidth / canvas.width);
  if (scale === 1) return canvas.toDataURL('image/jpeg', 0.8);
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  const ctx = out.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/jpeg', 0.8);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.8);
}
