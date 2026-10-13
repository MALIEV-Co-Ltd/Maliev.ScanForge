/** Raw HID and driver-emulated wheel events must not navigate simultaneously. */
export class SpaceMouseInputGate {
  private activeUntil = -Infinity;
  constructor(private clock = () => performance.now()) {}

  noteMotion(): void {
    // Cover the controller's 150ms motion lifetime plus delayed driver events.
    this.activeUntil = this.clock() + 250;
  }

  consumeWheel(event: WheelEvent): boolean {
    if (this.clock() >= this.activeUntil) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }
}
