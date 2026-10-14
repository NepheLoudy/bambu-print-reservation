#!/usr/bin/env bash
# ============================================================
# 大脑记忆同步（两机同款，经顶层仓分发）
#   大脑仓库 = https://github.com/NepheLoudy/qianli-brain（私有）
#   本地落位 = 本仓库根的 memory/（独立 .git，与顶层仓互不干扰）
#   用法：brain-sync.cmd save|pull   （cmd/双击入口，自动切到仓库根）
#         ./brain-sync.sh save|pull  （git-bash 入口，须在本仓库根目录执行）
#   save=提交并推送；pull=拉取对端（--ff-only；jsonl append-only 冲突概率极低，
#   真冲突按「updated 新者胜」人工核对，勿盲覆盖）
# ============================================================
set -e
# 依赖当前目录=仓库根（brain-sync.cmd 已 cd /d %~dp0；git-bash 手动调用请先 cd）
MEM_DIR="$(pwd)/memory"
cd "$MEM_DIR"
if [ ! -d .git ]; then
  echo "[brain-sync] memory/ 还不是 git 仓——首次接入：git clone https://github.com/NepheLoudy/qianli-brain.git memory"
  exit 1
fi
case "$1" in
  save)
    git add -A
    git commit -m "brain-save: $(date +%Y-%m-%dT%H:%M:%S%z) @$(hostname)" || echo "[brain-sync] 无变更可提交"
    git push
    ;;
  pull)
    git pull --ff-only
    ;;
  *)
    echo "用法: brain-sync.cmd save|pull"
    exit 1
    ;;
esac
