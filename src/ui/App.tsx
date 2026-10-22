import {
  cancelScanToolOnSourceChange,
  cancelShrinkwrapOperation,
  runShrinkwrapPreviewCommand,
} from "./shrinkwrap-preview-command";
import { prepareMeshInBackground } from "../scan-background-preparation";
import { primitiveFitSamples } from "../primitive-fit-samples";
import { getWorkingJobStatus } from "../working-job-status";
import {
  ToolWorkspace,
  ToolSection,
  workspaceGroup,
  workspaceTitle,
} from "./tool-panel-scope";
import { CommandRepeat } from "../command-repeat";
import { InteractiveAlignmentStore } from "../interactive-alignment-store";
import { interactiveAlignmentTargetError } from "../interactive-alignment-session";
import { createInteractiveEditor } from "../automation/interactive-editor";
import { InteractiveAlignmentDialog } from "./InteractiveAlignmentDialog";
import { isSampledScan } from "../scan-source";
import { flushSync } from "react-dom";
import { prepareImportedScan } from "../imported-scan";
import { beginWorkingJob } from "../working-job-status";
import {
  importBatch,
  importConcurrency,
  validateImportBatch,
} from "../import-batch";
import { displayMeshStats } from "../scan-render-data";
import {
  selectObject,
  reconcileObjectSelection,
  type ObjectSelectionState,
  type ObjectSelectionModifiers,
} from "../object-selection";
import { AppSelect } from "./AppSelect";
import { AlignmentReferences } from "./AlignmentReferences";
import { DatumAlignmentTools } from "./DatumAlignmentTools";
import { GlobalAlignmentTools } from "./GlobalAlignmentTools";
import { inspectGlobalAlignmentCandidates } from "../global-alignment-input";
import {
  coordinateAlignmentInterface,
  type InterfacePatch,
} from "../automation/workflow-operations";
import type { AlignmentReferencePage } from "../automation/alignment-operations";
import {
  selectionProcessingMode,
  type SelectionProcessingMode,
} from "../selection-processing-mode";
import "./ToolPanel.css";
import "./ObjectList.css";
import { objectContextActions } from "./object-context-actions";
import { RenameObjectDialog } from "./RenameObjectDialog";
import { AgentConnection } from "./AgentConnection";
import "./settings-dialog.css";
import { SettingsTabs, type SettingsSection } from "./SettingsTabs";
import { useWorkspaceApi } from "../automation/use-workspace-api";
import { captureApplicationImage } from "../automation/visual-capture";
import { inspectApplicationDom } from "../automation/application-observation";
import { RIBBON_TABS } from "./ribbon-model";
import { createCadFeature, rebuildCadFeature } from "../automation/operations";
import {
  duplicateObject,
  lockedObjectEdit,
  objectPickable,
} from "../object-operations";
import { SaveProjectDialog } from "./SaveProjectDialog";
import {
  decodeProjectFile,
  encodeProjectFile,
  type ProjectSession,
} from "../project-file";
import { useProjectBackups } from "./useProjectBackups";
import { ProjectRecovery } from "./ProjectRecovery";
import {
  ActiveToolHint,
  StatusMessage,
  StatusBar,
  OperationStatus,
} from "./StatusFeedback";
import { linearProgress, type ReductionStatistics } from "../reduction-report";
import { holeFillCounts, holeFillOutcomes } from "../hole-fill-progress";
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
  hasVisibleKeyboardModal,
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
import { SketchUndo, pruneSketchUndoSessions } from "../sketch-undo";
import { CreateSketchDialog } from "./CreateSketchDialog";
import { SpaceMouseConnection } from "./SpaceMouseConnection";
import { createSpaceMouseDriver } from "../spacemouse-driver";
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
import type { ScanBridgeSession } from "../scan-bridge-gesture";
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
} from "./GeneratedUiIcons";
import {
  DEFAULT_PART_COLOR,
  DEFAULT_FREEFORM_COLOR,
  DEFAULT_REFERENCE_COLOR,
} from "../appearance";
import { exportSectionDxf } from "../section-dxf";
import { processMesh } from "../processing-client";
import { processScanRegistration } from "../scan-registration";
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
  filteredMotion,
  type HidAccess,
  type SpaceMousePreferences,
} from "../spacemouse";
import { PointCloudTools } from "./PointCloudTools";
import {
  editPointCloud,
  type PointCloudEditRequest,
} from "../point-cloud-processing";
import { partitionTriangles, selectionCount } from "../selection";
import { fittedPrimitive } from "../fitted-primitive";
import {
  cleanupMesh,
  deviations,
  fitCylinder,
  fitCone,
  fitPlane,
  fitSphere,
  sectionMesh,
} from "../geometry";
import {
  download,
  exportStl,
  geometryPositions,
  validatePositions,
} from "../io";
import {
  retainIndexedMesh,
  transformIndexedMesh,
  indexedRenderNormals,
} from "../indexed-mesh";
import {
  canonicalCloud,
  cloudPlacement,
  cloudSelectionSource,
} from "../point-cloud-placement";
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
import { releaseProcessingPreview } from "../processing-session";
import type { WorkspaceHost } from "../automation/api";
import { pointCloudStats } from "../point-cloud";
import {
  beginLandmarkAlignment,
  pickLandmark,
  prepareLandmarkRequest,
  landmarkSceneUnchanged,
  acceptLandmarkAlignment,
  landmarkMarkers,
  editLandmarks,
  landmarkState,
  type LandmarkAlignment,
} from "../landmark-alignment";
import { landmarkCommandSource } from "../landmark-command";
import { SplitMeshPanel } from "./SplitMeshPanel";
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
  const datumPointPick = useRef<((point: Vec3) => void) | null>(null);
  const datumFacePick = useRef<
    ((entityId: string, triangleIndex?: number) => void) | null
  >(null);
  const datumPreview = useRef<{ base: Entity[]; entities: Entity[] } | null>(
    null,
  );
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const [pendingScanImport, setPendingScanImport] = useState<File[] | null>(
    null,
  );
  const [originVisible, setOriginVisible] = useState(true);
  const [originPlane, setOriginPlane] = useState<OriginPlane>("OXY");
  const [planePicking, setPlanePicking] = useState(false);
  const [sketchPlaneDialog, setSketchPlaneDialog] = useState(false);
  const [objectSelection, setObjectSelection] = useState<ObjectSelectionState>({
    ids: [],
    activeId: null,
    anchorId: null,
  });
  const selectedId = objectSelection.activeId;
  const selectedIds = objectSelection.ids;
  const [interactiveStore] = useState(() => new InteractiveAlignmentStore());
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const interactiveTargetError = useMemo(
    () => interactiveAlignmentTargetError(entities, selectedIds),
    [entities, selectedIds],
  );
  function setSelectedId(id: string | null) {
    if (interactiveStore.getSnapshot()) return;
    setObjectSelection({ ids: id ? [id] : [], activeId: id, anchorId: id });
  }
  function selectObjects(
    id: string | null,
    modifiers: ObjectSelectionModifiers = {},
  ) {
    if (interactiveStore.getSnapshot()) return;
    if (!id) return setSelectedId(null);
    setObjectSelection((state) =>
      selectObject(
        state,
        entitiesRef.current.filter(objectPickable).map((e) => e.id),
        id,
        modifiers,
      ),
    );
  }
  useEffect(() => {
    setObjectSelection((state) => {
      const next = reconcileObjectSelection(
        state,
        entities.filter(objectPickable).map((e) => e.id),
      );
      return JSON.stringify(state) === JSON.stringify(next) ? state : next;
    });
  }, [entities]);
  const [name, setName] = useState("Untitled project");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [flatShading, setFlatShading] = useState(true);
  const [normalsDisplay, setNormalsDisplay] = useState(true);
  const [floorGrid, setFloorGrid] = useState(true);
  const [gridSpacing, setGridSpacing] = useState(10);
  const [automaticGrid, setAutomaticGrid] = useState(true);
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
  const [datumAlignmentOpen, setDatumAlignmentOpen] = useState(false);
  const [globalAlignmentOpen, setGlobalAlignmentOpen] = useState(false);
  useEffect(() => {
    if (!datumPreview.current) {
      datumPointPick.current = null;
      datumFacePick.current = null;
      setDatumAlignmentOpen(false);
    }
  }, [selectedId]);
  const [nPoints, setNPoints] = useState<LandmarkAlignment | null>(null);
  const [landmarkPickSide, setLandmarkPickSide] = useState<"moving" | "fixed">(
    "moving",
  );
  const nPointsRef = useRef(nPoints);
  nPointsRef.current = nPoints;
  const landmarkAbort = useRef<AbortController | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("appearance");
  const [newDocumentDialog, setNewDocumentDialog] = useState(false);
  const [previewImport, setPreviewImport] = useState(false);
  const [sketchDraft, setSketchDraft] = useState<Sketch>(() =>
    rectangleSketch(),
  );
  const [spaceMouseStatus, setSpaceMouseStatus] = useState(
    "Move the SpaceMouse cap to detect it",
  );
  const spaceMouseStatusRef = useRef(spaceMouseStatus);
  const reportSpaceMouseStatus = (value: string) => {
    spaceMouseStatusRef.current = value;
    setSpaceMouseStatus(value);
  };
  const [spaceMouseConnecting, setSpaceMouseConnecting] = useState(false);
  const [spaceMousePreferences, setSpaceMousePreferences] =
    useState<SpaceMousePreferences>({ ...DEFAULT_SPACE_MOUSE });
  const spaceMouse = useRef<SpaceMouseController | null>(null);
  const spaceMouseDriver = useRef<ReturnType<
    typeof createSpaceMouseDriver
  > | null>(null);
  const updateSpaceMousePreferences = (
    patch: Partial<SpaceMousePreferences>,
  ) => {
    const preferences = {
      ...(spaceMouse.current?.preferences ?? spaceMousePreferences),
      ...patch,
    };
    filteredMotion(
      { translation: [0, 0, 0], rotation: [0, 0, 0] },
      preferences,
    );
    // Apply in the input event, before the next HID animation frame.
    if (spaceMouse.current) spaceMouse.current.preferences = preferences;
    setSpaceMousePreferences(preferences);
  };
  const connectSpaceMouse = async () => {
    setSpaceMouseConnecting(true);
    try {
      await controlSpaceMouse({ action: "connectDriver" });
    } catch (error) {
      reportSpaceMouseStatus(`SpaceMouse connection: ${errorText(error)}`);
      setError(errorText(error));
    } finally {
      setSpaceMouseConnecting(false);
    }
  };
  const inspectSpaceMouse = () => ({
    connected: spaceMouse.current?.connected ?? false,
    source: spaceMouse.current?.source ?? null,
    status: spaceMouseStatusRef.current,
    connecting: spaceMouseConnecting,
    preferences: {
      ...(spaceMouse.current?.preferences ?? spaceMousePreferences),
    },
    driverManagedPreferences: spaceMouse.current?.source === "driver",
    gamepadAvailable: typeof navigator.getGamepads === "function",
    browserHidAvailable: !!(navigator as Navigator & { hid?: HidAccess }).hid,
  });
  const controlSpaceMouse = async (
    command: import("../spacemouse").SpaceMouseCommand,
    signal?: AbortSignal,
  ) => {
    const controller = spaceMouse.current;
    if (!controller) throw new Error("SpaceMouse navigation is not ready.");
    signal?.throwIfAborted();
    if (command.action === "preferences") {
      updateSpaceMousePreferences(command.preferences ?? {});
    } else if (command.action === "disconnect") {
      spaceMouseDriver.current?.close();
      await controller.disconnect();
      reportSpaceMouseStatus("Disconnected");
    } else if (command.action === "automatic") {
      spaceMouseDriver.current?.close();
      await controller.disconnect(false);
      controller.setDriverActive(false);
      await controller.restoreAuthorized();
      if (!controller.connected)
        reportSpaceMouseStatus("Move the SpaceMouse cap to detect it");
    } else {
      if (!viewport.current || !spaceMouseDriver.current)
        throw new Error("Viewport is not ready.");
      setSpaceMouseConnecting(true);
      try {
        await controller.disconnect(false);
        const target = viewport.current.spaceMouseDriverTarget();
        await spaceMouseDriver.current.connect(
          target.element,
          target.client,
          signal,
        );
        target.element.focus({ preventScroll: true });
      } catch (error) {
        controller.setDriverActive(false);
        throw error;
      } finally {
        setSpaceMouseConnecting(false);
      }
    }
    return inspectSpaceMouse();
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
  const [selectionProcessingEffect, setSelectionProcessingEffect] =
    useState<SelectionProcessingMode>("boundary");
  const [scanTool, setScanTool] = useState<ScanToolId>("reducePolygons");
  const [scanToolProgress, setScanToolProgress] = useState("");
  const [scanToolFraction, setScanToolFraction] = useState<number>();
  const [scanToolResult, setScanToolResult] = useState("");
  const scanToolOutput = useRef<Entity["positions"] | null>(null);
  const [noiseComparison, setNoiseComparison] = useState<{
    kind: "reduceNoise" | "reducePolygons" | "shrinkwrap";
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
    kind:
      | "reduceNoise"
      | "reducePolygons"
      | "scaleMesh"
      | "mirrorMesh"
      | "shrinkwrap";
    entityId: string;
    source: Entity["positions"];
    output: Float32Array;
    settings?: import("../shrinkwrap-request").ShrinkwrapParameters;
  } | null>(null);
  const [pickedScanReference, setPickedScanReference] = useState<string>();
  const scanToolAbort = useRef<AbortController | null>(null);
  const scanToolAccepting = useRef(false);
  const scanReferencePick = useRef<"plane" | "cylinder" | null>(null);
  const pickScanReference = useRef<(id: string) => boolean>(() => false);
  const busy = actionBusy || processingBusy;
  const editingBlocked = busy || interactiveOpen || globalAlignmentOpen;
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
  const [brushRadius, setBrushRadius] = useState(8);
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
  const [splitMeshOpen, setSplitMeshOpen] = useState(false);
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
  const [renameObject, setRenameObject] = useState<{
    ids: string[];
    name: string;
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
    radius: 8,
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
  const [projectId, setProjectId] = useState<string>(() => crypto.randomUUID());
  const projectSession: ProjectSession = {
    projectId,
    project: {
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name,
      entities,
      authoring: {
        sketch: activeSketchId ? legacySketch.current : sketchDraft,
        sketches: savedSketches,
        activeSketchId: activeSketchId ?? undefined,
      },
    },
    history,
    future,
  };
  const {
    backups,
    status: backupStatus,
    offerRecovery,
    dismissRecovery,
    deleteBackup,
  } = useProjectBackups(
    projectSession,
    !busy &&
      (dirty || entities.length > 0 || history.length > 0 || future.length > 0),
    () => viewport.current?.captureThumbnail() ?? Promise.resolve(null),
  );
  const operationLabel = useRef<string | null>(null);
  const viewportHost = useRef<HTMLDivElement>(null);
  const viewport = useRef<Viewport | null>(null);
  const setScanBridgeSession = useCallback(
    (session: ScanBridgeSession | null) => {
      viewport.current?.setScanBridge(session);
    },
    [],
  );
  const displayScanBridge = useCallback((positions?: Float32Array) => {
    viewport.current?.setBridgePreview(positions);
  }, []);
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
  useEffect(() => {
    if (selected && !objectPickable(selected)) setSelectedId(null);
  }, [selected]);
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
    return prepareMeshInBackground(
      selected?.kind === "mesh" && !selected.kernelId && !selected.parametric
        ? selected.positions
        : undefined,
      { canStart: () => !busyRef.current },
    );
  }, [
    selected?.positions,
    selected?.kind,
    selected?.kernelId,
    selected?.parametric,
  ]);
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
    () =>
      selected
        ? selected.kind === "pointcloud"
          ? pointCloudStats(selected.positions)
          : displayMeshStats(selected.positions)
        : null,
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
        (point, id, triangleIndex) => {
          if (busyRef.current || interactiveStore.getSnapshot()) return;
          if (datumFacePick.current) {
            const pick = datumFacePick.current;
            datumFacePick.current = null;
            pick(id, triangleIndex);
            return;
          }
          if (datumPointPick.current) {
            const pick = datumPointPick.current;
            datumPointPick.current = null;
            pick(point);
            return;
          }
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
          if (datumPointPick.current) return;
          if (datumFacePick.current) return;
          if (
            !busyRef.current &&
            !interactiveStore.getSnapshot() &&
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
          if (!busyRef.current && !interactiveStore.getSnapshot()) {
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
            interactiveStore.getSnapshot() ||
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
      viewport.current.setInteractiveDragHandler(
        async (movement) => {
          const result = await interactiveEditor.edit({
            action: "drag",
            ...movement,
          });
          return result.accepted === true;
        },
        (error) => setError(errorText(error)),
      );
      viewport.current.onInteractiveMirrorError = (error) => {
        setError(errorText(error));
        setMessage("Mirror preview failed");
      };
      viewport.current.onSelectionStatus = (status) =>
        setMessage(
          status === "pending"
            ? brushRef.current.entity?.kind === "pointcloud"
              ? "Selecting points..."
              : "Selecting facets..."
            : "Selection ready",
        );
      spaceMouse.current = new SpaceMouseController(
        (navigator as Navigator & { hid?: HidAccess }).hid,
        (motion, seconds) => viewport.current?.navigate(motion, seconds),
        (action) =>
          action === "fit"
            ? viewport.current?.fitView()
            : viewport.current?.setView("iso"),
        reportSpaceMouseStatus,
      );
      spaceMouse.current.preferences = spaceMousePreferences;
      spaceMouse.current.onInputMotion = () =>
        viewport.current?.noteSpaceMouseInput();
      void spaceMouse.current
        .restoreAuthorized()
        .catch((error) =>
          reportSpaceMouseStatus(`SpaceMouse reconnect: ${errorText(error)}`),
        );
      spaceMouseDriver.current = createSpaceMouseDriver({
        onReady: () => {
          spaceMouse.current?.setDriverActive(true);
          reportSpaceMouseStatus("Connected: 3Dconnexion driver");
        },
        onLost: (reason) => {
          spaceMouse.current?.setDriverActive(false);
          if (spaceMouse.current?.source !== "gamepad")
            reportSpaceMouseStatus(
              `3Dconnexion: ${String(reason)} · automatic detection resumed`,
            );
        },
      });
    } catch (e) {
      setError(`WebGL unavailable: ${errorText(e)}`);
    }
    const unload = (event?: PageTransitionEvent) => {
      if (!event?.persisted) {
        try {
          spaceMouseDriver.current?.dispose();
        } catch (error) {
          console.error("SpaceMouse cleanup failed", error);
        }
        workspaceApi.dispose();
        datumPreview.current = null;
        datumPointPick.current = null;
        datumFacePick.current = null;
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
    if (datumPreview.current && datumPreview.current.base !== entities) {
      datumPreview.current = null;
      void workspaceApi.invoke("preview_discard", {
        target: "datum",
        expectedRevision: workspaceApi.currentRevision(),
        requestId: crypto.randomUUID(),
      });
    }
    viewport.current?.setEntities(
      datumPreview.current
        ? datumPreview.current.entities
        : activeScanPreview
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
              ? [
                  ...entities,
                  surfaceFitEntity(surfaceFit, "surface-fit-preview"),
                ]
              : entities,
      selectedId,
      selectedIds,
    );
    viewport.current?.setAlignmentMarkers(
      nPoints ? landmarkMarkers(nPoints) : [],
    );
    viewport.current?.setPickTarget(
      nPoints
        ? landmarkPickSide === "moving"
          ? nPoints.moving.id
          : (nPoints.fixed?.id ?? null)
        : null,
    );
    if (pendingImportFit.current !== undefined) {
      viewport.current?.fitView(pendingImportFit.current ?? undefined);
      pendingImportFit.current = undefined;
    }
  }, [
    entities,
    selectedId,
    selectedIds,
    nPoints,
    landmarkPickSide,
    surfaceFit,
    activeScanPreview,
  ]);
  useEffect(() => {
    if (scanPreview?.kind === "shrinkwrap")
      queueMicrotask(() => workspaceApi.validateScanPreview());
    if (scanPreview && !activeScanPreview) {
      if (scanPreview.kind === "shrinkwrap")
        queueMicrotask(() => workspaceApi.discardScanPreview(scanPreview.id));
      setScanPreview(null);
      releaseProcessingSession();
    }
  }, [scanPreview, activeScanPreview, entities]);
  useEffect(() => {
    queueMicrotask(() => workspaceApi.validateGlobalAlignmentPreview());
  });
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
    viewport.current?.setNormalsDisplay(normalsDisplay);
  }, [normalsDisplay]);
  useEffect(() => {
    viewport.current?.setGridOptions(
      floorGrid,
      gridSpacing,
      snapGrid,
      automaticGrid,
    );
  }, [floorGrid, gridSpacing, snapGrid, automaticGrid]);
  useEffect(() => {
    viewport.current?.setWireframe(wireframe);
  }, [wireframe]);
  useEffect(() => {
    viewport.current?.setBrush(
      mode === "brush" &&
        workspace === "mesh" &&
        toolPanelOpen &&
        !busy &&
        !selected?.kernelId &&
        !scanPanel &&
        !scanBoundaryPaths.length,
    );
  }, [
    mode,
    workspace,
    toolPanelOpen,
    busy,
    selected?.kernelId,
    scanPanel,
    scanBoundaryPaths,
  ]);
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
    setSplitMeshOpen(false);
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
    if (!origin || selected?.kind === "pointcloud") return;
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
    viewport.current?.setSelectionProcessing(
      processingBusy,
      selectionProcessingEffect,
    );
    if (!processingBusy && selectionProcessingEffect !== "boundary")
      setSelectionProcessingEffect("boundary");
  }, [processingBusy, selectionProcessingEffect]);
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
    viewport.current?.setDeviation(
      selected?.id ?? "",
      selected && showDeviation && fit
        ? deviations(selected.positions, fit)
        : null,
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
    const key = cloudSelectionSource(entity);
    if (!record || record.positions !== key) {
      record = {
        positions: key,
        session: new SelectionSession(
          entity.positions.length / (entity.kind === "pointcloud" ? 3 : 9),
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
      new Uint8Array(
        entity.positions.length / (entity.kind === "pointcloud" ? 3 : 9),
      );
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
        selected.positions.length / (selected.kind === "pointcloud" ? 3 : 9),
        lastHiddenSelection.current,
      ),
      hidden: session.state.hidden.filter((index) => !revealed.has(index)),
    });
    applySelectionState(selected, session.state);
    setDirty(true);
  }
  async function morphSelection(operation: "grow" | "shrink" | "boundary") {
    if (!selected || busy || scanEditAbort.current) return;
    if (selected.kind === "pointcloud") {
      if (operation !== "boundary")
        await runPointEdit({
          action: operation,
          selection: triangleMask ?? undefined,
        });
      return;
    }
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
  async function runPointEdit(
    operation: Omit<PointCloudEditRequest, "kind" | "positions" | "normals">,
  ) {
    if (
      !selected ||
      selected.kind !== "pointcloud" ||
      busy ||
      scanEditAbort.current
    )
      return;
    const source = selected;
    setSelectionProcessingEffect(
      selectionProcessingMode({ kind: "pointCloudEdit", ...operation }),
    );
    const controller = new AbortController();
    scanEditAbort.current = controller;
    setProcessingBusy(true);
    setError("");
    try {
      const result = await processMesh(
        {
          kind: "pointCloudEdit",
          positions: source.positions,
          normals: source.normals,
          ...operation,
        },
        {
          signal: controller.signal,
          onProgress: (fraction, stage) =>
            setMessage(`${stage}  -  ${Math.round(fraction * 100)}%`),
        },
      );
      if (controller.signal.aborted) return;
      const edited = result.pointCloudEdit;
      if (edited?.selection) changeSelection(edited.selection);
      if (edited?.positions) {
        operationLabel.current = `Point cloud ${operation.action}`;
        commit(
          edited.positions.length
            ? entities.map((entity) =>
                entity.id === source.id
                  ? {
                      ...entity,
                      positions: edited.positions!,
                      normals: edited.normals
                        ? Array.from(edited.normals)
                        : undefined,
                      meshSelection: undefined,
                    }
                  : entity,
              )
            : entities.filter((entity) => entity.id !== source.id),
        );
        operationLabel.current = null;
        if (!edited.positions.length) setSelectedId(null);
        setMessage(`${edited.positions.length / 3} points retained`);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(errorText(error));
        setMessage("Point cloud edit failed  -  original points retained");
      }
    } finally {
      if (scanEditAbort.current === controller) {
        scanEditAbort.current = null;
        setProcessingBusy(false);
      }
    }
  }
  async function runScanEdit(
    operation: Omit<ScanEditRequest, "kind" | "positions">,
    label: string,
  ) {
    if (!selected || busy || scanEditAbort.current) return;
    if (selected.kind === "pointcloud") {
      if (operation.action === "smoothSelected")
        await runPointEdit({
          action: "smooth",
          selection: operation.selection,
        });
      else
        setError(
          "This operation needs triangle topology. Use point-cloud processing for scan points.",
        );
      return;
    }
    if (selected.parametric || selected.kernelId) {
      setError("Create a separate mesh copy before editing an exact CAD body.");
      return;
    }
    setSelectionProcessingEffect(
      selectionProcessingMode({ kind: "scanEdit", ...operation }),
    );
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
          onProgress: (fraction, stage, details) =>
            setMessage(
              details
                ? `${stage} · ${holeFillCounts(details)} · ${holeFillOutcomes(details)} · ${Math.floor(fraction * 100)}%`
                : `${stage} · ${Math.round(fraction * 100)}%`,
            ),
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
      if (
        operation.action === "fillHoles" &&
        operation.mode !== "bridge" &&
        result.scanEdit
      ) {
        const { filledHoles, skippedHoles } = result.scanEdit.diagnostics;
        if (typeof filledHoles === "number" && typeof skippedHoles === "number")
          setMessage(
            `Finished: ${holeFillOutcomes({ closed: filledHoles, skipped: skippedHoles })}`,
          );
      }
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
      mask: indicesMask(
        entity.positions.length / (entity.kind === "pointcloud" ? 3 : 9),
        saved.triangles,
      ),
      hidden: session.state.hidden.filter((i) => !chosen.has(i)),
    });
    applySelectionState(entity, session.state);
    setMessage(`Restored selection ${saved.name}`);
  }
  const selectionSession = selected ? sessionFor(selected) : undefined;
  void selectionVersion;
  useEffect(() => {
    const live = new Map(entities.map((e) => [e.id, cloudSelectionSource(e)]));
    for (const [id, record] of selectionSessions.current)
      if (live.get(id) !== record.positions)
        selectionSessions.current.delete(id);
  }, [entities]);
  const landmarkSource = landmarkCommandSource(
    entities,
    selectedId,
    selectedIds,
  );
  const commandRepeat = useRef(new CommandRepeat());
  const globalCandidates = inspectGlobalAlignmentCandidates(entities);
  const globalAlignmentError = globalCandidates.canPreview
    ? null
    : globalCandidates.blocked.map((item) => item.reason).join(" ") ||
      "Choose 2–32 visible, unlocked raw meshes.";
  const [, setCommandVersion] = useState(0);
  const ribbonActions = {
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
    align: openAlignment,
    transform: () => showTools("transform"),
    section: () => {
      setMode("section");
      showTools("section");
    },
    extrude: () => showTools("extrude"),
    revolve: () => showTools("revolve"),
    boolean: () => showTools("boolean"),
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
    splitMesh: () => {
      setMode("inspect");
      showTools("mesh");
      setScanPanel(null);
      setSplitMeshOpen(true);
    },
    editScan: () => {
      setMode("brush");
      showTools("mesh");
    },
    select: () => {
      setMode("brush");
      showTools("mesh");
    },
    wireframe: () => setWireframe(!wireframe),
    objectColor: () => showTools("objectColor"),
    loft: () => showTools("loft"),
    sweep: () => showTools("sweep"),
    fillet: () => showTools("fillet"),
    chamfer: () => showTools("chamfer"),
    surfaceOffset: () => showTools("surfaceOffset"),
    sewSurfaces: () => showTools("sewSurfaces"),
    shell: () => showTools("shell"),
    surfaceThicken: () => showTools("surfaceThicken"),
    fitSurface: openSurfaceFit,
    nurbsSurface: () => showTools("surface"),
    newFreeform: () => showTools("surface"),
    autoFreeform: () => showTools("surface"),
    quadObj: () => showTools("surface"),
    sketch2d: openSketchCreation,
    sketchFromSection:
      selected?.kind === "mesh" && !selected.surfacePatch
        ? openScanSketchCreation
        : undefined,
    reducePolygons: () => openScanTool("reducePolygons"),
    reduceNoise: () => openScanTool("reduceNoise"),
    scaleMesh: () => openScanTool("scaleMesh"),
    flipNormals: () => {
      if (busy || scanToolAbort.current) return;
      dismissScanTool();
      void applyScanTool({ kind: "flipNormals" });
    },
    shrinkwrap: () => openScanTool("shrinkwrap"),
    repolygonize: () => openScanTool("repolygonize"),
    averageMesh: () => openScanTool("averageMesh"),
    mirrorMesh: () => openScanTool("mirrorMesh"),
    unroll: () => openScanTool("unroll"),
    fineAlign: () => showTools("fineAlign"),
    globalFineAlign: () => {
      if (globalAlignmentError || datumPreview.current || scanPreview) {
        setError(
          globalAlignmentError ?? "Apply or cancel the existing preview first.",
        );
        return;
      }
      setMode("inspect");
      setToolPanelOpen(true);
      setGlobalAlignmentOpen(true);
    },
    alignNPoints: openLandmarks,
    alignInteractive: () => {
      void interactiveEditor
        .edit({ action: "begin" })
        .catch((error) => setError(errorText(error)));
    },
    repairMesh: () => showTools("repairMesh"),
    segmentMesh: () => showTools("segmentMesh"),
    splitSolid: () => showTools("splitSolid"),
    circularPattern: () => showTools("circularPattern"),
    linearPattern: () => showTools("linearPattern"),
    mirrorBody: () => showTools("mirrorBody"),
  };
  const excludedRepeatCommands = new Set([
    "newDocument",
    "open",
    "save",
    "undo",
    "redo",
    "delete",
    "exportStep",
    "exportStl",
    "settings",
  ]);
  const globalRibbonCommands = new Set([
    "globalFineAlign",
    "fitView",
    "iso",
    "top",
    "bottom",
    "left",
    "right",
    "front",
    "back",
    "primitive",
    "wireframe",
    "newFreeform",
  ]);
  const repeatableRibbonActions = Object.fromEntries(
    Object.entries(ribbonActions).map(([name, run]) => [
      name,
      excludedRepeatCommands.has(name)
        ? run
        : () => launchRepeatable(`ribbon:${name}`),
    ]),
  ) as typeof ribbonActions;
  function launchRepeatable(name?: string) {
    try {
      runRepeatable(name);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  function runRepeatable(name?: string) {
    const result = commandRepeat.current.run(name);
    setCommandVersion((version) => version + 1);
    return result;
  }
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
    "undo-selection": selectionSession?.canUndo
      ? () => selectionUndo()
      : undefined,
    "redo-selection": selectionSession?.canRedo
      ? () => selectionUndo(true)
      : undefined,
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
    "rename-objects": selectedIds.length
      ? () =>
          setRenameObject({
            ids: [...selectedIds],
            name: selectedIds.length === 1 ? (selected?.name ?? "") : "",
          })
      : undefined,
    "toggle-selected-visibility": selectedIds.length
      ? () => {
          void uiCommand("object_visibility_toggle").then((result) => {
            if (result.ok) setMessage("Selected objects visibility toggled");
          });
        }
      : undefined,
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
    fillet: selected?.kernelId ? () => showTools("fillet") : undefined,
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
  const excludedShortcutCommands = new Set([
    "new",
    "open",
    "save",
    "clear-selection",
    "rotate-view",
    "toggle-visibility",
  ]);
  const repeatCommands = Object.fromEntries([
    ...Object.entries(ribbonActions)
      .filter(([name]) => !excludedRepeatCommands.has(name))
      .map(([name, run]) => [
        `ribbon:${name}`,
        name === "alignNPoints"
          ? landmarkSource
            ? run
            : undefined
          : selected || globalRibbonCommands.has(name)
            ? run
            : undefined,
      ]),
    ...Object.entries(actions)
      .filter(
        ([name]) =>
          !excludedShortcutCommands.has(name) &&
          !name.startsWith("undo-") &&
          !name.startsWith("redo-"),
      )
      .map(([name, run]) => [`keyboard:${name}`, run]),
  ]);
  commandRepeat.current.configure(
    repeatCommands,
    () =>
      busyRef.current ||
      hasVisibleKeyboardModal() ||
      !!(
        scanPreview ||
        interactiveOpen ||
        globalAlignmentOpen ||
        datumPreview.current ||
        nPoints ||
        surfaceFit ||
        createSketch ||
        primitiveDialog ||
        settingsOpen ||
        saveDialogOpen ||
        newDocumentDialog ||
        contextMenu
      ),
  );
  actions["repeat-command"] = commandRepeat.current.inspect().canRepeat
    ? () => launchRepeatable()
    : undefined;
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
      interactiveOpen ||
      globalAlignmentOpen ||
      surfaceFit ||
      createSketch ||
      primitiveDialog ||
      settingsOpen ||
      saveDialogOpen ||
      newDocumentDialog ||
      contextMenu ||
      renameObject
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
      modalOpen: shortcutContext.modalOpen || hasVisibleKeyboardModal(),
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
    } else if (resolved.id === "repeat-command") launchRepeatable();
    else if (`keyboard:${resolved.id}` in repeatCommands)
      launchRepeatable(`keyboard:${resolved.id}`);
    else actions[resolved.id]?.();
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => inputCommands.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  function objectMenuActions() {
    const target = entities.find(
      (entity) => entity.id === contextMenu?.objectId,
    );
    const patch = (change: Partial<Entity>) => {
      if (!target) return;
      commit(
        entities.map((entity) =>
          entity.id === target.id ? { ...entity, ...change } : entity,
        ),
      );
      if (change.locked || change.selectable === false) {
        if (selectedId === target.id) {
          setSelectedId(null);
          setMode("inspect");
          setToolPanelOpen(false);
        }
      }
    };
    return objectContextActions(target, busy, {
      properties: () => {
        if (target) {
          setSelectedId(target.id);
          showTools("properties");
        }
      },
      duplicate: () => {
        if (target) {
          const copy = duplicateObject(target, crypto.randomUUID(), entities);
          commit([...entities, copy]);
          setSelectedId(copy.id);
          setMessage(`Duplicated ${target.name}`);
        }
      },
      rename: () => {
        if (target) {
          const ids = selectedIds.includes(target.id)
            ? [...selectedIds]
            : [target.id];
          setRenameObject({ ids, name: ids.length === 1 ? target.name : "" });
        }
      },
      visibility: () => patch({ visible: !target?.visible }),
      selectable: () => patch({ selectable: target?.selectable === false }),
      lock: () => patch({ locked: !target?.locked }),
      edit: () => {
        if (target) {
          setSelectedId(target.id);
          setMode("brush");
          setWorkspace("mesh");
          setToolPanelOpen(true);
        }
      },
      remove: () => {
        if (!target) return;
        try {
          commit(entities.filter((entity) => entity.id !== target.id));
          if (selectedId === target.id) setSelectedId(null);
        } catch (error) {
          setError(errorText(error));
        }
      },
    });
  }
  function commit(next: Entity[], preserveSelectionFor?: string) {
    if (interactiveStore.getSnapshot())
      throw new Error(
        "Apply or cancel Interactive alignment before editing the model.",
      );
    next = next.map((entity) => canonicalCloud(retainIndexedMesh(entity)));
    const protectedObject = lockedObjectEdit(entities, next);
    if (protectedObject) {
      setError(`Unlock ${protectedObject.name} before editing or deleting it.`);
      return;
    }
    next = next.map((entity) => {
      const old = entities.find((e) => e.id === entity.id);
      return old &&
        old.positions !== entity.positions &&
        !(entity.kind === "pointcloud" && cloudPlacement(entity)) &&
        entity.id !== preserveSelectionFor
        ? { ...entity, meshSelection: undefined }
        : entity;
    });
    entityFeatureModel(next);
    next = next.map(canonicalCloud);
    if (!modelChanged(entities, next)) {
      setEntities(next);
      setDirty(true);
      return;
    }
    const label =
      operationLabel.current?.replace(/…$/, "") ?? changeLabel(entities, next);
    setHistory((previous) => [...previous, { entities, label }]);
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
  function undoModel() {
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
  function redoModel() {
    if (future.length) {
      const next = future[0];
      setHistory((p) => [...p, { entities, label: next.label }]);
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
    nextWorkspace =
      (
        {
          processing: "repairMesh",
          advancedCad: "loft",
          reconstruct: "extrude",
        } as Record<string, string>
      )[nextWorkspace] ?? nextWorkspace;
    setSplitMeshOpen(false);
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
    workspaceApi.discardScanPreview();
    if (scanPreview?.kind === "shrinkwrap")
      releaseProcessingPreview(scanPreview.source, scanPreview.id);
    setScanToolFraction(undefined);
    setScanPreview(null);
    setNoiseComparison(null);
    scanToolAbort.current?.abort();
    scanReferencePick.current = null;
    setToolPanelOpen(false);
    setMode("inspect");
  }
  function openScanTool(tool: ScanToolId) {
    if (selected?.kind === "pointcloud") {
      if (tool !== "reducePolygons" && tool !== "reduceNoise") {
        setError(
          "This tool requires a triangle mesh. Select a mesh to use it.",
        );
        return;
      }
      setMode("inspect");
      showTools(tool === "reduceNoise" ? "pointNoise" : "pointReduce");
      return;
    }
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
    cancelScanToolOnSourceChange(
      scanToolAbort.current,
      scanToolAccepting.current,
    );
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
  async function runGuiShrinkwrap(args: Record<string, unknown>) {
    const controller = new AbortController();
    scanToolAccepting.current = args.action === "accept";
    scanToolAbort.current = controller;
    setError("");
    try {
      return await runShrinkwrapPreviewCommand(workspaceApi, args, {
        signal: controller.signal,
        onProgress: (fraction, stage) => {
          setScanToolProgress(`${stage}   ${Math.round(fraction * 100)}%`);
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        workspaceApi.discardScanPreview();
        setMessage("Mesh operation cancelled; original geometry retained.");
      } else setError(errorText(error));
      return undefined;
    } finally {
      if (scanToolAbort.current === controller) {
        scanToolAbort.current = null;
        scanToolAccepting.current = false;
      }
      setScanToolProgress("");
    }
  }
  async function applyScanTool(parameters: ScanToolParameters) {
    if (!selected || busy || scanToolAbort.current) return;
    if (parameters.kind === "shrinkwrap") {
      const { targetIds, ...operation } = parameters;
      await runGuiShrinkwrap({
        action: "create",
        entityId: selected.id,
        operation,
        ...(targetIds?.length ? { targetIds } : {}),
      });
      return;
    }
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
            | "reduceNoise"
            | "reducePolygons"
            | "scaleMesh"
            | "mirrorMesh"
            | "shrinkwrap",
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
  async function acceptScanPreview(options?: { createNewObject?: boolean }) {
    if (!activeScanPreview || busy) return;
    if (activeScanPreview.kind === "shrinkwrap") {
      const result = await runGuiShrinkwrap({
        action: "accept",
        entityId: activeScanPreview.entityId,
        previewId: activeScanPreview.id,
        createNew: options?.createNewObject ?? false,
      });
      if (result) {
        dismissScanTool();
        setMessage("Mesh preview accepted.");
      }
      return;
    }
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
    if (preview?.kind === "shrinkwrap") {
      if (!busy && !scanToolAbort.current)
        await runGuiShrinkwrap({
          action: "compare",
          entityId: preview.entityId,
          previewId: preview.id,
          deviation,
        });
      return;
    }
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
  function editLandmarkSession(
    edit: Parameters<NonNullable<WorkspaceHost["editLandmarks"]>>[0],
  ) {
    let next: LandmarkAlignment;
    if (edit.action === "begin") {
      if (nPointsRef.current)
        throw new Error("Close the active landmark session first.");
      const moving = entities.find((e) => e.id === edit.movingId);
      const fixed = entities.find((e) => e.id === edit.fixedId);
      if (!moving || (edit.fixedId && !fixed) || moving.locked || fixed?.locked)
        throw new Error("Choose existing unlocked moving and fixed objects.");
      next = beginLandmarkAlignment(moving, fixed, {
        targetScope: edit.targetScope,
        scene: entitiesRef.current,
      });
      setLandmarkPickSide("moving");
      setMode("inspect");
      setToolPanelOpen(true);
    } else {
      if (!nPointsRef.current)
        throw new Error("No active landmark alignment session.");
      next = editLandmarks(nPointsRef.current, edit, entitiesRef.current);
    }
    nPointsRef.current = next;
    setNPoints(next);
    return landmarkState(next);
  }
  function openLandmarks() {
    try {
      const moving = landmarkCommandSource(
        entitiesRef.current,
        selectedId,
        selectedIds,
      );
      if (!moving)
        throw new Error(
          "Choose an unlocked visible scan for point-pair alignment.",
        );
      editLandmarkSession({
        action: "begin",
        movingId: moving.id,
      });
      setSelectedId(moving.id);
    } catch (error) {
      setError(errorText(error));
    }
  }
  async function runLandmarkPreview(
    options: Parameters<NonNullable<WorkspaceHost["previewLandmarks"]>>[0] = {},
  ) {
    const session = nPointsRef.current;
    if (!session) throw new Error("No active landmark alignment session.");
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    landmarkAbort.current = controller;
    try {
      const request = await prepareLandmarkRequest(
        session,
        (kernelId) => cad.current!.alignmentMesh(kernelId),
        { ...options, signal: controller.signal },
      );
      const result = await processScanRegistration(
        session.moving,
        {
          ...request,
          ...(request.refinementTargets
            ? { sourceTriangleMask: sessionFor(session.moving).state.mask }
            : {}),
        },
        {
          signal: controller.signal,
          onProgress: options.onProgress,
          parallel: options.parallel,
          workerCount: options.workerCount,
          check: options.check,
        },
      );
      controller.signal.throwIfAborted();
      options.check?.();
      if (
        nPointsRef.current !== session ||
        !landmarkSceneUnchanged(session, entitiesRef.current)
      )
        throw new Error(
          "The landmark session or geometry changed during preview.",
        );
      const next = { ...session, preview: result };
      flushSync(() => {
        nPointsRef.current = next;
        setNPoints(next);
      });
      return landmarkState(next);
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (landmarkAbort.current === controller) landmarkAbort.current = null;
    }
  }
  function previewLandmarks() {
    if (busy) return;
    void action("Previewing landmark alignment…", async () => {
      try {
        await runLandmarkPreview();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setMessage("Landmark preview cancelled");
          return;
        }
        throw error;
      }
    });
  }
  function commitLandmarkPreview() {
    const alignment = nPointsRef.current;
    if (!alignment) throw new Error("No active landmark alignment session.");
    const next = acceptLandmarkAlignment(alignment, entitiesRef.current);
    const source = next.find((e) => e.id === alignment.moving.id)!;
    const session = sessionFor(alignment.moving);
    if (alignment.preview?.selection)
      session.set({ ...session.state, mask: alignment.preview.selection });
    selectionSessions.current.set(source.id, {
      positions: cloudSelectionSource(source),
      session,
    });
    operationLabel.current = "Align by corresponding points";
    try {
      commit(next, source.id);
    } finally {
      operationLabel.current = null;
    }
    cancelLandmarks();
    setMessage("Landmark alignment accepted · fixed target preserved");
    return {
      active: false,
      accepted: true,
      entityId: source.id,
      registration: alignment.preview?.registration,
      refinement: alignment.preview?.refinement,
      diagnostics: alignment.preview?.diagnostics,
    };
  }
  function acceptLandmarks() {
    if (busy) return;
    try {
      commitLandmarkPreview();
    } catch (error) {
      operationLabel.current = null;
      setError(errorText(error));
    }
  }
  function openAlignment() {
    try {
      setInterface({ datumAlignmentOpen: true });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Cannot open alignment.",
      );
    }
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
    if (!selected || selected.locked) return;
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
    if (interactiveStore.getSnapshot()) {
      setError("Apply or cancel Interactive alignment first.");
      return;
    }
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
    setProjectId(crypto.randomUUID());
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
  const importCommit = useRef(commit);
  importCommit.current = commit;
  const loadFile = useRef(openFile);
  loadFile.current = openFile;
  async function openFiles(files: File[], unit?: ScanUnit) {
    if (!files.length || busyRef.current) return;
    try {
      validateImportBatch(files.map((file) => file.name));
    } catch (error) {
      setError(errorText(error));
      return;
    }
    if (
      !unit &&
      files.some((file) => /\.(stl|obj|ply|asc)$/i.test(file.name))
    ) {
      setPendingScanImport(files);
      return;
    }
    const controller = new AbortController();
    importAbort.current = controller;
    await action(
      `Opening ${files.length} file${files.length === 1 ? "" : "s"}…`,
      async () => {
        try {
          const status = beginWorkingJob("Importing files");
          let result;
          try {
            result = await importBatch(
              files,
              async (file, _index, context) =>
                /\.(stl|obj|ply|asc)$/i.test(file.name)
                  ? prepareImportedScan(file, {
                      unit,
                      placeAtOrigin: true,
                      previewTriangles: previewImport ? 250_000 : undefined,
                      signal: context.signal,
                      onProgress: (fraction) =>
                        context.progress(fraction, "Importing"),
                    })
                  : undefined,
              controller.signal,
              {
                concurrency: importConcurrency(files),
                names: files.map((file) => file.name),
                onProgress: (details) => {
                  const fraction =
                    details.files.reduce(
                      (sum, file) => sum + file.fraction,
                      0,
                    ) / files.length;
                  status.progress(fraction, "Importing files", details);
                  setImportProgress({
                    name: `${details.files.filter((file) => file.status === "complete").length}/${files.length} files`,
                    fraction,
                  });
                },
                commit: async (prepared, file) => {
                  operationLabel.current = `Opening ${file.name}`;
                  await loadFile.current(
                    file,
                    unit,
                    controller.signal,
                    prepared,
                    true,
                  );
                  return file.name;
                },
              },
            );
            if (result.completed.length) viewport.current?.fitView();
          } finally {
            status.finish();
          }
          if (result.failed.length)
            setError(
              result.failed
                .map(
                  (failure) => `${files[failure.index].name}: ${failure.error}`,
                )
                .join("\n"),
            );
          setMessage(
            `${result.cancelled ? "Import cancelled" : "Opened"} · ${result.completed.length}/${files.length} files${result.failed.length ? ` · ${result.failed.length} failed` : ""}${unit ? ` · ${SCAN_UNITS[unit].label} converted to mm` : ""}`,
          );
        } finally {
          importAbort.current = null;
        }
      },
    );
  }
  async function openFile(
    file: File,
    unit?: ScanUnit,
    signal?: AbortSignal,
    prepared?: Entity,
    batch = false,
  ) {
    setImportProgress({
      name: file.name,
      fraction: /\.(stl|obj|ply|asc|step|stp|iges|igs|brep)$/i.test(file.name)
        ? 0
        : null,
    });
    const extension = file.name.split(".").pop()!.toLowerCase();
    if (extension === "scanforge" || extension === "json") {
      const session = await decodeProjectFile(file, signal);
      signal?.throwIfAborted();
      const project = session.project;
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
        const handles = new Map<string, string>();
        async function restoreState(items: Entity[]): Promise<Entity[]> {
          const restored: Entity[] = [];
          for (const entity of items) {
            signal?.throwIfAborted();
            if (entity.brep) {
              let kernelId = handles.get(entity.brep);
              if (!kernelId) {
                const data = await restoredCad.importFile(
                  new TextEncoder().encode(entity.brep),
                  "brep",
                );
                kernelId = data.kernelId;
                handles.set(entity.brep, kernelId);
              }
              restored.push({ ...entity, kernelId });
            } else restored.push(entity);
          }
          return restored;
        }
        const restored = await restoreState(project.entities);
        const restoredHistory: Revision[] = [],
          restoredFuture: Revision[] = [];
        for (const item of session.history)
          restoredHistory.push({
            label: item.label,
            entities: await restoreState(item.entities),
          });
        for (const item of session.future)
          restoredFuture.push({
            label: item.label,
            entities: await restoreState(item.entities),
          });
        signal?.throwIfAborted();
        cad.current?.dispose();
        cad.current = restoredCad;
        knownKernelIds.current = new Set();
        pendingImportFit.current = null;
        setEntities(restored);
        setSelectedId(
          project.authoring?.activeSketchId ? null : (restored[0]?.id ?? null),
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
        setHistory(restoredHistory);
        setFuture(restoredFuture);
        setProjectId(session.projectId ?? crypto.randomUUID());
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
        entity =
          prepared ??
          (await prepareImportedScan(file, {
            unit,
            placeAtOrigin: true,
            previewTriangles: previewImport ? 250_000 : undefined,
            signal,
            onProgress: (fraction) =>
              setImportProgress({ name: file.name, fraction }),
          }));
      }
      if (!batch) pendingImportFit.current = entity.id;
      setImportProgress({ name: file.name, fraction: null });
      setMessage(`Rendering ${file.name}…`);
      try {
        signal?.throwIfAborted();
        flushSync(() => {
          importCommit.current([...entitiesRef.current, entity]);
          setSelectedId(entity.id);
        });
      } catch (error) {
        if (
          entity.kernelId &&
          !entitiesRef.current.some((item) => item.id === entity.id)
        )
          await cad.current?.release([entity.kernelId]);
        throw error;
      }
    }
    try {
      await viewport.current?.present(signal);
    } catch (error) {
      if (!batch || !signal?.aborted) throw error;
    }
    setMessage(
      `Opened ${file.name}${unit ? ` · ${SCAN_UNITS[unit].label} converted to mm` : ""}`,
    );
  }
  function growSelection(
    clickedSeeds?: Uint8Array,
    remove = false,
    wholeComponent = false,
  ) {
    if (
      !selected ||
      busy ||
      (!clickedSeeds && (!triangleMask || !selectedTriangleCount))
    )
      return;
    if (selected.kind === "pointcloud") {
      void runPointEdit({
        action: "connectedSelection",
        selection: clickedSeeds ?? triangleMask ?? undefined,
      });
      return;
    }
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
            allConnected: wholeComponent || allConnected,
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
    if (selected.kind === "pointcloud") {
      try {
        const request = {
          kind: "pointCloudEdit" as const,
          positions: selected.positions,
          normals: selected.normals,
          selection: triangleMask,
        };
        const picked =
          operation !== "delete"
            ? editPointCloud({ ...request, action: "extract" })
            : undefined;
        const remainder =
          operation !== "copy"
            ? editPointCloud({ ...request, action: "delete" })
            : undefined;
        let next = entities;
        if (remainder)
          next = remainder.positions!.length
            ? next.map((entity) =>
                entity.id === selected.id
                  ? {
                      ...entity,
                      positions: remainder.positions!,
                      normals: remainder.normals
                        ? Array.from(remainder.normals)
                        : undefined,
                      meshSelection: undefined,
                    }
                  : entity,
              )
            : next.filter((entity) => entity.id !== selected.id);
        if (picked) {
          const created: Entity = {
            ...selected,
            id: crypto.randomUUID(),
            name: `${selected.name} selection`,
            positions: picked.positions!,
            normals: picked.normals ? Array.from(picked.normals) : undefined,
            meshSelection: undefined,
          };
          next = [...next, created];
          setSelectedId(created.id);
        } else if (!remainder?.positions?.length) setSelectedId(null);
        operationLabel.current = `${operation} ${selectedTriangleCount} points`;
        commit(next);
        operationLabel.current = null;
        setMessage(
          `${selectedTriangleCount} points ${operation === "delete" ? "deleted" : operation === "copy" ? "copied" : "cut"}`,
        );
      } catch (error) {
        setError(errorText(error));
      }
      return;
    }
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
    setWorkspace("fit");
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
      const positions = primitiveFitSamples(
        selected,
        triangleMask,
        localFit && anchor ? { center: anchor, radius: fitRadius } : undefined,
      );
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
    const result = await createCadFeature(
      cad.current!,
      entities,
      { kind: "primitive", input },
      label,
    );
    const entity = { ...result.created[0], kind: input.kind, opacity: 0.85 };
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
        const transformed = transformIndexedMesh(
          selected,
          translation,
          rotation,
          scale,
        );
        updateSelected({
          ...transformed,
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
    if (busy) return;
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
            sampled: isSampledScan(session.source.scanSource),
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
    void uiCommand(repeat ? "history_redo" : "history_undo", {
      scope: "sketch",
    });
  }
  // Called only inside the shared API admission lane, which already owns busy.
  function applySketchUndo(repeat: boolean): boolean {
    const key = activeSketchId ? `saved:${activeSketchId}` : "legacy";
    const session = sketchUndoSessions.current.get(key);
    const sketch = repeat
      ? session?.redo(sketchDraft)
      : session?.undo(sketchDraft);
    if (!sketch) return false;
    applySketchDraft(sketch);
    setMessage(repeat ? "Sketch edit reapplied" : "Sketch edit undone");
    return true;
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
      if (recipe) {
        const resolved =
          typeof recipe === "function" ? recipe(bound.refs) : recipe;
        const result = await createCadFeature(
          cad.current!,
          bound.entities,
          resolved,
          label.replace(/…$/, ""),
          { hideInputs },
        );
        commit(result.entities);
        setSelectedId(result.created[0].id);
        setMessage(`${result.created[0].name} created as exact CAD`);
        return;
      }
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
        parametric: undefined,
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
      if (!selected) throw new Error("Select a parametric body.");
      const result = await rebuildCadFeature(
        cad.current!,
        entities,
        history,
        future,
        selected.id,
        recipe,
      );
      commit(result.entities);
      if (result.cleanupFailures.length)
        setError(result.cleanupFailures.map((f) => f.message).join("; "));
      setMessage(
        `Rebuilt ${result.rebuiltFeatureIds.length} dependent features · previous CAD retained for Undo`,
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
        await encodeProjectFile({
          ...projectSession,
          project: { ...projectSession.project, name: projectName },
        }),
        `${projectName.replace(/[^a-z0-9-_ ]/gi, "_")}.scanforge`,
        "application/x-scanforge",
      );
      setName(projectName);
      setDirty(false);
      setMessage(
        "Project downloaded · CAD and complete model timeline retained",
      );
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
  function setInterface(input: InterfacePatch) {
    const patch = coordinateAlignmentInterface(input, selected);
    if (
      interactiveStore.getSnapshot() &&
      (patch.workspace !== undefined ||
        patch.toolPanelOpen !== undefined ||
        patch.datumAlignmentOpen !== undefined ||
        patch.globalAlignmentOpen !== undefined)
    )
      throw new Error(
        "Apply or cancel Interactive alignment before changing its panel.",
      );
    if (
      patch.workspace !== undefined &&
      (nPoints ||
        surfaceFit ||
        scanPreview ||
        createSketch ||
        datumPreview.current)
    )
      throw new Error(
        "Finish or cancel the GUI preview before changing its tool panel.",
      );
    if (patch.datumAlignmentOpen === false && datumPreview.current)
      throw new Error("Finish or cancel alignment before closing its panel.");
    if (patch.ribbonTab !== undefined) {
      if (!RIBBON_TABS.some((tab) => tab.id === patch.ribbonTab))
        throw new Error("Unknown ribbon tab.");
      setRibbonTab(patch.ribbonTab);
    }
    if (patch.workspace !== undefined) showTools(patch.workspace);
    if (patch.mode !== undefined) setMode(patch.mode);
    if (patch.toolPanelOpen !== undefined)
      setToolPanelOpen(patch.toolPanelOpen);
    if (patch.datumAlignmentOpen !== undefined) {
      if (!patch.datumAlignmentOpen) {
        datumPointPick.current = null;
        datumFacePick.current = null;
      }
      setDatumAlignmentOpen(patch.datumAlignmentOpen);
    }
    if (patch.globalAlignmentOpen !== undefined) {
      const state = workspaceApi.inspectGlobalAlignmentPreview();
      if (!patch.globalAlignmentOpen && state.state !== "idle")
        throw new Error(
          "Apply or cancel Global Fine Align before closing its panel.",
        );
      if (patch.globalAlignmentOpen) {
        const candidates = inspectGlobalAlignmentCandidates(entities);
        if (!candidates.canPreview)
          throw new Error(
            candidates.blocked.map((item) => item.reason).join(" ") ||
              "Global Fine Align requires two to 32 visible scan meshes.",
          );
        if (
          nPoints ||
          surfaceFit ||
          createSketch ||
          (datumPreview.current && state.state === "idle")
        )
          throw new Error(
            "Finish or cancel the active preview before Global Fine Align.",
          );
        setWorkspace("properties");
        setToolPanelOpen(true);
        setMode("inspect");
      }
      setGlobalAlignmentOpen(patch.globalAlignmentOpen);
    }
    if (patch.settingsOpen !== undefined) setSettingsOpen(patch.settingsOpen);
    if (patch.settingsSection !== undefined)
      setSettingsSection(patch.settingsSection);
    if (patch.dismissError) setError("");
  }
  const workspaceApi = useWorkspaceApi({
    inspectInteractive: interactiveStore.getSnapshot,
    publishInteractive: (next) => {
      const changed = !!next !== !!interactiveStore.getSnapshot();
      viewport.current?.setInteractivePreview(next);
      interactiveStore.publish(next);
      if (changed) {
        setInteractiveOpen(!!next);
        setToolPanelOpen(!!next);
        if (next) {
          setMode("inspect");
          setScanPanel(null);
          setMeshClip(null);
          setScanBoundaryPaths([]);
          setSplitMeshOpen(false);
          setQuickToolsPoint(null);
        }
      }
    },
    installInteractiveMirror: (backend) => {
      if (!viewport.current) throw new Error("Viewport is not ready.");
      viewport.current.installInteractiveMirror(backend);
    },
    interactiveDragInput: (input) =>
      viewport.current?.interactiveDragInput(input) ?? null,
    interactiveViewFrame: () => {
      if (!viewport.current) throw new Error("Viewport is not ready.");
      return viewport.current.interactiveViewFrame();
    },
    finishInteractiveCurrentView: () => {
      if (!viewport.current) throw new Error("Viewport is not ready.");
      viewport.current.finishInteractiveCurrentView();
    },
    inspectCommands: () => commandRepeat.current.inspect(),
    launchCommand: runRepeatable,
    clearScanPreview: (previewId) => {
      setScanPreview((current) => (current?.id === previewId ? null : current));
      setNoiseComparison((current) =>
        current?.kind === "shrinkwrap" ? null : current,
      );
    },
    showScanPreview: (preview) => {
      if (!preview) {
        setScanPreview(null);
        setNoiseComparison(null);
        return;
      }
      setSelectedId(preview.entityId);
      setScanTool("shrinkwrap");
      setMode("inspect");
      showTools("scanTools");
      setScanPreview({
        id: preview.id,
        kind: "shrinkwrap",
        entityId: preview.entityId,
        source: preview.source,
        output: preview.output,
        settings: preview.settings,
      });
      setScanToolResult(preview.summary);
      if (preview.comparison)
        setNoiseComparison({
          kind: "shrinkwrap",
          entityId: preview.entityId,
          source: preview.source,
          output: preview.output,
          ...preview.comparison,
          visible: true,
        });
      else setNoiseComparison(null);
    },
    showDatumPreview: (next) => {
      datumPreview.current = next ? { base: entities, entities: next } : null;
      viewport.current?.setEntities(next ?? entities, selectedId, selectedIds);
    },
    discardPreview: (target) => {
      if (target === "scan") closeScanTool();
      else if (target === "globalAlignment") {
        // The shared global operation releases only its own cached display.
        workspaceApi.validateGlobalAlignmentPreview();
      } else if (target === "datum") {
        datumPreview.current = null;
        datumPointPick.current = null;
        viewport.current?.setEntities(entities, selectedId, selectedIds);
      } else if (target === "surface") cancelSurfaceFit();
      else if (target === "landmarks") cancelLandmarks();
      else cancelSketchCreation();
    },
    inspectLandmarks: () => landmarkState(nPointsRef.current),
    editLandmarks: editLandmarkSession,
    previewLandmarks: runLandmarkPreview,
    acceptLandmarks: commitLandmarkPreview,
    inspectApplication: (maxControls) => {
      const root = viewportHost.current?.closest<HTMLElement>(".workbench");
      if (!root) throw new Error("Application is not mounted.");
      const globalAlignment = workspaceApi.inspectGlobalAlignmentPreview();
      return {
        name,
        commands: commandRepeat.current.inspect(),
        selectedId,
        dirty,
        busy: busyRef.current,
        message,
        error,
        workspace,
        ribbonTab,
        mode,
        toolPanelOpen,
        datumAlignmentOpen,
        globalAlignmentOpen,
        globalAlignment,
        settingsOpen,
        settingsSection,
        previews: {
          interactive: !!interactiveStore.getSnapshot(),
          landmarkSession: !!nPoints,
          sketchSection: !!createSketch,
          dialog: !!(
            primitiveDialog ||
            saveDialogOpen ||
            newDocumentDialog ||
            pendingScanImport ||
            settingsOpen ||
            planePicking ||
            contextMenu ||
            renameObject ||
            sketchPlaneDialog
          ),
          datum: !!datumPreview.current && globalAlignment.state === "idle",
          globalAlignment: globalAlignment.state !== "idle",
          scan: !!scanPreview,
          landmarks: !!nPoints?.preview,
          surface: !!surfaceFit?.preview,
        },
        progress: {
          import: importProgress,
          working: getWorkingJobStatus() || (busy ? message : ""),
          scan: { fraction: scanToolFraction, stage: scanToolProgress },
        },
        ...inspectApplicationDom(root, maxControls),
      };
    },
    setInterface,
    inspectViewport: () => {
      if (!viewport.current) throw new Error("Viewport is not ready.");
      return viewport.current.inspectAgentView();
    },
    inspectSpaceMouse,
    controlSpaceMouse,
    controlViewport: (command) => {
      if (!viewport.current) throw new Error("Viewport is not ready.");
      viewport.current.controlAgentView(command, triangleMask ?? undefined);
    },
    pickViewport: (x, y, maxHits) => {
      if (!viewport.current) throw new Error("Viewport is not ready.");
      return viewport.current.pickAgentView(x, y, maxHits);
    },
    captureScreenshot: (options, signal) => {
      const root = viewportHost.current?.closest<HTMLElement>(".workbench");
      if (!root || !viewportHost.current || !viewport.current)
        throw new Error("Application is not ready for capture.");
      return captureApplicationImage(
        {
          applicationRoot: root,
          viewportRoot: viewportHost.current,
          renderViewport: () => viewport.current!.captureFrame(),
        },
        options,
        signal,
      );
    },
    renameProject: (nextName) => {
      setName(nextName);
      setDirty(true);
    },
    snapshot: () => ({
      projectId,
      name,
      entities,
      history,
      future,
      authoring: projectSession.project.authoring ?? {},
      sketchDraft,
      selectedId,
      selectedIds,
      selectionAnchorId: objectSelection.anchorId,
      selection: triangleMask,
      settings: {
        theme,
        wireframe,
        flatShading,
        normalsDisplay,
        floorGrid,
        gridSpacing,
        ...viewport.current?.getGridState(),
        automaticGrid,
        snapGrid,
        originVisible,
      },
    }),
    cad: () => {
      if (!cad.current) throw new Error("CAD runtime is unavailable");
      return cad.current;
    },
    commit: (next, label) => {
      const protectedObject = lockedObjectEdit(entities, next);
      if (protectedObject)
        throw new Error(
          `Unlock ${protectedObject.name} before editing or deleting it.`,
        );
      entityFeatureModel(next);
      operationLabel.current = label;
      try {
        commit(next);
      } finally {
        operationLabel.current = null;
      }
    },
    replace: (project, restoredCad, session) => {
      setProjectId(session?.projectId ?? crypto.randomUUID());
      if (restoredCad) {
        cad.current?.dispose();
        cad.current = restoredCad;
        knownKernelIds.current.clear();
      }
      selectionSessions.current.clear();
      sketchUndoSessions.current.clear();
      setEntities(project.entities);
      setName(project.name);
      setSelectedId(project.entities[0]?.id ?? null);
      setTriangleMask(null);
      setSavedSketches(project.authoring?.sketches ?? []);
      setActiveSketchId(project.authoring?.activeSketchId ?? null);
      legacySketch.current = project.authoring?.sketch ?? rectangleSketch();
      setSketchDraft(
        project.authoring?.sketches?.find(
          (s) => s.id === project.authoring?.activeSketchId,
        )?.sketch ?? legacySketch.current,
      );
      setHistory(session?.history ?? []);
      setFuture(session?.future ?? []);
      setDirty(true);
      setMeasure([]);
      setFit(null);
      cancelSurfaceFit();
      cancelLandmarks();
      dismissScanTool();
    },
    select: selectObjects,
    present: (signal) => viewport.current?.present(signal) ?? Promise.resolve(),
    deleteBackup: async (id) => {
      await deleteBackup({ id });
    },
    setSelection: (entityId, mask) => {
      const entity = entities.find((e) => e.id === entityId);
      if (!entity) throw new Error("Selection object disappeared");
      const session = sessionFor(entity);
      session.set({ ...session.state, mask });
      setSelectedId(entityId);
      applySelectionState(entity, session.state);
    },
    setSketch: updateSketchDraft,
    setAuthoring: (authoring) => {
      pruneSketchUndoSessions(
        sketchUndoSessions.current,
        authoring.sketches ?? [],
      );
      setSavedSketches(authoring.sketches ?? []);
      setActiveSketchId(authoring.activeSketchId ?? null);
      legacySketch.current = authoring.sketch ?? rectangleSketch();
      setSketchDraft(
        authoring.sketches?.find((s) => s.id === authoring.activeSketchId)
          ?.sketch ?? legacySketch.current,
      );
      setDirty(true);
    },
    stepSketchHistory: applySketchUndo,
    undo: undoModel,
    redo: redoModel,
    view: (view) => {
      if (view === "fit") viewport.current?.fitView();
      else viewport.current?.setView(view as "iso");
    },
    settings: (patch) => {
      if (patch.theme !== undefined) setTheme(patch.theme as Theme);
      if (patch.wireframe !== undefined)
        setWireframe(patch.wireframe as boolean);
      if (patch.flatShading !== undefined)
        setFlatShading(patch.flatShading as boolean);
      if (patch.normalsDisplay !== undefined)
        setNormalsDisplay(patch.normalsDisplay as boolean);
      if (patch.floorGrid !== undefined)
        setFloorGrid(patch.floorGrid as boolean);
      if (patch.gridSpacing !== undefined)
        setGridSpacing(patch.gridSpacing as number);
      if (patch.automaticGrid !== undefined)
        setAutomaticGrid(patch.automaticGrid as boolean);
      if (patch.snapGrid !== undefined) setSnapGrid(patch.snapGrid as boolean);
      if (patch.originVisible !== undefined)
        setOriginVisible(patch.originVisible as boolean);
    },
    busy: () => busyRef.current,
    activity: (running, label, selectionMode) => {
      viewport.current?.setSelectionProcessing(
        running && label === "Agent/API: mesh_process",
        selectionMode,
      );
      busyRef.current = running;
      setBusy(running);
      setMessage(label);
    },
  });
  const interactiveEditor = useMemo(
    () => createInteractiveEditor(workspaceApi, interactiveStore.getSnapshot),
    [workspaceApi, interactiveStore],
  );
  async function uiCommand(
    command: string,
    args: Record<string, unknown> = {},
  ) {
    const result = await workspaceApi.invoke(command, {
      ...args,
      expectedRevision: workspaceApi.currentRevision(),
      requestId: crypto.randomUUID(),
    });
    if (!result.ok) setError(result.error.message);
    return result;
  }
  async function readAlignmentReferences(
    entityId: string,
    offset: number,
    signal: AbortSignal,
    triangleIndex?: number,
  ): Promise<AlignmentReferencePage> {
    signal.throwIfAborted();
    const receipt = await workspaceApi.invoke("alignment_references", {
      entityId,
      offset,
      limit: 50,
      ...(triangleIndex === undefined ? {} : { triangleIndex }),
    });
    if (!receipt.ok) throw new Error(receipt.error.message);
    const { jobId } = receipt.result as { jobId: string };
    const cancel = () => {
      void workspaceApi.invoke("job_cancel", { jobId });
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const expires = Date.now() + 95_000;
      while (Date.now() < expires) {
        signal.throwIfAborted();
        const response = await workspaceApi.invoke("job_get", { jobId });
        if (!response.ok) throw new Error(response.error.message);
        const job = response.result as {
          status: string;
          result?: AlignmentReferencePage;
          error?: { message: string };
        };
        if (job.status === "succeeded" && job.result) return job.result;
        if (job.status !== "running")
          throw new Error(
            job.error?.message ?? "Reference inspection cancelled.",
          );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      cancel();
      throw new Error("Reference inspection exceeded its time limit.");
    } finally {
      if (signal.aborted) cancel();
      signal.removeEventListener("abort", cancel);
    }
  }
  function undo() {
    void uiCommand("history_undo");
  }
  function redo() {
    void uiCommand("history_redo");
  }
  return (
    <div
      className="workbench"
      data-workspace={workspaceGroup(workspace)}
      data-panel-open={toolPanelOpen}
      onDragOver={(event) => {
        event.preventDefault();
        if (!editingBlocked) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length && !editingBlocked) void openFiles(files);
      }}
    >
      <Ribbon
        projectRecovery={
          <ProjectRecovery
            backups={backups}
            status={backupStatus}
            disabled={busy}
            offerRecovery={offerRecovery && entities.length === 0}
            onDismiss={dismissRecovery}
            onDelete={async (backup) => {
              const result = await uiCommand("backup_delete", {
                backupId: backup.id,
              });
              if (!result.ok) throw new Error(result.error.message);
            }}
            onRestore={(backup) => {
              if (
                dirty &&
                !window.confirm(
                  "Replace the current project? Unsaved changes will be lost.",
                )
              )
                return;
              void uiCommand("backup_restore", {
                backupId: backup.id,
                replace: true,
              });
            }}
          />
        }
        utilityHeader={
          <header className="header">
            <div className="header-actions">
              <SpaceMouseConnection
                compact
                status={spaceMouseStatus}
                connected={spaceMouse.current?.connected ?? false}
                connecting={spaceMouseConnecting}
                available={true}
                onConnect={() => {
                  setSettingsSection("spacemouse");
                  setSettingsOpen(true);
                }}
                onSettings={() => {
                  setSettingsSection("spacemouse");
                  setSettingsOpen(true);
                }}
              />
              <HeaderIconButton
                label="Open scan"
                disabled={editingBlocked}
                onClick={() => fileInput.current?.click()}
              >
                <FolderOpen size={17} aria-hidden="true" />
              </HeaderIconButton>
              <SaveProjectButton
                dirty={dirty}
                disabled={editingBlocked}
                onSave={save}
              />
              <HeaderIconButton
                label="Export STEP"
                disabled={editingBlocked}
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
        disabled={editingBlocked || !!nPoints || !!surfaceFit || !!createSketch}
        interactiveTargetError={interactiveTargetError}
        globalAlignmentError={globalAlignmentError}
        hasSelection={!!selected}
        landmarkSourceId={landmarkSource?.id ?? null}
        canUndo={!!history.length}
        canRedo={!!future.length}
        actions={repeatableRibbonActions}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept=".stl,.obj,.ply,.asc,.step,.stp,.iges,.igs,.brep,.scanforge,.json"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length && !interactiveStore.getSnapshot())
            void openFiles(files);
        }}
      />
      {pendingScanImport && (
        <ImportUnitsDialog
          onCancel={() => setPendingScanImport(null)}
          onImport={(unit) => {
            const files = pendingScanImport;
            setPendingScanImport(null);
            void openFiles(files, unit);
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
      {renameObject && (
        <RenameObjectDialog
          name={renameObject.name}
          count={renameObject.ids.length}
          onClose={() => setRenameObject(null)}
          onRename={async (name) => {
            const result = await uiCommand("object_rename", {
              entityIds: renameObject.ids,
              name,
            });
            if (result.ok) setRenameObject(null);
          }}
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
                  ]
                : contextMenu.kind === "object"
                  ? objectMenuActions()
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
                                  selected.positions.length /
                                    (selected.kind === "pointcloud" ? 3 : 9),
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
                                  {
                                    length:
                                      selected.positions.length /
                                      (selected.kind === "pointcloud" ? 3 : 9),
                                  },
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
              onDeselect={() => {
                setQuickToolsPoint(null);
                changeSelection(null);
              }}
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
                    {
                      length:
                        selected!.positions.length /
                        (selected!.kind === "pointcloud" ? 3 : 9),
                    },
                    (_, i) => (triangleMask?.[i] ? 0 : 1),
                  ),
                )
              }
            />
          )}
        <aside
          className="explorer"
          inert={editingBlocked || !!nPoints || !!surfaceFit || !!createSketch}
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
                    if (objectPickable(entity)) setSelectedId(entity.id);
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      kind: "object",
                      objectId: entity.id,
                    });
                  }}
                  className={selectedIds.includes(entity.id) ? "selected" : ""}
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
                    aria-pressed={selectedIds.includes(entity.id)}
                    onClick={(event) => {
                      if (objectPickable(entity))
                        void uiCommand("object_select", {
                          entityId: entity.id,
                          toggle: event.ctrlKey || event.metaKey,
                          range: event.shiftKey,
                        });
                    }}
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
                  {(entity.locked || entity.selectable === false) && (
                    <span
                      className="object-protection"
                      aria-label={
                        entity.locked ? "Locked object" : "Unselectable object"
                      }
                      title={
                        entity.locked ? "Locked object" : "Unselectable object"
                      }
                    >
                      {entity.locked ? "🔒" : "∅"}
                    </span>
                  )}
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
            normals={normalsDisplay}
            onNormals={setNormalsDisplay}
            grid={floorGrid}
            spacing={gridSpacing}
            automatic={automaticGrid}
            onAutomatic={setAutomaticGrid}
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
        {globalAlignmentOpen && (
          <GlobalAlignmentTools
            api={workspaceApi}
            entities={entities}
            onClose={() => {
              setGlobalAlignmentOpen(false);
              setToolPanelOpen(false);
            }}
          />
        )}
        {interactiveOpen && (
          <InteractiveAlignmentDialog
            store={interactiveStore}
            busy={busy}
            mirrorAvailable={
              !!interactiveStore
                .getSnapshot()
                ?.entityIds.some(
                  (id) => entities.find((e) => e.id === id)?.kind === "mesh",
                )
            }
            onEdit={interactiveEditor.edit}
            onApply={interactiveEditor.apply}
            onCancel={async () => {
              await interactiveEditor.cancel();
              setMessage("Interactive alignment cancelled");
            }}
          />
        )}
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
              (e) =>
                e.id !== nPoints.moving.id &&
                objectPickable(e) &&
                e.positions.length >= 3,
            )}
            busy={busy}
            pickSide={landmarkPickSide}
            onPickSide={(side) => {
              setLandmarkPickSide(side);
            }}
            onTarget={(id) => {
              editLandmarkSession({
                action: "reference-target",
                fixedId: id || undefined,
              });
            }}
            onTargetScope={(targetScope) =>
              editLandmarkSession({ action: "target-scope", targetScope })
            }
            onRemoveLast={() => editLandmarkSession({ action: "remove-last" })}
            onRemoveAll={() => editLandmarkSession({ action: "clear" })}
            onReset={() => editLandmarkSession({ action: "reset" })}
            onPreview={previewLandmarks}
            onAccept={acceptLandmarks}
            onCancel={cancelLandmarks}
          />
        )}
        <ToolWorkspace.Provider value={workspace}>
          <aside
            className={`inspector ${workspace === "scanTools" || (workspace === "mesh" && selected) ? "command-host" : ""}`}
            style={
              interactiveOpen ||
              globalAlignmentOpen ||
              nPoints ||
              surfaceFit ||
              createSketch
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
              !(
                workspace === "mesh" &&
                selected &&
                (scanPanel || splitMeshOpen)
              ) && (
                <h2>
                  {workspaceTitle(workspace) ??
                    (
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
                    )[workspace] ??
                    "Object properties"}{" "}
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
                previewSettings={activeScanPreview?.settings}
                disabled={actionBusy}
                busy={
                  processingBusy || (scanTool === "shrinkwrap" && actionBusy)
                }
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
                  scanTool === "mirrorMesh" ||
                  scanTool === "shrinkwrap"
                    ? acceptScanPreview
                    : undefined
                }
                onInvalidatePreview={() => {
                  workspaceApi.discardScanPreview();
                  setScanPreview(null);
                  setNoiseComparison(null);
                }}
                onCompare={
                  scanTool === "reduceNoise" ||
                  scanTool === "reducePolygons" ||
                  scanTool === "shrinkwrap"
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
                    previous
                      ? { ...previous, visible: !previous.visible }
                      : null,
                  )
                }
                onClose={closeScanTool}
                onCancel={() => {
                  if (scanTool === "shrinkwrap")
                    cancelShrinkwrapOperation(
                      workspaceApi,
                      scanToolAbort.current,
                    );
                  else scanToolAbort.current?.abort();
                }}
                pickedReferenceId={pickedScanReference}
                onPickReference={(kind) => {
                  scanReferencePick.current = kind;
                  setMode("inspect");
                  setMessage(
                    `Pick a ${kind === "plane" ? "planar reference" : "cylinder"} on the canvas.`,
                  );
                }}
              />
            ) : (workspace === "pointNoise" || workspace === "pointReduce") &&
              selected?.kind === "pointcloud" ? (
              <PointCloudTools
                key={`${workspace}:${selected.id}`}
                tool={workspace === "pointNoise" ? "noise" : "reduce"}
                count={selected.positions.length / 3}
                selection={triangleMask}
                busy={busy}
                onApply={runPointEdit}
              />
            ) : workspace === "mesh" && selected && splitMeshOpen ? (
              <SplitMeshPanel
                key={selected.id}
                cutters={entities.filter((entity) => entity.id !== selected.id)}
                busy={busy}
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
                onClose={() => {
                  scanEditAbort.current?.abort();
                  setToolPanelOpen(false);
                  setSplitMeshOpen(false);
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
                onBridgeSession={setScanBridgeSession}
                onBridgeDisplay={displayScanBridge}
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
                pointCloud={selected.kind === "pointcloud"}
                pointTools={
                  selected.kind === "pointcloud" ? (
                    <PointCloudTools
                      count={selected.positions.length / 3}
                      selection={triangleMask}
                      busy={busy}
                      onApply={runPointEdit}
                    />
                  ) : undefined
                }
                onConnected={() => growSelection(undefined, false, true)}
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
                    new Uint8Array(
                      selected.positions.length /
                        (selected.kind === "pointcloud" ? 3 : 9),
                    ).fill(1),
                  )
                }
                onRevealSelected={revealSelectedTriangles}
                clip={meshClip}
                clipFull={
                  stats ? { min: stats.min, max: stats.max } : undefined
                }
                onClip={setMeshClip}
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
                      {
                        length:
                          selected.positions.length /
                          (selected.kind === "pointcloud" ? 3 : 9),
                      },
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
                          {workspace === "properties" ? (
                            <input
                              aria-label="Object name"
                              value={selected.name}
                              maxLength={200}
                              onChange={(e) =>
                                updateSelected({ name: e.target.value })
                              }
                            />
                          ) : (
                            <strong
                              style={{ display: "block", paddingBottom: 5 }}
                            >
                              {selected.name}
                            </strong>
                          )}
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
                      <ToolSection tools={["properties", "measure"]}>
                        <Panel title="Geometry" className="geometry-panel">
                          {selected.fit && (
                            <p className="muted">
                              {selected.fit.kind} fit · RMS{" "}
                              {number(selected.fit.rms)} mm · maximum residual{" "}
                              {number(selected.fit.maxError)} mm. Review fit
                              quality before reconstruction.
                            </p>
                          )}
                          {selected.scanSource &&
                            isSampledScan(selected.scanSource) && (
                              <p role="note" className="muted">
                                Sampled source:{" "}
                                {number(selected.scanSource.bytes)} bytes ·{" "}
                                {number(selected.scanSource.triangles)} source
                                triangles ·{" "}
                                {number(selected.scanSource.displayedTriangles)}{" "}
                                imported triangles. Operations and exports use
                                sampled geometry, not the complete source.
                              </p>
                            )}
                          <dl>
                            <dt>
                              {selected.kind === "pointcloud"
                                ? "Points"
                                : "Vertices (triangle soup)"}
                            </dt>
                            <dd>{number(stats.vertices)}</dd>
                            {selected.kind !== "pointcloud" && (
                              <>
                                <dt>Triangles</dt>
                                <dd>{number(stats.triangles)}</dd>
                              </>
                            )}
                            <dt>Bounds (mm)</dt>
                            <dd>{stats.size.map(number).join(" × ")}</dd>
                            {selected.kind !== "pointcloud" && (
                              <>
                                <dt>Surface area (mm²)</dt>
                                <dd>{number(stats.area)}</dd>
                                <dt>Volume estimate (mm³)</dt>
                                <dd>{number(stats.volume)}</dd>
                              </>
                            )}
                          </dl>
                          {selected.kind !== "pointcloud" && (
                            <p className="muted">
                              Volume assumes a closed, consistently oriented
                              mesh.
                            </p>
                          )}
                        </Panel>
                      </ToolSection>
                      {workspace === "properties" &&
                        (selected.kernelId || selected.fit) && (
                          <AlignmentReferences
                            key={`${selected.id}:${selected.kernelId ?? JSON.stringify(selected.fit)}`}
                            entityId={selected.id}
                            onRead={(offset, signal) =>
                              readAlignmentReferences(
                                selected.id,
                                offset,
                                signal,
                              )
                            }
                          />
                        )}
                      {workspace === "properties" &&
                        (selected.kernelId ||
                          (["mesh", "pointcloud"].includes(selected.kind) &&
                            !selected.parametric)) && (
                          <DatumAlignmentTools
                            open={datumAlignmentOpen}
                            onOpenChange={(open) => {
                              if (open) openAlignment();
                              else setDatumAlignmentOpen(false);
                            }}
                            api={workspaceApi}
                            entity={selected}
                            center={stats.center}
                            entities={entities}
                            readReferences={readAlignmentReferences}
                            onPickFace={(callback) => {
                              datumFacePick.current = callback;
                              if (callback) {
                                datumPointPick.current = null;
                                setMode("inspect");
                              }
                            }}
                            onPickPoint={(callback) => {
                              datumPointPick.current = callback;
                              if (callback) datumFacePick.current = null;
                              if (callback) setMode("inspect");
                            }}
                          />
                        )}
                      <ToolSection tools={["properties", "objectColor"]}>
                        <Panel
                          title={
                            workspace === "objectColor"
                              ? "Object color"
                              : "Display"
                          }
                          className="display-panel"
                        >
                          <ToolSection tools={["properties"]}>
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
                          </ToolSection>
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
                      </ToolSection>
                      <ToolSection tools={["properties"]}>
                        <ParametricTools
                          selected={selected ?? undefined}
                          disabled={busy}
                          onRebuild={rebuildFeature}
                          onError={setError}
                        />
                      </ToolSection>
                      <ToolSection tools={["transform"]}>
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
                      </ToolSection>
                      <ToolSection tools={["section"]}>
                        <Panel title="Cross section" className="section-panel">
                          <label className="select-field">
                            Axis
                            <AppSelect
                              aria-label="Section axis"
                              value={axis}
                              onChange={(e) =>
                                setAxis(e.target.value as "x" | "y" | "z")
                              }
                            >
                              <option value="x">X (YZ plane)</option>
                              <option value="y">Y (XZ plane)</option>
                              <option value="z">Z (XY plane)</option>
                            </AppSelect>
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
                                setMode(
                                  e.target.checked ? "section" : "inspect",
                                )
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
                                      section.segments
                                        .slice(i, i + 6)
                                        .join(","),
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
                      </ToolSection>
                      <ToolSection tools={["fit", "deviation"]}>
                        <Panel
                          title="Surface fitting"
                          className="fitting-panel"
                        >
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
                                onChange={(n) =>
                                  setTolerance(Math.max(0.001, n))
                                }
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
                                requires a sampled side surface. Color map
                                covers the entire object.
                              </p>
                            </>
                          ) : (
                            <p className="muted">
                              Select a scan and fit a plane, sphere, cylinder or
                              cone from the tool rail. Fits report residuals;
                              review them before creating CAD.
                            </p>
                          )}
                        </Panel>
                      </ToolSection>
                      {workspaceGroup(workspace) === "reconstruct" && (
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
                      )}
                    </div>
                  </>
                ) : activeSketchId && workspace === "sketch" ? (
                  <div className="selected-title">
                    <ScanLine size={25} />
                    <div>
                      <strong>
                        {
                          savedSketches.find((s) => s.id === activeSketchId)
                            ?.name
                        }
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
                {workspaceGroup(workspace) === "surface" && (
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
                )}
                {workspaceGroup(workspace) === "sketch" && (
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
                )}
                {workspaceGroup(workspace) === "processing" && (
                  <div className="processing-panels">
                    <MeshTools
                      key={`${workspace}:${selected?.id}`}
                      tool={
                        workspace === "processing"
                          ? "repairMesh"
                          : (workspace as import("./MeshTools").MeshTool)
                      }
                      entities={entities}
                      selected={selected}
                      triangleSelection={triangleMask}
                      disabled={busy}
                      onBusyChange={setProcessingBusy}
                      onReplace={(
                        positions,
                        label,
                        indexedMesh,
                        cloudPreview,
                      ) => {
                        if (cloudPreview) {
                          operationLabel.current = label;
                          try {
                            commit(
                              entitiesRef.current.map((entity) =>
                                entity.id === cloudPreview.id
                                  ? cloudPreview
                                  : entity,
                              ),
                              cloudPreview.id,
                            );
                          } finally {
                            operationLabel.current = null;
                          }
                          setMessage(label);
                          return;
                        }
                        if (selected?.parametric) {
                          createSegments([positions], label);
                          return;
                        }
                        operationLabel.current = label;
                        updateSelected({
                          positions,
                          indexedMesh,
                          normals: indexedRenderNormals(indexedMesh),
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
                )}
                {workspaceGroup(workspace) === "advancedCad" && (
                  <div className="advanced-cad-panels">
                    <AdvancedCadTools
                      key={`${workspace}:${selected?.id}`}
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
                          () =>
                            cad.current!.pattern(selected!.kernelId!, pattern),
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
                          const created = results.map(
                            (result, index): Entity => ({
                              ...result,
                              id: crypto.randomUUID(),
                              name: `Split ${index === 0 ? "inside" : "outside"}`,
                              kind: "cad",
                              color: DEFAULT_PART_COLOR,
                              visible: true,
                              opacity: 1,
                              parametric: { ...binding, output: index },
                            }),
                          );
                          commit([
                            ...bound.entities.map((entity) =>
                              entity.id === selected.id ||
                              entity.id === cutter.id
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
                          () =>
                            cad.current!.offset(selected!.kernelId!, distance),
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
                            cad.current!.thicken(
                              selected!.kernelId!,
                              thickness,
                            ),
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
                )}
              </>
            )}
          </aside>
        </ToolWorkspace.Provider>
      </main>
      <ModelTimeline
        labels={[...history, ...future].map((revision) => revision.label)}
        cursor={history.length}
        disabled={editingBlocked}
        onSeek={restoreRevision}
        onContextMenu={(event, revision) => {
          event.preventDefault();
          if (!editingBlocked)
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
      {
        <div
          className="modal-backdrop"
          style={{ display: settingsOpen ? undefined : "none" }}
          onClick={() => setSettingsOpen(false)}
        >
          <section
            className="modal settings-dialog"
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
            <SettingsTabs
              value={settingsSection}
              onChange={setSettingsSection}
            />
            <div className="settings-content">
              <section
                className="settings-section"
                aria-label="Appearance"
                role="tabpanel"
                id="settings-panel-appearance"
                aria-labelledby="settings-tab-appearance"
                hidden={settingsSection !== "appearance"}
              >
                <h3>Appearance</h3>
                <p className="muted">
                  One theme across the interface and 3D viewport. Remembered on
                  this device.
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
                  Current appearance: {resolvedTheme}. System follows your
                  operating system.
                </p>
              </section>
              <AgentConnection
                api={workspaceApi}
                hidden={settingsSection !== "agents"}
              />
              <section
                className="settings-section"
                aria-label="Scan import"
                role="tabpanel"
                id="settings-panel-import"
                aria-labelledby="settings-tab-import"
                hidden={settingsSection !== "import"}
              >
                <h3>Scan import</h3>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={previewImport}
                    onChange={(event) => setPreviewImport(event.target.checked)}
                  />{" "}
                  Memory efficient binary STL preview
                </label>
                <p className="muted">
                  Reads and validates every source triangle while displaying up
                  to 250,000 uniformly sampled triangles. Editing, measurements
                  and exports use the sample. Turn this off to import full
                  resolution. No file-size limit is imposed.
                </p>
              </section>
              <section
                className="settings-section"
                aria-label="SpaceMouse"
                role="tabpanel"
                id="settings-panel-spacemouse"
                aria-labelledby="settings-tab-spacemouse"
                hidden={settingsSection !== "spacemouse"}
              >
                <h3>SpaceMouse</h3>
                <p className="settings-device-status">{spaceMouseStatus}</p>
                <p className="muted">
                  Move the cap to enable automatic detection. The optional
                  official connection requires the installed 3DxWare driver.
                </p>
                <div className="settings-actions">
                  <button
                    disabled={spaceMouseConnecting}
                    onClick={() => void connectSpaceMouse()}
                  >
                    Connect via 3Dconnexion
                  </button>
                  <button
                    onClick={() =>
                      void controlSpaceMouse({ action: "automatic" }).catch(
                        (error) => setError(errorText(error)),
                      )
                    }
                  >
                    Use automatic detection
                  </button>
                  <button
                    onClick={() =>
                      void controlSpaceMouse({ action: "disconnect" }).catch(
                        (error) => setError(errorText(error)),
                      )
                    }
                  >
                    Disable navigation
                  </button>
                </div>
                <details className="settings-hid">
                  <summary>Browser HID connection</summary>
                  <button
                    disabled={
                      spaceMouseConnecting ||
                      !(navigator as Navigator & { hid?: HidAccess }).hid
                    }
                    onClick={() => {
                      try {
                        spaceMouseDriver.current?.close();
                        spaceMouse.current?.setDriverActive(false);
                        void spaceMouse.current
                          ?.connect()
                          .catch((error) => setError(errorText(error)));
                      } catch (error) {
                        setError(errorText(error));
                      }
                    }}
                  >
                    Connect via browser HID
                  </button>
                </details>
                {spaceMouse.current?.source === "driver" && (
                  <p className="muted">
                    Adjust driver navigation sensitivity in 3DxWare. These
                    controls apply to automatic and browser HID input.
                  </p>
                )}
                <fieldset
                  className="settings-navigation-fields"
                  aria-label="Navigation preferences"
                  disabled={spaceMouse.current?.source === "driver"}
                >
                  <Field
                    label="Translation sensitivity"
                    value={spaceMousePreferences.translationSpeed}
                    min={0}
                    max={20}
                    step={0.1}
                    onChange={(translationSpeed) =>
                      updateSpaceMousePreferences({
                        translationSpeed: Math.min(
                          20,
                          Math.max(0, translationSpeed),
                        ),
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
                        rotationSpeed: Math.min(20, Math.max(0, rotationSpeed)),
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
                </fieldset>
                <p className="settings-license">
                  3D input device development tools and related technology are
                  provided under license from 3Dconnexion. © 3Dconnexion 1992 -
                  2025. All rights reserved.
                </p>
              </section>
            </div>
          </section>
        </div>
      }
      {saveDialogOpen && (
        <SaveProjectDialog
          name={name}
          onSave={saveNamedProject}
          onCancel={() => setSaveDialogOpen(false)}
        />
      )}
      <StatusBar
        busy={busy}
        jobMessage={
          importProgress
            ? `Importing ${importProgress.name}${importProgress.fraction === null ? "…" : ` · ${Math.round(importProgress.fraction * 100)}%`}`
            : message
        }
        facets={
          selected && selected.kind !== "pointcloud"
            ? selected.positions.length / 9
            : undefined
        }
        points={
          selected?.kind === "pointcloud"
            ? selected.positions.length / 3
            : undefined
        }
        shortcuts={shortcutContext}
        operation={
          importProgress ? (
            <StatusMessage message={`Importing ${importProgress.name}`}>
              <ImportProgress
                name={importProgress.name}
                fraction={importProgress.fraction}
                onCancel={
                  importAbort.current
                    ? () => importAbort.current?.abort()
                    : undefined
                }
              />
            </StatusMessage>
          ) : (
            <OperationStatus
              message={message}
              fraction={
                message ===
                `${scanToolProgress} · ${Math.floor((scanToolFraction ?? 0) * 100)}%`
                  ? scanToolFraction
                  : undefined
              }
              busy={busy}
            />
          )
        }
        hint={
          <ActiveToolHint
            context={{
              hasSelection: !!selected,
              interactiveAlignment: interactiveOpen,
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
                !splitMeshOpen &&
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
                  : toolPanelOpen
                    ? workspaceTitle(workspace)
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
              <AppSelect
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
              </AppSelect>
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
