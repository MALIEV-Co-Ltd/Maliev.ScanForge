import "./ToolPanel.css";
import { SaveProjectDialog } from "./SaveProjectDialog";
import { ActiveToolHint, StatusMessage, StatusBar } from "./StatusFeedback";
import { linearProgress, type ReductionStatistics } from "../reduction-report";
import { ReductionColorScale } from "./ReductionResults";
import { toleranceCoverage } from "../reduction-display";
import { ModelTimeline } from "./ModelTimeline";
import { ViewportTools } from "./ViewportTools";
import { CanvasError } from "./CanvasError";
import {
  releaseProcessingSession,
  retainProcessingGeometry,
} from "../processing-session";
import { ImportProgress } from "./ImportProgress";
import {
  ScanToolsPanel,
  scanToolTitles,
  type ScanToolId,
  type ScanToolParameters,
} from "./ScanToolsPanel";
import { mirrorReference, cylinderReference } from "../scan-tools-reference";
import { transformPlaneFrame } from "../plane-frame";
import { scanToolRequest } from "./scan-tool-request";
import { scanMeshCopy } from "../scan-mesh-copy";
import { scaledMeshCopy, mirroredMeshCopy } from "../scan-scaled-copy";
import type { ScanBoundaryPath } from "../scan-boundary-edges";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SavedSketch } from "../types";
import type { SketchDrawingTool } from "../sketch-drawing";
import {
  keyboardTargetContext,
  resolveKeyboardShortcut,
  type ShortcutActionId,
  type ShortcutContext,
} from "../keyboard-shortcuts";
import {
  matchesLocalShortcut,
  shortcutPlatform,
  VIEWPORT_VISIBILITY_CATEGORIES,
} from "../shortcut-registry";
import { SketchUndo } from "../sketch-undo";
import { CreateSketchDialog } from "./CreateSketchDialog";
import { SpaceMouseConnection } from "./SpaceMouseConnection";
import { ApplicationVersion } from "./ApplicationVersion";
import { HeaderIconButton } from "./HeaderIconButton";
import { SaveProjectButton } from "./SaveProjectButton";
import "./workspace-chrome.css";
import { CoordinateSystem } from "./OriginControls";
import { SketchPlaneDialog } from "./SketchPlaneDialog";
import { ORIGIN_PLANES, type OriginPlane } from "../origin";
import type { ScanClipBounds } from "../scan-clip-box";
import type { ScanEditRequest } from "../scan-edit";
import { boundarySketches } from "../scan-boundary-sketch";
import { SCAN_TOPOLOGY_TOLERANCE } from "../scan-topology-tolerance";
import { ScanTopologyPanels } from "./ScanTopologyPanels";
import {
  coordinateSketchFrame,
  validateSketchFrame,
  type SketchFrame,
} from "../sketch-frame";
import {
  referenceWorldSegments,
  type SketchSectionOptions,
  type SketchSectionResult,
} from "../sketch-section";
import * as THREE from "three";
import {
  Box,
  Circle,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Layers,
  MousePointer2,
  Plus,
  Ruler,
  ScanLine,
  Settings,
  Trash2,
  Triangle,
  X,
} from "lucide-react";
import {
  DEFAULT_PART_COLOR,
  DEFAULT_FREEFORM_COLOR,
  DEFAULT_REFERENCE_COLOR,
} from "../appearance";
import { exportSectionDxf } from "../section-dxf";
import { processMesh } from "../processing-client";
import { CadClient } from "../cad/client";
import {
  SelectionSession,
  hideRegion,
  maskIndices,
  indicesMask,
  type SelectionState,
} from "../selection-session";
import {
  changeLabel,
  modelChanged,
  restoreModelDisplay,
  seekModelRevision,
  type Revision,
} from "../history";
import { ContextMenu } from "./ContextMenu";
import { Ribbon } from "./Ribbon";
import {
  SpaceMouseController,
  DEFAULT_SPACE_MOUSE,
  type HidAccess,
  type SpaceMousePreferences,
} from "../spacemouse";
import { partitionTriangles, selectionCount } from "../selection";
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
import { ImportUnitsDialog } from "./ImportUnitsDialog";
import { SCAN_UNITS, type ScanUnit } from "../import-units";
import type {
  Entity,
  FitResult,
  KernelPrimitive,
  KernelMesh,
  Vec3,
} from "../types";
import { Viewport } from "../viewport";
import { applyWandRegion } from "../wand-selection";
import { Field, Panel, VectorField } from "./controls";
import { SolidTools } from "./SolidTools";
import { SurfaceTools } from "./SurfaceTools";
import { FitSurfaceDialog } from "./FitSurfaceDialog";
import { fitGridSurfaceAsync } from "../surface-client";
import {
  beginSurfaceFit,
  surfaceFitSourceUnchanged,
  surfaceFitEntity,
  acceptSurfaceFit,
  type SurfaceFitSession,
} from "../surface-fit-session";
import type { SurfaceFitOptions } from "../surfaces";
import { SketchTools } from "./SketchTools";
import { MeshTools } from "./MeshTools";
import { LandmarkAlignmentDialog } from "./LandmarkAlignmentDialog";
import {
  beginLandmarkAlignment,
  pickLandmark,
  landmarkRequest,
  landmarkSceneUnchanged,
  acceptLandmarkAlignment,
  landmarkMarkers,
  type LandmarkAlignment,
} from "../landmark-alignment";
import { EditScanDialog } from "./EditScanDialog";
import { ScanQuickTools } from "./ScanQuickTools";
import { AdvancedCadTools } from "./AdvancedCadTools";
import { ParametricTools } from "./ParametricTools";
import {
  bindFeatureInputs,
  entityFeatureModel,
  entityFeatureState,
} from "../parametric-entities";
import {
  createCadEvaluator,
  rebuildParametric,
  type FeatureRef,
  type ParametricRecipe,
} from "../parametric";
import { tessellatePatch, type NurbsPatch } from "../surfaces";
import { rectangleSketch, type Sketch } from "../sketch";
const number = (n: number) =>
  n.toLocaleString("en", { maximumFractionDigits: 3 });
type Mode = "inspect" | "measure" | "section" | "brush";
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function App() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [pendingScanImport, setPendingScanImport] = useState<File | null>(null);
  const [originVisible, setOriginVisible] = useState(true);
  const [originPlane, setOriginPlane] = useState<OriginPlane>("OXY");
  const [planePicking, setPlanePicking] = useState(false);
  const [sketchPlaneDialog, setSketchPlaneDialog] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => entities[0]?.id ?? null,
  );
  const [name, setName] = useState("Untitled project");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [flatShading, setFlatShading] = useState(true);
  const [floorGrid, setFloorGrid] = useState(true);
  const [gridSpacing, setGridSpacing] = useState(10);
  const [snapGrid, setSnapGrid] = useState(false);
  const [mode, setMode] = useState<Mode>("inspect");
  const [workspace, setWorkspace] = useState("measure");
  const [savedSketches, setSavedSketches] = useState<SavedSketch[]>([]);
  const [activeSketchId, setActiveSketchId] = useState<string | null>(null);
  const sketchUndoSessions = useRef(new Map<string, SketchUndo>());
  const [sketchDrawingTool, setSketchDrawingTool] =
    useState<SketchDrawingTool>("navigate");
  const [sketchDrawingConstraints, setSketchDrawingConstraints] =
    useState(true);
  const [sketchControlPoints, setSketchControlPoints] = useState(true);
  const [sketchMeshPoints, setSketchMeshPoints] = useState(true);
  const [createSketch, setCreateSketch] = useState<{
    source: Entity;
    hidden: number[];
    selection?: Uint8Array;
    preview?: SketchSectionResult;
  } | null>(null);
  const createSketchRef = useRef(createSketch);
  createSketchRef.current = createSketch;
  const sketchSectionAbort = useRef<AbortController | null>(null);
  const legacySketch = useRef<Sketch>(rectangleSketch());
  const [ribbonTab, setRibbonTab] = useState("main");
  const [toolPanelOpen, setToolPanelOpen] = useState(false);
  const [nPoints, setNPoints] = useState<LandmarkAlignment | null>(null);
  const [landmarkPickSide, setLandmarkPickSide] = useState<"moving" | "fixed">(
    "moving",
  );
  const nPointsRef = useRef(nPoints);
  nPointsRef.current = nPoints;
  const landmarkAbort = useRef<AbortController | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newDocumentDialog, setNewDocumentDialog] = useState(false);
  const [previewImport, setPreviewImport] = useState(false);
  const [sketchDraft, setSketchDraft] = useState<Sketch>(() =>
    rectangleSketch(),
  );
  const [spaceMouseStatus, setSpaceMouseStatus] = useState("Disconnected");
  const [spaceMouseConnecting, setSpaceMouseConnecting] = useState(false);
  const [spaceMousePreferences, setSpaceMousePreferences] =
    useState<SpaceMousePreferences>({ ...DEFAULT_SPACE_MOUSE });
  const spaceMouse = useRef<SpaceMouseController | null>(null);
  const updateSpaceMousePreferences = (
    patch: Partial<SpaceMousePreferences>,
  ) => {
    const preferences = { ...spaceMousePreferences, ...patch };
    // Apply in the input event, before the next HID animation frame.
    if (spaceMouse.current) spaceMouse.current.preferences = preferences;
    setSpaceMousePreferences(preferences);
  };
  const connectSpaceMouse = async () => {
    setSpaceMouseConnecting(true);
    try {
      // Keep requestDevice in the button's trusted user activation.
      await spaceMouse.current?.connect();
    } catch (error) {
      setSpaceMouseStatus(`SpaceMouse connection: ${errorText(error)}`);
      setError(errorText(error));
    } finally {
      setSpaceMouseConnecting(false);
    }
  };
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(theme));
  const [dragging, setDragging] = useState(false);
  const importAbort = useRef<AbortController | null>(null);
  const [importProgress, setImportProgress] = useState<{
    name: string;
    fraction: number | null;
  } | null>(null);
  const [actionBusy, setBusy] = useState(false);
  const [processingBusy, setProcessingBusy] = useState(false);
  const [scanTool, setScanTool] = useState<ScanToolId>("reducePolygons");
  const [scanToolProgress, setScanToolProgress] = useState("");
  const [scanToolFraction, setScanToolFraction] = useState<number>();
  const [scanToolResult, setScanToolResult] = useState("");
  const scanToolOutput = useRef<Entity["positions"] | null>(null);
  const [noiseComparison, setNoiseComparison] = useState<{
    kind: "reduceNoise" | "reducePolygons";
    entityId: string;
    source: Entity["positions"];
    output: Entity["positions"];
    rgb: Uint8Array;
    threshold: number;
    statistics?: ReductionStatistics;
    sampleDistances?: Float64Array;
    renderDistances?: Float32Array;
    displayRange?: number;
    lowerTolerance?: number;
    upperTolerance?: number;
    visible: boolean;
  } | null>(null);
  const [scanPreview, setScanPreview] = useState<{
    id: string;
    kind: "reduceNoise" | "reducePolygons" | "scaleMesh" | "mirrorMesh";
    entityId: string;
    source: Entity["positions"];
    output: Float32Array;
  } | null>(null);
  const [pickedScanReference, setPickedScanReference] = useState<string>();
  const scanToolAbort = useRef<AbortController | null>(null);
  const scanReferencePick = useRef<"plane" | "cylinder" | null>(null);
  const pickScanReference = useRef<(id: string) => boolean>(() => false);
  const busy = actionBusy || processingBusy;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [message, setMessage] = useState("Ready · open a scan to begin");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const selectionSessions = useRef(
    new Map<
      string,
      { positions: Entity["positions"]; session: SelectionSession }
    >(),
  );
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [triangleMask, setTriangleMask] = useState<Uint8Array | null>(null);
  const [brushRadius, setBrushRadius] = useState(24);
  const [quickToolsEnabled, setQuickToolsEnabled] = useState(true);
  const [quickToolsPoint, setQuickToolsPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selectionTool, setSelectionTool] = useState<
    "brush" | "freehand" | "line" | "rectangle" | "circle" | "wand"
  >("brush");
  const [scanBoundaryPaths, setScanBoundaryPaths] = useState<
    readonly ScanBoundaryPath[]
  >([]);
  const [scanPanel, setScanPanel] = useState<
    "components" | "holes" | "boundaries" | null
  >(null);
  const [meshClip, setMeshClip] = useState<ScanClipBounds | null>(null);
  const scanEditAbort = useRef<AbortController | null>(null);
  const lastHiddenSelection = useRef<number[]>([]);
  const [selectThrough, setSelectThrough] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    kind?: "object" | "history" | "saved";
    savedId?: string;
    objectId?: string;
    revision?: number;
  } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const wandRef = useRef<(mask: Uint8Array, remove: boolean) => void>(() => {});
  const [selectionAngle, setSelectionAngle] = useState(30);
  const [allConnected, setAllConnected] = useState(false);
  const [selectionTolerance, setSelectionTolerance] = useState(0.001);
  const selectionAbort = useRef<AbortController | null>(null);
  const wandRefreshAbort = useRef<AbortController | null>(null);
  const [wandVersion, setWandVersion] = useState(0);
  const wandRegion = useRef<{
    entityId: string;
    positions: Entity["positions"];
    seeds: Uint8Array;
    baseline: Uint8Array;
    subtract: boolean;
    angle: number;
    tolerance: number;
    allConnected: boolean;
    through: boolean;
  } | null>(null);
  const [subtractBrush, setSubtractBrush] = useState(false);
  const brushRef = useRef<{
    entity: Entity | undefined;
    radius: number;
    subtract: boolean;
    tool: "brush" | "freehand" | "line" | "rectangle" | "circle" | "wand";
    through: boolean;
  }>({
    entity: undefined,
    radius: 24,
    subtract: false,
    tool: "brush",
    through: false,
  });
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
  // Consume after geometry upload, avoiding animation-frame races on import.
  const pendingImportFit = useRef<string | null | undefined>(undefined);
  const [surfaceFit, setSurfaceFit] = useState<SurfaceFitSession | null>(null);
  const surfaceFitRef = useRef(surfaceFit);
  surfaceFitRef.current = surfaceFit;
  const surfaceFitAbort = useRef<AbortController | null>(null);
  const cad = useRef<CadClient | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const knownKernelIds = useRef(new Set<string>());
  const selected = entities.find((e) => e.id === selectedId);
  const activeScanPreview =
    scanPreview &&
    workspace === "scanTools" &&
    toolPanelOpen &&
    scanTool === scanPreview.kind &&
    selected?.id === scanPreview.entityId &&
    selected.positions === scanPreview.source
      ? scanPreview
      : null;
  const activeNoiseComparison =
    noiseComparison &&
    workspace === "scanTools" &&
    toolPanelOpen &&
    scanTool === noiseComparison.kind &&
    selected?.id === noiseComparison.entityId &&
    (selected.positions === noiseComparison.output ||
      (activeScanPreview && selected.positions === noiseComparison.source))
      ? noiseComparison
      : null;
  useEffect(() => {
    retainProcessingGeometry(selected?.positions);
  }, [selected?.positions]);
  brushRef.current = {
    entity: selected,
    radius: brushRadius,
    subtract: subtractBrush,
    tool: selectionTool,
    through: selectThrough,
  };
  wandRef.current = (mask, remove) => growSelection(mask, remove);
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
          if (surfaceFitRef.current || createSketchRef.current) return;
          if (nPointsRef.current) {
            if (nPointsRef.current.preview) {
              setMessage(
                "Choose a point-picking mode to return to the original pose before editing landmarks.",
              );
              return;
            }
            try {
              setNPoints(pickLandmark(nPointsRef.current, id, point));
            } catch (error) {
              setError(errorText(error));
            }
            return;
          }
          if (pickScanReference.current(id)) return;
          setSelectedId(id);
          if (modeRef.current === "measure")
            setMeasure((previous) =>
              previous.length === 1 ? [previous[0], point] : [point],
            );
          else setAnchor(point);
        },
        (id) => {
          // Viewport invokes onSelect before onPick for one click. Keep the scan
          // selected until onPick binds the reference and completes the gesture.
          if (scanReferencePick.current) return;
          if (
            !busyRef.current &&
            !nPointsRef.current &&
            !surfaceFitRef.current &&
            !createSketchRef.current
          )
            setSelectedId(id);
        },
        (id, mask, remove) => {
          if (busyRef.current || brushRef.current.entity?.id !== id) return;
          if (brushRef.current.tool === "wand") {
            wandRef.current(mask, remove);
            return;
          }
          changeSelection((previous) =>
            Uint8Array.from(mask, (value, index) =>
              value ? (remove ? 0 : 1) : (previous?.[index] ?? 0),
            ),
          );
        },
        (factor) => {
          if (brushRef.current.tool === "wand")
            setSelectionAngle((previous) =>
              Math.max(0, Math.min(90, previous + (factor > 1 ? 1 : -1))),
            );
          else
            setBrushRadius((previous) =>
              Math.max(2, Math.min(500, previous * factor)),
            );
        },
        (message) => setError(message),
        (x, y) => {
          if (!busyRef.current) {
            const rect = viewportHost.current!.getBoundingClientRect();
            setContextMenu({ x: x + rect.left, y: y + rect.top });
          }
        },
        (phase, x, y) => {
          if (phase === "begin") setQuickToolsPoint(null);
          else if (x !== undefined && y !== undefined)
            setQuickToolsPoint({ x, y });
          const entity = brushRef.current.entity;
          if (entity) {
            const session = sessionFor(entity);
            if (phase === "begin") session.begin();
            else session.end();
            setSelectionVersion((v) => v + 1);
          }
        },
        (id) => {
          if (
            busyRef.current ||
            nPointsRef.current ||
            surfaceFitRef.current ||
            createSketchRef.current
          )
            return;
          setSelectedId(id);
          setMode("brush");
          setWorkspace("mesh");
          setToolPanelOpen(true);
        },
      );
      viewport.current.setTheme(resolveTheme(theme));
      viewport.current.onSelectionStatus = (status) =>
        setMessage(
          status === "pending" ? "Selecting facets…" : "Selection ready",
        );
      spaceMouse.current = new SpaceMouseController(
        (navigator as Navigator & { hid?: HidAccess }).hid,
        (motion, seconds) => viewport.current?.navigate(motion, seconds),
        (action) =>
          action === "fit"
            ? viewport.current?.fitView()
            : viewport.current?.setView("iso"),
        setSpaceMouseStatus,
      );
      spaceMouse.current.preferences = spaceMousePreferences;
      spaceMouse.current.onInputMotion = () =>
        viewport.current?.noteSpaceMouseInput();
      void spaceMouse.current
        .restoreAuthorized()
        .catch((error) =>
          setSpaceMouseStatus(`SpaceMouse reconnect: ${errorText(error)}`),
        );
    } catch (e) {
      setError(`WebGL unavailable: ${errorText(e)}`);
    }
    const unload = (event?: PageTransitionEvent) => {
      if (!event?.persisted) {
        scanToolAbort.current?.abort();
        scanEditAbort.current?.abort();
        releaseProcessingSession();
        importAbort.current?.abort();
        selectionAbort.current?.abort();
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
    viewport.current?.setEntities(
      activeScanPreview
        ? entities.map((e) =>
            e.id === activeScanPreview.entityId
              ? { ...e, positions: activeScanPreview.output }
              : e,
          )
        : nPoints?.preview?.positions &&
            landmarkSceneUnchanged(nPoints, entities)
          ? entities.map((e) =>
              e.id === nPoints.moving.id
                ? { ...e, positions: nPoints.preview!.positions! }
                : e,
            )
          : surfaceFit?.preview &&
              surfaceFitSourceUnchanged(surfaceFit, entities)
            ? [...entities, surfaceFitEntity(surfaceFit, "surface-fit-preview")]
            : entities,
      selectedId,
    );
    viewport.current?.setAlignmentMarkers(
      nPoints ? landmarkMarkers(nPoints) : [],
    );
    viewport.current?.setPickTarget(
      nPoints
        ? landmarkPickSide === "moving"
          ? nPoints.moving.id
          : nPoints.fixed.id
        : null,
    );
    if (pendingImportFit.current !== undefined) {
      viewport.current?.fitView(pendingImportFit.current ?? undefined);
      pendingImportFit.current = undefined;
    }
  }, [
    entities,
    selectedId,
    nPoints,
    landmarkPickSide,
    surfaceFit,
    activeScanPreview,
  ]);
  useEffect(() => {
    if (scanPreview && !activeScanPreview) {
      setScanPreview(null);
      releaseProcessingSession();
    }
  }, [scanPreview, activeScanPreview]);
  useEffect(() => {
    const comparison = activeNoiseComparison?.visible
      ? activeNoiseComparison
      : null;
    viewport.current?.setNoiseComparison(
      comparison?.entityId,
      comparison?.source,
      comparison?.rgb,
      comparison?.renderDistances
        ? {
            distances: comparison.renderDistances,
            lower:
              comparison.lowerTolerance ?? -comparison.statistics!.tolerance,
            upper:
              comparison.upperTolerance ?? comparison.statistics!.tolerance,
          }
        : undefined,
    );
    if (noiseComparison && !activeNoiseComparison) setNoiseComparison(null);
  }, [entities, activeNoiseComparison, noiseComparison]);
  useEffect(() => {
    if (surfaceFit && !surfaceFitSourceUnchanged(surfaceFit, entities))
      cancelSurfaceFit();
  }, [entities, surfaceFit]);
  useEffect(() => () => surfaceFitAbort.current?.abort(), []);
  useEffect(() => {
    if (nPoints && !landmarkSceneUnchanged(nPoints, entities))
      cancelLandmarks();
  }, [entities, nPoints]);
  useEffect(() => () => landmarkAbort.current?.abort(), []);
  useEffect(() => {
    viewport.current?.setFlatShading(flatShading);
  }, [flatShading]);
  useEffect(() => {
    viewport.current?.setGridOptions(floorGrid, gridSpacing, snapGrid);
  }, [floorGrid, gridSpacing, snapGrid]);
  useEffect(() => {
    viewport.current?.setWireframe(wireframe);
  }, [wireframe]);
  useEffect(() => {
    viewport.current?.setBrush(
      mode === "brush" &&
        !busy &&
        !selected?.kernelId &&
        !scanPanel &&
        !scanBoundaryPaths.length,
    );
  }, [mode, busy, selected?.kernelId, scanPanel, scanBoundaryPaths]);
  useEffect(() => {
    viewport.current?.setSelectionOptions(
      selectionTool,
      brushRadius,
      selectThrough,
      subtractBrush,
    );
  }, [selectionTool, brushRadius, selectThrough, subtractBrush]);
  useEffect(() => {
    setScanBoundaryPaths([]);
    setMeshClip(null);
    setScanPanel(null);
    lastHiddenSelection.current = [];
    scanEditAbort.current?.abort();
  }, [selectedId]);
  useEffect(() => {
    setScanBoundaryPaths([]);
    setMeshClip(null);
    lastHiddenSelection.current = [];
    scanEditAbort.current?.abort();
  }, [selected?.positions]);
  useEffect(() => () => scanEditAbort.current?.abort(), []);
  useEffect(() => {
    const view = viewport.current;
    if (!view) return;
    view.onMeshClipChange = setMeshClip;
    view.setMeshClipBox(
      selected?.id ?? null,
      workspace === "mesh" && toolPanelOpen && !busy ? meshClip : null,
      stats ? { min: stats.min, max: stats.max } : undefined,
    );
    return () => {
      view.onMeshClipChange = undefined;
    };
  }, [meshClip, selectedId, stats, workspace, toolPanelOpen, busy]);
  useEffect(() => {
    if (!selected) {
      setTriangleMask(null);
      return;
    }
    const session = sessionFor(selected);
    setTriangleMask(new Uint8Array(session.state.mask));
    setSelectionVersion((v) => v + 1);
  }, [selectedId, selected?.positions]);
  useEffect(() => {
    const origin = wandRegion.current;
    if (!origin) return;
    if (
      origin.entityId !== selectedId ||
      origin.positions !== selected?.positions ||
      mode !== "brush" ||
      selectionTool !== "wand"
    ) {
      wandRegion.current = null;
      return;
    }
    if (
      busy ||
      (origin.angle === selectionAngle &&
        origin.tolerance === selectionTolerance &&
        origin.allConnected === allConnected &&
        origin.through === selectThrough)
    )
      return;
    const source = selected;
    const controller = new AbortController();
    wandRefreshAbort.current = controller;
    const timer = window.setTimeout(() => {
      void processMesh(
        {
          kind: "connectedSelection",
          positions: origin.positions,
          seeds: origin.seeds,
          tolerance: selectionTolerance,
          angleDegrees: selectionAngle,
          allConnected,
        },
        { signal: controller.signal, reuseTopology: true },
      )
        .then(async (result) => {
          if (controller.signal.aborted || wandRegion.current !== origin)
            return;
          if (!result.selection)
            throw new Error("Missing wand selection result.");
          const region =
            !allConnected && !selectThrough
              ? await viewport.current!.visibleSelection(
                  source.id,
                  result.selection,
                )
              : result.selection;
          if (controller.signal.aborted || wandRegion.current !== origin)
            return;
          const session = sessionFor(source);
          session.set({
            mask: applyWandRegion(
              origin.baseline,
              region,
              origin.subtract,
              session.state.hidden,
            ),
            hidden: session.state.hidden,
          });
          origin.angle = selectionAngle;
          origin.tolerance = selectionTolerance;
          origin.allConnected = allConnected;
          origin.through = selectThrough;
          applySelectionState(source, session.state);
          setMessage(
            `${selectionCount(session.state.mask)} triangles selected`,
          );
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setError(error instanceof Error ? error.message : String(error));
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (wandRefreshAbort.current === controller)
        wandRefreshAbort.current = null;
    };
  }, [
    selectedId,
    selected?.positions,
    selectionAngle,
    selectionTolerance,
    allConnected,
    selectThrough,
    selectionTool,
    mode,
    busy,
    wandVersion,
  ]);
  useEffect(() => {
    viewport.current?.setTriangleSelection(
      nPoints ? undefined : selected?.positions,
      activeNoiseComparison?.visible ||
        scanBoundaryPaths.length ||
        scanPanel === "boundaries" ||
        scanPanel === "holes"
        ? undefined
        : (triangleMask ?? undefined),
    );
  }, [
    selected?.positions,
    triangleMask,
    nPoints,
    scanBoundaryPaths,
    scanPanel,
    activeNoiseComparison?.visible,
  ]);
  useEffect(() => {
    viewport.current?.setBoundaryEdges(
      workspace === "mesh" && toolPanelOpen ? scanBoundaryPaths : [],
    );
  }, [scanBoundaryPaths, workspace, toolPanelOpen]);
  useEffect(() => {
    viewport.current?.setSection(axis, offset, mode === "section");
    const preview = createSketch?.preview;
    viewport.current?.setSectionLines(
      preview
        ? preview.actualSegments
        : workspace === "sketch"
          ? sketchDraft.reference &&
            sketchDraft.frame &&
            sketchMeshPoints &&
            toolPanelOpen
            ? referenceWorldSegments(sketchDraft.frame, sketchDraft.reference)
            : []
          : section.segments,
      preview ? "#eeeeee" : workspace === "sketch" ? "#888888" : "#ed8a30",
      preview && !preview.reference.onSlicingPlane
        ? preview.placedSegments
        : undefined,
      preview
        ? "lines"
        : workspace === "sketch"
          ? sketchMeshPoints && toolPanelOpen
            ? "points"
            : "hidden"
          : undefined,
    );
  }, [
    axis,
    offset,
    mode,
    section,
    createSketch,
    workspace,
    sketchDraft,
    sketchMeshPoints,
    toolPanelOpen,
  ]);
  useEffect(() => {
    viewport.current?.setSketchEditor(
      workspace === "sketch" && toolPanelOpen && !createSketch
        ? {
            sketch: sketchDraft,
            tool: busy ? "navigate" : sketchDrawingTool,
            constraints: sketchDrawingConstraints,
            showControlPoints: sketchControlPoints,
            onChange: updateSketchDraft,
            onError: setError,
          }
        : undefined,
    );
  }, [
    workspace,
    toolPanelOpen,
    createSketch,
    sketchDraft,
    sketchDrawingTool,
    sketchDrawingConstraints,
    sketchControlPoints,
    busy,
    activeSketchId,
  ]);
  useEffect(() => {
    viewport.current?.setOrigin(originVisible || planePicking, planePicking);
    if (viewport.current)
      viewport.current.onOriginPlane = (plane) => {
        if (!planePicking || busyRef.current) return;
        createPlaneSketch(coordinateSketchFrame(plane, 0));
      };
  }, [originVisible, planePicking, savedSketches.length]);
  useEffect(() => {
    if (!planePicking) return;
    const cancel = (event: KeyboardEvent) => {
      if (matchesLocalShortcut(event, "cancel")) {
        event.preventDefault();
        setPlanePicking(false);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [planePicking]);
  useEffect(() => {
    if (
      createSketch &&
      !entities.some(
        (e) =>
          e.id === createSketch.source.id &&
          e.positions === createSketch.source.positions,
      )
    ) {
      cancelSketchCreation();
      setError("Source scan changed. Reopen Create Sketch.");
    }
  }, [entities, createSketch]);
  useEffect(() => () => sketchSectionAbort.current?.abort(), []);
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
  function sessionFor(entity: Entity): SelectionSession {
    let record = selectionSessions.current.get(entity.id);
    if (!record || record.positions !== entity.positions) {
      record = {
        positions: entity.positions,
        session: new SelectionSession(
          entity.positions.length / 9,
          entity.meshSelection?.hidden,
        ),
      };
      selectionSessions.current.set(entity.id, record);
    }
    return record.session;
  }
  function applySelectionState(entity: Entity, state: SelectionState) {
    setTriangleMask(new Uint8Array(state.mask));
    setSelectionVersion((v) => v + 1);
    setEntities((previous) =>
      previous.map((e) => {
        if (e.id !== entity.id) return e;
        const old = e.meshSelection?.hidden ?? [];
        if (
          old.length === state.hidden.length &&
          old.every((v, i) => v === state.hidden[i])
        )
          return e;
        return {
          ...e,
          meshSelection: {
            hidden: [...state.hidden],
            saved: e.meshSelection?.saved ?? [],
          },
        };
      }),
    );
  }
  function changeSelection(
    next:
      Uint8Array | null | ((previous: Uint8Array | null) => Uint8Array | null),
  ) {
    setScanBoundaryPaths([]);
    wandRegion.current = null;
    wandRefreshAbort.current?.abort();
    const entity = brushRef.current.entity;
    if (!entity) return;
    const session = sessionFor(entity);
    const mask =
      (typeof next === "function" ? next(session.state.mask) : next) ??
      new Uint8Array(entity.positions.length / 9);
    const hidden = new Set(session.state.hidden);
    session.set({
      mask: Uint8Array.from(mask, (v, i) => (hidden.has(i) ? 0 : v)),
      hidden: session.state.hidden,
    });
    applySelectionState(entity, session.state);
  }
  function selectionVisibility(operation: "hide" | "isolate" | "reveal") {
    wandRegion.current = null;
    wandRefreshAbort.current?.abort();
    if (!selected || busy) return;
    const session = sessionFor(selected);
    if (operation === "hide")
      lastHiddenSelection.current = maskIndices(session.state.mask);
    session.set(
      operation === "reveal"
        ? { mask: session.state.mask, hidden: [] }
        : hideRegion(session.state, operation === "isolate"),
    );
    applySelectionState(selected, session.state);
    setDirty(true);
  }
  function revealSelectedTriangles() {
    if (!selected || busy) return;
    const session = sessionFor(selected),
      revealed = new Set(lastHiddenSelection.current);
    session.set({
      mask: indicesMask(
        selected.positions.length / 9,
        lastHiddenSelection.current,
      ),
      hidden: session.state.hidden.filter((index) => !revealed.has(index)),
    });
    applySelectionState(selected, session.state);
    setDirty(true);
  }
  async function morphSelection(operation: "grow" | "shrink" | "boundary") {
    if (!selected || busy || scanEditAbort.current) return;
    const controller = new AbortController();
    scanEditAbort.current = controller;
    setProcessingBusy(true);
    try {
      const result = await processMesh(
        {
          ...(operation === "boundary"
            ? {
                kind: "scanEdit" as const,
                positions: selected.positions,
                action: "inventory" as const,
                tolerance: selectionTolerance,
              }
            : {
                kind: "selectionMorphology" as const,
                positions: selected.positions,
                selection:
                  triangleMask ?? new Uint8Array(selected.positions.length / 9),
                operation,
                hidden: selected.meshSelection?.hidden,
              }),
        },
        { signal: controller.signal, reuseTopology: true },
      );
      if (!controller.signal.aborted) {
        if (operation === "boundary")
          setScanBoundaryPaths(result.scanEdit?.inventory?.boundaries ?? []);
        else if (result.selection) {
          setScanBoundaryPaths([]);
          changeSelection(result.selection);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(errorText(error));
    } finally {
      if (scanEditAbort.current === controller) {
        scanEditAbort.current = null;
        setProcessingBusy(false);
      }
    }
  }
  function replaceScanPositions(
    positions: Float32Array,
    label: string,
    retainFacetSelection = false,
  ) {
    if (!selected) return;
    if (!positions.length) {
      operationLabel.current = label;
      commit(entities.filter((entity) => entity.id !== selected.id));
      operationLabel.current = null;
      setSelectedId(null);
      setMessage(label);
      return;
    }
    validatePositions(positions);
    const retainSelection =
      retainFacetSelection && positions.length === selected.positions.length;
    if (retainSelection)
      selectionSessions.current.set(selected.id, {
        positions,
        session: sessionFor(selected),
      });
    operationLabel.current = label;
    updateSelected({
      positions,
      kind: "mesh",
      kernelId: undefined,
      brep: undefined,
      surfacePatch: undefined,
      surfaceScanId: undefined,
      fit: undefined,
      parametric: undefined,
      normals: undefined,
      meshSelection: retainSelection ? selected.meshSelection : undefined,
      scanSource: undefined,
    });
    operationLabel.current = null;
    setMessage(label);
  }
  async function runScanEdit(
    operation: Omit<ScanEditRequest, "kind" | "positions">,
    label: string,
  ) {
    if (!selected || busy || scanEditAbort.current) return;
    if (selected.parametric || selected.kernelId) {
      setError("Create a separate mesh copy before editing an exact CAD body.");
      return;
    }
    const controller = new AbortController();
    scanEditAbort.current = controller;
    setProcessingBusy(true);
    setError("");
    try {
      const result = await processMesh(
        {
          kind: "scanEdit",
          positions: selected.positions,
          tolerance: SCAN_TOPOLOGY_TOLERANCE,
          ...operation,
        },
        {
          signal: controller.signal,
          onProgress: (fraction, stage) =>
            setMessage(`${stage} · ${Math.round(fraction * 100)}%`),
          reuseTopology: true,
        },
      );
      if (controller.signal.aborted) return;
      if (result.scanEdit?.positions)
        replaceScanPositions(
          result.scanEdit.positions,
          label,
          operation.action === "smoothSelected",
        );
      if (result.scanEdit?.segments)
        createSegments(result.scanEdit.segments, label);
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(errorText(error));
        setMessage(`${label} failed · original mesh retained`);
      }
    } finally {
      if (scanEditAbort.current === controller) {
        scanEditAbort.current = null;
        setProcessingBusy(false);
      }
    }
  }
  function projectScanBoundaries(
    curves: number[][],
    plane: { origin: Vec3; normal: Vec3 },
    label: string,
  ) {
    const created = boundarySketches(curves, plane, label);
    if (!created.length) throw new Error("No boundary curves were produced.");
    setSavedSketches((previous) => [...previous, ...created]);
    setDirty(true);
    setMessage(`${created.length} projected boundary sketch(es) created`);
  }
  function selectionUndo(redo = false) {
    wandRegion.current = null;
    wandRefreshAbort.current?.abort();
    const entity = brushRef.current.entity;
    if (!entity || busyRef.current) return;
    const session = sessionFor(entity);
    applySelectionState(entity, redo ? session.redo() : session.undo());
    setDirty(true);
  }
  function saveSelection(selectionName: string) {
    if (!selected || !selectedTriangleCount || busy) return;
    const name = selectionName.trim();
    if (!name || name.length > 200) {
      setError("Enter a selection name between 1 and 200 characters.");
      return;
    }
    const state = selected.meshSelection ?? { hidden: [], saved: [] };
    updateSelected({
      meshSelection: {
        ...state,
        saved: [
          ...state.saved,
          {
            id: crypto.randomUUID(),
            name,
            triangles: maskIndices(triangleMask!),
          },
        ],
      },
    });
    setMessage(`Saved selection ${name}`);
  }
  function restoreSelection(entity: Entity, id: string) {
    const saved = entity.meshSelection?.saved.find((s) => s.id === id);
    if (!saved || busy) return;
    wandRegion.current = null;
    wandRefreshAbort.current?.abort();
    setSelectedId(entity.id);
    setMode("brush");
    setWorkspace("mesh");
    setToolPanelOpen(true);
    const session = sessionFor(entity),
      chosen = new Set(saved.triangles);
    session.set({
      mask: indicesMask(entity.positions.length / 9, saved.triangles),
      hidden: session.state.hidden.filter((i) => !chosen.has(i)),
    });
    applySelectionState(entity, session.state);
    setMessage(`Restored selection ${saved.name}`);
  }
  const selectionSession = selected ? sessionFor(selected) : undefined;
  void selectionVersion;
  useEffect(() => {
    const live = new Map(entities.map((e) => [e.id, e.positions]));
    for (const [id, record] of selectionSessions.current)
      if (live.get(id) !== record.positions)
        selectionSessions.current.delete(id);
  }, [entities]);
  const actions: Partial<Record<ShortcutActionId, (() => void) | undefined>> = {
    new: requestNewDocument,
    open: () => fileInput.current?.click(),
    save,
    "fit-view": () => viewport.current?.fitView(),
    "view-top": () => viewport.current?.setView("top"),
    "view-bottom": () => viewport.current?.setView("bottom"),
    "view-left": () => viewport.current?.setView("left"),
    "view-right": () => viewport.current?.setView("right"),
    "view-front": () => viewport.current?.setView("front"),
    "view-back": () => viewport.current?.setView("back"),
    "view-isometric": () => viewport.current?.setView("iso"),
    "rotate-view": () => {},
    "undo-model": undo,
    "redo-model": redo,
    "undo-selection": () => selectionUndo(),
    "redo-selection": () => selectionUndo(true),
    "undo-sketch": () => sketchUndo(),
    "redo-sketch": () => sketchUndo(true),
    "hide-meshes": () => {
      setEntities(
        entities.map((e) =>
          e.kind === "mesh" && !e.surfacePatch ? { ...e, visible: false } : e,
        ),
      );
      setDirty(true);
    },
    "toggle-visibility": () => {},
    "clear-selection": () =>
      mode === "brush" ? changeSelection(null) : setSelectedId(null),
    "hide-selected": selected
      ? () =>
          mode === "brush" && selectedTriangleCount
            ? selectionVisibility("hide")
            : updateSelected({ visible: false })
      : undefined,
    "new-sketch": selected ? openSketchCreation : undefined,
    compare: selected ? () => showTools("deviation") : undefined,
    "selection-wand": selected
      ? () => {
          setMode("brush");
          setSelectionTool("wand");
          showTools("mesh");
        }
      : undefined,
    "fit-plane": selected ? () => runFit("plane") : undefined,
    "fit-cylinder": selected ? () => runFit("cylinder") : undefined,
    "fit-cone": selected ? () => runFit("cone") : undefined,
    "fit-sphere": selected ? () => runFit("sphere") : undefined,
    fillet: selected?.kernelId ? () => showTools("advancedCad") : undefined,
    "selection-brush":
      mode === "brush" ? () => setSelectionTool("brush") : undefined,
    "selection-through":
      mode === "brush" ? () => setSelectThrough((v) => !v) : undefined,
    "sketch-line":
      workspace === "sketch" && toolPanelOpen && !createSketch
        ? () => setSketchDrawingTool("line")
        : undefined,
    "sketch-circle":
      workspace === "sketch" && toolPanelOpen && !createSketch
        ? () => setSketchDrawingTool("circle")
        : undefined,
    "sketch-arc":
      workspace === "sketch" && toolPanelOpen && !createSketch
        ? () => setSketchDrawingTool("arc3")
        : undefined,
    "sketch-dimensions":
      workspace === "sketch" && toolPanelOpen && !createSketch
        ? () => setSketchDrawingConstraints((v) => !v)
        : undefined,
  };
  const shortcutContext: ShortcutContext = {
    mode:
      workspace === "sketch" && toolPanelOpen && !createSketch
        ? "sketch"
        : workspace === "fit" && toolPanelOpen
          ? "primitive-fit"
          : workspace === "surface" && toolPanelOpen
            ? "freeform"
            : mode === "brush"
              ? "selection"
              : "main",
    platform: shortcutPlatform(),
    busy,
    modalOpen: !!(
      nPoints ||
      surfaceFit ||
      createSketch ||
      primitiveDialog ||
      settingsOpen ||
      saveDialogOpen ||
      newDocumentDialog ||
      contextMenu
    ),
    supportedActions: new Set(Object.keys(actions) as ShortcutActionId[]),
    availableActions: new Set(
      (Object.keys(actions) as ShortcutActionId[]).filter(
        (id) => !!actions[id],
      ),
    ),
    visibilityCategories: VIEWPORT_VISIBILITY_CATEGORIES,
    allowConfiguredRotation: false,
    allowExtensions: true,
  };
  const inputCommands = useRef<(event: KeyboardEvent) => void>(() => {});
  inputCommands.current = (event) => {
    const resolved = resolveKeyboardShortcut(event, {
      ...shortcutContext,
      ...keyboardTargetContext(event.target),
      modalOpen:
        shortcutContext.modalOpen ||
        !!document.querySelector('[aria-modal="true"],dialog[open]'),
    });
    if (!resolved) return;
    event.preventDefault();
    if (resolved.id === "rotate-view")
      viewport.current?.rotateView(resolved.direction!, 90);
    else if (resolved.id === "toggle-visibility") {
      const category = resolved.category;
      const matches = (e: Entity) =>
        category === "meshes"
          ? e.kind === "mesh" && !e.surfacePatch
          : category === "surfaces"
            ? !!e.surfacePatch
            : category === "solids"
              ? e.kind === "cad" || e.kind === "box"
              : category === "primitives"
                ? !!e.fit ||
                  ["plane", "cylinder", "cone", "sphere"].includes(e.kind)
                : category === "planes"
                  ? e.kind === "plane"
                  : category === "cylinders"
                    ? e.kind === "cylinder"
                    : category === "cones"
                      ? e.kind === "cone"
                      : category === "spheres"
                        ? e.kind === "sphere"
                        : false;
      const show = !entities.some((e) => matches(e) && e.visible);
      setEntities(
        entities.map((e) => (matches(e) ? { ...e, visible: show } : e)),
      );
      setDirty(true);
    } else actions[resolved.id]?.();
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => inputCommands.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  function commit(next: Entity[], preserveSelectionFor?: string) {
    next = next.map((entity) => {
      const old = entities.find((e) => e.id === entity.id);
      return old &&
        old.positions !== entity.positions &&
        entity.id !== preserveSelectionFor
        ? { ...entity, meshSelection: undefined }
        : entity;
    });
    entityFeatureModel(next);
    if (!modelChanged(entities, next)) {
      setEntities(next);
      setDirty(true);
      return;
    }
    const label =
      operationLabel.current?.replace(/…$/, "") ?? changeLabel(entities, next);
    setHistory((previous) => [...previous.slice(-19), { entities, label }]);
    setFuture([]);
    setEntities(next);
    setDirty(true);
  }
  function updateSelected(patch: Partial<Entity>) {
    if (patch.positions && selected?.parametric && !("parametric" in patch))
      throw new Error(
        "Edit the parametric recipe and rebuild this body before changing its geometry.",
      );
    // Geometry edits invalidate authoring data unless they explicitly rebuild it.
    if (patch.positions && !("surfacePatch" in patch))
      patch = { ...patch, surfacePatch: undefined, surfaceScanId: undefined };
    if (patch.positions && !("fit" in patch))
      patch = { ...patch, fit: undefined };
    if (patch.positions && !("planeFrame" in patch))
      patch = { ...patch, planeFrame: undefined };
    if (selected)
      commit(
        entities.map((e) => (e.id === selected.id ? { ...e, ...patch } : e)),
      );
  }
  function undo() {
    if (history.length) {
      const next = history[history.length - 1];
      setFuture((p) => [{ entities, label: next.label }, ...p]);
      setEntities(restoreModelDisplay(next.entities, entities));
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
      setEntities(restoreModelDisplay(next.entities, entities));
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
    if (busy || index === history.length) return;
    const next = seekModelRevision(history, entities, future, index);
    setEntities(next.entities);
    setSelectedId(
      next.entities.some((entity) => entity.id === selectedId)
        ? selectedId
        : (next.entities[0]?.id ?? null),
    );
    setHistory(next.history);
    setFuture(next.future);
    setDirty(true);
    setMessage(
      index === 0
        ? "Restored starting state"
        : `Restored model after ${next.history[index - 1].label}`,
    );
  }
  function showTools(nextWorkspace: string) {
    if (nextWorkspace !== "scanTools") scanReferencePick.current = null;
    cancelLandmarks();
    cancelSurfaceFit();
    setWorkspace(nextWorkspace);
    setToolPanelOpen(true);
    if (nextWorkspace === "properties") setMode("inspect");
  }
  function closeScanTool() {
    releaseProcessingSession();
    dismissScanTool();
  }
  function dismissScanTool() {
    setScanToolFraction(undefined);
    setScanPreview(null);
    setNoiseComparison(null);
    scanToolAbort.current?.abort();
    scanReferencePick.current = null;
    setToolPanelOpen(false);
    setMode("inspect");
  }
  function openScanTool(tool: ScanToolId) {
    setScanToolFraction(undefined);
    setScanPreview(null);
    releaseProcessingSession();
    setNoiseComparison(null);
    scanToolAbort.current?.abort();
    scanReferencePick.current = null;
    setPickedScanReference(undefined);
    setScanToolResult("");
    setScanToolProgress("");
    setScanTool(tool);
    setMode("inspect");
    showTools("scanTools");
  }
  pickScanReference.current = (id) => {
    const kind = scanReferencePick.current;
    if (!kind) return false;
    const reference = entities.find(
      (e) => e.id === id && e.id !== selected?.id,
    );
    if (
      !reference ||
      !(kind === "plane"
        ? mirrorReference(reference)
        : cylinderReference(reference))
    ) {
      setMessage(
        `Pick a ${kind === "plane" ? "planar CAD or construction object" : "cylinder reference"}.`,
      );
      return true;
    }
    scanReferencePick.current = null;
    setPickedScanReference(id);
    setMessage(`Reference selected: ${reference.name}`);
    return true;
  };
  useEffect(() => {
    scanToolAbort.current?.abort();
    scanReferencePick.current = null;
  }, [selected?.id, selected?.positions]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (matchesLocalShortcut(event, "cancel") && scanReferencePick.current) {
        scanReferencePick.current = null;
        setMessage("Reference picking cancelled.");
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);
  useEffect(() => {
    setPickedScanReference(undefined);
    setScanToolResult("");
  }, [selected?.id]);
  async function applyScanTool(parameters: ScanToolParameters) {
    if (!selected || busy || scanToolAbort.current) return;
    const source = selected;
    const controller = new AbortController();
    const reduction = parameters.kind === "reducePolygons";
    const reportEvent = (fraction: number, stage: string) => {
      if (controller.signal.aborted) return;
      setScanToolFraction(reduction ? fraction : undefined);
      setScanToolProgress(
        reduction ? stage : `${stage} · ${Math.round(fraction * 100)}%`,
      );
      setMessage(`${stage} · ${Math.floor(fraction * 100)}%`);
    };
    const report = reduction
      ? linearProgress(reportEvent)
      : (_start: number, _end: number) => reportEvent;
    setScanToolFraction(reduction ? 0 : undefined);
    setScanToolProgress(
      `Preparing ${scanToolTitles[parameters.kind].toLowerCase()}`,
    );
    try {
      const request = scanToolRequest(
        source,
        parameters,
        entities,
        triangleMask,
      );
      const isPreview =
        parameters.kind === "reduceNoise" ||
        parameters.kind === "reducePolygons" ||
        parameters.kind === "scaleMesh" ||
        parameters.kind === "mirrorMesh";
      const previewId = crypto.randomUUID();
      setScanPreview(null);
      scanToolAbort.current = controller;
      setNoiseComparison(null);
      setProcessingBusy(true);
      setError("");
      setScanToolResult("");
      const result = await processMesh(
        isPreview
          ? {
              kind: "scanPreview",
              phase: "create",
              previewId,
              positions: source.positions,
              operation: request.operation,
            }
          : request,
        {
          signal: controller.signal,
          reuseTopology: true,
          onProgress: report(0, reduction ? 0.75 : 1),
        },
      );
      if (controller.signal.aborted || !result.positions) return;
      let summary = String(result.diagnostics.summary ?? "Mesh tool complete");
      if (isPreview) {
        setScanPreview({
          id: previewId,
          kind: parameters.kind as
            "reduceNoise" | "reducePolygons" | "scaleMesh" | "mirrorMesh",
          entityId: source.id,
          source: source.positions,
          output: result.positions,
        });
        if (
          parameters.kind === "reducePolygons" ||
          (parameters.kind === "reduceNoise" && parameters.measureDeviation)
        ) {
          const compared = await processMesh(
            {
              kind: "scanPreview",
              phase: "compare",
              positions: source.positions,
              previewId,
              deviation: parameters.deviation,
              displayRange: reduction ? parameters.deviation : undefined,
              paletteThreshold:
                parameters.kind === "reducePolygons"
                  ? parameters.paletteThreshold
                  : parameters.deviation,
            },
            {
              signal: controller.signal,
              reuseTopology: true,
              onProgress: report(reduction ? 0.75 : 0, reduction ? 0.99 : 1),
            },
          );
          if (controller.signal.aborted) return;
          summary += ` ${String(compared.diagnostics.summary)}`;
          if (compared.noiseComparison)
            setNoiseComparison({
              kind: parameters.kind,
              entityId: source.id,
              source: source.positions,
              output: result.positions,
              ...compared.noiseComparison,
              visible: true,
            });
        }
      } else {
        replaceScanPositions(
          result.positions,
          scanToolTitles[parameters.kind],
          false,
        );
        scanToolOutput.current = result.positions;
      }
      if (
        (parameters.kind === "reduceNoise" ||
          parameters.kind === "reducePolygons") &&
        result.noiseComparison
      )
        setNoiseComparison({
          kind: parameters.kind,
          entityId: source.id,
          source: source.positions,
          output: result.positions,
          ...result.noiseComparison,
          visible: true,
        });
      setScanToolResult(summary);
      setMessage(summary);
      if (reduction) report(1, 1)(1, "Reduction and comparison complete");
    } catch (error) {
      if (controller.signal.aborted)
        setMessage("Mesh operation cancelled; original geometry retained.");
      else setError(errorText(error));
      setScanToolFraction(undefined);
      setScanToolProgress("");
    } finally {
      if (scanToolAbort.current === controller) {
        scanToolAbort.current = null;
        setProcessingBusy(false);
        if (!reduction) setScanToolProgress("");
        if (controller.signal.aborted) setScanToolFraction(undefined);
      }
    }
  }
  function acceptScanPreview(options?: { createNewObject?: boolean }) {
    if (!activeScanPreview || busy) return;
    if (
      activeScanPreview.kind === "reducePolygons" &&
      !activeNoiseComparison?.statistics
    )
      return;
    if (
      (activeScanPreview.kind === "scaleMesh" ||
        activeScanPreview.kind === "mirrorMesh") &&
      options?.createNewObject &&
      selected
    ) {
      const copy = (
        activeScanPreview.kind === "mirrorMesh"
          ? mirroredMeshCopy
          : scaledMeshCopy
      )(selected, activeScanPreview.output, crypto.randomUUID());
      operationLabel.current = `${scanToolTitles[activeScanPreview.kind]} · create new object`;
      try {
        commit([...entities, copy]);
        setSelectedId(copy.id);
      } finally {
        operationLabel.current = null;
      }
    } else {
      replaceScanPositions(
        activeScanPreview.output,
        scanToolTitles[activeScanPreview.kind],
        activeScanPreview.kind === "reduceNoise",
      );
    }
    scanToolOutput.current = activeScanPreview.output;
    setScanPreview(null);
    setNoiseComparison(null);
    closeScanTool();
    setMessage("Mesh preview accepted.");
  }
  async function updateScanComparison(
    deviation: number,
    paletteThreshold: number,
  ) {
    const preview = activeScanPreview;
    if (
      !preview ||
      preview.kind === "scaleMesh" ||
      preview.kind === "mirrorMesh" ||
      busy ||
      scanToolAbort.current
    )
      return;
    const controller = new AbortController();
    scanToolAbort.current = controller;
    setProcessingBusy(true);
    setError("");
    const report = linearProgress((fraction, stage) => {
      setScanToolFraction(
        preview.kind === "reducePolygons" ? fraction : undefined,
      );
      setScanToolProgress(stage);
      setMessage(`${stage} · ${Math.floor(fraction * 100)}%`);
    });
    report(0, 1)(0, "Preparing surface comparison");
    try {
      const result = await processMesh(
        {
          kind: "scanPreview",
          phase: "compare",
          positions: preview.source,
          previewId: preview.id,
          deviation,
          displayRange:
            preview.kind === "reducePolygons" ? deviation : undefined,
          paletteThreshold:
            preview.kind === "reduceNoise" ? deviation : paletteThreshold,
        },
        {
          signal: controller.signal,
          reuseTopology: true,
          onProgress: report(0, 0.99),
        },
      );
      if (!controller.signal.aborted && result.noiseComparison) {
        setNoiseComparison({
          kind: preview.kind,
          entityId: preview.entityId,
          source: preview.source,
          output: preview.output,
          ...result.noiseComparison,
          visible: true,
        });
        setScanToolResult(String(result.diagnostics.summary));
        report(1, 1)(1, "Surface comparison complete");
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(errorText(error));
      setScanToolFraction(undefined);
    } finally {
      if (scanToolAbort.current === controller) {
        scanToolAbort.current = null;
        setProcessingBusy(false);
        if (preview.kind !== "reducePolygons") setScanToolProgress("");
      }
    }
  }
  function cancelSurfaceFit() {
    surfaceFitAbort.current?.abort();
    surfaceFitRef.current = null;
    setSurfaceFit(null);
    setToolPanelOpen(false);
  }
  function openSurfaceFit() {
    if (!selected) return;
    try {
      const session = beginSurfaceFit(
        selected,
        triangleMask,
        sessionFor(selected).state.hidden,
      );
      cancelLandmarks();
      setMode("inspect");
      setSurfaceFit(session);
      setToolPanelOpen(true);
      setError("");
    } catch (error) {
      setError(errorText(error));
    }
  }
  async function previewSurfaceFit(options: SurfaceFitOptions) {
    const session = surfaceFitRef.current;
    if (!session || surfaceFitAbort.current) return;
    const controller = new AbortController();
    surfaceFitAbort.current = controller;
    setProcessingBusy(true);
    setSurfaceFit({ ...session, preview: undefined });
    try {
      const preview = await fitGridSurfaceAsync(session.scan, options, {
        signal: controller.signal,
      });
      if (
        !controller.signal.aborted &&
        surfaceFitRef.current?.source === session.source
      )
        setSurfaceFit({ ...session, preview });
    } catch (error) {
      if (!controller.signal.aborted) setError(errorText(error));
    } finally {
      if (surfaceFitAbort.current === controller) {
        surfaceFitAbort.current = null;
        setProcessingBusy(false);
      }
    }
  }
  function acceptSurfacePreview() {
    if (!surfaceFit) return;
    try {
      const id = crypto.randomUUID();
      const next = acceptSurfaceFit(surfaceFit, entities, id);
      operationLabel.current = "Fit surface";
      commit(next);
      setSelectedId(id);
      cancelSurfaceFit();
      setMessage("Fitted surface created · scan preserved");
    } catch (error) {
      setError(errorText(error));
    } finally {
      operationLabel.current = null;
    }
  }
  function cancelLandmarks() {
    landmarkAbort.current?.abort();
    nPointsRef.current = null;
    setNPoints(null);
    setToolPanelOpen(false);
  }
  function openLandmarks() {
    if (!selected) return;
    const fixed = entities.find(
      (e) => e.id !== selected.id && e.positions.length >= 9,
    );
    if (!fixed) {
      setError("Import a second scan or CAD target before aligning by points.");
      return;
    }
    try {
      setNPoints(beginLandmarkAlignment(selected, fixed));
      setLandmarkPickSide("moving");
      setMode("inspect");
      setToolPanelOpen(true);
    } catch (error) {
      setError(errorText(error));
    }
  }
  function previewLandmarks() {
    const session = nPointsRef.current;
    if (!session || busy) return;
    void action("Previewing landmark alignment…", async () => {
      const controller = new AbortController();
      landmarkAbort.current = controller;
      try {
        const result = await processMesh(landmarkRequest(session), {
          signal: controller.signal,
        });
        if (!controller.signal.aborted && nPointsRef.current === session)
          setNPoints({ ...session, preview: result });
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        if (landmarkAbort.current === controller) landmarkAbort.current = null;
      }
    });
  }
  function acceptLandmarks() {
    if (!nPoints || busy) return;
    try {
      const next = acceptLandmarkAlignment(nPoints, entities);
      const source = next.find((e) => e.id === nPoints.moving.id)!;
      const session = sessionFor(nPoints.moving);
      selectionSessions.current.set(source.id, {
        positions: source.positions,
        session,
      });
      operationLabel.current = "Align by corresponding points";
      commit(next, source.id);
      operationLabel.current = null;
      cancelLandmarks();
      setMessage("Landmark alignment accepted · fixed target preserved");
    } catch (error) {
      operationLabel.current = null;
      setError(errorText(error));
    }
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
    try {
      entityFeatureModel(
        entities.filter((entity) => entity.id !== selected.id),
      );
    } catch {
      setError(
        "This body is used by a parametric feature. Remove its dependent features first.",
      );
      return;
    }
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
      setImportProgress(null);
      setBusy(false);
    }
  }
  function requestNewDocument() {
    if (busy) return;
    if (dirty) setNewDocumentDialog(true);
    else newDocument();
  }
  function newDocument() {
    if (busy) return;
    setSketchPlaneDialog(false);
    setPlanePicking(false);
    setOriginVisible(true);
    setOriginPlane("OXY");
    sketchUndoSessions.current.clear();
    cancelSketchCreation();
    setSavedSketches([]);
    setActiveSketchId(null);
    legacySketch.current = rectangleSketch();
    setNewDocumentDialog(false);
    cad.current?.dispose();
    cad.current = new CadClient();
    knownKernelIds.current.clear();
    selectionAbort.current?.abort();
    selectionSessions.current.clear();
    setEntities([]);
    setSelectedId(null);
    setTriangleMask(null);
    setSelectionVersion((value) => value + 1);
    setName("Untitled project");
    setSketchDraft(rectangleSketch());
    setHistory([]);
    setFuture([]);
    setMeasure([]);
    setAnchor(null);
    setFit(null);
    setShowDeviation(false);
    setContextMenu(null);
    setPrimitiveDialog(false);
    setSettingsOpen(false);
    setToolPanelOpen(false);
    setMode("inspect");
    setRibbonTab("main");
    setTranslation([0, 0, 0]);
    setRotation([0, 0, 0]);
    setScale(1);
    setDirty(false);
    setError("");
    setMessage("New document created");
    if (fileInput.current) fileInput.current.value = "";
    viewport.current?.setView("iso");
  }
  async function openFile(file: File, unit?: ScanUnit) {
    if (!unit && /\.(stl|obj|ply)$/i.test(file.name)) {
      setPendingScanImport(file);
      return;
    }
    await action(`Opening ${file.name}…`, async () => {
      setImportProgress({
        name: file.name,
        fraction: /\.(stl|obj|ply|step|stp|iges|igs|brep)$/i.test(file.name)
          ? 0
          : null,
      });
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
          pendingImportFit.current = null;
          setEntities(restored);
          setSelectedId(
            project.authoring?.activeSketchId
              ? null
              : (restored[0]?.id ?? null),
          );
          setName(project.name);
          sketchUndoSessions.current.clear();
          setSavedSketches(project.authoring?.sketches ?? []);
          legacySketch.current = project.authoring?.sketch ?? rectangleSketch();
          setActiveSketchId(project.authoring?.activeSketchId ?? null);
          setSketchDraft(
            project.authoring?.sketches?.find(
              (s) => s.id === project.authoring?.activeSketchId,
            )?.sketch ??
              project.authoring?.sketch ??
              rectangleSketch(),
          );
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
            (fraction) => setImportProgress({ name: file.name, fraction }),
          );
          entity = {
            id: crypto.randomUUID(),
            name: file.name,
            kind: "cad",
            ...result,
            color: DEFAULT_PART_COLOR,
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
              unit,
              placeAtOrigin: true,
              previewTriangles: previewImport ? 250_000 : undefined,
              onSource: (source) => {
                scanSource = source;
              },
              signal: controller.signal,
              onProgress: (progress) => {
                setImportProgress({ name: file.name, fraction: progress });
                setMessage(
                  `Opening ${file.name} · ${Math.round(progress * 100)}%`,
                );
              },
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
            color: DEFAULT_PART_COLOR,
            visible: true,
            opacity: 1,
            source: file.name,
            scanSource,
          };
        }
        pendingImportFit.current = entity.id;
        commit([...entities, entity]);
        setSelectedId(entity.id);
      }
      setMessage(
        `Opened ${file.name}${unit ? ` · ${SCAN_UNITS[unit].label} converted to mm` : ""}`,
      );
    });
  }
  function growSelection(clickedSeeds?: Uint8Array, remove = false) {
    if (
      !selected ||
      busy ||
      (!clickedSeeds && (!triangleMask || !selectedTriangleCount))
    )
      return;
    const source = selected;
    const seeds = new Uint8Array(clickedSeeds ?? triangleMask!);
    const baseline = new Uint8Array(sessionFor(source).state.mask);
    const through = brushRef.current.through;
    void action("Growing connected selection…", async () => {
      const controller = new AbortController();
      selectionAbort.current = controller;
      try {
        const result = await processMesh(
          {
            kind: "connectedSelection",
            positions: source.positions,
            seeds,
            tolerance: selectionTolerance,
            angleDegrees: selectionAngle,
            allConnected,
          },
          {
            signal: controller.signal,
            onProgress: (fraction, stage) =>
              setMessage(stage + " · " + Math.round(fraction * 100) + "%"),
            reuseTopology: true,
          },
        );
        if (
          !result.selection ||
          result.selection.length !== source.positions.length / 9
        )
          throw new Error("Invalid connected selection result.");
        const region =
          clickedSeeds && !allConnected && !through
            ? await viewport.current!.visibleSelection(
                source.id,
                result.selection,
              )
            : result.selection;
        if (controller.signal.aborted) return;
        changeSelection((previous) =>
          clickedSeeds
            ? Uint8Array.from(region, (value, index) =>
                value ? (remove ? 0 : 1) : (previous?.[index] ?? 0),
              )
            : region,
        );
        if (clickedSeeds) {
          wandRegion.current = {
            entityId: source.id,
            positions: source.positions,
            seeds,
            baseline,
            subtract: remove,
            angle: selectionAngle,
            tolerance: selectionTolerance,
            allConnected,
            through,
          };
          setWandVersion((version) => version + 1);
        }
        setMessage(
          selectionCount(region) +
            (remove
              ? " triangles in subtraction region"
              : " triangles in connected selection region"),
        );
      } catch (error) {
        if (controller.signal.aborted)
          setMessage("Selection cancelled; previous selection retained.");
        else throw error;
      } finally {
        selectionAbort.current = null;
      }
    });
  }
  function editSelection(operation: "copy" | "cut" | "delete") {
    if ((selected?.parametric || selected?.kernelId) && operation !== "copy") {
      setError(
        "Parametric bodies retain exact CAD dependencies. Use a separate mesh copy for triangle edits.",
      );
      return;
    }
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
        meshSelection: undefined,
        kernelId: undefined,
        brep: undefined,
        surfacePatch: undefined,
        surfaceScanId: undefined,
        fit: undefined,
        parametric: undefined,
      };
      next.push(created);
      setSelectedId(created.id);
    } else if (!remainder.length) setSelectedId(next[0]?.id ?? null);
    operationLabel.current = `${operation === "copy" ? "Copy" : operation === "cut" ? "Cut" : "Delete"} ${selectedTriangleCount} triangles`;
    commit(next);
    operationLabel.current = null;
    changeSelection(null);
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
      color: DEFAULT_PART_COLOR,
      visible: true,
      opacity: 0.85,
      parametric: featureBinding(label, { kind: "primitive", input }),
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
            planeFrame: {
              center: [...fit.center],
              normal: [...fit.axis],
              tangent: new THREE.Vector3(1, 0, 0)
                .applyQuaternion(q)
                .toArray() as Vec3,
            },
            positions: geometryPositions(geometry),
            color: DEFAULT_REFERENCE_COLOR,
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
    if (selected?.kernelId) {
      cadOperation(
        "Transform body",
        () =>
          cad.current!.transform(
            selected.kernelId!,
            translation,
            rotation,
            scale,
          ),
        undefined,
        (refs) => ({
          kind: "transform",
          source: refs[0],
          translation,
          rotation,
          scale,
        }),
        [selected.id],
        true,
      );
      return;
    }
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
        updateSelected({
          positions,
          planeFrame: selected.planeFrame
            ? transformPlaneFrame(
                selected.planeFrame,
                translation,
                rotation,
                scale,
              )
            : undefined,
        });
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
      const bound = bindFeatureInputs(entities, [selected.id, other.id]);
      const entity: Entity = {
        id: crypto.randomUUID(),
        name: `${operation} result`,
        kind: "cad",
        ...result,
        color: DEFAULT_PART_COLOR,
        visible: true,
        opacity: 1,
        parametric: featureBinding(`${operation} result`, {
          kind: "boolean",
          operation,
          first: bound.refs[0],
          second: bound.refs[1],
        }),
      };
      commit([
        ...bound.entities.map((e) =>
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
  function cancelSketchCreation() {
    sketchSectionAbort.current?.abort();
    sketchSectionAbort.current = null;
    createSketchRef.current = null;
    setCreateSketch(null);
    setToolPanelOpen(false);
  }
  function openSketchCreation() {
    if (busy) return;
    setMode("inspect");
    setToolPanelOpen(false);
    setPlanePicking(true);
    setMessage("Select the plane for your sketch");
  }
  function createPlaneSketch(frame: SketchFrame) {
    try {
      validateSketchFrame(frame);
      const worldPlane = ORIGIN_PLANES.find((plane) => {
        const base = coordinateSketchFrame(plane, 0);
        return (
          base.u.every((n, i) => n === frame.u[i]) &&
          base.v.every((n, i) => n === frame.v[i])
        );
      });
      if (worldPlane) setOriginPlane(worldPlane);
      const item: SavedSketch = {
        id: crypto.randomUUID(),
        name: `Sketch ${savedSketches.length + 1}`,
        sketch: {
          version: 1,
          points: [],
          segments: [],
          constraints: [],
          frame,
        },
      };
      setSavedSketches((previous) => [...previous, item]);
      setSketchDraft(item.sketch);
      setSelectedId(null);
      setActiveSketchId(item.id);
      setSketchDrawingTool("line");
      setSketchPlaneDialog(false);
      setPlanePicking(false);
      setMode("inspect");
      setDirty(true);
      showTools("sketch");
      viewport.current?.viewReferencePlane(frame);
      setMessage(
        "Sketch created · coordinates and dimensions are in the selected plane",
      );
    } catch (e) {
      setError(errorText(e));
    }
  }
  function openScanSketchCreation() {
    if (!selected || selected.kind !== "mesh" || selected.surfacePatch) {
      showTools("sketch");
      setError(
        "Select a scan mesh to create section references. Saved sketches remain editable.",
      );
      return;
    }
    setMode("inspect");
    setToolPanelOpen(true);
    setError("");
    setCreateSketch({
      source: selected,
      hidden: [...(selected.meshSelection?.hidden ?? [])],
      selection: triangleMask ? new Uint8Array(triangleMask) : undefined,
    });
  }
  async function applySketchSection(options: SketchSectionOptions) {
    const session = createSketchRef.current;
    if (!session || busy) return;
    setCreateSketch({ ...session, preview: undefined });
    await action("Extracting sketch reference section…", async () => {
      const controller = new AbortController();
      sketchSectionAbort.current = controller;
      try {
        const result = await processMesh(
          {
            kind: "sketchSection",
            positions: session.source.positions,
            sourceId: session.source.id,
            hidden: session.hidden,
            selection: session.selection,
            options,
            sampled:
              !!session.source.scanSource &&
              session.source.scanSource.displayedTriangles <
                session.source.scanSource.triangles,
          },
          {
            signal: controller.signal,
            onProgress: (_, stage) => setMessage(stage),
          },
        );
        if (
          controller.signal.aborted ||
          createSketchRef.current?.source !== session.source
        )
          return;
        if (!result.sketchSection)
          throw new Error("Section extraction returned no reference data.");
        setCreateSketch({ ...session, preview: result.sketchSection });
      } finally {
        if (sketchSectionAbort.current === controller)
          sketchSectionAbort.current = null;
      }
    });
  }
  function acceptSketchSection() {
    const session = createSketchRef.current;
    if (
      busy ||
      !session?.preview ||
      !entities.some(
        (e) =>
          e.id === session.source.id &&
          e.positions === session.source.positions,
      )
    )
      return;
    const item: SavedSketch = {
      id: crypto.randomUUID(),
      name: `Sketch ${savedSketches.length + 1}`,
      sketch: {
        version: 1,
        points: [],
        segments: [],
        constraints: [],
        frame: session.preview.frame,
        reference: session.preview.reference,
      },
    };
    setSavedSketches((previous) => [...previous, item]);
    setSketchDraft(item.sketch);
    setSelectedId(null);
    setActiveSketchId(item.id);
    setDirty(true);
    cancelSketchCreation();
    showTools("sketch");
    setMessage(
      "Sketch reference section created · draw or fit editable curves",
    );
  }
  function updateSketchDraft(sketch: Sketch) {
    const key = activeSketchId ? `saved:${activeSketchId}` : "legacy";
    let session = sketchUndoSessions.current.get(key);
    if (!session) {
      session = new SketchUndo();
      sketchUndoSessions.current.set(key, session);
    }
    session.record(sketchDraft, sketch);
    applySketchDraft(sketch);
  }
  function sketchUndo(repeat = false) {
    if (busy) return;
    const key = activeSketchId ? `saved:${activeSketchId}` : "legacy";
    const session = sketchUndoSessions.current.get(key);
    const sketch = repeat
      ? session?.redo(sketchDraft)
      : session?.undo(sketchDraft);
    if (!sketch) return;
    applySketchDraft(sketch);
    setMessage(repeat ? "Sketch edit reapplied" : "Sketch edit undone");
  }
  function applySketchDraft(sketch: Sketch) {
    setError("");
    setSketchDraft(sketch);
    if (!activeSketchId) legacySketch.current = sketch;
    if (activeSketchId)
      setSavedSketches((previous) =>
        previous.map((s) => (s.id === activeSketchId ? { ...s, sketch } : s)),
      );
    setDirty(true);
  }
  function extrude(
    points: [number, number][],
    height: number,
    sketchProfile?: { sketch: Sketch; chordTolerance: number },
  ) {
    void action("Extruding polygon sketch…", async () => {
      const result = await cad.current!.extrude(
        points,
        height,
        sketchProfile?.sketch.frame,
      );
      const entity: Entity = {
        id: crypto.randomUUID(),
        name: "Polygon extrusion",
        kind: "cad",
        ...result,
        color: DEFAULT_PART_COLOR,
        visible: true,
        opacity: 1,
        parametric: featureBinding("Polygon extrusion", {
          kind: "extrude",
          profile: sketchProfile
            ? { kind: "sketch", ...sketchProfile }
            : { kind: "polygon", points },
          height,
        }),
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
      color: DEFAULT_FREEFORM_COLOR,
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
    if (selected?.parametric?.feature.recipe.kind === "surface") {
      rebuildFeature({ kind: "surface", patch });
      return;
    }
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
        color: DEFAULT_PART_COLOR,
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
    recipe?: ParametricRecipe | ((refs: FeatureRef[]) => ParametricRecipe),
    inputIds: string[] = [],
    hideInputs = false,
  ) {
    void action(label, async () => {
      const bound = bindFeatureInputs(entities, inputIds);
      const authoring = recipe
        ? featureBinding(
            label,
            typeof recipe === "function" ? recipe(bound.refs) : recipe,
          )
        : undefined;
      if (authoring)
        entityFeatureModel([
          ...bound.entities,
          { parametric: authoring } as Entity,
        ]);
      const result = await run();
      const entity: Entity = {
        ...result,
        id: crypto.randomUUID(),
        name: label.replace(/…$/, ""),
        kind: "cad",
        color: DEFAULT_PART_COLOR,
        opacity: 1,
        visible: true,
        surfacePatch: patch,
        parametric: authoring,
      };
      commit([
        ...bound.entities.map((input) =>
          hideInputs && inputIds.includes(input.id)
            ? { ...input, visible: false }
            : input,
        ),
        entity,
      ]);
      setSelectedId(entity.id);
      setMessage(`${entity.name} created as exact CAD`);
    });
  }
  function featureBinding(
    label: string,
    recipe: ParametricRecipe,
  ): NonNullable<Entity["parametric"]> {
    return {
      feature: {
        id: crypto.randomUUID(),
        name: label,
        recipe: structuredClone(recipe),
      },
      output: 0,
    };
  }
  function rebuildFeature(recipe: ParametricRecipe) {
    void action("Rebuilding parametric features…", async () => {
      if (!selected?.parametric) throw new Error("Select a parametric body.");
      const previous = entityFeatureState(entities);
      const featureId = selected.parametric.feature.id;
      if (
        (recipe.kind === "split") !==
        (selected.parametric.feature.recipe.kind === "split")
      )
        throw new Error(
          "A recipe edit must preserve its number of outputs. Create a separate split feature instead.",
        );
      const model = {
        ...previous.model,
        features: previous.model.features.map((feature) =>
          feature.id === featureId ? { ...feature, recipe } : feature,
        ),
      };
      const preserveKernelIds = new Set(
        [
          ...entities,
          ...history.flatMap((revision) => revision.entities),
          ...future.flatMap((revision) => revision.entities),
        ].flatMap((entity) => (entity.kernelId ? [entity.kernelId] : [])),
      );
      const rebuilt = await rebuildParametric(
        previous,
        model,
        createCadEvaluator(cad.current!),
        { preserveKernelIds },
      );
      const recipes = new Map(
        rebuilt.model.features.map((feature) => [feature.id, feature]),
      );
      commit(
        entities.map((entity) => {
          const binding = entity.parametric;
          if (!binding) return entity;
          const feature = recipes.get(binding.feature.id)!;
          const result = rebuilt.results[feature.id][binding.output];
          return {
            ...entity,
            ...result,
            parametric: { feature, output: binding.output },
            surfacePatch:
              feature.recipe.kind === "surface"
                ? feature.recipe.patch
                : undefined,
          };
        }),
      );
      if (rebuilt.cleanupFailures.length)
        setError(
          rebuilt.cleanupFailures.map((failure) => failure.message).join("; "),
        );
      setMessage(
        `Rebuilt ${rebuilt.rebuiltFeatureIds.length} dependent features · previous CAD retained for Undo`,
      );
    });
  }
  function save() {
    setSaveDialogOpen(true);
  }
  function saveNamedProject(projectName: string) {
    setSaveDialogOpen(false);
    void action("Saving project…", async () => {
      download(
        await serializeProjectBlob(projectName, entities, {
          sketch: activeSketchId ? legacySketch.current : sketchDraft,
          sketches: savedSketches,
          activeSketchId: activeSketchId ?? undefined,
        }),
        `${projectName.replace(/[^a-z0-9-_ ]/gi, "_")}.scanforge`,
        "application/json",
      );
      setName(projectName);
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
        color: DEFAULT_PART_COLOR,
        visible: true,
        opacity: 1,
        parametric: featureBinding("Revolved solid", {
          kind: "revolve",
          points,
          angleDegrees: angle,
        }),
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
      <Ribbon
        utilityHeader={
          <header className="header">
            <div className="header-actions">
              <SpaceMouseConnection
                compact
                status={spaceMouseStatus}
                connected={spaceMouse.current?.connected ?? false}
                connecting={spaceMouseConnecting}
                available={!!(navigator as Navigator & { hid?: HidAccess }).hid}
                onConnect={() => void connectSpaceMouse()}
                onSettings={() => setSettingsOpen(true)}
              />
              <HeaderIconButton
                label="Open scan"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <FolderOpen size={17} aria-hidden="true" />
              </HeaderIconButton>
              <SaveProjectButton dirty={dirty} disabled={busy} onSave={save} />
              <HeaderIconButton
                label="Export STEP"
                disabled={busy}
                onClick={exportStep}
              >
                <Download size={17} aria-hidden="true" />
              </HeaderIconButton>
              <HeaderIconButton
                label="Settings"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={17} aria-hidden="true" />
              </HeaderIconButton>
              <ApplicationVersion />
            </div>
          </header>
        }
        activeTab={ribbonTab}
        onTabChange={setRibbonTab}
        disabled={busy || !!nPoints || !!surfaceFit || !!createSketch}
        hasSelection={!!selected}
        canUndo={!!history.length}
        canRedo={!!future.length}
        actions={{
          newDocument: requestNewDocument,
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
          transform: () => showTools("transform"),
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
          objectColor: () => showTools("properties"),
          loft: () => showTools("advancedCad"),
          sweep: () => showTools("advancedCad"),
          fillet: () => showTools("advancedCad"),
          chamfer: () => showTools("advancedCad"),
          surfaceOffset: () => showTools("advancedCad"),
          sewSurfaces: () => showTools("advancedCad"),
          shell: () => showTools("advancedCad"),
          surfaceThicken: () => showTools("advancedCad"),
          fitSurface: openSurfaceFit,
          nurbsSurface: () => showTools("surface"),
          newFreeform: () => showTools("surface"),
          autoFreeform: () => showTools("surface"),
          quadObj: () => showTools("surface"),
          sketch2d: openSketchCreation,
          reducePolygons: () => openScanTool("reducePolygons"),
          reduceNoise: () => openScanTool("reduceNoise"),
          scaleMesh: () => openScanTool("scaleMesh"),
          flipNormals: () => {
            if (busy || scanToolAbort.current) return;
            dismissScanTool();
            void applyScanTool({ kind: "flipNormals" });
          },
          repolygonize: () => openScanTool("repolygonize"),
          averageMesh: () => openScanTool("averageMesh"),
          mirrorMesh: () => openScanTool("mirrorMesh"),
          unroll: () => openScanTool("unroll"),
          fineAlign: () => showTools("processing"),
          alignNPoints: openLandmarks,
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
      {pendingScanImport && (
        <ImportUnitsDialog
          onCancel={() => setPendingScanImport(null)}
          onImport={(unit) => {
            const file = pendingScanImport;
            setPendingScanImport(null);
            void openFile(file, unit);
          }}
        />
      )}
      {sketchPlaneDialog && (
        <SketchPlaneDialog
          initialPlane={originPlane}
          entities={entities}
          onCreate={createPlaneSketch}
          onCancel={() => setSketchPlaneDialog(false)}
          onScanSection={
            selected?.kind === "mesh" && !selected.surfacePatch
              ? () => {
                  setSketchPlaneDialog(false);
                  openScanSketchCreation();
                }
              : undefined
          }
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          label={
            contextMenu.kind === "saved"
              ? "Saved selection actions"
              : contextMenu.kind === "object"
                ? "Object actions"
                : contextMenu.kind === "history"
                  ? "History actions"
                  : workspace === "sketch" && toolPanelOpen && !createSketch
                    ? "Sketch actions"
                    : "Viewport selection actions"
          }
          onClose={closeContextMenu}
          actions={
            contextMenu.kind === "saved"
              ? [
                  {
                    label: "Restore saved selection",
                    disabled: busy || !selected,
                    run: () => {
                      if (selected && contextMenu.savedId)
                        restoreSelection(selected, contextMenu.savedId);
                    },
                  },
                  {
                    label: "Delete saved selection",
                    disabled: busy || !selected,
                    run: () => {
                      if (selected && contextMenu.savedId)
                        updateSelected({
                          meshSelection: {
                            hidden: selected.meshSelection?.hidden ?? [],
                            saved:
                              selected.meshSelection?.saved.filter(
                                (s) => s.id !== contextMenu.savedId,
                              ) ?? [],
                          },
                        });
                    },
                  },
                  { label: "Close menu", run: () => {} },
                ]
              : contextMenu.kind === "history"
                ? [
                    {
                      label: "Restore this revision",
                      disabled:
                        busy ||
                        contextMenu.revision === undefined ||
                        contextMenu.revision > history.length + future.length,
                      run: () => {
                        if (contextMenu.revision !== undefined)
                          restoreRevision(contextMenu.revision);
                      },
                    },
                    {
                      label: "Undo",
                      disabled: busy || !history.length,
                      run: undo,
                    },
                    {
                      label: "Redo",
                      disabled: busy || !future.length,
                      run: redo,
                    },
                    { label: "Close menu", run: () => {} },
                  ]
                : contextMenu.kind === "object"
                  ? [
                      {
                        label: "Object properties",
                        disabled: busy,
                        run: () => showTools("properties"),
                      },
                      {
                        label: selected?.visible
                          ? "Hide object"
                          : "Show object",
                        disabled: busy || !selected,
                        run: () => {
                          if (selected)
                            commit(
                              entities.map((e) =>
                                e.id === selected.id
                                  ? { ...e, visible: !e.visible }
                                  : e,
                              ),
                            );
                        },
                      },
                      {
                        label: "Edit scan selection",
                        disabled: busy || !selected || selected.kind !== "mesh",
                        run: () => {
                          setMode("brush");
                          setWorkspace("mesh");
                          setToolPanelOpen(true);
                        },
                      },
                      {
                        label: "Delete object",
                        disabled: busy || !selected,
                        run: deleteSelected,
                      },
                      { label: "Close menu", run: () => {} },
                    ]
                  : workspace === "sketch" && toolPanelOpen && !createSketch
                    ? [
                        {
                          label: "Undo",
                          disabled:
                            busy ||
                            !sketchUndoSessions.current.get(
                              activeSketchId
                                ? `saved:${activeSketchId}`
                                : "legacy",
                            )?.canUndo,
                          run: () => sketchUndo(),
                        },
                        {
                          label: "Redo",
                          disabled:
                            busy ||
                            !sketchUndoSessions.current.get(
                              activeSketchId
                                ? `saved:${activeSketchId}`
                                : "legacy",
                            )?.canRedo,
                          run: () => sketchUndo(true),
                        },
                        {
                          label: "Normal to sketch",
                          disabled: busy,
                          run: () => viewport.current?.viewSketchNormal(),
                        },
                        { label: "Close menu", run: () => {} },
                      ]
                    : [
                        {
                          label: "Fit visible objects",
                          disabled: busy,
                          run: () => viewport.current?.fitView(),
                        },
                        {
                          label: "Object properties",
                          disabled: busy || !selected,
                          run: () => showTools("properties"),
                        },
                        {
                          label: "Edit scan selection",
                          disabled: busy || !selected,
                          run: () => {
                            setMode("brush");
                            setWorkspace("mesh");
                            setToolPanelOpen(true);
                          },
                        },
                        {
                          label: "Select all triangles",
                          disabled: busy || !selected,
                          run: () => {
                            if (selected)
                              changeSelection(
                                new Uint8Array(
                                  selected.positions.length / 9,
                                ).fill(1),
                              );
                          },
                        },
                        {
                          label: "Invert triangle selection",
                          disabled: busy || !selected,
                          run: () => {
                            if (selected)
                              changeSelection(
                                Uint8Array.from(
                                  { length: selected.positions.length / 9 },
                                  (_, i) => (triangleMask?.[i] ? 0 : 1),
                                ),
                              );
                          },
                        },
                        {
                          label: "Hide selected triangles",
                          disabled: busy || !selectedTriangleCount,
                          run: () => selectionVisibility("hide"),
                        },
                        {
                          label: "Isolate selected triangles",
                          disabled: busy || !selectedTriangleCount,
                          run: () => selectionVisibility("isolate"),
                        },
                        {
                          label: "Show hidden triangles",
                          disabled:
                            busy || !selected?.meshSelection?.hidden.length,
                          run: () => selectionVisibility("reveal"),
                        },
                        {
                          label: "Undo selection",
                          disabled: busy || !selectionSession?.canUndo,
                          run: () => selectionUndo(),
                        },
                        {
                          label: "Redo selection",
                          disabled: busy || !selectionSession?.canRedo,
                          run: () => selectionUndo(true),
                        },
                        {
                          label: "Save selection",
                          disabled: busy || !selectedTriangleCount,
                          run: () => {
                            setMode("brush");
                            setWorkspace("mesh");
                            setToolPanelOpen(true);
                          },
                        },
                        {
                          label: "Clear triangle selection",
                          disabled: busy,
                          run: () => changeSelection(null),
                        },
                        {
                          label: "Copy selected triangles",
                          disabled: busy || !selectedTriangleCount,
                          run: () => editSelection("copy"),
                        },
                        {
                          label: "Cut selected triangles",
                          disabled: busy || !selectedTriangleCount,
                          run: () => editSelection("cut"),
                        },
                        {
                          label: "Delete selected triangles",
                          disabled: busy || !selectedTriangleCount,
                          run: () => editSelection("delete"),
                        },
                        { label: "Close menu", run: () => {} },
                      ]
          }
        />
      )}
      <main className="workspace">
        {workspace === "mesh" &&
          mode === "brush" &&
          quickToolsEnabled &&
          quickToolsPoint &&
          selectedTriangleCount > 0 &&
          !busy && (
            <ScanQuickTools
              x={quickToolsPoint.x}
              y={quickToolsPoint.y}
              onSmooth={() => {
                setQuickToolsPoint(null);
                void runScanEdit(
                  {
                    action: "smoothSelected",
                    selection: triangleMask ?? undefined,
                  },
                  "Smooth selected area",
                );
              }}
              onDefeature={() => {
                setQuickToolsPoint(null);
                void runScanEdit(
                  { action: "defeature", selection: triangleMask ?? undefined },
                  "Defeature selected area",
                );
              }}
              onDelete={() => {
                setQuickToolsPoint(null);
                editSelection("delete");
              }}
              onHide={() => {
                setQuickToolsPoint(null);
                selectionVisibility("hide");
              }}
              onIsolate={() => {
                setQuickToolsPoint(null);
                selectionVisibility("isolate");
              }}
              onInvert={() =>
                changeSelection(
                  Uint8Array.from(
                    { length: selected!.positions.length / 9 },
                    (_, i) => (triangleMask?.[i] ? 0 : 1),
                  ),
                )
              }
            />
          )}
        <aside
          className="explorer"
          inert={busy || !!nPoints || !!surfaceFit || !!createSketch}
        >
          <div className="objects-panel">
            <h2>
              Objects <Layers size={15} />
              <span className="objects-count">
                {entities.length + savedSketches.length}
              </span>
            </h2>
            <CoordinateSystem
              visible={originVisible}
              onVisible={setOriginVisible}
              onSketch={openSketchCreation}
            />
            <ul className="object-list">
              {entities.map((entity) => (
                <li
                  key={entity.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (busy) return;
                    setSelectedId(entity.id);
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      kind: "object",
                      objectId: entity.id,
                    });
                  }}
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
                    disabled={busy}
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
                  {!!entity.meshSelection?.saved.length && (
                    <ul className="saved-selection-list">
                      {entity.meshSelection.saved.map((saved) => (
                        <li
                          key={saved.id}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (!busy) {
                              setSelectedId(entity.id);
                              setContextMenu({
                                x: event.clientX,
                                y: event.clientY,
                                kind: "saved",
                                savedId: saved.id,
                                objectId: entity.id,
                              });
                            }
                          }}
                        >
                          <button
                            title="Double-click to restore selection"
                            onDoubleClick={() =>
                              restoreSelection(entity, saved.id)
                            }
                          >
                            {saved.name}
                          </button>
                          <button
                            aria-label={`Restore selection ${saved.name}`}
                            onClick={() => restoreSelection(entity, saved.id)}
                          >
                            Restore
                          </button>
                          <button
                            aria-label={`Delete selection ${saved.name}`}
                            onClick={() => {
                              setEntities((previous) =>
                                previous.map((e) =>
                                  e.id === entity.id
                                    ? {
                                        ...e,
                                        meshSelection: {
                                          hidden: e.meshSelection?.hidden ?? [],
                                          saved: e.meshSelection!.saved.filter(
                                            (s) => s.id !== saved.id,
                                          ),
                                        },
                                      }
                                    : e,
                                ),
                              );
                              setDirty(true);
                            }}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            {savedSketches.length > 0 && (
              <ul className="object-list" aria-label="Sketch objects">
                {savedSketches.map((item) => (
                  <li
                    key={item.id}
                    className={activeSketchId === item.id ? "selected" : ""}
                  >
                    <button
                      className="object-name"
                      onClick={() => {
                        setSelectedId(null);
                        setActiveSketchId(item.id);
                        setSketchDraft(item.sketch);
                        showTools("sketch");
                      }}
                    >
                      <ScanLine size={16} />
                      <span>{item.name}</span>
                    </button>
                    <button
                      aria-label={`Delete ${item.name}`}
                      onClick={() => {
                        sketchUndoSessions.current.delete(`saved:${item.id}`);
                        setSavedSketches((previous) =>
                          previous.filter((s) => s.id !== item.id),
                        );
                        if (activeSketchId === item.id) {
                          setActiveSketchId(null);
                          setSketchDraft(legacySketch.current);
                        }
                        setDirty(true);
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
        <section className="canvas-area" aria-label="3D viewport">
          <div ref={viewportHost} className="viewport" />
          {activeNoiseComparison?.kind === "reducePolygons" &&
            activeNoiseComparison.visible &&
            activeNoiseComparison.statistics && (
              <ReductionColorScale
                threshold={
                  activeNoiseComparison.displayRange ??
                  activeNoiseComparison.statistics.tolerance
                }
                tolerance={activeNoiseComparison.statistics.tolerance}
                lowerTolerance={activeNoiseComparison.lowerTolerance}
                upperTolerance={activeNoiseComparison.upperTolerance}
                disabled={busy}
                onToleranceChange={(lower, upper) =>
                  setNoiseComparison((previous) => {
                    if (
                      !previous?.statistics ||
                      !previous.sampleDistances ||
                      previous.kind !== "reducePolygons"
                    )
                      return previous;
                    return {
                      ...previous,
                      lowerTolerance: lower,
                      upperTolerance: upper,
                      statistics: {
                        ...previous.statistics,
                        ...toleranceCoverage(
                          previous.sampleDistances,
                          lower,
                          upper,
                        ),
                      },
                    };
                  })
                }
              />
            )}
          {dragging && (
            <div className="drop-overlay">Drop a scan or CAD file to open</div>
          )}
          {busy && selectionAbort.current && (
            <div className="import-progress">
              <span>{message}</span>
              <button onClick={() => selectionAbort.current?.abort()}>
                Cancel connected selection
              </button>
            </div>
          )}
          <ViewportTools
            flat={flatShading}
            grid={floorGrid}
            spacing={gridSpacing}
            snap={snapGrid}
            hasSelection={!!selected}
            onFlat={setFlatShading}
            onGrid={setFloorGrid}
            onSpacing={setGridSpacing}
            onSnap={setSnapGrid}
            onFitSelection={() =>
              viewport.current?.fitView(selected?.id, triangleMask ?? undefined)
            }
            onFitAll={() => viewport.current?.fitView()}
          />

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
          <CanvasError message={error} onDismiss={() => setError("")} />
        </section>
        {createSketch && (
          <CreateSketchDialog
            source={createSketch.source}
            preview={createSketch.preview}
            busy={busy}
            onApply={(options) => void applySketchSection(options)}
            onCreate={acceptSketchSection}
            onCancel={cancelSketchCreation}
          />
        )}
        {surfaceFit && (
          <FitSurfaceDialog
            session={surfaceFit}
            busy={busy}
            onApply={(options) => void previewSurfaceFit(options)}
            onAccept={acceptSurfacePreview}
            onCancel={cancelSurfaceFit}
          />
        )}
        {nPoints && (
          <LandmarkAlignmentDialog
            session={nPoints}
            targets={entities.filter(
              (e) => e.id !== nPoints.moving.id && e.positions.length >= 9,
            )}
            busy={busy}
            pickSide={landmarkPickSide}
            onPickSide={(side) => {
              setLandmarkPickSide(side);
              setNPoints({ ...nPoints, preview: undefined });
            }}
            onTarget={(id) => {
              const fixed = entities.find((e) => e.id === id);
              if (fixed)
                setNPoints(beginLandmarkAlignment(nPoints.moving, fixed));
            }}
            onRemoveLast={() =>
              setNPoints({
                ...nPoints,
                picks: nPoints.picks.slice(0, -1),
                preview: undefined,
              })
            }
            onRemoveAll={() =>
              setNPoints({ ...nPoints, picks: [], preview: undefined })
            }
            onPreview={previewLandmarks}
            onAccept={acceptLandmarks}
            onCancel={cancelLandmarks}
          />
        )}
        <aside
          className={`inspector ${workspace === "scanTools" || (workspace === "mesh" && selected) ? "command-host" : ""}`}
          style={
            nPoints || surfaceFit || createSketch
              ? { display: "none" }
              : undefined
          }
          inert={actionBusy}
          aria-label="Tool options"
        >
          {!(
            workspace === "scanTools" &&
            !selected?.kernelId &&
            !selected?.parametric
          ) &&
            !(workspace === "mesh" && selected && scanPanel) && (
              <h2>
                {(
                  {
                    mesh: "Edit scan",
                    scanTools: "Exact CAD body",
                    sketch: "Sketch tools",
                    surface: "Surface tools",
                    fit: "Fit primitives",
                    transform: "Transform",
                    section: "Cross section",
                    reconstruct: "Reconstruction tools",
                    advancedCad: "CAD tools",
                    processing: "Mesh processing",
                    measure: "Measure",
                    deviation: "Deviation analysis",
                    properties: "Object properties",
                  } as Record<string, string>
                )[workspace] ?? "Object properties"}{" "}
                <button
                  aria-label="Close tool options"
                  onClick={() => {
                    scanToolAbort.current?.abort();
                    scanReferencePick.current = null;
                    setToolPanelOpen(false);
                    if (workspace === "mesh") setMode("inspect");
                  }}
                >
                  <X size={15} />
                </button>
              </h2>
            )}
          {(workspace === "mesh" || workspace === "scanTools") &&
          (selected?.kernelId || selected?.parametric) ? (
            <section aria-label="Exact CAD body">
              <p>
                Original CAD surfaces and solid topology are retained in
                OpenCascade.
              </p>
              <p>
                Scan Data tools edit triangles. Create a separate mesh copy to
                use them.
              </p>
              <button
                onClick={() => {
                  const copy = scanMeshCopy(selected, crypto.randomUUID());
                  operationLabel.current = "Create mesh copy";
                  commit([...entities, copy]);
                  operationLabel.current = null;
                  setSelectedId(copy.id);
                }}
              >
                Create mesh copy
              </button>
            </section>
          ) : workspace === "scanTools" ? (
            <ScanToolsPanel
              key={`${scanTool}:${selected?.id}`}
              entities={entities}
              selected={selected}
              triangleSelection={triangleMask}
              tool={scanTool}
              disabled={actionBusy}
              busy={processingBusy}
              progress={scanToolProgress}
              progressFraction={
                scanTool === "reducePolygons" ? scanToolFraction : undefined
              }
              result={
                activeScanPreview ||
                selected?.positions === scanToolOutput.current
                  ? scanToolResult
                  : undefined
              }
              onApply={applyScanTool}
              previewReady={!!activeScanPreview}
              onAccept={
                scanTool === "reduceNoise" ||
                scanTool === "reducePolygons" ||
                scanTool === "scaleMesh" ||
                scanTool === "mirrorMesh"
                  ? acceptScanPreview
                  : undefined
              }
              onInvalidatePreview={() => setScanPreview(null)}
              onCompare={
                scanTool === "reduceNoise" || scanTool === "reducePolygons"
                  ? updateScanComparison
                  : undefined
              }
              comparison={
                activeNoiseComparison
                  ? {
                      threshold: activeNoiseComparison.threshold,
                      statistics: activeNoiseComparison.statistics,
                      visible: activeNoiseComparison.visible,
                    }
                  : undefined
              }
              onToggleComparison={() =>
                setNoiseComparison((previous) =>
                  previous ? { ...previous, visible: !previous.visible } : null,
                )
              }
              onClose={closeScanTool}
              onCancel={() => scanToolAbort.current?.abort()}
              pickedReferenceId={pickedScanReference}
              onPickReference={(kind) => {
                scanReferencePick.current = kind;
                setMode("inspect");
                setMessage(
                  `Pick a ${kind === "plane" ? "planar reference" : "cylinder"} on the canvas.`,
                );
              }}
            />
          ) : workspace === "mesh" && selected && scanPanel ? (
            <ScanTopologyPanels
              key={`${selected.id}-${scanPanel}`}
              section={scanPanel}
              positions={selected.positions}
              entities={entities}
              selectedId={selected.id}
              selection={triangleMask}
              onReplace={replaceScanPositions}
              onCreate={createSegments}
              onSelection={changeSelection}
              onBoundaryHighlight={setScanBoundaryPaths}
              onProject={projectScanBoundaries}
              onStatus={setMessage}
              onError={setError}
              onBusyChange={setProcessingBusy}
              onBack={() => setScanPanel(null)}
              wireframe={wireframe}
              onWireframe={setWireframe}
              onOpacity={(opacity) => updateSelected({ opacity })}
            />
          ) : workspace === "mesh" && selected ? (
            <EditScanDialog
              key={selected.id}
              name={selected.name}
              positions={selected.positions}
              tool={selectionTool}
              onTool={(tool) => {
                setScanBoundaryPaths([]);
                setSelectionTool(tool);
                setMode("brush");
              }}
              angle={selectionAngle}
              onAngle={setSelectionAngle}
              allConnected={allConnected}
              onAllConnected={setAllConnected}
              brushRadius={brushRadius}
              quickTools={quickToolsEnabled}
              onQuickTools={setQuickToolsEnabled}
              through={selectThrough}
              onThrough={setSelectThrough}
              busy={busy}
              onTopology={setScanPanel}
              onMorph={morphSelection}
              onSelectAll={() =>
                changeSelection(
                  new Uint8Array(selected.positions.length / 9).fill(1),
                )
              }
              onRevealSelected={revealSelectedTriangles}
              clip={meshClip}
              clipFull={stats ? { min: stats.min, max: stats.max } : undefined}
              onClip={setMeshClip}
              onSmooth={() =>
                runScanEdit(
                  {
                    action: "smoothSelected",
                    selection: triangleMask ?? undefined,
                  },
                  "Smooth selected area",
                )
              }
              onDefeature={() =>
                runScanEdit(
                  { action: "defeature", selection: triangleMask ?? undefined },
                  "Defeature selected area",
                )
              }
              cutters={entities.filter((entity) => entity.id !== selected.id)}
              onSplit={(targetId) => {
                const target = entities.find(
                  (entity) => entity.id === targetId,
                );
                if (target)
                  void runScanEdit(
                    {
                      action: "split",
                      target: target.positions,
                      plane:
                        target.kind === "plane" && target.fit
                          ? {
                              origin: target.fit.center,
                              normal: target.fit.axis,
                            }
                          : undefined,
                    },
                    "Split mesh",
                  );
              }}
              selectedCount={selectedTriangleCount}
              hiddenCount={selected.meshSelection?.hidden.length ?? 0}
              wireframe={wireframe}
              onWireframe={setWireframe}
              canUndo={!!selectionSession?.canUndo}
              canRedo={!!selectionSession?.canRedo}
              onUndo={() => selectionUndo()}
              onRedo={() => selectionUndo(true)}
              onClear={() => changeSelection(null)}
              onInvert={() =>
                changeSelection(
                  Uint8Array.from(
                    { length: selected.positions.length / 9 },
                    (_, index) => (triangleMask?.[index] ? 0 : 1),
                  ),
                )
              }
              onHide={() => selectionVisibility("hide")}
              onIsolate={() => selectionVisibility("isolate")}
              onReveal={() => selectionVisibility("reveal")}
              onCopy={() => editSelection("copy")}
              onCut={() => editSelection("cut")}
              onDelete={() => editSelection("delete")}
              onSave={saveSelection}
              onClose={() => {
                scanEditAbort.current?.abort();
                setToolPanelOpen(false);
                setMode("inspect");
              }}
            />
          ) : (
            <>
              {selected && stats ? (
                <>
                  <div inert={processingBusy || !!selectionAbort.current}>
                    <div className="selected-title">
                      <Triangle size={25} />
                      <div>
                        <input
                          aria-label="Object name"
                          value={selected.name}
                          maxLength={200}
                          onChange={(e) =>
                            updateSelected({ name: e.target.value })
                          }
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
                    <Panel title="Geometry" className="geometry-panel">
                      {selected.fit && (
                        <p className="muted">
                          {selected.fit.kind} fit · RMS{" "}
                          {number(selected.fit.rms)} mm · maximum residual{" "}
                          {number(selected.fit.maxError)} mm. Review fit quality
                          before reconstruction.
                        </p>
                      )}
                      {selected.scanSource &&
                        selected.scanSource.displayedTriangles <
                          selected.scanSource.triangles && (
                          <p role="note" className="muted">
                            Sampled source: {number(selected.scanSource.bytes)}{" "}
                            bytes · {number(selected.scanSource.triangles)}{" "}
                            source triangles ·{" "}
                            {number(selected.scanSource.displayedTriangles)}{" "}
                            imported triangles. Operations and exports use
                            sampled geometry, not the complete source.
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
                            updateSelected({
                              opacity: Number(e.target.value),
                            })
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
                              for (
                                let i = 0;
                                i < section.segments.length;
                                i += 6
                              )
                                rows.push(
                                  section.segments.slice(i, i + 6).join(","),
                                );
                              download(
                                rows.join("\n"),
                                "section.csv",
                                "text/csv",
                              );
                            }}
                          >
                            Export section CSV
                          </button>
                          <button
                            className="wide"
                            disabled={busy || !section.segments.length}
                            onClick={() =>
                              void action("Exporting section DXF…", () => {
                                download(
                                  exportSectionDxf(section),
                                  "section.dxf",
                                  "application/dxf",
                                );
                                setMessage(
                                  "Cross section exported to DXF · world XYZ millimetres",
                                );
                              })
                            }
                          >
                            Export section DXF
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
                              onChange={(e) =>
                                setShowDeviation(e.target.checked)
                              }
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
                            Analytical surface distances; cylinder fitting
                            requires a sampled side surface. Color map covers
                            the entire object.
                          </p>
                        </>
                      ) : (
                        <p className="muted">
                          Select a scan and fit a plane, sphere, cylinder or
                          cone from the tool rail. Fits report residuals; review
                          them before creating CAD.
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
              ) : activeSketchId && workspace === "sketch" ? (
                <div className="selected-title">
                  <ScanLine size={25} />
                  <div>
                    <strong>
                      {savedSketches.find((s) => s.id === activeSketchId)?.name}
                    </strong>
                    <small>
                      Sketch ·{" "}
                      {sketchDraft.reference
                        ? `${sketchDraft.reference.segments.length / 4} scan reference segments`
                        : "editable profile"}
                    </small>
                  </div>
                </div>
              ) : (
                <div className="empty-inspector">
                  Select an object to inspect its geometry, or create a new
                  surface or sketch.
                </div>
              )}
              <div className="surface-panels">
                <SurfaceTools
                  selectionId={selected?.id}
                  scan={
                    entities.find(
                      (entity) => entity.id === selected?.surfaceScanId,
                    )?.positions ?? selected?.positions
                  }
                  patch={selected?.surfacePatch}
                  onPatchChange={editSurface}
                  onCreateMesh={(positions, label) =>
                    createMesh(positions, label)
                  }
                  onCreateClosedCad={(patches, tolerance) =>
                    cadOperation(
                      "Closed patch solid",
                      () => cad.current!.closedShell(patches, tolerance),
                      undefined,
                      { kind: "closedShell", patches, tolerance },
                    )
                  }
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
                      { kind: "surface", patch: selected!.surfacePatch! },
                    )
                  }
                >
                  Create exact NURBS CAD face
                </button>
              </div>
              <div className="sketch-panels">
                <SketchTools
                  value={sketchDraft}
                  drawingTool={sketchDrawingTool}
                  onDrawingTool={setSketchDrawingTool}
                  drawingConstraints={sketchDrawingConstraints}
                  onDrawingConstraints={setSketchDrawingConstraints}
                  onNormalView={() => viewport.current?.viewSketchNormal()}
                  canUndo={
                    sketchUndoSessions.current.get(
                      activeSketchId ? `saved:${activeSketchId}` : "legacy",
                    )?.canUndo
                  }
                  canRedo={
                    sketchUndoSessions.current.get(
                      activeSketchId ? `saved:${activeSketchId}` : "legacy",
                    )?.canRedo
                  }
                  onUndo={() => sketchUndo()}
                  onRedo={() => sketchUndo(true)}
                  showControlPoints={sketchControlPoints}
                  onShowControlPoints={setSketchControlPoints}
                  showMeshPoints={sketchMeshPoints}
                  onShowMeshPoints={setSketchMeshPoints}
                  onChange={updateSketchDraft}
                  onExtrude={extrude}
                  disabled={busy}
                />
              </div>
              <div className="processing-panels">
                <MeshTools
                  entities={entities}
                  selected={selected}
                  triangleSelection={triangleMask}
                  disabled={busy}
                  onBusyChange={setProcessingBusy}
                  onReplace={(positions, label) => {
                    if (selected?.parametric) {
                      createSegments([positions], label);
                      return;
                    }
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
                <ParametricTools
                  selected={selected ?? undefined}
                  disabled={busy}
                  onRebuild={rebuildFeature}
                  onError={setError}
                />
                <AdvancedCadTools
                  entities={entities}
                  selected={selected}
                  disabled={busy}
                  onError={setError}
                  onLoft={(profiles, ruled) =>
                    cadOperation(
                      "Loft",
                      () => cad.current!.loft(profiles, ruled),
                      undefined,
                      { kind: "loft", profiles, ruled },
                    )
                  }
                  onPattern={(pattern) =>
                    cadOperation(
                      `${pattern.kind} pattern`,
                      () => cad.current!.pattern(selected!.kernelId!, pattern),
                      undefined,
                      (refs) => ({
                        kind: "pattern",
                        source: refs[0],
                        pattern,
                      }),
                      [selected!.id],
                    )
                  }
                  onMirror={(origin, normal) =>
                    cadOperation(
                      "Mirror body",
                      () =>
                        cad.current!.mirror(
                          selected!.kernelId!,
                          origin,
                          normal,
                        ),
                      undefined,
                      (refs) => ({
                        kind: "mirror",
                        source: refs[0],
                        planeOrigin: origin,
                        normal,
                      }),
                      [selected!.id],
                    )
                  }
                  onSplit={(cutterId) => {
                    void action("Splitting solid…", async () => {
                      const cutter = entities.find(
                        (entity) => entity.id === cutterId,
                      );
                      if (!selected?.kernelId || !cutter?.kernelId)
                        throw new Error("Choose two exact CAD bodies.");
                      const bound = bindFeatureInputs(entities, [
                        selected.id,
                        cutter.id,
                      ]);
                      const binding = featureBinding("Split solid", {
                        kind: "split",
                        source: bound.refs[0],
                        cutter: bound.refs[1],
                      });
                      const results = await cad.current!.split(
                        selected.kernelId,
                        cutter.kernelId,
                      );
                      const created = results.map((result, index): Entity => ({
                        ...result,
                        id: crypto.randomUUID(),
                        name: `Split ${index === 0 ? "inside" : "outside"}`,
                        kind: "cad",
                        color: DEFAULT_PART_COLOR,
                        visible: true,
                        opacity: 1,
                        parametric: { ...binding, output: index },
                      }));
                      commit([
                        ...bound.entities.map((entity) =>
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
                    cadOperation(
                      "Sweep",
                      () => cad.current!.sweep(points, path),
                      undefined,
                      { kind: "sweep", points, path },
                    )
                  }
                  onEdges={(indices, amount, operation) =>
                    cadOperation(
                      operation,
                      () =>
                        cad.current!.edgeTreatment(
                          selected!.kernelId!,
                          indices,
                          amount,
                          operation,
                        ),
                      undefined,
                      (refs) => ({
                        kind: "edges",
                        source: refs[0],
                        edgeIndices: indices,
                        amount,
                        operation,
                      }),
                      [selected!.id],
                    )
                  }
                  onOffset={(distance) =>
                    cadOperation(
                      "Offset",
                      () => cad.current!.offset(selected!.kernelId!, distance),
                      undefined,
                      (refs) => ({
                        kind: "offset",
                        source: refs[0],
                        distance,
                      }),
                      [selected!.id],
                    )
                  }
                  onSew={(ids, tolerance) =>
                    cadOperation(
                      "Sew surfaces",
                      () =>
                        cad.current!.sew(
                          ids.map(
                            (id) =>
                              entities.find((entity) => entity.id === id)!
                                .kernelId!,
                          ),
                          tolerance,
                        ),
                      undefined,
                      (refs) => ({ kind: "sew", sources: refs, tolerance }),
                      ids,
                    )
                  }
                  onShell={(indices, thickness) =>
                    cadOperation(
                      "Shell",
                      () =>
                        cad.current!.shell(
                          selected!.kernelId!,
                          indices,
                          thickness,
                        ),
                      undefined,
                      (refs) => ({
                        kind: "shell",
                        source: refs[0],
                        faceIndices: indices,
                        thickness,
                      }),
                      [selected!.id],
                    )
                  }
                  onThicken={(thickness) =>
                    cadOperation(
                      "Thicken",
                      () =>
                        cad.current!.thicken(selected!.kernelId!, thickness),
                      undefined,
                      (refs) => ({
                        kind: "thicken",
                        source: refs[0],
                        thickness,
                      }),
                      [selected!.id],
                    )
                  }
                />
              </div>
            </>
          )}
        </aside>
      </main>
      <ModelTimeline
        labels={[...history, ...future].map((revision) => revision.label)}
        cursor={history.length}
        disabled={busy}
        onSeek={restoreRevision}
        onContextMenu={(event, revision) => {
          event.preventDefault();
          if (!busy)
            setContextMenu({
              x: event.clientX,
              y: event.clientY,
              kind: "history",
              revision,
            });
        }}
      />
      {newDocumentDialog && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-document-title"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (matchesLocalShortcut(event, "cancel")) {
                event.preventDefault();
                setNewDocumentDialog(false);
              }
              if (event.key === "Tab") {
                const buttons = event.currentTarget.querySelectorAll("button");
                const first = buttons[0],
                  last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <h2 id="new-document-title">Create a new document?</h2>
            <p>
              Unsaved changes will be lost. Save your project before continuing
              if you want to keep them.
            </p>
            <div className="new-document-actions">
              <button autoFocus onClick={() => setNewDocumentDialog(false)}>
                Cancel
              </button>
              <button
                onClick={() => {
                  save();
                  setNewDocumentDialog(false);
                }}
              >
                Save project
              </button>
              <button onClick={newDocument} disabled={busy}>
                Discard and create new
              </button>
            </div>
          </section>
        </div>
      )}
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
                disabled={spaceMouseConnecting}
                onClick={() => void connectSpaceMouse()}
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
              max={20}
              step={0.1}
              onChange={(translationSpeed) =>
                updateSpaceMousePreferences({
                  translationSpeed: Math.max(0, translationSpeed),
                })
              }
            />
            <Field
              label="Rotation sensitivity"
              value={spaceMousePreferences.rotationSpeed}
              min={0}
              max={20}
              step={0.1}
              onChange={(rotationSpeed) =>
                updateSpaceMousePreferences({
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
                updateSpaceMousePreferences({
                  deadzone: Math.max(0, Math.min(0.9, deadzone)),
                })
              }
            />
            <label className="check">
              <input
                type="checkbox"
                checked={spaceMousePreferences.dominantAxis}
                onChange={(event) =>
                  updateSpaceMousePreferences({
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
                  updateSpaceMousePreferences({
                    rotationEnabled: event.target.checked,
                  })
                }
              />
              Enable SpaceMouse rotation
            </label>
          </section>
        </div>
      )}
      {saveDialogOpen && (
        <SaveProjectDialog
          name={name}
          onSave={saveNamedProject}
          onCancel={() => setSaveDialogOpen(false)}
        />
      )}
      <StatusBar
        busy={busy}
        facets={selected ? selected.positions.length / 9 : undefined}
        shortcuts={shortcutContext}
        operation={
          <StatusMessage
            message={
              importProgress ? `Importing ${importProgress.name}` : message
            }
          >
            {importProgress ? (
              <ImportProgress
                name={importProgress.name}
                fraction={importProgress.fraction}
                onCancel={
                  importAbort.current
                    ? () => importAbort.current?.abort()
                    : undefined
                }
              />
            ) : (
              message
            )}
          </StatusMessage>
        }
        hint={
          <ActiveToolHint
            context={{
              hasSelection: !!selected,
              hasCadSelection: !!selected?.kernelId,
              shortcutMode: shortcutContext.mode,
              busy,
              planePicking,
              mode,
              brushActive:
                toolPanelOpen &&
                workspace === "mesh" &&
                mode === "brush" &&
                !selected?.kernelId &&
                !scanPanel &&
                !scanBoundaryPaths.length,
              selectionTool,
              selectThrough,
              subtract: subtractBrush,
              sketchTool:
                workspace === "sketch" && toolPanelOpen && !createSketch
                  ? sketchDrawingTool
                  : undefined,
              landmarkSide: nPoints ? landmarkPickSide : undefined,
              landmarkPreview: !!nPoints?.preview,
              reference: scanReferencePick.current ?? undefined,
              panel:
                workspace === "mesh" && toolPanelOpen
                  ? (scanPanel ?? undefined)
                  : undefined,
              parameterTool:
                workspace === "scanTools" && toolPanelOpen
                  ? scanToolTitles[scanTool]
                  : undefined,
              previewAuthoring: surfaceFit
                ? "surface"
                : createSketch
                  ? "sketch section"
                  : undefined,
              sectionAxis: axis.toUpperCase(),
              sectionOffset: number(offset),
            }}
          />
        }
      />
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
