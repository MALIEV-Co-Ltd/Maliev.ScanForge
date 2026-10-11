import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  Box,
  Circle,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Layers,
  Maximize,
  MousePointer2,
  Plus,
  Redo2,
  Ruler,
  Save,
  ScanLine,
  Trash2,
  Triangle,
  Undo2,
  X,
} from "lucide-react";
import { CadClient } from "../cad/client";
import {
  cleanupMesh,
  deviations,
  fitCylinder,
  fitPlane,
  fitSphere,
  meshStats,
  sectionMesh,
  transformPositions,
} from "../geometry";
import {
  download,
  exportStl,
  geometryPositions,
  MAX_FILE_BYTES,
  parseMesh,
  parseProject,
  serializeProject,
  validatePositions,
} from "../io";
import { demonstrationBracket } from "../sample";
import type { Entity, FitResult, KernelPrimitive, Vec3 } from "../types";
import { Viewport } from "../viewport";
import { Field, Panel, VectorField } from "./controls";
import { SolidTools } from "./SolidTools";

const number = (n: number) =>
  n.toLocaleString("en", { maximumFractionDigits: 3 });
type Mode = "inspect" | "measure" | "section";
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function App() {
  const [entities, setEntities] = useState<Entity[]>(() => [
    demonstrationBracket(),
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(entities[0].id);
  const [name, setName] = useState("Untitled project");
  const [mode, setMode] = useState<Mode>("inspect");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "Ready · demonstration geometry loaded",
  );
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [axis, setAxis] = useState<"x" | "y" | "z">("z");
  const [offset, setOffset] = useState(10);
  const [measure, setMeasure] = useState<Vec3[]>([]);
  const [anchor, setAnchor] = useState<Vec3 | null>(null);
  const [localFit, setLocalFit] = useState(false);
  const [fitRadius, setFitRadius] = useState(12);
  const [fit, setFit] = useState<FitResult | null>(null);
  const [showDeviation, setShowDeviation] = useState(false);
  const [tolerance, setTolerance] = useState(1);
  const [translation, setTranslation] = useState<Vec3>([0, 0, 0]);
  const [rotation, setRotation] = useState<Vec3>([0, 0, 0]);
  const [scale, setScale] = useState(1);
  const [primitiveDialog, setPrimitiveDialog] = useState(false);
  const [primitiveKind, setPrimitiveKind] = useState<
    "box" | "sphere" | "cylinder"
  >("box");
  const [size, setSize] = useState<Vec3>([30, 30, 30]);
  const [radius, setRadius] = useState(15);
  const [height, setHeight] = useState(30);
  const [center, setCenter] = useState<Vec3>([0, 0, 15]);
  const [history, setHistory] = useState<Entity[][]>([]);
  const [future, setFuture] = useState<Entity[][]>([]);
  const viewportHost = useRef<HTMLDivElement>(null);
  const viewport = useRef<Viewport | null>(null);
  const cad = useRef<CadClient | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const knownKernelIds = useRef(new Set<string>());
  const selected = entities.find((e) => e.id === selectedId);
  const stats = useMemo(
    () => (selected ? meshStats(selected.positions) : null),
    [selected?.positions],
  );
  const section = useMemo(
    () =>
      mode === "section" && selected
        ? sectionMesh(selected.positions, axis, offset)
        : { segments: [], length: 0 },
    [mode, selected?.positions, axis, offset],
  );

  useEffect(() => {
    cad.current = new CadClient();
    try {
      viewport.current = new Viewport(
        viewportHost.current!,
        (point, id) => {
          setSelectedId(id);
          if (modeRef.current === "measure")
            setMeasure((previous) =>
              previous.length === 1 ? [previous[0], point] : [point],
            );
          else setAnchor(point);
        },
        setSelectedId,
      );
    } catch (e) {
      setError(`WebGL unavailable: ${errorText(e)}`);
    }
    const unload = (event?: PageTransitionEvent) => {
      if (!event?.persisted) {
        cad.current?.dispose();
        viewport.current?.dispose();
      }
    };
    window.addEventListener("pagehide", unload);
    return () => {
      window.removeEventListener("pagehide", unload);
      unload();
    };
  }, []);
  useEffect(() => {
    viewport.current?.setEntities(entities, selectedId);
  }, [entities, selectedId]);
  useEffect(() => {
    viewport.current?.setWireframe(wireframe);
  }, [wireframe]);
  useEffect(() => {
    viewport.current?.setSection(axis, offset, mode === "section");
    viewport.current?.setSectionLines(section.segments);
  }, [axis, offset, mode, section]);
  useEffect(() => {
    viewport.current?.setMeasurement(measure);
  }, [measure]);
  useEffect(() => {
    if (selected)
      viewport.current?.setDeviation(
        selected.id,
        showDeviation && fit ? deviations(selected.positions, fit) : null,
        tolerance,
      );
  }, [selected, showDeviation, fit, tolerance]);
  useEffect(() => {
    setFit(null);
    setShowDeviation(false);
    setAnchor(null);
    setTranslation([0, 0, 0]);
    setRotation([0, 0, 0]);
    setScale(1);
  }, [selectedId, selected?.positions]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  // Viewport constructor precedes geometry upload. Fit after the first frame.
  useEffect(() => {
    const frame = requestAnimationFrame(() => viewport.current?.fitView());
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    // Undo/redo snapshots own their CAD handles too. Release only unreachable shapes.
    const reachable = new Set(
      [...entities, ...history.flat(), ...future.flat()].flatMap((e) =>
        e.kernelId ? [e.kernelId] : [],
      ),
    );
    const unused = [...knownKernelIds.current].filter(
      (id) => !reachable.has(id),
    );
    knownKernelIds.current = reachable;
    if (unused.length)
      void cad.current
        ?.release(unused)
        .catch((e) => setError(`CAD cleanup: ${errorText(e)}`));
  }, [entities, history, future]);

  function commit(next: Entity[]) {
    if (
      next.length > 100 ||
      next.reduce((sum, e) => sum + e.positions.length, 0) > 6_000_000
    ) {
      const newlyCreated = next.flatMap((e) =>
        e.kernelId && !entities.some((old) => old.kernelId === e.kernelId)
          ? [e.kernelId]
          : [],
      );
      if (newlyCreated.length)
        void cad.current?.release(newlyCreated).catch(() => undefined);
      throw new Error(
        "Project limit: 100 objects and 666,666 total triangles.",
      );
    }
    setHistory((previous) => [...previous.slice(-19), entities]);
    setFuture([]);
    setEntities(next);
    setDirty(true);
  }
  function updateSelected(patch: Partial<Entity>) {
    if (selected)
      commit(
        entities.map((e) => (e.id === selected.id ? { ...e, ...patch } : e)),
      );
  }
  function undo() {
    if (history.length) {
      const next = history[history.length - 1];
      setFuture((p) => [entities, ...p]);
      setEntities(next);
      setSelectedId(
        next.some((entity) => entity.id === selectedId)
          ? selectedId
          : (next[0]?.id ?? null),
      );
      setHistory((p) => p.slice(0, -1));
      setDirty(true);
    }
  }
  function redo() {
    if (future.length) {
      const next = future[0];
      setHistory((p) => [...p.slice(-19), entities]);
      setEntities(next);
      setSelectedId(
        next.some((entity) => entity.id === selectedId)
          ? selectedId
          : (next[0]?.id ?? null),
      );
      setFuture((p) => p.slice(1));
      setDirty(true);
    }
  }
  async function action(label: string, run: () => Promise<void> | void) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage(label);
    try {
      await run();
    } catch (e) {
      setError(errorText(e));
      setMessage("Operation failed");
    } finally {
      setBusy(false);
    }
  }
  async function openFile(file: File) {
    await action(`Opening ${file.name}…`, async () => {
      if (file.size > MAX_FILE_BYTES)
        throw new Error("File exceeds the 64 MiB browser import limit.");
      const extension = file.name.split(".").pop()!.toLowerCase();
      if (extension === "scanforge" || extension === "json") {
        const project = parseProject(await file.text());
        if (
          dirty &&
          !window.confirm(
            "Replace the current project? Unsaved changes will be lost.",
          )
        ) {
          setMessage("Project replacement cancelled");
          return;
        }
        // Restore to a separate worker so a failed load preserves the existing project.
        const restoredCad = new CadClient();
        try {
          const restored: Entity[] = [];
          for (const entity of project.entities) {
            if (entity.brep) {
              const data = await restoredCad.importFile(
                new TextEncoder().encode(entity.brep),
                "brep",
              );
              restored.push({ ...entity, ...data });
            } else restored.push(entity);
          }
          cad.current?.dispose();
          cad.current = restoredCad;
          knownKernelIds.current = new Set();
          setEntities(restored);
          setSelectedId(restored[0]?.id ?? null);
          setName(project.name);
          setHistory([]);
          setFuture([]);
          setDirty(false);
          setMeasure([]);
        } catch (e) {
          restoredCad.dispose();
          throw e;
        }
      } else {
        const data = await file.arrayBuffer();
        let entity: Entity;
        if (["step", "stp", "iges", "igs", "brep"].includes(extension)) {
          const result = await cad.current!.importFile(
            new Uint8Array(data),
            extension as "step" | "stp" | "iges" | "igs" | "brep",
          );
          entity = {
            id: crypto.randomUUID(),
            name: file.name,
            kind: "cad",
            ...result,
            color: "#78a8db",
            visible: true,
            opacity: 1,
            source: file.name,
          };
        } else
          entity = {
            id: crypto.randomUUID(),
            name: file.name,
            kind: "mesh",
            positions: parseMesh(data, extension),
            color: "#31bfa8",
            visible: true,
            opacity: 1,
            source: file.name,
          };
        commit([...entities, entity]);
        setSelectedId(entity.id);
      }
      setMessage(
        `Opened ${file.name} · assumed millimetres for unitless scans`,
      );
      requestAnimationFrame(() =>
        requestAnimationFrame(() => viewport.current?.fitView()),
      );
    });
  }
  function runFit(kind: "plane" | "sphere" | "cylinder") {
    void action(`Fitting ${kind}…`, () => {
      if (!selected) throw new Error("Select an object first.");
      let positions = selected.positions;
      if (localFit) {
        if (!anchor)
          throw new Error(
            "Click the scan in Inspect mode to place the fitting region.",
          );
        if (fitRadius <= 0) throw new Error("Region radius must be positive.");
        positions = [];
        for (let i = 0; i < selected.positions.length; i += 3) {
          const p = selected.positions.slice(i, i + 3);
          if (
            Math.hypot(p[0] - anchor[0], p[1] - anchor[1], p[2] - anchor[2]) <=
            fitRadius
          )
            positions.push(...p);
        }
      }
      if (positions.length > 60_000) {
        const sampled: number[] = [];
        const stride = Math.ceil(positions.length / 60_000);
        for (let i = 0; i < positions.length; i += 3 * stride)
          sampled.push(positions[i], positions[i + 1], positions[i + 2]);
        positions = sampled;
      }
      const fitted =
        kind === "plane"
          ? fitPlane(positions)
          : kind === "sphere"
            ? fitSphere(positions)
            : fitCylinder(positions);
      setFit(fitted);
      setShowDeviation(true);
      setMessage(
        `Fitted ${kind} · RMS ${number(fitted.rms)} mm · ${positions.length / 3} sampled vertices`,
      );
    });
  }
  async function addPrimitive(input: KernelPrimitive, label: string) {
    const result = await cad.current!.primitive(input);
    const entity: Entity = {
      id: crypto.randomUUID(),
      name: label,
      kind: input.kind,
      ...result,
      color: "#78a8db",
      visible: true,
      opacity: 0.85,
    };
    commit([...entities, entity]);
    setSelectedId(entity.id);
    setPrimitiveDialog(false);
    setMessage(`${label} created as exact CAD`);
  }
  function materializeFit() {
    void action("Creating fitted geometry…", async () => {
      if (!fit || !stats) throw new Error("Fit a surface first.");
      if (fit.kind === "plane") {
        const geometry = new THREE.PlaneGeometry(
          Math.max(...stats.size),
          Math.max(...stats.size),
        );
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(...fit.axis),
        );
        geometry.applyQuaternion(q);
        geometry.translate(...fit.center);
        try {
          const entity: Entity = {
            id: crypto.randomUUID(),
            name: "Fitted plane reference",
            kind: "plane",
            positions: geometryPositions(geometry),
            color: "#ffbd65",
            visible: true,
            opacity: 0.5,
          };
          commit([...entities, entity]);
          setSelectedId(entity.id);
          setMessage(
            "Reference plane created · mesh reference, excluded from STEP",
          );
        } finally {
          geometry.dispose();
        }
      } else if (fit.kind === "sphere")
        await addPrimitive(
          { kind: "sphere", center: fit.center, radius: fit.radius! },
          "Fitted sphere",
        );
      else
        await addPrimitive(
          {
            kind: "cylinder",
            center: fit.center,
            axis: fit.axis,
            radius: fit.radius!,
            height: fit.height!,
          },
          "Fitted cylinder",
        );
    });
  }
  function applyTransform() {
    void action("Transforming object…", async () => {
      if (!selected) return;
      if (selected.kernelId) {
        const result = await cad.current!.transform(
          selected.kernelId,
          translation,
          rotation,
          scale,
        );
        updateSelected(result);
        setMessage("Transform applied · exact CAD retained");
      } else {
        const positions = transformPositions(
          selected.positions,
          translation,
          rotation,
          scale,
        );
        updateSelected({ positions });
        setMessage("Transform applied to mesh");
      }
    });
  }
  function boolean(
    operation: "union" | "subtract" | "intersect",
    otherId: string,
  ) {
    void action(`CAD ${operation}…`, async () => {
      const other = entities.find((e) => e.id === otherId);
      if (!selected?.kernelId || !other?.kernelId)
        throw new Error("Select two exact CAD bodies.");
      const result = await cad.current!.boolean(
        operation,
        selected.kernelId,
        other.kernelId,
      );
      const entity: Entity = {
        id: crypto.randomUUID(),
        name: `${operation} result`,
        kind: "cad",
        ...result,
        color: "#78a8db",
        visible: true,
        opacity: 1,
      };
      commit([
        ...entities.map((e) =>
          e.id === selected.id || e.id === other.id
            ? { ...e, visible: false }
            : e,
        ),
        entity,
      ]);
      setSelectedId(entity.id);
      setMessage(`Created exact ${operation} result`);
    });
  }
  function extrude(points: [number, number][], height: number) {
    void action("Extruding polygon sketch…", async () => {
      const result = await cad.current!.extrude(points, height);
      const entity: Entity = {
        id: crypto.randomUUID(),
        name: "Polygon extrusion",
        kind: "cad",
        ...result,
        color: "#78a8db",
        visible: true,
        opacity: 1,
      };
      commit([...entities, entity]);
      setSelectedId(entity.id);
      setMessage("Polygon extruded to exact CAD");
    });
  }
  function save() {
    void action("Saving project…", () => {
      download(
        serializeProject(name, entities),
        `${name.replace(/[^a-z0-9-_ ]/gi, "_")}.scanforge`,
        "application/json",
      );
      setDirty(false);
      setMessage("Project downloaded · exact CAD retained where available");
    });
  }
  function exportStep() {
    void action("Exporting exact CAD…", async () => {
      const shapes = entities.filter((e) => e.visible && e.kernelId);
      if (!shapes.length)
        throw new Error(
          "Create or import exact CAD first. Scan meshes cannot be exported as editable STEP solids.",
        );
      const data = await cad.current!.exportStep(
        shapes.map((e) => e.kernelId!),
      );
      download(data as BlobPart, "scanforge.step");
      setMessage(
        `Exported ${shapes.length} CAD object(s) · scan/reference meshes excluded`,
      );
    });
  }
  const length =
    measure.length === 2
      ? Math.hypot(...measure[0].map((x, i) => x - measure[1][i]))
      : null;
  return (
    <div className="workbench">
      <header className="header">
        <div className="brand">
          <strong>MALIEV</strong>
          <span>ScanForge</span>
          <small>0.1</small>
        </div>
        <div className="header-actions">
          <button disabled={busy} onClick={() => fileInput.current?.click()}>
            <FolderOpen size={17} />
            Open scan
          </button>
          <button disabled={busy} onClick={save}>
            <Save size={17} />
            Save project
          </button>
          <button disabled={busy} onClick={exportStep}>
            <Download size={17} />
            Export STEP
          </button>
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".stl,.obj,.ply,.step,.stp,.iges,.igs,.brep,.scanforge,.json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void openFile(file);
        }}
      />
      <nav className="toolbar" aria-label="Model tools">
        <button
          className={mode === "inspect" ? "active" : ""}
          onClick={() => {
            setMode("inspect");
            setMeasure([]);
          }}
        >
          <MousePointer2 size={17} />
          Inspect
        </button>
        <button
          className={mode === "measure" ? "active" : ""}
          onClick={() => {
            setMode("measure");
            setMeasure([]);
          }}
        >
          <Ruler size={17} />
          Measure
        </button>
        <button
          className={mode === "section" ? "active" : ""}
          onClick={() => setMode(mode === "section" ? "inspect" : "section")}
        >
          <ScanLine size={17} />
          Section
        </button>
        <span className="separator" />
        <button disabled={busy || !selected} onClick={() => runFit("plane")}>
          <Triangle size={17} />
          Fit plane
        </button>
        <button disabled={busy || !selected} onClick={() => runFit("sphere")}>
          <Circle size={17} />
          Fit sphere
        </button>
        <button disabled={busy || !selected} onClick={() => runFit("cylinder")}>
          <Box size={17} />
          Fit cylinder
        </button>
        <div className="toolbar-end">
          <button
            title="Undo"
            aria-label="Undo"
            disabled={busy || !history.length}
            onClick={undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            title="Redo"
            aria-label="Redo"
            disabled={busy || !future.length}
            onClick={redo}
          >
            <Redo2 size={17} />
          </button>
        </div>
      </nav>
      <main className="workspace">
        <aside className="explorer" inert={busy}>
          <h2>
            Model explorer <Layers size={15} />
          </h2>
          <label className="project-name">
            <span>Project</span>
            <input
              aria-label="Project name"
              value={name}
              maxLength={200}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <div className="tree-heading">
            Objects <span>{entities.length}</span>
          </div>
          <ul className="object-list">
            {entities.map((entity) => (
              <li
                key={entity.id}
                className={entity.id === selectedId ? "selected" : ""}
              >
                <button
                  className="visibility"
                  title={entity.visible ? "Hide object" : "Show object"}
                  aria-label={`${entity.visible ? "Hide" : "Show"} ${entity.name}`}
                  disabled={busy}
                  onClick={() =>
                    commit(
                      entities.map((e) =>
                        e.id === entity.id ? { ...e, visible: !e.visible } : e,
                      ),
                    )
                  }
                >
                  {entity.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <button
                  className="object-name"
                  onClick={() => setSelectedId(entity.id)}
                >
                  <span>
                    {entity.kind === "mesh" ? (
                      <Triangle size={16} />
                    ) : (
                      <Box size={16} />
                    )}
                  </span>
                  <span>{entity.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            className="wide"
            disabled={busy}
            onClick={() => setPrimitiveDialog(true)}
          >
            <Plus size={17} />
            Add primitive
          </button>
          <div className="explorer-bottom">
            <button
              className="wide"
              disabled={busy || !selected}
              onClick={() => {
                if (selected) {
                  commit(entities.filter((e) => e.id !== selected.id));
                  setSelectedId(null);
                  setMeasure([]);
                  setMessage("Object deleted");
                }
              }}
            >
              <Trash2 size={15} />
              Delete selected
            </button>
            <button
              className="wide"
              disabled={busy || !entities.length}
              onClick={() =>
                void action("Exporting mesh…", () => {
                  download(
                    exportStl(entities.filter((e) => e.visible)) as BlobPart,
                    "scanforge.stl",
                  );
                  setMessage("Visible objects exported to binary STL");
                })
              }
            >
              <Download size={15} />
              Export STL
            </button>
            <p>
              STL · OBJ · PLY · STEP · IGES
              <br />
              Your files stay on this device.
            </p>
          </div>
        </aside>
        <section className="canvas-area" aria-label="3D viewport">
          <div ref={viewportHost} className="viewport" />
          <div className="view-controls">
            <span>Perspective</span>
            {(["iso", "top", "front", "right"] as const).map((view) => (
              <button
                key={view}
                onClick={() => viewport.current?.setView(view)}
              >
                {view === "iso" ? "3D" : view}
              </button>
            ))}
            <button
              title="Fit all objects"
              aria-label="Fit all objects"
              onClick={() => viewport.current?.fitView()}
            >
              <Maximize size={15} />
            </button>
          </div>
          <div className="canvas-hint">
            {mode === "measure"
              ? "Click two points on a surface to measure distance"
              : mode === "section"
                ? `${axis.toUpperCase()} section · ${number(offset)} mm`
                : "Drag to orbit · right-drag to pan · scroll to zoom"}
          </div>
          {mode === "measure" && (
            <div className="measurement">
              <Ruler size={17} />
              {length === null
                ? "Pick two surface points"
                : `${number(length)} mm`}
              <button
                aria-label="Clear measurement"
                onClick={() => setMeasure([])}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {showDeviation && fit && (
            <div className="deviation-legend">
              <span>−{number(tolerance)} mm</span>
              <i />
              <span>+{number(tolerance)} mm</span>
            </div>
          )}
        </section>
        <aside className="inspector" inert={busy}>
          <h2>
            Properties <Crosshair size={15} />
          </h2>
          {selected && stats ? (
            <>
              <div className="selected-title">
                <Triangle size={25} />
                <div>
                  <input
                    aria-label="Object name"
                    value={selected.name}
                    maxLength={200}
                    onChange={(e) => updateSelected({ name: e.target.value })}
                  />
                  <small>
                    {selected.kernelId
                      ? "Exact CAD + display mesh"
                      : selected.kind === "plane"
                        ? "Reference surface"
                        : "Triangle mesh"}{" "}
                    · mm
                  </small>
                </div>
              </div>
              <Panel title="Geometry">
                <dl>
                  <dt>Vertices (triangle soup)</dt>
                  <dd>{number(stats.vertices)}</dd>
                  <dt>Triangles</dt>
                  <dd>{number(stats.triangles)}</dd>
                  <dt>Bounds (mm)</dt>
                  <dd>{stats.size.map(number).join(" × ")}</dd>
                  <dt>Surface area (mm²)</dt>
                  <dd>{number(stats.area)}</dd>
                  <dt>Volume estimate (mm³)</dt>
                  <dd>{number(stats.volume)}</dd>
                </dl>
                <p className="muted">
                  Volume assumes a closed, consistently oriented mesh.
                </p>
              </Panel>
              <Panel title="Display">
                <label className="slider-row">
                  <span>Opacity</span>
                  <input
                    aria-label="Opacity"
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={selected.opacity}
                    onChange={(e) =>
                      updateSelected({ opacity: Number(e.target.value) })
                    }
                  />
                  <output>{selected.opacity.toFixed(2)}</output>
                </label>
                <div className="display-row">
                  <span>Shading</span>
                  <div className="segmented">
                    <button
                      className={!wireframe ? "active" : ""}
                      onClick={() => setWireframe(false)}
                    >
                      Shaded
                    </button>
                    <button
                      className={wireframe ? "active" : ""}
                      onClick={() => setWireframe(true)}
                    >
                      Wireframe
                    </button>
                  </div>
                </div>
                <label className="color-field">
                  Object color
                  <input
                    aria-label="Object color"
                    type="color"
                    value={selected.color}
                    onChange={(e) => updateSelected({ color: e.target.value })}
                  />
                </label>
              </Panel>
              <Panel title="Transform">
                <VectorField
                  label="Move (mm)"
                  value={translation}
                  onChange={setTranslation}
                />
                <VectorField
                  label="Rotate (°)"
                  value={rotation}
                  onChange={setRotation}
                />
                <Field
                  label="Uniform scale"
                  value={scale}
                  min={0.001}
                  step={0.1}
                  onChange={setScale}
                />
                <button
                  className="wide"
                  disabled={busy}
                  onClick={applyTransform}
                >
                  Apply transform
                </button>
                {selected.kernelId && (
                  <p className="muted">
                    Exact CAD transforms preserve STEP export.
                  </p>
                )}
              </Panel>
              <Panel title="Cross section">
                <label className="select-field">
                  Axis
                  <select
                    aria-label="Section axis"
                    value={axis}
                    onChange={(e) => setAxis(e.target.value as "x" | "y" | "z")}
                  >
                    <option value="x">X (YZ plane)</option>
                    <option value="y">Y (XZ plane)</option>
                    <option value="z">Z (XY plane)</option>
                  </select>
                </label>
                <Field
                  label="Offset (mm)"
                  value={offset}
                  step={0.5}
                  onChange={setOffset}
                />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={mode === "section"}
                    onChange={(e) =>
                      setMode(e.target.checked ? "section" : "inspect")
                    }
                  />
                  Show cross section
                </label>
                {mode === "section" && (
                  <>
                    <p className="muted">
                      {section.segments.length / 6} segments · total{" "}
                      {number(section.length)} mm
                    </p>
                    <button
                      className="wide"
                      disabled={!section.segments.length}
                      onClick={() => {
                        const rows = ["x1,y1,z1,x2,y2,z2"];
                        for (let i = 0; i < section.segments.length; i += 6)
                          rows.push(section.segments.slice(i, i + 6).join(","));
                        download(rows.join("\n"), "section.csv", "text/csv");
                      }}
                    >
                      Export section CSV
                    </button>
                  </>
                )}
              </Panel>
              <Panel title="Surface fitting">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={localFit}
                    onChange={(e) => setLocalFit(e.target.checked)}
                  />
                  Fit a local region
                </label>
                {localFit && (
                  <>
                    <Field
                      label="Region radius (mm)"
                      value={fitRadius}
                      min={0.01}
                      step={1}
                      onChange={setFitRadius}
                    />
                    <p className="muted">
                      {anchor
                        ? `Anchor: ${anchor.map(number).join(", ")}`
                        : "Click a surface in Inspect mode to anchor the region."}
                    </p>
                  </>
                )}
                {fit ? (
                  <>
                    <dl>
                      <dt>Surface</dt>
                      <dd>{fit.kind}</dd>
                      <dt>RMS residual</dt>
                      <dd>{number(fit.rms)} mm</dd>
                      <dt>Maximum residual</dt>
                      <dd>{number(fit.maxError)} mm</dd>
                      {fit.radius && (
                        <>
                          <dt>Radius</dt>
                          <dd>{number(fit.radius)} mm</dd>
                        </>
                      )}
                    </dl>
                    <Field
                      label="Color tolerance (mm)"
                      value={tolerance}
                      min={0.001}
                      step={0.1}
                      onChange={(n) => setTolerance(Math.max(0.001, n))}
                    />
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={showDeviation}
                        onChange={(e) => setShowDeviation(e.target.checked)}
                      />
                      Show signed deviation
                    </label>
                    <button
                      className="wide accent"
                      disabled={busy}
                      onClick={materializeFit}
                    >
                      Create fitted {fit.kind}
                    </button>
                    <p className="muted">
                      Analytical surface distances; cylinder fitting requires a
                      sampled side surface. Color map covers the entire object.
                    </p>
                  </>
                ) : (
                  <p className="muted">
                    Select a scan and fit a plane, sphere or cylinder from the
                    toolbar. Fits report residuals; review them before creating
                    CAD.
                  </p>
                )}
                <button
                  className="wide"
                  disabled={busy}
                  onClick={() =>
                    void action("Removing degenerate triangles…", () => {
                      const positions = cleanupMesh(selected.positions);
                      validatePositions(positions);
                      updateSelected({
                        positions,
                        kind: "mesh",
                        kernelId: undefined,
                        brep: undefined,
                      });
                      setMessage(
                        `Removed ${(selected.positions.length - positions.length) / 9} degenerate triangles · mesh result`,
                      );
                    })
                  }
                >
                  Remove degenerate triangles
                </button>
              </Panel>
              <SolidTools
                entities={entities}
                selected={selected}
                busy={busy}
                onBoolean={boolean}
                onExtrude={extrude}
              />
            </>
          ) : (
            <div className="empty-inspector">
              Select an object to inspect its geometry.
            </div>
          )}
        </aside>
      </main>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      <footer className="statusbar">
        <span className={busy ? "status-dot busy" : "status-dot"} />
        <span aria-live="polite">{message}</span>
        <span className="save-state">
          {dirty ? "Unsaved changes" : "Project unchanged"}
        </span>
        <span className="status-end">
          Units: mm <span>Browser-local</span>
        </span>
      </footer>
      {primitiveDialog && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="primitive-title"
          >
            <div className="modal-title">
              <h2 id="primitive-title">Add exact CAD primitive</h2>
              <button
                aria-label="Close primitive dialog"
                disabled={busy}
                onClick={() => setPrimitiveDialog(false)}
              >
                <X size={18} />
              </button>
            </div>
            <label className="select-field">
              Shape
              <select
                aria-label="Primitive shape"
                value={primitiveKind}
                onChange={(e) =>
                  setPrimitiveKind(e.target.value as typeof primitiveKind)
                }
              >
                <option value="box">Box</option>
                <option value="sphere">Sphere</option>
                <option value="cylinder">Cylinder</option>
              </select>
            </label>
            <VectorField
              label="Center (mm)"
              value={center}
              onChange={setCenter}
            />
            {primitiveKind === "box" ? (
              <VectorField label="Size (mm)" value={size} onChange={setSize} />
            ) : (
              <Field
                label="Radius (mm)"
                value={radius}
                min={0.001}
                step={1}
                onChange={setRadius}
              />
            )}{" "}
            {primitiveKind === "cylinder" && (
              <Field
                label="Height (mm)"
                value={height}
                min={0.001}
                onChange={setHeight}
              />
            )}
            <p className="muted">
              Creates a solid in the local OpenCascade kernel. Cylinders are
              aligned to the Z axis.
            </p>
            <button
              className="wide accent"
              disabled={busy}
              onClick={() =>
                void action("Loading CAD kernel and creating solid…", () =>
                  addPrimitive(
                    primitiveKind === "box"
                      ? { kind: "box", center, size }
                      : primitiveKind === "sphere"
                        ? { kind: "sphere", center, radius }
                        : {
                            kind: "cylinder",
                            center,
                            axis: [0, 0, 1],
                            radius,
                            height,
                          },
                    `${primitiveKind[0].toUpperCase() + primitiveKind.slice(1)} solid`,
                  ),
                )
              }
            >
              {busy ? "Working…" : "Create solid"}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
