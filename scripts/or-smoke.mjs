import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createApp} from '../server/server.mjs';
import {SOURCE_TEMPLATES} from '../web/core.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const records=[{id:3,tags:'animated cat'},{id:2,tags:'animated dog'},{id:1,tags:'animated cat dog'}].map(p=>({...p,file_url:`https://media.booru.test/${p.id}.svg`,preview_url:`https://media.booru.test/${p.id}.svg`,width:100,height:100}));
const requests=[];
const server=createServer(createApp({publicOrigin:'',additionalOrigins:[],upstream:async url=>{
 const u=new URL(url),query=u.searchParams.get('tags')||'';if(u.searchParams.get('limit')==='30')requests.push({host:u.hostname,query});
 const words=query.split(/\s+/);let rows=records;
 if(!/[{}~]/.test(query))rows=records.filter(p=>words.every(word=>{if(!word||word.includes(':'))return true;const terms=p.tags.split(' ');return word.startsWith('-')?!terms.includes(word.slice(1)):terms.includes(word);}));
 return new Response(JSON.stringify(rows));
}}));server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});await mkdir('build/ui',{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.addInitScript(sources=>{localStorage.setItem('bp.sources',JSON.stringify(sources));localStorage.setItem('bp.activeId','rule34');},SOURCE_TEMPLATES.map(s=>({...s,userId:s.id==='rule34'?'123':'',apiKey:s.id==='rule34'?'fixture-key':''})));
 await context.route('https://media.booru.test/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#526878"/></svg>'}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
 await page.fill('#query','animated');await page.press('#query','Enter');await page.locator('#grid .post').first().waitFor();
 await page.click('#orOpen');await page.fill('#orTags','cat\ndog');await page.screenshot({path:'build/ui/mobile-or-dialog.png'});await page.click('#orForm button[type=submit]');await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===3);assert.equal(await page.locator('.or-chip').count(),1);
 for(const [id,host,strategy]of [['rule34','api.rule34.xxx','union'],['safebooru','safebooru.org','union'],['gelbooru','gelbooru.com','curly'],['danbooru','danbooru.donmai.us','union'],['e621','e621.net','tilde']]){
  requests.length=0;await page.selectOption('#sourceSelect',id);await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===3);
  const calls=requests.filter(r=>r.host===host);assert.ok(calls.length>0,id);
  if(strategy==='union'){assert.equal(calls.length,2);assert.ok(calls.every(r=>!/[{}~|]/.test(r.query)));assert.deepEqual(calls.map(r=>r.query).sort(),['animated cat','animated dog']);}
  else assert.equal(calls[0].query,strategy==='curly'?'animated {cat ~ dog}':'animated ~cat ~dog');
 }
 const shared=page.url();assert.ok(decodeURIComponent(shared).includes('{cat+~+dog}'));
 await page.reload();await page.locator('#grid .post').first().waitFor();assert.equal(await page.locator('.or-chip').count(),1);
 await page.click('#saveCollection');await page.fill('#collectionName','Cats or dogs');await page.click('#collectionForm button[type=submit]');await page.click('#homeTab');await page.locator('.collection-card-main').filter({hasText:'Cats or dogs'}).click();await page.locator('#grid .post').first().waitFor();assert.equal(await page.locator('.or-chip').count(),1);
 await page.locator('.or-chip .tag-name').click();await page.fill('#orTags','cat\nscore:>50');const before=requests.length;await page.click('#orForm button[type=submit]');assert.equal(await page.locator('#orError').isVisible(),true);assert.equal(requests.length,before);await page.click('#orClose');
 await page.locator('.or-chip .exclude-toggle').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Ничего не найдено'));assert.equal(requests.at(-1).query,'animated -cat -dog');
 assert.deepEqual(errors,[]);await context.close();console.log('OR UI passed on all five providers: grouping, native/union requests, deduplication, URL reload, collections, validation and exclusion.');
}finally{await browser.close();server.close();}
