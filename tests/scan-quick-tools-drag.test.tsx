import { expect, it, vi } from "vitest";
import { ScanQuickTools } from "../src/ui/ScanQuickTools";
const moved = vi.hoisted(() => vi.fn());
vi.mock("react", async () => ({
  ...(await vi.importActual("react")),
  useState: (value: unknown) => [value, moved],
  useRef: (value: unknown) => ({ current: value }),
}));
it("drags with pointer capture, clamps to the viewport and stops on cancellation", () => {
  vi.stubGlobal("window", { innerWidth: 800, innerHeight: 600 });
  try {
    const noop = () => {};
    const tree = ScanQuickTools({
      x: 300,
      y: 200,
      onDelete: noop,
      onHide: noop,
      onIsolate: noop,
      onInvert: noop,
    });
    const handle = tree;
    const target = {
      getBoundingClientRect: () => ({
        left: 200,
        top: 100,
        width: 230,
        height: 38,
      }),
      closest: () => null,
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    };
    const event = {
      button: 0,
      pointerId: 4,
      clientX: 210,
      clientY: 110,
      currentTarget: target,
      target,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    handle.props.onPointerDown(event);
    expect(target.setPointerCapture).toHaveBeenCalledWith(4);
    handle.props.onPointerMove({ ...event, clientX: 310, clientY: 160 });
    expect(moved).toHaveBeenLastCalledWith({ x: 300, y: 150 });
    handle.props.onPointerMove({ ...event, clientX: 9999, clientY: -999 });
    expect(moved).toHaveBeenLastCalledWith({ x: 562, y: 8 });
    handle.props.onPointerUp(event);
    expect(target.releasePointerCapture).toHaveBeenCalledWith(4);
    const calls = moved.mock.calls.length;
    handle.props.onPointerMove(event);
    expect(moved).toHaveBeenCalledTimes(calls);
    handle.props.onKeyDown({ ...event, key: "ArrowRight", shiftKey: false });
    expect(moved).toHaveBeenLastCalledWith({ x: 210, y: 100 });
    const afterKeyboard = moved.mock.calls.length;
    const buttonTarget = { closest: () => ({}) };
    handle.props.onPointerDown({ ...event, target: buttonTarget });
    handle.props.onPointerMove(event);
    handle.props.onKeyDown({
      ...event,
      target: buttonTarget,
      key: "ArrowRight",
    });
    expect(moved).toHaveBeenCalledTimes(afterKeyboard);
    handle.props.onPointerDown(event);
    handle.props.onPointerCancel();
    handle.props.onPointerMove(event);
    expect(moved).toHaveBeenCalledTimes(afterKeyboard);
  } finally {
    vi.unstubAllGlobals();
  }
});
