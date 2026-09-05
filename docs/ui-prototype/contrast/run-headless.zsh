#!/bin/zsh
# ============================================================================
# 单一版本/基线来源（R15③）：所有文案同步自本文件，漂移即 fail-closed
VF="$(cd "$(dirname "$0")" && pwd)/VERSION"
if [ ! -f "$VF" ]; then echo "❌ 缺少 VERSION 单一来源文件"; exit 90; fi
source "$VF"
: "${VERSION:?VERSION 未定义}" "${BASELINE:?BASELINE 未定义}"
# Artemis components.html 对比度矩阵驱动 · fail-closed v17
# v17（原型完成门禁）:
#   - T8 执行 70 张卡片通用契约与 23 个定向交互契约（22 历史 partial/uncovered + v19 13c 任务计划胶囊）
#   - T9 执行主页面 normal / 200% zoom / Dock closed 布局与 ARIA 审计
# 变更（回应第六轮评审）:
#   - 运行前清理旧结果；无 SCAN_OUT / 出现 scannerError / 断言缺失一律判 FAIL 并非零退出
#   - 结果必须恰好 36 个唯一组合；checked < 500 视为部分扫描失败
#   - 校验 CHROME 可执行并记录版本；任何 CRIT 使脚本退出码非零
#   - 命名修正：36 组合 = 方向 × 主题 × 对比度 × 三种扫描场景(default/open/hover)，非"全状态矩阵"
# v7（回应第七轮评审）:
#   - 固定 manifest 校验：结果必须与 36 个预期组合一一对应，缺失/额外/单项未产出（组合中途崩溃未写
#     JSON）全部 FAIL——不再以"读到的文件数"冒充 combos
#   - fixtures 真实渲染像素对照（contrast/fixtures.html）：三趟截图（正常/文字隐藏/高对比字形mask）+ PNG 解码，
#     采样字形核与邻近背景中位色求比值——不再复用扫描器合成公式
#   - manifest v8：除文件名集合外，逐文件校验 meta.combo / meta.label 与文件名（含场景）一致
# v11（回应第十一轮评审收敛三项）:
#   - coverageOf 零 DOM 写入（Range.getClientRects）+ 扫描前后 DOM 结构指纹（structHash）不变量
#   - 显式等价类（hover normal/high 6 组）让正常矩阵可归零；未声明重复仍 FAIL
#   - 第三趟高对比字形 mask：融合确认须 mask 证明字形占用；空格/间隙 fail-closed
#   - 采样裁剪标记 INDETERMINATE_SAMPLING_CAP（逐行 fail-closed）
# v16.1（独立复核修复）:
#   - gen_matrix 的 import 排除改为整段静态 import 识别，普通成员（如 useState,）
#     与 type 成员都不得充当定义锚点；生成器内置不依赖基线行号的契约自测
# v16（回应第十六轮评审阻断①②③）:
#   - 附件 zip 顶层带 prototype/，解压到仓库根即可运行；gen_matrix 路径从脚本位置解析
#     （--proto-root/--repo 可显式覆盖），路径错误输出受控类别（MATRIX_INPUT_MISSING/
#     MATRIX_REPO_NOT_FOUND）+ 非零退出，无 traceback
#   - T6 解压布局自测 + T7 平铺布局自测：两种布局各跑完整入口（RUN_SELFTESTS=0）+ 矩阵校验
#   - 结构反例扩至 14 用例（深层 70 层 aria-label / contenteditable / input.value），
#     scanner 取消 64 层静默截断；T1 表述降格为「账本格式与计数一致」
# v15（回应第十五轮评审阻断项①③）:
#   - 单一版本来源：contrast/VERSION（VERSION + BASELINE + NOBROWSER_EXIT），runner source 之；
#     预检强制 scanner/README/proposal/capability-matrix 含当前版本，REPORT 标题由常量生成——
#     消灭"README v13 / REPORT v11"式漂移；漂移即 VERSION_DRIFT 非零退出
#   - 自测入口固化（同一命令完成正常基线 + 全部自测）：audit schema 负向×4、
#     投影后等价单侧注入负向×2、重放/清单额外负向、无浏览器退出码断言（对照常量），
#     每条自测断言预期错误类别 + 非零退出；内层调用 RUN_SELFTESTS=0 防递归
# v14（回应第十三轮评审收敛三项）:
#   - audit 强制 schema：四字段精确类型（structBefore/After 非空 str、changed/capped bool），缺失/畸形/类型错一律 AUDIT_SCHEMA FAIL
#   - structHash 升级为规范化结构树指纹（父子边界括号 + id/role/aria-label/aria-controls/aria-expanded/
#     aria-describedby/aria-labelledby/for/hidden/disabled + 完整排序 class 集合 + 元素/文本/组件计数），
#     跨父交换、ARIA 语义变化、id/role 丢失、卡片归属变化必改指纹
#   - 基线 0acb259d0b2b8bf50a50775f9f3aca79060c2591
# v9（回应第九轮评审）:
#   - 执行绑定：每次组合注入随机 nonce（&n=…），扫描器回读页面真实 DOM 状态 + nonce 写入
#     payload.state；行校验 NONCE_MISMATCH——重放旧 DOM / 事后改写 JSON 均失败
#   - canonical 去重：内容哈希剥离整个 meta（generatedAt/combo/label 等身份字段），
#     只对 state+扫描结果+断言哈希——同内容跨组合重放必然哈希相同即 FAIL
#   - 渐变采样按元素像素宽度绑定（每像素 1 样本并入 stop 端点），fixtures 列级采样并
#     新增窄色带反例（10.25%–10.75% 带，固定 17 点漏检型）
#   - open 场景：Expected-visible 断言(dialog/menu/toast)；Toast 以静态构造注入避免 3s 自毁时机问题；
#     slash 菜单常驻可见不计入 open 断言
# ============================================================================
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="$ROOT/contrast/results"
mkdir -p "$OUT"
rm -f "$OUT"/*.json "$ROOT/contrast/summary.json"    # ④ 运行前清理旧结果

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "CRIT: Chrome 不可执行: $CHROME"; exit 2; }
CHROME_VER="$("$CHROME" --version 2>/dev/null || echo unknown)"
[[ "$CHROME_VER" == unknown ]] && { echo "CRIT: 无法读取 Chrome 版本"; exit 2; }

# ---- R15③ 预检：单一版本/基线来源同步（漂移即 fail-closed，不再靠人肉 grep） ----
PREF_BAD=""
grep -q "对比度全矩阵扫描器 ${VERSION}" "$ROOT/contrast/scanner.js" || PREF_BAD="$PREF_BAD scanner.js(版本)"
grep -q "${VERSION}" "$ROOT/README.md" || PREF_BAD="$PREF_BAD README(版本)"
grep -q "${BASELINE:0:7}" "$ROOT/README.md" || PREF_BAD="$PREF_BAD README(基线)"
grep -q "${VERSION}" "$ROOT/proposal-ui-library.md" || PREF_BAD="$PREF_BAD proposal(版本)"
grep -q "${VERSION}" "$ROOT/capability-matrix.md" || PREF_BAD="$PREF_BAD matrix(版本)"
grep -q "${BASELINE:0:7}" "$ROOT/capability-matrix.md" || PREF_BAD="$PREF_BAD matrix(基线)"
grep -q "runPrototypeContracts" "$ROOT/tools/prototype-contracts.js" || PREF_BAD="$PREF_BAD prototype-contracts.js(缺失)"
if grep -nE 'capability-matrix.{0,40}，[[:space:]]*v1[0-4]' "$ROOT/README.md" >/dev/null 2>&1; then PREF_BAD="$PREF_BAD README(旧版矩阵标注)"; fi
if [ -n "$PREF_BAD" ]; then echo "CRIT: VERSION_DRIFT 文案与单一来源不同步:$PREF_BAD"; exit 91; fi
echo "预检: 版本/基线同步 OK（${VERSION} @ ${BASELINE:0:7}）"

TMP="$(mktemp -d /tmp/artemis-contrast.XXXXXX)"

node - "$ROOT" "$TMP" <<'NODE'
const fs = require("fs");
const [root, tmp] = process.argv.slice(2);
let html = fs.readFileSync(root + "/components.html", "utf8");
const scanner = fs.readFileSync(root + "/contrast/scanner.js", "utf8");
const boot = `
<script>
/* 扫描引导 v6：open 态 expected-visible 断言 + 双帧等待 */
(function () {
  function ready(fn){ document.readyState !== "loading" ? fn() : document.addEventListener("DOMContentLoaded", fn); }
  ready(function () {
    var hp = new URLSearchParams(location.hash.slice(1));
    var s = hp.get("s") || "default";
    var miss = [];
    function doOpen() {
      /* 任务计划胶囊浮窗（v19：点击固定展开，供 open 场景扫描步骤文本对比度）。
         必须最先点击：click 冒泡到 document 会触发下拉的「点外关闭」监听，
         放在菜单之后会把已打开的 .menu 关掉（menu.open<1）。 */
      var planBtn = document.querySelector("#planTrigger"); if (planBtn) planBtn.click();
      ["#openDlg", "#toastInfo", "#toastErr"].forEach(function (sel) {
        var b = document.querySelector(sel); if (b) b.click();
      });
      document.querySelectorAll(".select-trig").forEach(function (t, i) { if (i < 4) t.click(); });
      /* Toast：show 类由 rAF 追加且 3s 自毁——构造静态等价节点供扫描，语义/底色一致 */
      try {
        var host = document.getElementById("toastHost");
        ["info", "error"].forEach(function (k) {
          var t = document.createElement("div");
          t.className = "toast" + (k === "error" ? " error show" : " show");
          t.setAttribute("role", k === "error" ? "alert" : "status");
          t.textContent = k === "error" ? "操作失败，请重试" : "已保存更改";
          host.appendChild(t);
        });
      } catch (e) {}
    }
    setTimeout(function () {
      try {
        if (s === "open") {
          doOpen();
          setTimeout(function(){ check(); }, 400);   // 等待浮层渲染周期（rAF 在 headless 虚拟时间下不推进）
          return;
        }
        if (s === "hover") {
          var css = [];
          document.querySelectorAll("style").forEach(function (tag) {
            tag.textContent.split("}").forEach(function (chunk) {
              var sel = chunk.split("{")[0];
              if (sel.includes(":hover")) css.push(chunk + "}");
            });
          });
          var st = document.createElement("style");
          st.textContent = css.join("\\n").replace(/:hover/g, ".__h");
          document.head.appendChild(st);
          document.querySelectorAll("*").forEach(function (el) { if (el.classList) el.classList.add("__h"); });
        }
        check();
      } catch (e) { miss.push("boot:" + e.message); finish(); }
      function check() {
        if (s === "open") {
          if (!document.querySelector(".overlay.open")) miss.push("dialog");
          if (document.querySelectorAll(".menu.open").length < 1) miss.push("menu.open<1");
          if (!document.querySelector("#toastHost .toast.show")) miss.push("toast.show");
          var planList = document.querySelector("#planList");
          if (planList && planList.hidden) miss.push("planList.hidden");
        }
        finish();
      }
      function finish() {
        if (miss.length) document.body.setAttribute("data-assert-miss", miss.join(","));
        if (window.ContrastScanner) window.ContrastScanner.run(location.hash.replace("#", ""));
        else document.body.setAttribute("data-scan-error", "ContrastScanner missing");
      }
    }, 500);
  });
})();
<\/script>
</body>`;
html = html.replace("</head>", '<style>*{transition:none !important;animation:none !important}</style></head>');
html = html.replace("</body>", "<script>" + scanner + "</script>" + boot + "\n</html>");
fs.writeFileSync(tmp + "/harness.html", html);
console.log("harness:", tmp + "/harness.html", html.length, "bytes");
NODE

DIRECTIONS=(a b c); THEMES=(light dark); CONTRASTS=(normal high); STATES=(default open hover)
PASS=0; FAIL=0; CRIT=0
for d in $DIRECTIONS; do for t in $THEMES; do for c in $CONTRASTS; do for s in $STATES; do
  NAME="$d-$t-$c-$s"
  NONCE="n${RANDOM}${RANDOM}${RANDOM}"
  "$CHROME" --headless --disable-gpu --window-size=1440,900 --virtual-time-budget=10000 \
    --dump-dom "file://$TMP/harness.html#d=$d&t=$t&c=$c&s=$s&n=$NONCE" > "$TMP/out.html" 2>/dev/null
  python3 - "$TMP/out.html" "$OUT/$NAME.json" "$d" "$t" "$c" "$s" "$NONCE" <<'PY' 
import sys, re, json, urllib.parse
src_path, dst = sys.argv[1], sys.argv[2]
exp_d, exp_t, exp_c, exp_s, exp_nonce = sys.argv[3:8]
src = open(src_path, encoding='utf-8', errors='ignore').read()
m = re.search(r'id="SCAN_OUT"[^>]*data-json="([^"]*)"', src)
def save(err):
    json.dump({"meta":{"label":dst},"summary":{"failures":-1,"countMismatches":-1,"exempt":0,"checked":0},
               "errors":[err],"row":{"status":"ERROR","detail":err}}, open(dst,"w"), ensure_ascii=False)
if not m: save("NO_SCAN_RESULT"); print("FAIL(无结果)", dst.split("/")[-1]); sys.exit(3)
d = json.loads(urllib.parse.unquote(m.group(1)))
errs = []
if d["meta"].get("scannerError"): errs.append("scannerError")
miss = re.search(r'data-assert-miss="([^"]*)"', src)
if miss and miss.group(1): errs.append("断言缺失:" + miss.group(1))
am = re.search(r'data-scan-error="([^"]*)"', src)
if am: errs.append(am.group(1))
ok_flag = m and 'data-ok="true"' in src[src.find(m.group(0))-200:src.find(m.group(0))+len(m.group(0))+50]
if int(d["summary"]["checked"]) < 500: errs.append(f"checked 过低({d['summary']['checked']})")
# v9 执行绑定：nonce 回读 + 页面最终状态
state = d.get("state") or {}
if state.get("nonce") != exp_nonce:
    errs.append(f"NONCE_MISMATCH(state={state.get('nonce')!r} expected={exp_nonce!r})")
if (state.get("direction"), state.get("theme"), state.get("contrast")) != (exp_d, exp_t, exp_c):
    errs.append(f"STATE_MISMATCH(state={state.get('direction')}/{state.get('theme')}/{state.get('contrast')})")
label = d.get("meta", {}).get("label", "")
core_label = "&".join(p for p in label.split("&") if not p.startswith("n="))
if core_label != f"d={exp_d}&t={exp_t}&c={exp_c}&s={exp_s}":
    errs.append(f"LABEL_MISMATCH(label={label!r})")
err_txt = ";".join(errs)
d["row"]={"status":("PASS" if (not errs and d["summary"]["failures"]==0 and d["summary"]["countMismatches"]==0 and int(d["summary"]["checked"])>=500) else "FAIL"),
          "detail":";".join(errs)}
json.dump(d, open(dst, "w"), ensure_ascii=False, indent=1)
status = d["row"]["status"]
print(status, dst.split("/")[-1],
      f"failures={d['summary']['failures']} mismatch={d['summary']['countMismatches']} "
      f"checked={d['summary']['checked']} exempt={d['summary']['exempt']}"
      + ((" | " + err_txt) if err_txt else ""))
sys.exit(0)
PY
done; done; done; done

# ---- fixtures 真实渲染像素对照（v12）：三趟截图（正常/文字隐藏/高对比字形mask）+ PNG 解码，不复用扫描器公式 ----
FXJSON="$ROOT/contrast/fixtures-result.json"
rm -f "$FXJSON"
SHOT_FLAGS="--headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,1400"
"$CHROME" ${=SHOT_FLAGS} --screenshot="$TMP/fx.png"        "file://$ROOT/contrast/fixtures.html" >/dev/null 2>&1
"$CHROME" ${=SHOT_FLAGS} --screenshot="$TMP/fx-notext.png" "file://$ROOT/contrast/fixtures.html#notext=1" >/dev/null 2>&1
"$CHROME" ${=SHOT_FLAGS} --screenshot="$TMP/fx-mask.png"   "file://$ROOT/contrast/fixtures.html#mask=1" >/dev/null 2>&1
"$CHROME" --headless --disable-gpu --window-size=1200,1400 --virtual-time-budget=10000 \
  --dump-dom "file://$ROOT/contrast/fixtures.html" > "$TMP/fxout.html" 2>/dev/null
python3 - "$TMP/fxout.html" "$TMP/fx.png" "$TMP/fx-notext.png" "$TMP/fx-mask.png" "$FXJSON" <<'PY'
import sys, re, json, urllib.parse, zlib
from collections import Counter
fxout, png_a, png_b, png_m, out = sys.argv[1:6]
def fail(rc, msg):
    json.dump({"ok": False, "error": msg}, open(out, "w"), ensure_ascii=False)
    print("FIXTURES FAIL:", msg); sys.exit(rc)
m = re.search(r'id="FX_OUT"[^>]*data-json="([^"]*)"', open(fxout, encoding='utf-8', errors='ignore').read())
if not m: fail(3, "NO_FX_RESULT（fixtures 未产出结果）")
d = json.loads(urllib.parse.unquote(m.group(1)))
if d.get("scannerError"): fail(4, "scannerError: " + d["scannerError"])
if not d.get("cases"): fail(3, "FX 无用例")
def decode_png(path):
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n": fail(3, "非 PNG: " + path)
    pos, W, H, bd, ct, idat = 8, 0, 0, 0, 0, b""
    while pos < len(data):
        ln = int.from_bytes(data[pos:pos+4], "big"); typ = data[pos+4:pos+8]
        chunk = data[pos+8:pos+8+ln]; pos += 12 + ln
        if typ == b"IHDR":
            W = int.from_bytes(chunk[0:4], "big"); H = int.from_bytes(chunk[4:8], "big")
            bd = chunk[8]; ct = chunk[9]
        elif typ == b"IDAT": idat += chunk
        elif typ == b"IEND": break
    if bd != 8 or ct not in (2, 6): fail(3, "不支持的 PNG 格式 bd=%s ct=%s" % (bd, ct))
    ch = 4 if ct == 6 else 3
    raw = zlib.decompress(idat); stride = W * ch
    prev = bytearray(stride); buf = bytearray(); p = 0
    for _ in range(H):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if f == 1:
            for x in range(ch, stride): line[x] = (line[x] + line[x-ch]) & 255
        elif f == 2:
            for x in range(stride): line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                line[x] = (line[x] + ((line[x-ch] if x >= ch else 0) + prev[x]) // 2) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x-ch] if x >= ch else 0; b = prev[x]; c = prev[x-ch] if x >= ch else 0
                pp = a + b - c; pa, pb, pc = abs(pp-a), abs(pp-b), abs(pp-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        buf += line; prev = line
    return W, H, ch, buf
imgA = decode_png(png_a); imgB = decode_png(png_b); imgM = decode_png(png_m)
def pxof(img, x, y):
    W, H, ch, buf = img; o = (y*W + x)*ch; return (buf[o], buf[o+1], buf[o+2])
def lum(rgb):
    def f(x):
        x /= 255.0
        return x/12.92 if x <= 0.03928 else ((x+0.055)/1.055) ** 2.4
    return 0.2126*f(rgb[0]) + 0.7152*f(rgb[1]) + 0.0722*f(rgb[2])
def cratio(a, b):
    l1, l2 = lum(a), lum(b); hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)
def med(v):
    v = sorted(v); return v[len(v)//2]
def dist(a, b):
    return (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2
def col_stats(imgA, imgB, xx, y0, y1):
    # 单列：背景=隐藏文字趟该列中位；返回 (字形核比值|None, 列最大信号强度)
    bd = med([pxof(imgB, xx, yy) for yy in range(y0, y1)])
    ds = [dist(pxof(imgA, xx, yy), bd) for yy in range(y0, y1)]
    maxd = max(ds)
    if maxd < 900: return None, maxd               # 该列无可分字形（含 ink≈bg 融合）
    thr = maxd * 0.85
    core = med([p for dd, p in zip(ds, [pxof(imgA, xx, yy) for yy in range(y0, y1)]) if dd >= thr])
    return cratio(core, bd), maxd
def column_ratio(imgA, imgB, xx, y0, y1):
    return col_stats(imgA, imgB, xx, y0, y1)[0]
cases = []
for c in d["cases"]:
    if c.get("expectIndet"):
        # R11④：触发采样裁剪的用例——通过条件 = 扫描器标记 INDETERMINATE_SAMPLING_CAP
        ok = c.get("capped") is True
        cases.append({"id": c["id"], "expectIndet": True, "capped": c.get("capped"),
                      "scannerRatio": c.get("scannerRatio"), "ok": ok,
                      "note": "INDETERMINATE_SAMPLING_CAP 用例：裁剪触发必须被标记（fail-closed）"})
        continue
    t = c["textRect"]
    rendered = []                                   # 有字形列的比值
    col_at_worst = None
    if c.get("worstX") is not None and not c.get("emptyCov"):
        wx = max(t["x"], min(c["worstX"], t["x"] + t["w"] - 1))
        # R10③：worstX 命中验证——以 worstX 为中心 ±2px 窗口内找有效字形核列（容差应对字间空隙）；
        # 全窗口无字形 → worstColRatio=None → 反例 fail-closed，禁止回退 rmin
        cols = []
        for xx in range(max(t["x"], wx - 2), min(t["x"] + t["w"] - 1, wx + 2) + 1):
            r0 = column_ratio(imgA, imgB, xx, t["y"] + 2, t["y"] + t["h"] - 2)
            if r0 is not None: cols.append(r0)
        col_at_worst = min(cols) if cols else None
    for xx in range(t["x"], t["x"] + t["w"]):
        r0 = column_ratio(imgA, imgB, xx, t["y"] + 2, t["y"] + t["h"] - 2)
        if r0 is not None: rendered.append(r0)
    if not rendered:
        if c.get("emptyCov"):
            # 空覆盖安全用例：无可判定字形——扫描器须安全回退（cov=null→元素宽）不崩溃、不误报
            ok = (not c["bad"]) and c.get("scannerPass") is True
            cases.append({"id": c["id"], "emptyCov": True, "scannerRatio": c["scannerRatio"],
                          "need": c["need"], "ok": ok,
                          "note": "空覆盖安全用例：无字形列，扫描器安全跳过且未误报"})
            continue
        fail(4, "用例 %s 无可见字形列" % c["id"])
    rmin = round(min(rendered), 2); rmax = round(max(rendered), 2)
    need = c["need"]
    conf_kind = "good-case"
    if c["bad"]:
        # R10③/R11② 反例确认（不得用全局 rmin 兜底）：
        # a) worstX 列（±2px 窗口）采到有效字形核且 < need；或
        # b) 融合：worstX ±6px 窗口整窗无信号、不贴 textRect 边缘、其他列有字形，
        #    且 mask 趟证明该窗口本应存在字形（独立字形占用证据）；
        # c) 空格/字间空白（mask 证明无字形）→ 必须拒绝确认（fail-closed）。
        confirm = False
        conf_kind = "no-evidence"
        if col_at_worst is not None:
            confirm = col_at_worst < need
            conf_kind = "glyph-core" if confirm else "glyph-core-pass"
        elif c.get("worstX") is not None:
            wx0, wx1 = max(t["x"], c["worstX"] - 6), min(t["x"] + t["w"] - 1, c["worstX"] + 6)
            edge = (c["worstX"] - 6 < t["x"]) or (c["worstX"] + 6 > t["x"] + t["w"] - 1)
            if not edge and rendered:
                md = 0
                for xx in range(wx0, wx1 + 1):
                    _, mx = col_stats(imgA, imgB, xx, t["y"] + 2, t["y"] + t["h"] - 2)
                    md = max(md, mx)
                if md < 900:
                    # mask 趟（高对比同布局）证明该窗口本应有字形 → 融合确认；否则空格/间隙 → 不确认
                    mask_hit = False
                    for xx in range(wx0, wx1 + 1):
                        _, mm = col_stats(imgM, imgB, xx, t["y"] + 2, t["y"] + t["h"] - 2)
                        if mm >= 900: mask_hit = True; break
                    confirm = mask_hit
                    conf_kind = "fused+mask" if mask_hit else "mask-no-glyph(空格/间隙→fail-closed)"
        if c.get("expectUnconfirmed"):
            # 陷阱用例：通过条件 = 扫描器判 FAIL 且 runner 拒绝确认（mask 证明无字形）
            ok = (not c["scannerPass"]) and (not confirm)
        else:
            ok = (not c["scannerPass"]) and confirm
    else:
        # 好例：真实渲染的纯字形核列（rmax）本身达标，且模型不高于像素证据（不虚报）
        ok = c["scannerPass"] and rmax >= need - 0.05 and c["scannerRatio"] <= rmax + 0.5
    cases.append({"id": c["id"], "scannerRatio": c["scannerRatio"], "renderedMin": rmin,
                  "renderedMax": rmax, "need": need, "ok": ok,
                  "worstColRatio": (round(col_at_worst, 2) if col_at_worst is not None else None),
                  "confirm": conf_kind})
bad_ids = [c["id"] for c in d["cases"] if c["bad"]]
bad_flagged = all(any(cc["id"] == bid and cc["ok"] for cc in cases) for bid in bad_ids)
unexpected = [f for f in d.get("failures", []) if not any(bid in f for bid in bad_ids)]
ok = (not d.get("scannerError")) and bad_flagged and not unexpected and all(c["ok"] for c in cases)
res = {"ok": ok, "badFlagged": bad_flagged, "unexpected": unexpected, "cases": cases,
       "method": "三趟截图（正常/文字隐藏/高对比字形mask）PNG 解码：列级采样（背景=隐藏趟列中位、字形核 ≥85%maxdist 中位）；反例在 worstX 列定向确认；融合确认须 mask 趟证明字形占用，空格/间隙 fail-closed"}
json.dump(res, open(out, "w"), ensure_ascii=False, indent=1)
print("FIXTURES", "PASS" if ok else "FAIL", "cases=%d" % len(cases))
sys.exit(0 if ok else 4)
PY
FX_RC=$?

# ---- 结构不变量负向用例（R13②六类 + R15①两反例 + chrome 边界 + R16②三反例）：structure-check.html 十四用例必须全过 ----
STJSON="$ROOT/contrast/structure-result.json"
rm -f "$STJSON"
"$CHROME" --headless --disable-gpu --window-size=1200,600 --virtual-time-budget=10000 \
  --dump-dom "file://$ROOT/contrast/structure-check.html" > "$TMP/stout.html" 2>/dev/null
python3 - "$TMP/stout.html" "$STJSON" <<'PY'
import sys, re, json, urllib.parse
src, out = sys.argv[1], sys.argv[2]
def fail(rc, msg):
    json.dump({"ok": False, "error": msg}, open(out, "w"), ensure_ascii=False)
    print("STRUCT FAIL:", msg); sys.exit(rc)
m = re.search(r'id="STRUCT_OUT"[^>]*data-json="([^"]*)"', open(src, encoding='utf-8', errors='ignore').read())
if not m: fail(3, "NO_STRUCT_RESULT（结构负向用例未产出）")
d = json.loads(urllib.parse.unquote(m.group(1)))
if not d.get("cases"): fail(3, "结构负向无用例")
bad = [c["id"] for c in d["cases"] if not c.get("ok")]
ok = d.get("ok") and not bad
res = {"ok": ok, "cases": d["cases"], "failedCases": bad}
json.dump(res, open(out, "w"), ensure_ascii=False, indent=1)
print("STRUCT", "PASS" if ok else "FAIL", "cases=%d" % len(d["cases"]), ("失败: "+",".join(bad)) if bad else "")
sys.exit(0 if ok else 5)
PY
ST_RC=$?

# ---- T8 原型契约：70 卡片全部具备完整骨架，历史 20 partial + 2 uncovered + 13c 任务计划胶囊逐项执行交互 ----
CONTRACT_JSON="$ROOT/contrast/prototype-contract-result.json"
rm -f "$CONTRACT_JSON"
node - "$ROOT" "$TMP" <<'NODECONTRACT'
const fs = require("fs");
const [root, tmp] = process.argv.slice(2);
let html = fs.readFileSync(root + "/components.html", "utf8");
const contracts = fs.readFileSync(root + "/tools/prototype-contracts.js", "utf8");
const boot = `<script>${contracts}<\/script><script>
setTimeout(async function () {
  var out = document.createElement("output"); out.id = "CONTRACT_OUT"; out.hidden = true;
  try { var result = await window.runPrototypeContracts(); out.setAttribute("data-ok", String(result.ok)); out.setAttribute("data-json", encodeURIComponent(JSON.stringify(result))); }
  catch (e) { out.setAttribute("data-ok", "false"); out.setAttribute("data-json", encodeURIComponent(JSON.stringify({ok:false,failures:["runner: "+e.stack]}))); }
  document.body.appendChild(out);
}, 180);
<\/script></body>`;
html = html.replace("</body>", boot);
fs.writeFileSync(tmp + "/contract-harness.html", html);
NODECONTRACT
"$CHROME" --headless --disable-gpu --window-size=1440,900 --virtual-time-budget=10000 \
  --dump-dom "file://$TMP/contract-harness.html" > "$TMP/contract-out.html" 2>/dev/null
python3 - "$TMP/contract-out.html" "$CONTRACT_JSON" <<'PYCONTRACT'
import json, re, sys, urllib.parse
src, out = sys.argv[1:3]
text = open(src, encoding="utf-8", errors="ignore").read()
m = re.search(r'id="CONTRACT_OUT"[^>]*data-json="([^"]*)"', text)
if not m:
    result = {"ok": False, "failures": ["NO_CONTRACT_RESULT"]}
else:
    result = json.loads(urllib.parse.unquote(m.group(1)))
json.dump(result, open(out, "w"), ensure_ascii=False, indent=1)
ok = result.get("ok") is True and result.get("totalCards") == 70 and result.get("passedCards") == 70 and result.get("targetedCards") == 23
print("T8 原型契约", "PASS" if ok else "FAIL", "cards=%s/%s targeted=%s failures=%s" % (result.get("passedCards"), result.get("totalCards"), result.get("targetedCards"), len(result.get("failures", []))))
if not ok:
    print("  " + "\n  ".join(result.get("failures", [])[:20]))
sys.exit(0 if ok else 6)
PYCONTRACT
CT_RC=$?

# ---- T9 主页面布局：正常、200% zoom、Dock closed；无结果/越界/ARIA 漂移一律失败 ----
LAYOUT_JSON="$ROOT/contrast/layout-result.json"
rm -f "$LAYOUT_JSON"
for CASE in normal zoom200 closed; do
  FLAGS=(--headless --disable-gpu --window-size=1440,900 --virtual-time-budget=10000)
  HASH="audit=1"
  if [ "$CASE" = "zoom200" ]; then FLAGS+=(--force-device-scale-factor=2); fi
  if [ "$CASE" = "closed" ]; then HASH="audit=1&dock=closed"; fi
  "$CHROME" $FLAGS --dump-dom "file://$ROOT/apple-inspired-ui.html#$HASH" > "$TMP/layout-$CASE.html" 2>/dev/null
done
python3 - "$TMP" "$LAYOUT_JSON" <<'PYLAYOUT'
import json, re, sys
from html import unescape
tmp, out = sys.argv[1:3]
cases, failures = [], []
for name in ("normal", "zoom200", "closed"):
    text = open(f"{tmp}/layout-{name}.html", encoding="utf-8", errors="ignore").read()
    m = re.search(r'<output[^>]*id="LAYOUT_OUT"[^>]*>(.*?)</output>', text, re.S)
    if not m:
        data = {"ok": False, "failures": ["NO_LAYOUT_RESULT"]}
    else:
        data = json.loads(unescape(m.group(1)))
    data["case"] = name; cases.append(data)
    if data.get("ok") is not True:
        failures.extend([name + ": " + item for item in data.get("failures", ["unknown failure"])])
result = {"ok": not failures, "cases": cases, "failures": failures}
json.dump(result, open(out, "w"), ensure_ascii=False, indent=1)
print("T9 页面布局", "PASS" if result["ok"] else "FAIL", "cases=3 failures=%d" % len(failures))
if failures: print("  " + "\n  ".join(failures[:20]))
sys.exit(0 if result["ok"] else 7)
PYLAYOUT
LY_RC=$?

python3 - "$OUT" "$ROOT/contrast" "$CHROME_VER" "$FXJSON" "$VERSION" <<'PY'
import sys, json, glob, os, hashlib
outdir, cdir, ver = sys.argv[1], sys.argv[2], sys.argv[3]
fxpath = sys.argv[4] if len(sys.argv) > 4 else ""
files = sorted(glob.glob(os.path.join(outdir, "*.json")))
# v7 manifest：与 36 预期组合一一对应
DIRS=("a","b","c"); THEMES=("light","dark"); CONS=("normal","high"); STATES=("default","open","hover")
expected = {"%s-%s-%s-%s.json" % (d,t,c,s) for d in DIRS for t in THEMES for c in CONS for s in STATES}
actual = {os.path.basename(f) for f in files}
missing, extra = sorted(expected - actual), sorted(actual - expected)
rows, crit = [], 0
# R11③ 显式等价类（评审认可声明等价，不建议机械修改 hover 颜色）：
# 语义理由——hover 态渲染仅由 [data-direction]/[data-theme] token 决定，
# components.html 的 CSS 无任何 [data-contrast] hover 差异 → normal/high 的 hover
# 场景扫描内容相同是设计事实。声明内精确重复 PASS（EQUIV_DECLARED）；声明失效
# （同组内容不同）与任何未声明重复一律 FAIL；全量重放仍产生大量未声明重复 → FAIL。
EQUIV_CLASSES = [
    ("a-dark-normal-hover", "a-dark-high-hover"),
    ("a-light-normal-hover", "a-light-high-hover"),
    ("b-dark-normal-hover", "b-dark-high-hover"),
    ("b-light-normal-hover", "b-light-high-hover"),
    ("c-dark-normal-hover", "c-dark-high-hover"),
    ("c-light-normal-hover", "c-light-high-hover"),
]
EQUIV_REASON = "投影后等价：hover 态内容在剥离①已审查豁免条目（占位符/禁用/装饰）的 ratio/fg/bg 颜色、②侧栏组合自反 chrome（dirSeg/themeSeg/contrastSeg，data-struct-chrome 标记）内部反映请求组合身份的 aria-selected/tabindex 后相同；非豁免内容与豁免 identity/reason 差异仍判 EQUIV_STALE（R13 认可方向 + R15② chrome 披露）"
equiv_of = {}
for ci, members in enumerate(EQUIV_CLASSES):
    for m in members:
        equiv_of[m] = ci   # 成员名不含 .json 后缀
seen_hash = {}
seen_equiv = {}
for mname in missing:
    rows.append({"file": mname, "status": "ERROR", "detail": "MANIFEST 缺失（组合未产出）"}); crit += 1
for ename in extra:
    rows.append({"file": ename, "status": "ERROR", "detail": "MANIFEST 额外文件"}); crit += 1
for f in files:
    d = json.load(open(f))
    name = os.path.basename(f)
    errs = list(d.get("errors", []))
    if d.get("row", {}).get("detail"): errs.append(d["row"]["detail"])
    if d.get("meta", {}).get("scannerError"): errs.append(d["meta"]["scannerError"])
    fails = d.get("summary", {}).get("failures", None)
    mis   = d.get("summary", {}).get("countMismatches", None)
    chk   = d.get("summary", {}).get("checked", 0)
    if errs or fails is None:
        crit += 1; rows.append({"file": name, "status": "ERROR", "detail": ";".join(errs)}); continue
    # v8：元数据与文件名一致性（组合逻辑唯一性的第一道防线）
    exp = name[:-5].split("-")
    combo = d.get("meta", {}).get("combo") or {}
    label = d.get("meta", {}).get("label", "")
    core_label = "&".join(p for p in label.split("&") if not p.startswith("n="))
    if (combo.get("direction"), combo.get("theme"), combo.get("contrast")) != tuple(exp[:3]) \
            or core_label != "d=%s&t=%s&c=%s&s=%s" % tuple(exp):
        errs.append("COMBO_MISMATCH(combo=%s label=%s)" % (json.dumps(combo, ensure_ascii=False), label))
    # v11–v15：audit 强制 schema（R12① + R13① + R15①）——五字段精确类型
    # （structBefore/After 完整 JSON 元组串、structFingerprint、structChanged、samplingCapped），缺失/畸形一律 fail-closed
    au = d.get("audit")
    if not isinstance(au, dict):
        errs.append("AUDIT_SCHEMA(缺失或类型错误，fail-closed)")
    else:
        sb = au.get("structBefore"); sa = au.get("structAfter")
        sc = au.get("structChanged"); cap = au.get("samplingCapped")
        fp = au.get("structFingerprint")
        # structBefore/structAfter：必须是完整规范化结构串（R13②：零碰撞比较判据）
        if not isinstance(sb, str) or not sb: errs.append("AUDIT_SCHEMA(structBefore 类型错误/空)")
        if not isinstance(sa, str) or not sa: errs.append("AUDIT_SCHEMA(structAfter 类型错误/空)")
        # structFingerprint：报告摘要，必须非空字符串
        if not isinstance(fp, str) or not fp: errs.append("AUDIT_SCHEMA(structFingerprint 类型错误/空)")
        # structChanged/samplingCapped：必须是 bool
        if not isinstance(sc, bool): errs.append("AUDIT_SCHEMA(structChanged 非布尔)")
        if not isinstance(cap, bool): errs.append("AUDIT_SCHEMA(samplingCapped 非布尔)")
        if sc is True: errs.append("STRUCT_CHANGED(扫描破坏被测 DOM，fail-closed)")
        if cap is True: errs.append("INDETERMINATE_SAMPLING_CAP(采样被裁剪，fail-closed)")
        if isinstance(sb, str) and isinstance(sa, str) and sb != sa:
            errs.append("STRUCT_CHANGED(structBefore≠structAfter)")
    # v10/v11：canonical 内容哈希——剥离 meta 与 state 的身份字段（direction/theme/contrast/nonce），
    # 只覆盖实际扫描结果、断言、失败/豁免与计数；执行绑定证据（nonce/state）仅逐行校验，不进哈希。
    d2 = json.loads(json.dumps(d)); d2.pop("meta", None)
    st = d2.pop("state", {})
    d2["state"] = {k: v for k, v in st.items() if k not in ("direction", "theme", "contrast", "nonce")}
    if not d2["state"]: d2.pop("state", None)

    hsh = hashlib.sha256(json.dumps(d2, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    stem = name[:-5]
    notes = []
    cls = equiv_of.get(stem)
    declared_ok = False
    if cls is not None:
        f = seen_equiv.get(cls)
        # 等价判定用「剥豁免颜色」的哈希：hover 态内容相同即等价，豁免条目颜色差异允许
        d2e = json.loads(json.dumps(d2))
        for ex in d2e.get("exemptions", []):
            if isinstance(ex, dict):
                ex.pop("ratio", None); ex.pop("fg", None); ex.pop("bg", None)
        equiv_hsh = hashlib.sha256(json.dumps(d2e, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        if f is None:
            seen_equiv[cls] = (stem, equiv_hsh)
        elif equiv_hsh == f[1]:
            declared_ok = True
            notes.append("EQUIV_DECLARED（投影后等价类 %d 内与 %s 投影后相同：%s）" % (cls, f[0], EQUIV_REASON))
        else:
            errs.append("EQUIV_STALE(投影后等价类 %d 声明失效：与 %s 投影后内容不同，需人工复核)" % (cls, f[0]))
    if declared_ok:
        pass   # 声明内等价：不进全局 seen_hash，也不判重复
    elif hsh in seen_hash:
        errs.append("重复逻辑结果（与 %s 内容相同）" % seen_hash[hsh])
    else:
        seen_hash[hsh] = name
    bad = fails > 0 or mis > 0 or chk < 500 or bool(errs)
    if bad: crit += 1
    rows.append({"file": name, "status": "PASS" if not bad else "FAIL",
                 "failures": fails, "countMismatches": mis, "checked": chk,
                 "failList": [(x["kind"]+" "+x["el"]+" "+str(x["ratio"])) for x in d.get("failures", [])[:10]],
                 "countsBad": [s["id"]+":"+str(s["sidebarLabel"])+"→"+str(s["actual"]) for s in d.get("countMismatches", [])],
                 "detail": ";".join(errs + notes)})
# v7 fixtures 像素对照纳入总判定
fx = {"ok": False, "cases": []}
try:
    fx = json.load(open(fxpath, encoding="utf-8")) if fxpath and os.path.exists(fxpath) else fx
except Exception as e:
    fx = {"ok": False, "error": str(e)}
if not fx.get("ok"): crit += 1

summary = {
    "chrome": ver,
    "combos": len(expected & actual),
    "manifestExact": (not missing and not extra and len(expected) == 36),
    "manifestMissing": missing,
    "manifestExtra": extra,
    "fixtures": {"ok": bool(fx.get("ok")), "cases": fx.get("cases", []), "error": fx.get("error")},
    "critical": crit,
    "totalFailures": sum(r.get("failures", 0) for r in rows),
    "totalCountMismatches": sum(r.get("countMismatches", 0) or 0 for r in rows),
    "verdict": "PASS" if crit == 0 else "FAIL",
    "coverageStatement": "方向 × 主题 × 对比度 × 三种扫描场景（default/open/hover）＝36 组合；非『全状态矩阵』。",
    "rows": rows
}
json.dump(summary, open(os.path.join(outdir, "..", "summary.json"), "w"), ensure_ascii=False, indent=1)
AGG_VER = sys.argv[5] if len(sys.argv) > 5 else "unknown"
lines = ["# 对比度运行报告（%s：fail-closed + nonce 执行绑定 + canonical 去重 + 投影后等价类 + 零 DOM 变更覆盖 + 真像素 mask fixtures + JSON 元组结构不变量）" % AGG_VER, "",
         "- 显式等价类（R11③）：%d 组——%s" % (len(EQUIV_CLASSES), EQUIV_REASON),
         f"- Chrome: {ver}",
         "- 覆盖口径：方向 × 主题 × 对比度 × 三种扫描场景（default / open 浮层组合 / forced-hover 冒烟），非全状态矩阵",
         "- Manifest：文件名集合 + 逐文件 meta.combo/meta.label + nonce 执行绑定 + canonical（剥离 meta）内容去重",
         "- Fixtures：渐变 worst-stop 与 opacity 合成模型 vs 浏览器渲染像素（contrast/fixtures.html）",
         f"- Manifest 校验: {'OK' if summary['manifestExact'] else 'FAIL（缺失=%d 额外=%d）' % (len(missing), len(extra))}",
         f"- Fixtures 对照: {'PASS' if fx.get('ok') else 'FAIL'}（{len(fx.get('cases', []))} cases）",
         "- 结构指纹（规范化结构串摘要，判据为完整串比较）: " + (json.load(open(files[0])).get("audit", {}).get("structFingerprint", "-") if files else "-"),
         f"- 结果: **{summary['verdict']}**（CRIT={crit}，总失败={summary['totalFailures']}，计数不符={summary['totalCountMismatches']}）",
         "", "| 组合 | 状态 | 失败 | 计数不符 | checked | 明细 |", "|---|---|---|---|---|---|"]
for r in rows:
    lines.append("| %s | %s | %s | %s | %s | %s |" % (
        r["file"], r.get("status", "-"),
        r.get("failures", "-"), r.get("countMismatches", "-"), r.get("checked", "-"),
        "; ".join((r.get("failList") or []) + (r.get("countsBad") or []) + ([r["detail"]] if r.get("detail") else []))[:220]))
open(os.path.join(cdir, "REPORT.md"), "w").write("\n".join(lines) + "\n")
print("结论:", summary["verdict"], "| CRIT:", crit, "| 总失败:", summary["totalFailures"])
sys.exit(1 if summary["verdict"]=="FAIL" else 0)
PY
EXIT_AGG=$?
echo "---"; echo "---"
MAIN_FAIL=0
if [ $EXIT_AGG -gt 0 ] || [ $FX_RC -gt 0 ] || [ $ST_RC -gt 0 ] || [ $CT_RC -gt 0 ] || [ $LY_RC -gt 0 ]; then
  echo "❌ 主跑未通过 (agg=$EXIT_AGG fx=$FX_RC st=$ST_RC contract=$CT_RC layout=$LY_RC)"
  MAIN_FAIL=$(( EXIT_AGG + FX_RC + ST_RC + CT_RC + LY_RC ))
fi

# ---- R15③ 自测入口：同一命令完成正常基线 + 全部自测 ----
# 每条自测断言「预期错误类别 + 非零退出」；不再用评论或临时脚本替代包内证据。
SELF_FAIL=0
if [ "$MAIN_FAIL" -eq 0 ] && [ "${RUN_SELFTESTS:-1}" = "1" ]; then

  # T1 矩阵账本机器校验（R15②：分母=行数=计数和、互斥分类、锚点验证）
  T1_OUT="$(cd "$ROOT" && python3 tools/gen_matrix.py --verify --version "$VERSION" --baseline "$BASELINE" 2>&1)"
  T1_RC=$?
  if [ $T1_RC -ne 0 ]; then echo "$T1_OUT" | tail -5; echo "T1 账本格式与计数: FAIL"; SELF_FAIL=$((SELF_FAIL+1)); else echo "T1 账本格式与计数: PASS"; fi

  # T2 audit schema 负向×4 + T3 投影后等价单侧注入×2 + T4 重放/清单额外（复用真实结果 + 当前聚合器）
  python3 - "$ROOT" "$TMP" <<'PYSELF'
import glob, json, os, re, shutil, subprocess, sys
root, tmp = sys.argv[1], sys.argv[2]
z = open(os.path.join(root, "contrast", "run-headless.zsh"), encoding="utf-8").read()
m = re.search(r"python3 - \"\$OUT\" \"\$ROOT/contrast\" \"\$CHROME_VER\" \"\$FXJSON\" \"\$VERSION\" <<'PY'\n(.*?)\nPY\n", z, re.S)
assert m, "聚合器抽取失败"
agg = os.path.join(tmp, "agg-selftest.py"); open(agg, "w").write(m.group(1))
srcs = sorted(glob.glob(os.path.join(root, "contrast", "results", "*.json")))
assert srcs, "无真实结果"
fixtures = os.path.join(root, "contrast", "fixtures-result.json")
assert os.path.exists(fixtures), "无 fixtures 结果"

def run_agg(wd):
    return subprocess.run(["python3", agg, os.path.join(wd, "results"), wd,
                           "Chrome-selftest", fixtures, "selftest"],
                          capture_output=True, text=True, cwd=wd)

def fresh(name):
    wd = os.path.join(tmp, "st-" + name)
    shutil.rmtree(wd, ignore_errors=True)
    os.makedirs(os.path.join(wd, "results"))
    for f in srcs: shutil.copy(f, wd + "/results/")
    return wd

ok = True
def judge(tag, name, r, expect):
    global ok
    # 判定 = 非零退出 且 summary.json 中出现预期错误类别（类别串在 rows 明细，不在 stdout）
    sp = os.path.join(r.args[3], "summary.json")   # r.args = [python3, agg, results 目录, wd, ...]
    summary_text = open(sp, encoding="utf-8").read() if os.path.exists(sp) else ""
    bad = (r.returncode == 0) or (expect not in summary_text)
    print("%s %s: rc=%d 预期=%s → %s" % (tag, name, r.returncode, expect, "FAIL" if bad else "PASS"))
    if bad: ok = False

# T2 audit schema 负向（含 v14 以来的 fingerprint 字段与完整串判据）
t2 = [
  ("audit 整段缺失", lambda d: d.pop("audit", None), "AUDIT_SCHEMA"),
  ("structBefore/After=123 相等数字", lambda d: d.update(audit={"structBefore":123,"structAfter":123,"structFingerprint":"x","structChanged":False,"samplingCapped":False}), "AUDIT_SCHEMA"),
  ("structFingerprint 字段缺失", lambda d: d.get("audit", {}).pop("structFingerprint", None), "AUDIT_SCHEMA"),
  ("完整串不等但 changed=false", lambda d: d.update(audit={"structBefore":"(a)","structAfter":"(b)","structFingerprint":"x","structChanged":False,"samplingCapped":False}), "STRUCT_CHANGED"),
]
for i, (name, mut, expect) in enumerate(t2):
    wd = fresh("t2-%d" % i)
    for f in glob.glob(wd + "/results/*.json"):
        d = json.load(open(f)); mut(d); json.dump(d, open(f, "w"), ensure_ascii=False)
    judge("T2", name, run_agg(wd), expect)

# T3 投影后等价单侧注入（只改一个成员——双侧同改是 v14 曾犯的测试方法错误）
t3 = [
  ("summary.checked 单侧注入", lambda d: d["summary"].__setitem__("checked", d["summary"]["checked"] + 1), "EQUIV_STALE"),
  ("exemption identity 单侧注入", lambda d: d["exemptions"][0].__setitem__("el", "div.changed-identity"), "EQUIV_STALE"),
]
for i, (name, mut, expect) in enumerate(t3):
    wd = fresh("t3-%d" % i)
    f = wd + "/results/a-dark-high-hover.json"
    d = json.load(open(f)); mut(d); json.dump(d, open(f, "w"), ensure_ascii=False)
    judge("T3", name, run_agg(wd), expect)

# T4 重放/清单额外：把真实结果复制为额外文件 → MANIFEST 额外 + 重复内容
wd = fresh("t4")
shutil.copy(wd + "/results/a-dark-normal-hover.json", wd + "/results/x-replay-copy.json")
judge("T4", "重放注入（清单额外）", run_agg(wd), "MANIFEST")

sys.exit(0 if ok else 1)
PYSELF
T2_RC=$?
if [ $T2_RC -ne 0 ]; then echo "T2/T3/T4 负向自测: FAIL"; SELF_FAIL=$((SELF_FAIL+3)); fi

  # T5 无浏览器 fail-closed：内层完整 runner（CHROME=/usr/bin/true），退出码必须等于常量
  T5DIR="$(mktemp -d /tmp/artemis-nobrowser.XXXXXX)"
  cp -r "$ROOT/contrast" "$T5DIR/contrast"
  cp "$ROOT/components.html" "$ROOT/apple-inspired-ui.html" "$T5DIR/"
  cp "$ROOT/README.md" "$ROOT/proposal-ui-library.md" "$ROOT/capability-matrix.md" "$T5DIR/"
  cp -r "$ROOT/tools" "$T5DIR/tools"
  RUN_SELFTESTS=0 CHROME=/usr/bin/true "$T5DIR/contrast/run-headless.zsh" >/dev/null 2>&1
  T5_ACTUAL=$?
  rm -rf "$T5DIR"
  if [ "$T5_ACTUAL" -ne "$NOBROWSER_EXIT" ]; then
    echo "T5 无浏览器退出码: 实际 $T5_ACTUAL ≠ 常量 $NOBROWSER_EXIT → FAIL"; SELF_FAIL=$((SELF_FAIL+1))
  else
    echo "T5 无浏览器退出码断言: PASS（exit=$T5_ACTUAL）"
  fi

  # T6/T7 的 verify 需要显式 --repo：临时目录向上找不到 .git。
  # 从原位置向上解析真实仓库根（与 gen_matrix.resolve_repo 无显式参数时同逻辑，.git 目录或
  # worktree 指针文件均可；旧的 --repo "$ROOT/.." 假设 prototype 直连仓库根，docs/ 布局下必挂）。
  REPO_ROOT="$ROOT"
  while [ -n "$REPO_ROOT" ] && [ "$REPO_ROOT" != "/" ] && [ ! -e "$REPO_ROOT/.git" ]; do REPO_ROOT="${REPO_ROOT%/*}"; done
  if [ -z "$REPO_ROOT" ] || [ ! -e "$REPO_ROOT/.git" ]; then REPO_ROOT=""; fi

  # T6 解压布局自测（R16①）：zip 顶层= prototype/，复制到临时根后直接运行入口
  T6DIR="$(mktemp -d /tmp/artemis-layout-nested.XXXXXX)"
  mkdir -p "$T6DIR/prototype"
  cp -r "$ROOT/contrast" "$ROOT/tools" "$T6DIR/prototype/"
  cp "$ROOT/components.html" "$ROOT/apple-inspired-ui.html" "$ROOT/README.md" "$ROOT/proposal-ui-library.md" "$ROOT/capability-matrix.md" "$T6DIR/prototype/"
  RUN_SELFTESTS=0 CHROME="$CHROME" "$T6DIR/prototype/contrast/run-headless.zsh" >/dev/null 2>&1
  T6_RC=$?
  if [ -n "$REPO_ROOT" ]; then
    (cd "$T6DIR/prototype" && python3 tools/gen_matrix.py --verify --version "$VERSION" --baseline "$BASELINE" --repo "$REPO_ROOT") >/dev/null 2>&1 || T6_RC=1
  fi
  rm -rf "$T6DIR"
  if [ "$T6_RC" -ne 0 ]; then echo "T6 解压布局（prototype/ 顶层）: FAIL"; SELF_FAIL=$((SELF_FAIL+1)); else echo "T6 解压布局（prototype/ 顶层）: PASS"; fi

  # T7 平铺布局自测（R16①）：内容直接在根、无 prototype/ 嵌套，路径从脚本位置解析
  T7DIR="$(mktemp -d /tmp/artemis-layout-flat.XXXXXX)"
  cp -r "$ROOT/contrast" "$ROOT/tools" "$T7DIR/"
  cp "$ROOT/components.html" "$ROOT/apple-inspired-ui.html" "$ROOT/README.md" "$ROOT/proposal-ui-library.md" "$ROOT/capability-matrix.md" "$T7DIR/"
  RUN_SELFTESTS=0 CHROME="$CHROME" "$T7DIR/contrast/run-headless.zsh" >/dev/null 2>&1
  T7_RC=$?
  if [ -n "$REPO_ROOT" ]; then
    (cd "$T7DIR" && python3 tools/gen_matrix.py --verify --version "$VERSION" --baseline "$BASELINE" --repo "$REPO_ROOT") >/dev/null 2>&1 || T7_RC=1
  fi
  rm -rf "$T7DIR"
  if [ "$T7_RC" -ne 0 ]; then echo "T7 平铺布局（无 prototype/ 嵌套）: FAIL"; SELF_FAIL=$((SELF_FAIL+1)); else echo "T7 平铺布局（无 prototype/ 嵌套）: PASS"; fi
fi

if [ "$MAIN_FAIL" -gt 0 ] || [ "$SELF_FAIL" -gt 0 ]; then echo "❌ 未通过 (main=$MAIN_FAIL self=$SELF_FAIL)"; exit $(( MAIN_FAIL + SELF_FAIL )); fi
echo "✅ 全部通过（含自测）"; exit 0
