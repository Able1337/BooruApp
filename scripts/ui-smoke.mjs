// Browser regression test, using a temporary CI-only Playwright installation.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createApp} from '../server/server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const rows=Array.from({length:3},(_,i)=>({id:i+1,file_url:`https://media.booru.test/${i+1}.svg`,preview_url:`https://media.booru.test/${i+1}.svg`,sample_url:`https://media.booru.test/${i+1}.svg`,width:800,height:1000,tags:'landscape sky artist_name character_name world_name',tag_string_artist:'artist_name',tag_string_character:'character_name',tag_string_copyright:'world_name',score:42}));
const relayCalls=[];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6vS8AAAAASUVORK5CYII=','base64');
const gelMedia='https://img4.gelbooru.com/images/ab/cd/test.png',eMedia='https://static1.e621.net/data/ab/cd/abcdef0123456789abcdef0123456789.png';
const app=createApp({publicOrigin:'',additionalOrigins:[],upstream:async (url,options)=>{
 if(['img4.gelbooru.com','static1.e621.net'].includes(new URL(url).hostname)){relayCalls.push({url,referer:options.headers.Referer});return new Response(url.endsWith('.webm')?await readFile(new URL('../tests/fixtures/scroll-video.webm',import.meta.url)):png,{headers:{'Content-Type':url.endsWith('.webm')?'video/webm':'image/png'}});}
 const u=new URL(url);if((u.searchParams.get('tags')||'').includes('media_smoke'))return new Response(JSON.stringify([{...rows[0],file_url:gelMedia,preview_url:gelMedia,sample_url:gelMedia},{...rows[1],file_url:eMedia,preview_url:eMedia,sample_url:eMedia},{...rows[2],file_url:eMedia.replace('.png','.webm'),preview_url:eMedia,sample_url:eMedia}]));if((u.searchParams.get('tags')||'').includes('video_smoke'))return new Response(JSON.stringify([{...rows[0],file_url:'https://media.booru.test/scroll-video.webm'},...rows.slice(1)]));return new Response(JSON.stringify(u.pathname.includes('autocomplete')||u.pathname==='/tags.json'||u.searchParams.get('s')==='tag'?[{name:'landscape',post_count:12345},{name:'landscape_scenery',post_count:1000}]:rows));
}});
const server=createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});await mkdir('build/ui',{recursive:true});
async function context(viewport){
 const c=await browser.newContext({viewport,isMobile:viewport.width<600,hasTouch:viewport.width<600});
 await c.route('https://media.booru.test/*.webm',async route=>route.fulfill({contentType:'video/webm',body:await readFile(new URL('../tests/fixtures/scroll-video.webm',import.meta.url))}));
 await c.route('https://media.booru.test/*.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#8cabb7"/><circle cx="600" cy="220" r="100" fill="#efdaa7"/><path d="M0 1000V700L300 300L600 850L800 500V1000Z" fill="#3b6063"/><path d="M0 1000L400 600L800 1000Z" fill="#293e4c"/></svg>'}));return c;
}
let page;
try{
 const c=await context({width:1280,height:960});page=await c.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('.source-card').first().waitFor();await page.waitForFunction(()=>document.querySelectorAll('#collectionCards .card-cover').length===4);
 await page.click('#addSource');await page.click('[data-template="e621"]');assert.equal(await page.inputValue('#sourceBase'),'https://e621.net/');await page.click('#sourceForm button[type=submit]');
 assert.equal(await page.locator('.source-card').count(),2);
 await page.selectOption('#sourceSelect','safebooru');await page.fill('#query','la');await page.locator('.suggestion').nth(1).waitFor();await page.locator('.suggestion').nth(1).click();
 assert.equal(await page.locator('.tag-chip').count(),1);
 await page.fill('#query','-city');await page.press('#query','Enter');await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===3);
 assert.equal(await page.locator('.post-media').first().evaluate(n=>n.tagName),'DIV');assert.equal(await page.locator('#viewer').evaluate(n=>n.open),false);
 assert.ok(await page.locator('.inline-tags .tag-group[data-group="artist"]').count());assert.equal(await page.locator('.inline-tags').first().evaluate(n=>n.open),false);await page.locator('.inline-tags summary').first().click();assert.equal(await page.locator('.inline-tags').first().evaluate(n=>n.open),true);
 const postTag=page.locator('#grid .inline-tags .post-tags a').first();const chosenTag=await postTag.innerText();await postTag.click();await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===3);await page.locator('.tag-chip').filter({hasText:chosenTag}).locator('.exclude-toggle').click();await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===3);assert.ok(await page.locator('.tag-chip.excluded').filter({hasText:chosenTag}).count());
 await page.locator('#grid .inline-tags summary').first().click();await page.locator('#grid .inline-tags .post-tags a').first().click();await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===3);assert.equal(await page.locator('.tag-chip.excluded').filter({hasText:chosenTag}).count(),0);
 await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{window.sharedPayload=payload;}}));
 await page.locator('#grid .share-post').first().click();assert.equal(await page.evaluate(()=>window.sharedPayload.url),'https://safebooru.org/index.php?page=post&s=view&id=1');
 await page.locator('#grid .similar-post').first().click();await page.locator('#similarGrid .similar-card').first().waitFor();assert.equal(await page.locator('#similarGrid .similar-card').count(),2);await page.locator('#similarGrid .similar-card').first().click();assert.ok((await page.locator('#viewerSource').innerText()).includes('#2'));assert.ok((await page.locator('#downloadPost').getAttribute('download')).startsWith('safebooru-2.'));await page.click('#closeViewer');
 await page.screenshot({path:'build/ui/desktop-list.png',fullPage:false});
 await page.click('#saveCollection');await page.fill('#collectionName','Мой поиск');await page.click('#collectionForm button[type=submit]');
 await page.click('#homeTab');await page.locator('.collection-card').first().waitFor();assert.match(await page.locator('.collection-card').first().innerText(),/Мой поиск/);
 await page.screenshot({path:'build/ui/desktop-home.png',fullPage:true});
 await page.locator('.collection-card-main').first().click();await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===3);
 await page.click('#gridView');await page.locator('.posts-grid').waitFor();await page.screenshot({path:'build/ui/desktop-grid.png'});
 await page.locator('.post-media').first().click();await page.waitForFunction(()=>document.getElementById('viewer').open);assert.ok(await page.locator('#tags .tag-group[data-group="character"]').count());
 await page.click('#sharePost');assert.equal(await page.evaluate(()=>window.sharedPayload.url),'https://safebooru.org/index.php?page=post&s=view&id=1');await page.click('#savePost');await page.click('#closeViewer');await page.click('#savedTab');assert.equal(await page.locator('#grid .post').count(),1);assert.equal(await page.locator('.saved-group').count(),1);assert.equal(await page.locator('#shareSearch').isVisible(),false);await page.locator('#grid .share-post').first().click();assert.equal(await page.evaluate(()=>window.sharedPayload.url),'https://safebooru.org/index.php?page=post&s=view&id=1');
 await page.click('#homeTab');const collectionHref=await page.locator('.collection-card-main').first().getAttribute('href');assert.ok(collectionHref.startsWith('#feed?'));assert.ok(collectionHref.includes('collection='));
 await page.locator('.collection-card-main').first().click();await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===3);const collectionUrl=page.url();await page.fill('#query','-night');await page.press('#query','Enter');const tagsUrl=page.url();await page.selectOption('#sort','score');
 const sharedUrl=page.url();const sharedParams=new URL(sharedUrl).hash;assert.ok(sharedParams.includes('tags='));assert.ok(sharedParams.includes('sort=score'));assert.ok(!sharedParams.includes('api_key'));
 await page.goBack();await page.waitForURL(tagsUrl);assert.ok(await page.locator('.tag-chip.excluded').filter({hasText:'night'}).count());
 await page.goBack();await page.waitForURL(collectionUrl);assert.equal(await page.locator('.tag-chip').filter({hasText:'night'}).count(),0);
 await page.goBack();await page.waitForFunction(()=>!document.getElementById('homeView').hidden);assert.ok(page.url().endsWith('#home'));
 await page.goForward();await page.waitForURL(collectionUrl);await page.goForward();await page.waitForURL(tagsUrl);await page.goForward();await page.waitForFunction(()=>!document.getElementById('feedView').hidden);assert.equal(page.url(),sharedUrl);await page.reload();await page.locator('#grid .post').first().waitFor();assert.equal(page.url(),sharedUrl);
 await page.goBack();await page.waitForURL(tagsUrl);await page.goBack();await page.waitForURL(collectionUrl);await page.goBack();await page.waitForFunction(()=>!document.getElementById('homeView').hidden);
 const deep=await c.newPage();await deep.goto(sharedUrl);await deep.locator('#grid .post').first().waitFor();assert.equal(await deep.inputValue('#sort'),'score');assert.ok(await deep.locator('.tag-chip.excluded').filter({hasText:'night'}).count());await deep.goBack();await deep.waitForFunction(()=>!document.getElementById('homeView').hidden);await deep.close();
 assert.deepEqual(errors,[]);await c.close();
 const fresh=await context({width:390,height:844});const freshPage=await fresh.newPage();await freshPage.goto(sharedUrl.replace('booru=safebooru','booru=e621'));await freshPage.locator('#grid .post').first().waitFor();assert.equal(await freshPage.locator('#sourceSelect option:checked').innerText(),'e621');await freshPage.goBack();await freshPage.waitForFunction(()=>!document.getElementById('homeView').hidden);await fresh.close();
 const mobile=await context({width:390,height:844});page=await mobile.newPage();const mobileErrors=[];page.on('pageerror',e=>mobileErrors.push(e.message));
 await page.goto(url);await page.locator('.source-card').first().waitFor();await page.waitForFunction(()=>document.querySelectorAll('#collectionCards .card-cover').length>=2);await page.locator('#collectionCards .collection-card').last().scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelectorAll('#collectionCards .card-cover').length===4);assert.ok(await page.locator('.collection-cards').first().evaluate(n=>n.scrollWidth<=n.clientWidth+1));const rects=await page.locator('#collectionCards .collection-card').evaluateAll(nodes=>nodes.map(n=>({top:n.getBoundingClientRect().top,left:n.getBoundingClientRect().left})));assert.ok(rects[2].top>rects[0].top);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'build/ui/mobile-home.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.click('#feedTab');await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===3);
 await page.screenshot({path:'build/ui/mobile-list.png'});await page.evaluate(()=>scrollTo(0,700));await page.waitForFunction(()=>document.getElementById('searchPanel').getBoundingClientRect().bottom<=0);await page.evaluate(()=>scrollBy(0,-80));await page.waitForFunction(()=>document.getElementById('searchPanel').getBoundingClientRect().top>=0);
 await page.evaluate(()=>scrollTo(0,0));await page.fill('#query','la');await page.locator('.suggestion').nth(1).waitFor();await page.screenshot({path:'build/ui/mobile-suggestions.png'});await page.press('#query','Escape');
 await page.fill('#query','video_smoke');await page.press('#query','Enter');await page.locator('#grid video').waitFor();
 await page.locator('#grid video').evaluate(async video=>{video.muted=true;await video.play();});await page.waitForFunction(()=>!document.querySelector('#grid video').paused);
 await page.evaluate(()=>{const video=document.querySelector('#grid video');scrollBy(0,video.getBoundingClientRect().bottom+100);});await page.waitForFunction(()=>document.querySelector('#grid video').paused);
 await page.evaluate(()=>scrollTo(0,0));await page.waitForFunction(()=>document.getElementById('searchPanel').getBoundingClientRect().top>=0);assert.equal(await page.locator('#grid video').evaluate(video=>video.paused),true);
 await page.fill('#query','media_smoke');await page.press('#query','Enter');await page.waitForFunction(()=>document.querySelectorAll('#grid img').length===2&&[...document.querySelectorAll('#grid img')].every(img=>img.complete&&img.naturalWidth>0));
 assert.ok(await page.locator('#grid img').evaluateAll(images=>images.every(img=>new URL(img.src).pathname==='/media')));
 const [firstDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#grid .download-post').nth(0).click()]);assert.ok(firstDownload.suggestedFilename().endsWith('.png'));assert.notEqual(firstDownload.suggestedFilename(),'media.png');assert.equal(await firstDownload.failure(),null);
 const [secondDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#grid .download-post').nth(1).click()]);assert.ok(secondDownload.suggestedFilename().endsWith('.png'));assert.notEqual(secondDownload.suggestedFilename(),firstDownload.suggestedFilename());assert.equal(await secondDownload.failure(),null);

 await page.locator('#grid video').scrollIntoViewIfNeeded();await page.locator('#grid video').evaluate(async video=>{video.muted=true;await video.play();});await page.waitForFunction(()=>!document.querySelector('#grid video').paused);
 assert.ok(relayCalls.some(call=>call.url===gelMedia&&call.referer==='https://gelbooru.com/'));assert.ok(relayCalls.some(call=>call.url===eMedia&&call.referer==='https://e621.net/'));
 await page.evaluate(()=>scrollTo(0,0));
 await page.click('#settingsOpen');await page.click('#addSourceFromSettings');
 await page.locator('#sourceEditor[open]').waitFor();await page.screenshot({path:'build/ui/mobile-source-editor.png'});
 assert.deepEqual(mobileErrors,[]);await mobile.close();console.log('Desktop/mobile UI scenarios passed: multiple sources, autocomplete, chips, collections, list/grid, viewer and saved posts.');
}catch(e){if(page&&!page.isClosed())await page.screenshot({path:'build/ui/failure.png',fullPage:true});throw e;}
finally{await browser.close();server.close();}
