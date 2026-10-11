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
  Settings,
  Trash2,
  Triangle,
  Undo2,
  X,
} from "lucide-react";
import { CadClient } from "../cad/client";
import { changeLabel, type Revision } from "../history";
import { Ribbon } from "./Ribbon";
import {
  SpaceMouseController,
  DEFAULT_SPACE_MOUSE,
  type HidAccess,
  type SpaceMousePreferences,
} from "../spacemouse";
import {
  selectTriangles,
  partitionTriangles,
  selectionCount,
} from "../selection";
import { fittedPrimitive } from "../fitted-primitive";
import {
  alignPrincipalAxes,
  cleanupMesh,
  deviations,
  fitCylinder,
  fitCone,
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
  parseProject,
  serializeProjectBlob,
  validatePositions,
} from "../io";
import { importScan } from "../import-client";
import type { ScanSource } from "../import-parser";
import type { RegionClassification } from "../mesh-processing";
import { readTheme, resolveTheme, storeTheme, type Theme } from "../theme";
import { demonstrationBracket } from "../sample";
import type {
  Entity,
  FitResult,
  KernelPrimitive,
  KernelMesh,
  Vec3,
} from "../types";
import { Viewport } from "../viewport";
import { Field, Panel, VectorField } from "./controls";
import { SolidTools } from "./SolidTools";
import { SurfaceTools } from "./SurfaceTools";
import { SketchTools } from "./SketchTools";
import { MeshTools } from "./MeshTools";
import { AdvancedCadTools } from "./AdvancedCadTools";
import { tessellatePatch, type NurbsPatch } from "../surfaces";
import { rectangleSketch, type Sketch } from "../sketch";

const number = (n: number) =>
  n.toLocaleString("en", { maximumFractionDigits: 3 });
type Mode = "inspect" | "measure" | "section" | "brush";
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function App() {
  const [entities, setEntities] = useState<Entity[]>(() => [
    demonstrationBracket(),
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => entities[0]?.id ?? null,
  );
  const [name, setName] = useState("Untitled project");
  const [mode, setMode] = useState<Mode>("inspect");
  const [workspace, setWorkspace] = useState("measure");
  const [ribbonTab, setRibbonTab] = useState("main");
  const [toolPanelOpen, setToolPanelOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewImport, setPreviewImport] = useState(false);
  const [sketchDraft, setSketchDraft] = useState<Sketch>(() =>
    rectangleSketch(),
  );
  const [spaceMouseStatus, setSpaceMouseStatus] = useState("Disconnected");
  const [spaceMousePreferences, setSpaceMousePreferences] =
    useState<SpaceMousePreferences>({ ...DEFAULT_SPACE_MOUSE });
  const spaceMouse = useRef<SpaceMouseController | null>(null);
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(theme));
  const [dragging, setDragging] = useState(false);
  const importAbort = useRef<AbortController | null>(null);
  const [actionBusy, setBusy] = useState(false);
  const [processingBusy, setProcessingBusy] = useState(false);
  const busy = actionBusy || processingBusy;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [message, setMessage] = useState(
    "Ready · demonstration geometry loaded",
  );
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [triangleMask, setTriangleMask] = useState<Uint8Array | null>(null);
  const [brushRadius, setBrushRadius] = useState(8);
  const [subtractBrush, setSubtractBrush] = useState(false);
  const brushRef = useRef<{
    entity: Entity | undefined;
    radius: number;
    subtract: boolean;
  }>({ entity: undefined, radius: 8, subtract: false });
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
    "box" | "sphere" | "cylinder" | "cone"
  >("box");
  const [size, setSize] = useState<Vec3>([30, 30, 30]);
  const [radius, setRadius] = useState(15);
  const [topRadius, setTopRadius] = useState(0);
  const [height, setHeight] = useState(30);
  const [center, setCenter] = useState<Vec3>([0, 0, 15]);
  const [history, setHistory] = useState<Revision[]>([]);
  const [future, setFuture] = useState<Revision[]>([]);
  const operationLabel = useRef<string | null>(null);
  const viewportHost = useRef<HTMLDivElement>(null);
  const viewport = useRef<Viewport | null>(null);
  const cad = useRef<CadClient | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const knownKernelIds = useRef(new Set<string>());
  const selected = entities.find((e) => e.id === selectedId);
  brushRef.current = {
    entity: selected,
    radius: brushRadius,
    subtract: subtractBrush,
  };
  const selectedTriangleCount = useMemo(
    () => (triangleMask ? selectionCount(triangleMask) : 0),
    [triangleMask],
  );
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
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolveTheme(theme);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      setResolvedTheme(resolved);
      viewport.current?.setTheme(resolved);
    };
    storeTheme(theme);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    cad.current = new CadClient();
    try {
      viewport.current = new Viewport(
        viewportHost.current!,
        (point, id) => {
          if (busyRef.current) return;
          setSelectedId(id);
          if (modeRef.current === "brush") {
            const brush = brushRef.current;
            if (brush.entity?.id === id)
              setTriangleMask((previous) =>
                selectTriangles(
                  brush.entity!.positions,
                  point,
                  brush.radius,
                  previous ?? undefined,
                  brush.subtract ? "remove" : "add",
                ),
              );
          } else if (modeRef.current === "measure")
            setMeasure((previous) =>
              previous.length === 1 ? [previous[0], point] : [point],
            );
          else setAnchor(point);
        },
        (id) => {
          if (!busyRef.current) setSelectedId(id);
        },
      );
      viewport.current.setTheme(resolveTheme(theme));
      spaceMouse.current = new SpaceMouseController(
        (navigator as Navigator & { hid?: HidAccess }).hid,
        (motion, seconds) => viewport.current?.navigate(motion, seconds),
        (action) =>
          action === "fit"
            ? viewport.current?.fitView()
            : viewport.current?.setView("iso"),
        setSpaceMouseStatus,
      );
    } catch (e) {
      setError(`WebGL unavailable: ${errorText(e)}`);
    }
    const unload = (event?: PageTransitionEvent) => {
      if (!event?.persisted) {
        importAbort.current?.abort();
        cad.current?.dispose();
        viewport.current?.dispose();
        void spaceMouse.current
          ?.dispose()
          .catch((error) =>
            setError(`SpaceMouse cleanup: ${errorText(error)}`),
          );
      }
    };
    window.addEventListener("pagehide", unload);
    return () => {
      window.removeEventListener("pagehide", unload);
      unload();
    };
  }, []);
  useEffect(() => {
    if (spaceMouse.current)
      spaceMouse.current.preferences = spaceMousePreferences;
  }, [spaceMousePreferences]);
  useEffect(() => {
    viewport.current?.setEntities(entities, selectedId);
  }, [entities, selectedId]);
  useEffect(() => {
    viewport.current?.setWireframe(wireframe);
  }, [wireframe]);
  useEffect(() => {
    viewport.current?.setBrush(mode === "brush");
  }, [mode]);
  useEffect(() => {
    setTriangleMask(null);
  }, [selectedId, selected?.positions]);
  useEffect(() => {
    viewport.current?.setTriangleSelection(
      selected?.positions,
      triangleMask ?? undefined,
    );
  }, [selected?.positions, triangleMask]);
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
      [
        ...entities,
        ...history.flatMap((revision) => revision.entities),
        ...future.flatMap((revision) => revision.entities),
      ].flatMap((e) => (e.kernelId ? [e.kernelId] : [])),
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
    const label =
      operationLabel.current?.replace(/…$/, "") ?? changeLabel(entities, next);
    setHistory((previous) => [...previous.slice(-19), { entities, label }]);
    setFuture([]);
    setEntities(next);
    setDirty(true);
  }
  function updateSelected(patch: Partial<Entity>) {
    // Geometry edits invalidate authoring data unless they explicitly rebuild it.
    if (patch.positions && !("surfacePatch" in patch))
      patch = { ...patch, surfacePatch: undefined, surfaceScanId: undefined };
    if (patch.positions && !("fit" in patch))
      patch = { ...patch, fit: undefined };
    if (selected)
      commit(
        entities.map((e) => (e.id === selected.id ? { ...e, ...patch } : e)),
      );
  }
  function undo() {
    if (history.length) {
      const next = history[history.length - 1];
      setFuture((p) => [{ entities, label: next.label }, ...p]);
      setEntities(next.entities);
      setSelectedId(
        next.entities.some((entity) => entity.id === selectedId)
          ? selectedId
          : (next.entities[0]?.id ?? null),
      );
      setHistory((p) => p.slice(0, -1));
      setDirty(true);
      setMessage(`Undid ${next.label}`);
    }
  }
  function redo() {
    if (future.length) {
      const next = future[0];
      setHistory((p) => [...p.slice(-19), { entities, label: next.label }]);
      setEntities(next.entities);
      setSelectedId(
        next.entities.some((entity) => entity.id === selectedId)
          ? selectedId
          : (next.entities[0]?.id ?? null),
      );
      setFuture((p) => p.slice(1));
      setDirty(true);
      setMessage(`Redid ${next.label}`);
    }
  }
  function restoreRevision(index: number) {
    if (busy || index < 0 || index >= history.length) return;
    const target = history[index];
    const undone = history.slice(index);
    const redoStates = undone.map((revision, i) => ({
      entities: i + 1 < undone.length ? undone[i + 1].entities : entities,
      label: revision.label,
    }));
    setEntities(target.entities);
    setSelectedId(
      target.entities.some((entity) => entity.id === selectedId)
        ? selectedId
        : (target.entities[0]?.id ?? null),
    );
    setFuture([...redoStates, ...future]);
    setHistory(history.slice(0, index));
    setDirty(true);
    setMessage(`Restored model before ${target.label}`);
  }
  function showTools(nextWorkspace: string) {
    setWorkspace(nextWorkspace);
    setToolPanelOpen(true);
  }
  function autoAlign() {
    void action("Aligning principal axes…", () => {
      if (!selected || selected.kernelId)
        throw new Error("Select a scan mesh for principal-axis alignment.");
      updateSelected({
        positions: alignPrincipalAxes(selected.positions).positions,
      });
      setMessage(
        "Scan aligned to principal axes · review symmetric parts manually",
      );
      requestAnimationFrame(() => viewport.current?.fitView());
    });
  }
  function removeDegenerate() {
    void action("Removing degenerate triangles…", () => {
      if (!selected) return;
      const positions = cleanupMesh(selected.positions);
      validatePositions(positions);
      updateSelected({
        positions,
        kind: "mesh",
        kernelId: undefined,
        brep: undefined,
      });
      setMessage(
        `Removed ${(selected.positions.length - positions.length) / 9} degenerate triangles`,
      );
    });
  }
  function deleteSelected() {
    if (!selected) return;
    commit(entities.filter((entity) => entity.id !== selected.id));
    setSelectedId(null);
    setMeasure([]);
    setMessage("Object deleted");
  }
  function exportMesh() {
    void action("Exporting mesh…", () => {
      download(
        exportStl(entities.filter((entity) => entity.visible)) as BlobPart,
        "scanforge.stl",
      );
      setMessage("Visible objects exported to STL");
    });
  }
  async function action(label: string, run: () => Promise<void> | void) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage(label);
    operationLabel.current = label;
    try {
      await run();
    } catch (e) {
      setError(errorText(e));
      setMessage("Operation failed");
    } finally {
      operationLabel.current = null;
      setBusy(false);
    }
  }
  async function openFile(file: File) {
    await action(`Opening ${file.name}…`, async () => {
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
          setSketchDraft(project.authoring?.sketch ?? rectangleSketch());
          setHistory([]);
          setFuture([]);
          setDirty(false);
          setMeasure([]);
        } catch (e) {
          restoredCad.dispose();
          throw e;
        }
      } else {
        let entity: Entity;
        if (["step", "stp", "iges", "igs", "brep"].includes(extension)) {
          const data = await file.arrayBuffer();
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
        } else {
          const controller = new AbortController();
          importAbort.current = controller;
          let positions;
          let scanSource: ScanSource | undefined;
          try {
            positions = await importScan(file, {
              previewTriangles: previewImport ? 250_000 : undefined,
              onSource: (source) => {
                scanSource = source;
              },
              signal: controller.signal,
              onProgress: (progress) =>
                setMessage(
                  `Opening ${file.name} · ${Math.round(progress * 100)}%`,
                ),
            });
          } finally {
            importAbort.current = null;
          }
          entity = {
            id: crypto.randomUUID(),
            name:
              file.name +
              (scanSource &&
              scanSource.displayedTriangles < scanSource.triangles
                ? " [sampled preview]"
                : ""),
            kind: "mesh",
            positions,
            color: "#5b9ed9",
            visible: true,
            opacity: 1,
            source: file.name,
            scanSource,
          };
        }
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
  function editSelection(operation: "copy" | "cut" | "delete") {
    if (!selected || !triangleMask || !selectedTriangleCount) return;
    const { selected: picked, remainder } = partitionTriangles(
      selected.positions,
      triangleMask,
    );
    let next = [...entities];
    if (operation !== "copy")
      next = next.flatMap((entity) =>
        entity.id !== selected.id
          ? [entity]
          : remainder.length
            ? [
                {
                  ...entity,
                  positions: remainder,
                  kind: "mesh" as const,
                  kernelId: undefined,
                  brep: undefined,
                  surfacePatch: undefined,
                  surfaceScanId: undefined,
                  fit: undefined,
                },
              ]
            : [],
      );
    if (operation !== "delete") {
      const created: Entity = {
        ...selected,
        id: crypto.randomUUID(),
        name: `${selected.name} selection`,
        kind: "mesh",
        positions: picked,
        kernelId: undefined,
        brep: undefined,
        surfacePatch: undefined,
        surfaceScanId: undefined,
        fit: undefined,
      };
      next.push(created);
      setSelectedId(created.id);
    } else if (!remainder.length) setSelectedId(next[0]?.id ?? null);
    operationLabel.current = `${operation === "copy" ? "Copy" : operation === "cut" ? "Cut" : "Delete"} ${selectedTriangleCount} triangles`;
    commit(next);
    operationLabel.current = null;
    setTriangleMask(null);
    setMessage(
      `${selectedTriangleCount} triangles ${operation === "delete" ? "deleted" : operation === "copy" ? "copied" : "cut"}`,
    );
  }
  function runFit(kind: "plane" | "sphere" | "cylinder" | "cone") {
    setWorkspace("reconstruct");
    setToolPanelOpen(true);
    void action(`Fitting ${kind}…`, () => {
      if (!selected) throw new Error("Select an object first.");
      if (localFit) {
        if (!anchor)
          throw new Error(
            "Click the scan in Inspect mode to place the fitting region.",
          );
        if (fitRadius <= 0) throw new Error("Region radius must be positive.");
      }
      const source = selected.positions;
      const eligible = (i: number) =>
        (!selectedTriangleCount || !!triangleMask?.[Math.floor(i / 9)]) &&
        (!localFit ||
          (anchor !== null &&
            Math.hypot(
              source[i] - anchor[0],
              source[i + 1] - anchor[1],
              source[i + 2] - anchor[2],
            ) <= fitRadius));
      let count = 0;
      for (let i = 0; i < source.length; i += 3) if (eligible(i)) count++;
      const stride = Math.max(1, Math.ceil(count / 20_000));
      const positions: number[] = [];
      let eligibleIndex = 0;
      for (let i = 0; i < source.length; i += 3)
        if (eligible(i) && eligibleIndex++ % stride === 0)
          positions.push(source[i], source[i + 1], source[i + 2]);
      const fitted =
        kind === "plane"
          ? fitPlane(positions)
          : kind === "sphere"
            ? fitSphere(positions)
            : kind === "cylinder"
              ? fitCylinder(positions)
              : fitCone(positions);
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
      } else await addPrimitive(fittedPrimitive(fit), `Fitted ${fit.kind}`);
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
  function createMesh(
    positions: Float32Array,
    label: string,
    surfacePatch?: NurbsPatch,
  ) {
    validatePositions(positions);
    const entity: Entity = {
      id: crypto.randomUUID(),
      name: label,
      kind: "mesh",
      positions,
      color: "#78a8db",
      opacity: 1,
      visible: true,
      surfacePatch,
      surfaceScanId: surfacePatch ? selected?.id : undefined,
    };
    commit([...entities, entity]);
    setSelectedId(entity.id);
    setMessage(`${label} created`);
  }
  function editSurface(patch: NurbsPatch) {
    void action("Editing NURBS control grid…", () => {
      const positions = tessellatePatch(patch, 32, 32);
      if (selected?.surfacePatch)
        updateSelected({
          positions,
          surfacePatch: patch,
          kind: "mesh",
          kernelId: undefined,
          brep: undefined,
        });
      else createMesh(positions, "NURBS surface", patch);
      setMessage("NURBS patch updated · control grid retained in project");
    });
  }
  function createSegments(
    parts: Float32Array[],
    label: string,
    classifications?: RegionClassification[],
  ) {
    const created = parts
      .filter((positions) => positions.length)
      .map((positions, index): Entity => ({
        id: crypto.randomUUID(),
        name: `${label} ${index + 1}${classifications?.[index] ? ` · ${classifications[index].kind === "freeform" ? "unclassified" : classifications[index].kind}` : ""}`,
        kind: "mesh",
        positions,
        fit: classifications?.[index]?.fit,
        color: `#${new THREE.Color().setHSL((index * 0.618) % 1, 0.5, 0.58).getHexString()}`,
        opacity: 1,
        visible: true,
      }));
    if (!created.length) throw new Error("Segmentation produced no meshes.");
    operationLabel.current = `${label} (${created.length} meshes)`;
    commit([
      ...entities.map((entity) =>
        entity.id === selected?.id ? { ...entity, visible: false } : entity,
      ),
      ...created,
    ]);
    operationLabel.current = null;
    setSelectedId(created[0].id);
    setMessage(`Created ${created.length} segmented meshes`);
  }
  function cadOperation(
    label: string,
    run: () => Promise<KernelMesh>,
    patch?: NurbsPatch,
  ) {
    void action(label, async () => {
      const result = await run();
      const entity: Entity = {
        ...result,
        id: crypto.randomUUID(),
        name: label.replace(/…$/, ""),
        kind: "cad",
        color: "#78a8db",
        opacity: 1,
        visible: true,
        surfacePatch: patch,
      };
      commit([...entities, entity]);
      setSelectedId(entity.id);
      setMessage(`${entity.name} created as exact CAD`);
    });
  }
  function save() {
    void action("Saving project…", async () => {
      download(
        await serializeProjectBlob(name, entities, { sketch: sketchDraft }),
        `${name.replace(/[^a-z0-9-_ ]/gi, "_")}.scanforge`,
        "application/json",
      );
      setDirty(false);
      setMessage("Project downloaded · exact CAD retained where available");
    });
  }
  function revolve(points: [number, number][], angle: number) {
    void action("Revolving profile…", async () => {
      const result = await cad.current!.revolve(points, angle);
      const entity: Entity = {
        id: crypto.randomUUID(),
        name: "Revolved solid",
        kind: "cad",
        ...result,
        color: "#78a8db",
        visible: true,
        opacity: 1,
      };
      commit([...entities, entity]);
      setSelectedId(entity.id);
      setMessage("Profile revolved to exact CAD");
      requestAnimationFrame(() => viewport.current?.fitView());
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
    <div
      className="workbench"
      data-workspace={workspace}
      data-panel-open={toolPanelOpen}
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file && !busy) void openFile(file);
      }}
    >
      <header className="header">
        <div className="brand">
          <div className="brand-mark">SF</div>
          <div className="brand-copy">
            <span>ScanForge</span>
            <small>SCAN TO CAD · 0.1</small>
          </div>
        </div>
        <div className="header-actions">
          <button
            title="Undo"
            aria-label="Undo"
            disabled={busy || !history.length}
            onClick={undo}
          >
            <Undo2 size={16} />
          </button>
          <button
            title="Redo"
            aria-label="Redo"
            disabled={busy || !future.length}
            onClick={redo}
          >
            <Redo2 size={16} />
          </button>
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
          <button
            aria-label="Object properties"
            title="Object properties"
            onClick={() => setToolPanelOpen(!toolPanelOpen)}
          >
            <Crosshair size={17} />
          </button>
          <button
            aria-label="Settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={17} />
          </button>
        </div>
      </header>
      <Ribbon
        activeTab={ribbonTab}
        onTabChange={setRibbonTab}
        disabled={busy}
        hasSelection={!!selected}
        canUndo={!!history.length}
        canRedo={!!future.length}
        actions={{
          open: () => fileInput.current?.click(),
          save,
          undo,
          redo,
          fitView: () => viewport.current?.fitView(),
          iso: () => viewport.current?.setView("iso"),
          top: () => viewport.current?.setView("top"),
          bottom: () => viewport.current?.setView("bottom"),
          left: () => viewport.current?.setView("left"),
          right: () => viewport.current?.setView("right"),
          front: () => viewport.current?.setView("front"),
          back: () => viewport.current?.setView("back"),
          fitPlane: () => runFit("plane"),
          fitSphere: () => runFit("sphere"),
          fitCylinder: () => runFit("cylinder"),
          fitCone: () => runFit("cone"),
          primitive: () => setPrimitiveDialog(true),
          align: autoAlign,
          transform: () => showTools("mesh"),
          section: () => {
            setMode("section");
            showTools("section");
          },
          extrude: () => showTools("reconstruct"),
          revolve: () => showTools("reconstruct"),
          boolean: () => showTools("reconstruct"),
          measure: () => {
            setMode("measure");
            setMeasure([]);
            showTools("measure");
          },
          deviation: () => showTools("deviation"),
          area: () => showTools("measure"),
          volume: () => showTools("measure"),
          cleanup: removeDegenerate,
          delete: deleteSelected,
          exportStep,
          exportStl: exportMesh,
          settings: () => setSettingsOpen(true),
          editScan: () => {
            setMode("brush");
            showTools("mesh");
          },
          select: () => {
            setMode("brush");
            showTools("mesh");
          },
          wireframe: () => setWireframe(!wireframe),
          objectColor: () => showTools("mesh"),
          loft: () => showTools("advancedCad"),
          sweep: () => showTools("advancedCad"),
          fillet: () => showTools("advancedCad"),
          chamfer: () => showTools("advancedCad"),
          surfaceOffset: () => showTools("advancedCad"),
          sewSurfaces: () => showTools("advancedCad"),
          shell: () => showTools("advancedCad"),
          surfaceThicken: () => showTools("advancedCad"),
          fitSurface: () => showTools("surface"),
          nurbsSurface: () => showTools("surface"),
          newFreeform: () => showTools("surface"),
          autoFreeform: () => showTools("surface"),
          quadObj: () => showTools("surface"),
          sketch2d: () => showTools("sketch"),
          reducePolygons: () => showTools("processing"),
          reduceNoise: () => showTools("processing"),
          fineAlign: () => showTools("processing"),
          alignNPoints: () => showTools("processing"),
          repairMesh: () => showTools("processing"),
          segmentMesh: () => showTools("processing"),
          splitSolid: () => showTools("advancedCad"),
          circularPattern: () => showTools("advancedCad"),
          linearPattern: () => showTools("advancedCad"),
          mirrorBody: () => showTools("advancedCad"),
        }}
      />
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
      <main className="workspace">
        <aside className="explorer" inert={busy}>
          <div className="objects-panel">
            <h2>
              Objects <Layers size={15} />
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
                          e.id === entity.id
                            ? { ...e, visible: !e.visible }
                            : e,
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
          </div>
          <section className="history-panel" aria-label="Model history">
            <div className="history-heading">
              <h2>History</h2>
              <div>
                <button
                  aria-label="Undo history"
                  title="Undo"
                  disabled={busy || !history.length}
                  onClick={undo}
                >
                  <Undo2 size={14} />
                </button>
                <button
                  aria-label="Redo history"
                  title="Redo"
                  disabled={busy || !future.length}
                  onClick={redo}
                >
                  <Redo2 size={14} />
                </button>
              </div>
            </div>
            <ol className="history-list">
              <li>
                <button
                  disabled={busy || !history.length}
                  onClick={() => restoreRevision(0)}
                >
                  <Layers size={14} />
                  <span>Initial state</span>
                </button>
              </li>
              {history.map((revision, index) => (
                <li key={index}>
                  <button
                    title={`Restore model after ${revision.label}`}
                    aria-current={
                      index === history.length - 1 ? "step" : undefined
                    }
                    disabled={busy}
                    onClick={() => {
                      if (index + 1 < history.length)
                        restoreRevision(index + 1);
                    }}
                  >
                    <Box size={14} />
                    <span>{revision.label}</span>
                  </button>
                </li>
              ))}
              {future.map((revision, index) => (
                <li key={`future-${index}`} className="future-revision">
                  <span>{revision.label}</span>
                </li>
              ))}
              <li className="end-of-model">End of model</li>
            </ol>
            <p className="history-note">
              {history.length} undo steps · session history
            </p>
          </section>
        </aside>
        <section className="canvas-area" aria-label="3D viewport">
          <div ref={viewportHost} className="viewport" />
          {dragging && (
            <div className="drop-overlay">Drop a scan or CAD file to open</div>
          )}
          {busy && importAbort.current && (
            <div className="import-progress">
              <span>{message}</span>
              <button onClick={() => importAbort.current?.abort()}>
                Cancel import
              </button>
            </div>
          )}
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
            {mode === "brush"
              ? "Drag on the scan to brush triangles · right-drag to pan"
              : mode === "measure"
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
        <aside
          className="inspector"
          inert={actionBusy}
          aria-label="Tool options"
        >
          <h2>
            Tool options{" "}
            <button
              aria-label="Close tool options"
              onClick={() => setToolPanelOpen(false)}
            >
              <X size={15} />
            </button>
          </h2>
          {selected && stats ? (
            <>
              <div inert={processingBusy}>
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
                <Panel title="Edit scan" className="scan-panel">
                  <div className="button-row">
                    <button
                      className={mode === "brush" ? "active" : ""}
                      onClick={() => setMode("brush")}
                    >
                      Brush selection
                    </button>
                    <button onClick={() => setMode("inspect")}>Orbit</button>
                  </div>
                  <Field
                    label="Brush radius (mm)"
                    value={brushRadius}
                    onChange={(value) => setBrushRadius(Math.max(0.01, value))}
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={subtractBrush}
                      onChange={(event) =>
                        setSubtractBrush(event.target.checked)
                      }
                    />
                    Subtract from selection
                  </label>
                  <p>{number(selectedTriangleCount)} selected triangles</p>
                  <div className="button-row">
                    <button
                      onClick={() =>
                        setTriangleMask(
                          new Uint8Array(selected.positions.length / 9).fill(1),
                        )
                      }
                    >
                      Select all
                    </button>
                    <button onClick={() => setTriangleMask(null)}>Clear</button>
                    <button
                      onClick={() =>
                        setTriangleMask(
                          Uint8Array.from(
                            { length: selected.positions.length / 9 },
                            (_, index) => (triangleMask?.[index] ? 0 : 1),
                          ),
                        )
                      }
                    >
                      Invert
                    </button>
                  </div>
                  <div className="button-row">
                    <button
                      disabled={!selectedTriangleCount}
                      onClick={() => editSelection("copy")}
                    >
                      Copy &amp; Create
                    </button>
                    <button
                      disabled={!selectedTriangleCount}
                      onClick={() => editSelection("cut")}
                    >
                      Cut &amp; Create
                    </button>
                  </div>
                  <button
                    disabled={!selectedTriangleCount}
                    onClick={() => editSelection("delete")}
                  >
                    Delete selected triangles
                  </button>
                  {selected.kernelId && (
                    <p className="muted">
                      Triangle edits create a mesh result.
                    </p>
                  )}
                </Panel>
                <Panel title="Geometry" className="geometry-panel">
                  {selected.fit && (
                    <p className="muted">
                      {selected.fit.kind} fit · RMS {number(selected.fit.rms)}{" "}
                      mm · maximum residual {number(selected.fit.maxError)} mm.
                      Review fit quality before reconstruction.
                    </p>
                  )}
                  {selected.scanSource &&
                    selected.scanSource.displayedTriangles <
                      selected.scanSource.triangles && (
                      <p role="note" className="muted">
                        Sampled source: {number(selected.scanSource.bytes)}{" "}
                        bytes · {number(selected.scanSource.triangles)} source
                        triangles ·{" "}
                        {number(selected.scanSource.displayedTriangles)}{" "}
                        imported triangles. Operations and exports use sampled
                        geometry, not the complete source.
                      </p>
                    )}
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
                <Panel title="Display" className="display-panel">
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
                      onChange={(e) =>
                        updateSelected({ color: e.target.value })
                      }
                    />
                  </label>
                </Panel>
                <Panel title="Transform" className="transform-panel">
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
                <Panel title="Cross section" className="section-panel">
                  <label className="select-field">
                    Axis
                    <select
                      aria-label="Section axis"
                      value={axis}
                      onChange={(e) =>
                        setAxis(e.target.value as "x" | "y" | "z")
                      }
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
                            rows.push(
                              section.segments.slice(i, i + 6).join(","),
                            );
                          download(rows.join("\n"), "section.csv", "text/csv");
                        }}
                      >
                        Export section CSV
                      </button>
                    </>
                  )}
                </Panel>
                <Panel title="Surface fitting" className="fitting-panel">
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
                        Analytical surface distances; cylinder fitting requires
                        a sampled side surface. Color map covers the entire
                        object.
                      </p>
                    </>
                  ) : (
                    <p className="muted">
                      Select a scan and fit a plane, sphere, cylinder or cone
                      from the tool rail. Fits report residuals; review them
                      before creating CAD.
                    </p>
                  )}
                  <button
                    className="wide mesh-cleanup"
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
                <div className="solid-panels">
                  <SolidTools
                    entities={entities}
                    selected={selected}
                    busy={busy}
                    onBoolean={boolean}
                    onExtrude={extrude}
                    onRevolve={revolve}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="empty-inspector">
              Select an object to inspect its geometry, or create a new surface
              or sketch.
            </div>
          )}
          <div className="surface-panels">
            <SurfaceTools
              key={selected?.id ?? "empty"}
              scan={
                entities.find((entity) => entity.id === selected?.surfaceScanId)
                  ?.positions ?? selected?.positions
              }
              patch={selected?.surfacePatch}
              onPatchChange={editSurface}
              onCreateMesh={(positions, label) => createMesh(positions, label)}
              onExportPatch={(json) =>
                download(
                  json,
                  "surface.scanforge-nurbs.json",
                  "application/json",
                )
              }
              onError={setError}
              disabled={busy}
              onBusyChange={setProcessingBusy}
            />
            <button
              disabled={busy || !selected?.surfacePatch}
              onClick={() =>
                cadOperation(
                  "NURBS CAD face",
                  () => cad.current!.surface(selected!.surfacePatch!),
                  selected?.surfacePatch,
                )
              }
            >
              Create exact NURBS CAD face
            </button>
          </div>
          <div className="sketch-panels">
            <SketchTools
              value={sketchDraft}
              onChange={(sketch) => {
                setSketchDraft(sketch);
                setDirty(true);
              }}
              onExtrude={extrude}
              disabled={busy}
            />
          </div>
          <div className="processing-panels">
            <MeshTools
              entities={entities}
              selected={selected}
              disabled={busy}
              onBusyChange={setProcessingBusy}
              onReplace={(positions, label) => {
                operationLabel.current = label;
                updateSelected({
                  positions,
                  kind: "mesh",
                  kernelId: undefined,
                  brep: undefined,
                  surfacePatch: undefined,
                  surfaceScanId: undefined,
                });
                operationLabel.current = null;
                setMessage(label);
              }}
              onCreateSegments={createSegments}
              onError={setError}
              onStatus={setMessage}
            />
          </div>
          <div className="advanced-cad-panels">
            <AdvancedCadTools
              entities={entities}
              selected={selected}
              disabled={busy}
              onError={setError}
              onLoft={(profiles, ruled) =>
                cadOperation("Loft", () => cad.current!.loft(profiles, ruled))
              }
              onPattern={(pattern) =>
                cadOperation(`${pattern.kind} pattern`, () =>
                  cad.current!.pattern(selected!.kernelId!, pattern),
                )
              }
              onMirror={(origin, normal) =>
                cadOperation("Mirror body", () =>
                  cad.current!.mirror(selected!.kernelId!, origin, normal),
                )
              }
              onSplit={(cutterId) => {
                void action("Splitting solid…", async () => {
                  const cutter = entities.find(
                    (entity) => entity.id === cutterId,
                  );
                  if (!selected?.kernelId || !cutter?.kernelId)
                    throw new Error("Choose two exact CAD bodies.");
                  const results = await cad.current!.split(
                    selected.kernelId,
                    cutter.kernelId,
                  );
                  const created = results.map((result, index): Entity => ({
                    ...result,
                    id: crypto.randomUUID(),
                    name: `Split ${index === 0 ? "inside" : "outside"}`,
                    kind: "cad",
                    color: index === 0 ? "#78a8db" : "#d8a36f",
                    visible: true,
                    opacity: 1,
                  }));
                  commit([
                    ...entities.map((entity) =>
                      entity.id === selected.id || entity.id === cutter.id
                        ? { ...entity, visible: false }
                        : entity,
                    ),
                    ...created,
                  ]);
                  setSelectedId(created[0].id);
                  setMessage("Created exact inside and outside bodies");
                });
              }}
              onSweep={(points, path) =>
                cadOperation("Sweep", () => cad.current!.sweep(points, path))
              }
              onEdges={(indices, amount, operation) =>
                cadOperation(operation, () =>
                  cad.current!.edgeTreatment(
                    selected!.kernelId!,
                    indices,
                    amount,
                    operation,
                  ),
                )
              }
              onOffset={(distance) =>
                cadOperation("Offset", () =>
                  cad.current!.offset(selected!.kernelId!, distance),
                )
              }
              onSew={(ids, tolerance) =>
                cadOperation("Sew surfaces", () =>
                  cad.current!.sew(
                    ids.map(
                      (id) =>
                        entities.find((entity) => entity.id === id)!.kernelId!,
                    ),
                    tolerance,
                  ),
                )
              }
              onShell={(indices, thickness) =>
                cadOperation("Shell", () =>
                  cad.current!.shell(selected!.kernelId!, indices, thickness),
                )
              }
              onThicken={(thickness) =>
                cadOperation("Thicken", () =>
                  cad.current!.thicken(selected!.kernelId!, thickness),
                )
              }
            />
          </div>
        </aside>
      </main>
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-title">
              <h2>Settings</h2>
              <button
                aria-label="Close settings"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <h3>Appearance</h3>
            <p className="muted">
              One theme across the interface and 3D viewport. Remembered on this
              device.
            </p>
            <fieldset className="theme-options">
              <legend>Interface</legend>
              {(["light", "dark", "system"] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="theme"
                    checked={theme === value}
                    onChange={() => setTheme(value)}
                  />
                  {value[0].toUpperCase() + value.slice(1)}
                </label>
              ))}
            </fieldset>
            <p className="muted">
              Current appearance: {resolvedTheme}. System follows your operating
              system.
            </p>
            <h3>Scan import</h3>
            <label>
              <input
                type="checkbox"
                checked={previewImport}
                onChange={(event) => setPreviewImport(event.target.checked)}
              />{" "}
              Memory efficient binary STL preview
            </label>
            <p className="muted">
              Reads and validates every source triangle while displaying up to
              250,000 uniformly sampled triangles. Editing, measurements and
              exports use the sample. Turn this off to import full resolution.
              No file-size limit is imposed.
            </p>
            <h3>SpaceMouse</h3>
            <p className="muted">
              {spaceMouseStatus}. Direct WebHID connection requires Chrome or
              Edge over HTTPS or localhost. Choose the device when the browser
              asks.
            </p>
            <div className="button-row">
              <button
                onClick={() =>
                  void spaceMouse.current
                    ?.connect()
                    .catch((error) => setError(errorText(error)))
                }
              >
                Connect SpaceMouse
              </button>
              <button
                onClick={() =>
                  void spaceMouse.current
                    ?.disconnect()
                    .catch((error) => setError(errorText(error)))
                }
              >
                Disconnect SpaceMouse
              </button>
            </div>
            <Field
              label="Translation sensitivity"
              value={spaceMousePreferences.translationSpeed}
              min={0}
              max={5}
              step={0.1}
              onChange={(translationSpeed) =>
                setSpaceMousePreferences({
                  ...spaceMousePreferences,
                  translationSpeed: Math.max(0, translationSpeed),
                })
              }
            />
            <Field
              label="Rotation sensitivity"
              value={spaceMousePreferences.rotationSpeed}
              min={0}
              max={5}
              step={0.1}
              onChange={(rotationSpeed) =>
                setSpaceMousePreferences({
                  ...spaceMousePreferences,
                  rotationSpeed: Math.max(0, rotationSpeed),
                })
              }
            />
            <Field
              label="SpaceMouse deadzone"
              value={spaceMousePreferences.deadzone}
              min={0}
              max={0.9}
              step={0.01}
              onChange={(deadzone) =>
                setSpaceMousePreferences({
                  ...spaceMousePreferences,
                  deadzone: Math.max(0, Math.min(0.9, deadzone)),
                })
              }
            />
            <label className="check">
              <input
                type="checkbox"
                checked={spaceMousePreferences.dominantAxis}
                onChange={(event) =>
                  setSpaceMousePreferences({
                    ...spaceMousePreferences,
                    dominantAxis: event.target.checked,
                  })
                }
              />
              Dominant axis only
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={spaceMousePreferences.rotationEnabled}
                onChange={(event) =>
                  setSpaceMousePreferences({
                    ...spaceMousePreferences,
                    rotationEnabled: event.target.checked,
                  })
                }
              />
              Enable SpaceMouse rotation
            </label>
          </section>
        </div>
      )}
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
                <option value="cone">Cone / frustum</option>
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
            {primitiveKind === "cone" && (
              <Field
                label="Top radius (mm)"
                value={topRadius}
                min={0}
                step={1}
                onChange={setTopRadius}
              />
            )}
            {(primitiveKind === "cylinder" || primitiveKind === "cone") && (
              <Field
                label="Height (mm)"
                value={height}
                min={0.001}
                onChange={setHeight}
              />
            )}
            <p className="muted">
              Creates a solid in the local OpenCascade kernel. Cylinders and
              cones are aligned to the Z axis.
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
                        : primitiveKind === "cone"
                          ? {
                              kind: "cone",
                              center,
                              axis: [0, 0, 1],
                              radius,
                              topRadius,
                              height,
                            }
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
