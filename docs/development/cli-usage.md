# CLI Usage Reference

## Synopsis

```
relay-gent [command] [options]
```

## Configuration

### Config File

Configuration is auto-loaded from `~/.relay-gent/config.toml`. Example:

```toml
defaultAdapter = "opencode"

[targets.my-app]
adapter = "opencode"
watchPath = "./data.ndjson"
parser = "json-lines"

[targets.my-app.defaults]
debounceMs = 500
```

### Config Precedence

CLI flags > Environment variables > Config file > Schema defaults

### Environment Variables

See [Environment Variables Reference](../reference/environment-variables.md)

## Commands

### status (default)

`relay-gent` or `relay-gent status`

Shows a live dashboard of all configured targets with their adapter, watch path, current status (running, stopped, or stale), PID, and delivery counts.

### watch

`relay-gent watch <file> --target <name>`

Starts watching a file for changes using chokidar. The `--target` flag is required — it specifies which configured target's parser and adapter to use. On each change, the pipeline runs:

1. Parse the file content
2. Compute deltas against previous state
3. Deliver new/changed records to the target adapter

The process stays alive until interrupted (Ctrl+C).

- `--background` — Fork watcher to background (daemonize). Returns immediately to prompt.

### once

`relay-gent once <file> --target <name>`

One-shot execution. The `--target` flag is required — it specifies which configured target's parser and adapter to use. Parses the file, computes deltas, delivers records, then exits.

### stop

`relay-gent stop --target <name>` or `relay-gent stop --all`

Stops running watcher processes.

- `stop --target <name>` — sends SIGTERM to the watcher process, waits for graceful shutdown (up to 2s), then removes the target's state directory
- `stop --all` — stops all running watchers

### clean

`relay-gent clean [--force]`

Removes stale target state directories under `~/.relay-gent/targets/`.

- With `--force`: immediately removes state for all configured targets
- Without `--force`: prompts to use `--force`

### log

`relay-gent log [--target <name>] [--clear]`

View or clear per-target logs stored at `~/.relay-gent/targets/<name>/log`.

- Without flags: lists all targets that have log files
- `--target <name>`: prints the log content for that target
- `--target <name> --clear`: truncates the log file

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (invalid args, missing target in config, file not found, adapter/parser not found) |
