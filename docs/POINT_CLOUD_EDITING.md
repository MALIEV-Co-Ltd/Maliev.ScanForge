# Point-cloud editing

ASC scans remain point clouds. Edit Scan supports screen-space brush, freehand, line, rectangle and circle selection, see-through selection, hide/isolate/show, saved selections, copy/cut/delete and model undo. Selection indices identify XYZ samples, not synthetic triangles. The status bar reports points.

Point processing uses the shared processing worker through both GUI and MCP. Use `selection_set` with `entityId` and `points` indices, then `selection_edit` with `copy`, `cut` or `delete`. Mesh selections continue to use `triangles`. Both preserve the existing revision, retry, lock and cancellation contracts. `selection_get` reports `elementKind` and `count`.

Use `mesh_process` with `operation.kind: "pointCloudEdit"`. Actions are:

| Action               | Parameters and behavior                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voxel`              | `cellSize` in mm, default 0.5. Retains the first real sample in each occupied cell.                                                                                                                                        |
| `sampleCount`        | `targetPoints`, the number of editable points to retain. Defaults to half. Deterministic sampling preserves scan order.                                                                                                    |
| `smooth`             | `neighborRadius` default 0.5 mm; `iterations` default 2; `strength` default 0.5; `deviation` default 0.05 mm. Uses up to 32 nearest neighbors within the radius and limits cumulative displacement from the original scan. |
| `delete`, `extract`  | Use the current selection. Deleting every point removes the object. Extraction with `createNew:true` creates a separate point cloud.                                                                                       |
| `connectedSelection` | Grows the marked points through neighbors within `neighborRadius`. Point connectivity is proximity-based.                                                                                                                  |
| `grow`, `shrink`     | Expands/contracts the selection using the same neighbor radius.                                                                                                                                                            |

Set `selectionOnly:true` for simplification or smoothing to preserve points outside the current selection. No selection-only request silently falls back to the entire cloud. Supplied scanner normals follow retained point indices; smoothing preserves supplied normals without re-estimating them (`normalsReestimated:false`). Diagnostics report source, selected and resulting point counts and the point-cloud algorithm. Dense neighborhoods exceeding the bounded comparison budget fail without changing the source; reduce radius or simplify first.

These point algorithms are application implementations; native point-processing parity has not been established. Surface defeaturing, triangle decimation, boundary-loop editing and hole filling require a reconstructed mesh. They cannot repatch a raw cloud. Directly select and remove a scanned feature's points instead.

For meshes, Edit Scan's **Select connected objects** expands marked facets to their complete connected components without a curvature threshold. MCP exposes the same operation through `mesh_process` with `kind:"connectedSelection"` and `allConnected:true`.
