// Real pointer/keyboard pagination at the bottom, with neutral variable-size media.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createApp} from '../server/server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const server=createServer(createApp({upstream:async url=>{
 const u=new URL(url),index=+(u.searchParams.get('pid')||0),limit=+(u.searchParams.get('limit')||30);
 if(limit===1||u.searchParams.get('s')==='tag')return new Response('[]');
 await delay(200);
 return new Response(JSON.stringify(index>2?[]:Array.from({length:30},(_,i)=>({id:1000-index*30-i,file_url:`https://media.booru.test/${i}.svg`,preview_url:`https://media.booru.test/${i}.svg`,width:800,height:650+(i%4)*210,tags:'landscape',score:i}))));
}}));server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const width of [390,1280])for(const view of ['list','grid']){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:width<600,hasTouch:width<600});
  await context.addInitScript(view=>{localStorage.setItem('bp.view',JSON.stringify(view));const IO=IntersectionObserver;window.IntersectionObserver=class extends IO{observe(target){if(target.id!=='sentinel')super.observe(target);}};},view);
  await context.route('https://media.booru.test/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#43657a"/></svg>'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.click('#feedTab');await page.waitForFunction(()=>document.querySelectorAll('#grid .post').length===30);

  for(const [count,method]of [[60,'pointer'],[90,'keyboard']]){
   await page.locator('#more').scrollIntoViewIfNeeded();await page.waitForTimeout(500);if(method==='keyboard')await page.focus('#more');
   await page.evaluate(method=>{document.getElementById('more').addEventListener(method==='pointer'?'pointerdown':'keydown',()=>{
     const cards=[...document.querySelectorAll('#grid .post')].filter(n=>{const r=n.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;});
     window.paginationVisible=cards.map(n=>({key:n.dataset.postKey,top:n.getBoundingClientRect().top,left:n.getBoundingClientRect().left}));
     window.paginationBefore={...window.paginationVisible[0],y:scrollY};
   },{once:true,capture:true});},method);
   if(method==='pointer')await page.click('#more');else{await page.focus('#more');await page.press('#more','Enter');}
   const {before,visible}=await page.evaluate(()=>({before:window.paginationBefore,visible:window.paginationVisible}));
   await page.waitForFunction(count=>document.querySelectorAll('#grid .post').length===count,count);await page.waitForTimeout(800);
   const after=await page.evaluate(key=>{const card=[...document.querySelectorAll('#grid .post')].find(n=>n.dataset.postKey===key);return{top:card?.getBoundingClientRect().top,y:scrollY};},before.key);
   const shifts=await page.evaluate(visible=>visible.map(p=>{const card=[...document.querySelectorAll('#grid .post')].find(n=>n.dataset.postKey===p.key),r=card.getBoundingClientRect();return Math.max(Math.abs(r.top-p.top),Math.abs(r.left-p.left));}),visible);results.push({width,view,method,count,before,after,delta:after.top-before.top,maxCardShift:Math.max(...shifts)});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 await mkdir('build/ui',{recursive:true});await writeFile('build/ui/pagination-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 assert.ok(results.every(r=>Math.abs(r.delta)<5&&r.maxCardShift<5),'Pagination moved the visible post; see pagination-results.json');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
