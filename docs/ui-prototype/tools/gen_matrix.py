#!/usr/bin/env python3
"""capability-matrix 生成器 + 校验器（v17）。

职责（R15 第②项）：
  1. 解析 prototype/components.html 中全部 class="spec" 卡片（70 张），
     按 DOM 顺序与所属 section 生成稳定 card id（<section>-<两位序号>），
     并可注入 data-card 属性（--inject，幂等）。
  2. 读取 prototype/tools/capability-map.json（手写逐卡账本），
     用 `git show <baseline>:<path>` 验证每条 file:line 锚点确实命中该符号。
  3. 产出 prototype/capability-matrix.md（逐卡总表 + 模块汇总 + 缺口清单 + 统计）
     与 prototype/tools/matrix-stats.json。文档中所有数字均由本脚本计算，
     禁止手写。
  4. --verify：重新推导全部断言，任一失败 exit 非零并打印具体原因；
     同时重新生成 md/stats 与磁盘内容逐字节对比（保证文档未被手改）。

用法（在仓库根目录运行）：
  python3 tools/gen_matrix.py --inject
  python3 tools/gen_matrix.py --version v17 --baseline <sha>
  python3 tools/gen_matrix.py --verify --version v17 --baseline <sha>

计数与百分比规则（写入文档头部，校验器据此裁定）：
  - 分母 = components.html 的 .spec 卡数（70）= 账本 cards 数 = 总表行数
    = covered+partial+uncovered 之和。
  - 模块为互斥分类：每卡恰好归一个模块；模块行内三态卡数之和 = 该模块卡数；
    全部模块卡数之和 = 分母；模块数 = modules 行数；
    模块状态 = 组内含 uncovered 则 uncovered，否则含 partial 则 partial，
    否则 covered；covered+partial+uncovered 模块数 = 模块总数。
  - 百分比 = 最大余数法：各档 floor(count/total*100)，把 100 与 floor 和的差
    按小数余数从大到小逐档 +1，保证三档之和精确 = 100；
    校验器断言三档百分比之和 == 100（无 ±1 容差，生成器必须凑整）。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

# R16①：原型根从脚本位置解析（tools/.. ），仓库内布局与裸解压布局均可运行；
# git 仓库根延迟解析（--repo 显式传入，或从原型根向上找 .git；找不到→受控错误）
PROTOTYPE = Path(__file__).resolve().parents[1]
HTML_PATH = PROTOTYPE / "components.html"
MAP_PATH = PROTOTYPE / "tools" / "capability-map.json"
MD_PATH = PROTOTYPE / "capability-matrix.md"
STATS_PATH = PROTOTYPE / "tools" / "matrix-stats.json"
CONTRACT_RESULT_PATH = PROTOTYPE / "contrast" / "prototype-contract-result.json"

_REPO: Path | None = None


def resolve_repo(explicit: str | None) -> Path:
    global _REPO
    if _REPO is not None:
        return _REPO
    if explicit:
        cand = Path(explicit).resolve()
    else:
        cand = PROTOTYPE
        while cand != cand.parent:
            if (cand / ".git").exists():
                break
            cand = cand.parent
    if not (cand / ".git").exists():
        raise RepoNotFound(
            "MATRIX_REPO_NOT_FOUND: 未找到 .git（锚点验证需要 git show 基线）。"
            "请用 --repo <仓库根> 显式指定，或在仓库内运行"
        )
    _REPO = cand
    return _REPO

CARD_RE = re.compile(r'<div class="spec">')
SECTION_RE = re.compile(r'<section class="cat" id="(cat-[a-z]+)"')
DATACARD_RE = re.compile(r'<div class="spec" data-card="(cat-[a-z]+-\d{2})">')
STATUS_ENUM = ("covered", "partial", "uncovered")
STATE_ENUM = ("default", "empty", "loading", "error", "disabled", "conflict")


class VerifyError(Exception):
    pass


def fail(msg: str) -> None:
    raise VerifyError(msg)


class RepoNotFound(VerifyError):
    pass


# ---------------------------------------------------------------- HTML 解析


def parse_cards(html: str) -> list[dict]:
    """按文档序返回每张 .spec 卡：位置 / 所属 section / 序号 / 已注入的 id。"""
    sections = [(m.start(), m.group(1)) for m in SECTION_RE.finditer(html)]
    injected = {m.start(): m.group(1) for m in DATACARD_RE.finditer(html)}
    pattern = DATACARD_RE if injected else CARD_RE
    counts: dict[str, int] = {}
    cards = []
    for m in pattern.finditer(html):
        pos, end = m.start(), m.end()
        sid = None
        for s, name in sections:
            if s < pos:
                sid = name
        if sid is None:
            fail(f"components.html: 位置 {pos} 的 .spec 卡不在任何 cat section 内")
        counts[sid] = counts.get(sid, 0) + 1
        cards.append(
            {
                "pos": pos,
                "end": end,
                "section": sid,
                "index": counts[sid],
                "expected_id": f"{sid}-{counts[sid]:02d}",
                "data_card": injected.get(pos),
            }
        )
    return cards


def card_id_of(card: dict) -> str | None:
    return card.get("data_card") or card.get("expected_id")


def inject_data_cards(html: str) -> tuple[str, int]:
    cards = parse_cards(html)
    changed = 0
    out = html
    for card in sorted(cards, key=lambda c: c["pos"], reverse=True):
        if card["data_card"]:
            continue
        cid = card["expected_id"]
        out = out[: card["pos"]] + f'<div class="spec" data-card="{cid}">' + out[card["end"] :]
        changed += 1
    return out, changed


# ---------------------------------------------------------------- 基线读取


class Baseline:
    def __init__(self, sha: str, repo: Path):
        self.sha = sha
        self.repo = repo
        self._cache: dict[str, list[str]] = {}
        self._import_lines_cache: dict[str, set[int]] = {}

    def lines(self, path: str) -> list[str]:
        if path not in self._cache:
            proc = subprocess.run(
                ["git", "show", f"{self.sha}:{path}"],
                cwd=self.repo,
                capture_output=True,
                text=True,
            )
            if proc.returncode != 0:
                fail(f"git show {self.sha}:{path} 失败: {proc.stderr.strip()[:200]}")
            self._cache[path] = proc.stdout.splitlines()
        return self._cache[path]

    @staticmethod
    def import_line_numbers(lines: list[str]) -> set[int]:
        """Return every 1-based line that belongs to a static import declaration."""
        result: set[int] = set()
        in_import = False
        for number, line_text in enumerate(lines, start=1):
            stripped = line_text.strip()
            if not in_import and re.match(r"^import\b", stripped):
                in_import = True
            if not in_import:
                continue
            result.add(number)
            if (
                ";" in stripped
                or re.search(r"\bfrom\s+['\"]", stripped)
                or re.match(r"^import\s+['\"]", stripped)
            ):
                in_import = False
        return result

    def import_lines(self, path: str) -> set[int]:
        if path not in self._import_lines_cache:
            self._import_lines_cache[path] = self.import_line_numbers(self.lines(path))
        return self._import_lines_cache[path]

    def verify_anchor(self, path: str, line: int | None, symbol: str) -> None:
        if line is None:
            fail(f"锚点缺少行号: {path}::{symbol}")
        if not isinstance(line, int) or line < 1:
            fail(f"锚点行号非法: {path}:{line} ({symbol})")
        lines = self.lines(path)
        if line > len(lines):
            fail(f"锚点行号越界: {path} 共 {len(lines)} 行, 要求第 {line} 行 ({symbol})")
        line_text = lines[line - 1]
        stripped = line_text.strip()
        # R16③：词边界精确匹配——"UserInput" 不得命中 "UserInputResolution"（子串碰撞）
        if re.search(rf"(?<![\w$]){re.escape(symbol)}(?![\w$])", line_text) is None:
            fail(
                f"锚点未命中（词边界精确匹配）: {path}:{line} 不含独立符号 {symbol!r}; "
                f"该行实际内容: {stripped[:120]!r}"
            )
        # 锚点不得落在 import 声明的任意一行；不能只匹配 `type X,`，否则
        # 普通成员（例如多行 React import 中的 `useState,`）仍会被误认成定义。
        if line in self.import_lines(path):
            fail(
                f"假锚点（import 行）: {path}:{line} 是 import/import 成员行，"
                f"不能作为 {symbol!r} 的定义锚点; 该行: {stripped[:120]!r}"
            )


# ---------------------------------------------------------------- 账本装载


def load_map() -> dict:
    try:
        data = json.loads(MAP_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        fail(f"capability-map.json 解析失败: {exc}")
    for key in ("cards", "modules", "baseline", "generatedBy"):
        if key not in data:
            fail(f"capability-map.json 缺少字段 {key}")
    return data


def validate_map_structure(map_data: dict) -> None:
    ids: list[str] = []
    for i, card in enumerate(map_data["cards"]):
        where = f"cards[{i}]"
        for key in (
            "card",
            "no",
            "title",
            "module",
            "states",
            "interaction",
            "keyboard",
            "aria",
            "status",
            "gaps",
        ):
            if key not in card:
                fail(f"{where} 缺少字段 {key}")
        status = card["status"]
        if status not in STATUS_ENUM:
            fail(f"{where}({card.get('card')}) status 非法: {status!r}，只允许 {STATUS_ENUM}")
        if not isinstance(card["states"], list) or not card["states"]:
            fail(f"{where}({card.get('card')}) states 必须为非空列表")
        for st in card["states"]:
            if st not in STATE_ENUM:
                fail(f"{where}({card.get('card')}) 状态 {st!r} 不在枚举 {STATE_ENUM}")
        for key in ("interaction", "keyboard", "aria"):
            if not isinstance(card[key], str) or not card[key].strip():
                fail(f"{where}({card.get('card')}) 字段 {key} 必须为非空字符串")
        gaps = card["gaps"]
        if status in ("partial", "uncovered") and (not isinstance(gaps, list) or not gaps):
            fail(f"{where}({card.get('card')}) status={status} 必须列明 gaps")
        if status == "covered" and isinstance(gaps, list) and gaps:
            fail(f"{where}({card.get('card')}) status=covered 不应携带 gaps")
        anchored = (
            card.get("file") is not None and card.get("line") is not None and bool(card.get("symbol"))
        )
        if status == "uncovered":
            if anchored:
                fail(f"{where}({card.get('card')}) uncovered 卡不应有生产锚点")
        else:
            if not anchored:
                fail(f"{where}({card.get('card')}) covered/partial 卡必须提供 file/line/symbol")
        ids.append(card["card"])
    if len(ids) != len(set(ids)):
        dupes = sorted({x for x in ids if ids.count(x) > 1})
        fail(f"capability-map.json card id 重复: {dupes}")
    module_names = {m["module"] for m in map_data["modules"]}
    for card in map_data["cards"]:
        if card["module"] not in module_names:
            fail(f"卡 {card['card']} 的模块 {card['module']!r} 不在 modules 中")


# ---------------------------------------------------------------- 统计推导


def derive_stats(map_data: dict, html_ids: list[str]) -> dict:
    cards = map_data["cards"]
    total = len(cards)
    by_status = {"covered": 0, "partial": 0, "uncovered": 0}
    for card in cards:
        by_status[card["status"]] += 1

    modules = []
    mod_status = {"covered": 0, "partial": 0, "uncovered": 0}
    for mod in map_data["modules"]:
        name = mod["module"]
        group = [c for c in cards if c["module"] == name]
        if not group:
            fail(f"模块 {name} 没有任何卡")
        dist = {"covered": 0, "partial": 0, "uncovered": 0}
        for c in group:
            dist[c["status"]] += 1
        if dist["uncovered"]:
            status = "uncovered"
        elif dist["partial"]:
            status = "partial"
        else:
            status = "covered"
        mod_status[status] += 1
        modules.append(
            {
                "module": name,
                "label": mod.get("label", name),
                "cards": len(group),
                "covered": dist["covered"],
                "partial": dist["partial"],
                "uncovered": dist["uncovered"],
                "status": status,
            }
        )

    pct_floor = {k: by_status[k] * 100 // total for k in by_status}
    remainder = 100 - sum(pct_floor.values())
    order = sorted(
        by_status,
        key=lambda k: (-(by_status[k] * 100 - pct_floor[k] * total), -by_status[k]),
    )
    pct = dict(pct_floor)
    for k in order[:remainder]:
        pct[k] += 1
    if sum(pct.values()) != 100:
        fail("百分比凑整失败")

    return {
        "total": total,
        "by_status": by_status,
        "percent": pct,
        "modules": modules,
        "module_count": len(modules),
        "module_status": mod_status,
    }


def load_prototype_contract(map_data: dict, html_ids: list[str], version: str) -> dict:
    config = map_data.get("prototypeContract")
    if not isinstance(config, dict):
        fail("capability-map.json 缺少 prototypeContract 配置")
    try:
        result = json.loads(CONTRACT_RESULT_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        fail(f"prototype contract 结果缺失或无法解析: {exc}")
    expected = config.get("expectedCards")
    targeted = config.get("expectedTargetedCards")
    if result.get("version") != version:
        fail(f"prototype contract 版本漂移: {result.get('version')} != {version}")
    if result.get("ok") is not True:
        fail(f"prototype contract 未通过: {result.get('failures', [])[:5]}")
    if result.get("totalCards") != expected or result.get("passedCards") != expected:
        fail(f"prototype contract 卡数不符: {result.get('passedCards')}/{result.get('totalCards')} != {expected}/{expected}")
    if result.get("targetedCards") != targeted:
        fail(f"prototype contract 定向卡数不符: {result.get('targetedCards')} != {targeted}")
    card_results = result.get("cardResults")
    if not isinstance(card_results, dict) or set(card_results) != set(html_ids):
        fail("prototype contract cardResults 与 components.html 卡集合不一致")
    failed_cards = [card for card, item in card_results.items() if item.get("ok") is not True]
    if failed_cards:
        fail(f"prototype contract 存在失败卡: {failed_cards[:8]}")
    return {"passedCards": expected, "totalCards": expected, "targetedCards": targeted, "result": str(CONTRACT_RESULT_PATH.relative_to(PROTOTYPE))}


# ---------------------------------------------------------------- 文档生成


def build_markdown(map_data: dict, stats: dict, version: str, baseline: str) -> str:
    by = stats["by_status"]
    pct = stats["percent"]
    ms = stats["module_status"]
    lines: list[str] = []
    ap = lines.append

    ap(f"# 能力覆盖矩阵（components.html 70 卡 ↔ 基线 {baseline[:7]} 逐卡账本）")
    ap("")
    ap(f"> 版本：{version} · 基线：`{baseline}`（main）· 生成器：`prototype/tools/gen_matrix.py`")
    ap(">")
    ap("> 本文件由生成器产出，**所有数字来自 `matrix-stats.json`，禁止手写**。")
    ap(f"> 重新生成：`python3 tools/gen_matrix.py --version {version} --baseline {baseline}`")
    ap(f"> 校验：`python3 tools/gen_matrix.py --verify --version {version} --baseline {baseline}`")
    ap("")
    ap(
        "**双口径，禁止混淆。** 生产 TS/Electron 账本的 70 卡中 "
        f"{by['partial']} 卡 partial、{by['uncovered']} 卡 uncovered，"
        "缺口仍如实列在第四节；与此同时，HTML 原型契约已经 "
        f"{stats['prototype_contract']['passedCards']}/{stats['prototype_contract']['totalCards']} 通过，"
        f"其中 {stats['prototype_contract']['targetedCards']} 张卡有定向交互断言"
        f"（历史 partial/uncovered {by['partial'] + by['uncovered']} 张 + v19 新增 13c 胶囊 "
        f"{stats['prototype_contract']['targetedCards'] - by['partial'] - by['uncovered']} 张）。"
    )
    ap("")
    ap(
        "**校验边界：** runner 的 T8 执行 HTML 卡片的状态、交互、键盘和 ARIA 契约；"
        "`--verify` 读取并校验该结果，同时验证生产账本格式、计数和精确词边界锚点。"
        "HTML 通过不等于生产 TS 组件已经实现。"
    )
    ap("")

    ap("## 一、口径与计数规则")
    ap("")
    ap(
        f"- **分母 = {stats['total']} 张卡**（components.html 全部 `class=\"spec\"`，"
        "带稳定 `data-card` 属性）= 本文件总表行数 = "
        f"covered+partial+uncovered 之和（{by['covered']}+{by['partial']}+{by['uncovered']}）。"
    )
    ap(
        "- 卡 id：`<section>-<两位序号>`，按 DOM 顺序注入（如 `cat-input-03`），"
        "由 `--inject` 生成并经校验器与账本双向核对、无重复。"
    )
    ap(
        f"- **行号全部由生成器按 `git show {baseline[:7]}:<path>` 定位并经校验器逐条验证**"
        "（断言「该行包含该符号」）。v14 中 EnvironmentPanel/SourcesPanel/McpServerEditor/"
        "WorkspaceFileEditor 的行号错位已在本版修正。"
    )
    ap(
        f"- 模块为互斥分类：每卡恰好归一个模块，共 {stats['module_count']} 个；"
        "模块行内三态卡数之和 = 该模块卡数；全部模块卡数之和 = 分母；"
        "模块状态取组内最弱（含 uncovered 即 uncovered，否则含 partial 即 partial，"
        "否则 covered）；三态模块数之和 = 模块总数。"
    )
    ap(
        "- 百分比 = **最大余数法**：各档先取 floor(count/total×100)，"
        "100 与 floor 和的差额按小数余数从大到小逐档 +1，三档之和精确 = 100%；"
        "校验器断言 == 100（无 ±1 容差，生成器负责凑整）。"
    )
    ap(
        "- HTML 是否完成由 T8 判定；本表 status 则判定 **current main 的正式 TS/Electron 实现**"
        "相对 v17 HTML 契约的覆盖，不凭模块名或静态锚点臆断。"
    )
    ap(
        "- `covered` = current main 已有对应生产实现；`partial` = 已有主流程/锚点，但相对 v17 契约"
        "仍缺状态、键盘、ARIA、组件化或独立测试；`uncovered` = current main 无对应生产符号"
        "（该卡无 file:line 锚点，校验器强制）。"
    )
    ap("")

    ap("## 二、逐卡总表（分母 70 = 行数）")
    ap("")
    ap("| 卡 id | v14 编号 | 标题 | 模块 | 生产符号 | 基线锚点 | HTML 状态 | v17 交互契约 | v17 键盘 | v17 ARIA | 生产覆盖 | 生产迁移缺口 |")
    ap("|---|---|---|---|---|---|---|---|---|---|---|---|")
    module_label = {m["module"]: m.get("label", m["module"]) for m in map_data["modules"]}
    for card in map_data["cards"]:
        gaps = "；".join(card["gaps"]) if card["gaps"] else "—"
        anchor = f"`{card['file']}:{card['line']}`" if card.get("file") else "—"
        symbol = f"`{card['symbol']}`" if card.get("symbol") else "—"
        states = "、".join(card["states"])
        ap(
            f"| `{card['card']}` | {card['no']} | {card['title']} | {module_label[card['module']]} "
            f"| {symbol} | {anchor} | {states} | {card['interaction']} | {card['keyboard']} | {card['aria']} "
            f"| {card['status']} | {gaps} |"
        )
    ap("")

    ap(f"## 三、模块汇总（互斥分类，{stats['module_count']} 模块，卡数和 = 70）")
    ap("")
    ap("| 模块 | 说明 | 卡数 | covered | partial | uncovered | 模块状态 |")
    ap("|---|---|---|---|---|---|---|")
    for m in stats["modules"]:
        ap(
            f"| `{m['module']}` | {m['label']} | {m['cards']} | {m['covered']} | {m['partial']} "
            f"| {m['uncovered']} | {m['status']} |"
        )
    ap(
        f"| **合计** | — | **{stats['total']}** | {ms['covered']} | {ms['partial']} | {ms['uncovered']} "
        f"| **{stats['module_count']} 模块** |"
    )
    ap("")

    ap("## 四、生产迁移清单（全部为 partial/uncovered）")
    ap("")
    ap("v17 HTML 已由 T8 覆盖以下卡片；这里列的是 current main 正式实现相对 v17 契约仍需迁移或固化的部分：")
    ap("")
    n = 0
    for card in map_data["cards"]:
        if card["status"] == "uncovered" or (card["status"] == "partial" and card.get("r15")):
            n += 1
            gaps = "、".join(card["gaps"])
            ap(f"{n}. `{card['card']}`（{card['title']}）— {card['status']}：缺 {gaps}")
    ap("")
    ap("除此之外的 partial 卡（非 R15 点名，但逐卡对照发现）：")
    ap("")
    for card in map_data["cards"]:
        if card["status"] == "partial" and not card.get("r15"):
            ap(f"- `{card['card']}`（{card['title']}）：{'、'.join(card['gaps'])}")
    ap("")

    ap("## 五、统计")
    ap("")
    ap(
        f"HTML 原型契约：**{stats['prototype_contract']['passedCards']}/{stats['prototype_contract']['totalCards']}**；"
        f"定向交互断言卡：**{stats['prototype_contract']['targetedCards']}**"
        f"（历史缺口 {by['partial'] + by['uncovered']} + v19 13c 胶囊 "
        f"{stats['prototype_contract']['targetedCards'] - by['partial'] - by['uncovered']}）；"
        f"证据：`{stats['prototype_contract']['result']}`。"
    )
    ap("")
    ap("| 覆盖状态 | 卡数 | 占比 |")
    ap("|---|---|---|")
    ap(f"| covered | {by['covered']} | {pct['covered']}% |")
    ap(f"| partial | {by['partial']} | {pct['partial']}% |")
    ap(f"| uncovered | {by['uncovered']} | {pct['uncovered']}% |")
    ap(f"| **合计** | **{stats['total']}** | **100%** |")
    ap("")
    ap(
        f"模块互斥分类：{stats['module_count']} 个模块 = covered {ms['covered']} + partial {ms['partial']} "
        f"+ uncovered {ms['uncovered']}（和 = 模块总数）。"
    )
    ap("")

    ap("## 六、诚实边界")
    ap("")
    ap(
        "- T8 只验证 HTML 原型行为；T9 验证 HTML 主页面的 1440×900 / 200% zoom / Dock closed 布局。"
        "它们不证明 VoiceOver/NVDA、macOS/Windows 原生差异，也不证明正式 TS/Electron 组件。"
    )
    ap(
        "- partial/uncovered 的具体缺失状态以第四节为准，它们指生产实现迁移缺口；"
        "HTML 原型层已由独立契约完成，不得反向篡改生产状态。"
    )
    ap(
        "- 锚点只证明符号存在于基线该行，不证明该符号的完整实现质量；"
        "实现级评审仍归 R15 主线。"
    )
    ap("")
    return "\n".join(lines)


def build_stats_json(map_data: dict, stats: dict, version: str, baseline: str) -> str:
    payload = {
        "version": version,
        "baseline": baseline,
        "baselineShort": baseline[:7],
        "generatedBy": "prototype/tools/gen_matrix.py",
        "denominator": stats["total"],
        "byStatus": stats["by_status"],
        "percent": stats["percent"],
        "percentRule": "最大余数法凑整，三档之和恒等于 100；verify 断言 == 100",
        "modules": stats["modules"],
        "moduleCount": stats["module_count"],
        "moduleStatus": stats["module_status"],
        "counts": {
            "covered": stats["by_status"]["covered"],
            "partial": stats["by_status"]["partial"],
            "uncovered": stats["by_status"]["uncovered"],
        },
        "integrity": {
            "denominatorEqualsRows": stats["total"] == len(map_data["cards"]),
            "moduleCardsSum": sum(m["cards"] for m in stats["modules"]),
            "statusSum": sum(stats["by_status"].values()),
        },
        "prototypeContracts": stats["prototype_contract"],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


# ---------------------------------------------------------------- 校验


def run_checks(map_data: dict, baseline: Baseline, html_ids: list[str]) -> dict:
    # 生成器自带契约：多行 import 的普通成员与 type 成员必须全部识别，
    # import 结束后的真实定义不得误判。该测试不依赖基线行号，避免随 main 漂移。
    import_fixture = [
        "import {",
        "  useState,",
        "  type UserInputResolution,",
        "} from 'react';",
        "const useStateFactory = true;",
    ]
    import_lines = Baseline.import_line_numbers(import_fixture)
    if import_lines != {1, 2, 3, 4}:
        fail(f"import 块识别契约失败: {sorted(import_lines)}")

    validate_map_structure(map_data)
    map_ids = [c["card"] for c in map_data["cards"]]
    if sorted(map_ids) != sorted(html_ids):
        only_map = sorted(set(map_ids) - set(html_ids))
        only_html = sorted(set(html_ids) - set(map_ids))
        fail(
            f"card 集合与 components.html 不一致: 仅在账本 {only_map[:8]}… 仅在 HTML {only_html[:8]}…"
        )
    if len(html_ids) != len(set(html_ids)):
        fail("components.html data-card 存在重复")
    if len(map_ids) != 70:
        fail(f"分母应为 70 张卡，实际 {len(map_ids)}")

    anchored_count = 0
    for card in map_data["cards"]:
        if card["status"] == "uncovered":
            continue
        baseline.verify_anchor(card["file"], card["line"], card["symbol"])
        anchored_count += 1

    stats = derive_stats(map_data, html_ids)
    if stats["total"] != len(html_ids):
        fail(f"分母不一致: 账本 {stats['total']} vs HTML {len(html_ids)}")
    if sum(stats["by_status"].values()) != stats["total"]:
        fail("covered+partial+uncovered != 分母")
    if sum(m["cards"] for m in stats["modules"]) != stats["total"]:
        fail("模块卡数之和 != 分母")
    if (
        stats["module_status"]["covered"]
        + stats["module_status"]["partial"]
        + stats["module_status"]["uncovered"]
        != stats["module_count"]
    ):
        fail("模块互斥计数之和 != 模块总数")
    if sum(stats["percent"].values()) != 100:
        fail(f"百分比之和 != 100（实际 {sum(stats['percent'].values())}）")
    stats["anchoredCount"] = anchored_count
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="capability-matrix 生成器 + 校验器")
    parser.add_argument("--inject", action="store_true", help="向 components.html 注入 data-card（幂等）")
    parser.add_argument("--verify", action="store_true", help="重新推导全部断言并与磁盘文档比对")
    parser.add_argument("--version", default=None, help="版本字符串，写入矩阵头部（如 v17）")
    parser.add_argument("--baseline", default=None, help="生产基线 commit SHA")
    parser.add_argument("--proto-root", default=None, help="原型根目录（默认=脚本位置上一层，裸解压布局自动正确）")
    parser.add_argument("--repo", default=None, help="git 仓库根（默认从原型根向上找 .git；找不到则受控报错）")
    args = parser.parse_args()
    global PROTOTYPE, HTML_PATH, MAP_PATH, MD_PATH, STATS_PATH, CONTRACT_RESULT_PATH
    if args.proto_root:
        PROTOTYPE = Path(args.proto_root).resolve()
        HTML_PATH = PROTOTYPE / "components.html"
        MAP_PATH = PROTOTYPE / "tools" / "capability-map.json"
        MD_PATH = PROTOTYPE / "capability-matrix.md"
        STATS_PATH = PROTOTYPE / "tools" / "matrix-stats.json"
        CONTRACT_RESULT_PATH = PROTOTYPE / "contrast" / "prototype-contract-result.json"

    map_data = load_map()
    version = args.version or map_data.get("version", "v17")
    baseline_sha = args.baseline or map_data.get("baseline", {}).get("commit")
    if not baseline_sha:
        print("错误：未提供 --baseline，且 capability-map.json 无 baseline.commit", file=sys.stderr)
        return 2

    html = HTML_PATH.read_text(encoding="utf-8")

    if args.inject:
        new_html, changed = inject_data_cards(html)
        if changed:
            HTML_PATH.write_text(new_html, encoding="utf-8")
        print(f"--inject: 注入 {changed} 个 data-card（现共 {len(parse_cards(new_html))} 张卡带 id）")
        html = new_html

    cards = parse_cards(html)
    html_ids = [card_id_of(c) for c in cards]
    missing = [c["expected_id"] for c in cards if not c["data_card"]]
    if missing:
        print(
            f"错误：components.html 有 {len(missing)} 张卡缺 data-card（如 {missing[:5]}），"
            "请先运行 --inject",
            file=sys.stderr,
        )
        return 2

    baseline = Baseline(baseline_sha, resolve_repo(args.repo))
    try:
        stats = run_checks(map_data, baseline, html_ids)
        stats["prototype_contract"] = load_prototype_contract(map_data, html_ids, version)
    except VerifyError as exc:
        print(f"VERIFY FAIL: {exc}", file=sys.stderr)
        return 1

    md = build_markdown(map_data, stats, version, baseline_sha)
    stats_json = build_stats_json(map_data, stats, version, baseline_sha)

    if args.verify:
        disk_md = MD_PATH.read_text(encoding="utf-8") if MD_PATH.exists() else ""
        disk_stats = STATS_PATH.read_text(encoding="utf-8") if STATS_PATH.exists() else ""
        if disk_md != md:
            fail("capability-matrix.md 与生成器输出不一致（文档被手改或版本/基线不符）")
        if disk_stats != stats_json:
            fail("matrix-stats.json 与生成器输出不一致")
        print(
            "VERIFY OK（账本格式与计数一致；锚点=词边界精确匹配并排除 import 行，"
            "不构成能力覆盖语义证明）: "
            f"70 卡双向一致 · {len(html_ids)} 个 data-card 无重复 · "
            f"{stats['anchoredCount']} 条锚点精确命中基线 {baseline_sha[:7]} · "
            f"import 块契约=PASS · 分母=行数=计数和={stats['total']} · "
            f"模块和={stats['module_count']} · 百分比和=100"
        )
        return 0

    MD_PATH.write_text(md, encoding="utf-8")
    STATS_PATH.write_text(stats_json, encoding="utf-8")
    md_hash = hashlib.sha256(md.encode()).hexdigest()[:12]
    print(
        f"OK: covered={stats['by_status']['covered']} partial={stats['by_status']['partial']} "
        f"uncovered={stats['by_status']['uncovered']} (共 {stats['total']}) · "
        f"模块 {stats['module_count']} · md# {md_hash}"
    )
    return 0


if __name__ == "__main__":
    # R16①：受控错误类别 + 非零退出，禁止未处理 traceback
    try:
        sys.exit(main())
    except RepoNotFound as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(3)
    except VerifyError as exc:
        print(f"MATRIX_VERIFY_FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
    except FileNotFoundError as exc:
        print(f"MATRIX_INPUT_MISSING: {exc.filename or exc}", file=sys.stderr)
        sys.exit(2)
