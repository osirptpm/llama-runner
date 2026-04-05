#!/usr/bin/env bash

set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILES_DIR="$SCRIPT_DIR/profiles"
LOGS_DIR="$SCRIPT_DIR/logs"
RESTART_DELAY_SECONDS="${RESTART_DELAY_SECONDS:-3}"

COMMON_ARGS=(
  --host 0.0.0.0
  --port 11435
  -c 65536
  -ngl all
  -ub 512
  -t 8
  --n-cpu-moe 4
  -ctk q4_0
  -ctv q4_0
  -fa on
  --prio 2
  --poll 1
  --numa distribute
  -np 1
  --cache-ram 0
)

print_error() {
  printf 'Error: %s\n' "$*" >&2
}

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

current_log_file() {
  date '+%Y-%m-%d.log'
}

detect_llama_server_bin() {
  if [[ -n "${LLAMA_SERVER_BIN:-}" ]]; then
    printf '%s\n' "$LLAMA_SERVER_BIN"
    return
  fi

  if [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* || "$OSTYPE" == win32* ]]; then
    printf 'llama-server.exe\n'
  else
    printf 'llama-server\n'
  fi
}

log_directory_for_profile() {
  local profile_key="$1"
  printf '%s/%s\n' "$LOGS_DIR" "$profile_key"
}

write_log_line() {
  local profile_key="$1"
  local line="$2"
  local profile_log_dir
  local log_path

  profile_log_dir="$(log_directory_for_profile "$profile_key")"
  mkdir -p "$profile_log_dir"
  log_path="$profile_log_dir/$(current_log_file)"
  printf '%s\n' "$line" >> "$log_path"
}

announce() {
  local profile_key="$1"
  local message="$2"
  local line

  line="[$(timestamp)] $message"
  printf '%s\n' "$line"
  write_log_line "$profile_key" "$line"
}

cleanup_old_logs() {
  local profile_key="$1"
  local profile_log_dir

  profile_log_dir="$(log_directory_for_profile "$profile_key")"
  mkdir -p "$profile_log_dir"
  find "$profile_log_dir" -type f -name '*.log' -mtime +3 -delete 2>/dev/null || true
}

stream_with_daily_rotation() {
  local profile_key="$1"
  local line

  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s\n' "$line"
    write_log_line "$profile_key" "$line"
  done
}

clear_profile_vars() {
  unset PROFILE_NAME PROFILE_DESCRIPTION MODEL_PATH MMPROJ_PATH
  unset ARGS
}

load_profile() {
  local profile_key="$1"
  local profile_path="$PROFILES_DIR/$profile_key.conf"

  if [[ ! -f "$profile_path" ]]; then
    return 1
  fi

  clear_profile_vars
  # shellcheck disable=SC1090
  source "$profile_path"

  if [[ -z "${PROFILE_NAME:-}" || -z "${MODEL_PATH:-}" ]]; then
    print_error "Profile '$profile_key' is missing PROFILE_NAME or MODEL_PATH."
    exit 1
  fi

  if [[ "$(declare -p ARGS 2>/dev/null)" != declare\ -a* ]]; then
    print_error "Profile '$profile_key' must define ARGS as a Bash array."
    exit 1
  fi

  return 0
}

list_profile_keys() {
  local profile_path
  local found=0

  for profile_path in "$PROFILES_DIR"/*.conf; do
    if [[ -f "$profile_path" ]]; then
      found=1
      basename "$profile_path" .conf
    fi
  done

  if [[ "$found" -eq 0 ]]; then
    return 1
  fi
}

print_available_profiles() {
  local profile_key
  local description

  printf 'Available profiles:\n'
  while IFS= read -r profile_key; do
    load_profile "$profile_key"
    description="${PROFILE_DESCRIPTION:-$PROFILE_NAME}"
    printf '  - %s: %s\n' "$profile_key" "$description"
  done < <(list_profile_keys)
}

select_profile_key() {
  local profile_keys=()
  local profile_key
  local idx=1
  local answer

  while IFS= read -r profile_key; do
    profile_keys+=("$profile_key")
  done < <(list_profile_keys)

  if [[ "${#profile_keys[@]}" -eq 0 ]]; then
    print_error "No profile files were found in $PROFILES_DIR."
    exit 1
  fi

  printf 'Select a profile:\n' >&2
  for profile_key in "${profile_keys[@]}"; do
    load_profile "$profile_key"
    printf '  %d) %s - %s\n' "$idx" "$profile_key" "${PROFILE_DESCRIPTION:-$PROFILE_NAME}" >&2
    idx=$((idx + 1))
  done

  while true; do
    printf 'Enter number: ' >&2
    IFS= read -r answer

    if [[ "$answer" =~ ^[0-9]+$ ]] && (( answer >= 1 && answer <= ${#profile_keys[@]} )); then
      printf '%s\n' "${profile_keys[answer - 1]}"
      return 0
    fi

    printf 'Invalid selection.\n' >&2
  done
}

run_server_forever() {
  local profile_key="$1"
  local server_bin="$2"
  local cmd=()
  local status

  while true; do
    cleanup_old_logs "$profile_key"

    cmd=("$server_bin" -m "$MODEL_PATH")
    if [[ -n "${MMPROJ_PATH:-}" ]]; then
      cmd+=(--mmproj "$MMPROJ_PATH")
    fi
    cmd+=("${COMMON_ARGS[@]}")
    cmd+=("${ARGS[@]}")

    announce "$profile_key" "Starting profile '$profile_key' with '$server_bin'."
    "${cmd[@]}" 2>&1 | stream_with_daily_rotation "$profile_key"
    status=${PIPESTATUS[0]}
    announce "$profile_key" "Profile '$profile_key' exited with code $status. Restarting in ${RESTART_DELAY_SECONDS}s."
    sleep "$RESTART_DELAY_SECONDS"
  done
}

main() {
  local profile_key="${1:-}"
  local server_bin

  mkdir -p "$PROFILES_DIR" "$LOGS_DIR"

  if [[ -z "$profile_key" ]]; then
    profile_key="$(select_profile_key)"
  fi

  if ! load_profile "$profile_key"; then
    print_error "Unknown profile '$profile_key'."
    print_available_profiles >&2 || true
    exit 1
  fi

  server_bin="$(detect_llama_server_bin)"
  run_server_forever "$profile_key" "$server_bin"
}

main "$@"
