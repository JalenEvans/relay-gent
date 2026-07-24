import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface NotificationHandler {
  onFileChange(filePath: string): void;
  setServer(server: McpServer): void;
}

export function createNotificationHandler(): NotificationHandler {
  let server: McpServer | undefined;

  return {
    onFileChange(filePath: string): void {
      if (server) {
        try {
          const srv = server.server as unknown as Server;
          srv.sendResourceUpdated({ uri: "relay-gent://records" });
        } catch {
          // Server may not be connected yet — silently handle
        }
      }
    },

    setServer(mcpServer: McpServer): void {
      server = mcpServer;
    },
  };
}
