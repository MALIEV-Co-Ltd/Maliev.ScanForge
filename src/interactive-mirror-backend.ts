import type {
  InteractiveBoundsPool,
  InteractiveBoundsSource,
} from "./interactive-bounds-pool";
import type { InteractiveMirrorSettings } from "./interactive-bounds-worker";
/** Session-owned source provider. The viewport borrows immutable buffers and never creates another pool. */
export interface InteractiveMirrorBackend {
  readonly entityIds: readonly string[];
  source(
    entityId: string,
    signal?: AbortSignal,
  ): Promise<Readonly<InteractiveBoundsSource>>;
  prepare(
    entityId: string,
    settings: InteractiveMirrorSettings,
    includeColors?: boolean,
  ): Promise<Awaited<ReturnType<InteractiveBoundsPool["mirror"]>>>;
}
