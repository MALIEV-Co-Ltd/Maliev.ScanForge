import { expect, it } from "vitest";
import enablement from "./fixtures/alignment-command-enablement-native.json";
import binding from "./fixtures/alignment-dialog-bindings-native.json";

// Independent decoded policy, compared with actual original callback captures.
function target(
  objects: { kind: string; flags: number }[],
  kind: "mesh" | "cad",
) {
  const matching = objects.flatMap((object, index) =>
    object.kind === kind ? [{ ...object, index }] : [],
  );
  const preferred = matching.find((object) => object.flags & 2);
  if (preferred) return preferred.index;
  const flagged = matching.filter((object) => object.flags & 1);
  if (flagged.length === 1) return flagged[0].index;
  return matching.length === 1 ? matching[0].index : null;
}

it.each(enablement.cases.map((sample, index) => ({ ...sample, index })))(
  "matches original Align command eligibility and empty-dialog check states: $index",
  (sample) => {
    const scan = target(sample.objects, "mesh");
    const cad = target(sample.objects, "cad");
    expect(sample.scanIndex).toBe(scan);
    expect(sample.cadIndex).toBe(cad);
    const eligible = scan !== null || cad !== null;
    expect(sample.enableCases).toHaveLength(3);
    for (const state of sample.enableCases)
      expect(state.events).toEqual([
        { kind: "enable", value: Number(eligible) },
        { kind: "check", value: Number(state.ownMode === "match") },
      ]);
  },
);

const bindings = [
  ["control", 4313, 0x4700],
  ["control", 4315, 0x47e8],
  ["control", 1024, 0x48d0],
  ["integer", 4328, 0x4590],
  ["control", 4328, 0x3f80],
  ["integer", 4316, 0x4594],
  ["integer", 4318, 0x4598],
  ["integer", 4319, 0x459c],
  ["integer", 4329, 0x49b8],
  ["integer", 1042, 0x49bc],
  ["integer", 1044, 0x49c0],
  ["control", 4340, 0x168],
  ["control", 4341, 0x6f8],
  ["control", 4342, 0xc88],
  ["control", 4343, 0x1218],
  ["control", 4344, 0x17a8],
  ["control", 1119, 0x1d38],
  ["control", 4346, 0x22c8],
  ["control", 4347, 0x2858],
  ["control", 1120, 0x2de8],
  ["number", 1025, 0x4068],
  ["number", 1050, 0x4070],
  ["number", 1052, 0x4078],
  ["integer", 4345, 0x4090],
  ["integer", 4348, 0x4094],
  ["control", 1051, 0x3378],
  ["integer", 4631, 0x4098],
  ["control", 1122, 0x3e98],
  ["integer", 4658, 0x409c],
  ["control", 4658, 0x3908],
];
it.each(binding.cases)(
  "matches the original dialog field dispatch for translation $values",
  (sample) => {
    expect(sample.dialogPreserved).toBe(true);
    expect(
      sample.events.map(({ kind, id, offset }) => [kind, id, offset]),
    ).toEqual(bindings);
    const numbers = sample.events.filter((event) => event.kind === "number");
    expect(numbers.map((event) => event.value)).toEqual(sample.values);
    expect(
      numbers.every((event) => event.digits === 8 && event.limit === 15),
    ).toBe(true);
  },
);
