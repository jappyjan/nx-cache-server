#!/bin/sh
set -eu
server='' token='' remove=false
while [ $# -gt 0 ]; do case "$1" in --server) server=$2; shift 2;; --token) token=$2; shift 2;; --uninstall) remove=true; shift;; *) exit 2;; esac; done
plist="$HOME/Library/LaunchAgents/dev.nx-cache.plist"
if $remove; then rm -f "$plist"; launchctl unsetenv NX_SELF_HOSTED_REMOTE_CACHE_SERVER 2>/dev/null || true; launchctl unsetenv NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN 2>/dev/null || true; exit 0; fi
[ -n "$server" ] && [ -n "$token" ] && curl -fsS "$server/health" >/dev/null
mkdir -p "$(dirname "$plist")"
cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>dev.nx-cache</string><key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>launchctl setenv NX_SELF_HOSTED_REMOTE_CACHE_SERVER '$server'; launchctl setenv NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN '$token'</string></array><key>RunAtLoad</key><true/></dict></plist>
EOF
chmod 600 "$plist"; launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null || launchctl kickstart -k "gui/$(id -u)/dev.nx-cache"; echo 'Restart terminals and AI agents.'
