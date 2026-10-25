#!/usr/bin/env bash
# 上游升级流程：fetch → 检查 → merge → 测试 → 部署
#
# 用法：
#   ./upgrade.sh          只检查，不改动任何东西（默认）
#   ./upgrade.sh --apply  执行合并 + 测试 + 部署
#
# 设计原则：
#   - 默认只读，避免误操作
#   - 有冲突立即停下，交给人判断（parseMeta 是我们的核心改动，上游改它必冲突）
#   - 部署前强制跑测试，测试不过不部署
set -uo pipefail
cd "$(dirname "$0")"

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

# 本地环境（代理、HUB_BASE 等）从 .env.local 读，不进仓库
if [ -f .env.local ]; then
    # shellcheck disable=SC1091
    . ./.env.local
fi
if [ -n "${HTTP_PROXY_LOCAL:-}" ]; then
    export HTTP_PROXY="$HTTP_PROXY_LOCAL"
    export HTTPS_PROXY="$HTTP_PROXY_LOCAL"
fi

echo "=== 1) 拉上游 ==="
git fetch upstream --tags 2>&1 | tail -3 || { echo "❌ fetch 失败"; exit 1; }

BEHIND=$(git rev-list --count main..upstream/main)
AHEAD=$(git rev-list --count upstream/main..main)
echo "  我们领先上游 $AHEAD 个提交，落后 $BEHIND 个提交"

if [ "$BEHIND" -eq 0 ]; then
    echo
    echo "✅ 已是最新，无需升级"
    exit 0
fi

echo
echo "=== 2) 上游新增提交 ==="
git log --oneline main..upstream/main

echo
echo "=== 3) 上游改了哪些文件 ==="
git diff --stat main...upstream/main

# 预判冲突：我们改过的文件，上游也改了 = 大概率冲突
OUR_FILES=$(git diff --name-only upstream/main...main)
echo
echo "=== 4) 冲突预判 ==="
CONFLICT=0
for f in $OUR_FILES; do
    if git diff --name-only main...upstream/main | grep -qx "$f"; then
        echo "  ⚠️  $f —— 双方都改过，merge 时可能冲突"
        CONFLICT=1
    fi
done
[ "$CONFLICT" -eq 0 ] && echo "  ✅ 无重叠文件，merge 应该干净"

if [ "$APPLY" -eq 0 ]; then
    echo
    echo "（只读检查完毕。加 --apply 执行合并）"
    exit 0
fi

echo
echo "=== 5) 合并 ==="
if ! git merge upstream/main --no-edit 2>&1 | tail -20; then
    echo
    echo "❌ 合并冲突，已停在冲突状态。"
    echo "   查看：git status"
    echo "   解决后：git add <file> && git commit"
    echo "   放弃：git merge --abort"
    exit 1
fi

echo
echo "=== 6) 测试 ==="
if ! node --check index.js; then
    echo "❌ 语法错误，回滚"
    git reset --hard HEAD@{1}
    exit 1
fi
if ! node test/parse-meta.test.js; then
    echo
    echo "❌ 测试失败！parseMeta 可能被上游改动破坏。"
    echo "   线上未部署，仍是旧版本。"
    echo "   回滚：git reset --hard HEAD@{1}"
    echo "   保留：解决后重新跑测试再部署"
    exit 1
fi

echo
echo "=== 7) 部署 ==="
python3 deploy.py || { echo "❌ 部署失败"; exit 1; }

echo
echo "=== 8) 线上复核 ==="
if [ -n "${HUB_BASE:-}" ]; then
sleep 10
curl -s "$HUB_BASE/api/collections/all.rex" -A "Rex/10" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f\"合集 {d['title']}  widgets={len(d['widgets'])}\")
for w in d['widgets']:
    print(f\"  {w['id']:24} v={w['version']:10} req={w['requiredVersion']}\")
"
else
    echo "  ⚠️  未设 HUB_BASE（.env.local），跳过线上复核"
fi

echo
echo "=== 9) 推送到 fork ==="
git push origin main 2>&1 | tail -3

echo
echo "✅ 升级完成"
