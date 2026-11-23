var ScanForgeSketchBackend = (function(exports) {
  "use strict";
  function nativeReferenceNormalize(vector) {
    const result = [...vector];
    const length2 = Math.sqrt(
      vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]
    );
    if (Number.EPSILON <= length2) {
      const reciprocal = 1 / length2;
      for (let i = 0; i < 3; i++) result[i] = vector[i] * reciprocal;
    }
    return result;
  }
  function nativeReferenceCircumcenter(a, b, c, requireFiniteIntermediates = false) {
    const checked = (values) => {
      if (requireFiniteIntermediates && !values.every(Number.isFinite))
        throw new Error("Sketch circumcenter arithmetic overflow.");
      return values;
    };
    const atA = (c[1] - a[1]) * (b[1] - a[1]) + (c[0] - a[0]) * (b[0] - a[0]) + (c[2] - a[2]) * (b[2] - a[2]);
    const atB = (c[1] - b[1]) * (a[1] - b[1]) + (c[0] - b[0]) * (a[0] - b[0]) + (c[2] - b[2]) * (a[2] - b[2]);
    const atC = (a[1] - c[1]) * (b[1] - c[1]) + (a[0] - c[0]) * (b[0] - c[0]) + (a[2] - c[2]) * (b[2] - c[2]);
    const ca = atC * atA;
    const cb = atC * atB;
    const ab = atB * atA;
    const cSum = ca + cb;
    const determinant = cSum + ab;
    checked([atA, atB, atC, ca, cb, ab, cSum, determinant]);
    if (!(Number.EPSILON <= Math.abs(determinant))) {
      return {
        center: checked([
          (a[0] + b[0] + c[0]) / 3,
          (a[1] + b[1] + c[1]) / 3,
          (a[2] + b[2] + c[2]) / 3
        ]),
        nondegenerate: false
      };
    }
    const halfReciprocal = 0.5 / determinant;
    const weightC = cSum * halfReciprocal;
    const weightB = (ab + cb) * halfReciprocal;
    const weightA = (ab + ca) * halfReciprocal;
    checked([halfReciprocal, weightA, weightB, weightC]);
    return {
      center: checked([
        a[0] * weightA + b[0] * weightB + c[0] * weightC,
        weightA * a[1] + weightB * b[1] + weightC * c[1],
        weightA * a[2] + weightB * b[2] + weightC * c[2]
      ]),
      nondegenerate: true
    };
  }
  function point$5(value) {
    if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n)))
      throw new Error("Arc backend requires finite three-coordinate points.");
    return [value[0], value[1], value[2]];
  }
  function finite$9(value) {
    if (!Number.isFinite(value))
      throw new Error("Arc backend arithmetic overflow.");
    return value;
  }
  function admitted(points) {
    const [a, b, c] = points;
    const fit = nativeReferenceCircumcenter(a, b, c, true);
    if (!fit.nondegenerate) return false;
    const dy = c[1] - fit.center[1], dx = c[0] - fit.center[0], dz = c[2] - fit.center[2];
    const radius = Math.sqrt(finite$9(dy * dy + dx * dx + dz * dz));
    if (radius < 2 ** -23) return false;
    const delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    finite$9(delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]);
    const direction = nativeReferenceNormalize(nativeReferenceNormalize(delta));
    const dot = finite$9(
      (c[0] - a[0]) * direction[0] + direction[1] * (c[1] - a[1]) + direction[2] * (c[2] - a[2])
    );
    return 2 ** -23 <= Math.abs(1 - Math.abs(dot));
  }
  class SketchArcBackend {
    #oc;
    #edge;
    #points;
    #disposed = false;
    constructor(oc) {
      this.#oc = oc;
    }
    #requireLive() {
      if (this.#disposed) throw new Error("Sketch arc backend is disposed.");
    }
    #reset() {
      const old = this.#edge;
      this.#edge = void 0;
      this.#points = void 0;
      old?.delete();
    }
    /** Borrowed worker-local handle, invalidated by rebuild/dispose. */
    get edge() {
      this.#requireLive();
      return this.#edge;
    }
    snapshot() {
      return this.#edge ? {
        disposed: this.#disposed,
        kind: "arc",
        records: this.#points.map((p) => [...p])
      } : { disposed: this.#disposed, kind: "empty", records: [] };
    }
    rebuild(input) {
      this.#requireLive();
      if (!input || typeof input !== "object")
        throw new Error("Invalid arc backend request.");
      const request = input;
      if (request.kind !== "arc" || !Array.isArray(request.points) || request.points.length !== 3)
        throw new Error("Arc backend requires three input points.");
      const points = [
        point$5(request.points[0]),
        point$5(request.points[1]),
        point$5(request.points[2])
      ];
      point$5(request.center);
      this.#reset();
      if (!admitted(points)) return false;
      const oc = this.#oc, handles = [];
      const keep = (value) => (handles.push(value), value);
      let candidate;
      try {
        try {
          const a = keep(new oc.gp_Pnt_3(...points[0]));
          const b = keep(new oc.gp_Pnt_3(...points[1]));
          const c = keep(new oc.gp_Pnt_3(...points[2]));
          const maker = keep(new oc.GC_MakeArcOfCircle_4(a, b, c));
          if (!maker.IsDone()) return false;
          const trimmed = keep(maker.Value());
          if (trimmed.IsNull()) return false;
          const curve = keep(new oc.Handle_Geom_Curve_2(trimmed.get()));
          const edgeMaker = keep(new oc.BRepBuilderAPI_MakeEdge_24(curve));
          if (!edgeMaker.IsDone()) return false;
          candidate = edgeMaker.Edge();
        } finally {
          for (let i = handles.length - 1; i >= 0; i--) handles[i].delete();
        }
        if (!candidate || candidate.IsNull()) return false;
        this.#points = points;
        this.#edge = candidate;
        candidate = void 0;
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
  const SKETCH_SOURCE_LIMITS = Object.freeze({
    children: 8192,
    records: 32768
  });
  function object(value, fields) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid sketch source record object.");
    if (Object.keys(value).some((key) => !fields.includes(key)))
      throw new Error("Unsupported sketch source record field.");
    return value;
  }
  function identity(value) {
    if (typeof value !== "string")
      throw new Error("Invalid sketch source identity.");
    return value;
  }
  function kind(value) {
    if (value !== "line" && value !== "arc" && value !== "circle" && value !== "ellipse" && value !== "spline")
      throw new Error("Unsupported sketch source child kind.");
    return value;
  }
  function numbers(value, length2) {
    if (!Array.isArray(value) || value.length !== length2)
      throw new Error("Invalid sketch source coordinate dimensions.");
    return Array.from(value, (coordinate) => {
      if (typeof coordinate !== "number" || !Number.isFinite(coordinate))
        throw new Error("Sketch source coordinates must be finite numbers.");
      return coordinate;
    });
  }
  function frame(value) {
    if (!Array.isArray(value) || value.length !== 3)
      throw new Error("Invalid sketch source frame dimensions.");
    return Array.from(
      value,
      (row) => numbers(row, 4)
    );
  }
  function children(value) {
    if (!Array.isArray(value))
      throw new Error("Invalid sketch source child collection.");
    if (value.length > SKETCH_SOURCE_LIMITS.children)
      throw new Error("Sketch source child budget exceeded.");
    return value;
  }
  function claimIdentity(id, seen) {
    const result = identity(id);
    if (seen.has(result))
      throw new Error("Duplicate sketch source child identity.");
    seen.add(result);
    return result;
  }
  function recordBudget(count) {
    if (count > SKETCH_SOURCE_LIMITS.records)
      throw new Error("Sketch source record budget exceeded.");
  }
  function copySketchSourceRecordStore(input) {
    const value = object(input, ["version", "id", "frame", "children"]);
    if (value.version !== 1)
      throw new Error("Unsupported sketch source record version.");
    const id = identity(value.id), placement = frame(value.frame), seen = /* @__PURE__ */ new Set();
    let recordCount = 0;
    const copied = Array.from(children(value.children), (item) => {
      const child = object(item, ["id", "kind", "records"]);
      const childId = claimIdentity(child.id, seen), childKind = kind(child.kind);
      let records2;
      if (child.records !== void 0) {
        if (!Array.isArray(child.records))
          throw new Error("Invalid sketch source point collection.");
        recordCount += child.records.length;
        recordBudget(recordCount);
        records2 = Array.from(
          child.records,
          (point2) => numbers(point2, 3)
        );
      }
      return { id: childId, kind: childKind, records: records2 };
    });
    return { version: 1, id, frame: placement, children: copied };
  }
  function finite$8(value) {
    if (!Number.isFinite(value))
      throw new Error("Sketch arc arithmetic overflow.");
    return value;
  }
  function transformArcPoint(frame2, point2) {
    const [a, b, c] = frame2;
    return [
      finite$8(a[0] * point2[0] + a[1] * point2[1] + a[2] * point2[2] + a[3]),
      finite$8(b[0] * point2[0] + b[1] * point2[1] + b[2] * point2[2] + b[3]),
      finite$8(c[0] * point2[0] + c[1] * point2[1] + c[2] * point2[2] + c[3])
    ];
  }
  function squaredDistance(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return finite$8(dx * dx + dy * dy + dz * dz);
  }
  function translatePreparedArc(previous, frame2, delta, closed) {
    const move = (point2) => [
      finite$8(delta[0] + point2[0]),
      finite$8(delta[1] + point2[1]),
      finite$8(delta[2] + point2[2])
    ];
    const points = previous.points.map(move);
    const center = move(previous.center);
    return {
      frame: frame2,
      points,
      center,
      radius: previous.radius,
      closed,
      sourceRecords: [
        [...points[0]],
        [...points[1]],
        [...points[2]],
        [...center]
      ],
      fitSucceeded: void 0,
      backendRequest: {
        kind: "arc",
        points: [[...points[0]], [...points[1]], [...points[2]]],
        center: [...center]
      }
    };
  }
  function admittedDeterminant(a, b, c) {
    const atA = finite$8(
      (c[0] - a[0]) * (b[0] - a[0]) + (c[1] - a[1]) * (b[1] - a[1]) + (c[2] - a[2]) * (b[2] - a[2])
    );
    const atB = finite$8(
      (c[0] - b[0]) * (a[0] - b[0]) + (c[1] - b[1]) * (a[1] - b[1]) + (c[2] - b[2]) * (a[2] - b[2])
    );
    const atC = finite$8(
      (a[1] - c[1]) * (b[1] - c[1]) + (a[0] - c[0]) * (b[0] - c[0]) + (a[2] - c[2]) * (b[2] - c[2])
    );
    const determinant = finite$8(atC * atB + atC * atA + atB * atA);
    return Number.EPSILON <= Math.abs(determinant);
  }
  function prepareNativeSketchArcRebuild(input, placement, previous, close) {
    if (!Array.isArray(input) || input.length !== 3)
      throw new Error("Arc rebuild requires exactly three source points.");
    if (!previous || typeof previous !== "object" || Array.isArray(previous))
      throw new Error("Invalid prior arc state.");
    const prior = previous;
    if (Object.keys(prior).some(
      (key) => !["radius", "closed", "sourceRecords"].includes(key)
    ) || !Object.hasOwn(prior, "radius") || prior.radius !== void 0 && (typeof prior.radius !== "number" || !Number.isFinite(prior.radius)) || typeof prior.closed !== "boolean" || typeof close !== "boolean" || !Array.isArray(prior.sourceRecords) || ![0, 4].includes(prior.sourceRecords.length))
      throw new Error("Invalid arc rebuild state or closure flag.");
    const copied = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: placement,
      children: [
        { id: "input", kind: "arc", records: input },
        { id: "prior", kind: "arc", records: prior.sourceRecords }
      ]
    });
    let [a, b, c] = copied.children[0].records.map((p) => [
      p[0],
      p[1],
      0
    ]);
    let center = [...b];
    let radius = prior.radius, closed = prior.closed;
    if (squaredDistance(a, b) < 1e-4 || squaredDistance(c, b) < 1e-4) {
      const midpoint = [
        finite$8((a[0] + c[0]) * 0.5),
        finite$8((a[1] + c[1]) * 0.5),
        (a[2] + c[2]) * 0.5
      ];
      const delta = [
        midpoint[0] - a[0],
        midpoint[1] - a[1],
        midpoint[2] - a[2]
      ];
      radius = Math.sqrt(
        finite$8(delta[1] * delta[1] + delta[0] * delta[0] + delta[2] * delta[2])
      );
      const direction = nativeReferenceNormalize(delta);
      b = [
        finite$8(radius * direction[1] + midpoint[0]),
        finite$8(-direction[0] * radius + midpoint[1]),
        finite$8(radius * 0 + midpoint[2])
      ];
    }
    const oldRecords = copied.children[1].records;
    const records2 = [[...a], [...b], [...c], [...oldRecords.length ? oldRecords[3] : b]];
    let fitSucceeded = false;
    if (admittedDeterminant(a, b, c)) {
      const fit = nativeReferenceCircumcenter(a, b, c, true);
      center = [fit.center[0], fit.center[1], fit.center[2]];
      radius = -34028234663852886e22;
      if (fit.nondegenerate) {
        const dy = c[1] - center[1], dx = c[0] - center[0], dz = c[2] - center[2];
        radius = Math.sqrt(finite$8(dy * dy + dx * dx + dz * dz));
      }
      if (0 < radius) {
        center = [center[0], center[1], 0];
        records2[3] = [...center];
        fitSucceeded = true;
        if (close || squaredDistance(a, c) < 1e-8) {
          closed = true;
          a = [...c];
        }
      }
    }
    return {
      frame: copied.frame,
      points: [a, b, c],
      center,
      radius,
      closed,
      sourceRecords: records2,
      fitSucceeded,
      backendRequest: fitSucceeded ? { kind: "arc", points: [[...a], [...b], [...c]], center: [...center] } : void 0
    };
  }
  function prepareNativeSketchArcLocalReplacement(input, previous) {
    if (!Array.isArray(input) || input.length < 3)
      throw new Error("Arc local replacement requires at least three records.");
    const copied = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: previous.frame,
      children: [{ id: "input", kind: "arc", records: input }]
    });
    const records2 = copied.children[0].records;
    if (records2.length > 3 && previous.points.every(
      (point2, index) => squaredDistance(point2, records2[index]) < 1e-5
    )) {
      return {
        route: "retain",
        preparation: translatePreparedArc(
          previous,
          copied.frame,
          [0, 0, 0],
          false
        )
      };
    }
    return {
      route: "refit",
      preparation: prepareNativeSketchArcRebuild(
        records2.slice(0, 3),
        copied.frame,
        {
          radius: previous.radius,
          closed: false,
          sourceRecords: previous.sourceRecords
        },
        false
      )
    };
  }
  function prepareNativeSketchArcPlacedReplacement(input, placement, previous) {
    if (!Array.isArray(input) || input.length < 3)
      throw new Error("Placed arc replacement requires at least three records.");
    const copied = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: placement,
      children: [{ id: "input", kind: "arc", records: input }]
    });
    const records2 = copied.children[0].records;
    const [a, b, c] = copied.frame;
    const local = (point2) => {
      const x = finite$8(point2[0] - a[3]), y = finite$8(point2[1] - b[3]), z = finite$8(point2[2] - c[3]);
      return [
        finite$8(y * b[0] + x * a[0] + z * c[0]),
        finite$8(y * b[1] + x * a[1] + z * c[1]),
        finite$8(y * b[2] + x * a[2] + z * c[2])
      ];
    };
    if (records2.length > 3 && previous.points.every(
      (point2, index) => squaredDistance(
        transformArcPoint(copied.frame, point2),
        records2[index]
      ) < 1e-5
    )) {
      const target = local(records2[3]);
      const delta = [
        finite$8(target[0] - previous.center[0]),
        finite$8(target[1] - previous.center[1]),
        finite$8(target[2] - previous.center[2])
      ];
      const retainedFrame = copySketchSourceRecordStore({
        version: 1,
        id: "",
        frame: previous.frame,
        children: []
      }).frame;
      return {
        route: "translate",
        preparation: translatePreparedArc(previous, retainedFrame, delta, false)
      };
    }
    return {
      route: "refit",
      preparation: prepareNativeSketchArcRebuild(
        records2.slice(0, 3).map(local),
        copied.frame,
        {
          radius: previous.radius,
          closed: false,
          sourceRecords: previous.sourceRecords
        },
        false
      )
    };
  }
  function prepareNativeSketchArcPointEdit(index, input, previous) {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 3)
      throw new Error(
        "Arc point index must be an integer from zero through three."
      );
    const copied = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: previous.frame,
      children: [{ id: "input", kind: "arc", records: [input] }]
    });
    const point2 = copied.children[0].records[0];
    if (index === 3) {
      const delta = [
        finite$8(point2[0] - previous.center[0]),
        finite$8(point2[1] - previous.center[1]),
        0
      ];
      return {
        route: "translate",
        preparation: translatePreparedArc(
          previous,
          copied.frame,
          delta,
          previous.closed
        )
      };
    }
    const points = previous.points.map((p) => [...p]);
    points[index] = [...point2];
    return {
      route: "refit",
      preparation: prepareNativeSketchArcRebuild(
        points,
        copied.frame,
        {
          radius: previous.radius,
          closed: previous.closed,
          sourceRecords: previous.sourceRecords
        },
        previous.closed
      )
    };
  }
  function prepareNativeSketchArcTransform(input, previous) {
    const copied = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: input,
      children: [{ id: "points", kind: "arc", records: previous.points }]
    });
    const points = copied.children[0].records.map(
      (point2) => transformArcPoint(copied.frame, point2)
    );
    return prepareNativeSketchArcRebuild(
      points,
      previous.frame,
      {
        radius: previous.radius,
        closed: previous.closed,
        sourceRecords: previous.sourceRecords
      },
      previous.closed
    );
  }
  function prepareNativeSketchArcCollectionRebuild(input, previous) {
    if (!Array.isArray(input) || input.length < 3)
      throw new Error("Arc collection rebuild requires at least three records.");
    const copied = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: previous.frame,
      children: [{ id: "input", kind: "arc", records: input }]
    });
    return prepareNativeSketchArcRebuild(
      copied.children[0].records.slice(0, 3),
      copied.frame,
      {
        radius: previous.radius,
        closed: previous.closed,
        sourceRecords: previous.sourceRecords
      },
      previous.closed
    );
  }
  function prepareNativeSketchCircleRebuild(input, placement) {
    if (!Array.isArray(input) || input.length !== 3)
      throw new Error("Circle rebuild requires exactly three source points.");
    const source = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: placement,
      children: [{ id: "", kind: "circle", records: input }]
    });
    const points = source.children[0].records.map((point2) => [
      point2[0],
      point2[1],
      0
    ]);
    const [a, b, c] = points;
    const fit = nativeReferenceCircumcenter(a, b, c, true);
    let center = [b[0], b[1], 0];
    let radius = -Number.MAX_VALUE;
    let fitSucceeded = false;
    if (fit.nondegenerate) {
      const dy = c[1] - fit.center[1];
      const dx = c[0] - fit.center[0];
      const dz = c[2] - fit.center[2];
      const squared = dy * dy + dx * dx + dz * dz;
      if (!Number.isFinite(squared))
        throw new Error("Sketch circle radius arithmetic overflow.");
      const fittedRadius = Math.sqrt(squared);
      if (2 ** -23 < fittedRadius) {
        center = [fit.center[0], fit.center[1], 0];
        radius = fittedRadius;
        fitSucceeded = true;
      }
    }
    return {
      frame: source.frame,
      sourceRecords: [a, b, c, center],
      fitSucceeded,
      backendRequest: { kind: "circle", center: [...center], radius }
    };
  }
  function finite$7(value) {
    if (!Number.isFinite(value))
      throw new Error("Sketch circle edit arithmetic overflow.");
    return value;
  }
  function prepareNativeSketchCirclePlacedReplacement(input, placement, previous) {
    if (!Array.isArray(input) || input.length < 3)
      throw new Error(
        "Placed circle replacement requires at least three records."
      );
    const copied = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: placement,
      children: [{ id: "input", kind: "circle", records: input }]
    });
    const records2 = copied.children[0].records;
    const [a, b, c] = copied.frame;
    const local = (point2) => {
      const x = finite$7(point2[0] - a[3]), y = finite$7(point2[1] - b[3]), z = finite$7(point2[2] - c[3]);
      return [
        finite$7(y * b[0] + x * a[0] + z * c[0]),
        finite$7(y * b[1] + x * a[1] + z * c[1]),
        finite$7(y * b[2] + x * a[2] + z * c[2])
      ];
    };
    if (records2.length > 3 && previous.sourceRecords.slice(0, 3).every((point2, index) => {
      const world = copied.frame.map(
        (row) => finite$7(
          row[0] * point2[0] + row[1] * point2[1] + row[2] * point2[2] + row[3]
        )
      );
      const dx = finite$7(world[0] - records2[index][0]), dy = finite$7(world[1] - records2[index][1]), dz = finite$7(world[2] - records2[index][2]);
      return finite$7(dx * dx + dy * dy + dz * dz) < 1e-5;
    })) {
      return prepareNativeSketchCircleLocalReplacement(
        [...previous.sourceRecords.slice(0, 3), local(records2[3])],
        previous
      );
    }
    return {
      route: "refit",
      preparation: prepareNativeSketchCircleRebuild(
        records2.slice(0, 3).map(local),
        copied.frame
      )
    };
  }
  function copyCircleEditRecords(input, previous) {
    if (!Array.isArray(input) || input.length < 3)
      throw new Error(
        "Circle collection editing requires at least three records."
      );
    return copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: previous.frame,
      children: [{ id: "input", kind: "circle", records: input }]
    });
  }
  function prepareNativeSketchCircleCollectionRebuild(input, previous) {
    const copied = copyCircleEditRecords(input, previous);
    return prepareNativeSketchCircleRebuild(
      copied.children[0].records.slice(0, 3),
      copied.frame
    );
  }
  function prepareNativeSketchCircleLocalReplacement(input, previous) {
    const copied = copyCircleEditRecords(input, previous);
    const records2 = copied.children[0].records;
    const near = records2.length > 3 && records2.slice(0, 3).every((p, index) => {
      const old = previous.sourceRecords[index];
      const dx = finite$7(old[0] - p[0]), dy = finite$7(old[1] - p[1]), dz = finite$7(old[2] - p[2]);
      return finite$7(dx * dx + dy * dy + dz * dz) < 1e-5;
    });
    if (!near)
      return {
        route: "refit",
        preparation: prepareNativeSketchCircleRebuild(
          records2.slice(0, 3),
          copied.frame
        )
      };
    const center = previous.backendRequest.center;
    const delta = records2[3].map((value, i) => finite$7(value - center[i]));
    const move = (point2) => [
      finite$7(point2[0] + delta[0]),
      finite$7(point2[1] + delta[1]),
      finite$7(point2[2] + delta[2])
    ];
    const movedCenter = move(center);
    return {
      route: "translate",
      preparation: {
        frame: copied.frame,
        sourceRecords: [
          move(previous.sourceRecords[0]),
          move(previous.sourceRecords[1]),
          move(previous.sourceRecords[2]),
          movedCenter
        ],
        fitSucceeded: void 0,
        backendRequest: {
          kind: "circle",
          center: [...movedCenter],
          radius: previous.backendRequest.radius
        }
      }
    };
  }
  function prepareNativeSketchCirclePointEdit(index, input, previous) {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 3)
      throw new Error("Circle point index must be an integer from 0 to 3.");
    const copied = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: previous.frame,
      children: [{ id: "input", kind: "circle", records: [input] }]
    });
    const point2 = copied.children[0].records[0];
    if (index < 3) {
      const points = previous.sourceRecords.slice(0, 3).map((p) => [...p]);
      points[index] = [...point2];
      return prepareNativeSketchCircleRebuild(points, copied.frame);
    }
    const center = previous.backendRequest.center;
    const dx = finite$7(point2[0] - center[0]);
    const dy = finite$7(point2[1] - center[1]);
    const move = (p) => [
      finite$7(p[0] + dx),
      finite$7(p[1] + dy),
      finite$7(p[2] + 0)
    ];
    const movedCenter = move(center);
    return {
      frame: copied.frame,
      sourceRecords: [
        move(previous.sourceRecords[0]),
        move(previous.sourceRecords[1]),
        move(previous.sourceRecords[2]),
        movedCenter
      ],
      fitSucceeded: void 0,
      backendRequest: {
        kind: "circle",
        center: [...movedCenter],
        radius: previous.backendRequest.radius
      }
    };
  }
  function prepareNativeSketchCircleTransform(input, previous) {
    const copied = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: input,
      children: [
        {
          id: "points",
          kind: "circle",
          records: previous.sourceRecords.slice(0, 3)
        }
      ]
    });
    const points = copied.children[0].records.map(
      (p) => copied.frame.map(
        (row) => finite$7(row[0] * p[0] + row[1] * p[1] + row[2] * p[2] + row[3])
      )
    );
    return prepareNativeSketchCircleRebuild(points, previous.frame);
  }
  function prepareNativeSketchCircleRadiusEdit(input, previous) {
    if (typeof input !== "number" || !Number.isFinite(input))
      throw new Error("Circle radius must be finite.");
    let radius = input < 0 ? -input : input;
    if (radius < 2 ** -23) radius = 0.01;
    const copied = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: previous.frame,
      children: [
        { id: "points", kind: "circle", records: previous.sourceRecords }
      ]
    });
    const center = previous.backendRequest.center;
    const points = copied.children[0].records.slice(0, 3).map((point2, index) => {
      const delta = point2.map((value, i) => finite$7(value - center[i]));
      const squared = finite$7(
        delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]
      );
      const direction = index === 1 && squared < Number.EPSILON ? [0, 1, 0] : nativeReferenceNormalize(delta);
      return [
        finite$7(direction[0] * radius + center[0]),
        finite$7(direction[1] * radius + center[1]),
        finite$7(direction[2] * radius + center[2])
      ];
    });
    return {
      frame: copied.frame,
      sourceRecords: [points[0], points[1], points[2], [...center]],
      fitSucceeded: void 0,
      backendRequest: { kind: "circle", center: [...center], radius }
    };
  }
  function cancelled$1() {
    const error = new Error("Sketch child rebuild cancelled.");
    error.name = "AbortError";
    return error;
  }
  class SketchConicChild {
    #kind;
    #backend;
    #preparation;
    // The current edge may predate a failed fit. Preserve its own input rather
    // than reconstructing it from the latest preparation/source collection.
    #lastBackendRequest;
    #outcome;
    #disposed = false;
    constructor(kind2, backend) {
      if (kind2 !== "arc" && kind2 !== "circle")
        throw new Error("Unsupported conic child kind.");
      const initial = backend.snapshot();
      if (initial.disposed || initial.kind !== "empty")
        throw new Error("Conic child requires a fresh empty backend.");
      this.#kind = kind2;
      this.#backend = backend;
    }
    #requireLive() {
      if (this.#disposed) throw new Error("Sketch conic child is disposed.");
    }
    /** Borrowed inside this worker only. Never publish the native handle. */
    get edge() {
      this.#requireLive();
      return this.#backend.edge;
    }
    snapshot() {
      const backend = this.#backend.snapshot();
      const preparation = this.#preparation;
      const radius = preparation && ("radius" in preparation ? preparation.radius : preparation.backendRequest.radius);
      const validity = this.#disposed ? "invalid" : radius === void 0 ? "uninitialized" : radius > 0 && backend.kind !== "empty" && backend.records.length > 0 ? "valid" : "invalid";
      return structuredClone({
        kind: this.#kind,
        disposed: this.#disposed,
        preparation,
        outcome: this.#outcome,
        backend,
        validity
      });
    }
    /**
     * Application staging copy with independent kernel ownership. This preserves
     * the latest source/diagnostic state AND a possibly older retained edge. It is
     * not a native clone operation or a persisted/public editor transaction.
     * The factory must return a fresh empty backend owned by this new child.
     */
    fork(createBackend, signal) {
      this.#requireLive();
      if (signal?.aborted) throw cancelled$1();
      const backend = createBackend();
      if (backend === this.#backend)
        throw new Error("A staged copy requires an independent backend.");
      const copy = new SketchConicChild(this.#kind, backend);
      try {
        if (signal?.aborted) throw cancelled$1();
        if (this.#backend.snapshot().kind !== "empty") {
          if (!this.#lastBackendRequest)
            throw new Error("Cannot restore child backend without its input.");
          const request = structuredClone(this.#lastBackendRequest);
          if (!backend.rebuild(request))
            throw new Error("Cannot restore child backend geometry.");
          copy.#lastBackendRequest = request;
        }
        if (signal?.aborted) throw cancelled$1();
        copy.#preparation = structuredClone(this.#preparation);
        copy.#outcome = structuredClone(this.#outcome);
        return copy;
      } catch (error) {
        copy.dispose();
        throw error;
      }
    }
    rebuild(input, signal) {
      this.#requireLive();
      if (signal?.aborted) throw cancelled$1();
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("Invalid conic rebuild request.");
      const request = input;
      const fields = this.#kind === "arc" ? ["kind", "points", "frame", "close"] : ["kind", "points", "frame"];
      if (request.kind !== this.#kind || Object.keys(request).some((key) => !fields.includes(key)))
        throw new Error("Invalid conic rebuild kind or field.");
      let preparation;
      if (this.#kind === "arc") {
        const prior = this.#preparation;
        preparation = prepareNativeSketchArcRebuild(
          request.points,
          request.frame,
          {
            // Constructor/allocator evidence does not establish an initial radius.
            // Preserve that uncertainty rather than inventing a numerical value.
            radius: prior?.radius,
            closed: prior?.closed ?? false,
            sourceRecords: prior?.sourceRecords ?? []
          },
          request.close
        );
      } else
        preparation = prepareNativeSketchCircleRebuild(
          request.points,
          request.frame
        );
      return this.#applyPreparation(preparation, signal);
    }
    /** Native local record replacement; distinct from rebuilding or point edits. */
    replaceLocalArcRecords(records2, signal) {
      this.#requireLive();
      if (signal?.aborted) throw cancelled$1();
      if (this.#kind !== "arc")
        throw new Error("Local arc record replacement requires an arc child.");
      if (!this.#preparation)
        throw new Error(
          "Local arc record replacement requires a prepared child."
        );
      const { preparation } = prepareNativeSketchArcLocalReplacement(
        records2,
        this.#preparation
      );
      return this.#applyPreparation(preparation, signal);
    }
    /** Replace world records using the explicitly supplied comparison frame. */
    replacePlacedArcRecords(records2, frame2, signal) {
      this.#requireLive();
      if (signal?.aborted) throw cancelled$1();
      if (this.#kind !== "arc")
        throw new Error("Placed arc record replacement requires an arc child.");
      if (!this.#preparation)
        throw new Error(
          "Placed arc record replacement requires a prepared child."
        );
      const { preparation } = prepareNativeSketchArcPlacedReplacement(
        records2,
        frame2,
        this.#preparation
      );
      return this.#applyPreparation(preparation, signal);
    }
    /** Edit a local defining point (0..2) or translate the center in XY (3). */
    editArcPoint(index, point2, signal) {
      this.#requireLive();
      if (signal?.aborted) throw cancelled$1();
      if (this.#kind !== "arc")
        throw new Error("Arc point editing requires an arc child.");
      if (!this.#preparation)
        throw new Error("Arc point editing requires a prepared child.");
      const { preparation } = prepareNativeSketchArcPointEdit(
        index,
        point2,
        this.#preparation
      );
      return this.#applyPreparation(preparation, signal);
    }
    /** Transform internal local points and refit; stored placement is unchanged. */
    transformArcLocalPoints(transform, signal) {
      this.#requireLive();
      if (signal?.aborted) throw cancelled$1();
      if (this.#kind !== "arc")
        throw new Error("Local arc transformation requires an arc child.");
      if (!this.#preparation)
        throw new Error("Local arc transformation requires a prepared child.");
      const preparation = prepareNativeSketchArcTransform(
        transform,
        this.#preparation
      );
      return this.#applyPreparation(preparation, signal);
    }
    /** Refit first three local records with the child's existing closure flag. */
    rebuildArcRecords(records2, signal) {
      this.#requireLive();
      if (signal?.aborted) throw cancelled$1();
      if (this.#kind !== "arc")
        throw new Error("Arc collection rebuilding requires an arc child.");
      if (!this.#preparation)
        throw new Error("Arc collection rebuilding requires a prepared child.");
      const preparation = prepareNativeSketchArcCollectionRebuild(
        records2,
        this.#preparation
      );
      return this.#applyPreparation(preparation, signal);
    }
    /** Circle defining-point refit or center translation without refitting. */
    editCirclePoint(index, point2, signal) {
      this.#requireLive();
      if (signal?.aborted) throw cancelled$1();
      if (this.#kind !== "circle")
        throw new Error("Circle point editing requires a circle child.");
      if (!this.#preparation)
        throw new Error("Circle point editing requires a prepared child.");
      return this.#applyPreparation(
        prepareNativeSketchCirclePointEdit(
          index,
          point2,
          this.#preparation
        ),
        signal
      );
    }
    /** Refit transformed circle defining points with stored placement. */
    transformCircleLocalPoints(transform, signal) {
      this.#requireLive();
      if (signal?.aborted) throw cancelled$1();
      if (this.#kind !== "circle")
        throw new Error("Local circle transformation requires a circle child.");
      if (!this.#preparation)
        throw new Error("Local circle transformation requires a prepared child.");
      return this.#applyPreparation(
        prepareNativeSketchCircleTransform(
          transform,
          this.#preparation
        ),
        signal
      );
    }
    /** Resize around the retained center without a three-point fit. */
    editCircleRadius(radius, signal) {
      this.#requireLive();
      if (signal?.aborted) throw cancelled$1();
      if (this.#kind !== "circle")
        throw new Error("Circle radius editing requires a circle child.");
      if (!this.#preparation)
        throw new Error("Circle radius editing requires a prepared child.");
      return this.#applyPreparation(
        prepareNativeSketchCircleRadiusEdit(
          radius,
          this.#preparation
        ),
        signal
      );
    }
    /** Replace local records, permitting XYZ center translation without fitting. */
    replaceLocalCircleRecords(records2, signal) {
      this.#requireLive();
      if (signal?.aborted) throw cancelled$1();
      if (this.#kind !== "circle")
        throw new Error("Local circle replacement requires a circle child.");
      if (!this.#preparation)
        throw new Error("Local circle replacement requires a prepared child.");
      const { preparation } = prepareNativeSketchCircleLocalReplacement(
        records2,
        this.#preparation
      );
      return this.#applyPreparation(preparation, signal);
    }
    /** Always fit the first three collection records with stored placement. */
    rebuildCircleRecords(records2, signal) {
      this.#requireLive();
      if (signal?.aborted) throw cancelled$1();
      if (this.#kind !== "circle")
        throw new Error("Circle collection rebuild requires a circle child.");
      if (!this.#preparation)
        throw new Error("Circle collection rebuild requires a prepared child.");
      return this.#applyPreparation(
        prepareNativeSketchCircleCollectionRebuild(
          records2,
          this.#preparation
        ),
        signal
      );
    }
    /** Replace world records using an explicitly supplied comparison placement. */
    replacePlacedCircleRecords(records2, frame2, signal) {
      this.#requireLive();
      if (signal?.aborted) throw cancelled$1();
      if (this.#kind !== "circle")
        throw new Error("Placed circle replacement requires a circle child.");
      if (!this.#preparation)
        throw new Error("Placed circle replacement requires a prepared child.");
      const { preparation } = prepareNativeSketchCirclePlacedReplacement(
        records2,
        frame2,
        this.#preparation
      );
      return this.#applyPreparation(preparation, signal);
    }
    #applyPreparation(preparation, signal) {
      if (signal?.aborted) throw cancelled$1();
      this.#preparation = preparation;
      const outcome = {
        backendAttempted: false,
        backendSucceeded: void 0,
        builderSucceeded: false,
        error: void 0
      };
      this.#outcome = outcome;
      try {
        if (preparation.backendRequest) {
          outcome.backendAttempted = true;
          outcome.backendSucceeded = this.#backend.rebuild(
            preparation.backendRequest
          );
          if (outcome.backendSucceeded)
            this.#lastBackendRequest = structuredClone(
              preparation.backendRequest
            );
          outcome.builderSucceeded = outcome.backendSucceeded;
        }
      } catch (error) {
        outcome.backendSucceeded = false;
        outcome.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        if (signal?.aborted) {
          this.dispose();
          throw cancelled$1();
        }
      }
      return this.snapshot();
    }
    dispose() {
      if (this.#disposed) return;
      this.#disposed = true;
      try {
        this.#backend.dispose();
      } finally {
        this.#preparation = void 0;
        this.#lastBackendRequest = void 0;
        this.#outcome = void 0;
      }
    }
  }
  const owners = /* @__PURE__ */ new WeakMap();
  class SketchChildCollection {
    #base;
    #entries = [];
    #disposed = false;
    #revision = 0;
    #pending;
    constructor(id, frame2) {
      this.#base = copySketchSourceRecordStore({
        version: 1,
        id,
        frame: frame2,
        children: []
      });
    }
    #requireLive() {
      if (this.#disposed) throw new Error("Sketch child collection is disposed.");
    }
    #snapshot(entries) {
      if (entries.length > SKETCH_SOURCE_LIMITS.children)
        throw new Error("Sketch source child budget exceeded.");
      const children2 = entries.map(({ id, child }) => {
        const state = child.snapshot();
        if (state.disposed)
          throw new Error("Cannot use a disposed sketch child.");
        if (state.preparation)
          copySketchSourceRecordStore({
            version: 1,
            id: "",
            frame: state.preparation.frame,
            children: []
          });
        return { id, state };
      });
      const sources = copySketchSourceRecordStore({
        ...this.#base,
        children: children2.map(({ id, state }) => ({
          id,
          kind: state.kind,
          records: state.preparation?.sourceRecords
        }))
      });
      return { sources, children: structuredClone(children2) };
    }
    snapshot() {
      this.#requireLive();
      return this.#snapshot(this.#entries);
    }
    get revision() {
      this.#requireLive();
      return this.#revision;
    }
    #prepareSplice(index, deleteCount, inserted, stageOwner) {
      this.#requireLive();
      if (!Number.isSafeInteger(index) || !Number.isSafeInteger(deleteCount) || index < 0 || deleteCount < 0 || index > this.#entries.length || deleteCount > this.#entries.length - index || !Array.isArray(inserted))
        throw new Error("Invalid sketch child replacement range.");
      const seen = /* @__PURE__ */ new Set();
      for (const { child } of inserted) {
        if (owners.has(child) && owners.get(child) !== stageOwner || seen.has(child))
          throw new Error("Sketch child is already owned or repeated.");
        seen.add(child);
      }
      const incoming = inserted.map(({ id, child }) => ({ id, child }));
      const next = [
        ...this.#entries.slice(0, index),
        ...incoming,
        ...this.#entries.slice(index + deleteCount)
      ];
      const preview = this.#snapshot(next);
      return { incoming, next, preview };
    }
    #commitSplice(index, deleteCount, incoming, next) {
      const retired = this.#entries.slice(index, index + deleteCount);
      for (const { child } of retired) owners.delete(child);
      for (const { child } of incoming) owners.set(child, this);
      this.#entries = next;
      this.#revision++;
      return retired;
    }
    splice(index, deleteCount, inserted) {
      const { incoming, next } = this.#prepareSplice(
        index,
        deleteCount,
        inserted
      );
      return this.#commitSplice(index, deleteCount, incoming, next);
    }
    /**
     * Takes ownership of independent, already prepared candidates on admission.
     * One pending replacement bounds retained staging to one additional document.
     * Cancellation is checked at call boundaries, never by reentrant disposal.
     * This worker-local revision is not a public editor/session revision.
     */
    stageSplice(index, deleteCount, inserted, signal) {
      this.#requireLive();
      if (this.#pending)
        throw new Error("Sketch child collection already has a pending edit.");
      const requireNotAborted = () => {
        if (signal?.aborted) {
          const error = new Error("Sketch edit aborted.");
          error.name = "AbortError";
          throw error;
        }
      };
      requireNotAborted();
      const { incoming } = this.#prepareSplice(index, deleteCount, inserted);
      requireNotAborted();
      const revision = this.#revision, token = {};
      let closed = false;
      const close = () => {
        closed = true;
        this.#pending = void 0;
      };
      const discard = () => {
        if (closed) return;
        close();
        const errors = [];
        for (const { child } of incoming) {
          owners.delete(child);
          try {
            child.dispose();
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length)
          throw new AggregateError(errors, "Staged sketch child cleanup failed.");
      };
      const checked = (action) => {
        if (closed) throw new Error("Sketch edit is closed.");
        try {
          this.#requireLive();
          requireNotAborted();
          if (this.#revision !== revision)
            throw new Error("Sketch edit is stale.");
          return action();
        } catch (error) {
          try {
            discard();
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Sketch edit and cleanup failed."
            );
          }
          throw error;
        }
      };
      const stage = {
        snapshot: () => checked(() => {
          return this.#prepareSplice(index, deleteCount, incoming, token).preview;
        }),
        accept: () => checked(() => {
          const { next } = this.#prepareSplice(
            index,
            deleteCount,
            incoming,
            token
          );
          requireNotAborted();
          const retired = this.#commitSplice(
            index,
            deleteCount,
            incoming,
            next
          );
          close();
          return retired;
        }),
        discard
      };
      for (const { child } of incoming) owners.set(child, token);
      this.#pending = stage;
      return stage;
    }
    reorder(ids) {
      this.#requireLive();
      const byId = new Map(this.#entries.map((entry) => [entry.id, entry]));
      if (!Array.isArray(ids) || ids.length !== this.#entries.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id)))
        throw new Error(
          "Sketch order must be an exact child identity permutation."
        );
      this.#entries = ids.map((id) => byId.get(id));
      this.#revision++;
    }
    /** Copier owns any allocations it makes before throwing or returning. */
    fork(copyChild) {
      this.#requireLive();
      const result = new SketchChildCollection(
        this.#base.id,
        this.#base.frame
      );
      const copies = [];
      const seen = /* @__PURE__ */ new Set();
      try {
        for (const { id, child } of this.#entries) {
          const copy = copyChild(child, id);
          if (owners.has(copy) || seen.has(copy))
            throw new Error("Copy must be independently owned.");
          seen.add(copy);
          copies.push({ id, child: copy });
        }
        result.splice(0, 0, copies);
        result.#revision = this.#revision;
        return result;
      } catch (error) {
        const errors = [error];
        for (const { child } of copies)
          try {
            child.dispose();
          } catch (cleanupError) {
            errors.push(cleanupError);
          }
        result.dispose();
        if (errors.length > 1)
          throw new AggregateError(errors, "Sketch copy and cleanup failed.");
        throw error;
      }
    }
    dispose() {
      if (this.#disposed) return;
      this.#disposed = true;
      const retired = this.#entries;
      this.#entries = [];
      const errors = [];
      try {
        this.#pending?.discard();
      } catch (error) {
        errors.push(error);
      }
      for (const { child } of retired) {
        owners.delete(child);
        try {
          child.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(errors, "Sketch child cleanup failed.");
    }
  }
  function point$4(value) {
    if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n)))
      throw new Error("Ellipse backend requires finite XYZ values.");
    return [value[0], value[1], value[2]];
  }
  function finite$6(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error("Ellipse backend requires finite numbers.");
    return value;
  }
  class SketchEllipseBackend {
    #oc;
    #edge;
    #records = [];
    #request;
    #disposed = false;
    constructor(oc) {
      this.#oc = oc;
    }
    #requireLive() {
      if (this.#disposed) throw new Error("Sketch ellipse backend is disposed.");
    }
    #reset() {
      const old = this.#edge;
      this.#edge = void 0;
      this.#records = [];
      this.#request = void 0;
      old?.delete();
    }
    get edge() {
      this.#requireLive();
      return this.#edge;
    }
    snapshot() {
      return structuredClone({
        disposed: this.#disposed,
        kind: this.#edge ? "ellipse" : "empty",
        records: this.#records,
        request: this.#request
      });
    }
    rebuild(input) {
      this.#requireLive();
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("Invalid ellipse backend request.");
      const r = input;
      if (r.kind !== "ellipse" || Object.keys(r).some(
        (k) => !["kind", "center", "axis", "majorRadius", "minorRadius"].includes(k)
      ))
        throw new Error("Invalid ellipse backend request.");
      const request = {
        kind: "ellipse",
        center: point$4(r.center),
        axis: point$4(r.axis),
        majorRadius: finite$6(r.majorRadius),
        minorRadius: finite$6(r.minorRadius)
      };
      this.#reset();
      const {
        center: c,
        axis: a,
        majorRadius: major,
        minorRadius: minor
      } = request;
      const records2 = [
        [
          finite$6(c[0] - major * a[0]),
          finite$6(c[1] - major * a[1]),
          finite$6(c[2] - major * a[2])
        ],
        [
          finite$6(major * a[0] + c[0]),
          finite$6(major * a[1] + c[1]),
          finite$6(major * a[2] + c[2])
        ],
        [
          finite$6(-(a[1] * minor) + c[0]),
          finite$6(a[0] * minor + c[1]),
          finite$6(a[2] * minor + c[2])
        ],
        [
          finite$6(c[0] - -(a[1] * minor)),
          finite$6(c[1] - a[0] * minor),
          finite$6(c[2] - a[2] * minor)
        ]
      ];
      const oc = this.#oc, handles = [];
      const keep = (h) => (handles.push(h), h);
      let candidate;
      try {
        try {
          const center = keep(new oc.gp_Pnt_3(...c));
          const normal = keep(new oc.gp_Dir_4(0, 0, 1));
          const axis = keep(new oc.gp_Dir_4(...a));
          const placement = keep(new oc.gp_Ax2_2(center, normal, axis));
          const ellipse = keep(new oc.gp_Elips_2(placement, major, minor));
          const maker = keep(new oc.GC_MakeEllipse_1(ellipse));
          if (!maker.IsDone()) return false;
          const handle = keep(maker.Value());
          if (handle.IsNull()) return false;
          const curve = keep(new oc.Handle_Geom_Curve_2(handle.get()));
          const edgeMaker = keep(new oc.BRepBuilderAPI_MakeEdge_24(curve));
          if (!edgeMaker.IsDone()) return false;
          candidate = edgeMaker.Edge();
        } finally {
          for (let i = handles.length - 1; i >= 0; i--) handles[i].delete();
        }
        if (!candidate || candidate.IsNull()) return false;
        this.#edge = candidate;
        candidate = void 0;
        this.#records = records2;
        this.#request = request;
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
  function finite$5(n) {
    if (!Number.isFinite(n))
      throw new Error("Sketch ellipse arithmetic overflow.");
    return n;
  }
  function prepareNativeSketchEllipseCollectionRebuild(input, placement, previous) {
    if (!Array.isArray(input))
      throw new Error("Ellipse collection requires source records.");
    const source = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: placement,
      children: [{ id: "", kind: "ellipse", records: input }]
    });
    let geometry;
    if (previous) {
      const copy = copySketchSourceRecordStore({
        version: 1,
        id: "",
        frame: placement,
        children: [
          { id: "", kind: "ellipse", records: [previous.center, previous.axis] }
        ]
      });
      geometry = {
        center: copy.children[0].records[0],
        axis: copy.children[0].records[1],
        radius1: finite$5(previous.radius1),
        radius2: finite$5(previous.radius2)
      };
    }
    const records2 = source.children[0].records;
    const failed = (sourceRecords) => ({
      frame: source.frame,
      sourceRecords,
      geometry,
      fitSucceeded: false,
      backendRequest: void 0
    });
    if (records2.length < 3) return failed(records2);
    const [a, b, c] = records2.slice(0, 3).map((p) => [p[0], p[1], 0]);
    const ax = a[0] - b[0], ay = a[1] - b[1], az = a[2] - b[2];
    const diameter = Math.sqrt(finite$5(ax * ax + ay * ay + az * az));
    if (diameter < 1e-4) return failed([]);
    const center = [
      finite$5((a[0] + b[0]) * 0.5),
      finite$5((b[1] + a[1]) * 0.5),
      finite$5((a[2] + b[2]) * 0.5)
    ];
    const reciprocal = 1 / diameter;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const axis = [
      dx * reciprocal,
      dy * reciprocal,
      reciprocal * dz
    ];
    const radius1 = diameter * 0.5;
    const numerator = finite$5(
      (c[0] - a[0]) * dx + (c[1] - a[1]) * dy + (c[2] - a[2]) * dz
    );
    const fraction = finite$5(numerator / finite$5(dy * dy + dx * dx + dz * dz));
    const ex = finite$5(fraction * dx + a[0] - c[0]), ey = finite$5(fraction * dy + a[1] - c[1]), ez = finite$5(fraction * dz + a[2] - c[2]);
    const radius2 = Math.sqrt(finite$5(ex * ex + ey * ey + ez * ez));
    geometry = { center, axis, radius1, radius2 };
    return prepareFromGeometry(geometry, source.frame, true);
  }
  function prepareFromGeometry(geometry, frame2, fitSucceeded = void 0) {
    const { center, axis, radius1, radius2 } = geometry;
    const perpendicular = [-axis[1], axis[0], axis[2]];
    const minus = (direction, radius) => [
      finite$5(center[0] - radius * direction[0]),
      finite$5(center[1] - radius * direction[1]),
      finite$5(center[2] - radius * direction[2])
    ];
    const plus = (direction, radius) => [
      finite$5(radius * direction[0] + center[0]),
      finite$5(radius * direction[1] + center[1]),
      finite$5(radius * direction[2] + center[2])
    ];
    const swapped = radius1 < radius2;
    return {
      frame: frame2,
      geometry,
      fitSucceeded,
      sourceRecords: [
        minus(axis, radius1),
        plus(axis, radius1),
        plus(perpendicular, radius2),
        minus(perpendicular, radius2),
        [...center]
      ],
      backendRequest: {
        kind: "ellipse",
        center: [...center],
        axis: swapped ? [axis[1], -axis[0], axis[2]] : [...axis],
        majorRadius: swapped ? radius2 : radius1,
        minorRadius: swapped ? radius1 : radius2
      }
    };
  }
  function prepareNativeSketchEllipsePointEdit(index, target, previous) {
    if (!Number.isSafeInteger(index) || index < 0 || index > 4)
      throw new Error("Ellipse point index must be between zero and four.");
    const source = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: previous.frame,
      children: [
        { id: "old", kind: "ellipse", records: previous.sourceRecords },
        { id: "target", kind: "ellipse", records: [target] }
      ]
    });
    const geometry = prepareNativeSketchEllipseCollectionRebuild(
      [],
      source.frame,
      previous.geometry
    ).geometry;
    if (!geometry || !source.children[0].records?.[index])
      throw new Error(
        "Ellipse point edit requires retained geometry and the selected source record."
      );
    const p = source.children[1].records[0], old = source.children[0].records[index];
    const x = old[0] - p[0], y = old[1] - p[1], z = old[2] - p[2];
    const movement = Math.sqrt(
      finite$5(index === 3 ? y * y + x * x + z * z : x * x + y * y + z * z)
    );
    const unchanged = () => ({
      changed: false,
      preparation: structuredClone(previous)
    });
    if (!(movement > 2 ** -23)) return unchanged();
    if (index === 4) geometry.center = [...p];
    else {
      const negative = index === 0 || index === 2;
      const delta = (i) => finite$5(negative ? geometry.center[i] - p[i] : p[i] - geometry.center[i]);
      const dx = delta(0), dy = delta(1), dz = delta(2);
      const radius = Math.sqrt(
        finite$5(
          negative ? dx * dx + dy * dy + dz * dz : dy * dy + dx * dx + dz * dz
        )
      );
      if (radius < 1e-4) return unchanged();
      const direction = [dx / radius, dy / radius, dz / radius];
      if (index < 2) {
        geometry.axis = direction;
        geometry.radius1 = radius;
      } else {
        geometry.axis = [-direction[1], direction[0], direction[2]];
        geometry.radius2 = radius;
      }
    }
    return {
      changed: true,
      preparation: prepareFromGeometry(geometry, source.frame)
    };
  }
  function prepareNativeSketchEllipsePlacedReplacement(input, placement, previous) {
    if (!Array.isArray(input))
      throw new Error("Placed ellipse replacement requires records.");
    const source = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: placement,
      children: [{ id: "", kind: "ellipse", records: input }]
    });
    const records2 = source.children[0].records, [a, b, c] = source.frame;
    const incomplete = records2.length < 3;
    const local = records2.slice(0, 3).map((p) => {
      const x = finite$5(p[0] - a[3]), y = finite$5(p[1] - b[3]), z = finite$5(p[2] - c[3]);
      return [
        finite$5(y * b[0] + x * a[0] + z * c[0]),
        finite$5(
          incomplete ? x * a[1] + y * b[1] + z * c[1] : y * b[1] + x * a[1] + z * c[1]
        ),
        incomplete ? finite$5(y * b[2] + x * a[2] + z * c[2]) : 0
      ];
    });
    const preparation = prepareNativeSketchEllipseCollectionRebuild(
      local,
      source.frame,
      previous.geometry
    );
    if (!preparation.fitSucceeded)
      preparation.frame = copySketchSourceRecordStore({
        version: 1,
        id: "",
        frame: previous.frame,
        children: []
      }).frame;
    return preparation;
  }
  function abort$1(signal) {
    if (signal?.aborted) {
      const e = new Error("Sketch ellipse operation aborted.");
      e.name = "AbortError";
      throw e;
    }
  }
  class SketchEllipseChild {
    #frame;
    #backend;
    #preparation;
    #outcome;
    #lastBackendRequest;
    #disposed = false;
    constructor(frame2, backend) {
      this.#frame = copySketchSourceRecordStore({
        version: 1,
        id: "",
        frame: frame2,
        children: []
      }).frame;
      const initial = backend.snapshot();
      if (initial.disposed || initial.kind !== "empty")
        throw new Error("Ellipse child requires a fresh empty backend.");
      this.#backend = backend;
    }
    #requireLive() {
      if (this.#disposed) throw new Error("Sketch ellipse child is disposed.");
    }
    get edge() {
      this.#requireLive();
      return this.#backend.edge;
    }
    snapshot() {
      return structuredClone({
        kind: "ellipse",
        disposed: this.#disposed,
        frame: this.#frame,
        preparation: this.#preparation,
        outcome: this.#outcome,
        backend: this.#backend.snapshot()
      });
    }
    rebuildRecords(records2, signal) {
      this.#requireLive();
      abort$1(signal);
      const preparation = prepareNativeSketchEllipseCollectionRebuild(
        records2,
        this.#frame,
        this.#preparation?.geometry
      );
      return this.#applyPreparation(preparation, signal);
    }
    editPoint(index, target, signal) {
      this.#requireLive();
      abort$1(signal);
      if (!this.#preparation)
        throw new Error("Ellipse point edit requires prepared geometry.");
      const result = prepareNativeSketchEllipsePointEdit(
        index,
        target,
        this.#preparation
      );
      abort$1(signal);
      if (result.changed)
        return this.#applyPreparation(result.preparation, signal);
      this.#outcome = {
        backendAttempted: false,
        backendSucceeded: void 0,
        builderSucceeded: false,
        error: void 0
      };
      return structuredClone(this.#outcome);
    }
    replacePlacedRecords(records2, placement, signal) {
      this.#requireLive();
      abort$1(signal);
      const previous = this.#preparation ?? prepareNativeSketchEllipseCollectionRebuild([], this.#frame);
      return this.#applyPreparation(
        prepareNativeSketchEllipsePlacedReplacement(records2, placement, previous),
        signal
      );
    }
    #applyPreparation(preparation, signal) {
      abort$1(signal);
      this.#preparation = preparation;
      this.#frame = preparation.frame;
      const outcome = {
        backendAttempted: false,
        backendSucceeded: void 0,
        builderSucceeded: false,
        error: void 0
      };
      this.#outcome = outcome;
      try {
        if (preparation.backendRequest) {
          outcome.backendAttempted = true;
          outcome.backendSucceeded = this.#backend.rebuild(
            preparation.backendRequest
          );
          outcome.builderSucceeded = outcome.backendSucceeded;
          if (outcome.backendSucceeded)
            this.#lastBackendRequest = structuredClone(
              preparation.backendRequest
            );
        }
        return structuredClone(outcome);
      } catch (error) {
        outcome.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        if (signal?.aborted) {
          this.dispose();
          abort$1(signal);
        }
      }
    }
    fork(createBackend, signal) {
      this.#requireLive();
      abort$1(signal);
      const backend = createBackend();
      if (backend === this.#backend)
        throw new Error("A staged copy requires an independent backend.");
      const copy = new SketchEllipseChild(this.#frame, backend);
      try {
        abort$1(signal);
        if (this.#backend.snapshot().kind !== "empty") {
          if (!this.#lastBackendRequest)
            throw new Error("Cannot restore ellipse backend without its input.");
          const request = structuredClone(this.#lastBackendRequest);
          if (!backend.rebuild(request))
            throw new Error("Cannot restore ellipse backend geometry.");
          copy.#lastBackendRequest = request;
        }
        abort$1(signal);
        copy.#preparation = structuredClone(this.#preparation);
        copy.#outcome = structuredClone(this.#outcome);
        return copy;
      } catch (error) {
        copy.dispose();
        throw error;
      }
    }
    dispose() {
      if (this.#disposed) return;
      this.#disposed = true;
      this.#preparation = void 0;
      this.#outcome = void 0;
      this.#lastBackendRequest = void 0;
      this.#backend.dispose();
    }
  }
  function resolveNativeSketchWireValidation(input) {
    const invalid = () => new Error("Invalid native wire validation result.");
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw invalid();
    const r = input;
    if (r.initialStatus !== 0 && r.initialStatus !== 6 || typeof r.generalStatus !== "number" || !Number.isInteger(r.generalStatus) || r.generalStatus < -2147483648 || r.generalStatus > 2147483647)
      throw invalid();
    const passed = r.generalStatus === 1;
    const field = passed ? "boundsPassed" : "promoteRetainedStatus";
    if (Object.keys(r).length !== 3 || Object.keys(r).some(
      (k) => k !== "initialStatus" && k !== "generalStatus" && k !== field
    ) || typeof r[field] !== "boolean")
      throw invalid();
    let status = r.initialStatus;
    if (passed) {
      if (!r.boundsPassed) status = 4;
    } else {
      if (r.generalStatus === 5 || r.generalStatus === 6) status = 5;
      else if (r.generalStatus === 13) status = 7;
      else if (status === 0) status = 4;
      if (r.promoteRetainedStatus && status === 6) status = 4;
    }
    return { status, retainCandidate: status === 0 || status === 6 };
  }
  function requireSketchLineCoordinateScale(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
      throw new Error(
        "Line conversion requires an explicit finite positive coordinate scale."
      );
    return value;
  }
  function point$3(value) {
    if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n)))
      throw new Error("Line conversion requires finite XYZ evaluated points.");
    return [value[0], value[1], value[2]];
  }
  function finite$4(value) {
    if (!Number.isFinite(value))
      throw new Error("Line conversion arithmetic overflow.");
    return value;
  }
  function evaluateNativeSketchLinePoint(origin, preparedDirection, parameter) {
    const o = point$3(origin), d = point$3(preparedDirection);
    if (d.every((n) => n === 0))
      throw new Error("Line evaluation requires a nonzero prepared direction.");
    if (typeof parameter !== "number" || !Number.isFinite(parameter) || parameter === -314158e8)
      throw new Error(
        "Line evaluation requires an explicit finite, set parameter."
      );
    return [
      finite$4(d[0] * parameter + o[0]),
      finite$4(d[1] * parameter + o[1]),
      finite$4(d[2] * parameter + o[2])
    ];
  }
  function length([x, y, z]) {
    return Math.sqrt(finite$4(x * x + y * y + z * z));
  }
  function normalize(value) {
    const magnitude = length(value);
    if (magnitude < Number.EPSILON) return value;
    const reciprocal = 1 / magnitude;
    return [value[0] * reciprocal, value[1] * reciprocal, value[2] * reciprocal];
  }
  function prepareNativeSketchLineConversion(evaluatedFirst, evaluatedLast, coordinateScale) {
    const scale = requireSketchLineCoordinateScale(coordinateScale);
    const first = point$3(evaluatedFirst), last = point$3(evaluatedLast);
    const delta = [
      last[0] - first[0],
      last[1] - first[1],
      last[2] - first[2]
    ];
    const sourceLength = length(delta);
    if (sourceLength < 1e-8) return void 0;
    const direction = normalize(normalize(delta));
    return {
      origin: [
        finite$4(first[0] * scale),
        finite$4(first[1] * scale),
        finite$4(first[2] * scale)
      ],
      direction,
      interval: [0, finite$4(sourceLength * scale)]
    };
  }
  function record(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid line wire candidate record.");
    const r = value;
    if (Object.keys(r).some((key) => !keys.includes(key)))
      throw new Error("Invalid line wire candidate field.");
    return r;
  }
  function point$2(value) {
    if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n)))
      throw new Error("Line wire candidate requires finite XYZ points.");
    return [value[0], value[1], value[2]];
  }
  function requireNativeSketchLinePreparedEndpoints(value) {
    const r = record(value, ["conversion", "start", "end"]);
    const c = record(r.conversion, ["origin", "direction", "interval"]);
    if (!Array.isArray(c.interval) || c.interval.length !== 2 || !Array.from(c.interval).every(
      (n) => typeof n === "number" && Number.isFinite(n)
    ))
      throw new Error(
        "Line wire candidate requires a finite parameter interval."
      );
    const conversion = {
      origin: point$2(c.origin),
      direction: point$2(c.direction),
      interval: [c.interval[0], c.interval[1]]
    };
    const start = point$2(r.start), end = point$2(r.end);
    for (const [actual, parameter] of [
      [start, conversion.interval[0]],
      [end, conversion.interval[1]]
    ]) {
      const expected = evaluateNativeSketchLinePoint(
        conversion.origin,
        conversion.direction,
        parameter
      );
      if (actual.some((n, axis) => !Object.is(n, expected[axis])))
        throw new Error(
          "Line wire candidate endpoints do not match prepared evaluation."
        );
    }
    return { conversion, start, end };
  }
  function point$1(value) {
    if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every(
      (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)
    ))
      throw new Error("Wire self-connection requires finite XYZ points.");
    return [value[0], value[1], value[2]];
  }
  function distanceSquared(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    const value = dy * dy + dx * dx + dz * dz;
    if (!Number.isFinite(value))
      throw new Error("Wire self-connection arithmetic overflow.");
    return value;
  }
  function checkNativeSketchWireSelfConnection(start, end, squaredThreshold, sample) {
    const a = point$1(start), b = point$1(end);
    if (typeof squaredThreshold !== "number" || !Number.isFinite(squaredThreshold) || squaredThreshold < 0)
      throw new Error(
        "Wire self-connection requires a finite nonnegative squared threshold."
      );
    if (typeof sample !== "function")
      throw new Error(
        "Wire self-connection requires an explicit witness sampler."
      );
    const endpointDistanceSquared = distanceSquared(a, b);
    const result = {
      candidate: false,
      squaredThreshold,
      endpointDistanceSquared,
      endpoints: { start: a, end: b }
    };
    if (!(endpointDistanceSquared < squaredThreshold)) return result;
    result.witness = point$1(sample());
    result.startWitnessDistanceSquared = distanceSquared(a, result.witness);
    if (!(result.startWitnessDistanceSquared > squaredThreshold)) return result;
    result.endWitnessDistanceSquared = distanceSquared(b, result.witness);
    result.candidate = result.endWitnessDistanceSquared > squaredThreshold;
    return result;
  }
  function checkNativeSketchLineSelfConnection(input, squaredThreshold) {
    const { start, end, conversion } = requireNativeSketchLinePreparedEndpoints(input);
    let witnessParameter;
    const result = checkNativeSketchWireSelfConnection(
      start,
      end,
      squaredThreshold,
      () => {
        if (start[0] === -314158e8 || end[0] === -314158e8)
          throw new Error(
            "Line self-connection witness has unset endpoint coordinates."
          );
        const parameter = (conversion.interval[1] + conversion.interval[0]) * 0.5;
        const witness = evaluateNativeSketchLinePoint(
          conversion.origin,
          conversion.direction,
          parameter
        );
        witnessParameter = parameter;
        return witness;
      }
    );
    return {
      ...result,
      ...witnessParameter === void 0 ? {} : { witnessParameter }
    };
  }
  function checkNativeSketchLineInputInterval(firstParameter, lastParameter, parameterZeroThreshold) {
    if (typeof firstParameter !== "number" || !Number.isFinite(firstParameter) || typeof lastParameter !== "number" || !Number.isFinite(lastParameter) || firstParameter === -314158e8 || lastParameter === -314158e8)
      throw new Error("Line input interval requires known finite parameters.");
    if (typeof parameterZeroThreshold !== "number" || !Number.isFinite(parameterZeroThreshold) || parameterZeroThreshold < 0)
      throw new Error(
        "Line input interval requires an explicit finite nonnegative parameter threshold."
      );
    const firstMinusLast = finite$3(firstParameter - lastParameter);
    const separated = Math.abs(firstMinusLast) > parameterZeroThreshold;
    const forward = firstMinusLast < 0;
    const usable = separated && forward;
    return {
      firstMinusLast,
      separated,
      forward,
      usable,
      nativeRangeStatus: usable ? 0 : 3
    };
  }
  function checkNativeSketchLineParameterOrder(firstParameter, lastParameter, forward) {
    if (typeof firstParameter !== "number" || !Number.isFinite(firstParameter) || typeof lastParameter !== "number" || !Number.isFinite(lastParameter))
      throw new Error("Line order requires finite endpoint parameters.");
    const orientedSpan = finite$3(
      (lastParameter - firstParameter) * 1
    );
    return { orientedSpan, ordered: orientedSpan > 0 };
  }
  function xyz(value) {
    if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n)))
      throw new Error("Line projection requires finite XYZ vectors.");
    return [value[0], value[1], value[2]];
  }
  function finite$3(value) {
    if (!Number.isFinite(value))
      throw new Error("Line projection arithmetic overflow.");
    return value;
  }
  function projectNativeSketchLinePoint(point2, origin, preparedDirection, effectiveTolerance, deltaZeroThreshold) {
    const p = xyz(point2), o = xyz(origin), d = xyz(preparedDirection);
    if (d.every((n) => n === 0))
      throw new Error(
        "Line projection requires a nonzero prepared XYZ direction."
      );
    if (typeof effectiveTolerance !== "number" || !Number.isFinite(effectiveTolerance))
      throw new Error("Line projection requires an explicit finite tolerance.");
    if (typeof deltaZeroThreshold !== "number" || !Number.isFinite(deltaZeroThreshold) || deltaZeroThreshold < 0)
      throw new Error(
        "Line projection requires an explicit finite nonnegative zero threshold."
      );
    if (effectiveTolerance <= 0) return void 0;
    const parameter = finite$3(
      (p[1] - o[1]) * d[1] + (p[0] - o[0]) * d[0] + (p[2] - o[2]) * d[2]
    );
    const projected = [
      finite$3(d[0] * parameter + o[0]),
      finite$3(d[1] * parameter + o[1]),
      finite$3(d[2] * parameter + o[2])
    ];
    const residual = (axis) => {
      const value = finite$3(p[axis] - projected[axis]);
      return Math.abs(value) < deltaZeroThreshold ? 0 : value;
    };
    const dx = residual(0), dy = residual(1), dz = residual(2);
    const distanceSquared2 = finite$3(dy * dy + dx * dx + dz * dz);
    const toleranceSquared = finite$3(effectiveTolerance * effectiveTolerance);
    return distanceSquared2 <= toleranceSquared ? { point: projected, parameter } : void 0;
  }
  function createPreparedSketchDirection(oc, coordinates) {
    const squared = coordinates.reduce((sum, value) => sum + value * value, 0);
    if (!Number.isFinite(squared) || Math.abs(squared - 1) > 32 * Number.EPSILON)
      throw new Error("Line direction must be prepared near unit length.");
    const direction = new oc.gp_Dir_4(...coordinates);
    try {
      const actual = [direction.X(), direction.Y(), direction.Z()];
      if (actual.every((value, axis) => Object.is(value, coordinates[axis])))
        return direction;
      const heap = oc.HEAPF64;
      const pointer = direction.$$?.ptr;
      if (!ArrayBuffer.isView(heap) || Object.prototype.toString.call(heap) !== "[object Float64Array]" || direction.$$?.ptrType?.name !== "gp_Dir_4*" || !Number.isSafeInteger(pointer) || pointer <= 0 || pointer % 8 !== 0 || pointer / 8 + 3 > heap.length)
        throw new Error("Unsupported prepared line direction kernel binding.");
      const values = heap;
      const offset = pointer / 8;
      if (!actual.every((value, axis) => Object.is(value, values[offset + axis])))
        throw new Error("Prepared line direction kernel layout mismatch.");
      values.set(coordinates, offset);
      try {
        const retained = [direction.X(), direction.Y(), direction.Z()];
        if (!retained.every((value, axis) => Object.is(value, coordinates[axis])))
          throw new Error("Prepared line direction kernel readback mismatch.");
      } catch (error) {
        try {
          values.set(actual, offset);
        } catch (rollback) {
          throw new AggregateError(
            [error, rollback],
            "Prepared direction rollback failed."
          );
        }
        throw error;
      }
      return direction;
    } catch (error) {
      try {
        direction.delete();
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          "Prepared direction cleanup failed."
        );
      }
      throw error;
    }
  }
  function resolveNativeSketchLineAttachment(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Line attachment requires an explicit result record.");
    const record2 = input;
    if (Object.keys(record2).some((key) => key !== "stage" && key !== "status"))
      throw new Error("Unsupported line attachment result field.");
    const { stage, status: value } = record2;
    if (stage !== "start-point" && stage !== "end-point" && stage !== "edge-range" && stage !== "edge-curve")
      throw new Error("Unsupported line attachment stage.");
    if (typeof value !== "number" || !Number.isInteger(value) || value < -2147483648 || value > 2147483647)
      throw new Error("Line attachment status must be a signed 32-bit integer.");
    const status = value | 0;
    const continues = status === 1 || stage === "edge-range" && status === 5;
    return {
      stage,
      status,
      continues,
      ...continues ? {} : {
        wireStatus: stage === "edge-curve" && status === 5 ? 1 : 4
      }
    };
  }
  function vertex(value, defaultTolerance) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Wire separation requires vertex records.");
    const record2 = value;
    if (Object.keys(record2).some((key) => key !== "point" && key !== "tolerance"))
      throw new Error("Invalid wire separation vertex record.");
    if (!Array.isArray(record2.point) || record2.point.length !== 3 || !Array.from(record2.point).every(
      (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)
    ))
      throw new Error("Wire separation requires finite XYZ points.");
    const tolerance = record2.tolerance === void 0 ? defaultTolerance : record2.tolerance;
    if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0)
      throw new Error("Wire vertex tolerance must be finite and nonnegative.");
    const point2 = [
      record2.point[0],
      record2.point[1],
      record2.point[2]
    ];
    return { point: point2, tolerance };
  }
  function finite$2(value) {
    if (!Number.isFinite(value))
      throw new Error("Wire vertex separation arithmetic overflow.");
    return value;
  }
  function checkNativeSketchWireVertexSeparation(first, second, defaultResolution) {
    return compare(first, second, defaultResolution, 0);
  }
  function checkNativeSketchDistinctEdgeVertexSeparation(first, second, defaultResolution, deltaZeroThreshold) {
    if (typeof deltaZeroThreshold !== "number" || !Number.isFinite(deltaZeroThreshold) || deltaZeroThreshold < 0)
      throw new Error(
        "Edge separation requires an explicit finite nonnegative zero threshold."
      );
    return compare(first, second, defaultResolution, deltaZeroThreshold);
  }
  function compare(first, second, defaultResolution, deltaZeroThreshold) {
    if (typeof defaultResolution !== "number" || !Number.isFinite(defaultResolution) || defaultResolution <= 0)
      throw new Error(
        "Wire separation requires an explicit finite positive resolution."
      );
    const a = vertex(first, defaultResolution * 0.5);
    const b = vertex(second, defaultResolution * 0.5);
    const delta = (axis) => {
      const value = a.point[axis] - b.point[axis];
      return Math.abs(value) < deltaZeroThreshold ? 0 : value;
    };
    const dx = delta(0);
    const dy = delta(1);
    const dz = delta(2);
    const distanceSquared2 = finite$2(dy * dy + dx * dx + dz * dz);
    const sum = b.tolerance + a.tolerance;
    const toleranceSquared = finite$2(sum * sum);
    return {
      tolerances: [a.tolerance, b.tolerance],
      distanceSquared: distanceSquared2,
      toleranceSquared,
      overlap: distanceSquared2 <= toleranceSquared
    };
  }
  function checkNativeSketchLineBoundsEnvelope(bounds, coordinateEnvelope, relativeTolerance) {
    if (typeof coordinateEnvelope !== "number" || !Number.isFinite(coordinateEnvelope) || coordinateEnvelope <= 0)
      throw new Error(
        "Line envelope requires an explicit finite positive coordinate envelope."
      );
    if (typeof relativeTolerance !== "number" || !Number.isFinite(relativeTolerance) || relativeTolerance < 0)
      throw new Error(
        "Line envelope requires an explicit finite nonnegative relative tolerance."
      );
    if (!bounds || typeof bounds !== "object" || Array.isArray(bounds))
      throw new Error("Line envelope requires a minimum/maximum bounds record.");
    const record2 = bounds;
    if (Object.keys(record2).some((key) => key !== "minimum" && key !== "maximum"))
      throw new Error("Line envelope bounds contain an unsupported field.");
    const minimum = vertexPoint(record2.minimum), maximum = vertexPoint(record2.maximum);
    if (minimum.some((n, axis) => n > maximum[axis]))
      throw new Error("Line envelope bounds must be ordered.");
    const halfExtent = coordinateEnvelope * 0.5;
    const axes = ["x", "y", "z"];
    for (const index of [0, 1, 2]) {
      for (const side of ["minimum", "maximum"]) {
        const coordinate = side === "minimum" ? minimum[index] : maximum[index];
        const boundary = side === "minimum" ? -halfExtent : halfExtent;
        const outside = side === "minimum" ? coordinate < boundary : coordinate > boundary;
        if (!outside) continue;
        const relativeDifference = Math.abs(1 - boundary / coordinate);
        if (relativeDifference > relativeTolerance)
          return {
            halfExtent,
            inside: false,
            failure: { axis: axes[index], side, coordinate, relativeDifference }
          };
      }
    }
    return { halfExtent, inside: true };
  }
  function vertexPoint(value) {
    if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n)))
      throw new Error("Line bounds require finite XYZ vertex points.");
    return [value[0], value[1], value[2]];
  }
  function prepareNativeSketchLineVertexBounds(firstPoint, lastPoint) {
    const first = vertexPoint(firstPoint), last = vertexPoint(lastPoint);
    if (first[0] === -314158e8) {
      return {
        minimum: [last[0], last[1], last[2]],
        maximum: [last[0], last[1], last[2]]
      };
    }
    return {
      minimum: [
        last[0] < first[0] ? last[0] : first[0],
        last[1] < first[1] ? last[1] : first[1],
        last[2] < first[2] ? last[2] : first[2]
      ],
      maximum: [
        last[0] > first[0] ? last[0] : first[0],
        last[1] > first[1] ? last[1] : first[1],
        last[2] > first[2] ? last[2] : first[2]
      ]
    };
  }
  function requireNativeSketchLineGeometrySettings(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Fresh line geometry settings must be an explicit record.");
    const record2 = value;
    const fields = [
      "linearResolution",
      "coordinateDeltaZeroThreshold",
      "endpointTolerance",
      "coordinateEnvelope",
      "relativeComparisonTolerance"
    ];
    if (Object.keys(record2).some(
      (key) => !fields.includes(key)
    ))
      throw new Error("Unsupported fresh line geometry setting.");
    const result = {};
    for (const key of fields) {
      const n = record2[key];
      if (typeof n !== "number" || !Number.isFinite(n) || (key === "linearResolution" || key === "coordinateEnvelope") && n <= 0 || (key === "coordinateDeltaZeroThreshold" || key === "relativeComparisonTolerance") && n < 0)
        throw new Error(`Invalid fresh line geometry setting: ${key}.`);
      result[key] = n;
    }
    return result;
  }
  function checkNativeSketchFreshLineGeometry(input, values) {
    const settings = requireNativeSketchLineGeometrySettings(values);
    const prepared = requireNativeSketchLinePreparedEndpoints(input);
    const { conversion, start, end } = prepared;
    const result = {
      passed: false,
      prepared,
      settings,
      vertexTolerance: settings.linearResolution * 0.5,
      results: {}
    };
    const reject = (stage) => {
      result.failureStage = stage;
      const paths = {
        "edge-vertices": { edgeStatus: 2, generalStatus: 3, wireStatus: 4 },
        "start-projection": { edgeStatus: 3, generalStatus: 12, wireStatus: 4 },
        "end-projection": { edgeStatus: 3, generalStatus: 12, wireStatus: 4 },
        "parameter-order": { edgeStatus: 4, generalStatus: 12, wireStatus: 4 },
        "wire-vertices": { generalStatus: 13, wireStatus: 7 },
        envelope: { generalStatus: 1, wireStatus: 4 }
      };
      result.nativeFailurePath = { ...paths[stage] };
      return result;
    };
    const edgeVertices = checkNativeSketchDistinctEdgeVertexSeparation(
      { point: end },
      { point: start },
      settings.linearResolution,
      settings.coordinateDeltaZeroThreshold
    );
    result.results.edgeVertices = edgeVertices;
    if (edgeVertices.overlap) return reject("edge-vertices");
    const startProjection = projectNativeSketchLinePoint(
      start,
      conversion.origin,
      conversion.direction,
      settings.endpointTolerance,
      settings.coordinateDeltaZeroThreshold
    );
    if (!startProjection) return reject("start-projection");
    result.results.startProjection = startProjection;
    const endProjection = projectNativeSketchLinePoint(
      end,
      conversion.origin,
      conversion.direction,
      settings.endpointTolerance,
      settings.coordinateDeltaZeroThreshold
    );
    if (!endProjection) return reject("end-projection");
    result.results.endProjection = endProjection;
    const parameterOrder = checkNativeSketchLineParameterOrder(
      startProjection.parameter,
      endProjection.parameter
    );
    result.results.parameterOrder = parameterOrder;
    if (!parameterOrder.ordered) return reject("parameter-order");
    const wireVertices = checkNativeSketchWireVertexSeparation(
      { point: end },
      { point: start },
      settings.linearResolution
    );
    result.results.wireVertices = wireVertices;
    if (wireVertices.overlap) return reject("wire-vertices");
    const bounds = prepareNativeSketchLineVertexBounds(end, start);
    result.results.bounds = bounds;
    const envelope = checkNativeSketchLineBoundsEnvelope(
      bounds,
      settings.coordinateEnvelope,
      settings.relativeComparisonTolerance
    );
    result.results.envelope = envelope;
    if (!envelope.inside) return reject("envelope");
    result.passed = true;
    return result;
  }
  function retire(handles) {
    const errors = [];
    for (let i = handles.length - 1; i >= 0; i--) {
      try {
        handles[i].delete();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }
  class SketchLineWireCandidate {
    #wire;
    #firstEdge;
    #request;
    #requestedTolerance;
    #disposed = false;
    constructor(wire, firstEdge, request, tolerance) {
      this.#wire = wire;
      this.#firstEdge = firstEdge;
      this.#request = request;
      this.#requestedTolerance = tolerance;
    }
    static createChecked(oc, input, settings) {
      const checks = checkNativeSketchFreshLineGeometry(input, settings);
      if (!checks.passed) return { status: "geometry-rejected", checks };
      const candidate = SketchLineWireCandidate.create(
        oc,
        checks.prepared,
        checks.vertexTolerance
      );
      return {
        status: candidate ? "candidate" : "kernel-rejected",
        checks,
        ...candidate ? { candidate } : {}
      };
    }
    static create(oc, input, requestedTolerance) {
      const request = requireNativeSketchLinePreparedEndpoints(input);
      if (typeof requestedTolerance !== "number" || !Number.isFinite(requestedTolerance) || requestedTolerance < 0)
        throw new Error(
          "Line wire candidate requires an explicit finite nonnegative tolerance."
        );
      const { conversion, start, end } = request;
      if (conversion.interval[1] <= conversion.interval[0]) return void 0;
      const handles = [];
      const keep = (h) => (handles.push(h), h);
      let built;
      let thrown = false, failure;
      try {
        built = (() => {
          const origin = keep(new oc.gp_Pnt_3(...conversion.origin));
          const direction = keep(
            createPreparedSketchDirection(oc, conversion.direction)
          );
          const line = keep(new oc.gp_Lin_3(origin, direction));
          const segment = keep(
            new oc.GC_MakeSegment_2(line, ...conversion.interval)
          );
          if (!segment.IsDone()) return void 0;
          const trimmed = keep(segment.Value());
          if (trimmed.IsNull()) return void 0;
          const curve = keep(new oc.Handle_Geom_Curve_2(trimmed.get()));
          const firstPoint = keep(new oc.gp_Pnt_3(...start));
          const lastPoint = keep(new oc.gp_Pnt_3(...end));
          const builder = keep(new oc.BRep_Builder());
          const firstVertex = keep(new oc.TopoDS_Vertex());
          const lastVertex = keep(new oc.TopoDS_Vertex());
          builder.MakeVertex_2(firstVertex, firstPoint, requestedTolerance);
          builder.MakeVertex_2(lastVertex, lastPoint, requestedTolerance);
          const edge = keep(new oc.TopoDS_Edge());
          builder.MakeEdge_2(edge, curve, requestedTolerance);
          if (edge.IsNull()) return void 0;
          builder.Range_1(edge, ...conversion.interval, true);
          firstVertex.Orientation_2(oc.TopAbs_Orientation.TopAbs_FORWARD);
          lastVertex.Orientation_2(oc.TopAbs_Orientation.TopAbs_REVERSED);
          builder.Add(edge, firstVertex);
          builder.Add(edge, lastVertex);
          builder.UpdateVertex_2(
            firstVertex,
            conversion.interval[0],
            edge,
            requestedTolerance
          );
          builder.UpdateVertex_2(
            lastVertex,
            conversion.interval[1],
            edge,
            requestedTolerance
          );
          const maker = keep(new oc.BRepBuilderAPI_MakeWire_1());
          maker.Add_1(edge);
          if (!maker.IsDone()) return void 0;
          const wire = keep(maker.Wire());
          if (wire.IsNull()) return void 0;
          const check = keep(new oc.BRepCheck_Analyzer(wire, true));
          if (!check.IsValid_2()) return void 0;
          const explorer = keep(
            new oc.TopExp_Explorer_2(
              wire,
              oc.TopAbs_ShapeEnum.TopAbs_EDGE,
              oc.TopAbs_ShapeEnum.TopAbs_SHAPE
            )
          );
          if (!explorer.More()) return void 0;
          const raw = keep(explorer.Current());
          const firstEdge = keep(oc.TopoDS.Edge_1(raw));
          if (firstEdge.IsNull()) return void 0;
          return { wire, firstEdge };
        })();
      } catch (error) {
        thrown = true;
        failure = error;
      }
      const retained = built ? [built.wire, built.firstEdge] : [];
      const errors = retire(
        handles.filter((h) => !retained.includes(h))
      );
      if (thrown || errors.length) {
        errors.push(...retire(retained));
        if (errors.length)
          throw new AggregateError(
            thrown ? [failure, ...errors] : errors,
            "Line wire candidate cleanup failed."
          );
        throw failure;
      }
      return built ? new SketchLineWireCandidate(
        built.wire,
        built.firstEdge,
        request,
        requestedTolerance
      ) : void 0;
    }
    #live() {
      if (this.#disposed) throw new Error("Line wire candidate is disposed.");
    }
    /** Borrowed worker-local handles; invalidated by dispose. */
    get wire() {
      this.#live();
      return this.#wire;
    }
    get firstEdge() {
      this.#live();
      return this.#firstEdge;
    }
    snapshot() {
      return structuredClone({
        disposed: this.#disposed,
        hasWire: !!this.#wire,
        hasFirstEdge: !!this.#firstEdge,
        ...this.#request ? {
          request: this.#request,
          requestedTolerance: this.#requestedTolerance
        } : {}
      });
    }
    /** Read-only connection diagnostic; it does not close or authorize the wire. */
    checkSelfConnection(squaredThreshold) {
      this.#live();
      return checkNativeSketchLineSelfConnection(this.#request, squaredThreshold);
    }
    /** Conditional input-range diagnostic; runtime threshold must be supplied. */
    checkInputInterval(parameterZeroThreshold) {
      this.#live();
      const interval = this.#request.conversion.interval;
      return checkNativeSketchLineInputInterval(
        interval[0],
        interval[1],
        parameterZeroThreshold
      );
    }
    /** Supplied attachment event only; continuation does not imply admission. */
    applyAttachmentResult(input) {
      this.#live();
      const result = resolveNativeSketchLineAttachment(input);
      if (!result.continues) this.dispose();
      return result;
    }
    /** Supplied native normal-return results; retention does not imply admission. */
    applyValidationResult(input) {
      this.#live();
      const result = resolveNativeSketchWireValidation(input);
      if (!result.retainCandidate) this.dispose();
      return result;
    }
    dispose() {
      if (this.#disposed) return;
      this.#disposed = true;
      const handles = [this.#wire, this.#firstEdge];
      this.#wire = void 0;
      this.#firstEdge = void 0;
      this.#request = void 0;
      this.#requestedTolerance = void 0;
      const errors = retire(handles);
      if (errors.length)
        throw new AggregateError(errors, "Line wire candidate cleanup failed.");
    }
  }
  function point(value) {
    if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every((n) => typeof n === "number" && Number.isFinite(n)))
      throw new Error("Line curve requires finite XYZ points.");
    return [value[0], value[1], value[2]];
  }
  function finite$1(value) {
    if (!Number.isFinite(value))
      throw new Error("Line curve arithmetic overflow.");
    return value;
  }
  function release(handles) {
    const errors = [];
    for (let i = handles.length - 1; i >= 0; i--) {
      try {
        handles[i].delete();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Line curve cleanup failed.");
  }
  function requireSketchLineCurveRequest(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid line curve request.");
    const r = input;
    if (r.kind !== "line" || Object.keys(r).some((k) => k !== "kind" && k !== "points") || !Array.isArray(r.points) || r.points.length !== 2)
      throw new Error("Line curve requires exactly two points.");
    const request = {
      kind: "line",
      points: [point(r.points[0]), point(r.points[1])]
    };
    return request;
  }
  class SketchLineCurve {
    #oc;
    #edge;
    #request;
    #disposed = false;
    constructor(oc) {
      this.#oc = oc;
    }
    #requireLive() {
      if (this.#disposed) throw new Error("Sketch line curve is disposed.");
    }
    #reset() {
      const edge = this.#edge;
      this.#edge = void 0;
      this.#request = void 0;
      edge?.delete();
    }
    /** Borrowed worker-local edge; invalidated by rebuild/dispose. */
    get edge() {
      this.#requireLive();
      return this.#edge;
    }
    snapshot() {
      return structuredClone({
        disposed: this.#disposed,
        hasCurve: this.#edge !== void 0,
        ...this.#request ? { request: this.#request } : {}
      });
    }
    rebuildCurve(input) {
      this.#requireLive();
      const request = requireSketchLineCurveRequest(input);
      this.#reset();
      const [a, b] = request.points;
      const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      if (Math.sqrt(finite$1(dx * dx + dy * dy + dz * dz)) < 1e-7) return false;
      const x = b[0] - a[0], y = b[1] - a[1], z = b[2] - a[2];
      const length2 = Math.sqrt(finite$1(x * x + y * y + z * z));
      const oc = this.#oc, handles = [];
      const keep = (h) => (handles.push(h), h);
      let candidate;
      try {
        try {
          const origin = keep(new oc.gp_Pnt_3(...a));
          const direction = keep(new oc.gp_Dir_4(x, y, z));
          const line = keep(new oc.gp_Lin_3(origin, direction));
          const segment = keep(new oc.GC_MakeSegment_2(line, 0, length2));
          if (!segment.IsDone()) return false;
          const trimmed = keep(segment.Value());
          if (trimmed.IsNull()) return false;
          const curve = keep(new oc.Handle_Geom_Curve_2(trimmed.get()));
          const edgeMaker = keep(new oc.BRepBuilderAPI_MakeEdge_24(curve));
          if (!edgeMaker.IsDone()) return false;
          candidate = edgeMaker.Edge();
        } finally {
          release(handles);
        }
        if (!candidate || candidate.IsNull()) return false;
        this.#edge = candidate;
        this.#request = request;
        candidate = void 0;
        return true;
      } finally {
        candidate?.delete();
      }
    }
    /** Geometry query only. Native midpoint publication must also check its body. */
    evaluateFraction(fraction) {
      this.#requireLive();
      if (typeof fraction !== "number" || !Number.isFinite(fraction))
        throw new Error("Line curve fraction must be finite.");
      if (!this.#edge) return void 0;
      const bounded = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
      const handles = [];
      try {
        const adaptor = new this.#oc.BRepAdaptor_Curve_2(this.#edge);
        handles.push(adaptor);
        const first = adaptor.FirstParameter(), last = adaptor.LastParameter();
        const p = adaptor.Value(finite$1((last - first) * bounded + first));
        handles.push(p);
        return point([p.X(), p.Y(), p.Z()]);
      } finally {
        release(handles);
      }
    }
    /** Conversion parameters only; no provider allocation or body success. */
    prepareBodyConversion(coordinateScale) {
      this.#requireLive();
      const scale = requireSketchLineCoordinateScale(coordinateScale);
      if (!this.#edge) return void 0;
      return prepareNativeSketchLineConversion(
        this.evaluateFraction(0),
        this.evaluateFraction(1),
        scale
      );
    }
    /** Provider-coordinate endpoint preparation only; no wire/body acceptance. */
    prepareBodyEndpoints(coordinateScale) {
      const conversion = this.prepareBodyConversion(coordinateScale);
      if (!conversion) return void 0;
      return {
        conversion,
        start: evaluateNativeSketchLinePoint(
          conversion.origin,
          conversion.direction,
          conversion.interval[0]
        ),
        end: evaluateNativeSketchLinePoint(
          conversion.origin,
          conversion.direction,
          conversion.interval[1]
        )
      };
    }
    /** The returned candidate belongs to the caller; no native admission is inferred. */
    prepareBodyCandidate(coordinateScale, settings) {
      this.#requireLive();
      const resolved = requireNativeSketchLineGeometrySettings(settings);
      const prepared = this.prepareBodyEndpoints(coordinateScale);
      return prepared ? SketchLineWireCandidate.createChecked(this.#oc, prepared, resolved) : void 0;
    }
    dispose() {
      if (this.#disposed) return;
      this.#disposed = true;
      this.#reset();
    }
  }
  function finite(n) {
    if (!Number.isFinite(n)) throw new Error("Sketch line arithmetic overflow.");
    return n;
  }
  function copyState(input) {
    if (!Array.isArray(input.sourceRecords))
      throw new Error("Line state requires a source record collection.");
    const source = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: input.frame,
      children: [
        { id: "sources", kind: "line", records: input.sourceRecords },
        {
          id: "fields",
          kind: "line",
          records: [input.start, input.middle, input.end]
        }
      ]
    });
    const [start, middle, end] = source.children[1].records;
    return {
      frame: source.frame,
      start,
      middle,
      end,
      sourceRecords: source.children[0].records
    };
  }
  function records(input, frame2, minimum) {
    if (!Array.isArray(input) || input.length < minimum)
      throw new Error(
        `Sketch line replacement requires at least ${minimum} records.`
      );
    return copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: frame2,
      children: [{ id: "", kind: "line", records: input }]
    });
  }
  function prepare(start, end, frame2, state) {
    state.frame = frame2;
    state.start = [...start];
    state.end = [...end];
    state.middle = [
      finite((end[0] + start[0]) * 0.5),
      finite((end[1] + start[1]) * 0.5),
      finite((end[2] + start[2]) * 0.5)
    ];
    return {
      state,
      backendRequest: { kind: "line", points: [[...start], [...end]] }
    };
  }
  function prepareNativeSketchLineCollectionRebuild(input, previous) {
    const state = copyState(previous), source = records(input, state.frame, 2), points = source.children[0].records;
    const a = [points[0][0], points[0][1], 0], b = [points[1][0], points[1][1], 0];
    const dy = a[1] - b[1], dx = a[0] - b[0];
    const length2 = Math.sqrt(finite(dy * dy + dx * dx + 0));
    if (length2 < Number.EPSILON) return { state, backendRequest: void 0 };
    return prepare(a, b, source.frame, state);
  }
  function prepareNativeSketchLineLocalReplacement(input, previous) {
    const state = copyState(previous), source = records(input, state.frame, 1), points = source.children[0].records;
    return prepare(points[0], points[points.length - 1], source.frame, state);
  }
  function prepareNativeSketchLinePlacedReplacement(input, placement, previous) {
    const state = copyState(previous), source = records(input, placement, 1), points = source.children[0].records;
    const [a, b, c] = source.frame;
    const local = (p, last) => {
      const x = finite(p[0] - a[3]), y = finite(p[1] - b[3]), z = finite(p[2] - c[3]);
      const coordinate = (i) => finite(
        last ? b[i] * y + a[i] * x + c[i] * z : a[i] * x + b[i] * y + c[i] * z
      );
      return [coordinate(0), coordinate(1), coordinate(2)];
    };
    return prepare(
      local(points[0], false),
      local(points[points.length - 1], true),
      source.frame,
      state
    );
  }
  function prepareNativeSketchLinePointEdit(index, target, previous) {
    if (!Number.isInteger(index) || index < 0 || index > 1)
      throw new Error("Line point index must be 0 or 1.");
    const state = copyState(previous), point2 = records([target], state.frame, 1).children[0].records[0], start = index === 0 ? point2 : state.start, end = index === 1 ? point2 : state.end;
    const dy = start[1] - end[1], dx = start[0] - end[0], dz = start[2] - end[2];
    if (Math.sqrt(finite(dy * dy + dx * dx + dz * dz)) < 1e-4)
      return { admitted: false, candidate: { state, backendRequest: void 0 } };
    const recoveryPoints = [
      [...state.start],
      [...state.start]
    ];
    return {
      admitted: true,
      candidate: prepare(start, end, state.frame, state),
      recoveryPoints
    };
  }
  function prepareNativeSketchLinePointRecovery(edit) {
    if (!edit.admitted || !edit.candidate.backendRequest || !edit.recoveryPoints)
      throw new Error("No admitted line point edit to recover.");
    return prepareNativeSketchLineLocalReplacement(
      edit.recoveryPoints,
      edit.candidate.state
    );
  }
  function prepareNativeSketchLineTransform(transformation, previous) {
    const state = copyState(previous), matrix = records([], transformation, 0).frame;
    const apply = (p) => {
      const coordinate = (i) => {
        const r = matrix[i];
        return finite(r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + r[3]);
      };
      return [coordinate(0), coordinate(1), coordinate(2)];
    };
    return prepare(apply(state.start), apply(state.end), state.frame, state);
  }
  function completeNativeSketchLineRebuild(preparation, backendSucceeded, backendMiddle) {
    const state = copyState(preparation.state);
    if (typeof backendSucceeded !== "boolean")
      throw new Error("Line backend result must be boolean.");
    if (!backendSucceeded) return { state, builderSucceeded: false };
    if (!preparation.backendRequest)
      throw new Error("No line backend build was requested.");
    const source = records([backendMiddle], state.frame, 1), middle = source.children[0].records[0];
    state.start = [state.start[0], state.start[1], 0];
    state.end = [state.end[0], state.end[1], 0];
    state.middle = [middle[0], middle[1], 0];
    state.sourceRecords = [[...state.start], [...state.end]];
    return { state, builderSucceeded: true };
  }
  const ownedBackends = /* @__PURE__ */ new WeakSet();
  function cancelled() {
    const error = new Error("Sketch line child rebuild cancelled.");
    error.name = "AbortError";
    return error;
  }
  function abort(signal) {
    if (signal?.aborted) throw cancelled();
  }
  class SketchLineChild {
    #backend;
    #state;
    #outcome;
    #disposed = false;
    constructor(initial, backend) {
      if (ownedBackends.has(backend))
        throw new Error("Line child backend is already owned.");
      const snapshot = backend.snapshot();
      if (snapshot.disposed || snapshot.hasCurve)
        throw new Error("Line child requires a fresh empty backend.");
      this.#state = completeNativeSketchLineRebuild(
        { state: initial, backendRequest: void 0 },
        false
      ).state;
      this.#backend = backend;
      ownedBackends.add(backend);
    }
    #live(signal) {
      if (this.#disposed) throw new Error("Sketch line child is disposed.");
      abort(signal);
    }
    /** Borrowed worker-local handle, invalidated by backend rebuild or disposal. */
    get edge() {
      this.#live();
      return this.#backend.edge;
    }
    snapshot() {
      return structuredClone({
        kind: "line",
        disposed: this.#disposed,
        state: this.#state,
        preparation: this.#state ? {
          frame: this.#state.frame,
          sourceRecords: this.#state.sourceRecords
        } : void 0,
        outcome: this.#outcome,
        backend: this.#backend.snapshot()
      });
    }
    rebuildRecords(records2, signal) {
      this.#live(signal);
      const preparation = prepareNativeSketchLineCollectionRebuild(
        records2,
        this.#state
      );
      return this.#run(preparation, !!preparation.backendRequest, signal);
    }
    replaceLocalRecords(records2, signal) {
      this.#live(signal);
      return this.#run(
        prepareNativeSketchLineLocalReplacement(records2, this.#state),
        true,
        signal
      );
    }
    replacePlacedRecords(records2, frame2, signal) {
      this.#live(signal);
      return this.#run(
        prepareNativeSketchLinePlacedReplacement(records2, frame2, this.#state),
        true,
        signal
      );
    }
    transformLocalPoints(transform, signal) {
      this.#live(signal);
      return this.#run(
        prepareNativeSketchLineTransform(transform, this.#state),
        true,
        signal
      );
    }
    editPoint(index, point2, signal) {
      this.#live(signal);
      const edit = prepareNativeSketchLinePointEdit(index, point2, this.#state);
      return this.#run(
        edit.candidate,
        edit.admitted,
        signal,
        edit.admitted ? () => prepareNativeSketchLinePointRecovery(edit) : void 0
      );
    }
    #run(preparation, admitted2, signal, recovery) {
      abort(signal);
      const outcome = {
        admitted: admitted2,
        attempts: [],
        builderSucceeded: false
      };
      this.#outcome = outcome;
      const attempt = (p) => {
        this.#state = p.state;
        if (!p.backendRequest) return false;
        const result = { builderSucceeded: false };
        outcome.attempts.push(result);
        try {
          const succeeded = this.#backend.rebuild(
            structuredClone(p.backendRequest)
          );
          this.#live(signal);
          if (typeof succeeded !== "boolean")
            throw new Error("Line backend result must be boolean.");
          result.backendSucceeded = succeeded;
          const completed = completeNativeSketchLineRebuild(
            p,
            succeeded,
            succeeded ? this.#backend.midpoint() : void 0
          );
          this.#live(signal);
          this.#state = completed.state;
          result.builderSucceeded = completed.builderSucceeded;
          outcome.builderSucceeded = completed.builderSucceeded;
          return completed.builderSucceeded;
        } catch (error) {
          result.error = error instanceof Error ? error.message : String(error);
          throw error;
        }
      };
      let failed = false;
      let failure;
      try {
        if (!attempt(preparation) && recovery) {
          abort(signal);
          attempt(recovery());
        }
        return structuredClone(outcome);
      } catch (error) {
        failed = true;
        failure = error;
        throw error;
      } finally {
        if (signal?.aborted) {
          const cancellation = cancelled();
          const errors = [cancellation];
          if (failed && !(failure instanceof Error && failure.name === "AbortError"))
            errors.push(failure);
          try {
            this.dispose();
          } catch (error) {
            errors.push(error);
          }
          if (errors.length > 1)
            throw new AggregateError(
              errors,
              "Sketch line child cancelled with failures."
            );
          throw cancellation;
        }
      }
    }
    dispose() {
      if (this.#disposed) return;
      this.#disposed = true;
      this.#state = void 0;
      this.#outcome = void 0;
      this.#backend.dispose();
    }
  }
  class SketchLineBackendDraft {
    #oc;
    #curve;
    #candidate;
    #records = [];
    #kind = "empty";
    #attempt;
    #disposed = false;
    constructor(oc) {
      this.#oc = oc;
      this.#curve = new SketchLineCurve(oc);
    }
    #live() {
      if (this.#disposed)
        throw new Error("Sketch line backend draft is disposed.");
    }
    #reset() {
      const candidate = this.#candidate;
      this.#candidate = void 0;
      this.#records = [];
      this.#kind = "empty";
      this.#attempt = void 0;
      const errors = [];
      try {
        this.#curve.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        candidate?.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length)
        throw new AggregateError(errors, "Line backend draft cleanup failed.");
    }
    /** Borrowed read-only geometry; rebuild and disposal invalidate handles. */
    get edge() {
      this.#live();
      return this.#curve.snapshot().hasCurve ? this.#curve.edge : void 0;
    }
    get wire() {
      this.#live();
      return this.#candidate?.wire;
    }
    get firstEdge() {
      this.#live();
      return this.#candidate?.firstEdge;
    }
    snapshot() {
      return structuredClone({
        disposed: this.#disposed,
        kind: this.#kind,
        records: this.#records,
        hasCurve: this.#curve.snapshot().hasCurve,
        hasBodyCandidate: !!this.#candidate,
        hasFirstEdge: !!this.#candidate,
        ...this.#attempt ? { attempt: this.#attempt } : {}
      });
    }
    /** Application staging copy, not native cloning or completed body admission. */
    fork(signal) {
      const curve = this.#curve, candidate = this.#candidate, records2 = this.#records, attempt = this.#attempt, kind2 = this.#kind;
      const check = () => {
        this.#live();
        if (signal?.aborted) {
          const error = new Error("Line draft copy cancelled.");
          error.name = "AbortError";
          throw error;
        }
        if (this.#curve !== curve || this.#candidate !== candidate || this.#records !== records2 || this.#attempt !== attempt)
          throw new Error("Line draft changed while copying.");
      };
      check();
      const primary = curve.snapshot();
      const prepared = candidate?.snapshot();
      const copy = new SketchLineBackendDraft(this.#oc);
      try {
        if (primary.hasCurve) {
          if (!primary.request || !copy.#curve.rebuildCurve(primary.request))
            throw new Error("Cannot restore line draft primary curve.");
        }
        check();
        if (prepared) {
          copy.#candidate = SketchLineWireCandidate.create(
            this.#oc,
            prepared.request,
            prepared.requestedTolerance
          );
          if (!copy.#candidate)
            throw new Error("Cannot restore line draft wire candidate.");
        }
        check();
        copy.#records = structuredClone(records2);
        copy.#kind = kind2;
        copy.#attempt = structuredClone(attempt);
        return copy;
      } catch (error) {
        try {
          copy.dispose();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Line draft copy and cleanup failed."
          );
        }
        throw error;
      }
    }
    rebuild(input, coordinateScale, settings) {
      this.#live();
      const request = requireSketchLineCurveRequest(input);
      const scale = requireSketchLineCoordinateScale(coordinateScale);
      const resolved = requireNativeSketchLineGeometrySettings(settings);
      let during = "reset";
      try {
        this.#reset();
        this.#curve = new SketchLineCurve(this.#oc);
        during = "primary";
        if (!this.#curve.rebuildCurve(request)) {
          this.#attempt = { status: "primary-rejected" };
          return this.snapshot();
        }
        during = "conversion";
        const result = this.#curve.prepareBodyCandidate(scale, resolved);
        this.#candidate = result?.candidate;
        this.#records = request.points.map((p) => [...p]);
        this.#kind = "line";
        this.#attempt = result ? {
          status: result.status === "candidate" ? "pending-validation" : result.status,
          checks: result.checks
        } : { status: "conversion-rejected" };
        return this.snapshot();
      } catch (error) {
        this.#attempt = {
          status: "error",
          during,
          error: error instanceof Error ? error.message : String(error)
        };
        throw error;
      }
    }
    /** Attachment events precede validation; no completed sequence is inferred. */
    applyAttachmentResult(input) {
      this.#live();
      const candidate = this.#candidate;
      if (!candidate) throw new Error("No line draft wire candidate.");
      if (this.#attempt?.status !== "pending-validation")
        throw new Error("Line draft attachment requires the construction phase.");
      try {
        const result = candidate.applyAttachmentResult(input);
        this.#attempt = {
          ...this.#attempt,
          status: result.continues ? "pending-validation" : "attachment-rejected",
          attachment: { ...result }
        };
        return result;
      } catch (error) {
        if (candidate.snapshot().disposed)
          this.#attempt = {
            ...this.#attempt,
            status: "error",
            during: "attachment",
            error: error instanceof Error ? error.message : String(error)
          };
        throw error;
      } finally {
        if (candidate.snapshot().disposed) this.#candidate = void 0;
      }
    }
    /** Requires supplied native normal-return results; retention is not admission. */
    applyValidationResult(input) {
      this.#live();
      const candidate = this.#candidate;
      if (!candidate) throw new Error("No line draft wire candidate.");
      try {
        const result = candidate.applyValidationResult(input);
        this.#attempt = {
          ...this.#attempt,
          status: result.retainCandidate ? "validation-retained" : "validation-rejected",
          validation: { ...result }
        };
        return result;
      } catch (error) {
        if (candidate.snapshot().disposed)
          this.#attempt = {
            ...this.#attempt,
            status: "error",
            during: "validation",
            error: error instanceof Error ? error.message : String(error)
          };
        throw error;
      } finally {
        if (candidate.snapshot().disposed) this.#candidate = void 0;
      }
    }
    /** Draft body-presence gate only, not a native accepted-builder result. */
    midpoint() {
      this.#live();
      return this.#candidate ? this.#curve.evaluateFraction(0.5) ?? [0, 0, 0] : [0, 0, 0];
    }
    dispose() {
      if (this.#disposed) return;
      this.#disposed = true;
      this.#reset();
    }
  }
  exports.SketchArcBackend = SketchArcBackend;
  exports.SketchChildCollection = SketchChildCollection;
  exports.SketchConicChild = SketchConicChild;
  exports.SketchEllipseBackend = SketchEllipseBackend;
  exports.SketchEllipseChild = SketchEllipseChild;
  exports.SketchLineBackendDraft = SketchLineBackendDraft;
  exports.SketchLineChild = SketchLineChild;
  exports.SketchLineCurve = SketchLineCurve;
  exports.SketchLineWireCandidate = SketchLineWireCandidate;
  exports.checkNativeSketchLineInputInterval = checkNativeSketchLineInputInterval;
  exports.checkNativeSketchLineSelfConnection = checkNativeSketchLineSelfConnection;
  exports.checkNativeSketchWireSelfConnection = checkNativeSketchWireSelfConnection;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
})({});
