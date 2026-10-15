export type InteractiveScreenPoint = readonly [number, number];
export interface InteractiveGizmoMovement {
  handle: number;
  from: InteractiveScreenPoint;
  to: InteractiveScreenPoint;
  continuation: boolean;
}
interface Gesture {
  handle: number;
  previous: InteractiveScreenPoint;
  pending?: InteractiveScreenPoint;
  continuation: boolean;
  ended: boolean;
}

/** One shared command at a time; coalescing never consumes the native 7-pixel threshold. */
export class InteractiveGizmoDrag {
  private gesture?: Gesture;
  private running = false;
  constructor(
    private readonly send: (
      movement: InteractiveGizmoMovement,
    ) => Promise<boolean>,
    private readonly onError: (error: unknown) => void,
  ) {}
  get active() {
    return !!this.gesture;
  }
  begin(handle: number, point: InteractiveScreenPoint) {
    this.gesture = {
      handle,
      previous: [...point],
      continuation: false,
      ended: false,
    };
  }
  move(point: InteractiveScreenPoint) {
    const gesture = this.gesture;
    if (!gesture || gesture.ended) return;
    gesture.pending = [...point];
    void this.pump();
  }
  end() {
    if (!this.gesture) return;
    this.gesture.ended = true;
    if (!this.running && !this.gesture.pending) this.gesture = undefined;
  }
  cancel() {
    this.gesture = undefined;
  }
  private async pump(): Promise<void> {
    const gesture = this.gesture;
    if (this.running || !gesture?.pending) return;
    const to = gesture.pending;
    gesture.pending = undefined;
    this.running = true;
    try {
      const accepted = await this.send({
        handle: gesture.handle,
        from: gesture.previous,
        to,
        continuation: gesture.continuation,
      });
      if (this.gesture === gesture && accepted) {
        gesture.previous = to;
        gesture.continuation = true;
      }
    } catch (error) {
      if (this.gesture === gesture) {
        this.gesture = undefined;
        this.onError(error);
      }
    } finally {
      this.running = false;
      if (this.gesture?.pending) void this.pump();
      else if (this.gesture?.ended) this.gesture = undefined;
    }
  }
}
