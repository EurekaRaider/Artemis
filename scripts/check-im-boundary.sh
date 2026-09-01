#!/bin/bash
# packages/im 硬边界检查（plan Phase 0 出口）：
# packages/im 是纯 TS 包，禁止 import Electron / Node 主进程模块。
# 用法：bash scripts/check-im-boundary.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# 只匹配真实 import/require，不匹配注释或字符串
if grep -rnE "^\s*(import|export)\s+.*from\s+[\"']electron" packages/im/src/ \
  || grep -rnE "require\([\"']electron" packages/im/src/; then
  echo "BOUNDARY VIOLATION: packages/im must not import electron" >&2
  exit 1
fi

echo "OK: packages/im has no electron imports"
