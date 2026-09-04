# 对比度运行报告（v17：fail-closed + nonce 执行绑定 + canonical 去重 + 投影后等价类 + 零 DOM 变更覆盖 + 真像素 mask fixtures + JSON 元组结构不变量）

- 显式等价类（R11③）：6 组——投影后等价：hover 态内容在剥离①已审查豁免条目（占位符/禁用/装饰）的 ratio/fg/bg 颜色、②侧栏组合自反 chrome（dirSeg/themeSeg/contrastSeg，data-struct-chrome 标记）内部反映请求组合身份的 aria-selected/tabindex 后相同；非豁免内容与豁免 identity/reason 差异仍判 EQUIV_STALE（R13 认可方向 + R15② chrome 披露）
- Chrome: Google Chrome 151.0.7922.174 
- 覆盖口径：方向 × 主题 × 对比度 × 三种扫描场景（default / open 浮层组合 / forced-hover 冒烟），非全状态矩阵
- Manifest：文件名集合 + 逐文件 meta.combo/meta.label + nonce 执行绑定 + canonical（剥离 meta）内容去重
- Fixtures：渐变 worst-stop 与 opacity 合成模型 vs 浏览器渲染像素（contrast/fixtures.html）
- Manifest 校验: OK
- Fixtures 对照: PASS（13 cases）
- 结构指纹（规范化结构串摘要，判据为完整串比较）: 13877363.ae42b9c8.120982
- 结果: **PASS**（CRIT=0，总失败=0，计数不符=0）

| 组合 | 状态 | 失败 | 计数不符 | checked | 明细 |
|---|---|---|---|---|---|
| a-dark-high-default.json | PASS | 0 | 0 | 935 |  |
| a-dark-high-hover.json | PASS | 0 | 0 | 939 |  |
| a-dark-high-open.json | PASS | 0 | 0 | 949 |  |
| a-dark-normal-default.json | PASS | 0 | 0 | 935 |  |
| a-dark-normal-hover.json | PASS | 0 | 0 | 939 | EQUIV_DECLARED（投影后等价类 0 内与 a-dark-high-hover 投影后相同：投影后等价：hover 态内容在剥离①已审查豁免条目（占位符/禁用/装饰）的 ratio/fg/bg 颜色、②侧栏组合自反 chrome（dirSeg/themeSeg/contrastSeg，data-struct-chrome 标记）内部反映请求组合身份的 aria-selected/tabindex 后相同；非豁免内容与豁免 id |
| a-dark-normal-open.json | PASS | 0 | 0 | 947 |  |
| a-light-high-default.json | PASS | 0 | 0 | 935 |  |
| a-light-high-hover.json | PASS | 0 | 0 | 939 |  |
| a-light-high-open.json | PASS | 0 | 0 | 949 |  |
| a-light-normal-default.json | PASS | 0 | 0 | 935 |  |
| a-light-normal-hover.json | PASS | 0 | 0 | 939 | EQUIV_DECLARED（投影后等价类 1 内与 a-light-high-hover 投影后相同：投影后等价：hover 态内容在剥离①已审查豁免条目（占位符/禁用/装饰）的 ratio/fg/bg 颜色、②侧栏组合自反 chrome（dirSeg/themeSeg/contrastSeg，data-struct-chrome 标记）内部反映请求组合身份的 aria-selected/tabindex 后相同；非豁免内容与豁免 i |
| a-light-normal-open.json | PASS | 0 | 0 | 947 |  |
| b-dark-high-default.json | PASS | 0 | 0 | 935 |  |
| b-dark-high-hover.json | PASS | 0 | 0 | 939 |  |
| b-dark-high-open.json | PASS | 0 | 0 | 947 |  |
| b-dark-normal-default.json | PASS | 0 | 0 | 935 |  |
| b-dark-normal-hover.json | PASS | 0 | 0 | 939 | EQUIV_DECLARED（投影后等价类 2 内与 b-dark-high-hover 投影后相同：投影后等价：hover 态内容在剥离①已审查豁免条目（占位符/禁用/装饰）的 ratio/fg/bg 颜色、②侧栏组合自反 chrome（dirSeg/themeSeg/contrastSeg，data-struct-chrome 标记）内部反映请求组合身份的 aria-selected/tabindex 后相同；非豁免内容与豁免 id |
| b-dark-normal-open.json | PASS | 0 | 0 | 947 |  |
| b-light-high-default.json | PASS | 0 | 0 | 935 |  |
| b-light-high-hover.json | PASS | 0 | 0 | 939 |  |
| b-light-high-open.json | PASS | 0 | 0 | 947 |  |
| b-light-normal-default.json | PASS | 0 | 0 | 935 |  |
| b-light-normal-hover.json | PASS | 0 | 0 | 939 | EQUIV_DECLARED（投影后等价类 3 内与 b-light-high-hover 投影后相同：投影后等价：hover 态内容在剥离①已审查豁免条目（占位符/禁用/装饰）的 ratio/fg/bg 颜色、②侧栏组合自反 chrome（dirSeg/themeSeg/contrastSeg，data-struct-chrome 标记）内部反映请求组合身份的 aria-selected/tabindex 后相同；非豁免内容与豁免 i |
| b-light-normal-open.json | PASS | 0 | 0 | 949 |  |
| c-dark-high-default.json | PASS | 0 | 0 | 935 |  |
| c-dark-high-hover.json | PASS | 0 | 0 | 939 |  |
| c-dark-high-open.json | PASS | 0 | 0 | 949 |  |
| c-dark-normal-default.json | PASS | 0 | 0 | 935 |  |
| c-dark-normal-hover.json | PASS | 0 | 0 | 939 | EQUIV_DECLARED（投影后等价类 4 内与 c-dark-high-hover 投影后相同：投影后等价：hover 态内容在剥离①已审查豁免条目（占位符/禁用/装饰）的 ratio/fg/bg 颜色、②侧栏组合自反 chrome（dirSeg/themeSeg/contrastSeg，data-struct-chrome 标记）内部反映请求组合身份的 aria-selected/tabindex 后相同；非豁免内容与豁免 id |
| c-dark-normal-open.json | PASS | 0 | 0 | 949 |  |
| c-light-high-default.json | PASS | 0 | 0 | 935 |  |
| c-light-high-hover.json | PASS | 0 | 0 | 939 |  |
| c-light-high-open.json | PASS | 0 | 0 | 949 |  |
| c-light-normal-default.json | PASS | 0 | 0 | 935 |  |
| c-light-normal-hover.json | PASS | 0 | 0 | 939 | EQUIV_DECLARED（投影后等价类 5 内与 c-light-high-hover 投影后相同：投影后等价：hover 态内容在剥离①已审查豁免条目（占位符/禁用/装饰）的 ratio/fg/bg 颜色、②侧栏组合自反 chrome（dirSeg/themeSeg/contrastSeg，data-struct-chrome 标记）内部反映请求组合身份的 aria-selected/tabindex 后相同；非豁免内容与豁免 i |
| c-light-normal-open.json | PASS | 0 | 0 | 949 |  |
