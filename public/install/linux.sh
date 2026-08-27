#!/bin/sh
set -eu
server='' token='' remove=false
while [ $# -gt 0 ]; do case "$1" in --server) server=$2; shift 2;; --token) token=$2; shift 2;; --uninstall) remove=true; shift;; *) exit 2;; esac; done
file="$HOME/.config/environment.d/nx-cache.conf"
if $remove; then rm -f "$file"; exit 0; fi
[ -n "$server" ] && [ -n "$token" ] && curl -fsS "$server/health" >/dev/null
mkdir -p "$(dirname "$file")"; umask 077; printf 'NX_SELF_HOSTED_REMOTE_CACHE_SERVER=%s\nNX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN=%s\n' "$server" "$token" > "$file"; echo 'Restart terminals and AI agents.'
