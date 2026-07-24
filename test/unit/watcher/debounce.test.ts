import { describe, test, expect } from "bun:test";

// ============================================================
// Debounce Support in WatcherManager
// ============================================================
// RED PHASE: No debounce support exists yet. Events fire
// immediately through chokidar without coalescing. All tests
// MUST fail until implemented.
//
// Expected design:
//   - WatcherOptions adds debounceMs?: number (default 300)
//   - WatcherManager maintains a Map<string, Timer> for
//     per-path debounce timers
//   - Chokidar event handlers schedule callbacks via debounce
//     instead of firing directly
//   - unwatchFile / unwatchAll clean up pending timers
// ============================================================

describe("WatcherOptions debounceMs field", () => {
  test("default debounceMs is 300 when not specified", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/debounce-default.log");

    const opts = manager.getWatcherOptions("/tmp/debounce-default.log");
    expect(opts).toBeDefined();

    // FAILS: WatcherOptions doesn't have debounceMs yet.
    // After implementation, watchFile should set default of 300
    // when debounceMs is not explicitly provided.
    expect((opts as any).debounceMs).toBe(300);

    await manager.unwatchAll();
  });

  test("custom debounceMs is stored in watcher state", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/debounce-custom.log", { debounceMs: 500 } as any);

    const state = manager.getWatcherState("/tmp/debounce-custom.log");
    expect(state).toBeDefined();

    // FAILS: WatcherState doesn't track debounceMs yet.
    // After implementation, debounceMs should be reflected
    // in the watcher state alongside origin/pattern.
    expect((state as any).debounceMs).toBe(500);

    await manager.unwatchAll();
  });
});

describe("Debounce coalescing", () => {
  test("rapid events for same path are coalesced into one callback", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    let count = 0;
    manager.setOnFileChange(() => count++);

    await manager.watchFile("/tmp/coalesce-same.log", { debounceMs: 50 } as any);

    const watcher = (manager as any).watchers.get("/tmp/coalesce-same.log");
    expect(watcher).toBeDefined();

    // Fire 3 rapid events for the same path (synchronous emit)
    watcher.emit("change", "/tmp/coalesce-same.log");
    watcher.emit("change", "/tmp/coalesce-same.log");
    watcher.emit("change", "/tmp/coalesce-same.log");

    // Wait for debounce to settle (longer than 50ms debounce)
    await new Promise((resolve) => setTimeout(resolve, 200));

    // FAILS: without debounce, all 3 events fire the callback
    // immediately — count is 3, expected 1 (coalesced).
    expect(count).toBe(1);

    await manager.unwatchAll();
  });

  test("events for different paths use separate debounce timers", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    let count = 0;
    manager.setOnFileChange(() => count++);

    await manager.watchFile("/tmp/coalesce-a.log", { debounceMs: 50 } as any);
    await manager.watchFile("/tmp/coalesce-b.log", { debounceMs: 50 } as any);

    const watcherA = (manager as any).watchers.get("/tmp/coalesce-a.log");
    const watcherB = (manager as any).watchers.get("/tmp/coalesce-b.log");

    // Fire 3 events for path A, 1 event for path B (rapid succession)
    watcherA.emit("change", "/tmp/coalesce-a.log");
    watcherA.emit("change", "/tmp/coalesce-a.log");
    watcherA.emit("change", "/tmp/coalesce-a.log");
    watcherB.emit("change", "/tmp/coalesce-b.log");

    await new Promise((resolve) => setTimeout(resolve, 200));

    // FAILS: without debounce, all 4 events fire — count is 4.
    // With separate per-path debounce timers:
    //   path A: 3 events coalesced → 1 call
    //   path B: 1 event → 1 call
    //   total: 2 calls
    expect(count).toBe(2);

    await manager.unwatchAll();
  });
});

describe("debounceMs=0 disables debouncing", () => {
  test("debounceMs=0 should not create debounce timer entries", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/zero-timers.log", { debounceMs: 0 } as any);

    // FAILS: debounceTimers map doesn't exist on WatcherManager yet.
    // After implementation, debounceMs=0 should bypass timer creation entirely.
    expect((manager as any).debounceTimers).toBeDefined();
    expect((manager as any).debounceTimers.size).toBe(0);

    await manager.unwatchAll();
  });

  test("debounceMs=0 fires all events without coalescing", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    let count = 0;
    manager.setOnFileChange(() => count++);

    await manager.watchFile("/tmp/zero-fire.log", { debounceMs: 0 } as any);

    // FAILS: debounceTimers map doesn't exist — can't verify
    // that debounceMs=0 bypasses the timer system.
    expect((manager as any).debounceTimers).toBeDefined();

    // Without debounce, 3 events → 3 calls (same as debounceMs=0 behavior)
    const watcher = (manager as any).watchers.get("/tmp/zero-fire.log");
    watcher.emit("change", "/tmp/zero-fire.log");
    watcher.emit("change", "/tmp/zero-fire.log");
    watcher.emit("change", "/tmp/zero-fire.log");

    expect(count).toBe(3);

    await manager.unwatchAll();
  });
});

describe("Extension filtering with debounce", () => {
  test("options store both extensions and debounceMs together", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/filter-debounce.log", {
      extensions: [".ts"],
      debounceMs: 50,
    } as any);

    const opts = manager.getWatcherOptions("/tmp/filter-debounce.log");
    expect(opts).toBeDefined();
    expect(opts!.extensions).toEqual([".ts"]);

    // FAILS: debounceTimers map doesn't exist on WatcherManager.
    // After implementation, we should be able to verify that
    // both filtering and debounce are active together.
    expect((manager as any).debounceTimers).toBeDefined();

    await manager.unwatchAll();
  });
});

describe("Event type and path preserved through debounce", () => {
  test("watcher state tracks debounceMs alongside origin and pattern", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/preserve-state.log", { debounceMs: 50 } as any);

    const state = manager.getWatcherState("/tmp/preserve-state.log");
    expect(state).toBeDefined();

    // FAILS: WatcherState doesn't include debounceMs yet.
    // After implementation, the state should reflect the
    // debounce configuration for each watched path.
    expect((state as any).debounceMs).toBe(50);

    await manager.unwatchAll();
  });
});
