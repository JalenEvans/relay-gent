import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RecordStore } from "../state/record-store.js";
import type { WatcherManager } from "../watcher/manager.js";

export function registerResources(
  server: McpServer,
  watcher: WatcherManager,
  store: RecordStore,
): void {
  // relay-gent://records — all tracked records
  server.resource(
    "relay-gent-records",
    "relay-gent://records",
    {
      title: "📦 All Records",
      description: "All records tracked by relay-gent",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "relay-gent://records",
          mimeType: "application/json",
          text: JSON.stringify(store.getAllRecords(), null, 2),
        },
      ],
    }),
  );

  // relay-gent://status — watcher and store status
  server.resource(
    "relay-gent-status",
    "relay-gent://status",
    {
      title: "📊 Relay-Gent Status",
      description: "Current watcher and record store status",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "relay-gent://status",
          mimeType: "application/json",
          text: JSON.stringify(
            {
              watchedPaths: watcher.getWatchedPaths(),
              watching: watcher.getWatchedPaths().length,
              totalDelivered: store.totalDelivered,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );
}
