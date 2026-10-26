/* Dedicated CAD worker. All CAD bytes stay in this browser's virtual filesystem. */
let kernelPromise;
const shapes = new Map();
const alignmentMeshes = new Map();
let alignmentMeshBytes = 0;
function dropAlignmentMesh(id) {
  const cached = alignmentMeshes.get(id);
  if (cached) {
    alignmentMeshBytes -= cached.bytes;
    alignmentMeshes.delete(id);
  }
}
let nextShape = 0;
const sessionId = crypto.randomUUID();
let sequence = Promise.resolve();

function kernel() {
  if (!kernelPromise) {
    kernelPromise = Promise.resolve().then(() => {
      importScripts(new URL("kernel/opencascade.js", self.location.href).href);
      return opencascade({
        locateFile: (name) =>
          new URL(`kernel/${name}`, self.location.href).href,
        print: () => {},
        printErr: () => {},
      });
    });
  }
  return kernelPromise;
}

function cleanup(handles) {
  for (let i = handles.length - 1; i >= 0; i--) handles[i]?.delete?.();
}

let sketchBackendConstructors;
function loadSketchBackends() {
  if (!sketchBackendConstructors) {
    importScripts(new URL("kernel/sketch-backend.js", self.location.href).href);
    sketchBackendConstructors = ScanForgeSketchBackend;
  }
  return sketchBackendConstructors;
}

function createSketchArcBackend(oc) {
  return new (loadSketchBackends().SketchArcBackend)(oc);
}

function createSketchConicChild(kind, oc) {
  if (kind !== "arc" && kind !== "circle")
    throw new Error("Unsupported conic child kind.");
  const constructors = loadSketchBackends();
  const backend =
    kind === "arc"
      ? new constructors.SketchArcBackend(oc)
      : new SketchCircleBackend(oc);
  try {
    return new constructors.SketchConicChild(kind, backend);
  } catch (error) {
    backend.dispose();
    throw error;
  }
}

/**
 * Internal native-style circle backend, owned by a future sketch child session.
 * It retains a CAD edge and center-only backend records, not the child's four
 * defining/source records. It does not register scene shapes or add a worker
 * command. GUI/MCP publication still belongs to the shared authoring lifecycle.
 */
class SketchCircleBackend {
  #oc;
  #edge;
  #center;
  #radius;
  #disposed = false;

  constructor(oc) {
    this.#oc = oc;
  }

  #requireLive() {
    if (this.#disposed) throw new Error("Sketch circle backend is disposed.");
  }

  #reset() {
    const previous = this.#edge;
    this.#edge = undefined;
    this.#center = undefined;
    this.#radius = undefined;
    previous?.delete();
  }

  /** Borrowed within this worker only; invalidated by rebuild or disposal. */
  get edge() {
    this.#requireLive();
    return this.#edge;
  }

  snapshot() {
    return this.#edge
      ? {
          disposed: this.#disposed,
          kind: "circle",
          records: [[...this.#center]],
          radius: this.#radius,
        }
      : { disposed: this.#disposed, kind: "empty", records: [] };
  }

  rebuild(input) {
    this.#requireLive();
    if (
      !input ||
      input.kind !== "circle" ||
      !Array.isArray(input.center) ||
      input.center.length !== 3 ||
      !Number.isFinite(input.center[0]) ||
      !Number.isFinite(input.center[1]) ||
      !Number.isFinite(input.center[2]) ||
      !Number.isFinite(input.radius)
    )
      throw new Error(
        "Circle backend requires finite center and radius values.",
      );
    const center = [...input.center],
      radius = input.radius;
    // Canonical application validation precedes mutation. A finite failed-fit
    // sentinel is a valid request: native reset precedes radius rejection.
    this.#reset();
    if (radius < 2 ** -23) return false;
    const oc = this.#oc,
      handles = [];
    const keep = (handle) => (handles.push(handle), handle);
    let candidate;
    try {
      try {
        const origin = keep(new oc.gp_Pnt_3(...center));
        const normal = keep(new oc.gp_Dir_4(0, 0, 1));
        const xDirection = keep(new oc.gp_Dir_4(1, 0, 0));
        const placement = keep(new oc.gp_Ax2_2(origin, normal, xDirection));
        const circle = keep(new oc.gp_Circ_2(placement, radius));
        const maker = keep(new oc.GC_MakeCircle_1(circle));
        if (!maker.IsDone()) return false;
        const circleHandle = keep(maker.Value());
        if (circleHandle.IsNull()) return false;
        const curveHandle = keep(
          new oc.Handle_Geom_Curve_2(circleHandle.get()),
        );
        const edgeMaker = keep(new oc.BRepBuilderAPI_MakeEdge_24(curveHandle));
        if (!edgeMaker.IsDone()) return false;
        candidate = edgeMaker.Edge();
      } finally {
        cleanup(handles);
      }
      if (candidate.IsNull()) return false;
      this.#center = center;
      this.#radius = radius;
      this.#edge = candidate;
      candidate = undefined; // Ownership transfers only after temporary cleanup.
      return true;
    } finally {
      candidate?.delete();
    }
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#reset();
  }
}

function statusValue(status) {
  return status?.value ?? status;
}

// Verify the entire exact control net, then retain the surface's UV frame.
// BRepAdaptor applies the face location to both its spline copy and derivatives.
function splinePlaneFrame(oc, adaptor, reverse) {
  const handles = [];
  const own = (value) => (handles.push(value), value);
  try {
    const handle = own(adaptor.BSpline());
    const spline = handle.get(); // Borrowed from the owned handle.
    const u = (adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2;
    const v = (adaptor.FirstVParameter() + adaptor.LastVParameter()) / 2;
    if (!Number.isFinite(u) || !Number.isFinite(v)) return;
    const point = own(new oc.gp_Pnt_1()),
      du = own(new oc.gp_Vec_1()),
      dv = own(new oc.gp_Vec_1());
    try {
      adaptor.D1(u, v, point, du, dv);
    } catch {
      // A valid trimmed surface can lack derivatives at this parameter. Its
      // CAD import still succeeds, but it cannot publish this UV plane frame.
      return;
    }
    const center = [point.X(), point.Y(), point.Z()];
    const tangent = [du.X(), du.Y(), du.Z()];
    const normal = [
      du.Y() * dv.Z() - du.Z() * dv.Y(),
      du.Z() * dv.X() - du.X() * dv.Z(),
      du.X() * dv.Y() - du.Y() * dv.X(),
    ];
    const tangentLength = Math.hypot(...tangent),
      normalLength = Math.hypot(...normal);
    if (!(tangentLength > 0) || !(normalLength > 0)) return;
    for (let axis = 0; axis < 3; axis++) {
      tangent[axis] /= tangentLength;
      normal[axis] /= normalLength;
    }
    if (![...center, ...tangent, ...normal].every(Number.isFinite)) return;
    for (let i = 1; i <= spline.NbUPoles(); i++)
      for (let j = 1; j <= spline.NbVPoles(); j++) {
        const pole = spline.Pole(i, j);
        try {
          const distance =
            (pole.X() - center[0]) * normal[0] +
            (pole.Y() - center[1]) * normal[1] +
            (pole.Z() - center[2]) * normal[2];
          if (!Number.isFinite(distance) || Math.abs(distance) > 1e-7) return;
        } finally {
          pole.delete();
        }
      }
    return {
      center,
      tangent,
      normal: normal.map((value) => (reverse ? -value : value)),
    };
  } finally {
    cleanup(handles);
  }
}
function ensureDone(oc, status, action) {
  if (
    statusValue(status) !==
    statusValue(oc.IFSelect_ReturnStatus.IFSelect_RetDone)
  ) {
    throw new Error(
      `${action} failed: the CAD file or shape could not be transferred.`,
    );
  }
}

function mesh(oc, shape, onProgress = () => {}) {
  // Kernel bodies can share face data. Retessellation may replace those shared
  // triangulations, so prepared alignment records must be acquired again.
  alignmentMeshes.clear();
  alignmentMeshBytes = 0;
  const handles = [];
  const keep = (handle) => {
    handles.push(handle);
    return handle;
  };
  try {
    // Display tessellation is disposable; exact curves/surfaces remain in the BRep.
    const bounds = keep(new oc.Bnd_Box_1());
    oc.BRepBndLib.Add(shape, bounds, false);
    const minimum = keep(bounds.CornerMin()),
      maximum = keep(bounds.CornerMax());
    const diagonal = Math.hypot(
      maximum.X() - minimum.X(),
      maximum.Y() - minimum.Y(),
      maximum.Z() - minimum.Z(),
    );
    const deflection = Math.max(0.0001, Math.min(0.025, diagonal * 0.00025));
    oc.BRepTools.Clean(shape);
    keep(
      new oc.BRepMesh_IncrementalMesh_2(shape, deflection, false, 0.1, false),
    );
    const explorer = keep(
      new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    const positions = [],
      normals = [];
    let faceCount = 0,
      completedFaces = 0;
    let planeFrame;
    for (; explorer.More(); explorer.Next()) faceCount++;
    explorer.ReInit();
    for (; explorer.More(); explorer.Next()) {
      const faceHandles = [];
      const local = (handle) => {
        faceHandles.push(handle);
        return handle;
      };
      try {
        const current = local(explorer.Current());
        const face = local(oc.TopoDS.Face_1(current));
        const location = local(new oc.TopLoc_Location_1());
        const triangulationHandle = local(
          oc.BRep_Tool.Triangulation(face, location),
        );
        if (triangulationHandle.IsNull())
          throw new Error("A CAD face could not be tessellated.");
        // get() returns a borrowed native object; its owner is triangulationHandle.
        const triangulation = triangulationHandle.get();
        const transform = local(location.Transformation());
        const reverse =
          statusValue(face.Orientation_1()) ===
          statusValue(oc.TopAbs_Orientation.TopAbs_REVERSED);
        if (faceCount === 1) {
          const adaptor = local(new oc.BRepAdaptor_Surface_2(face, true));
          if (
            statusValue(adaptor.GetType()) ===
            statusValue(oc.GeomAbs_SurfaceType.GeomAbs_Plane)
          ) {
            // The adaptor includes the face's location; these are world coordinates.
            const plane = local(adaptor.Plane()),
              axes = local(plane.Position());
            const center = local(axes.Location()),
              normal = local(axes.Direction()),
              tangent = local(axes.XDirection());
            planeFrame = {
              center: [center.X(), center.Y(), center.Z()],
              normal: [normal.X(), normal.Y(), normal.Z()].map((v) =>
                reverse ? -v : v,
              ),
              tangent: [tangent.X(), tangent.Y(), tangent.Z()],
            };
          } else {
            const type = statusValue(adaptor.GetType());
            if (
              type ===
              statusValue(oc.GeomAbs_SurfaceType.GeomAbs_BSplineSurface)
            )
              planeFrame = splinePlaneFrame(oc, adaptor, reverse);
          }
        }
        const surfaceHandle = local(oc.BRep_Tool.Surface_2(face));
        const properties = local(
          new oc.GeomLProp_SLProps_1(surfaceHandle, 0, 0, 2, 1e-9),
        );
        const nodeNormals = new Map();
        function normalAt(index) {
          if (nodeNormals.has(index)) return nodeNormals.get(index);
          let normal = [0, 0, 0];
          if (triangulation.HasUVNodes()) {
            const uv = triangulation.UVNode(index);
            try {
              // Exact surface properties handle singular UV points using higher derivatives.
              properties.SetParameters(uv.X(), uv.Y());
              if (properties.IsNormalDefined()) {
                const direction = properties.Normal();
                try {
                  normal = [direction.X(), direction.Y(), direction.Z()].map(
                    (value) => (reverse ? -value : value),
                  );
                } finally {
                  direction.delete();
                }
              }
            } finally {
              uv.delete();
            }
          }
          nodeNormals.set(index, normal);
          return normal;
        }
        const triangles = local(triangulation.Triangles());
        for (let i = 1; i <= triangulation.NbTriangles(); i++) {
          const triangle = triangles.Value(i);
          try {
            const indices = reverse
              ? [triangle.Value(1), triangle.Value(3), triangle.Value(2)]
              : [triangle.Value(1), triangle.Value(2), triangle.Value(3)];
            for (const index of indices) {
              const point = triangulation.Node(index);
              try {
                const world = point.Transformed(transform);
                try {
                  const coordinates = [world.X(), world.Y(), world.Z()];
                  if (
                    !coordinates.every(
                      (value) =>
                        Number.isFinite(value) && Math.abs(value) <= 1e9,
                    )
                  )
                    throw new Error(
                      "CAD coordinates must be finite and within one billion millimetres of the origin.",
                    );
                  positions.push(...coordinates);
                  normals.push(...normalAt(index));
                } finally {
                  world.delete();
                }
              } finally {
                point.delete();
              }
            }
          } finally {
            triangle.delete();
          }
        }
      } finally {
        cleanup(faceHandles);
      }
      onProgress(0.55 + 0.3 * (++completedFaces / faceCount));
    }
    if (!positions.length)
      throw new Error("CAD file contains no renderable faces.");
    // Singular UV nodes (e.g. sphere poles) fall back to their incident facet normal.
    for (let i = 0; i < positions.length; i += 9) {
      const a = positions.slice(i, i + 3),
        b = positions.slice(i + 3, i + 6),
        c = positions.slice(i + 6, i + 9);
      const u = b.map((v, j) => v - a[j]),
        v = c.map((n, j) => n - a[j]);
      const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const length = Math.hypot(...n);
      for (let j = 0; j < 9; j += 3)
        if (Math.hypot(...normals.slice(i + j, i + j + 3)) < 0.5)
          normals.splice(
            i + j,
            3,
            ...n.map((value) => (length ? value / length : 0)),
          );
    }
    const edgePositions = cadEdgePositions(oc, shape, deflection);
    onProgress(0.9);
    return { positions, normals, edgePositions, planeFrame };
  } finally {
    cleanup(handles);
  }
}

/** Sample each unique BRep edge, including curved and smooth face boundaries. */
function cadEdgePositions(oc, shape, deflection) {
  const handles = [],
    edges = new Map(),
    positions = [];
  const keep = (handle) => {
    handles.push(handle);
    return handle;
  };
  try {
    const explorer = keep(
      new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    for (; explorer.More(); explorer.Next()) {
      const current = explorer.Current();
      let edge;
      try {
        edge = oc.TopoDS.Edge_1(current);
      } finally {
        current.delete();
      }
      const key = edge.HashCode(2147483647);
      const bucket = edges.get(key) ?? [];
      if (bucket.some((previous) => previous.IsSame(edge))) {
        edge.delete();
        continue;
      }
      bucket.push(keep(edge));
      edges.set(key, bucket);
      if (oc.BRep_Tool.Degenerated(edge)) continue;
      const local = [];
      try {
        const curve = new oc.BRepAdaptor_Curve_2(edge);
        local.push(curve);
        const samples = new oc.GCPnts_QuasiUniformDeflection_2(
          curve,
          deflection,
          oc.GeomAbs_Shape.GeomAbs_C0,
        );
        local.push(samples);
        if (!samples.IsDone() || samples.NbPoints() < 2)
          throw new Error("A CAD edge could not be sampled.");
        let previous;
        for (let i = 1; i <= samples.NbPoints(); i++) {
          const point = samples.Value(i);
          let coordinates;
          try {
            coordinates = [point.X(), point.Y(), point.Z()];
          } finally {
            point.delete();
          }
          if (
            !coordinates.every(
              (value) => Number.isFinite(value) && Math.abs(value) <= 1e9,
            )
          )
            throw new Error(
              "CAD edge coordinates are outside the supported range.",
            );
          if (previous) positions.push(...previous, ...coordinates);
          previous = coordinates;
        }
      } finally {
        cleanup(local);
      }
    }
    return positions;
  } finally {
    cleanup(handles);
  }
}

function register(oc, shape, onProgress = () => {}) {
  try {
    if (shape.IsNull())
      throw new Error("CAD operation returned an empty shape.");
    const { positions, normals, edgePositions, planeFrame } = mesh(
      oc,
      shape,
      onProgress,
    );
    const kernelId = `cad-${sessionId}-${++nextShape}`;
    const brep = serializeBrep(oc, shape);
    onProgress(0.98);
    shapes.set(kernelId, shape);
    return { kernelId, positions, normals, edgePositions, brep, planeFrame };
  } catch (error) {
    shape.delete();
    throw error;
  }
}

function serializeBrep(oc, shape) {
  // The pinned 1.1.1 CString binding only reliably handles short filenames.
  // Fixed short virtual paths are safe because worker operations are serialized.
  const path = "s.brep";
  const progress = new oc.Handle_Message_ProgressIndicator_1();
  try {
    if (!oc.BRepTools.Write_2(shape, path, progress))
      throw new Error("CAD shape serialization failed.");
    return new TextDecoder().decode(oc.FS.readFile(path));
  } finally {
    progress.delete();
    if (oc.FS.analyzePath(path).exists) oc.FS.unlink(path);
  }
}

function importFile(oc, payload, onProgress = () => {}) {
  const { data, extension } = payload;
  if (!["step", "stp", "iges", "igs", "brep"].includes(extension))
    throw new Error("Unsupported CAD format.");
  if (!(data instanceof Uint8Array) || !data.length)
    throw new Error("CAD files must contain data.");
  const path = `in.${extension}`;
  const handles = [];
  const keep = (handle) => {
    handles.push(handle);
    return handle;
  };
  try {
    oc.FS.writeFile(path, data);
    onProgress(0.15);
    let shape;
    if (extension === "brep") {
      shape = new oc.TopoDS_Shape();
      const builder = keep(new oc.BRep_Builder());
      const progress = keep(new oc.Handle_Message_ProgressIndicator_1());
      try {
        if (!oc.BRepTools.Read_2(shape, path, builder, progress))
          throw new Error("BREP import failed.");
      } catch (error) {
        shape.delete();
        throw error;
      }
    } else {
      const reader = keep(
        extension === "step" || extension === "stp"
          ? new oc.STEPControl_Reader_1()
          : new oc.IGESControl_Reader_1(),
      );
      ensureDone(oc, reader.ReadFile(path), "CAD import");
      onProgress(0.35);
      if (!reader.TransferRoots())
        throw new Error("CAD import contains no transferable roots.");
      shape = reader.OneShape();
    }
    onProgress(0.55);
    return register(oc, shape, onProgress);
  } finally {
    cleanup(handles);
    if (oc.FS.analyzePath(path).exists) oc.FS.unlink(path);
  }
}

function primitive(oc, input) {
  const handles = [];
  const keep = (handle) => {
    handles.push(handle);
    return handle;
  };
  const finiteVector = (value) =>
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (component) => Number.isFinite(component) && Math.abs(component) <= 1e9,
    );
  const positive = (value) =>
    Number.isFinite(value) && value > 0 && value <= 1e9;
  if (!finiteVector(input.center))
    throw new Error("Primitive center must contain three finite coordinates.");
  try {
    let maker;
    if (input.kind === "box") {
      if (!finiteVector(input.size) || !input.size.every(positive))
        throw new Error("Box dimensions must be positive.");
      const origin = keep(
        new oc.gp_Pnt_3(
          ...input.center.map((value, i) => value - input.size[i] / 2),
        ),
      );
      maker = keep(new oc.BRepPrimAPI_MakeBox_2(origin, ...input.size));
    } else if (input.kind === "sphere") {
      if (!positive(input.radius))
        throw new Error("Sphere radius must be positive.");
      const center = keep(new oc.gp_Pnt_3(...input.center));
      maker = keep(new oc.BRepPrimAPI_MakeSphere_5(center, input.radius));
    } else if (input.kind === "cylinder" || input.kind === "cone") {
      if (
        !finiteVector(input.axis) ||
        !positive(Math.hypot(...input.axis)) ||
        !positive(input.radius) ||
        !positive(input.height) ||
        (input.kind === "cone" &&
          (!Number.isFinite(input.topRadius) ||
            input.topRadius < 0 ||
            input.topRadius > 1e9))
      )
        throw new Error(
          `${input.kind === "cone" ? "Cone" : "Cylinder"} axis, radii, and height must be valid.`,
        );
      const length = Math.hypot(...input.axis);
      const direction = input.axis.map((value) => value / length);
      const origin = keep(
        new oc.gp_Pnt_3(
          ...input.center.map(
            (value, i) => value - (direction[i] * input.height) / 2,
          ),
        ),
      );
      const axisDirection = keep(new oc.gp_Dir_4(...direction));
      const axis = keep(new oc.gp_Ax2_3(origin, axisDirection));
      maker = keep(
        input.kind === "cone" && input.radius !== input.topRadius
          ? new oc.BRepPrimAPI_MakeCone_3(
              axis,
              input.radius,
              input.topRadius,
              input.height,
            )
          : new oc.BRepPrimAPI_MakeCylinder_3(axis, input.radius, input.height),
      );
    } else throw new Error("Unsupported CAD primitive.");
    return register(oc, maker.Shape());
  } finally {
    cleanup(handles);
  }
}

function exportStep(oc, ids) {
  if (!Array.isArray(ids) || !ids.length)
    throw new Error("Select at least one CAD shape to export.");
  const selected = ids.map((id) => {
    const shape = shapes.get(id);
    if (!shape)
      throw new Error(
        "A selected CAD handle has expired. Reimport or recreate the shape.",
      );
    return shape;
  });
  const path = "out.step";
  const writer = new oc.STEPControl_Writer_1();
  try {
    for (const shape of selected)
      ensureDone(
        oc,
        writer.Transfer(
          shape,
          oc.STEPControl_StepModelType.STEPControl_AsIs,
          true,
        ),
        "STEP transfer",
      );
    ensureDone(oc, writer.Write(path), "STEP export");
    return oc.FS.readFile(path).slice();
  } finally {
    writer.delete();
    if (oc.FS.analyzePath(path).exists) oc.FS.unlink(path);
  }
}

function getShape(id) {
  const shape = shapes.get(id);
  if (!shape)
    throw new Error("CAD handle has expired. Reimport or recreate the shape.");
  return shape;
}

const REFERENCE_TOPOLOGY_VISIT_LIMIT = 100000;
const REFERENCE_SCREEN_TRIANGLE_LIMIT = 2000000;
const REFERENCE_SCREEN_NODE_LIMIT = 6000000;

function referenceMeshAdmission(nodes, triangles) {
  if (
    nodes > REFERENCE_SCREEN_NODE_LIMIT ||
    triangles > REFERENCE_SCREEN_TRIANGLE_LIMIT
  )
    throw new Error(
      "CAD reference screen conversion exceeds 6000000 nodes or 2000000 triangles. Select a simpler source or split the source.",
    );
}

/** First-encounter IsSame topology identity, shared with edge treatment. */
function uniqueReferenceTopology(oc, shape, family, handles, bounded = true) {
  const type =
    family === "vertices"
      ? oc.TopAbs_ShapeEnum.TopAbs_VERTEX
      : oc.TopAbs_ShapeEnum.TopAbs_EDGE;
  const explorer = new oc.TopExp_Explorer_2(
    shape,
    type,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  handles.push(explorer);
  const result = [],
    buckets = new Map();
  let visits = 0,
    comparisons = 0;
  for (; explorer.More(); explorer.Next()) {
    if (bounded && ++visits > REFERENCE_TOPOLOGY_VISIT_LIMIT)
      throw new Error(
        "CAD reference topology exceeds 100000 visits. Select a simpler source.",
      );
    const current = explorer.Current();
    let item;
    try {
      item =
        family === "vertices"
          ? oc.TopoDS.Vertex_1(current)
          : oc.TopoDS.Edge_1(current);
      const hash =
        typeof item.HashCode === "function" ? item.HashCode(2147483647) : 0;
      const bucket = buckets.get(hash) ?? [];
      let duplicate = false;
      for (const previous of bucket) {
        if (bounded && ++comparisons > REFERENCE_TOPOLOGY_VISIT_LIMIT)
          throw new Error(
            "CAD reference topology identity work exceeds 100000 comparisons. Select a simpler source.",
          );
        if (previous.IsSame(item)) {
          duplicate = true;
          break;
        }
      }
      if (duplicate) item.delete();
      else {
        result.push(item);
        handles.push(item);
        bucket.push(item);
        buckets.set(hash, bucket);
      }
      item = undefined;
    } finally {
      item?.delete();
      current.delete();
    }
  }
  return result;
}

function referencePointCoordinates(point) {
  const position = [point.X(), point.Y(), point.Z()];
  if (
    !position.every((value) => Number.isFinite(value) && Math.abs(value) <= 1e9)
  )
    throw new Error(
      "CAD reference coordinate exceeds finite world bounds (+/-1e9 mm).",
    );
  return position;
}

function referenceEdgeInfo(oc, edge, handles) {
  const degenerate = oc.BRep_Tool.Degenerated(edge);
  if (degenerate)
    return {
      degenerate: true,
      eligible: false,
      reason: "Degenerate CAD edge has no available curve location.",
    };
  const curve = new oc.BRepAdaptor_Curve_2(edge);
  handles.push(curve);
  const firstParameter = curve.FirstParameter(),
    lastParameter = curve.LastParameter();
  if (!Number.isFinite(firstParameter) || !Number.isFinite(lastParameter))
    return {
      degenerate: false,
      eligible: false,
      reason: "CAD edge parameter range is not finite.",
    };
  return {
    degenerate: false,
    eligible: true,
    firstParameter,
    lastParameter,
    curve,
  };
}

/** Bounded read query: no source mutation, remeshing or shape registration. */
function referenceFeatures(oc, input) {
  if (!["vertices", "edges", "faces"].includes(input.family))
    throw new Error(
      "CAD reference feature family must be vertices, edges or faces.",
    );
  const offset = input.offset ?? 0,
    limit = input.limit ?? 50;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error(
      "CAD reference paging requires nonnegative offset and limit1..100.",
    );
  const shape = getShape(input.kernelId),
    handles = [];
  try {
    if (input.family === "faces") {
      const all = alignmentReferences(oc, input);
      const rows = all
        .slice(offset, offset + limit)
        .map((value) => ({
          ...value,
          index: value.faceIndex,
          eligible: value.triangleCount > 0,
        }));
      return {
        total: all.length,
        nextOffset:
          offset + rows.length < all.length ? offset + rows.length : null,
        rows,
      };
    }
    const all = uniqueReferenceTopology(oc, shape, input.family, handles);
    const rows = [];
    for (
      let index = offset;
      index < Math.min(all.length, offset + limit);
      index++
    ) {
      const local = [];
      try {
        if (input.family === "vertices") {
          // BRep_Tool.Pnt already applies the vertex Location exactly once.
          const point = oc.BRep_Tool.Pnt(all[index]);
          local.push(point);
          rows.push({
            index,
            position: referencePointCoordinates(point),
            eligible: true,
          });
        } else {
          const { curve: _curve, ...info } = referenceEdgeInfo(
            oc,
            all[index],
            local,
          );
          rows.push({ index, ...info });
        }
      } catch (error) {
        rows.push({
          index,
          eligible: false,
          ...(input.family === "edges" ? { degenerate: false } : {}),
          reason:
            error instanceof Error
              ? error.message
              : "CAD feature location is unavailable.",
        });
      } finally {
        cleanup(local);
      }
    }
    return {
      total: all.length,
      nextOffset:
        offset + rows.length < all.length ? offset + rows.length : null,
      rows,
    };
  } finally {
    cleanup(handles);
  }
}

function referenceCoordinate(oc, input) {
  const selection = input.selection;
  if (!selection || typeof selection !== "object" || Array.isArray(selection))
    throw new Error("CAD coordinate selection is invalid.");
  const fields =
    selection.kind === "vertex"
      ? ["kind", "vertexIndex"]
      : selection.kind === "edge-endpoint"
        ? ["kind", "edgeIndex", "endpoint"]
        : selection.kind === "edge-fraction"
          ? ["kind", "edgeIndex", "fraction"]
          : [];
  if (
    !fields.length ||
    Object.keys(selection).length !== fields.length ||
    Object.keys(selection).some((key) => !fields.includes(key))
  )
    throw new Error("CAD coordinate selection contains invalid fields.");
  const vertex = selection.kind === "vertex",
    index = vertex ? selection.vertexIndex : selection.edgeIndex;
  if (!Number.isSafeInteger(index) || index < 0)
    throw new Error(
      "CAD reference feature index must be a nonnegative safe integer.",
    );
  if (
    selection.kind === "edge-endpoint" &&
    !["start", "end"].includes(selection.endpoint)
  )
    throw new Error("CAD edge endpoint must be start or end.");
  if (
    selection.kind === "edge-fraction" &&
    (!Number.isFinite(selection.fraction) ||
      selection.fraction < 0 ||
      selection.fraction > 1)
  )
    throw new Error("CAD edge fraction must be within [0,1].");
  const shape = getShape(input.kernelId),
    handles = [];
  try {
    const all = uniqueReferenceTopology(
      oc,
      shape,
      vertex ? "vertices" : "edges",
      handles,
    );
    if (index >= all.length)
      throw new Error(
        "CAD reference feature index is outside the available range.",
      );
    if (vertex) {
      const point = oc.BRep_Tool.Pnt(all[index]);
      handles.push(point);
      return { position: referencePointCoordinates(point) };
    }
    const info = referenceEdgeInfo(oc, all[index], handles);
    if (!info.eligible) throw new Error(info.reason);
    const fraction =
      selection.kind === "edge-endpoint"
        ? selection.endpoint === "start"
          ? 0
          : 1
        : selection.fraction;
    const parameter =
      fraction === 0
        ? info.firstParameter
        : fraction === 1
          ? info.lastParameter
          : info.firstParameter +
            (info.lastParameter - info.firstParameter) * fraction;
    if (!Number.isFinite(parameter))
      throw new Error("CAD edge parameter is not finite.");
    // BRepAdaptor_Curve.Value includes the edge's location; do not apply it again.
    const point = info.curve.Value(parameter);
    handles.push(point);
    return { position: referencePointCoordinates(point) };
  } finally {
    cleanup(handles);
  }
}

/** Native per-face conversion of existing kernel triangulations. Never cleans
 * or remeshes the exact body: acquisition reuses its current triangulations.
 */
function alignmentMesh(oc, input) {
  const shape = getShape(input.kernelId),
    handles = [];
  const referenceAcquisition = input.referenceAcquisition === true;
  if (input.referenceAcquisition !== undefined && !referenceAcquisition)
    throw new Error("Invalid CAD reference acquisition limit policy.");
  const cached = alignmentMeshes.get(input.kernelId);
  if (cached) {
    if (referenceAcquisition)
      referenceMeshAdmission(
        cached.mesh.vertices.length / 3,
        cached.mesh.triangles.length / 3,
      );
    alignmentMeshes.delete(input.kernelId);
    alignmentMeshes.set(input.kernelId, cached);
    return cached.mesh;
  }
  const own = (value) => (handles.push(value), value);
  const vertices = [],
    normals = [],
    triangles = [],
    uvs = [];
  let faceVisits = 0;
  try {
    const explorer = own(
      new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    for (; explorer.More(); explorer.Next()) {
      if (referenceAcquisition && ++faceVisits > REFERENCE_TOPOLOGY_VISIT_LIMIT)
        throw new Error(
          "CAD reference screen conversion exceeds 100000 face visits. Select a simpler source.",
        );
      const faceHandles = [];
      const local = (value) => (faceHandles.push(value), value);
      try {
        const face = local(oc.TopoDS.Face_1(local(explorer.Current())));
        const location = local(new oc.TopLoc_Location_1());
        const handle = local(oc.BRep_Tool.Triangulation(face, location));
        if (handle.IsNull())
          throw new Error(
            "CAD alignment requires cached face triangulations. Recreate or reimport this body.",
          );
        const mesh = handle.get();
        if (referenceAcquisition)
          referenceMeshAdmission(
            vertices.length / 3 + mesh.NbNodes(),
            triangles.length / 3 + mesh.NbTriangles(),
          );
        if (!mesh.HasUVNodes())
          throw new Error("CAD alignment requires face UV coordinates.");
        if (
          vertices.length / 3 + mesh.NbNodes() > 10000000 ||
          triangles.length / 3 + mesh.NbTriangles() > 20000000
        )
          throw new Error("CAD alignment target exceeds the geometry limit.");
        const adaptor = local(new oc.BRepAdaptor_Surface_2(face, true));
        const point = local(new oc.gp_Pnt_1()),
          du = local(new oc.gp_Vec_1()),
          dv = local(new oc.gp_Vec_1());
        const reversed =
          statusValue(face.Orientation_1()) ===
          statusValue(oc.TopAbs_Orientation.TopAbs_REVERSED);
        const offset = vertices.length / 3;
        for (let index = 1; index <= mesh.NbNodes(); index++) {
          const uv = mesh.UVNode(index);
          try {
            const u = uv.X(),
              v = uv.Y();
            uvs.push(u, v, 0);
            adaptor.D1(u, v, point, du, dv);
            // The original converter overwrites the node position with D1's
            // analytic surface point before inserting its Float32 mesh vertex.
            const p = [point.X(), point.Y(), point.Z()];
            if (
              !p.every(
                (value) => Number.isFinite(value) && Math.abs(value) <= 1e9,
              )
            )
              throw new Error(
                "CAD alignment coordinates are outside the supported range.",
              );
            vertices.push(...p.map(Math.fround));
            const normal = [
              du.Y() * dv.Z() - du.Z() * dv.Y(),
              du.Z() * dv.X() - du.X() * dv.Z(),
              du.X() * dv.Y() - du.Y() * dv.X(),
            ];
            const length = Math.sqrt(
              normal[1] * normal[1] +
                normal[0] * normal[0] +
                normal[2] * normal[2],
            );
            const factor = length > 1e-10 ? 1 / length : 1;
            if (!normal.every(Number.isFinite))
              throw new Error("CAD face derivatives are not finite.");
            normals.push(
              ...normal.map((value) =>
                Math.fround((reversed ? -1 : 1) * (value * factor)),
              ),
            );
          } finally {
            uv.delete();
          }
        }
        const faces = local(mesh.Triangles());
        for (let index = 1; index <= mesh.NbTriangles(); index++) {
          const triangle = faces.Value(index);
          try {
            const ids = [
              triangle.Value(1),
              triangle.Value(reversed ? 3 : 2),
              triangle.Value(reversed ? 2 : 3),
            ];
            if (
              ids.some(
                (id) => !Number.isInteger(id) || id < 1 || id > mesh.NbNodes(),
              )
            )
              throw new Error("CAD face triangle references a missing vertex.");
            triangles.push(...ids.map((id) => offset + id - 1));
          } finally {
            triangle.delete();
          }
        }
      } finally {
        cleanup(faceHandles);
      }
    }
    if (!triangles.length)
      throw new Error("CAD alignment target has no triangles.");
    const result = {
      vertices: new Float32Array(vertices),
      triangles: new Uint32Array(triangles),
      normals: new Float32Array(normals),
      uvs: new Float64Array(uvs),
    };
    const bytes =
      result.vertices.byteLength +
      result.triangles.byteLength +
      result.normals.byteLength +
      result.uvs.byteLength;
    if (bytes <= 64 * 1024 * 1024) {
      while (
        alignmentMeshes.size >= 8 ||
        alignmentMeshBytes + bytes > 64 * 1024 * 1024
      )
        dropAlignmentMesh(alignmentMeshes.keys().next().value);
      alignmentMeshes.set(input.kernelId, { mesh: result, bytes });
      alignmentMeshBytes += bytes;
    }
    return result;
  } finally {
    cleanup(handles);
  }
}

/** Exact face parameters, with triangle slots matching the mesh traversal order. */
function alignmentReferences(oc, input) {
  const shape = getShape(input.kernelId),
    handles = [];
  const keep = (value) => (handles.push(value), value);
  const coordinates = (value) => [value.X(), value.Y(), value.Z()];
  const result = [];
  let firstTriangle = 0;
  try {
    const explorer = keep(
      new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    for (; explorer.More(); explorer.Next()) {
      if (result.length >= 10000)
        throw new Error(
          "Alignment reference inspection is limited to 10,000 CAD faces.",
        );
      const localHandles = [],
        own = (value) => (localHandles.push(value), value);
      try {
        const current = own(explorer.Current()),
          face = own(oc.TopoDS.Face_1(current));
        const location = own(new oc.TopLoc_Location_1());
        const triangulation = own(oc.BRep_Tool.Triangulation(face, location));
        if (triangulation.IsNull())
          throw new Error(
            "CAD face has no triangulation for reference picking.",
          );
        const triangleCount = triangulation.get().NbTriangles();
        const identity = {
          faceIndex: result.length,
          firstTriangle,
          triangleCount,
        };
        firstTriangle += triangleCount;
        const adaptor = own(new oc.BRepAdaptor_Surface_2(face, true));
        const type = statusValue(adaptor.GetType());
        if (type === statusValue(oc.GeomAbs_SurfaceType.GeomAbs_Plane)) {
          const u =
            (adaptor.FirstUParameter() + adaptor.LastUParameter()) * 0.5;
          const v =
            (adaptor.FirstVParameter() + adaptor.LastVParameter()) * 0.5;
          const point = own(new oc.gp_Pnt_1()),
            du = own(new oc.gp_Vec_1()),
            dv = own(new oc.gp_Vec_1());
          adaptor.D1(u, v, point, du, dv);
          result.push({
            ...identity,
            kind: "plane",
            evaluatedPoint: coordinates(point),
            derivativeU: coordinates(du),
            derivativeV: coordinates(dv),
          });
        } else if (
          [
            statusValue(oc.GeomAbs_SurfaceType.GeomAbs_Cylinder),
            statusValue(oc.GeomAbs_SurfaceType.GeomAbs_Cone),
            statusValue(oc.GeomAbs_SurfaceType.GeomAbs_Torus),
          ].includes(type)
        ) {
          const kind =
            type === statusValue(oc.GeomAbs_SurfaceType.GeomAbs_Cylinder)
              ? "cylinder"
              : type === statusValue(oc.GeomAbs_SurfaceType.GeomAbs_Cone)
                ? "cone"
                : "torus";
          const primitive = own(
            kind === "cylinder"
              ? adaptor.Cylinder()
              : kind === "cone"
                ? adaptor.Cone()
                : adaptor.Torus(),
          );
          const axes = own(primitive.Position()),
            center = own(axes.Location()),
            direction = own(axes.Direction());
          result.push({
            ...identity,
            kind,
            location: coordinates(center),
            axis: coordinates(direction),
            firstV: adaptor.FirstVParameter(),
            lastV: adaptor.LastVParameter(),
            radius:
              kind === "cylinder"
                ? primitive.Radius()
                : kind === "cone"
                  ? primitive.RefRadius()
                  : 0,
            semiAngle: kind === "cone" ? primitive.SemiAngle() : 0,
          });
        } else
          result.push({ ...identity, kind: "unsupported", surfaceType: type });
      } finally {
        cleanup(localHandles);
      }
    }
    return result;
  } finally {
    cleanup(handles);
  }
}

function booleanShape(oc, input) {
  const first = getShape(input.firstId),
    second = getShape(input.secondId);
  const constructors = {
    union: oc.BRepAlgoAPI_Fuse_3,
    subtract: oc.BRepAlgoAPI_Cut_3,
    intersect: oc.BRepAlgoAPI_Common_3,
  };
  if (!Object.hasOwn(constructors, input.operation))
    throw new Error("Unsupported CAD boolean operation.");
  const Constructor = constructors[input.operation];
  const maker = new Constructor(first, second);
  try {
    if (!maker.IsDone())
      throw new Error("CAD boolean operation could not build a result.");
    return register(oc, maker.Shape());
  } finally {
    maker.delete();
  }
}

function transformShape(oc, input) {
  const shape = getShape(input.kernelId);
  const { translation, rotation, scale } = input;
  const vector = (value) =>
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (component) => Number.isFinite(component) && Math.abs(component) <= 1e9,
    );
  if (
    !vector(translation) ||
    !vector(rotation) ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    scale > 1e9
  )
    throw new Error(
      "Transform requires finite vectors and a positive scale, with magnitudes at most one billion.",
    );
  const [sx, sy, sz] = rotation.map((degrees) =>
    Math.sin((degrees * Math.PI) / 180),
  );
  const [cx, cy, cz] = rotation.map((degrees) =>
    Math.cos((degrees * Math.PI) / 180),
  );
  const transform = new oc.gp_Trsf_1();
  let maker;
  try {
    // Uniform scale about the world origin, then X/Y/Z rotations, then translation.
    transform.SetValues(
      scale * cz * cy,
      scale * (cz * sy * sx - sz * cx),
      scale * (cz * sy * cx + sz * sx),
      translation[0],
      scale * sz * cy,
      scale * (sz * sy * sx + cz * cx),
      scale * (sz * sy * cx - cz * sx),
      translation[1],
      -scale * sy,
      scale * cy * sx,
      scale * cy * cx,
      translation[2],
    );
    maker = new oc.BRepBuilderAPI_Transform_2(shape, transform, true);
    if (!maker.IsDone())
      throw new Error("CAD transform could not build a result.");
    return register(oc, maker.Shape());
  } finally {
    maker?.delete();
    transform.delete();
  }
}

function finiteVector(vector) {
  return (
    Array.isArray(vector) &&
    vector.length === 3 &&
    vector.every((value) => Number.isFinite(value) && Math.abs(value) <= 1e9)
  );
}

function datumTransformShape(oc, input) {
  const shape = getShape(input.kernelId);
  if (
    !finiteVector(input.origin) ||
    !finiteVector(input.xDirection) ||
    !finiteVector(input.zDirection)
  )
    throw new Error("Exact CAD alignment requires finite frame vectors.");
  const handles = [];
  try {
    const point = new oc.gp_Pnt_3(...input.origin);
    handles.push(point);
    const x = new oc.gp_Dir_4(...input.xDirection);
    handles.push(x);
    const z = new oc.gp_Dir_4(...input.zDirection);
    handles.push(z);
    const axes = new oc.gp_Ax3_3(point, z, x);
    handles.push(axes);
    const transform = new oc.gp_Trsf_1();
    handles.push(transform);
    transform.SetTransformation_2(axes);
    const placementMatrix = [];
    for (let row = 1; row <= 3; row++)
      for (let col = 1; col <= 4; col++)
        placementMatrix.push(transform.Value(row, col));
    const maker = new oc.BRepBuilderAPI_Transform_2(shape, transform, false);
    handles.push(maker);
    if (!maker.IsDone())
      throw new Error("Exact CAD alignment failed to build a result.");
    return { ...register(oc, maker.Shape()), placementMatrix };
  } finally {
    cleanup(handles);
  }
}

function rigidCopy(oc, shape, matrix, translation) {
  const transform = new oc.gp_Trsf_1();
  let maker;
  try {
    transform.SetValues(
      matrix[0][0],
      matrix[0][1],
      matrix[0][2],
      translation[0],
      matrix[1][0],
      matrix[1][1],
      matrix[1][2],
      translation[1],
      matrix[2][0],
      matrix[2][1],
      matrix[2][2],
      translation[2],
    );
    maker = new oc.BRepBuilderAPI_Transform_2(shape, transform, true);
    if (!maker.IsDone()) throw new Error("Exact CAD copy transform failed.");
    return maker.Shape();
  } finally {
    maker?.delete();
    transform.delete();
  }
}

function patternShape(oc, input) {
  const source = getShape(input.kernelId);
  if (!Number.isInteger(input.count) || input.count < 2 || input.count > 256)
    throw new Error(
      "Pattern count must be an integer from 2 to 256, including the original.",
    );
  if (!["linear", "circular"].includes(input.kind))
    throw new Error("Unsupported pattern kind.");
  if (
    input.kind === "linear" &&
    (!finiteVector(input.step) || Math.hypot(...input.step) < 1e-8)
  )
    throw new Error("Linear pattern requires a finite nonzero spacing vector.");
  let axis;
  if (input.kind === "circular") {
    if (
      !finiteVector(input.center) ||
      !finiteVector(input.axis) ||
      Math.hypot(...input.axis) < 1e-8 ||
      !Number.isFinite(input.angleDegrees) ||
      Math.abs(input.angleDegrees) > 360 ||
      Math.abs(input.angleDegrees % 360) < 1e-8
    )
      throw new Error(
        "Circular pattern requires a finite center, nonzero axis and non-identity angle increment within 360 degrees.",
      );
    const length = Math.hypot(...input.axis);
    axis = input.axis.map((value) => value / length);
    for (let copy = 1; copy < input.count; copy++)
      if (Math.abs((copy * input.angleDegrees) % 360) < 1e-8)
        throw new Error(
          "Circular pattern count repeats an angular position; reduce count or change the increment.",
        );
  }
  const compound = new oc.TopoDS_Compound(),
    builder = new oc.BRep_Builder();
  let handedOff = false;
  try {
    builder.MakeCompound(compound);
    builder.Add(compound, source);
    for (let copy = 1; copy < input.count; copy++) {
      let matrix, translation;
      if (input.kind === "linear") {
        matrix = [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ];
        translation = input.step.map((value) => value * copy);
      } else {
        const angle = (input.angleDegrees * copy * Math.PI) / 180,
          c = Math.cos(angle),
          s = Math.sin(angle),
          n = axis;
        const cross = [
          [0, -n[2], n[1]],
          [n[2], 0, -n[0]],
          [-n[1], n[0], 0],
        ];
        matrix = Array.from({ length: 3 }, (_, row) =>
          Array.from(
            { length: 3 },
            (_, column) =>
              (row === column ? c : 0) +
              (1 - c) * n[row] * n[column] +
              s * cross[row][column],
          ),
        );
        translation = input.center.map(
          (value, row) =>
            value -
            matrix[row].reduce(
              (sum, r, column) => sum + r * input.center[column],
              0,
            ),
        );
      }
      const transformed = rigidCopy(oc, source, matrix, translation);
      try {
        builder.Add(compound, transformed);
      } finally {
        transformed.delete();
      }
    }
    handedOff = true;
    return register(oc, compound);
  } finally {
    builder.delete();
    if (!handedOff) compound.delete();
  }
}

function mirrorShape(oc, input) {
  const source = getShape(input.kernelId);
  if (
    !finiteVector(input.planeOrigin) ||
    !finiteVector(input.normal) ||
    Math.hypot(...input.normal) < 1e-8
  )
    throw new Error(
      "Mirror plane requires a finite origin and nonzero normal.",
    );
  const length = Math.hypot(...input.normal),
    n = input.normal.map((value) => value / length),
    distance = n.reduce(
      (sum, value, i) => sum + value * input.planeOrigin[i],
      0,
    );
  const matrix = Array.from({ length: 3 }, (_, row) =>
    Array.from(
      { length: 3 },
      (_, column) => (row === column ? 1 : 0) - 2 * n[row] * n[column],
    ),
  );
  return register(
    oc,
    rigidCopy(
      oc,
      source,
      matrix,
      n.map((value) => 2 * distance * value),
    ),
  );
}

function splitShape(oc, input) {
  const source = getShape(input.kernelId),
    cutter = getShape(input.cutterId);
  if (input.kernelId === input.cutterId)
    throw new Error("Split requires a separate intersecting cutting solid.");
  const handles = [],
    results = [];
  const hasSolid = (shape) => {
    const explorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_SOLID,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    try {
      return explorer.More();
    } finally {
      explorer.delete();
    }
  };
  if (!hasSolid(source) || !hasSolid(cutter))
    throw new Error("Split requires source and cutter solids.");
  try {
    const common = new oc.BRepAlgoAPI_Common_3(source, cutter);
    handles.push(common);
    const cut = new oc.BRepAlgoAPI_Cut_3(source, cutter);
    handles.push(cut);
    if (!common.IsDone() || !cut.IsDone())
      throw new Error("CAD split boolean construction failed.");
    const inside = common.Shape();
    handles.push(inside);
    const outside = cut.Shape();
    handles.push(outside);
    if (!hasSolid(inside) || !hasSolid(outside))
      throw new Error(
        "Cutter must intersect the source and leave nonempty inside and outside solids.",
      );
    for (const shape of [inside, outside]) {
      handles.splice(handles.indexOf(shape), 1);
      results.push(register(oc, shape));
    }
    return results;
  } catch (error) {
    for (const result of results) {
      shapes.get(result.kernelId)?.delete();
      dropAlignmentMesh(result.kernelId);
      shapes.delete(result.kernelId);
    }
    throw error;
  } finally {
    cleanup(handles);
  }
}

function polygonPoints(inputPoints) {
  let points = inputPoints;
  if (
    !Array.isArray(points) ||
    points.length < 3 ||
    points.length > 256 ||
    !points.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every(
          (value) => Number.isFinite(value) && Math.abs(value) <= 1e9,
        ),
    )
  )
    throw new Error(
      "Profile requires 3 to 256 finite polygon vertices with magnitudes at most one billion.",
    );
  points = points.map((point) => [...point]);
  if (
    points.length > 3 &&
    points[0].every((value, i) => value === points[points.length - 1][i])
  )
    points.pop();
  const span = Math.max(1, ...points.flat().map(Math.abs));
  const tolerance = span * 1e-10;
  const cross = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance)
      throw new Error("Polygon contains a zero-length edge.");
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      const side1 = cross(a, b, c),
        side2 = cross(a, b, d),
        side3 = cross(c, d, a),
        side4 = cross(c, d, b);
      const overlaps =
        Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <=
          Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) + tolerance &&
        Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <=
          Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) + tolerance;
      if (
        overlaps &&
        side1 * side2 <= tolerance * tolerance &&
        side3 * side4 <= tolerance * tolerance
      )
        throw new Error(
          "Polygon edges intersect or touch. Use a simple closed polygon.",
        );
    }
  }
  if (Math.abs(area) <= tolerance * tolerance)
    throw new Error("Polygon area is zero.");
  if (area < 0) points.reverse();
  return points;
}

function sketchPlacement(input) {
  const frame =
    input === undefined
      ? {
          origin: [0, 0, 0],
          u: [1, 0, 0],
          v: [0, 1, 0],
          normal: [0, 0, 1],
        }
      : input;
  if (!frame || typeof frame !== "object")
    throw new Error("Sketch frame must be an object.");
  for (const key of ["origin", "u", "v", "normal"]) {
    const vector = frame[key];
    if (
      !Array.isArray(vector) ||
      vector.length !== 3 ||
      vector.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e9)
    )
      throw new Error(
        "Sketch frame vectors must contain three finite coordinates.",
      );
  }
  const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
  const { u, v, normal } = frame;
  const cross = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  if (
    [u, v, normal].some((axis) => Math.abs(dot(axis, axis) - 1) > 1e-8) ||
    Math.abs(dot(u, v)) > 1e-8 ||
    Math.abs(dot(u, normal)) > 1e-8 ||
    Math.abs(dot(v, normal)) > 1e-8 ||
    cross.some((n, i) => Math.abs(n - normal[i]) > 1e-8)
  )
    throw new Error("Sketch frame must be orthonormal and right-handed.");
  return frame;
}

function extrudeShape(oc, input) {
  const { height } = input;
  const points = polygonPoints(input.points);
  const frame = sketchPlacement(input.frame);
  if (!Number.isFinite(height) || height <= 0 || height > 1e9)
    throw new Error(
      "Extrusion height must be positive and at most one billion.",
    );
  const handles = [];
  const keep = (handle) => {
    handles.push(handle);
    return handle;
  };
  try {
    const polygon = keep(new oc.BRepBuilderAPI_MakePolygon_1());
    for (const point of points) {
      const world = frame.origin.map(
        (n, i) => n + frame.u[i] * point[0] + frame.v[i] * point[1],
      );
      if (world.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e9))
        throw new Error(
          "Placed sketch coordinates must be finite and bounded.",
        );
      const nativePoint = new oc.gp_Pnt_3(...world);
      try {
        polygon.Add_1(nativePoint);
      } finally {
        nativePoint.delete();
      }
    }
    polygon.Close();
    if (!polygon.IsDone()) throw new Error("CAD polygon construction failed.");
    const wire = keep(polygon.Wire());
    const faceMaker = keep(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
    if (!faceMaker.IsDone())
      throw new Error("CAD polygon face construction failed.");
    const face = keep(faceMaker.Face());
    const direction = keep(
      new oc.gp_Vec_4(...frame.normal.map((n) => n * height)),
    );
    const prism = keep(
      new oc.BRepPrimAPI_MakePrism_1(face, direction, true, true),
    );
    if (!prism.IsDone()) throw new Error("CAD extrusion construction failed.");
    return register(oc, prism.Shape());
  } finally {
    cleanup(handles);
  }
}

// Analytic profiles have their own operation so saved polygon recipes retain their geometry.
function extrudeCurvesShape(oc, input) {
  const { edges, height } = input;
  const frame = sketchPlacement(input.frame);
  if (!Number.isFinite(height) || height <= 0 || height > 1e9)
    throw new Error(
      "Extrusion height must be positive and at most one billion.",
    );
  if (!Array.isArray(edges) || edges.length < 2 || edges.length > 10000)
    throw new Error("Choose a closed profile with 2 to 10000 edges.");
  const point = (p) =>
    Array.isArray(p) &&
    p.length === 2 &&
    p.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const sweeps = [];
  let area = 0;
  const anchor = edges[0]?.start;
  if (!point(anchor)) throw new Error("Invalid sketch profile coordinates.");
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i],
      next = edges[(i + 1) % edges.length];
    if (
      !edge ||
      !point(edge.start) ||
      !point(edge.end) ||
      !point(next?.start) ||
      distance(edge.start, edge.end) < 1e-8 ||
      distance(edge.end, next.start) > 1e-8
    )
      throw new Error(
        "Sketch profile must form a closed cycle without zero-length edges.",
      );
    const a = edge.start.map((n, j) => n - anchor[j]),
      b = edge.end.map((n, j) => n - anchor[j]);
    if (edge.kind === "line") {
      area += a[0] * b[1] - a[1] * b[0];
      sweeps.push(0);
    } else if (
      edge.kind === "arc" &&
      point(edge.center) &&
      typeof edge.clockwise === "boolean"
    ) {
      const r = distance(edge.start, edge.center),
        endRadius = distance(edge.end, edge.center);
      if (r < 1e-8 || Math.abs(r - endRadius) > Math.max(1e-5, r * 1e-6))
        throw new Error("Sketch arc radii are inconsistent.");
      let sweep =
        Math.atan2(edge.end[1] - edge.center[1], edge.end[0] - edge.center[0]) -
        Math.atan2(
          edge.start[1] - edge.center[1],
          edge.start[0] - edge.center[0],
        );
      if (edge.clockwise) {
        if (sweep >= 0) sweep -= 2 * Math.PI;
      } else if (sweep <= 0) sweep += 2 * Math.PI;
      const c = edge.center.map((n, j) => n - anchor[j]);
      area += c[0] * (b[1] - a[1]) - c[1] * (b[0] - a[0]) + r * r * sweep;
      sweeps.push(sweep);
    } else throw new Error("Unknown sketch profile edge.");
  }
  if (!Number.isFinite(area) || Math.abs(area) < 1e-8)
    throw new Error("Sketch profile has zero area.");
  const handles = [];
  const keep = (h) => (handles.push(h), h);
  const placed = (uv) => {
    const world = frame.origin.map(
      (n, i) => n + frame.u[i] * uv[0] + frame.v[i] * uv[1],
    );
    if (world.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e9))
      throw new Error("Placed sketch coordinates must be finite and bounded.");
    return keep(new oc.gp_Pnt_3(...world));
  };
  let solid;
  try {
    const wireMaker = keep(new oc.BRepBuilderAPI_MakeWire_1());
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i],
        start = placed(edge.start),
        end = placed(edge.end);
      let maker;
      if (edge.kind === "line")
        maker = keep(new oc.BRepBuilderAPI_MakeEdge_3(start, end));
      else {
        const r = distance(edge.start, edge.center),
          angle =
            Math.atan2(
              edge.start[1] - edge.center[1],
              edge.start[0] - edge.center[0],
            ) +
            sweeps[i] / 2;
        const middle = placed([
          edge.center[0] + r * Math.cos(angle),
          edge.center[1] + r * Math.sin(angle),
        ]);
        const arc = keep(new oc.GC_MakeArcOfCircle_4(start, middle, end));
        if (!arc.IsDone()) throw new Error("CAD arc construction failed.");
        const trimmed = keep(arc.Value()),
          curve = keep(new oc.Handle_Geom_Curve_2(trimmed.get()));
        maker = keep(new oc.BRepBuilderAPI_MakeEdge_24(curve));
      }
      if (!maker.IsDone()) throw new Error("CAD edge construction failed.");
      wireMaker.Add_1(keep(maker.Edge()));
      if (!wireMaker.IsDone()) throw new Error("CAD wire construction failed.");
    }
    const wire = keep(wireMaker.Wire()),
      faceMaker = keep(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
    if (!faceMaker.IsDone())
      throw new Error("CAD sketch face construction failed.");
    const face = keep(faceMaker.Face()),
      faceCheck = keep(new oc.BRepCheck_Analyzer(face, true));
    if (!faceCheck.IsValid_2())
      throw new Error(
        "Sketch profile intersects itself or has invalid geometry.",
      );
    const direction = keep(
      new oc.gp_Vec_4(...frame.normal.map((n) => n * height)),
    );
    const prism = keep(
      new oc.BRepPrimAPI_MakePrism_1(face, direction, true, true),
    );
    if (!prism.IsDone()) throw new Error("CAD extrusion construction failed.");
    solid = prism.Shape();
    const check = keep(new oc.BRepCheck_Analyzer(solid, true));
    if (!check.IsValid_2())
      throw new Error("CAD extrusion failed topology and geometry validation.");
    const owned = solid;
    solid = undefined;
    return register(oc, owned);
  } finally {
    solid?.delete();
    cleanup(handles);
  }
}

function revolveShape(oc, input) {
  const points = polygonPoints(input.points);
  const { angleDegrees } = input;
  if (!Number.isFinite(angleDegrees) || angleDegrees <= 0 || angleDegrees > 360)
    throw new Error(
      "Revolve angle must be greater than zero and at most 360 degrees.",
    );
  if (points.some(([radius]) => radius < 0))
    throw new Error(
      "Revolve profile radii cannot be negative or cross the Z axis.",
    );
  const handles = [];
  const keep = (handle) => {
    handles.push(handle);
    return handle;
  };
  try {
    const polygon = keep(new oc.BRepBuilderAPI_MakePolygon_1());
    for (const [radius, z] of points) {
      const point = new oc.gp_Pnt_3(radius, 0, z);
      try {
        polygon.Add_1(point);
      } finally {
        point.delete();
      }
    }
    polygon.Close();
    if (!polygon.IsDone())
      throw new Error("Revolve profile construction failed.");
    const wire = keep(polygon.Wire());
    const faceMaker = keep(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
    if (!faceMaker.IsDone())
      throw new Error("Revolve profile face construction failed.");
    const face = keep(faceMaker.Face());
    const origin = keep(new oc.gp_Pnt_3(0, 0, 0));
    const direction = keep(new oc.gp_Dir_4(0, 0, 1));
    const axis = keep(new oc.gp_Ax1_2(origin, direction));
    const maker = keep(
      new oc.BRepPrimAPI_MakeRevol_1(
        face,
        axis,
        (angleDegrees * Math.PI) / 180,
        true,
      ),
    );
    if (!maker.IsDone())
      throw new Error(
        "Revolve could not build a valid solid from this profile.",
      );
    return register(oc, maker.Shape());
  } finally {
    cleanup(handles);
  }
}

function thicknessShape(oc, input, hollow) {
  const shape = shapes.get(input.kernelId);
  if (!shape) throw new Error("CAD shape handle is unavailable.");
  if (!Number.isFinite(input.thickness) || Math.abs(input.thickness) < 1e-8)
    throw new Error("Thickness must be finite and nonzero.");
  const handles = [],
    maker = new oc.BRepOffsetAPI_MakeThickSolid_1();
  handles.push(maker);
  try {
    if (hollow) {
      if (
        !Array.isArray(input.faceIndices) ||
        !input.faceIndices.length ||
        input.faceIndices.some((i) => !Number.isInteger(i) || i < 0)
      )
        throw new Error("Shell requires zero-based faces to remove.");
      const faces = [],
        explorer = new oc.TopExp_Explorer_2(
          shape,
          oc.TopAbs_ShapeEnum.TopAbs_FACE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        );
      handles.push(explorer);
      for (; explorer.More(); explorer.Next()) {
        const face = explorer.Current();
        faces.push(face);
        handles.push(face);
      }
      if (input.faceIndices.some((i) => i >= faces.length))
        throw new Error(`Face index is outside 0 to ${faces.length - 1}.`);
      const closing = new oc.TopTools_ListOfShape_1();
      handles.push(closing);
      for (const index of new Set(input.faceIndices))
        closing.Append_1(faces[index]);
      maker.MakeThickSolidByJoin(
        shape,
        closing,
        input.thickness,
        1e-6,
        oc.BRepOffset_Mode.BRepOffset_Skin,
        false,
        false,
        oc.GeomAbs_JoinType.GeomAbs_Arc,
        false,
      );
    } else maker.MakeThickSolidBySimple(shape, input.thickness);
    if (!maker.IsDone())
      throw new Error(
        "CAD wall construction failed. Reduce thickness or choose other faces.",
      );
    return register(oc, maker.Shape());
  } finally {
    cleanup(handles);
  }
}

function surfaceStep(patch) {
  const rows = [],
    add = (body) => {
      rows.push(`#${rows.length + 1}=${body};`);
      return `#${rows.length}`;
    };
  const real = (value) => value.toExponential(16).replace("e", "E");
  const list = (values) => `(${values.join(",")})`;
  const knots = (vector) => {
    const unique = [],
      multiplicities = [];
    for (const value of vector) {
      if (unique.at(-1) === value) multiplicities[multiplicities.length - 1]++;
      else {
        unique.push(value);
        multiplicities.push(1);
      }
    }
    return { unique, multiplicities };
  };
  const u = knots(patch.knotsU),
    v = knots(patch.knotsV);
  for (const [axis, k] of [
    ["U", u],
    ["V", v],
  ])
    if (
      k.multiplicities[0] !== patch[`degree${axis}`] + 1 ||
      k.multiplicities.at(-1) !== patch[`degree${axis}`] + 1
    )
      throw new Error("Exact CAD conversion requires clamped boundary knots.");
  const app = add("APPLICATION_CONTEXT('automotive_design')");
  add(
    `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${app})`,
  );
  const productContext = add(`PRODUCT_CONTEXT('',${app},'mechanical')`),
    product = add(`PRODUCT('ScanForge surface','','',(${productContext}))`),
    formation = add(`PRODUCT_DEFINITION_FORMATION('','',${product})`),
    definitionContext = add(
      `PRODUCT_DEFINITION_CONTEXT('part definition',${app},'design')`,
    ),
    definition = add(
      `PRODUCT_DEFINITION('design','',${formation},${definitionContext})`,
    ),
    definitionShape = add(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
  const mm = add("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))"),
    radian = add("(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))"),
    steradian = add(
      "(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())",
    ),
    uncertainty = add(
      `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-7),${mm},'distance_accuracy_value','confusion accuracy')`,
    ),
    context = add(
      `(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${radian},${steradian})) REPRESENTATION_CONTEXT('','3D'))`,
    );
  const points = patch.points.map((p) =>
    add(`CARTESIAN_POINT('',${list(p.map(real))})`),
  );
  const poles = Array.from({ length: patch.countU }, (_, i) =>
    list(
      Array.from(
        { length: patch.countV },
        (_, j) => points[j * patch.countU + i],
      ),
    ),
  );
  const weights = Array.from({ length: patch.countU }, (_, i) =>
    list(
      Array.from({ length: patch.countV }, (_, j) =>
        real(patch.weights[j * patch.countU + i]),
      ),
    ),
  );
  const surface = add(
    `(BOUNDED_SURFACE() B_SPLINE_SURFACE(${patch.degreeU},${patch.degreeV},${list(poles)},.UNSPECIFIED.,.F.,.F.,.F.) B_SPLINE_SURFACE_WITH_KNOTS(${list(u.multiplicities)},${list(v.multiplicities)},${list(u.unique.map(real))},${list(v.unique.map(real))},.UNSPECIFIED.) GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_SURFACE(${list(weights)}) REPRESENTATION_ITEM('') SURFACE())`,
  );
  const index = (i, j) => j * patch.countU + i;
  const cornerIndices = [
    index(0, 0),
    index(patch.countU - 1, 0),
    index(patch.countU - 1, patch.countV - 1),
    index(0, patch.countV - 1),
  ];
  const vertices = cornerIndices.map((i) =>
    add(`VERTEX_POINT('',${points[i]})`),
  );
  const boundaryIndices = [
    Array.from({ length: patch.countU }, (_, i) => index(i, 0)),
    Array.from({ length: patch.countV }, (_, j) => index(patch.countU - 1, j)),
    Array.from({ length: patch.countU }, (_, i) => index(i, patch.countV - 1)),
    Array.from({ length: patch.countV }, (_, j) => index(0, j)),
  ];
  const oriented = boundaryIndices.map((indices, i) => {
    const axis = i % 2 === 0 ? "U" : "V",
      k = axis === "U" ? u : v;
    const curve = add(
      `(BOUNDED_CURVE() B_SPLINE_CURVE(${patch[`degree${axis}`]},${list(indices.map((i) => points[i]))},.UNSPECIFIED.,.F.,.F.) B_SPLINE_CURVE_WITH_KNOTS(${list(k.multiplicities)},${list(k.unique.map(real))},.UNSPECIFIED.) CURVE() GEOMETRIC_REPRESENTATION_ITEM() RATIONAL_B_SPLINE_CURVE(${list(indices.map((i) => real(patch.weights[i])))}) REPRESENTATION_ITEM(''))`,
    );
    const edge = add(
      `EDGE_CURVE('',${vertices[i < 2 ? i : (i + 1) % 4]},${vertices[i < 2 ? (i + 1) % 4 : i]},${curve},.T.)`,
    );
    return add(`ORIENTED_EDGE('',*,*,${edge},${i < 2 ? ".T." : ".F."})`);
  });
  const loop = add(`EDGE_LOOP('',${list(oriented)})`),
    bound = add(`FACE_OUTER_BOUND('',${loop},.T.)`),
    face = add(`ADVANCED_FACE('',(${bound}),${surface},.T.)`),
    shell = add(`OPEN_SHELL('',(${face}))`),
    model = add(`SHELL_BASED_SURFACE_MODEL('',(${shell}))`),
    representation = add(`SHAPE_REPRESENTATION('',(${model}),${context})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${definitionShape},${representation})`);
  return new TextEncoder().encode(
    `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ScanForge exact NURBS face'),'2;1');\nFILE_NAME('surface.step','',(''),(''),'ScanForge','ScanForge','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n${rows.join("\n")}\nENDSEC;\nEND-ISO-10303-21;`,
  );
}

function surfaceShape(oc, patch) {
  if (!patch || patch.format !== "scanforge-nurbs" || patch.version !== 1)
    throw new Error("Unsupported NURBS patch format.");
  for (const axis of ["U", "V"]) {
    const count = patch[`count${axis}`],
      degree = patch[`degree${axis}`],
      knots = patch[`knots${axis}`];
    if (
      !Number.isInteger(count) ||
      count < 2 ||
      count > 16 ||
      !Number.isInteger(degree) ||
      degree < 1 ||
      degree > Math.min(5, count - 1)
    )
      throw new Error("NURBS control counts or degrees are invalid.");
    if (
      !Array.isArray(knots) ||
      knots.length !== count + degree + 1 ||
      knots.some((v) => !Number.isFinite(v)) ||
      !(knots[count] > knots[degree])
    )
      throw new Error("NURBS knot vector is invalid.");
    let run = 1;
    for (let i = 1; i < knots.length; i++) {
      if (knots[i] < knots[i - 1])
        throw new Error("NURBS knots must be nondecreasing.");
      run = knots[i] === knots[i - 1] ? run + 1 : 1;
      if (run > degree + 1)
        throw new Error("NURBS knot multiplicity is invalid.");
    }
  }
  const count = patch.countU * patch.countV;
  if (
    !Array.isArray(patch.points) ||
    patch.points.length !== count ||
    patch.points.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 3 ||
        p.some((v) => !Number.isFinite(v)),
    )
  )
    throw new Error("NURBS control points are invalid.");
  if (
    !Array.isArray(patch.weights) ||
    patch.weights.length !== count ||
    patch.weights.some((w) => !Number.isFinite(w) || w <= 0)
  )
    throw new Error("NURBS weights must be finite and positive.");
  // The pinned kernel omits Array2 bindings. Preserve the exact control net
  // through a standards-based rational STEP face, then import its CAD topology.
  return importFile(oc, { data: surfaceStep(patch), extension: "step" });
}

function polygonWire(oc, points, handles, closed = true) {
  const maker = new oc.BRepBuilderAPI_MakePolygon_1();
  handles.push(maker);
  for (const coordinates of points) {
    const point = new oc.gp_Pnt_3(...coordinates);
    try {
      maker.Add_1(point);
    } finally {
      point.delete();
    }
  }
  if (closed) maker.Close();
  if (!maker.IsDone()) throw new Error("CAD wire construction failed.");
  const wire = maker.Wire();
  handles.push(wire);
  return wire;
}

function loftShape(oc, input) {
  if (!Array.isArray(input.profiles) || input.profiles.length < 2)
    throw new Error("Loft requires at least two closed polygon sections.");
  const profiles = input.profiles.map((profile) => {
    if (!Number.isFinite(profile.z))
      throw new Error("Section height must be finite.");
    return { points: polygonPoints(profile.points), z: profile.z };
  });
  if (profiles.some((p, i) => i > 0 && p.z <= profiles[i - 1].z))
    throw new Error("Loft section heights must increase strictly.");
  const handles = [];
  try {
    const maker = new oc.BRepOffsetAPI_ThruSections(
      true,
      input.ruled === true,
      1e-6,
    );
    handles.push(maker);
    for (const profile of profiles)
      maker.AddWire(
        polygonWire(
          oc,
          profile.points.map(([x, y]) => [x, y, profile.z]),
          handles,
        ),
      );
    maker.CheckCompatibility(true);
    maker.Build();
    if (!maker.IsDone()) throw new Error("Loft could not build a valid solid.");
    return register(oc, maker.Shape());
  } finally {
    cleanup(handles);
  }
}

function sweepShape(oc, input) {
  const points = polygonPoints(input.points),
    path = input.path;
  if (
    !Array.isArray(path) ||
    path.length < 2 ||
    !path.every(
      (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite),
    )
  )
    throw new Error("Sweep requires a finite 3D polyline spine.");
  for (let i = 1; i < path.length; i++)
    if (Math.hypot(...path[i].map((v, k) => v - path[i - 1][k])) < 1e-8)
      throw new Error("Sweep spine contains a zero-length segment.");
  const tangent = path[1].map((v, i) => v - path[0][i]),
    length = Math.hypot(...tangent);
  const w = tangent.map((v) => v / length);
  const reference = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = [
    reference[1] * w[2] - reference[2] * w[1],
    reference[2] * w[0] - reference[0] * w[2],
    reference[0] * w[1] - reference[1] * w[0],
  ];
  const ul = Math.hypot(...u);
  for (let i = 0; i < 3; i++) u[i] /= ul;
  const v = [
    w[1] * u[2] - w[2] * u[1],
    w[2] * u[0] - w[0] * u[2],
    w[0] * u[1] - w[1] * u[0],
  ];
  const handles = [];
  try {
    const spine = polygonWire(oc, path, handles, false);
    const profile = polygonWire(
      oc,
      points.map(([x, y]) => path[0].map((p, i) => p + x * u[i] + y * v[i])),
      handles,
    );
    const maker = new oc.BRepOffsetAPI_MakePipeShell(spine);
    handles.push(maker);
    maker.SetTransitionMode(
      oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner,
    );
    maker.Add_1(profile, false, true);
    maker.Build();
    if (!maker.IsDone() || !maker.MakeSolid())
      throw new Error(
        "Sweep could not build a solid. Reduce profile size or simplify the spine.",
      );
    return register(oc, maker.Shape());
  } finally {
    cleanup(handles);
  }
}

function edgeShape(oc, input) {
  const shape = shapes.get(input.kernelId);
  if (!shape) throw new Error("CAD shape handle is unavailable.");
  if (
    !["fillet", "chamfer"].includes(input.operation) ||
    !(input.amount > 0) ||
    !Number.isFinite(input.amount)
  )
    throw new Error(
      "Edge treatment requires a positive finite radius or distance.",
    );
  if (
    !Array.isArray(input.edgeIndices) ||
    !input.edgeIndices.length ||
    input.edgeIndices.some((i) => !Number.isInteger(i) || i < 0)
  )
    throw new Error("Select at least one valid zero-based edge index.");
  const handles = [],
    edges = [];
  try {
    for (const edge of uniqueReferenceTopology(
      oc,
      shape,
      "edges",
      handles,
      false,
    ))
      edges.push(edge);
    if (input.edgeIndices.some((i) => i >= edges.length))
      throw new Error(`Edge index is outside 0 to ${edges.length - 1}.`);
    const maker =
      input.operation === "fillet"
        ? new oc.BRepFilletAPI_MakeFillet(
            shape,
            oc.ChFi3d_FilletShape.ChFi3d_Rational,
          )
        : new oc.BRepFilletAPI_MakeChamfer(shape);
    handles.push(maker);
    for (const index of new Set(input.edgeIndices))
      maker.Add_2(input.amount, edges[index]);
    maker.Build();
    if (!maker.IsDone())
      throw new Error(
        "Edge treatment failed. Reduce the radius or distance or choose other edges.",
      );
    return register(oc, maker.Shape());
  } finally {
    cleanup(handles);
  }
}

function offsetShape(oc, input) {
  const shape = shapes.get(input.kernelId);
  if (!shape) throw new Error("CAD shape handle is unavailable.");
  if (!Number.isFinite(input.distance) || Math.abs(input.distance) < 1e-8)
    throw new Error("Offset distance must be finite and nonzero.");
  const maker = new oc.BRepOffsetAPI_MakeOffsetShape_1();
  try {
    maker.PerformByJoin(
      shape,
      input.distance,
      1e-6,
      oc.BRepOffset_Mode.BRepOffset_Skin,
      false,
      false,
      oc.GeomAbs_JoinType.GeomAbs_Arc,
      false,
    );
    if (!maker.IsDone())
      throw new Error("CAD offset failed on this topology or distance.");
    return register(oc, maker.Shape());
  } finally {
    maker.delete();
  }
}

function sewShape(oc, input) {
  if (
    !Array.isArray(input.kernelIds) ||
    !input.kernelIds.length ||
    !Number.isFinite(input.tolerance) ||
    input.tolerance <= 0
  )
    throw new Error(
      "Sew requires CAD handles and a positive finite tolerance.",
    );
  const selected = input.kernelIds.map((id) => {
    const shape = shapes.get(id);
    if (!shape) throw new Error("CAD shape handle is unavailable.");
    return shape;
  });
  const maker = new oc.BRepBuilderAPI_Sewing(
      input.tolerance,
      true,
      true,
      true,
      false,
    ),
    progress = new oc.Handle_Message_ProgressIndicator_1();
  try {
    for (const shape of selected) maker.Add(shape);
    maker.Perform(progress);
    const sewn = maker.SewedShape();
    if (sewn.IsNull()) {
      sewn.delete();
      throw new Error("Sew produced no connected faces.");
    }
    return register(oc, sewn);
  } finally {
    progress.delete();
    maker.delete();
  }
}

function closedShellShape(oc, input) {
  if (
    !Array.isArray(input.patches) ||
    input.patches.length < 2 ||
    !Number.isFinite(input.tolerance) ||
    input.tolerance <= 0
  )
    throw new Error(
      "Closed reconstruction requires surface patches and a positive sewing tolerance.",
    );
  const temporary = [],
    handles = [];
  const keep = (handle) => {
    handles.push(handle);
    return handle;
  };
  let solid;
  try {
    const sewing = keep(
      new oc.BRepBuilderAPI_Sewing(input.tolerance, true, true, true, false),
    );
    for (const patch of input.patches) {
      const face = surfaceShape(oc, patch);
      temporary.push(face.kernelId);
      sewing.Add(getShape(face.kernelId));
    }
    const progress = keep(new oc.Handle_Message_ProgressIndicator_1());
    sewing.Perform(progress);
    if (
      sewing.NbFreeEdges() ||
      sewing.NbMultipleEdges() ||
      sewing.NbDeletedFaces()
    )
      throw new Error(
        "Patches do not form a closed manifold shell: free, multiple or deleted face boundaries remain.",
      );
    const sewn = keep(sewing.SewedShape());
    const explorer = keep(
      new oc.TopExp_Explorer_2(
        sewn,
        oc.TopAbs_ShapeEnum.TopAbs_SHELL,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    if (!explorer.More())
      throw new Error("Reconstruction contains no closed shell.");
    const current = keep(explorer.Current());
    const shell = keep(oc.TopoDS.Shell_1(current));
    explorer.Next();
    if (explorer.More())
      throw new Error(
        "Choose patches forming exactly one connected shell; disjoint shells and cavities are not supported.",
      );
    const maker = keep(new oc.BRepBuilderAPI_MakeSolid_1());
    maker.Add(shell);
    if (!maker.IsDone())
      throw new Error("Closed shell solid construction failed.");
    solid = maker.Solid();
    if (!oc.BRepLib.OrientClosedSolid(solid))
      throw new Error("Shell does not enclose a finite orientable volume.");
    const checker = keep(new oc.BRepCheck_Analyzer(solid, true));
    if (!checker.IsValid_2())
      throw new Error(
        "Reconstructed CAD solid failed topology and geometry validation.",
      );
    const owned = solid;
    solid = undefined;
    return register(oc, owned);
  } finally {
    solid?.delete();
    cleanup(handles);
    for (const id of temporary) {
      shapes.get(id)?.delete();
      dropAlignmentMesh(id);
      shapes.delete(id);
    }
  }
}

self.onmessage = (event) => {
  const { id, operation, payload } = event.data;
  sequence = sequence.then(async () => {
    try {
      const onProgress =
        operation === "import"
          ? (progress) => self.postMessage({ id, progress })
          : () => {};
      onProgress(0);
      const oc = await kernel();
      onProgress(0.1);
      let result;
      if (operation === "import") result = importFile(oc, payload, onProgress);
      else if (operation === "primitive") result = primitive(oc, payload);
      else if (operation === "referenceFeatures")
        result = referenceFeatures(oc, payload);
      else if (operation === "referenceCoordinate")
        result = referenceCoordinate(oc, payload);
      else if (operation === "alignmentReferences")
        result = alignmentReferences(oc, payload);
      else if (operation === "alignmentMesh") {
        result = alignmentMesh(oc, payload);
        if (payload.includeUVs === false) {
          const { vertices, triangles, normals } = result;
          result = { vertices, triangles, normals };
        }
      } else if (operation === "export") result = exportStep(oc, payload);
      else if (operation === "boolean") result = booleanShape(oc, payload);
      else if (operation === "transform") result = transformShape(oc, payload);
      else if (operation === "datumTransform")
        result = datumTransformShape(oc, payload);
      else if (operation === "pattern") result = patternShape(oc, payload);
      else if (operation === "mirror") result = mirrorShape(oc, payload);
      else if (operation === "split") result = splitShape(oc, payload);
      else if (operation === "extrude") result = extrudeShape(oc, payload);
      else if (operation === "extrudeCurves")
        result = extrudeCurvesShape(oc, payload);
      else if (operation === "revolve") result = revolveShape(oc, payload);
      else if (operation === "loft") result = loftShape(oc, payload);
      else if (operation === "sweep") result = sweepShape(oc, payload);
      else if (operation === "edges") result = edgeShape(oc, payload);
      else if (operation === "offset") result = offsetShape(oc, payload);
      else if (operation === "sew") result = sewShape(oc, payload);
      else if (operation === "closedShell")
        result = closedShellShape(oc, payload);
      else if (operation === "surface") result = surfaceShape(oc, payload);
      else if (operation === "shell")
        result = thicknessShape(oc, payload, true);
      else if (operation === "thicken")
        result = thicknessShape(oc, payload, false);
      else if (operation === "release") {
        if (!Array.isArray(payload))
          throw new Error("CAD release requires handle IDs.");
        for (const kernelId of payload) {
          shapes.get(kernelId)?.delete();
          dropAlignmentMesh(kernelId);
          shapes.delete(kernelId);
        }
        result = true;
      } else throw new Error("Unknown CAD operation.");
      onProgress(1);
      self.postMessage(
        { id, result },
        result instanceof Uint8Array ? [result.buffer] : [],
      );
    } catch (error) {
      self.postMessage({
        id,
        error:
          error instanceof Error
            ? error.message
            : "CAD kernel operation failed on invalid or unsupported geometry.",
      });
    }
  });
};
