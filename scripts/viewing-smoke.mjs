// Neutral media only. Run with PLAYWRIGHT_MODULE and PLAYWRIGHT_BROWSERS_PATH.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createApp} from '../server/server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
let calls=0;
const app=createApp({publicOrigin:'',additionalOrigins:[],upstream:async url=>{
 const u=new URL(url),size=+(u.searchParams.get('limit')||30),page=+(u.searchParams.get('pid')||0),tags=u.searchParams.get('tags')||'';calls++;
 if(u.searchParams.get('s')==='tag')return new Response('[]');
 return new Response(JSON.stringify(page>=10?[]:Array.from({length:size},(_,i)=>({id:1000000-page*30-i,file_url:`https://media.booru.test/${tags.includes('videos')?'video.webm':page*30+i+'.svg'}`,preview_url:`https://media.booru.test/${i}.svg`,width:800,height:1000,tags:['cat',...Array.from({length:39},(_,i)=>'tag_'+i)].join(' '),score:30}))));
}});
const server=createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.route('https://media.booru.test/**',async route=>route.fulfill(route.request().url().endsWith('.webm')?{contentType:'video/webm',body:await readFile(new URL('../tests/fixtures/scroll-video.webm',import.meta.url))}:{contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#466073"/><circle cx="500" cy="300" r="100" fill="#d2bbc4"/></svg>'}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.click('#feedTab');await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===30);await page.waitForTimeout(100);
 const firstMediaTop=await page.locator('.post-media').first().evaluate(n=>Math.round(n.getBoundingClientRect().top));assert.ok(firstMediaTop<250,`First media starts ${firstMediaTop}px down`);
 assert.equal(await page.locator('#grid .post-tags a').count(),0);
 await page.locator('.inline-tags summary').first().click();await page.waitForFunction(()=>document.querySelectorAll('#grid .post-tags a').length===40);
 await page.locator('.inline-tags summary').first().click();
 for(let count=60;count<=300;count+=30){await page.evaluate(()=>document.getElementById('more').click());await page.waitForFunction(n=>document.querySelectorAll('#grid .post').length>=n,count);}
 await page.locator('#grid .post').nth(120).scrollIntoViewIfNeeded();await page.waitForTimeout(750);
 const before=await page.evaluate(()=>{const n=[...document.querySelectorAll('#grid .post')].find(n=>n.getBoundingClientRect().bottom>0);return {key:n.dataset.postKey,top:n.getBoundingClientRect().top};});
 const original=page.url(),callsBefore=calls;
 await page.evaluate(()=>{document.getElementById('query').value='city';document.getElementById('searchForm').requestSubmit();});
 await page.waitForURL(u=>u.href!==original);await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===30);
 await page.goBack();await page.waitForURL(original);await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===300);await page.waitForTimeout(750);
 const after=await page.evaluate(key=>{const n=[...document.querySelectorAll('#grid .post')].find(n=>n.dataset.postKey===key);return {key:n.dataset.postKey,top:n.getBoundingClientRect().top};},before.key);
 assert.ok(Math.abs(before.top-after.top)<5,JSON.stringify({before,after}));assert.equal(calls,callsBefore+1);
 const bounded=await page.evaluate(()=>({slots:document.querySelectorAll('#grid .post').length,mounted:document.querySelectorAll('#grid .post-head').length,tagLinks:document.querySelectorAll('#grid .post-tags a').length,nodes:document.getElementById('grid').querySelectorAll('*').length,media:document.querySelectorAll('#grid img,#grid video').length}));assert.ok(bounded.mounted<20,JSON.stringify(bounded));assert.equal(bounded.tagLinks,0);
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===300);await page.waitForTimeout(750);
 const restoredTop=await page.evaluate(key=>[...document.querySelectorAll('#grid .post')].find(n=>n.dataset.postKey===key).getBoundingClientRect().top,before.key);assert.ok(Math.abs(restoredTop-before.top)<5,JSON.stringify({restoredTop,before}));
 // IDB write failure must not change either UI state or persisted favorites.
 await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='posts')throw new DOMException('quota','QuotaExceededError');return window.originalPut.apply(this,args);};});
 const heart=page.locator('#grid .favorite-button').first();await heart.scrollIntoViewIfNeeded();await heart.click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Пост не сохранён'));assert.equal(await page.locator('#savedCount').innerText(),'0');assert.equal(await heart.getAttribute('aria-pressed'),'false');
 await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;});await heart.click();await page.waitForFunction(()=>document.getElementById('savedCount').textContent==='1');
 await page.reload();await page.waitForFunction(()=>document.getElementById('savedCount').textContent==='1');
 // A failed bulk write must roll back even the preceding clear().
 const atomic=await page.evaluate(async()=>{
   const {openLibrary}=await import('/library.mjs'),library=await openLibrary();const before=await library.posts(),put=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(...args){if(this.name==='posts')throw new DOMException('quota','QuotaExceededError');return put.apply(this,args);};
   let rejected=false;try{await library.replacePosts(before);}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
   const after=await library.posts();library.close();return {rejected,before:before.length,after:after.length};
 });assert.deepEqual(atomic,{rejected:true,before:1,after:1});
 await page.waitForTimeout(750);await page.mouse.wheel(0,-80);await page.waitForFunction(()=>document.getElementById('topbar').getBoundingClientRect().top>=0);
 const resumeAnchor=await page.evaluate(()=>{const n=[...document.querySelectorAll('#grid .post')].find(n=>n.getBoundingClientRect().bottom>0);return{key:n.dataset.postKey,top:n.getBoundingClientRect().top};});
 await page.click('#homeTab');await page.locator('#resumeFeed').waitFor();await page.click('#resumeFeed');await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===300);await page.waitForTimeout(750);
 const resumedTop=await page.evaluate(key=>[...document.querySelectorAll('#grid .post')].find(n=>n.dataset.postKey===key).getBoundingClientRect().top,resumeAnchor.key);assert.ok(Math.abs(resumedTop-resumeAnchor.top)<5,JSON.stringify({resumeAnchor,resumedTop}));
 // Image viewer gestures and close preserve the feed anchor.
 await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(300);await page.locator('#grid img').first().click();await page.waitForFunction(()=>document.getElementById('viewer').open);
 await page.locator('#media img').dblclick();assert.equal(await page.locator('#media').getAttribute('data-zoomed'),'true');await page.locator('#media img').press('0');assert.equal(await page.locator('#media').getAttribute('data-zoomed'),'false');
 const firstViewer=await page.locator('#viewerSource').innerText();await page.evaluate(()=>{const image=document.querySelector('#media img');image.dispatchEvent(new PointerEvent('pointerdown',{pointerId:7,clientX:280,clientY:200,bubbles:true}));image.dispatchEvent(new PointerEvent('pointermove',{pointerId:7,clientX:80,clientY:205,bubbles:true}));image.dispatchEvent(new PointerEvent('pointerup',{pointerId:7,clientX:80,clientY:205,bubbles:true}));});assert.notEqual(await page.locator('#viewerSource').innerText(),firstViewer);await page.click('#closeViewer');assert.equal(await page.locator('#media img').count(),0);
 // Source failure is local to a media card and has an explicit retry.
 await page.evaluate(()=>document.querySelector('#grid img').dispatchEvent(new Event('error')));await page.evaluate(()=>document.querySelector('#grid img').dispatchEvent(new Event('error')));await page.locator('.media-error').first().waitFor();await page.locator('.media-error button').first().click();assert.equal(await page.locator('.media-error').count(),0);
 // Only one video can play, loop survives, scrolling pauses and distant cards release src.
 await page.evaluate(()=>{document.getElementById('query').value='videos';document.getElementById('searchForm').requestSubmit();});await page.waitForURL(u=>u.hash.includes('videos'));await page.locator('#grid video').first().waitFor();
 await page.locator('#grid video').nth(0).evaluate(v=>v.play());await page.locator('#grid video').nth(1).evaluate(v=>v.play());assert.equal(await page.locator('#grid video').nth(0).evaluate(v=>v.paused),true);assert.equal(await page.locator('#grid video').nth(1).evaluate(v=>v.loop),true);await page.evaluate(()=>window.oldVideo=document.querySelector('#grid video'));
 await page.evaluate(()=>scrollTo(0,5000));await page.waitForTimeout(750);assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#grid video')].every(v=>v.paused)),true);assert.equal(await page.evaluate(()=>window.oldVideo.getAttribute('src')),null);
 // Preferences are optional; exclusions affect API queries and can be bypassed.
 await page.evaluate(()=>scrollTo(0,0));await page.click('#settingsOpen');await page.click('#readingSettings');await page.fill('#permanentExclusions','comic');await page.selectOption('#mediaQuality','preview');await page.check('#hideSeen');await page.click('#readingForm button[type=submit]');
 await page.waitForURL(u=>u.hash.includes('-comic'));await page.locator('#grid .post').first().waitFor();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('bp.reading')).quality),'preview');
 await page.click('#searchOptions summary');await page.click('#showHidden');await page.waitForURL(u=>!u.hash.includes('-comic'));
 await page.click('#settingsOpen');await page.click('#clearHistory');await page.waitForFunction(()=>document.getElementById('updateStatus').textContent.includes('История просмотра очищена'));assert.equal(await page.locator('#savedCount').innerText(),'1');await page.click('#settingsClose');
 assert.deepEqual(errors,[]);await mkdir('build/ui',{recursive:true});await page.screenshot({path:'build/ui/viewing-mobile.png'});await writeFile('build/ui/viewing-results.json',JSON.stringify({firstMediaTop,bounded,history:{before,after},favoriteFailure:'UI unchanged; retry committed; persisted after reload',viewer:'zoom, reset, swipe, close',videos:'exclusive playback, loop, offscreen pause',errors},null,2));console.log('Viewing regression checks passed',JSON.stringify({firstMediaTop,bounded,before,after}));await context.close();
 // Existing localStorage favorites migrate once and retain order and API credentials.
 const legacy=await browser.newContext();await legacy.addInitScript(()=>{if(!localStorage.getItem('migrationFixture')){localStorage.setItem('migrationFixture','1');localStorage.setItem('bp.source',JSON.stringify({id:'legacy',name:'Rule34',kind:'gelbooru',base:'https://rule34.xxx/',userId:'123',apiKey:'fixture-key'}));localStorage.setItem('bp.saved',JSON.stringify([{key:'legacy#2',id:'2',file:'https://example.org/2.png',preview:'https://example.org/2.png',tags:[]},{key:'legacy#1',id:'1',file:'https://example.org/1.png',preview:'https://example.org/1.png',tags:[]}]));}});
 const migrated=await legacy.newPage();await migrated.goto(url);await migrated.waitForFunction(()=>document.getElementById('savedCount').textContent==='2');await migrated.reload();await migrated.waitForFunction(()=>document.getElementById('savedCount').textContent==='2');assert.equal(await migrated.evaluate(()=>JSON.parse(localStorage.getItem('bp.sources')).find(s=>s.id==='legacy').apiKey),'fixture-key');await legacy.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
