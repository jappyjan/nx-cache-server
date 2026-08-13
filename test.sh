#!/usr/bin/env bash
# Protocol check. Run: ./test.sh
set -euo pipefail

DIR=$(mktemp -d)
CACHE_DIR="$DIR" PORT=39999 TOKEN_RW=rw TOKEN_RO=ro node server.mjs &
PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$DIR"' EXIT
until curl -sf localhost:39999/health >/dev/null; do sleep 0.1; done

code() { curl -s -o "${2:-/dev/null}" -w '%{http_code}' "${@:3}" "localhost:39999/v1/cache/$1"; }
check() { [ "$1" = "$2" ] || { echo "FAIL: expected $2, got $1 ($3)"; exit 1; }; echo "ok: $3"; }

check "$(code abc /dev/null -H 'Authorization: Bearer ro')" 404 "miss -> 404"
check "$(code abc /dev/null -X PUT --data-binary 'hello' -H 'Authorization: Bearer ro')" 403 "read-only PUT -> 403"
check "$(code abc /dev/null -X PUT --data-binary 'hello' -H 'Authorization: Bearer rw')" 202 "PUT -> 202"
check "$(code abc /dev/null -X PUT --data-binary 'evil' -H 'Authorization: Bearer rw')" 409 "overwrite -> 409"
check "$(code abc "$DIR/got" -H 'Authorization: Bearer ro')" 200 "hit -> 200"
check "$(cat "$DIR/got")" hello "body round-trips"
check "$(code abc /dev/null -H 'Authorization: Bearer nope')" 401 "bad token -> 401"
check "$(code abc /dev/null)" 401 "no token -> 401"
check "$(code ../../etc/passwd /dev/null -H 'Authorization: Bearer rw')" 404 "path traversal -> 404"

echo "all good"
