// Browser regression test, using a temporary CI-only Playwright installation.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createApp} from '../server/server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const rows=Array.from({length:3},(_,i)=>({id:i+1,file_url:`https://media.booru.test/${i+1}.svg`,preview_url:`https://media.booru.test/${i+1}.svg`,sample_url:`https://media.booru.test/${i+1}.svg`,width:800,height:1000,tags:'landscape sky artist_name character_name world_name',tag_string_artist:'artist_name',tag_string_character:'character_name',tag_string_copyright:'world_name',score:42}));
const app=createApp({publicOrigin:'',additionalOrigins:[],upstream:async url=>{
 const u=new URL(url);return new Response(JSON.stringify(u.pathname.includes('autocomplete')||u.pathname==='/tags.json'||u.searchParams.get('s')==='tag'?[{name:'landscape',post_count:12345},{name:'landscape_scenery',post_count:1000}]:rows));
}});
const server=createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});await mkdir('build/ui',{recursive:true});
async function context(viewport){
 const c=await browser.newContext({viewport,isMobile:viewport.width<600,hasTouch:viewport.width<600});
 await c.route('https://media.booru.test/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#8cabb7"/><circle cx="600" cy="220" r="100" fill="#efdaa7"/><path d="M0 1000V700L300 300L600 850L800 500V1000Z" fill="#3b6063"/><path d="M0 1000L400 600L800 1000Z" fill="#293e4c"/></svg>'}));return c;
}
let page;
try{
 const c=await context({width:1280,height:960});page=await c.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('.source-card').first().waitFor();
 await page.click('#addSource');await page.click('[data-template="e621"]');assert.equal(await page.inputValue('#sourceBase'),'https://e621.net/');await page.click('#sourceForm button[type=submit]');
 assert.equal(await page.locator('.source-card').count(),2);
 await page.selectOption('#sourceSelect','safebooru');await page.fill('#query','la');await page.locator('.suggestion').nth(1).waitFor();await page.locator('.suggestion').nth(1).click();
 assert.equal(await page.locator('.tag-chip').count(),1);
 await page.fill('#query','-city');await page.press('#query','Enter');await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===3);
 assert.equal(await page.locator('.post-media').first().evaluate(n=>n.tagName),'DIV');assert.equal(await page.locator('#viewer').evaluate(n=>n.open),false);
 assert.ok(await page.locator('.inline-tags .tag-group[data-group="artist"]').count());
 await page.screenshot({path:'build/ui/desktop-list.png',fullPage:false});
 await page.click('#saveCollection');await page.fill('#collectionName','Мой поиск');await page.click('#collectionForm button[type=submit]');
 await page.click('#homeTab');await page.locator('.collection-card').first().waitFor();assert.match(await page.locator('.collection-card').first().innerText(),/Мой поиск/);
 await page.screenshot({path:'build/ui/desktop-home.png',fullPage:true});
 await page.locator('.collection-card-main').first().click();await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===3);
 await page.click('#gridView');await page.locator('.posts-grid').waitFor();await page.screenshot({path:'build/ui/desktop-grid.png'});
 await page.locator('.post-media').first().click();await page.waitForFunction(()=>document.getElementById('viewer').open);assert.ok(await page.locator('#tags .tag-group[data-group="character"]').count());
 await page.click('#savePost');await page.click('#closeViewer');await page.click('#savedTab');assert.equal(await page.locator('#grid .post').count(),1);
 assert.deepEqual(errors,[]);await c.close();
 const mobile=await context({width:390,height:844});page=await mobile.newPage();const mobileErrors=[];page.on('pageerror',e=>mobileErrors.push(e.message));
 await page.goto(url);await page.locator('.source-card').first().waitFor();await page.screenshot({path:'build/ui/mobile-home.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.click('#feedTab');await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===3);
 await page.screenshot({path:'build/ui/mobile-list.png'});await page.evaluate(()=>scrollTo(0,500));assert.ok(await page.locator('.search-panel').evaluate(n=>n.getBoundingClientRect().top<2));
 await page.evaluate(()=>scrollTo(0,0));await page.fill('#query','la');await page.locator('.suggestion').nth(1).waitFor();await page.screenshot({path:'build/ui/mobile-suggestions.png'});await page.press('#query','Escape');
 await page.click('#settingsOpen');await page.click('#addSourceFromSettings');
 await page.locator('#sourceEditor[open]').waitFor();await page.screenshot({path:'build/ui/mobile-source-editor.png'});
 assert.deepEqual(mobileErrors,[]);await mobile.close();console.log('Desktop/mobile UI scenarios passed: multiple sources, autocomplete, chips, collections, list/grid, viewer and saved posts.');
}catch(e){if(page&&!page.isClosed())await page.screenshot({path:'build/ui/failure.png',fullPage:true});throw e;}
finally{await browser.close();server.close();}
