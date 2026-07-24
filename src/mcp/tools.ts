import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import type { RecordStore } from "../state/record-store.js";
import type { WatcherManager } from "../watcher/manager.js";

export function registerTools(
  server: McpServer,
  watcher: WatcherManager,
  store: RecordStore,
): void {
  // watch_file: Start watching a file for changes and relay its contents
  server.registerTool(
    "watch_file",
    {
      description: "Start watching a file for changes and relay its contents",
      inputSchema: z.object({
        path: z.string().describe("Absolute path or glob pattern to watch"),
        options: z
          .object({
            origin: z.enum(["single-file", "glob", "directory"]).optional(),
            pattern: z.string().optional(),
          })
          .optional()
          .describe("Watch configuration options"),
      }),
    },
    async ({ path, options }) => {
      try {
        await watcher.watchFile(path, options);
        return {
          content: [{ type: "text" as const, text: `Watching: ${path}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error watching ${path}: ${error}` }],
          isError: true,
        };
      }
    },
  );

  // unwatch_file: Stop watching a file
  server.registerTool(
    "unwatch_file",
    {
      description: "Stop watching a file",
      inputSchema: z.object({
        path: z.string().describe("Absolute path to the file to stop watching"),
      }),
    },
    async ({ path }) => {
      try {
        await watcher.unwatchFile(path);
        return {
          content: [{ type: "text" as const, text: `Stopped watching: ${path}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error unwatching ${path}: ${error}` }],
          isError: true,
        };
      }
    },
  );

  // get_records: Get all tracked records
  server.registerTool(
    "get_records",
    {
      description: "Get all tracked records",
      inputSchema: z.object({}),
    },
    async () => {
      const records = store.getAllRecords();
      const entries = Object.entries(records);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: entries.length, records: entries.slice(0, 100) },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // get_status: Get watcher and store status
  server.registerTool(
    "get_status",
    {
      description: "Get current watcher and record store status",
      inputSchema: z.object({}),
    },
    async () => {
      const watchedPaths = watcher.getWatchedPaths();
      const totalDelivered = store.totalDelivered;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                watchedPaths,
                watcherCount: watchedPaths.length,
                totalDelivered,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
