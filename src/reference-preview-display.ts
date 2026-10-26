import * as THREE from "three";
import type { Entity } from "./types";
import {
  createReferenceDisplay,
  type ReferenceDisplay,
} from "./reference-display";
import { copyReferenceEntityData } from "./reference-entity";
import {
  copyReferenceGeometry,
  encodeReferenceGeometry,
  type ReferenceGeometry,
  type ReferenceVector,
} from "./reference-construction-values";
import type { ReferenceConstructionCachedPreview } from "./reference-construction-session";

export type ReferencePreviewInspection =
  | { active: false }
  | {
      active: true;
      ownerId: string;
      state: "ready" | "retiring";
      pendingDisposals: number;
      units: "mm";
      geometry?: ReferenceGeometry;
      geometryEncoding?: ReturnType<typeof encodeReferenceGeometry>;
      bounds?: { min: ReferenceVector; max: ReferenceVector };
    };
/** Ephemeral display ownership only; never inserts a persistent model entity. */
export class ReferencePreviewDisplay {
  private owner?: string;
  private current?: ReferenceDisplay;
  private pending = new Set<ReferenceDisplay>();
  private clipping: THREE.Plane[] = [];
  private changing = false;
  constructor(private readonly scene: THREE.Scene) {}
  private retire(display: ReferenceDisplay) {
    this.pending.add(display);
    display.dispose();
    this.pending.delete(display);
    if (this.current === display) this.current = undefined;
  }
  private drain() {
    const errors: unknown[] = [];
    for (const display of [...this.pending]) {
      try {
        this.retire(display);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(
        errors,
        "Reference preview retirement is incomplete.",
      );
  }
  show(owner: string, candidate: ReferenceConstructionCachedPreview): void {
    if (this.changing)
      throw new Error("Reference preview transition is in progress.");
    if (!owner || typeof owner !== "string")
      throw new Error("Reference preview requires an owner.");
    if (this.owner && this.owner !== owner)
      throw new Error("Another reference preview owner is active.");
    this.changing = true;
    try {
      this.drain();
      const data = copyReferenceEntityData({
        version: 1,
        definition: candidate.definition,
        geometry: candidate.preview.geometry,
        evaluation: candidate.preview.state,
      });
      const entity: Entity = {
        id: "reference-preview:" + owner,
        name: "Reference construction preview",
        kind:
          data.geometry.kind === "point" ? "referencePoint" : "referenceLine",
        positions: [],
        constructionOrderKey: "0".repeat(32),
        reference: data,
        visible: true,
        selectable: false,
        locked: true,
        color: "#4aa3ff",
        opacity: 0.7,
      };
      const next = createReferenceDisplay(entity);
      this.owner = owner;
      try {
        if (this.current) this.retire(this.current);
        next.object.material.clippingPlanes = [...this.clipping];
        next.object.material.needsUpdate = true;
        this.scene.add(next.object);
        this.current = next;
      } catch (error) {
        try {
          this.retire(next);
        } catch (retirement) {
          throw new AggregateError(
            [error, retirement],
            "Reference preview replacement and staged cleanup failed.",
          );
        }
        throw error;
      }
    } finally {
      this.changing = false;
    }
  }
  clear(owner: string): boolean {
    if (owner !== this.owner) return false;
    if (this.changing)
      throw new Error("Reference preview transition is in progress.");
    this.changing = true;
    try {
      const errors: unknown[] = [];
      for (const display of new Set([
        ...(this.current ? [this.current] : []),
        ...this.pending,
      ])) {
        try {
          this.retire(display);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(
          errors,
          "Reference preview cleanup is incomplete.",
        );
      this.owner = undefined;
      return true;
    } finally {
      this.changing = false;
    }
  }
  setClippingPlanes(planes: readonly THREE.Plane[]): void {
    this.clipping = [...planes];
    if (this.current) {
      this.current.object.material.clippingPlanes = [...planes];
      this.current.object.material.needsUpdate = true;
    }
  }
  inspect(): ReferencePreviewInspection {
    if (!this.owner) return { active: false };
    const data = this.current?.data,
      bounds = this.current?.bounds;
    return {
      active: true,
      ownerId: this.owner,
      state: this.current && !this.pending.size ? "ready" : "retiring",
      pendingDisposals: this.pending.size,
      units: "mm",
      ...(data && "geometry" in data
        ? {
            geometry: copyReferenceGeometry(data.geometry),
            geometryEncoding: encodeReferenceGeometry(data.geometry),
          }
        : {}),
      ...(bounds
        ? {
            bounds: {
              min: bounds.min.toArray() as [number, number, number],
              max: bounds.max.toArray() as [number, number, number],
            },
          }
        : {}),
    };
  }
  dispose(): void {
    if (this.owner) this.clear(this.owner);
  }
}
