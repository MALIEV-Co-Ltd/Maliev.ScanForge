import * as THREE from "three";

/** Keep the world-space rotation center stable until the cap returns to rest. */
export class NavigationPivot {
  readonly point = new THREE.Vector3();
  private activeUntil = -Infinity;

  active(now: number): boolean {
    return now < this.activeUntil;
  }

  update(
    now: number,
    scene: THREE.Box3,
    selected?: THREE.Box3,
    surface?: THREE.Vector3,
  ): THREE.Vector3 {
    if (!this.active(now)) {
      const bounds = selected && !selected.isEmpty() ? selected : scene;
      if (surface && surface.toArray().every(Number.isFinite))
        this.point.copy(surface);
      else if (bounds.isEmpty()) this.point.set(0, 0, 0);
      else bounds.getCenter(this.point);
    }
    this.activeUntil = now + 350;
    return this.point;
  }
}
