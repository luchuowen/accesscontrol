#!/usr/bin/env bash
exec node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/guard.mjs"
