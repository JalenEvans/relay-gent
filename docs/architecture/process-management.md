# Process Management

The `ProcessManager` class in `src/process.ts` manages the lifecycle of background watcher processes. It handles starting, stopping, monitoring, and cleaning up target processes that run as detached Bun processes.

## Overview

`ProcessManager` operates on a **base directory** (default: `~/.relay-gent/targets/`), where each target has its own subdirectory containing:

- `pid` — a file containing the process ID of the running watcher
- `state.json` — a JSON file with delivery tracking data (e.g., `{ "total_delivered": 42 }`)
- `log` — a log file capturing output from the watcher process

```
~/.relay-gent/targets/
  my-app/
    pid         # "12345"
    state.json  # { "total_delivered": 10 }
    log         # [2024-01-01T00:00:00Z] File changed...
  another-target/
    pid
    state.json
    log
```

## PID File Lifecycle

PID files are the core mechanism for tracking process ownership:

1. **Created** — when `start()` spawns a new process, the PID is written to `<baseDir>/<name>/pid`
2. **Checked** — `stop()` reads the PID file to determine which process to signal; `status()` reads it to determine runtime state
3. **Cleaned up** — when a stale PID file is detected (process is dead but PID file exists), `cleanTarget()` removes the target directory
4. **Absent** — if no PID file exists, the target is considered `"stopped"` (or was never started)

## TargetStatus States

Each target can be in one of three states, as defined by the `TargetStatus` interface:

| State | Meaning |
|-------|---------|
| `"running"` | PID file exists, PID is finite and positive, and the process is alive (`process.kill(pid, 0)` succeeds) |
| `"stopped"` | No PID file exists, or PID file exists but process is dead and PID is valid |
| `"stale"` | PID file exists but the PID is not finite/positive, or PID file exists and process is dead (indicates an unclean shutdown) |

## Class: ProcessManager

```typescript
class ProcessManager {
  constructor(private readonly baseDir: string);
}
```

### Constructor

Creates a new `ProcessManager` instance managing processes in `baseDir`.

```typescript
const pm = new ProcessManager("~/.relay-gent/targets");
```

### Methods

#### `start(name: string): Promise<void>`

Spawns a new background watcher process for the named target.

1. Creates the target directory if it does not exist
2. Checks for an existing PID file:
   - If a PID file exists and the process is alive, throws `"target already running"`
   - If a PID file exists but the process is dead (stale), cleans up the target directory and re-creates it
3. Spawns `bun run src/runner-worker.ts <name>` as a detached Bun process
4. Writes the spawned process's PID to `<baseDir>/<name>/pid`

**Throws** `Error("target already running")` if the target already has a live process.

#### `stop(name: string): Promise<void>`

Gracefully stops a running watcher process.

1. Reads the PID file
2. If the PID file does not exist (ENOENT), returns silently (target already stopped)
3. Sends `SIGTERM` to the process
   - If the process is already dead (ESRCH error code), continues with cleanup
   - Re-throws unexpected errors (e.g., permission errors)
4. Waits 2 seconds for graceful shutdown (`setTimeout`)
5. Removes the entire target directory recursively

**Error handling:** ENOENT on PID file read is silently ignored (target already stopped). ESRCH on `process.kill` is silently ignored (process already dead). Other errors are re-thrown.

#### `stopAll(): Promise<string[]>`

Stops all currently running targets.

1. Calls `status()` to enumerate all targets
2. For each target with state `"running"`, calls `stop()`
3. Returns an array of target names that were successfully stopped

**Error handling:** Individual `stop()` failures are caught and skipped — a single failing target does not prevent stopping others.

#### `status(): Promise<TargetStatus[]>`

Returns the current state of all targets.

1. Reads directory entries from the base directory
2. For each entry, reads the `pid` file and `state.json`
3. Determines state:
   - No PID file → `"stopped"` (PID is `null`)
   - PID file exists, PID is finite/positive, process alive → `"running"`
   - PID file exists, PID is finite/positive, process dead → `"stale"`
   - PID file exists, PID is not finite/positive → `"stale"` (PID is `null`)
4. Parses `state.json` for `total_delivered` (defaults to `0` if missing or invalid)

Returns an empty array if the base directory does not exist.

#### `cleanTarget(name: string): Promise<void>`

Removes the target directory recursively.

```typescript
await pm.cleanTarget("my-app");
// Removes ~/.relay-gent/targets/my-app/
```

Uses `rm(path, { recursive: true, force: true })` — never throws on non-existent directories.

#### `readLog(name: string, lines = 50): Promise<string>`

Reads the last `N` lines from the target's `log` file.

```typescript
const log = await pm.readLog("my-app", 100);
```

- Returns the last `lines` lines (default 50)
- Returns an empty string if the log file does not exist (ENOENT)
- Returns an empty string if the log file exists but is empty
- Re-throws unexpected errors (permission denied, etc.)

#### `clearLog(name: string): Promise<void>`

Truncates the target's log file to empty. Creates an empty log file if none existed.

```typescript
await pm.clearLog("my-app");
```

#### `readAllLogs(linesPerTarget = 50): Promise<string>`

Reads logs from all targets, concatenated with headers.

Each section is formatted as:
```
=== targetName ===
<log content>
```

- Targets are sorted alphabetically
- Only targets with non-empty log content are included
- Returns an empty string if no targets have logs
- Returns an empty string if the base directory does not exist

#### `isAlive(pid: number): boolean`

Checks whether a process ID is alive using `process.kill(pid, 0)`.

- Returns `true` if the process exists (signal 0 succeeds)
- Returns `false` if the process does not exist (ESRCH)
- Returns `false` if the PID is not finite or not positive
- Re-throws unexpected errors (permission errors, etc.)

#### `getPidPath(name: string): string`

Returns the expected PID file path for a target:

```typescript
pm.getPidPath("my-app");
// Returns: "<baseDir>/my-app/pid"
```

## Error Handling Notes

| Scenario | Behavior |
|----------|----------|
| `start()` on already-running target | Throws `Error("target already running")` |
| `stop()` with no PID file | Silently returns (target already stopped) |
| `stop()` with already-dead process | Silently continues with cleanup |
| `stopAll()` with a failing stop | Skips the failing target, continues with others |
| `status()` with missing base dir | Returns empty array |
| `readLog()` with missing log file | Returns empty string |
| `readLog()` with permission error | Re-throws the error |
| `status()` with invalid PID file | Reports target as `"stale"` |
| `status()` with missing `state.json` | Reports `delivered: 0` |
