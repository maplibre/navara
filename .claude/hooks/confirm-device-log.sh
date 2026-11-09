#!/usr/bin/env bash
# PreToolUse hook (Bash): always ask the user before starting the mobile device log
# server (debug_tile_server `device-log`), which listens on the whole LAN and
# writes what any client sends to a file.
jq -r '.tool_input.command // ""' | grep -qE 'device-log|deviceLog\.ts' || exit 0
cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"UNSAFE: starts the mobile device log server, which listens on 0.0.0.0 and appends whatever any device on the LAN sends to a file. Confirm before running."}}
EOF
