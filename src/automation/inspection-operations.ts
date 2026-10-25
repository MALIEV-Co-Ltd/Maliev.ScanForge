import { validateInspectionDefinitions } from "../inspection-definition";
import { measureGeometry, inspectSection } from "../inspection";
import type { WorkspaceHost, Handler, CommandContext } from "./api";
import { inspectDeviationAsync } from "../inspection";
import {
  inspectReferenceDeviation,
  type ReferenceDeviationReport,
} from "../inspection-reference";
import type { Entity } from "../types";
export type InspectionReport =
  Awaited<ReturnType<typeof inspectDeviationAsync>> | ReferenceDeviationReport;
export interface InspectionDisplay {
  source: Entity;
  reference?: Entity;
  report: InspectionReport;
}
const owners = new WeakMap<WorkspaceHost, () => void>();
export function releaseInspectionDisplay(host: WorkspaceHost) {
  owners.get(host)?.();
}
/** A single source-bound report may be displayed for fifteen minutes; geometry is never adopted. */
export function createInspectionOperations(
  host: WorkspaceHost,
): Record<string, Handler> {
  let current:
    | (InspectionDisplay & { id: string; timer: ReturnType<typeof setTimeout> })
    | undefined;
  const release = () => {
    if (current) {
      clearTimeout(current.timer);
      current = undefined;
    }
    host.showInspection?.(null);
  };
  const clear = () => {
    release();
    host.showMeasurement?.(null);
    host.showSection?.(null);
  };
  owners.set(host, clear);
  const entity = (id: string) => {
    const value = host.snapshot().entities.find((e) => e.id === id);
    if (!value) throw new Error("Inspection object not found.");
    return value;
  };
  const artifact = (c: CommandContext, value: unknown, name: string) => {
    c.check();
    return c.artifact(JSON.stringify(value), name, "application/json");
  };
  const operations: Record<string, Handler> = {
    inspection_get: () => ({
      inspections: structuredClone(host.snapshot().authoring.inspections ?? []),
    }),
    inspection_manage: (a, c) => {
      if (!host.setAuthoring)
        throw new Error("Inspection persistence is unavailable.");
      const authoring = host.snapshot().authoring;
      let inspections = authoring.inspections ?? [];
      const id = a.action === "save" ? crypto.randomUUID() : a.inspectionId;
      if (a.action === "save")
        inspections = validateInspectionDefinitions([
          ...inspections,
          { id, name: a.name, definition: a.definition },
        ]);
      else {
        if (!inspections.some((item) => item.id === id))
          throw new Error("Saved inspection not found.");
        inspections = inspections.filter((item) => item.id !== id);
      }
      c.check();
      host.setAuthoring({ ...authoring, inspections });
      return { inspectionId: id };
    },
    inspection_run: (a, c) => {
      const saved = host
        .snapshot()
        .authoring.inspections?.find((item) => item.id === a.inspectionId);
      if (!saved) throw new Error("Saved inspection not found.");
      const definition = validateInspectionDefinitions([saved])[0].definition;
      if (definition.kind === "measurement")
        return measureGeometry(definition.measurement);
      const { kind: _kind, ...parameters } = definition;
      return operations.analysis_deviation(parameters, c);
    },
    analysis_deviation: async (a, c) => {
      c.check();
      const source = entity(a.entityId),
        reference =
          a.referenceId === undefined ? undefined : entity(a.referenceId);
      const options = { check: c.check, progress: c.progress };
      const report = reference
        ? await inspectReferenceDeviation(
            source,
            reference,
            a as unknown as import("../inspection-reference").ReferenceDeviationOptions,
            options,
          )
        : await inspectDeviationAsync(source, a.fit, a.tolerance, options);
      c.check();
      const distances = artifact(c, report.distances, "deviations.json"),
        file = artifact(c, report, "deviation-report.json");
      c.check();
      release();
      const id = crypto.randomUUID(),
        timer = setTimeout(release, 900000);
      timer.unref?.();
      current = { id, source, reference, report, timer };
      const {
        distances: _distances,
        referenceTriangles: _triangles,
        ...summary
      } = { referenceTriangles: undefined, ...report };
      return {
        ...summary,
        inspectionId: id,
        artifact: distances,
        report: file,
      };
    },
    inspection_display: (a, c) => {
      c.check();
      if (a.action === "measurement") {
        const result = measureGeometry(a.measurement);
        if (!host.showMeasurement)
          throw new Error("Measurement display is unavailable.");
        host.showMeasurement(structuredClone(a.measurement));
        return result;
      }
      if (a.action === "section") {
        const source = entity(a.entityId);
        if (host.snapshot().selectedId !== source.id)
          throw new Error(
            "Select the inspection source object before showing its section.",
          );
        const section = inspectSection(source, a.axis, a.offset);
        if (!host.showSection)
          throw new Error("Section display is unavailable.");
        host.showSection({
          entityId: source.id,
          axis: a.axis,
          offset: a.offset,
        });
        return {
          entityId: source.id,
          axis: a.axis,
          offset: a.offset,
          units: "mm",
          length: section.length,
          segments: section.segments.length / 6,
        };
      }
      if (a.action === "clear") {
        clear();
        return { displayed: false };
      }
      if (!host.showInspection)
        throw new Error("Inspection display is unavailable.");
      const retained = current;
      if (!retained || retained.id !== a.inspectionId)
        throw new Error(
          "Inspection report expired or was replaced; recompute it.",
        );
      const entities = host.snapshot().entities;
      if (
        !entities.includes(retained.source) ||
        (retained.reference && !entities.includes(retained.reference))
      ) {
        release();
        throw new Error("Inspection geometry changed; recompute the report.");
      }
      if (host.snapshot().selectedId !== retained.source.id)
        throw new Error(
          "Select the inspection source object before showing its heatmap.",
        );
      host.showInspection(retained);
      return {
        displayed: true,
        inspectionId: retained.id,
        entityId: retained.source.id,
        units: "mm",
        samples: retained.report.samples,
      };
    },
  };
  return operations;
}
