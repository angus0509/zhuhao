#!/bin/bash
set -euo pipefail

REPOSITORY_PATH="${1:-.}"
git -C "$REPOSITORY_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "错误: 目标不是 Git 工作区" >&2
  exit 1
}

WORKSPACE_ROOT="$(git -C "$REPOSITORY_PATH" rev-parse --show-toplevel)"
BRANCH="$(git -C "$REPOSITORY_PATH" symbolic-ref --quiet --short HEAD || printf 'DETACHED')"
HEAD_COMMIT="$(git -C "$REPOSITORY_PATH" rev-parse --short=12 HEAD)"
case "$BRANCH" in
  claude/*) OWNER="Claude" ;;
  codex/*) OWNER="Codex" ;;
  integration/*) OWNER="Integration" ;;
  *) OWNER="Unassigned" ;;
esac

TRACKED_STATUS="$(git -C "$REPOSITORY_PATH" status --short --untracked-files=no)"
if [ -n "$TRACKED_STATUS" ]; then
  WORKTREE_STATE="dirty"
  TRACKED_CHANGES="$(printf '%s\n' "$TRACKED_STATUS" | awk 'NF { count += 1 } END { print count + 0 }')"
else
  WORKTREE_STATE="clean"
  TRACKED_CHANGES=0
fi

HIGH_CONFLICT_FILES="$(
  git -C "$REPOSITORY_PATH" status --porcelain=v1 --untracked-files=no \
    | cut -c4- \
    | awk '
      $0 == "public/app.js" || $0 == "public/index.html" || $0 == "public/styles.css" ||
      $0 == "src/services/operations.service.js" || $0 == "package.json" ||
      $0 == "sql/schema.mysql.sql" || $0 == "scripts/build-release-package.sh" ||
      $0 == "scripts/verify-release-package.sh" || $0 == "scripts/deploy-production.sh" { print }
    ' \
    | paste -sd, -
)"

printf 'workspace_root=%s\n' "$WORKSPACE_ROOT"
printf 'branch=%s\n' "$BRANCH"
printf 'owner=%s\n' "$OWNER"
printf 'head=%s\n' "$HEAD_COMMIT"
printf 'worktree_state=%s\n' "$WORKTREE_STATE"
printf 'tracked_changes=%s\n' "$TRACKED_CHANGES"
printf 'high_conflict_files=%s\n' "${HIGH_CONFLICT_FILES:-none}"
