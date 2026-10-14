#!/usr/bin/env bash
# ============================================================
# 大脑记忆同步（两机同款，经顶层仓分发）
#   大脑仓库 = https://github.com/NepheLoudy/qianli-brain（私有）
#   本地落位 = 本仓库根的 memory/（独立 .git，与顶层仓互不干扰——顶层 .gitignore 已排除 memory/）
#   用法：brain-sync.sh save   # 记忆写入后：提交并推送（时间戳按记忆规范 date 生成）
#         brain-sync.sh pull   # 开工前：拉取对端记忆（--ff-only；jsonl append-only 冲突概率极低，
#                              #   若真冲突按「updated 新者胜」人工核对，勿盲覆盖）
# ============================================================
set -e
# 纯 bash 内建定位脚本目录（裸 bash.exe 调用时无 dirname/PATH，禁用外部命令）
SRC="${BASH_SOURCE[0]}"
[[ "$SRC" == */* ]] || SRC="./$SRC"
MEM_DIR="$(cd "${SRC%/*}" && pwd)/memory"
cd "$MEM_DIR"
if [ ! -d .git ]; then
  echo "[brain-sync] memory/ 还不是 git 仓——首次接入：git init && git remote add origin https://github.com/NepheLoudy/qianli-brain.git && brain-sync.sh pull"
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
    echo "用法: brain-sync.sh save|pull"
    exit 1
    ;;
esac
