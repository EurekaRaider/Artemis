/** IM three-step panel regression: real user actions, no live Gateway or platform calls.
 *  结构：①连接服务 → ②接入渠道并绑定账号（含尾部「顺手验证」可选段）→ ③允许手机操作的项目。
 *  验证与群协作不入完成链；演示条件全部走 #imDemoConsole（迁移生产代码时整块删除后，
 *  本脚本的演示场景块同步删除，主流程断言与真实交互一一对应）。 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const out = '/tmp/artemis-im-settings-check'; await mkdir(out, { recursive: true });
const base = new URL('../artemis-ui.html', import.meta.url).href;
const results = [];
const progress = async () => (await page.locator('[data-im-progress]').textContent()).replace(/\s+/g, '');
async function check(name, run) { await run(); results.push(name); console.log('PASS', name); }
/* 演示控制台（原型专用）：open/close 幂等，场景切换必过确认弹窗 */
async function openConsole() { if (await page.locator('#imDemoConsole details').getAttribute('open') === null) await page.locator('#imDemoConsole summary').click(); }
async function closeConsole() { if (await page.locator('#imDemoConsole details').getAttribute('open') !== null) await page.locator('#imDemoConsole summary').click(); }
async function outcome(selector, value) { await openConsole(); await page.locator(selector).selectOption(value); await closeConsole(); }
async function scene(key) { await openConsole(); await page.locator('[data-im-scene="' + key + '"]').click(); await page.locator('[data-im-confirm-ok]').click(); await closeConsole(); await page.waitForTimeout(400); }
async function locate(key) { await page.evaluate(k => window.__imLocateCard(k), key); await page.waitForTimeout(450); }
const feishu = page.locator('[data-im-platform="feishu"]');
const subF = page.locator('[data-im-subcard="feishu"]');
const verifyBody = page.locator('#imVerifyBody');
const verifyLabel = page.locator('[data-im-verify-toggle] span').first();
try {
  await page.goto(base + '#settings=1&im-demo=empty'); await page.waitForTimeout(500);

  await check('demo console is isolated from product UI', async () => {
    /* 面板内不残留任何内联模拟选择器；隔离块与 JS 接线段均有迁移删除标记 */
    assert.equal(await page.locator('[data-im-sim-outcome]').count(), 0);
    const html = await readFile(new URL('../artemis-ui.html', import.meta.url), 'utf8');
    const js = await readFile(new URL('../workspace/workspace.js', import.meta.url), 'utf8');
    assert.match(html, /迁移到生产代码时整块删除 #imDemoConsole/);
    assert.match(js, /IM DEMO CONSOLE/);
    assert.equal(await page.locator('#imDemoConsole').count(), 1);
  });

  await check('① service failure stays in step and retries successfully', async () => {
    assert.match(await progress(), /0\/3/);
    assert.equal(await page.locator('[data-im-ceremony]').isHidden(), true);
    await outcome('[data-im-service-outcome]', 'port');
    await page.click('[data-im-service-start]'); await page.waitForTimeout(1300);
    assert.match(await page.locator('[data-im-service-error]').textContent(), /端口被其他程序占用/);
    assert.match(await page.locator('[data-im-service-start]').textContent(), /重试开启/);
    await outcome('[data-im-service-outcome]', 'ok');
    await page.click('[data-im-service-start]'); await page.waitForTimeout(1300);
    assert.equal(await page.locator('[data-im-card="service"] [data-im-badge]').textContent(), '已就绪');
    assert.match(await progress(), /1\/3/);
    /* 启动成功自动展开②（不抢焦点） */
    assert.equal(await page.locator('[data-im-card="channel"] [data-im-card-head]').getAttribute('aria-expanded'), 'true');
  });

  await check('② essential Feishu fields, validation, reveal and failure preserves input', async () => {
    await feishu.locator('[data-im-add]').click();
    assert.equal(await feishu.locator('input:visible').count(), 2);
    await subF.locator('[data-im-cred-save]').click();
    assert.equal(await feishu.locator('[aria-invalid="true"]').count(), 2);
    await feishu.locator('[data-im-fill-demo]').click();
    await feishu.locator('.im-reveal').first().click();
    assert.equal(await feishu.locator('[data-im-field-label="App Secret"] input').getAttribute('type'), 'text');
    await feishu.locator('.im-reveal').first().click();
    await outcome('[data-im-cred-outcome="feishu"]', 'offline');
    await subF.locator('[data-im-cred-save]').click(); await page.waitForTimeout(1200);
    assert.match(await feishu.textContent(), /网络中断/);
    assert.equal(await feishu.locator('[data-im-field-label="App ID"] input').inputValue(), 'cli_demo_artemis');
    await outcome('[data-im-cred-outcome="feishu"]', 'ok');
    await subF.locator('[data-im-cred-save]').click(); await page.waitForTimeout(1500);
    assert.match(await feishu.locator('.im-platform-status').textContent(), /已连接/);
    assert.equal(await page.locator('[data-im-card="channel"] [data-im-badge]').textContent(), '待绑定账号');
  });

  await check('② pairing five states and first-approval auto-opens verify section', async () => {
    assert.equal(await subF.locator('[data-im-stage4]').isVisible(), true);
    assert.match(await subF.locator('[data-im-pair-phase]').textContent(), /等待你发送/);
    assert.equal(await verifyBody.isHidden(), true); /* 绑定前验证段保持折叠 */
    await page.click('[data-im-platform="feishu"] [data-copy-pair]'); await page.waitForTimeout(150);
    assert.match(await subF.locator('[data-im-pair-phase]').textContent(), /等待你发送/);
    await page.click('[data-im-pair-arrive]'); await page.waitForTimeout(200);
    assert.match(await subF.locator('[data-im-pair-phase]').textContent(), /收到账号请求/);
    await page.waitForTimeout(2600);
    assert.match(await subF.locator('[data-im-pair-phase]').textContent(), /待本人确认/);
    await page.click('[data-im-approve]'); await page.waitForTimeout(300);
    assert.match(await subF.locator('[data-im-pair-phase]').textContent(), /已绑定/);
    assert.equal(await subF.locator('[data-im-bindings] .im-binding-row').count(), 1);
    /* 首绑自动展开②尾「顺手验证」段并脉冲；进度 2/3 */
    assert.equal(await verifyBody.isVisible(), true);
    assert.match(await progress(), /2\/3/);
  });

  await check('② tail verify: track, failure branch, honest confirm and per-channel signals', async () => {
    await page.locator('[data-im-test-advance]').click();
    await page.locator('[data-im-test-advance]').click();
    await page.locator('[data-im-test-fail]').click();
    assert.match(await page.locator('[data-im-test-error]').textContent(), /模型不可用/);
    assert.equal(await page.locator('#imStatePill').getAttribute('data-tone'), 'ok'); /* 任务失败不连坐连接 */
    await page.locator('[data-im-test-retry]').click();
    await page.locator('[data-im-test-advance]').click();
    assert.equal(await page.locator('[data-im-test-confirm]').isHidden(), false);
    await page.locator('[data-im-test-confirm-btn]').click(); await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-im-test-done]').isVisible(), true);
    assert.match(await page.locator('[data-im-test-done] .im-ready-title').textContent(), /全链路走通（你已确认）· 飞书/);
    assert.match(await verifyLabel.textContent(), /已验证 · 飞书/);
    /* 验证不入完成链：进度停在 2/3；②卡摘要带渠道级「已验证」信号 */
    assert.match(await progress(), /2\/3/);
    assert.match(await page.locator('[data-im-card="channel"] [data-im-summary]').textContent(), /飞书 已验证/);
    /* 撤销：doneBox 隐藏，标签回「验证进行中」（stage 保留，预期非初始文案） */
    await page.locator('[data-im-test-undo]').click();
    assert.equal(await page.locator('[data-im-test-done]').isHidden(), true);
    assert.match(await verifyLabel.textContent(), /验证进行中/);
    await page.locator('[data-im-test-confirm-btn]').click();
  });

  await check('③ grant dialog: tiers, scope tree, draft revert on abandon', async () => {
    await locate('projects');
    const art = page.locator('[data-im-project-idx="0"]');
    const dlg = page.locator('.im-grant-dialog');
    await art.locator('[data-im-grant-config]').click();
    assert.equal(await dlg.evaluate(el => el.open), true);
    assert.equal(await dlg.locator('[data-im-scope-tree]').isHidden(), true);
    assert.equal(await dlg.locator('[data-im-exec-only]').isHidden(), true);
    assert.match(await dlg.locator('[data-im-scope-declare]').textContent(), /默认可读整个项目，不可写任何文件/);
    await dlg.locator('.im-mode-tier:has(input[value="execute"])').click();
    assert.equal(await dlg.locator('[data-im-scope-tree]').isVisible(), true);
    assert.equal(await dlg.locator('[data-im-exec-only]').isVisible(), true);
    await dlg.locator('[data-im-scope-write][data-scope-path="src/renderer/"]').check();
    assert.equal(await dlg.locator('[data-im-scope-read][data-scope-path="src/renderer/"]').isChecked(), true);
    assert.equal(await dlg.locator('[data-im-scope-read][data-scope-path="src/"]').isChecked(), true);
    assert.equal(await dlg.locator('[data-im-scope-read][data-scope-path=".env.local"]').isDisabled(), true);
    await dlg.getByRole('button', { name: '关闭' }).click();
    assert.equal(await dlg.evaluate(el => el.open), false);
  });

  await check('③ grant dialog: save failure keeps draft, close reverts snapshot', async () => {
    /* 弹窗开启期间不动演示控制台（模态遮罩拦截点击）：保存失败开关在本块入口处切换 */
    const art = page.locator('[data-im-project-idx="0"]');
    const dlg = page.locator('.im-grant-dialog');
    await openConsole(); await page.locator('[data-im-save-failure]').click(); await closeConsole();
    await art.locator('[data-im-grant-config]').click();
    await dlg.locator('.im-mode-tier:has(input[value="execute"])').click();
    await dlg.getByRole('button', { name: '确认设置' }).click();
    assert.match(await dlg.locator('[data-im-grant-dialog-error]').textContent(), /保存失败/);
    assert.equal(await dlg.evaluate(el => el.open), true); /* 草稿保留可重试 */
    await dlg.getByRole('button', { name: '关闭' }).click();
    await openConsole(); await page.locator('[data-im-save-failure]').click(); await closeConsole();
    await art.locator('[data-im-grant-config]').click();
    assert.equal(await dlg.locator('.im-mode-tier:has(input[value="plan"]) input').isChecked(), true);
    await dlg.getByRole('button', { name: '关闭' }).click();
  });

  await check('③ inline grant: save failure reverts, partial enable retriable, done advances chain', async () => {
    const lab = page.locator('[data-im-project-idx="1"] .im-project-head input');
    const art = page.locator('[data-im-project-idx="0"] .im-project-head input');
    /* 保存失败 → 错误归位、勾选回退（click 而非 check：回退后 Playwright 断言 checked 会误报） */
    await openConsole(); await page.locator('[data-im-save-failure]').click(); await closeConsole();
    await lab.click();
    assert.match(await page.locator('[data-im-grant-error]').textContent(), /保存失败/);
    assert.equal(await lab.isChecked(), false);
    await openConsole(); await page.locator('[data-im-save-failure]').click(); await closeConsole();
    /* 保存成功、启用失败 → 部分成功条 + 仅重试启用（进度按完成链仍 3/3） */
    await openConsole(); await page.locator('[data-im-enable-failure]').click(); await closeConsole();
    await art.check(); await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-im-grant-partial]').isVisible(), true);
    assert.equal(await page.locator('[data-im-card="projects"] [data-im-alerts]').textContent(), '⚠1');
    await page.locator('[data-im-retry-enable]').click();
    assert.equal(await page.locator('[data-im-grant-partial]').isVisible(), true);
    await openConsole(); await page.locator('[data-im-enable-failure]').click(); await closeConsole();
    await page.locator('[data-im-retry-enable]').click(); await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-im-grant-partial]').isHidden(), true);
    assert.match(await progress(), /3\/3/);
  });

  await check('completion ceremony: appears once, routes verify/overview and leaves product flow', async () => {
    assert.equal(await page.locator('[data-im-ceremony]').isVisible(), true);
    assert.equal(await page.locator('[data-im-overview]').isHidden(), true); /* 会话内完成不自动跳概览 */
    await page.locator('[data-im-view-overview]').click(); await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-im-overview]').isVisible(), true);
    const trio = await page.locator('[data-im-ov-trio]').textContent();
    assert.match(trio, /配置完整/);
    assert.match(trio, /已通过 · 飞书（你已确认）/);
    await page.locator('[data-im-back-setup]').click(); await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-im-overview]').isHidden(), true);
  });
  await page.screenshot({ path: out + '/ceremony-light.png' });

  await check('alert scene: expired grant blocks done; reauthorize unblocks and overview shows partial failure', async () => {
    await scene('alert');
    assert.equal(await page.locator('[data-im-overview]').isHidden(), true);
    assert.match(await progress(), /2\/3/);
    /* 飞书已配好（ok 连接+绑定）→ ②徽标已就绪；张伟的待确认请求进告警角标 */
    assert.match(await page.locator('[data-im-card="channel"] [data-im-badge]').textContent(), /已就绪 · 飞书/);
    assert.equal(await page.locator('[data-im-card="channel"] [data-im-alerts]').textContent(), '⚠2');
    await locate('projects');
    const lab = page.locator('[data-im-project-idx="1"]');
    assert.match(await lab.textContent(), /授权已到期/);
    await lab.locator('[data-im-reauthorize]').click();
    await page.locator('.im-grant-dialog').getByRole('button', { name: '确认设置' }).click();
    await page.waitForTimeout(300);
    assert.match(await progress(), /3\/3/);
    assert.equal(await page.locator('[data-im-ceremony]').isVisible(), true);
    await page.locator('[data-im-view-overview]').click(); await page.waitForTimeout(300);
    assert.match(await page.locator('[data-im-ov-trio]').textContent(), /部分连接异常/);
    const secs = await page.locator('[data-im-ov-sections]').textContent();
    assert.match(secs, /连接失败/);
    assert.match(secs, /已连接/);
    await page.locator('[data-im-back-setup]').click(); await page.waitForTimeout(200);
  });

  await check('expired pairing code renews without advancing', async () => {
    await scene('expired');
    await locate('channel');
    /* 到期指令在渠道子卡内：先展开飞书子卡再断言 */
    await feishu.locator('[data-im-manage]').click(); await page.waitForTimeout(200);
    assert.equal(await subF.locator('[data-copy-pair]').first().isDisabled(), true);
    assert.match(await subF.locator('[data-im-renew-code]').textContent(), /生成新指令/);
    await subF.locator('[data-im-renew-code]').click();
    assert.match(await subF.locator('[data-im-countdown]').first().textContent(), /5:00|4:59/);
    assert.equal(await subF.locator('[data-copy-pair]').first().isDisabled(), false);
  });

  await check('channel tabs stick to top while ② scrolls', async () => {
    await page.setViewportSize({ width: 1440, height: 720 });
    /* alert 种子渠道卡默认展开（ready 场景完成态卡片收拢，无法产生越顶滚动） */
    await scene('alert');
    const strip = page.locator('.im-channel-tabs');
    assert.equal(await strip.evaluate(el => getComputedStyle(el).position), 'sticky');
    assert.equal(await strip.evaluate(el => el.offsetParent !== null), true);
    await page.evaluate(() => {
      const s = document.querySelector('.settings-content');
      const t = document.querySelector('.im-channel-tabs');
      s.scrollTop = 0; t.scrollIntoView({ block: 'start' }); s.scrollTop += 120;
      s.dispatchEvent(new Event('scroll'));
    });
    assert.equal(await strip.evaluate(el => el.classList.contains('stuck')), true);
    await page.evaluate(() => {
      const s = document.querySelector('.settings-content');
      s.scrollTop = 0; s.dispatchEvent(new Event('scroll'));
    });
    assert.equal(await strip.evaluate(el => el.classList.contains('stuck')), false);
  });

  await check('narrow dark and reduced motion', async () => {
    await page.setViewportSize({ width: 620, height: 850 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await locate('channel');
    await page.screenshot({ path: out + '/narrow-dark.png' });
    assert.equal(await page.locator('#settingsPanelIm').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  });

  assert.deepEqual(errors, []); await writeFile(out + '/result.json', JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
