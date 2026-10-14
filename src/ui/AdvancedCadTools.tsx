import { ToolSection, ToolWorkspace, workspaceTitle } from "./tool-panel-scope";
import { AppSelect } from "./AppSelect";
import { useState, useContext } from "react";
import type { Entity, Vec3 } from "../types";
import { Field, VectorField } from "./controls";
import type { CadPattern } from "../cad/client";
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
  onPattern,
  onMirror,
  onSplit,
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
  onPattern?: (pattern: CadPattern) => void;
  onMirror?: (origin: Vec3, normal: Vec3) => void;
  onSplit?: (cutterEntityId: string) => void;
  onError: (error: string) => void;
}) {
  const workspace = useContext(ToolWorkspace);
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
  const [patternKind, setPatternKind] = useState<"linear" | "circular">(
      workspace === "circularPattern" ? "circular" : "linear",
    ),
    [patternCount, setPatternCount] = useState(3),
    [patternStep, setPatternStep] = useState<Vec3>([30, 0, 0]),
    [patternCenter, setPatternCenter] = useState<Vec3>([0, 0, 0]),
    [patternAxis, setPatternAxis] = useState<Vec3>([0, 0, 1]),
    [patternAngle, setPatternAngle] = useState(90);
  const [mirrorOrigin, setMirrorOrigin] = useState<Vec3>([0, 0, 0]),
    [mirrorNormal, setMirrorNormal] = useState<Vec3>([1, 0, 0]);
  const [cutter, setCutter] = useState("");
  const attempt = (task: () => void) => {
    try {
      task();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section
      aria-label={
        workspace ? (workspaceTitle(workspace) ?? "CAD tools") : "CAD tools"
      }
    >
      <ToolSection tools={["linearPattern", "circularPattern", "advancedCad"]}>
        <h3>Body patterns</h3>
        <ToolSection tools={["advancedCad"]}>
          {" "}
          <label>
            Pattern type
            <AppSelect
              aria-label="CAD pattern type"
              value={patternKind}
              onChange={(event) =>
                setPatternKind(event.target.value as "linear" | "circular")
              }
            >
              <option value="linear">Linear</option>
              <option value="circular">Circular</option>
            </AppSelect>
          </label>
        </ToolSection>{" "}
        <Field
          label="Pattern copies including original"
          value={patternCount}
          min={2}
          max={256}
          onChange={setPatternCount}
        />
        {patternKind === "linear" ? (
          <VectorField
            label="Pattern spacing (mm)"
            value={patternStep}
            onChange={setPatternStep}
          />
        ) : (
          <>
            <VectorField
              label="Pattern center (mm)"
              value={patternCenter}
              onChange={setPatternCenter}
            />
            <VectorField
              label="Pattern rotation axis"
              value={patternAxis}
              onChange={setPatternAxis}
            />
            <Field
              label="Angular increment (degrees)"
              value={patternAngle}
              min={-360}
              max={360}
              onChange={setPatternAngle}
            />
          </>
        )}
        <p className="muted">
          Creates an exact compound of body copies. Copies are not fused;
          overlaps remain separate solids.
        </p>
        <button
          disabled={disabled || !selected?.kernelId || !onPattern}
          onClick={() =>
            attempt(() =>
              onPattern?.(
                patternKind === "linear"
                  ? { kind: "linear", count: patternCount, step: patternStep }
                  : {
                      kind: "circular",
                      count: patternCount,
                      center: patternCenter,
                      axis: patternAxis,
                      angleDegrees: patternAngle,
                    },
              ),
            )
          }
        >
          Create exact body pattern
        </button>
      </ToolSection>
      <ToolSection tools={["mirrorBody", "advancedCad"]}>
        <h3>Mirror body</h3>
        <VectorField
          label="Mirror plane origin (mm)"
          value={mirrorOrigin}
          onChange={setMirrorOrigin}
        />
        <VectorField
          label="Mirror plane normal"
          value={mirrorNormal}
          onChange={setMirrorNormal}
        />
        <button
          disabled={disabled || !selected?.kernelId || !onMirror}
          onClick={() => attempt(() => onMirror?.(mirrorOrigin, mirrorNormal))}
        >
          Create mirrored body
        </button>
      </ToolSection>
      <ToolSection tools={["splitSolid", "advancedCad"]}>
        <h3>Split solid</h3>
        <label>
          Cutting solid
          <AppSelect
            aria-label="Split cutting solid"
            value={cutter}
            onChange={(event) => setCutter(event.target.value)}
          >
            <option value="">Choose intersecting CAD solid</option>
            {entities
              .filter((entity) => entity.kernelId && entity.id !== selected?.id)
              .map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
          </AppSelect>
        </label>
        <p className="muted">
          Produces two exact bodies: material inside the cutter and material
          outside it. The original bodies remain available.
        </p>
        <button
          disabled={disabled || !selected?.kernelId || !cutter || !onSplit}
          onClick={() => attempt(() => onSplit?.(cutter))}
        >
          Split into inside / outside
        </button>
      </ToolSection>
      <ToolSection tools={["loft", "advancedCad"]}>
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
      </ToolSection>
      <ToolSection tools={["sweep", "advancedCad"]}>
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
          Profile lies in the plane normal to the first spine segment. Sharp
          turns or self-intersections can fail.
        </p>
        <button
          disabled={disabled}
          onClick={() =>
            attempt(() => onSweep(JSON.parse(profile), JSON.parse(path)))
          }
        >
          Create exact sweep
        </button>
      </ToolSection>
      <ToolSection tools={["fillet", "chamfer", "advancedCad"]}>
        <h3>{workspace === "chamfer" ? "Chamfer" : "Fillet"}</h3>
        <label>
          Zero-based kernel edge indices
          <input
            aria-label="CAD edge indices"
            value={edges}
            onChange={(event) => setEdges(event.target.value)}
          />
        </label>
        <Field
          label={
            workspace === "chamfer"
              ? "Chamfer distance (mm)"
              : "Fillet radius (mm)"
          }
          value={amount}
          min={0.001}
          onChange={setAmount}
        />
        <ToolSection tools={["fillet", "advancedCad"]}>
          <button
            disabled={disabled || !selected?.kernelId}
            onClick={() =>
              attempt(() =>
                onEdges(edges.split(",").map(Number), amount, "fillet"),
              )
            }
          >
            Create fillet
          </button>
        </ToolSection>
        <ToolSection tools={["chamfer", "advancedCad"]}>
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
        </ToolSection>
      </ToolSection>
      <ToolSection tools={["surfaceOffset", "advancedCad"]}>
        <h3>Surface offset</h3>
        <Field
          label="Offset distance (mm)"
          value={offset}
          onChange={setOffset}
        />
        <button
          disabled={disabled || !selected?.kernelId}
          onClick={() => onOffset(offset)}
        >
          Create exact offset
        </button>
      </ToolSection>
      <ToolSection tools={["shell", "surfaceThicken", "advancedCad"]}>
        <h3>{workspace === "surfaceThicken" ? "Thicken surface" : "Shell"}</h3>
        <ToolSection tools={["shell", "advancedCad"]}>
          {" "}
          <label>
            Faces to remove: zero-based indices
            <input
              aria-label="Shell face indices"
              value={faces}
              onChange={(event) => setFaces(event.target.value)}
            />
          </label>
        </ToolSection>{" "}
        <Field
          label="Signed wall thickness (mm)"
          value={thickness}
          onChange={setThickness}
        />
        <ToolSection tools={["shell", "advancedCad"]}>
          <button
            disabled={disabled || !selected?.kernelId}
            onClick={() =>
              attempt(() => onShell(faces.split(",").map(Number), thickness))
            }
          >
            Create hollow shell
          </button>
        </ToolSection>
        <ToolSection tools={["surfaceThicken", "advancedCad"]}>
          <button
            disabled={disabled || !selected?.kernelId}
            onClick={() => onThicken(thickness)}
          >
            Thicken surface
          </button>
        </ToolSection>
      </ToolSection>
      <ToolSection tools={["sewSurfaces", "advancedCad"]}>
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
      </ToolSection>
    </section>
  );
}
