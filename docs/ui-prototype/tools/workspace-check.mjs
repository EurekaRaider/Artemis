/** Standalone prototype regression. Requires Playwright with a local Chromium installation. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base=new URL('../artemis-ui.html',import.meta.url).href;
const out=process.env.ARTEMIS_UI_CHECK_OUTPUT || '/tmp/artemis-workspace-check';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
async function check(name,fn){await fn();results.push(name);}
async function open(key){
  if(['review','terminal','browser','files'].includes(key)){
    if(await page.locator('body').getAttribute('data-dock')!=='open')await page.locator('#dockToggle').click();
    await page.locator('#tabAdd').click();await page.locator('#panelPicker [data-open-panel="'+key+'"]').click();
  }else if(key==='goal')await page.locator('.goal-pill').click();
  else if(key==='markdown'){await open('files');await page.locator('#dockPanelFiles [data-open-panel="markdown"]').click();}
  else {if(await page.locator('body').getAttribute('data-dock')==='open')await page.locator('#dockToggle').click();await page.locator('#envTrigger').click();await page.locator('#envPop [data-open-panel="'+key+'"]').click();}
}
try {
  await page.goto(base);
  await check('defaults and component order',async()=>{
    assert.deepEqual(await page.locator('html').evaluate(e=>({...e.dataset})),{contrast:'normal',direction:'a',theme:'light'});
    assert.equal(await page.locator('.composer-topbar').evaluate(e=>e.parentElement.classList.contains('composer')&&!e.previousElementSibling),true);
    assert.equal(await page.locator('.tab-content > .tab-panel').count(),9);
  });
  for(const key of ['review','terminal','browser','files','goal','sources','markdown','team','agent']){
    await check('panel '+key,async()=>{await open(key);await page.waitForTimeout(300);assert.equal(await page.locator('.tab-content > .tab-panel:visible').count(),1);assert.equal(await page.locator('.tab-content > .tab-panel:visible').getAttribute('data-panel'),key);await page.screenshot({path:out+'/'+key+'.png'});});
  }
  await check('goal edit/save/revert',async()=>{await open('goal');await page.locator('#goalInput').fill('验证主界面和九个工具面板');await page.locator('#goalSave').click();assert.equal(await page.locator('#goalSaved').textContent(),'目标已保存');await page.locator('#goalInput').fill('未保存');await page.locator('#goalRevert').click();assert.equal(await page.locator('#goalInput').inputValue(),'验证主界面和九个工具面板');});
  await check('file selection/edit/save',async()=>{await open('files');await page.locator('[data-file="css"]').click();await page.locator('#fileEdit').click();await page.locator('#fileEditor').fill('/* local prototype edit */');await page.locator('#fileSave').click();assert.equal(await page.locator('#fileSource').textContent(),'/* local prototype edit */');await page.locator('#fileFilter').fill('no-such-file');assert.equal(await page.locator('#fileNoMatch').isVisible(),true);});
  await check('review filtering and selection',async()=>{await open('review');await page.locator('[data-review-file="1"]').click();assert.equal(await page.locator('#reviewFilename').textContent(),'component-tokens.css');await page.locator('#reviewFilter').fill('no-such-file');assert.equal(await page.locator('#reviewNoMatch').isVisible(),true);});
  await check('browser address and history',async()=>{await open('browser');await page.locator('#browserAddress').fill('https://example.invalid');await page.locator('#browserAddress').press('Enter');assert.match(await page.locator('#browserPreview').textContent(),/没有内置预览/);await page.locator('#browserBack').click();assert.match(await page.locator('#browserPreview').textContent(),/让想法成为作品/);});
  await check('tab keyboard, close all, reopen',async()=>{
    await page.locator('#dockTabs .dock-tab.active').focus();await page.keyboard.press('Home');assert.equal(await page.locator('#dockTabs .dock-tab.active').getAttribute('data-tab'),'review');
    while(await page.locator('#dockTabs .dock-tab').count()){await page.locator('#dockTabs .dock-tab.active').focus();await page.keyboard.press('Delete');}
    assert.equal(await page.locator('#dockEmpty').isVisible(),true);assert.equal(await page.locator('.tab-content > .tab-panel:visible').count(),0);
    await page.locator('.launch-btn[data-launch="files"]').click();assert.equal(await page.locator('#dockPanelFiles').isVisible(),true);
  });
  await check('environment groups and commit dialog',async()=>{if(await page.locator('body').getAttribute('data-dock')==='open')await page.locator('#dockToggle').click();await page.locator('#envTrigger').click();await page.waitForTimeout(250);await page.screenshot({path:out+'/environment.png'});await page.locator('[data-dialog="commit"]').click();assert.equal(await page.locator('#prototypeDialog').evaluate(e=>e.open),true);await page.keyboard.press('Escape');});
  await page.locator('#envClose').click();
  await page.locator('#settingsBtn').click();
  for(const key of ['general','providers','im','agents','capabilities','maintenance']){
    await check('settings '+key,async()=>{await page.locator('.settings-tab[data-settings-panel="'+key+'"]').click();assert.equal(await page.locator('.settings-panel-content:visible').count(),1);assert.equal(await page.locator('.settings-panel-content:visible').getAttribute('data-panel'),key);await page.waitForTimeout(250);await page.screenshot({path:out+'/settings-'+key+'.png'});});
  }
  await check('settings keyboard/focus return',async()=>{await page.locator('#settingsClose').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.settings-panel').evaluate(e=>e.contains(document.activeElement)),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#settingsBtn').evaluate(e=>e===document.activeElement),true);});
  await check('im cards contract across demo states',async()=>{
    const cards=()=>page.locator('[data-im-card-head]').evaluateAll(els=>els.map(e=>e.getAttribute('aria-expanded')));
    /* alert：②③④ 展开（首张未完成+有⚠），胶囊 warn 计数 1，②③④ 角标 ⚠1 */
    await page.goto(base+'#settings=1&im-demo=alert');await page.waitForTimeout(400);
    assert.deepEqual(await cards(),['false','true','true','true','false']);
    assert.equal(await page.locator('#imStatePill').getAttribute('data-tone'),'warn');
    assert.match(await page.locator('#imStateText').textContent(),/^1 个机器人连接失败$/);
    assert.deepEqual(await page.locator('[data-im-alerts]:not([hidden])').allTextContents(),['⚠1','⚠1','⚠1']);
    assert.equal(await page.locator('[data-im-ready]').isHidden(),true);
    /* progress：③ 当前步骤展开，胶囊 ok · 1 在线，就绪条隐藏（③未完成） */
    await page.goto(base+'#settings=1&im-demo=progress');await page.waitForTimeout(400);
    assert.deepEqual(await cards(),['false','false','true','false','false']);
    assert.equal(await page.locator('#imStatePill').getAttribute('data-tone'),'ok');
    assert.equal(await page.locator('#imMasterSwitch').getAttribute('aria-checked'),'true');
    assert.equal(await page.locator('[data-im-ready]').isHidden(),true);
    /* empty：仅①展开，主开关禁用，②-⑤摘要统一「先开启服务」 */
    await page.goto(base+'#settings=1&im-demo=empty');await page.waitForTimeout(400);
    assert.deepEqual(await cards(),['true','false','false','false','false']);
    assert.equal(await page.locator('#imStateText').textContent(),'未开启');
    assert.equal(await page.locator('#imMasterSwitch').isDisabled(),true);
    assert.equal(await page.locator('[data-im-summary]').evaluateAll(els=>els.every(e=>e.textContent==='先开启服务')),true);
    assert.equal(await page.locator('[data-im-service-start]').isVisible(),true);
    /* hash 重放幂等：empty → alert 回放后聚合态完整重建 */
    await page.evaluate(()=>{location.hash='#settings=1&im-demo=alert';});await page.waitForTimeout(400);
    assert.deepEqual(await cards(),['false','true','true','true','false']);
    assert.equal(await page.locator('#imStatePill').getAttribute('data-tone'),'warn');
    await page.locator('#settingsClose').click();
  });
  await check('im full simulation walkthrough (empty → ready → reset)',async()=>{
    const cards=()=>page.locator('[data-im-card-head]').evaluateAll(els=>els.map(e=>e.getAttribute('aria-expanded')));
    const badge=key=>page.locator('[data-im-card="'+key+'"] [data-im-badge]').textContent();
    const feishu=label=>page.locator('[data-im-subcard="feishu"] [data-im-field-label="'+label+'"] input');
    await page.goto(base+'#settings=1&im-demo=empty');await page.waitForTimeout(400);
    /* G1：一键开启 → 1000ms 启动过渡 */
    await page.click('[data-im-service-start]');
    assert.equal(await page.locator('[data-im-service-start]').textContent(),'正在启动…');
    assert.equal(await page.locator('[data-im-service-start]').isDisabled(),true);
    await page.waitForTimeout(1300);
    assert.equal(await badge('service'),'已就绪');
    assert.equal(await badge('bots'),'当前步骤');
    assert.equal(await page.locator('#imStateText').textContent(),'服务已就绪，还没有机器人');
    /* G2 失败支线：填 4 必填 → 演示结果=失败 → 连接失败 + ②⚠1 + 胶囊 warn */
    await page.click('[data-im-platform="feishu"] [data-im-add]');
    await feishu('App ID').fill('cli_a5demo');
    await feishu('机器人 Open ID').fill('ou_demo01');
    await feishu('Tenant Key').fill('tenant_demo');
    await feishu('App Secret').fill('secret_demo');
    await page.locator('[data-im-subcard="feishu"] [data-im-sim-outcome]').selectOption('bad');
    await page.click('[data-im-subcard="feishu"] [data-im-cred-save]');
    /* 时序守卫：连接过渡期内保存钮 disabled */
    assert.equal(await page.locator('[data-im-subcard="feishu"] [data-im-cred-save]').isDisabled(),true);
    assert.equal(await page.locator('[data-im-subcard="feishu"] [data-im-cred-save]').textContent(),'正在连接…');
    await page.waitForTimeout(1100);
    assert.equal(await page.locator('[data-im-platform="feishu"] .im-platform-status').textContent(),'连接失败');
    assert.equal(await page.locator('[data-im-card="bots"] [data-im-alerts]').textContent(),'⚠1');
    assert.equal(await page.locator('#imStatePill').getAttribute('data-tone'),'warn');
    /* G2 成功支线：重新输入密钥 → 演示结果=成功 → 已连接 · 1 个，③展开，胶囊 ok */
    await page.click('[data-im-platform="feishu"] [data-im-reenter]');
    await page.locator('[data-im-subcard="feishu"] [data-im-sim-outcome]').selectOption('ok');
    await page.click('[data-im-subcard="feishu"] [data-im-cred-save]');
    assert.equal(await page.locator('[data-im-subcard="feishu"] [data-im-cred-save]').isDisabled(),true);
    await page.waitForTimeout(1100);
    assert.equal(await page.locator('[data-im-platform="feishu"] .im-platform-status').textContent(),'已连接 · 1 个');
    assert.equal(await page.locator('[data-im-card="account"] [data-im-card-head]').getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('#imStatePill').getAttribute('data-tone'),'ok');
    /* ③ 双轨：复制指令 → 等待卡 → 演示直达 → 请求卡 → 批准 → 绑定行 + ④展开 */
    await page.locator('[data-copy-pair]').first().click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-im-wait-card]').isVisible(),true);
    await page.click('[data-im-pair-arrive]');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-im-pairing-idx]').count(),1);
    await page.click('[data-im-approve]');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('[data-im-bindings] .im-binding-row').count(),1);
    assert.equal(await page.locator('[data-im-card="projects"] [data-im-card-head]').getAttribute('aria-expanded'),'true');
    /* ④：勾选 → 待保存徽标 + 自动默认 → 保存 → M6 就绪条 */
    await page.locator('[data-im-project-idx="0"] input[type="checkbox"]').check();
    await page.waitForTimeout(200);
    assert.equal(await badge('projects'),'已选 1 · 待保存');
    assert.equal(await page.locator('[data-im-default-project]').inputValue(),'Artemis');
    await page.click('[data-im-projects-save]');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-im-ready]').isVisible(),true);
    /* ⑤ 支线：发现 → 确认 → 已连接 1 群 */
    await page.click('[data-im-card="groups"] [data-im-card-head]');
    await page.waitForTimeout(200);
    await page.click('[data-im-group-find]');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.im-group-state').textContent(),'已发现 · 未共享');
    await page.click('[data-im-group-confirm]');
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('.im-group-state').textContent(),'已生效');
    assert.equal(await badge('groups'),'已连接 1 群');
    /* 重置：回到 empty 契约 */
    await page.click('[data-im-sim-reset]');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#imStateText').textContent(),'未开启');
    assert.deepEqual(await cards(),['true','false','false','false','false']);
    assert.equal(await page.locator('[data-im-ready]').isHidden(),true);
    await page.locator('#settingsClose').click();
  });
  await check('resource panel switching',async()=>{await page.locator('.sidebar-main [data-goto="resources"]').click();for(const key of ['plugins','connectors','mcp','skills']){await page.locator('[data-resource="'+key+'"]').click();assert.equal(await page.locator('.resource-pane:visible').getAttribute('data-resource-panel'),key);}});
  for(const width of [1440,1280,1024,980,768,390]){
    await check('viewport '+width,async()=>{
      await page.setViewportSize({width,height:900});await page.goto(base+'?width='+width+'#audit=1');await page.waitForTimeout(400);
      assert.equal(JSON.parse(await page.locator('#LAYOUT_OUT').textContent()).ok,true);
      for(const key of ['review','files','browser']){await open(key);assert.equal(await page.locator('.tab-content > .tab-panel:visible').evaluate(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}),true);}
      await page.locator('#dockToggle').click();assert.equal(await page.locator('#conversation').isVisible(),true);await page.screenshot({path:out+'/conversation-'+width+'.png'});
    });
  }
  await check('minimum desktop height and task tree',async()=>{
    await page.setViewportSize({width:980,height:680});await page.goto(base+'?height=680#audit=1');await page.waitForTimeout(350);assert.equal(JSON.parse(await page.locator('#LAYOUT_OUT').textContent()).ok,true);
    await page.locator('.rail-brand').click();await page.waitForTimeout(750);
    const head=page.locator('.project-head').first();await head.click();assert.equal(await head.getAttribute('aria-expanded'),'false');await head.click();assert.equal(await head.getAttribute('aria-expanded'),'true');
    await page.screenshot({path:out+'/desktop-minimum.png'});
  });
  for(const view of ['token-usage','automations','archive']){await check('main view '+view,async()=>{await page.goto(base+'#view='+view);await page.waitForFunction(v=>document.body.dataset.view===v,view);assert.equal(await page.locator('body').getAttribute('data-view'),view);assert.equal(await page.locator('.workspace > .page:visible').count(),1);});}
  assert.deepEqual(errors,[]);
  await writeFile(out+'/results.json',JSON.stringify({ok:true,checks:results,errors},null,2));
  console.log('PASS '+results.length+' checks; screenshots and results: '+out);
} finally {await browser.close();}
