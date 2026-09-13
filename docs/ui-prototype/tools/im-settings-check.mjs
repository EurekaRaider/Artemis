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
 await check('pairing approval and project save confirmation',async()=>{await locate('account');await page.locator('[data-copy-pair]').first().click();await page.locator('[data-im-pair-arrive]').click();await page.locator('[data-im-approve]').click();await locate('projects');await page.locator('.im-project-head input').first().check();assert.equal(await page.locator('[data-im-default-project]').inputValue(),'Artemis');assert.equal(await page.locator('[data-im-ready]').isHidden(),true);await page.locator('[data-im-projects-save]').click();assert.equal(await page.locator('.im-confirm-dialog').evaluate(el=>el.open),true);await page.locator('[data-im-confirm-ok]').click();assert.equal(await page.locator('[data-im-ready]').isVisible(),true);});
 await check('manage saved credentials displays saved view',async()=>{await locate('bots');await row.locator('[data-im-manage]').click();assert.equal(await row.locator('[data-im-cred-saved]').isVisible(),true);await row.locator('[data-im-cred-swap]').click();assert.equal(await row.locator('[data-im-field-label="App Secret"] input').inputValue(),'');});
 await check('all platform contracts and draft collapse',async()=>{for(const [key,count] of [['wecom',3],['slack',2]]){const r=page.locator('[data-im-platform="'+key+'"]');await r.locator('[data-im-add]').click();assert.equal(await r.locator('input:visible').count(),count);assert.equal(await r.locator('[data-im-receive-mode]').count(),0);await r.locator('[data-im-fill-demo]').click();await r.locator('[data-im-cred-cancel]').click();await r.locator('[data-im-add]').click();assert.ok(await r.locator('input').first().inputValue());} });
 await page.screenshot({path:out+'/credentials-light.png'});
 await check('scenes and expired pairing do not advance',async()=>{await page.locator('.im-simulation summary').click();await page.locator('[data-im-scene="expired"]').click();await page.locator('[data-im-confirm-ok]').click();await locate('account');await page.locator('[data-copy-pair]').first().click();assert.equal(await page.locator('[data-im-wait-card]').isHidden(),true);await page.locator('[data-im-renew-code]').click();assert.match(await page.locator('[data-im-countdown]').first().textContent(),/5:00|4:59/);});
 await check('narrow dark and reduced motion',async()=>{await page.setViewportSize({width:620,height:850});await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await locate('bots');await page.screenshot({path:out+'/narrow-dark.png'});assert.equal(await page.locator('#settingsPanelIm').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);});
 assert.deepEqual(errors,[]); await writeFile(out+'/result.json',JSON.stringify({results,errors},null,2));
} finally {await browser.close();}
