/** IM simulation regression: real user actions, no live Gateway or platform calls. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[]; page.on('pageerror', error=>errors.push(error.message));
const out='/tmp/artemis-im-settings-check'; await mkdir(out,{recursive:true});
const base=new URL('../artemis-ui.html',import.meta.url).href;
const results=[];
async function check(name,run){await run();results.push(name);console.log('PASS',name);}
async function locate(key){await page.evaluate(k=>window.__imLocateCard(k),key);await page.waitForTimeout(450);}
async function fresh(key='empty'){await page.goto(base+'#settings=1&im-demo='+key);await page.waitForTimeout(500);}
try {
 await fresh();
 await check('service starts and advances',async()=>{await page.locator('[data-im-service-start]').click();assert.equal(await page.locator('[data-im-service-start]').isDisabled(),true);await page.waitForTimeout(1200);assert.equal(await page.locator('[data-im-card="bots"] [data-im-card-head]').getAttribute('aria-expanded'),'true');});
 const row=page.locator('[data-im-platform="feishu"]');
 await check('two essential Feishu fields, validation and secret reveal',async()=>{await row.locator('[data-im-add]').click();assert.equal(await row.locator('input:visible').count(),2);await row.locator('[data-im-cred-save]').click();assert.equal(await row.locator('[aria-invalid="true"]').count(),2);await row.locator('[data-im-fill-demo]').click();await row.locator('.im-reveal').first().click();assert.equal(await row.locator('[data-im-field-label="App Secret"] input').getAttribute('type'),'text');await row.locator('.im-reveal').first().click();});
 await check('failure preserves fields and retries successfully',async()=>{await row.locator('[data-im-sim-outcome]').selectOption('offline');await row.locator('[data-im-cred-save]').click();await page.waitForTimeout(1100);assert.match(await row.textContent(),/网络中断/);assert.equal(await row.locator('[data-im-field-label="App ID"] input').inputValue(),'cli_demo_artemis');await row.locator('[data-im-sim-outcome]').selectOption('ok');await row.locator('[data-im-cred-save]').click();await page.waitForTimeout(1500);assert.match(await row.locator('.im-platform-status').textContent(),/已连接/);});
 await check('pairing approval and project save confirmation',async()=>{await locate('account');await page.locator('[data-copy-pair]').first().click();await page.locator('[data-im-pair-arrive]').click();await page.locator('[data-im-approve]').click();await locate('projects');await page.locator('.im-project-head input').first().check();assert.equal(await page.locator('[data-im-default-project]').inputValue(),'Artemis');await page.locator('[data-im-projects-save]').click();assert.equal(await page.locator('.im-confirm-dialog').evaluate(el=>el.open),true);await page.locator('[data-im-confirm-ok]').click();await page.waitForTimeout(300);assert.equal(await page.locator('[data-im-test-done]').isHidden(),true);assert.equal(await page.locator('[data-im-card="test"] [data-im-badge]').textContent(),'当前步骤');});
 await check('manage saved credentials displays saved view',async()=>{await locate('bots');await row.locator('[data-im-manage]').click();assert.equal(await row.locator('[data-im-cred-saved]').isVisible(),true);await row.locator('[data-im-cred-swap]').click();assert.equal(await row.locator('[data-im-field-label="App Secret"] input').inputValue(),'');});
 await check('all platform contracts and draft collapse',async()=>{for(const [key,count] of [['wecom',3],['slack',2]]){const r=page.locator('[data-im-platform="'+key+'"]');await r.locator('[data-im-add]').click();assert.equal(await r.locator('input:visible').count(),count);assert.equal(await r.locator('[data-im-receive-mode]').count(),0);await r.locator('[data-im-fill-demo]').click();await r.locator('[data-im-cred-cancel]').click();await r.locator('[data-im-add]').click();assert.ok(await r.locator('input').first().inputValue());} });
 await page.screenshot({path:out+'/credentials-light.png'});
 await check('C1 progress, phases, service failure and delete cascade',async()=>{
  /* D1：首次流程无总开关；四步完成 → 进度 4/5（第 5 步测试任务未做）；③ 已绑定 */
  assert.equal(await page.locator('#imMasterSwitch').count(),0);
  assert.match(await page.locator('[data-im-progress]').textContent(),/4\/5/);
  assert.match(await page.locator('[data-im-pair-phase]').textContent(),/已绑定/);
  /* 删除连接级联回退：③绑定清空、机器人未配置、进度回退、③五态行隐藏（未生成） */
  await locate('bots');
  await page.locator('[data-im-platform="feishu"] [data-im-manage]').click();
  await page.locator('[data-im-subcard="feishu"] [data-im-conn-delete]').click();
  await page.locator('[data-im-confirm-ok]').click();
  await page.waitForTimeout(300);
  assert.match(await page.locator('[data-im-platform="feishu"] .im-platform-status').textContent(),/未配置/);
  assert.equal(await page.locator('[data-im-bindings] .im-binding-row').count(),0);
  assert.equal(await page.locator('[data-im-pair-phase]').isHidden(),true);
  assert.match(await page.locator('[data-im-progress]').textContent(),/2\/5/);
  /* ①失败分支：端口占用→独立原因+重试开启；改成功→重试落已就绪
     （经面板内「演示场景」回到 empty——goto 同 URL 会被脏状态 beforeunload 挡下） */
  await page.locator('.im-simulation summary').click();
  await page.locator('[data-im-scene="empty"]').click();
  await page.locator('[data-im-confirm-ok]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-im-service-outcome]').selectOption('port');
  await page.click('[data-im-service-start]');
  await page.waitForTimeout(1200);
  assert.match(await page.locator('[data-im-service-error]').textContent(),/端口被其他程序占用/);
  assert.match(await page.locator('[data-im-service-start]').textContent(),/重试开启/);
  await page.locator('[data-im-service-outcome]').selectOption('ok');
  await page.click('[data-im-service-start]');
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('[data-im-card="service"] [data-im-badge]').textContent(),'已就绪');
  /* ③五态序列：等待你发送 →（复制≠发送）→ 收到账号请求 → 待本人确认 →（批准）→ 已绑定 */
  await page.click('[data-im-platform="feishu"] [data-im-add]');
  await row.locator('[data-im-fill-demo]').click();
  await page.click('[data-im-subcard="feishu"] [data-im-cred-save]');
  await page.waitForTimeout(1100);
  await locate('account');
  await page.locator('[data-copy-pair]').first().click();
  await page.waitForTimeout(150);
  assert.match(await page.locator('[data-im-pair-phase]').textContent(),/等待你发送/);
  await page.click('[data-im-pair-arrive]');
  await page.waitForTimeout(200);
  assert.match(await page.locator('[data-im-pair-phase]').textContent(),/收到账号请求/);
  await page.waitForTimeout(2600);
  assert.match(await page.locator('[data-im-pair-phase]').textContent(),/待本人确认/);
  await page.click('[data-im-approve]');
  await page.waitForTimeout(300);
  assert.match(await page.locator('[data-im-pair-phase]').textContent(),/已绑定/);
  /* 收起「演示场景」面板，恢复后续检查的初始开合状态 */
  await page.locator('.im-simulation summary').click();
 });
 await check('C2 bot sub-stages, stage-3 gating, team pick and slack mismatch',async()=>{
  const wc=page.locator('[data-im-subcard="wecom"]');
  /* 三阶段：未连接高亮「填写凭据并连接」，连接成功后阶段3出现并拦住继续按钮 */
  await page.click('[data-im-platform="wecom"] [data-im-add]');
  assert.equal(await wc.locator('[data-substage="2"]').evaluate(e=>e.classList.contains('cur')),true);
  await page.locator('[data-im-platform="wecom"] [data-im-fill-demo]').click();
  await page.click('[data-im-subcard="wecom"] [data-im-cred-save]');
  await page.waitForTimeout(1100);
  assert.equal(await wc.locator('[data-im-stage3]').isVisible(),true);
  assert.equal(await wc.locator('[data-im-receive-done]').isDisabled(),true);
  await wc.locator('[data-im-receive-ready]').check();
  assert.equal(await wc.locator('[data-im-receive-done]').isDisabled(),false);
  assert.match(await wc.locator('[data-im-receive-note]').textContent(),/收发将在配对时验证/);
  await page.click('[data-im-subcard="wecom"] [data-im-receive-done]');
  await page.waitForTimeout(200);
  assert.match(await wc.locator('[data-im-receive-done-note]').textContent(),/已确认/);
  assert.equal(await wc.locator('[data-substage="3"]').evaluate(e=>e.classList.contains('done')),true);
  /* Slack 双 Token 不一致：保存通过，连接阶段报「不同应用」 */
  await page.click('[data-im-platform="slack"] [data-im-add]');
  await page.locator('[data-im-platform="slack"] [data-im-fill-demo]').click();
  await page.locator('[data-im-subcard="slack"] [data-im-sim-outcome]').selectOption('mismatch');
  await page.click('[data-im-subcard="slack"] [data-im-cred-save]');
  await page.waitForTimeout(1100);
  assert.match(await page.locator('[data-im-platform="slack"]').textContent(),/不同应用/);
  /* 团队态：未配置平台呈现机器人列表（跳过凭据表单），选用即连、阶段3 已确认 */
  await page.locator('.im-simulation summary').click();
  await page.locator('[data-im-scene="team"]').click();
  await page.locator('[data-im-confirm-ok]').click();
  await page.waitForTimeout(500);
  await locate('bots');
  await page.click('[data-im-platform="wecom"] [data-im-add]');
  assert.equal(await wc.locator('[data-im-team-bots]').isVisible(),true);
  assert.equal(await wc.locator('[data-im-cred-form]').isHidden(),true);
  await page.click('[data-im-subcard="wecom"] [data-im-team-pick]');
  await page.waitForTimeout(300);
  assert.match(await page.locator('[data-im-platform="wecom"] .im-platform-status').textContent(),/已连接/);
  assert.match(await wc.locator('[data-im-receive-done-note]').textContent(),/已确认/);
  await page.locator('.im-simulation summary').click();
 });
 await check('C3 grant tiers, scope tree and two-phase enable',async()=>{
  await locate('projects');
  const art=page.locator('[data-im-project-idx="0"]');
  const save=page.locator('[data-im-projects-save]');
  /* headless 平滑滚动竞态下 hit-test 偶发落到面板背板：用 DOM 派发触发同一 handler */
  await art.locator('[data-im-fold]').dispatchEvent('click');
  /* Plan 默认：无范围树、无命令/网络；默认范围声明 */
  assert.equal(await art.locator('[data-im-scope-tree]').isHidden(),true);
  assert.equal(await art.locator('[data-im-exec-only]').isHidden(),true);
  assert.match(await art.locator('[data-im-scope-declare]').textContent(),/可读整个项目，不可写任何文件/);
  /* 切「允许修改」：树出现；勾选项目后未选范围 → 保存禁用（点可见的档位 label） */
  await art.locator('.im-mode-tier:has(input[value="execute"])').click();
  assert.equal(await art.locator('[data-im-scope-tree]').isVisible(),true);
  await art.locator('.im-project-head input').check();
  assert.equal(await save.isDisabled(),true);
  /* 写勾 src/renderer/ → 自身与父目录 src/ 可读被强制勾上；受保护文件不可选 */
  await art.locator('.im-scope-row[data-scope-path="src/renderer/"] [data-im-scope-write]').check();
  assert.equal(await art.locator('.im-scope-row[data-scope-path="src/renderer/"] [data-im-scope-read]').isChecked(),true);
  assert.equal(await art.locator('.im-scope-row[data-scope-path="src/"] [data-im-scope-read]').isChecked(),true);
  assert.equal(await art.locator('.im-scope-row[data-scope-path=".env.local"] [data-im-scope-read]').isDisabled(),true);
  assert.equal(await art.locator('.im-scope-row[data-scope-path="src/"] [data-im-scope-read]').isDisabled(),true);
  assert.equal(await save.isDisabled(),false);
  /* 确认摘要五要素 */
  const summary=await page.locator('[data-im-grant-summary]').textContent();
  assert.match(summary,/Artemis/);assert.match(summary,/允许修改/);assert.match(summary,/有效期 30 天/);assert.match(summary,/回复仅发给你绑定的单聊/);
  /* 补齐③（team 场景清空了绑定）：配对批准后再走两阶段三场景 */
  await page.evaluate(()=>window.__imLocateCard('account'));await page.waitForTimeout(450);
  await page.locator('[data-copy-pair]').first().click();
  await page.click('[data-im-pair-arrive]');await page.waitForTimeout(200);
  await page.click('[data-im-approve]');await page.waitForTimeout(400);
  /* 两阶段·场景一：保存失败 → 错误归表单，不启用 */
  await page.locator('.im-simulation summary').click();
  await page.locator('[data-im-save-failure]').click();
  await page.locator('.im-simulation summary').click();
  await save.click();
  assert.match(await page.locator('[data-im-grant-error]').textContent(),/保存失败/);
  assert.equal(await page.locator('[data-im-grant-partial]').isHidden(),true);
  /* 场景二：保存成功、启用失败 → 部分成功条 + 仅重试启用 */
  await page.locator('.im-simulation summary').click();
  await page.locator('[data-im-save-failure]').click();
  await page.locator('[data-im-enable-failure]').click();
  await page.locator('.im-simulation summary').click();
  await save.click();
  await page.locator('[data-im-confirm-ok]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-im-grant-partial]').isVisible(),true);
  assert.equal(await page.locator('[data-im-card="projects"] [data-im-alerts]').textContent(),'⚠1');
  await page.locator('[data-im-retry-enable]').click();
  assert.equal(await page.locator('[data-im-grant-partial]').isVisible(),true);
  /* 场景三：恢复启用 → 重试启用成功；配置完成≠端到端——⑤未确认前进度 4/5 */
  await page.locator('.im-simulation summary').click();
  await page.locator('[data-im-enable-failure]').click();
  await page.locator('.im-simulation summary').click();
  await page.locator('[data-im-retry-enable]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-im-grant-partial]').isHidden(),true);
  assert.match(await page.locator('[data-im-progress]').textContent(),/4\/5/);
 });
 await check('C4 test track, honest confirm and group flow',async()=>{
  /* ⑤ 轨道：推进两段 → 模型失败支线（连接胶囊不受影响）→ 重试 → 送达 */
  await locate('test');
  assert.equal(await page.locator('[data-im-ready]').count(),0); /* M6 退场 */
  await page.locator('[data-im-test-advance]').click();
  await page.locator('[data-im-test-advance]').click();
  await page.locator('[data-im-test-fail]').click();
  assert.match(await page.locator('[data-im-test-error]').textContent(),/模型不可用/);
  assert.equal(await page.locator('#imStatePill').getAttribute('data-tone'),'ok');
  await page.locator('[data-im-test-retry]').click();
  await page.locator('[data-im-test-advance]').click();
  /* 确认 → 你已确认（无「系统验证通过」措辞）→ 撤销可恢复 → 再确认 */
  await page.locator('[data-im-test-confirm-btn]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-im-card="test"] [data-im-badge]').textContent(),'已确认');
  const doneText=await page.locator('[data-im-test-done]').textContent();
  assert.match(doneText,/全部就绪/);assert.doesNotMatch(doneText,/系统验证/);
  await page.locator('[data-im-test-undo]').click();
  assert.equal(await page.locator('[data-im-card="test"] [data-im-badge]').textContent(),'当前步骤');
  await page.locator('[data-im-test-confirm-btn]').click();
  /* 群协作独立流程：发现 → 保存 → 重新保存重置确认 → 确认 → 授权 → 返回 */
  await page.locator('[data-im-open-group-flow]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-im-group-flow]').isVisible(),true);
  await page.locator('[data-im-gf-find]').click();
  await page.locator('[data-im-gf-save]').click();
  assert.match(await page.locator('[data-im-group-state]').textContent(),/已保存，等待 1 个群确认/);
  /* 重新保存空间 → 全部群确认重置（对齐生产行为） */
  await page.locator('[data-im-gf-resave]').click();
  await page.locator('[data-im-gf-save]').click();
  assert.match(await page.locator('[data-im-group-state]').textContent(),/已保存，等待 1 个群确认/);
  await page.locator('[data-im-gf-confirm]').click();
  assert.match(await page.locator('[data-im-group-state]').textContent(),/群已确认，尚未授权项目/);
  await page.locator('[data-im-gf-grant]').click();
  assert.match(await page.locator('[data-im-group-state]').textContent(),/你的项目已就绪/);
  await page.locator('[data-im-group-flow] > [data-im-group-back]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-im-group-flow]').isHidden(),true);
 });
 await check('C5 overview reopen, group entry, partial failures and continue setup',async()=>{
  /* ready 场景重放：五步全✓ → 自动进入概览（再次打开不重跑流程）；场景面板本块内开合自理 */
  await page.locator('.im-simulation summary').click();
  await page.locator('[data-im-scene="ready"]').click();
  await page.locator('[data-im-confirm-ok]').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-im-overview]').isVisible(),true);
  assert.match(await page.locator('[data-im-ov-trio]').textContent(),/已通过（你已确认）/);
  /* 概览五分区内的群协作入口 → 返回仍回概览 */
  await page.locator('[data-im-ov-sections] [data-im-open-group-flow]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-im-group-flow]').isVisible(),true);
  await page.locator('[data-im-group-flow] > [data-im-group-back]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-im-overview]').isVisible(),true);
  /* alert 场景：未全完成不自动进概览；手动完成⑤后进入 → 部分连接异常 + 健康连接不连坐 */
  await page.locator('[data-im-scene="alert"]').click();
  await page.locator('[data-im-confirm-ok]').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-im-overview]').isHidden(),true);
  await locate('test');
  for(let i=0;i<4;i++){await page.locator('[data-im-test-advance]').click();await page.waitForTimeout(60);}
  await page.locator('[data-im-test-confirm-btn]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-im-view-overview]').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-im-overview]').isVisible(),true);
  assert.match(await page.locator('[data-im-ov-trio]').textContent(),/部分连接异常/);
  const secsText=await page.locator('[data-im-ov-sections]').textContent();
  assert.match(secsText,/连接失败/);
  assert.match(secsText,/已连接/);
  /* 继续设置：token-lab 到期 → 定位④并展开 */
  await page.locator('[data-im-continue-setup]').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-im-overview]').isHidden(),true);
  assert.equal(await page.locator('[data-im-card="projects"] [data-im-card-head]').getAttribute('aria-expanded'),'true');
  /* 收起演示场景面板，交还给后续检查 */
  await page.locator('.im-simulation summary').click();
 });
 await check('scenes and expired pairing do not advance',async()=>{await page.locator('.im-simulation summary').click();await page.locator('[data-im-scene="expired"]').click();await page.locator('[data-im-confirm-ok]').click();await locate('account');assert.equal(await page.locator('[data-copy-pair]').first().isDisabled(),true);assert.equal(await page.locator('[data-im-wait-card]').isHidden(),true);assert.match(await page.locator('[data-im-renew-code]').textContent(),/生成新指令/);await page.locator('[data-im-renew-code]').click();assert.match(await page.locator('[data-im-countdown]').first().textContent(),/5:00|4:59/);assert.equal(await page.locator('[data-copy-pair]').first().isDisabled(),false);});
 await check('narrow dark and reduced motion',async()=>{await page.setViewportSize({width:620,height:850});await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await locate('bots');await page.screenshot({path:out+'/narrow-dark.png'});assert.equal(await page.locator('#settingsPanelIm').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);});
 assert.deepEqual(errors,[]); await writeFile(out+'/result.json',JSON.stringify({results,errors},null,2));
} finally {await browser.close();}
