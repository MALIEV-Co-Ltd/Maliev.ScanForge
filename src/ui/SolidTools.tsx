import { ToolSection } from "./tool-panel-scope";
import { AppSelect } from "./AppSelect";
import { useState } from "react";
import type { Entity } from "../types";
import { Field, Panel } from "./controls";
export function SolidTools({
  entities,
  selected,
  busy,
  onBoolean,
  onExtrude,
  onRevolve,
}: {
  entities: Entity[];
  selected?: Entity;
  busy: boolean;
  onBoolean: (
    operation: "union" | "subtract" | "intersect",
    otherId: string,
  ) => void;
  onExtrude: (
    points: [number, number][],
    height: number,
    oppositeDistance?: number,
  ) => void;
  onRevolve: (points: [number, number][], angle: number) => void;
}) {
  const [operation, setOperation] = useState<
    "union" | "subtract" | "intersect"
  >("subtract");
  const [otherId, setOtherId] = useState("");
  const [sketch, setSketch] = useState("-20,-15\n20,-15\n20,15\n-20,15");
  const [height, setHeight] = useState(10);
  const [oppositeText, setOppositeText] = useState("0");
  const oppositeDistance =
    oppositeText.trim() === "" ? NaN : Number(oppositeText);
  const [profile, setProfile] = useState("10,0\n20,0\n20,15\n10,15");
  const [angle, setAngle] = useState(360);
  const points = sketch
    .trim()
    .split("\n")
    .map((line) => line.split(",").map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite)) as [
    number,
    number,
  ][];
  const candidates = entities.filter(
    (e) => e.kernelId && e.id !== selected?.id,
  );
  return (
    <>
      <ToolSection tools={["boolean", "reconstruct"]}>
        <Panel title="Solid modeling">
          <label className="select-field">
            Operation
            <AppSelect
              aria-label="Boolean operation"
              value={operation}
              onChange={(e) => setOperation(e.target.value as typeof operation)}
            >
              <option value="union">Union</option>
              <option value="subtract">Subtract</option>
              <option value="intersect">Intersect</option>
            </AppSelect>
          </label>
          <label className="select-field">
            Tool body
            <AppSelect
              aria-label="Boolean tool body"
              value={otherId}
              onChange={(e) => setOtherId(e.target.value)}
            >
              <option value="">Choose CAD object</option>
              {candidates.map((e) => (
                <option value={e.id} key={e.id}>
                  {e.name}
                </option>
              ))}
            </AppSelect>
          </label>
          <button
            className="wide"
            disabled={
              busy ||
              !selected?.kernelId ||
              !candidates.some((e) => e.id === otherId)
            }
            onClick={() => onBoolean(operation, otherId)}
          >
            Create boolean result
          </button>
          <p className="muted">
            Selected CAD object is the base. Input bodies are retained and
            hidden when a result is created.
          </p>
        </Panel>
      </ToolSection>
      <ToolSection tools={["revolve", "reconstruct"]}>
        <Panel title="Profile → revolution">
          <label className="sketch-input">
            Radius,Z vertices (mm), one pair per line
            <textarea
              aria-label="Revolve profile"
              value={profile}
              onChange={(event) => setProfile(event.target.value)}
              rows={4}
              spellCheck={false}
            />
          </label>
          <Field
            label="Revolution (°)"
            value={angle}
            min={0.001}
            max={360}
            step={15}
            onChange={setAngle}
          />
          <button
            className="wide"
            disabled={busy}
            onClick={() => {
              const rows = profile
                .trim()
                .split("\n")
                .map((row) => row.split(",").map(Number));
              onRevolve(
                rows.every(
                  (row) => row.length === 2 && row.every(Number.isFinite),
                )
                  ? (rows as [number, number][])
                  : [],
                angle,
              );
            }}
          >
            Revolve profile to CAD
          </button>
          <p className="muted">
            Closed straight-edge profile around the Z axis. Radius must be
            nonnegative. Full or partial revolution.
          </p>
        </Panel>
      </ToolSection>
      <ToolSection tools={["extrude", "reconstruct"]}>
        <Panel title="Polygon sketch → extrusion">
          <svg
            className="sketch-preview"
            viewBox="-50 -50 100 100"
            aria-label="XY sketch preview"
          >
            <path
              d="M -50 0 H 50 M 0 -50 V 50"
              stroke="#36515e"
              strokeWidth=".5"
            />
            <polygon
              points={points.map(([x, y]) => `${x},${-y}`).join(" ")}
              fill="#31bfa830"
              stroke="#42c9b5"
              strokeWidth=".8"
            />
          </svg>
          <label className="sketch-input">
            XY vertices (mm), one x,y pair per line
            <textarea
              aria-label="Sketch vertices"
              value={sketch}
              onChange={(e) => setSketch(e.target.value)}
              rows={4}
              spellCheck={false}
            />
          </label>
          <Field
            label="Extrusion (mm)"
            value={height}
            step={1}
            min={0.001}
            onChange={setHeight}
          />
          <label>
            Opposite extrusion distance (mm)
            <input
              type="number"
              min="0"
              value={oppositeText}
              onChange={(event) => setOppositeText(event.target.value)}
            />
          </label>
          <button
            className="wide"
            disabled={
              busy ||
              !Number.isFinite(oppositeDistance) ||
              oppositeDistance < 0 ||
              height + oppositeDistance > 1e9
            }
            onClick={() => {
              const rows = sketch.trim().split("\n");
              if (points.length !== rows.length)
                onExtrude([], height, oppositeDistance);
              else onExtrude(points, height, oppositeDistance);
            }}
          >
            Extrude sketch to CAD
          </button>
          <p className="muted">
            Closed simple XY polygon, straight edges, Z extrusion.
            Self-intersections and holes are unsupported.
          </p>
        </Panel>
      </ToolSection>
    </>
  );
}
