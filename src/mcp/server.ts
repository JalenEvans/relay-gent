import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RecordStore } from "../state/record-store.js";
import { WatcherManager } from "../watcher/manager.js";
import { createNotificationHandler } from "./notifications.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";

export interface AppComponents {
  server: McpServer;
  watcher: WatcherManager;
  store: RecordStore;
}

export function createApp(name = "relay-gent", version = "0.1.0"): AppComponents {
  const server = new McpServer({ name, version });
  const watcher = new WatcherManager();
  const store = new RecordStore("relay-gent");
  const notificationHandler = createNotificationHandler();

  // Wire the notification handler to the server
  notificationHandler.setServer(server);

  // Register tools and resources — they receive watcher + store
  registerTools(server, watcher, store);
  registerResources(server, watcher, store);

  return { server, watcher, store };
}

export async function startServer(): Promise<void> {
  const { server } = createApp();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
