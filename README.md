# llama-runner

Node.js based llama.cpp launcher with:

- cross-platform execution on Windows and Linux
- model sync from a configurable GGUF root
- interactive model selection and preset selection
- editable JSON model files with preserved user args
- daily rotating logs with 3-day retention

## Commands

```bash
node src/cli.js sync
node src/cli.js run
node src/cli.js run --model gemma-4-31b-it-q4-k-m --preset coding
```

You can also use:

```bash
npm run sync
npm run run
```

`command.sh` now just forwards to the Node launcher for compatibility.

## Settings

Global settings live in `config/settings.jsonc`.

- `modelsRoot`: GGUF base directory to scan
- `logsRetentionDays`: delete old logs after this many days
- `restartDelaySeconds`: delay before auto restart
- `llamaCppDir`: optional llama.cpp build directory containing `llama-server`
- `llamaServerBin`: optional explicit binary path. This takes precedence over `llamaCppDir`
- `commonArgs`: shared llama-server arguments

## Models

Run `sync` to scan `modelsRoot` and generate `models/*.jsonc`.

Each model file keeps:

- `paths` and `detected`: updated by sync
- `user.args`: preserved for your manual llama-server overrides
- `user.enabled`: hide a model from the launcher without deleting it

`run` will sync first, then show:

1. model selection
2. preset selection

Right before spawning `llama-server`, it reloads the selected model JSON and preset JSON, so edits are picked up on the next start without restarting the launcher itself.

## Presets

Presets live in `presets/*.jsonc`.

- `general.json`
- `coding.json`

You can add more presets by creating another JSONC file with `key`, `displayName`, and `args`.

Config files support JSONC comments and also still read legacy `.json` files when present.
