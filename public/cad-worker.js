/* Dedicated CAD worker. All CAD bytes stay in this browser's virtual filesystem. */
let kernelPromise;
const shapes = new Map();
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

function statusValue(status) {
  return status?.value ?? status;
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

function mesh(oc, shape) {
  const handles = [];
  const keep = (handle) => {
    handles.push(handle);
    return handle;
  };
  try {
    keep(new oc.BRepMesh_IncrementalMesh_2(shape, 0.15, false, 0.35, false));
    const explorer = keep(
      new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    const positions = [];
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
    }
    if (!positions.length)
      throw new Error("CAD file contains no renderable faces.");
    return positions;
  } finally {
    cleanup(handles);
  }
}

function register(oc, shape) {
  try {
    if (shape.IsNull())
      throw new Error("CAD operation returned an empty shape.");
    const positions = mesh(oc, shape);
    const kernelId = `cad-${sessionId}-${++nextShape}`;
    const brep = serializeBrep(oc, shape);
    shapes.set(kernelId, shape);
    return { kernelId, positions, brep };
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

function importFile(oc, payload) {
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
      if (!reader.TransferRoots())
        throw new Error("CAD import contains no transferable roots.");
      shape = reader.OneShape();
    }
    return register(oc, shape);
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

function extrudeShape(oc, input) {
  const { height } = input;
  const points = polygonPoints(input.points);
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
      const nativePoint = new oc.gp_Pnt_3(point[0], point[1], 0);
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
    const direction = keep(new oc.gp_Vec_4(0, 0, height));
    const prism = keep(
      new oc.BRepPrimAPI_MakePrism_1(face, direction, true, true),
    );
    if (!prism.IsDone()) throw new Error("CAD extrusion construction failed.");
    return register(oc, prism.Shape());
  } finally {
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

self.onmessage = (event) => {
  const { id, operation, payload } = event.data;
  sequence = sequence.then(async () => {
    try {
      const oc = await kernel();
      let result;
      if (operation === "import") result = importFile(oc, payload);
      else if (operation === "primitive") result = primitive(oc, payload);
      else if (operation === "export") result = exportStep(oc, payload);
      else if (operation === "boolean") result = booleanShape(oc, payload);
      else if (operation === "transform") result = transformShape(oc, payload);
      else if (operation === "extrude") result = extrudeShape(oc, payload);
      else if (operation === "revolve") result = revolveShape(oc, payload);
      else if (operation === "release") {
        if (!Array.isArray(payload))
          throw new Error("CAD release requires handle IDs.");
        for (const kernelId of payload) {
          shapes.get(kernelId)?.delete();
          shapes.delete(kernelId);
        }
        result = true;
      } else throw new Error("Unknown CAD operation.");
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
