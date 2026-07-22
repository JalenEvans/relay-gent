# Environment Variables

relay-gent supports configuration via environment variables with the prefix `RELAY_GENT_`. These override values in the config file but are overridden by CLI flags.

## Precedence

CLI flags > Environment variables > Config file > Schema defaults

## Global Configuration

### RELAY_GENT_DEFAULT_ADAPTER

Default adapter name for targets that don't specify one.

- **Type:** string
- **Default:** `"opencode"` (ConfigSchema default)
- **Example:** `RELAY_GENT_DEFAULT_ADAPTER=raw-command`

### RELAY_GENT_DEFAULTS_DEBOUNCE_MS

Default debounce window in milliseconds.

- **Type:** number
- **Default:** 300
- **Example:** `RELAY_GENT_DEFAULTS_DEBOUNCE_MS=1000`

### RELAY_GENT_DEFAULTS_MAX_RETRIES

Maximum delivery retry attempts.

- **Type:** number
- **Default:** 3
- **Example:** `RELAY_GENT_DEFAULTS_MAX_RETRIES=5`

### RELAY_GENT_DEFAULTS_RETRY_BACKOFF_MS

Base backoff period in milliseconds between retries.

- **Type:** number
- **Default:** 1000
- **Example:** `RELAY_GENT_DEFAULTS_RETRY_BACKOFF_MS=2000`

## Per-Target Configuration

Use the pattern `RELAY_GENT_TARGET_<NAME>_<FIELD>` to override fields on individual targets. `<NAME>` is the target name converted to SCREAMING_SNAKE_CASE.

### Supported Fields

| Env Suffix | Config Field | Type | Example |
|---|---|---|---|
| `ADAPTER` | `adapter` | string | `RELAY_GENT_TARGET_MY_APP_ADAPTER=codex` |
| `WATCH_PATH` | `watchPath` | string | `RELAY_GENT_TARGET_MY_APP_WATCH_PATH=./data.json` |
| `PARSER` | `parser` | string | `RELAY_GENT_TARGET_MY_APP_PARSER=json-lines` |
| `DEBOUNCE_MS` | `debounceMs` | number | `RELAY_GENT_TARGET_MY_APP_DEBOUNCE_MS=500` |
| `COMMAND` | `command` | string | `RELAY_GENT_TARGET_MY_APP_COMMAND=echo hello` |
| `SHELL` | `shell` | boolean | `RELAY_GENT_TARGET_MY_APP_SHELL=true` |
| `SESSION_ID` | `session_id` | string | `RELAY_GENT_TARGET_MY_APP_SESSION_ID=abc123` |
| `SERVER_URL` | `server_url` | string | `RELAY_GENT_TARGET_MY_APP_SERVER_URL=http://localhost:4096` |

### Example

```bash
export RELAY_GENT_TARGET_LOGS_ADAPTER=raw-command
export RELAY_GENT_TARGET_LOGS_WATCH_PATH=./app.log
export RELAY_GENT_TARGET_LOGS_PARSER=json-lines
export RELAY_GENT_TARGET_LOGS_COMMAND="curl -X POST -d @- https://logs.example.com/ingest"
```

This is equivalent to a TOML config:

```toml
[targets.logs]
adapter = "raw-command"
watchPath = "./app.log"
parser = "json-lines"
command = "curl -X POST -d @- https://logs.example.com/ingest"
```

### Target Name Conversion

Target names in TOML config (e.g. `my-app`) are uppercased and hyphen-to-underscore converted for env var usage: `my-app` → `MY_APP`, `myTarget` → `MYTARGET`.

**Note:** Some fields are adapter-specific. `SESSION_ID` is used by the `opencode`, `codex`, and `claude` adapters. `SERVER_URL` is used by the `opencode` adapter. `COMMAND` and `SHELL` are used by the `raw-command` adapter. Setting a field that doesn't apply to a target's adapter has no effect.

## Validation

Numeric env vars (e.g. `DEBOUNCE_MS`) are validated and throw a descriptive error if the value is not a valid number. Boolean env vars (e.g. `SHELL`) accept only the exact lowercase string `"true"` (case-sensitive). Any other value — including `"True"`, `"TRUE"`, `"yes"`, `"1"`, or an empty string — is treated as `false`.
