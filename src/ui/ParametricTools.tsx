import { useEffect, useState } from "react";
import type { Entity } from "../types";
import type { ParametricRecipe } from "../parametric";

export function ParametricTools({
  selected,
  disabled,
  onRebuild,
  onError,
}: {
  selected?: Entity;
  disabled: boolean;
  onRebuild: (recipe: ParametricRecipe) => void;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState("");
  useEffect(
    () =>
      setText(
        selected?.parametric
          ? JSON.stringify(selected.parametric.feature.recipe, null, 2)
          : "",
      ),
    [selected],
  );
  if (!selected?.parametric) return null;
  return (
    <section aria-label="Parametric rebuild">
      <h3>Parametric feature</h3>
      <p>
        {selected.parametric.feature.name} · output{" "}
        {selected.parametric.output + 1}
      </p>
      <label>
        Feature recipe
        <textarea
          aria-label="Parametric feature recipe"
          rows={10}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="muted">
        Edit dimensions or dependencies. Rebuild updates this feature and all
        dependent bodies atomically. Undo restores the earlier recipes and exact
        CAD.
      </p>
      <button
        disabled={disabled}
        onClick={() => {
          try {
            onRebuild(JSON.parse(text) as ParametricRecipe);
          } catch (error) {
            onError(error instanceof Error ? error.message : String(error));
          }
        }}
      >
        Rebuild feature and dependents
      </button>
    </section>
  );
}
