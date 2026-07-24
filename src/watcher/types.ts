/** Callback signature for file change events */
export type FileChangeCallback = (event: string, path: string) => void;

/** Options for configuring a watch */
export interface WatcherOptions {
  origin?: "single-file" | "glob" | "directory";
  pattern?: string;
}

export interface WatcherState {
  path: string;
  active: boolean;
  startedAt: string;
  origin?: "single-file" | "glob" | "directory";
  pattern?: string;
}
