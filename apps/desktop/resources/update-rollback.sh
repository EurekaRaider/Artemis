#!/bin/bash
set -euo pipefail

health_marker="$1"
previous_archive="$2"
application_path="$3"
application_pid="$4"
timeout_seconds="${5:-90}"

if [[ "$previous_archive" != *.zip ]] || [[ ! -f "$previous_archive" ]]; then
  echo "Rollback archive is missing or is not a zip file" >&2
  exit 1
fi
if [[ "$(basename "$application_path")" != "Artemis.app" ]] || [[ ! -d "$application_path" ]]; then
  echo "Rollback target is not an application bundle" >&2
  exit 1
fi
if (( timeout_seconds < 10 || timeout_seconds > 600 )); then
  echo "Rollback timeout is outside the supported range" >&2
  exit 1
fi

for (( elapsed=0; elapsed<timeout_seconds; elapsed+=1 )); do
  [[ -f "$health_marker" ]] && exit 0
  sleep 1
done
[[ -f "$health_marker" ]] && exit 0

staging_directory="$(mktemp -d "${TMPDIR:-/tmp}/artemis-rollback.XXXXXX")"
backup_path="${application_path}.failed-update"
cleanup() {
  rm -rf "$staging_directory"
}
trap cleanup EXIT

/usr/bin/ditto -x -k "$previous_archive" "$staging_directory"
restored_app="$(find "$staging_directory" -maxdepth 2 -name 'Artemis.app' -type d -print -quit)"
if [[ -z "$restored_app" ]]; then
  echo "Rollback archive does not contain Artemis.app" >&2
  exit 1
fi
/usr/bin/codesign --verify --deep --strict "$restored_app"

if kill -0 "$application_pid" 2>/dev/null; then
  kill "$application_pid"
  for _ in {1..10}; do
    kill -0 "$application_pid" 2>/dev/null || break
    sleep 1
  done
fi

rm -rf "$backup_path"
mv "$application_path" "$backup_path"
if ! mv "$restored_app" "$application_path"; then
  mv "$backup_path" "$application_path"
  exit 1
fi
if [[ "${ARTEMIS_ROLLBACK_NO_LAUNCH:-0}" != "1" ]]; then
  /usr/bin/open "$application_path"
fi
exit 2
