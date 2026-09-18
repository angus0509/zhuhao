#!/bin/bash
# Claude/Codex 协作脚本 —— 全程只读，不写文件、不改工作区、不读文件内容
set -euo pipefail

usage() {
  echo "用法:" >&2
  echo "  $0 status [repo]           查看协作状态（owner/分支/工作区/高冲突文件）" >&2
  echo "  $0 handoff <base> [repo]   生成交接块（提交号/改动文件/diff --check）" >&2
  exit 2
}

[ $# -ge 1 ] || usage
SUB="$1"; shift

is_repo() {
  git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

status_cmd() {
  local repo="${1:-.}"
  is_repo "$repo" || { echo "错误: $repo 不是 Git 工作区" >&2; exit 1; }

  local root branch owner head state n changed hc
  root="$(git -C "$repo" rev-parse --show-toplevel)"
  branch="$(git -C "$repo" symbolic-ref --quiet --short HEAD || printf 'DETACHED')"
  head="$(git -C "$repo" rev-parse --short=12 HEAD)"
  case "$branch" in
    claude/*)      owner=Claude ;;
    codex/*)       owner=Codex ;;
    integration/*) owner=Integration ;;
    *)             owner=Unassigned ;;
  esac

  changed="$(git -C "$repo" status --porcelain=v1 --untracked-files=no)"
  if [ -n "$changed" ]; then state=dirty; else state=clean; fi
  n="$(printf '%s\n' "$changed" | awk 'NF { c += 1 } END { print c + 0 }')"

  hc="$(printf '%s\n' "$changed" | cut -c4- | grep -E \
    '^(public/app\.js|public/index\.html|public/styles\.css|src/services/operations\.service\.js|package\.json|sql/.*\.sql|scripts/.*(deploy|release|build|verify).*\.sh)$' \
    | paste -sd, -)"

  printf 'workspace_root=%s\n' "$root"
  printf 'branch=%s\n' "$branch"
  printf 'owner=%s\n' "$owner"
  printf 'head=%s\n' "$head"
  printf 'worktree_state=%s\n' "$state"
  printf 'tracked_changes=%s\n' "$n"
  printf 'high_conflict_files=%s\n' "${hc:-none}"
}

handoff_cmd() {
  local base="${1:-}"; [ -n "$base" ] || usage
  local repo="${2:-.}"
  is_repo "$repo" || { echo "错误: $repo 不是 Git 工作区" >&2; exit 1; }
  git -C "$repo" cat-file -e "${base}^{commit}" 2>/dev/null \
    || { echo "错误: 基础提交 $base 不存在" >&2; exit 1; }

  local head
  head="$(git -C "$repo" rev-parse HEAD)"

  echo "===== 交接块 ====="
  echo "基础提交: $base"
  echo "当前提交: $head"
  echo "改动文件:"
  git -C "$repo" diff --name-status "$base" HEAD
  echo
  echo "diff --check 结果:"
  if git -C "$repo" diff --check "$base" HEAD; then
    echo "  (通过)"
  else
    echo "  (存在空白或冲突标记，需处理)"
  fi
  echo
  echo "遗留风险: (待填)"
  echo "=================="
}

case "$SUB" in
  status)  status_cmd "$@" ;;
  handoff) handoff_cmd "$@" ;;
  *)       usage ;;
esac
