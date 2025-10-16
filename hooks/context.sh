#!/usr/bin/env bash
set -euo pipefail

# Read the Context7 usage instructions
CONTEXT_FILE="${CLAUDE_PLUGIN_ROOT}/hooks/CONTEXT7.md"

if [ -f "$CONTEXT_FILE" ]; then
    # Read the context file content
    CONTEXT_CONTENT=$(cat "$CONTEXT_FILE")

    # Output as JSON with additionalContext
    jq -n --arg context "$CONTEXT_CONTENT" '{
      "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": $context
      }
    }'
fi
