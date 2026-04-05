# runner

`runner/command.sh` is the shared launcher for llama.cpp server profiles.

## Usage

```bash
./runner/command.sh
./runner/command.sh gemma4
LLAMA_SERVER_BIN=/custom/path/llama-server ./runner/command.sh gemma4
```

## Profile files

Create a new file in `runner/profiles/<name>.conf` with:

```bash
PROFILE_NAME="my-profile"
PROFILE_DESCRIPTION="Optional description"
MODEL_PATH="/path/to/model.gguf"
MMPROJ_PATH=""
ARGS=(
  --temp 0.7
  --top-p 0.95
)
```

## Logs

Logs are written to `runner/logs/<profile>/YYYY-MM-DD.log` while still printing to the console.
Files older than 3 days are removed automatically each time the profile restarts.
