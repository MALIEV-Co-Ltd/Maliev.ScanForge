import { useState } from "react";
import type { Entity, Vec3 } from "../types";
import { Field } from "./controls";
export function AdvancedCadTools({
  entities,
  selected,
  disabled,
  onLoft,
  onSweep,
  onEdges,
  onOffset,
  onSew,
  onShell,
  onThicken,
  onError,
}: {
  entities: Entity[];
  selected?: Entity;
  disabled: boolean;
  onLoft: (
    profiles: { points: [number, number][]; z: number }[],
    ruled: boolean,
  ) => void;
  onSweep: (points: [number, number][], path: Vec3[]) => void;
  onEdges: (
    indices: number[],
    amount: number,
    operation: "fillet" | "chamfer",
  ) => void;
  onOffset: (distance: number) => void;
  onSew: (ids: string[], tolerance: number) => void;
  onShell: (indices: number[], thickness: number) => void;
  onThicken: (thickness: number) => void;
  onError: (error: string) => void;
}) {
  const [profiles, setProfiles] = useState(
    '[{"z":0,"points":[[0,0],[20,0],[20,20],[0,20]]},{"z":30,"points":[[0,0],[20,0],[20,20],[0,20]]}]',
  );
  const [profile, setProfile] = useState("[[-3,-3],[3,-3],[3,3],[-3,3]]");
  const [path, setPath] = useState("[[0,0,0],[0,0,40]]");
  const [ruled, setRuled] = useState(true);
  const [edges, setEdges] = useState("0");
  const [amount, setAmount] = useState(1);
  const [offset, setOffset] = useState(1);
  const [tolerance, setTolerance] = useState(0.001);
  const [sewIds, setSewIds] = useState<string[]>([]);
  const [faces, setFaces] = useState("0");
  const [thickness, setThickness] = useState(-1);
  const attempt = (task: () => void) => {
    try {
      task();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section aria-label="Advanced CAD tools">
      <h3>Loft profiles</h3>
      <label>
        Profiles: JSON arrays of XY points with Z height
        <textarea
          aria-label="Loft profiles"
          rows={5}
          value={profiles}
          onChange={(event) => setProfiles(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={ruled}
          onChange={(event) => setRuled(event.target.checked)}
        />
        Ruled sides
      </label>
      <button
        disabled={disabled}
        onClick={() => attempt(() => onLoft(JSON.parse(profiles), ruled))}
      >
        Create exact loft
      </button>
      <h3>Sweep</h3>
      <label>
        Profile XY points (JSON)
        <textarea
          aria-label="Sweep profile"
          value={profile}
          onChange={(event) => setProfile(event.target.value)}
        />
      </label>
      <label>
        Spine XYZ points (JSON)
        <textarea
          aria-label="Sweep path"
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
      </label>
      <p className="muted">
        Profile lies in the plane normal to the first spine segment. Sharp turns
        or self-intersections can fail.
      </p>
      <button
        disabled={disabled}
        onClick={() =>
          attempt(() => onSweep(JSON.parse(profile), JSON.parse(path)))
        }
      >
        Create exact sweep
      </button>
      <h3>Edges</h3>
      <label>
        Zero-based kernel edge indices
        <input
          aria-label="CAD edge indices"
          value={edges}
          onChange={(event) => setEdges(event.target.value)}
        />
      </label>
      <Field
        label="Edge radius / distance (mm)"
        value={amount}
        min={0.001}
        onChange={setAmount}
      />
      <button
        disabled={disabled || !selected?.kernelId}
        onClick={() =>
          attempt(() => onEdges(edges.split(",").map(Number), amount, "fillet"))
        }
      >
        Create fillet
      </button>
      <button
        disabled={disabled || !selected?.kernelId}
        onClick={() =>
          attempt(() =>
            onEdges(edges.split(",").map(Number), amount, "chamfer"),
          )
        }
      >
        Create chamfer
      </button>
      <h3>Surface offset</h3>
      <Field label="Offset distance (mm)" value={offset} onChange={setOffset} />
      <button
        disabled={disabled || !selected?.kernelId}
        onClick={() => onOffset(offset)}
      >
        Create exact offset
      </button>
      <h3>Shell / thicken</h3>
      <label>
        Faces to remove: zero-based indices
        <input
          aria-label="Shell face indices"
          value={faces}
          onChange={(event) => setFaces(event.target.value)}
        />
      </label>
      <Field
        label="Signed wall thickness (mm)"
        value={thickness}
        onChange={setThickness}
      />
      <button
        disabled={disabled || !selected?.kernelId}
        onClick={() =>
          attempt(() => onShell(faces.split(",").map(Number), thickness))
        }
      >
        Create hollow shell
      </button>
      <button
        disabled={disabled || !selected?.kernelId}
        onClick={() => onThicken(thickness)}
      >
        Thicken surface
      </button>
      <h3>Sew CAD surfaces</h3>
      {entities
        .filter((entity) => entity.kernelId)
        .map((entity) => (
          <label key={entity.id}>
            <input
              type="checkbox"
              checked={sewIds.includes(entity.id)}
              onChange={(event) =>
                setSewIds(
                  event.target.checked
                    ? [...sewIds, entity.id]
                    : sewIds.filter((id) => id !== entity.id),
                )
              }
            />
            {entity.name}
          </label>
        ))}
      <Field
        label="Sewing tolerance (mm)"
        value={tolerance}
        min={0.000001}
        onChange={setTolerance}
      />
      <button
        disabled={disabled || sewIds.length < 2}
        onClick={() => onSew(sewIds, tolerance)}
      >
        Sew selected shapes
      </button>
    </section>
  );
}
