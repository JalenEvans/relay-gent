import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface NotificationHandler {
  onFileChange(filePath: string): void;
  setServer(server: McpServer): void;
  lastChangedPath?: string;
}

export function createNotificationHandler(): NotificationHandler {
  let server: McpServer | undefined;
  let lastChangedPath: string | undefined;

  return {
    onFileChange(filePath: string): void {
      lastChangedPath = filePath;
      if (server) {
        const srv = server.server as unknown as Server;
        srv
          .sendResourceUpdated({
            uri: `relay-gent://records?changed=${encodeURIComponent(filePath)}`,
          })
          .catch(() => {
            // Server may not be connected yet — silently handle
          });
      }
    },

    setServer(mcpServer: McpServer): void {
      server = mcpServer;
    },

    get lastChangedPath(): string | undefined {
      return lastChangedPath;
    },

    set lastChangedPath(value: string | undefined) {
      lastChangedPath = value;
    },
  };
}
