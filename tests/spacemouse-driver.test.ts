import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  createSpaceMouseDriver,
  type SpaceMouseDriverClient,
  type SpaceMouseDriverSdk,
} from "../src/spacemouse-driver";

const drivers: ReturnType<typeof createSpaceMouseDriver>[] = [];
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose();
  vi.useRealTimers();
});

function transportFixture() {
  vi.useFakeTimers();
  const requests: FakeRequest[] = [],
    sockets: FakeSocket[] = [];
  class FakeRequest {
    timeout = 0;
    readyState = 0;
    status = 0;
    responseText = '{"port":1}';
    onreadystatechange: (() => void) | null = null;
    abort = vi.fn();
    open() {}
    setRequestHeader() {}
    send() {
      requests.push(this);
    }
    respond() {
      this.status = 200;
      this.readyState = 4;
      this.onreadystatechange?.();
    }
  }
  class FakeSocket {
    readyState = 0;
    protocol = "wamp";
    onopen: (() => void) | null = null;
    onclose:
      | ((event: { wasClean: boolean; code: number; reason: string }) => void)
      | null = null;
    close = vi.fn(() => {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.onclose?.({ wasClean: true, code: 1000, reason: "closed" });
    });
    constructor() {
      sockets.push(this);
    }
  }
  const context: Record<string, unknown> = {
    XMLHttpRequest: FakeRequest,
    WebSocket: FakeSocket,
    navigator: {
      userAgent: "fixture",
      appVersion: "fixture",
      vendor: "fixture",
    },
    location: { href: "https://fixture.invalid/" },
    setTimeout,
    clearTimeout,
    console,
  };
  context.window = context;
  const source = readFileSync(
    new URL(
      "../public/vendor/3dconnexion/3dconnexion.module.min.js",
      import.meta.url,
    ),
    "utf8",
  );
  expect(source.split("export default n;")).toHaveLength(2);
  expect(source.split("export{n as _3Dconnexion};")).toHaveLength(2);
  const constructor = runInNewContext(
    source
      .replace("export default n;", "")
      .replace("export{n as _3Dconnexion};", "") + ";n;",
    context,
    { timeout: 5000 },
  ) as new (client: SpaceMouseDriverClient) => SpaceMouseDriverSdk;
  const disconnected = vi.fn();
  const sdk = new constructor({
    onConnect: vi.fn(),
    onDisconnect: disconnected,
  });
  sdk.connect();
  return { sdk, requests, sockets, disconnected };
}

describe("bundled SDK owns bounded transports", () => {
  it("bounds discovery and aborts its exact pending XHR on close", () => {
    const f = transportFixture();
    try {
      expect(f.requests).toHaveLength(1);
      expect(f.requests[0].timeout).toBe(8000);
      f.sdk.close();
      expect(f.requests[0].abort).toHaveBeenCalledOnce();
      f.requests[0].respond();
      expect(f.sockets).toHaveLength(0);
    } finally {
      f.sdk.close();
    }
  });

  it("closes a pending handshake and prevents retries after explicit close", async () => {
    const f = transportFixture();
    try {
      f.requests[0].respond();
      expect(f.sockets).toHaveLength(1);
      f.sdk.close();
      expect(f.sockets[0].close).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(20000);
      expect(f.sockets).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      f.sdk.close();
    }
  });

  it("bounds a socket that opens but never delivers WAMP readiness", async () => {
    const f = transportFixture();
    try {
      f.requests[0].respond();
      f.sockets[0].readyState = 1;
      f.sockets[0].onopen?.();
      await vi.advanceTimersByTimeAsync(10000);
      expect(f.sockets[0].close).toHaveBeenCalledOnce();
      expect(f.disconnected).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      f.sdk.close();
    }
  });

  it("retains the exact pending socket when close throws so the owner can retry", () => {
    const f = transportFixture();
    try {
      f.requests[0].respond();
      const close = f.sockets[0].close.getMockImplementation()!;
      f.sockets[0].close.mockImplementationOnce(() => {
        throw new Error("socket stop failed");
      });
      expect(() => f.sdk.close()).toThrow("socket stop failed");
      f.sockets[0].close.mockImplementation(close);
      f.sdk.close();
      expect(f.sockets[0].close).toHaveBeenCalledTimes(2);
      expect(f.sockets).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      f.sdk.close();
    }
  });
});

function fixture() {
  let client: SpaceMouseDriverClient = {};
  const sdk: SpaceMouseDriverSdk = {
    connect: vi.fn(() => 1),
    create3dmouse: vi.fn(),
    delete3dmouse: vi.fn(),
    close: vi.fn(),
  };
  const ready = vi.fn(),
    lost = vi.fn();
  const driver = createSpaceMouseDriver({
    factory: (callbacks) => {
      client = callbacks;
      return sdk;
    },
    onReady: ready,
    onLost: lost,
  });
  drivers.push(driver);
  const canvas = { focus: vi.fn() } as unknown as HTMLCanvasElement;
  const invoke = (name: string, ...args: unknown[]) => {
    const callback = client[name];
    if (typeof callback !== "function")
      throw new Error("Missing callback " + name);
    return Reflect.apply(callback, client, args);
  };
  return { driver, sdk, ready, lost, canvas, invoke };
}

describe("optional official SpaceMouse driver", () => {
  it("waits for controller readiness and creates the actual focusable view", async () => {
    const f = fixture();
    let settled = false;
    const pending = f.driver.connect(f.canvas, {}).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    f.invoke("onConnect");
    expect(f.sdk.create3dmouse).toHaveBeenCalledExactlyOnceWith(
      f.canvas,
      "ScanForge",
    );
    expect(settled).toBe(false);
    f.invoke("on3dmouseCreated");
    await pending;
    expect(f.ready).toHaveBeenCalledOnce();
    expect(f.driver.connected).toBe(true);
  });

  it("delegates synchronous camera callbacks without converting matrices", async () => {
    const f = fixture();
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1];
    const get = vi.fn(() => matrix),
      set = vi.fn();
    const pending = f.driver.connect(f.canvas, {
      getViewMatrix: get,
      setViewMatrix: set,
    });
    await Promise.resolve();
    expect(f.invoke("getViewMatrix")).toBe(matrix);
    f.invoke("setViewMatrix", matrix);
    expect(set).toHaveBeenCalledExactlyOnceWith(matrix);
    f.invoke("onConnect");
    f.invoke("on3dmouseCreated");
    await pending;
    f.driver.close();
    f.invoke("setViewMatrix", matrix);
    expect(set).toHaveBeenCalledOnce();
  });

  it("times out readiness and closes both SDK controller and transport", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const rejected = expect(f.driver.connect(f.canvas, {})).rejects.toThrow(
      "timed out",
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(f.sdk.delete3dmouse).toHaveBeenCalledOnce();
    expect(f.sdk.close).toHaveBeenCalledOnce();
    expect(f.driver.connected).toBe(false);
    f.invoke("onConnect");
    f.invoke("on3dmouseCreated");
    expect(f.sdk.create3dmouse).not.toHaveBeenCalled();
    expect(f.ready).not.toHaveBeenCalled();
  });

  it("aborts pending discovery and removes its abort listener", async () => {
    const f = fixture(),
      signal = new AbortController();
    const remove = vi.spyOn(signal.signal, "removeEventListener");
    const rejected = expect(
      f.driver.connect(f.canvas, {}, signal.signal),
    ).rejects.toThrow("aborted");
    await Promise.resolve();
    signal.abort();
    await rejected;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(f.sdk.close).toHaveBeenCalledOnce();
  });

  it("closes a factory result that arrives after cancellation", async () => {
    let complete!: (sdk: SpaceMouseDriverSdk) => void;
    const sdk = {
      connect: vi.fn(() => 1),
      create3dmouse: vi.fn(),
      delete3dmouse: vi.fn(),
      close: vi.fn(),
    };
    const driver = createSpaceMouseDriver({
      factory: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    drivers.push(driver);
    const signal = new AbortController();
    const rejected = expect(
      driver.connect({} as HTMLCanvasElement, {}, signal.signal),
    ).rejects.toThrow("aborted");
    signal.abort();
    await rejected;
    complete(sdk);
    await Promise.resolve();
    await Promise.resolve();
    expect(sdk.connect).not.toHaveBeenCalled();
    expect(sdk.close).toHaveBeenCalledOnce();
  });

  it("reports a lost session and permits an explicit subsequent connection", async () => {
    const f = fixture();
    const first = f.driver.connect(f.canvas, {});
    await Promise.resolve();
    f.invoke("onConnect");
    f.invoke("on3dmouseCreated");
    await first;
    f.invoke("onDisconnect", "driver stopped");
    expect(f.driver.connected).toBe(false);
    expect(f.lost).toHaveBeenCalledWith(
      expect.objectContaining({ message: "driver stopped" }),
    );
    const second = f.driver.connect(f.canvas, {});
    await Promise.resolve();
    f.invoke("onConnect");
    f.invoke("on3dmouseCreated");
    await second;
    expect(f.ready).toHaveBeenCalledTimes(2);
  });

  it("attempts transport close even when controller deletion throws", async () => {
    const f = fixture();
    const pending = f.driver.connect(f.canvas, {});
    await Promise.resolve();
    f.invoke("onConnect");
    f.invoke("on3dmouseCreated");
    await pending;
    vi.mocked(f.sdk.delete3dmouse).mockImplementation(() => {
      throw new Error("delete failed");
    });
    f.driver.close();
    expect(f.sdk.close).toHaveBeenCalledOnce();
  });

  it("retains and retries failed transport ownership before admitting another connection", async () => {
    const f = fixture();
    const pending = f.driver.connect(f.canvas, {});
    await Promise.resolve();
    f.invoke("onConnect");
    f.invoke("on3dmouseCreated");
    await pending;
    vi.mocked(f.sdk.close).mockImplementation(() => {
      throw new Error("stop failed");
    });
    expect(() => f.driver.close()).toThrow("stop failed");
    await expect(f.driver.connect(f.canvas, {})).rejects.toThrow("stop failed");
    vi.mocked(f.sdk.close).mockImplementation(() => {});
    f.driver.close();
    const next = f.driver.connect(f.canvas, {});
    await Promise.resolve();
    f.invoke("onConnect");
    f.invoke("on3dmouseCreated");
    await next;
  });
});
