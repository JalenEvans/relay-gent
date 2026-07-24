import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface NotificationHandler {
  onFileChange(filePath: string): void;
  setServer(server: McpServer): void;
}

export function createNotificationHandler(): NotificationHandler {
  let server: McpServer | undefined;

  return {
    onFileChange(filePath: string): void {
      // Send notification if we have a server connection
      if (server) {
        try {
          // Attempt to send resource updated notification
          // Uses the low-level server API from the McpServer instance
          // biome-ignore lint/suspicious/noExplicitAny: accessing low-level Server from McpServer wrapper
          const srv = (server as any).server;
          if (srv && typeof srv.sendResourceUpdated === "function") {
            srv.sendResourceUpdated("relay-gent://records");
          }
        } catch {
          // Silently handle — server may not be connected yet
        }
      }
    },

    setServer(mcpServer: McpServer): void {
      server = mcpServer;
    },
  };
}
