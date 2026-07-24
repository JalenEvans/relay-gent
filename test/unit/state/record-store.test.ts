import { describe, test, expect, beforeEach } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

describe("RecordStore", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "record-store-test-"));
  });

  test("can be imported from src/state/record-store", async () => {
    const mod = await import("../../../src/state/record-store");
    expect(mod).toBeDefined();
    expect(mod.RecordStore).toBeDefined();
  });

  test("RecordStore is a class", async () => {
    const { RecordStore } = await import("../../../src/state/record-store");
    expect(typeof RecordStore).toBe("function");
  });

  test("can be instantiated with a name", async () => {
    const { RecordStore } = await import("../../../src/state/record-store");
    const store = new RecordStore("test-store", tmpDir);
    expect(store).toBeDefined();
  });

  test("stores and retrieves records", async () => {
    const { RecordStore } = await import("../../../src/state/record-store");
    const store = new RecordStore("test-store", tmpDir);
    
    const record = { id: "1", type: "test", data: "hello" };
    store.set("key1", record as any);
    
    const result = store.get("key1");
    expect(result).toBeDefined();
    expect(result).toEqual(record);
  });

  test("replace-on-change: setting same key overwrites", async () => {
    const { RecordStore } = await import("../../../src/state/record-store");
    const store = new RecordStore("test-store", tmpDir);
    
    store.set("key1", { id: "1", value: "old" });
    store.set("key1", { id: "1", value: "new" });
    
    const result = store.get("key1");
    expect(result).toEqual({ id: "1", value: "new" });
  });

  test("getAllRecords returns all stored records", async () => {
    const { RecordStore } = await import("../../../src/state/record-store");
    const store = new RecordStore("test-store", tmpDir);
    
    store.set("key1", { id: "1" });
    store.set("key2", { id: "2" });
    
    const all = store.getAllRecords();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all.key1).toEqual({ id: "1" });
    expect(all.key2).toEqual({ id: "2" });
  });

  test("persists and loads state across sessions", async () => {
    const { RecordStore } = await import("../../../src/state/record-store");
    
    const store1 = new RecordStore("persist-test", tmpDir);
    store1.set("key1", { id: "1" });
    await store1.save();
    
    const store2 = new RecordStore("persist-test", tmpDir);
    await store2.load();
    
    const result = store2.get("key1");
    expect(result).toEqual({ id: "1" });
  });

  test("has totalDelivered counter", async () => {
    const { RecordStore } = await import("../../../src/state/record-store");
    const store = new RecordStore("counter-test", tmpDir);
    
    expect(store.totalDelivered).toBe(0);
    store.set("key1", { id: "1" });
    expect(store.totalDelivered).toBe(1);
    store.set("key2", { id: "2" });
    expect(store.totalDelivered).toBe(2);
    // Overwrite doesn't increment
    store.set("key1", { id: "1-updated" });
    expect(store.totalDelivered).toBe(2);
  });
});
