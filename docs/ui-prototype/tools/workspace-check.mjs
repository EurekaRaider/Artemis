/** Standalone prototype regression. Requires Playwright with a local Chromium installation. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base=new URL('../apple-inspired-ui.html',import.meta.url).href;
const out=process.env.ARTEMIS_UI_CHECK_OUTPUT || '/tmp/artemis-workspace-check';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
async function check(name,fn){await fn();results.push(name);}
async function open(key){
  if(['review','terminal','browser','files'].includes(key)){
    await page.locator('#tabAdd').click();await page.locator('#panelPicker [data-open-panel="'+key+'"]').click();
  }else if(key==='goal')await page.locator('.goal-pill').click();
  else if(key==='markdown'){await open('files');await page.locator('#dockPanelFiles [data-open-panel="markdown"]').click();}
  else {await page.locator('#envTrigger').click();await page.locator('#envPop [data-open-panel="'+key+'"]').click();}
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
  await check('environment groups and commit dialog',async()=>{await page.locator('#envTrigger').click();await page.waitForTimeout(250);await page.screenshot({path:out+'/environment.png'});await page.locator('[data-dialog="commit"]').click();assert.equal(await page.locator('#prototypeDialog').evaluate(e=>e.open),true);await page.keyboard.press('Escape');});
  await page.locator('#envClose').click();
  await page.locator('#settingsBtn').click();
  for(const key of ['general','providers','im','agents','capabilities','maintenance']){
    await check('settings '+key,async()=>{await page.locator('.settings-tab[data-settings-panel="'+key+'"]').click();assert.equal(await page.locator('.settings-panel-content:visible').count(),1);assert.equal(await page.locator('.settings-panel-content:visible').getAttribute('data-panel'),key);await page.waitForTimeout(250);await page.screenshot({path:out+'/settings-'+key+'.png'});});
  }
  await check('settings keyboard/focus return',async()=>{await page.locator('#settingsClose').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.settings-panel').evaluate(e=>e.contains(document.activeElement)),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#settingsBtn').evaluate(e=>e===document.activeElement),true);});
  await check('resource panel switching',async()=>{await page.locator('[data-goto="resources"]').click();for(const key of ['plugins','connectors','mcp','skills']){await page.locator('[data-resource="'+key+'"]').click();assert.equal(await page.locator('.resource-pane:visible').getAttribute('data-resource-panel'),key);}});
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
    const head=page.locator('.project-head').first();await head.click();assert.equal(await head.getAttribute('aria-expanded'),'false');await head.click();assert.equal(await head.getAttribute('aria-expanded'),'true');
    await page.screenshot({path:out+'/desktop-minimum.png'});
  });
  for(const view of ['token-usage','automations','archive']){await check('main view '+view,async()=>{await page.goto(base+'#view='+view);await page.waitForFunction(v=>document.body.dataset.view===v,view);assert.equal(await page.locator('body').getAttribute('data-view'),view);assert.equal(await page.locator('.workspace > .page:visible').count(),1);});}
  assert.deepEqual(errors,[]);
  await writeFile(out+'/results.json',JSON.stringify({ok:true,checks:results,errors},null,2));
  console.log('PASS '+results.length+' checks; screenshots and results: '+out);
} finally {await browser.close();}
