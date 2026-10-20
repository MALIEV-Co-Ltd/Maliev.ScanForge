/** Optional official camera-control provider. Gamepad ownership is managed by the caller. */
export type SpaceMouseDriverClient = Record<string, unknown>;

export interface SpaceMouseDriverSdk {
  connect(): number;
  create3dmouse(view: HTMLElement, appName: string): void;
  delete3dmouse(): void;
  close(): void;
}

export interface SpaceMouseDriverOptions {
  factory?: (
    client: SpaceMouseDriverClient,
  ) => SpaceMouseDriverSdk | Promise<SpaceMouseDriverSdk>;
  onReady?: () => void;
  onLost?: (error: Error) => void;
}

interface Attempt {
  sdk?: SpaceMouseDriverSdk;
  ready: boolean;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort: () => void;
  resolve: () => void;
  reject: (error: Error) => void;
}

let officialModule: Promise<unknown> | undefined;

async function officialFactory(client: SpaceMouseDriverClient) {
  if (!officialModule) {
    if ("ab" in globalThis)
      throw new Error("Another navigation transport is already installed.");
    const url = new URL(
      `${import.meta.env.BASE_URL}vendor/3dconnexion/3dconnexion.module.min.js`,
      document.baseURI,
    ).href;
    officialModule = import(/* @vite-ignore */ url);
  }
  const exports: unknown = await officialModule;
  if (!exports || typeof exports !== "object" || !("_3Dconnexion" in exports))
    throw new Error("Official SpaceMouse driver module is unavailable.");
  const constructor = exports._3Dconnexion;
  if (typeof constructor !== "function")
    throw new Error("Official SpaceMouse driver constructor is unavailable.");
  return new (
    constructor as new (
      callbacks: SpaceMouseDriverClient,
    ) => SpaceMouseDriverSdk
  )(client);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function createSpaceMouseDriver(options: SpaceMouseDriverOptions = {}) {
  let current: Attempt | undefined;
  let disposed = false;
  const owned = new Set<SpaceMouseDriverSdk>();
  const factory = options.factory ?? officialFactory;
  const notifyLost = (error: Error) => {
    if (current) {
      console.error("Previous SpaceMouse driver cleanup failed", error);
      return;
    }
    try {
      options.onLost?.(error);
    } catch (callbackError) {
      console.error("SpaceMouse driver status callback failed", callbackError);
    }
  };

  function release(sdk: SpaceMouseDriverSdk) {
    let deletionError: unknown;
    try {
      sdk.delete3dmouse();
    } catch (error) {
      deletionError = error;
    }
    // Always reach the SDK-local pending-XHR/peer cancellation, even if deletion failed.
    sdk.close();
    owned.delete(sdk);
    if (deletionError) notifyLost(asError(deletionError));
  }

  function stop(attempt: Attempt, reason: Error) {
    if (current === attempt) current = undefined;
    clearTimeout(attempt.timer);
    attempt.signal?.removeEventListener("abort", attempt.abort);
    if (!attempt.settled) {
      attempt.settled = true;
      attempt.reject(reason);
    }
    try {
      if (attempt.sdk) release(attempt.sdk);
    } finally {
      notifyLost(reason);
    }
  }

  function close() {
    let failure: unknown;
    if (current) {
      try {
        stop(current, new Error("SpaceMouse driver connection closed."));
      } catch (error) {
        failure = error;
      }
    } else {
      for (const sdk of owned) {
        try {
          release(sdk);
        } catch (error) {
          failure ??= error;
        }
      }
    }
    if (failure) throw failure;
  }

  function connect(
    canvas: HTMLElement,
    callbacks: SpaceMouseDriverClient,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      close();
      if (disposed) throw new Error("SpaceMouse driver is disposed.");
      if (signal?.aborted)
        throw new Error("SpaceMouse driver connection aborted.");
    } catch (error) {
      return Promise.reject(asError(error));
    }
    return new Promise<void>((resolve, reject) => {
      const attempt: Attempt = {
        ready: false,
        settled: false,
        signal,
        resolve,
        reject,
        abort: () => {
          try {
            stop(attempt, new Error("SpaceMouse driver connection aborted."));
          } catch (error) {
            notifyLost(asError(error));
          }
        },
      };
      current = attempt;
      const active = () => current === attempt && !disposed;
      const fail = (error: unknown) => {
        if (!active()) return;
        try {
          stop(attempt, asError(error));
        } catch (cleanupError) {
          notifyLost(asError(cleanupError));
        }
      };
      const client: SpaceMouseDriverClient = {};
      for (const [name, callback] of Object.entries(callbacks)) {
        client[name] =
          typeof callback === "function"
            ? (...args: unknown[]) =>
                active() ? Reflect.apply(callback, callbacks, args) : undefined
            : callback;
      }
      client.onConnect = () => {
        if (!active()) return;
        try {
          attempt.sdk?.create3dmouse(canvas, "ScanForge");
        } catch (error) {
          fail(error);
        }
      };
      client.on3dmouseCreated = () => {
        if (!active() || attempt.ready) return;
        attempt.ready = true;
        clearTimeout(attempt.timer);
        try {
          options.onReady?.();
          attempt.settled = true;
          attempt.resolve();
        } catch (error) {
          fail(error);
        }
      };
      client.onDisconnect = (reason: unknown) => fail(asError(reason));
      signal?.addEventListener("abort", attempt.abort, { once: true });
      attempt.timer = setTimeout(
        () => fail(new Error("SpaceMouse driver readiness timed out.")),
        10000,
      );
      try {
        Promise.resolve(factory(client))
          .then((sdk) => {
            owned.add(sdk);
            if (!active()) {
              release(sdk);
              return;
            }
            attempt.sdk = sdk;
            if (!sdk.connect())
              fail(new Error("SpaceMouse driver connection could not start."));
          })
          .catch((error: unknown) => {
            if (active()) fail(error);
            else notifyLost(asError(error));
          });
      } catch (error) {
        fail(error);
      }
    });
  }

  return {
    connect,
    close,
    get connected() {
      return current?.ready === true;
    },
    dispose() {
      disposed = true;
      close();
    },
  };
}
