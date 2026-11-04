import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './dom-fixture.mjs';
const legacy={name:'My Rule34',base:'https://rule34.xxx/',kind:'gelbooru',userId:'123',apiKey:'private-test'};
test('migrates legacy credentials and adds a second prefilled provider without replacing the first',async t=>{
 const app=await setup({storage:{'bp.source':legacy}});t.after(app.cleanup);const{$,memory}=app;
 assert.equal(app.requests.length,0);assert.equal($('homeView').hidden,false);
 const initial=JSON.parse(memory.get('bp.sources'));assert.equal(initial[0].apiKey,'private-test');
 $('addSource').click();assert.equal($('sourceBase').value,'https://api.rule34.xxx/');
 $('sourceTemplates').children.find(n=>n.dataset.template==='e621').click();
 assert.equal($('sourceBase').value,'https://e621.net/');assert.equal($('sourceKind').value,'e621');
 $('sourceForm').onsubmit({preventDefault(){}});
 const sources=JSON.parse(memory.get('bp.sources'));assert.equal(sources.length,2);assert.equal(sources[0].apiKey,'private-test');assert.equal(sources[1].base,'https://e621.net/');
 assert.equal($('sourceSelect').children.length,2);
});
test('native requests reject stale searches; viewer, saved posts and both layouts remain usable',async t=>{
 const app=await setup();t.after(app.cleanup);const{$,memory,listeners}=app;const sent=[];const port={postMessage:s=>sent.push(JSON.parse(s))};
 listeners.message({data:'booru-native-v1',ports:[port]});$('feedTab').click();assert.equal(sent.length,1);
 const first=sent[0];$('query').value='city';$('searchForm').onsubmit({preventDefault(){}});const second=sent[1];
 const reply=(req,rows)=>port.onmessage({data:JSON.stringify({id:req.id,body:JSON.stringify(rows)})});
 reply(first,[{id:99,file_url:'https://example.org/old.jpg'}]);reply(second,[{id:1,file_url:'https://example.org/a.webm',preview_url:'https://example.org/p.jpg',tags:'city'}]);await app.tick();
 assert.equal(app.requests.length,0);assert.equal($('grid').children.length,1);
 assert.equal($('grid').querySelector('.view-label'),null);assert.ok($('grid').querySelector('video'));$('gridView').click();$('grid').querySelector('.view-label').click();assert.equal($('viewer').open,true);const video=$('media').children[0];assert.equal(video.tag,'video');
 $('savePost').click();assert.equal(JSON.parse(memory.get('bp.saved')).length,1);$('closeViewer').click();assert.equal(video.paused,true);
 $('gridView').click();assert.equal($('grid').className,'posts-grid');assert.equal(JSON.parse(memory.get('bp.view')),'grid');
 $('savedTab').click();$('grid').querySelector('.view-label').click();$('savePost').click();assert.equal(JSON.parse(memory.get('bp.saved')).length,0);assert.equal($('grid').children.length,0);
});
test('tag collections preserve source, excluded tags and sorting and reopen the search',async t=>{
 const app=await setup({server:true});t.after(app.cleanup);const{$,memory}=app;
 $('query').value='landscape -city';$('saveCollection').click();$('collectionName').value='Мой поиск';$('collectionSort').value='score';$('collectionForm').onsubmit({preventDefault(){}});
 const rows=JSON.parse(memory.get('bp.collections'));assert.equal(rows[0].query,'landscape -city');assert.equal(rows[0].sort,'score');
 $('collectionCards').querySelectorAll('.collection-card')[0].querySelector('.collection-card-main').click();await app.tick();
 const target=new URL(JSON.parse(app.requests.at(-1).options.body).url);assert.match(target.searchParams.get('tags'),/landscape -city sort:score:desc/);
 assert.equal($('selectedTags').children.length,2);assert.equal($('homeView').hidden,true);assert.equal($('feedView').hidden,false);
});
test('library export omits API keys and legacy favorites JSON still imports',async t=>{
 const app=await setup({storage:{'bp.source':legacy}});t.after(app.cleanup);const{$,memory}=app;
 $('exportSaved').click();const backup=JSON.parse(await app.files[0].text());assert.equal(backup.version,2);assert.ok(!JSON.stringify(backup).includes('private-test'));
 const valid={id:'1',key:'example#1',file:'https://example.org/f.jpg',preview:'https://example.org/p.jpg',tags:['city']};
 await $('importSaved').onchange({target:{files:[{size:500,text:async()=>JSON.stringify([valid,{...valid,key:'evil',file:'javascript:alert(1)'}])}],value:'fake'}});
 assert.equal(JSON.parse(memory.get('bp.saved')).length,1);
});
test('collection covers load the first result for each exact query and source with bounded concurrency',async t=>{
 const {setTimeout:delay}=await import('node:timers/promises');let active=0,maxActive=0;
 const app=await setup({server:true,storage:{'bp.sources':[{id:'safe',name:'Safe',base:'https://safebooru.org/',kind:'gelbooru'},{id:'dan',name:'Dan',base:'https://danbooru.donmai.us/',kind:'danbooru'}],'bp.activeId':'safe','bp.collections':[{id:'a',name:'Landscape',query:'landscape',sourceId:'*',sort:'new'},{id:'b',name:'City',query:'city',sourceId:'*',sort:'score'},{id:'c',name:'Same query',query:'landscape',sourceId:'*',sort:'new'},{id:'d',name:'Night',query:'night',sourceId:'dan',sort:'new'}]},fetcher:async(url,options)=>{
   const target=new URL(JSON.parse(options.body).url);assert.equal(target.searchParams.get('limit'),'1');active++;maxActive=Math.max(maxActive,active);await delay(5);active--;
   const tag=target.searchParams.get('tags').split(' ')[0];return{ok:true,json:async()=>[{id:1,file_url:'https://example.org/'+tag+'.jpg',preview_url:'https://example.org/'+tag+'-preview.jpg',tags:tag}]};
 }});t.after(app.cleanup);app.intersectCollections();await delay(60);
 assert.equal(app.requests.length,3);assert.equal(maxActive,2);
 const cards=app.$('collectionCards').querySelectorAll('.collection-card');
 assert.equal(cards.find(n=>n.dataset.collectionId==='a').querySelector('.card-cover').src,'https://example.org/landscape-preview.jpg');assert.equal(cards.find(n=>n.dataset.collectionId==='b').querySelector('.card-cover').src,'https://example.org/city-preview.jpg');assert.equal(cards.find(n=>n.dataset.collectionId==='c').querySelector('.card-cover').src,'https://example.org/landscape-preview.jpg');
 const night=new URL(JSON.parse(app.requests.find(r=>JSON.parse(r.options.body).url.includes('night')).options.body).url);assert.equal(night.hostname,'danbooru.donmai.us');
 cards.find(n=>n.dataset.collectionId==='a').querySelector('.card-edit').click();app.$('collectionQuery').value='forest';app.$('collectionForm').onsubmit({preventDefault(){}});app.intersectCollections();await delay(40);
 assert.equal(app.requests.length,4);assert.equal(app.$('collectionCards').querySelectorAll('.collection-card').find(n=>n.dataset.collectionId==='a').querySelector('.card-cover').src,'https://example.org/forest-preview.jpg');
});
test('a late cover response cannot replace the cover after changing the active booru',async t=>{
 const {setTimeout:delay}=await import('node:timers/promises');
 const app=await setup({server:true,storage:{'bp.sources':[{id:'safe',name:'Safe',base:'https://safebooru.org/',kind:'gelbooru'},{id:'dan',name:'Dan',base:'https://danbooru.donmai.us/',kind:'danbooru'}],'bp.activeId':'safe','bp.collections':[{id:'a',name:'Sky',query:'sky',sourceId:'*',sort:'new'}]},fetcher:async(url,options)=>{
  const old=JSON.parse(options.body).url.includes('safebooru.org');await delay(old?40:1);const file='https://example.org/'+(old?'old':'new')+'.jpg';return{ok:true,json:async()=>[{id:1,file_url:file,preview_url:file,tags:'sky'}]};
 }});t.after(app.cleanup);app.intersectCollections();app.$('sourceSelect').value='dan';app.$('sourceSelect').onchange();app.intersectCollections();await delay(80);
 assert.equal(app.$('collectionCards').querySelectorAll('.collection-card')[0].querySelector('.card-cover').src,'https://example.org/new.jpg');
});
test('each booru section creates new collections preselected for that booru',async t=>{
 const app=await setup({storage:{'bp.sources':[{id:'safe',name:'Safe',base:'https://safebooru.org/',kind:'gelbooru'},{id:'rule',name:'Rule34',base:'https://api.rule34.xxx/',kind:'gelbooru'}],'bp.collections':[{id:'a',name:'Source query',query:'sky',sourceId:'rule',sort:'new'},{id:'b',name:'Common',query:'city',sourceId:'*',sort:'new'}]}});t.after(app.cleanup);
 const groups=app.$('collectionCards').querySelectorAll('.collection-group');assert.equal(groups.length,2);assert.equal(groups[0].dataset.sourceId,'rule');
 groups[0].querySelector('.soft-button').click();assert.equal(app.$('collectionSource').value,'rule');app.$('collectionClose').click();
 groups[1].querySelector('.soft-button').click();assert.equal(app.$('collectionSource').value,'*');
});
test('post tag clicks immediately include the tag and chips can then exclude it',async t=>{
 const app=await setup({server:true,fetcher:async()=>({ok:true,json:async()=>[{id:1,file_url:'https://example.org/sky.jpg',preview_url:'https://example.org/p.jpg',tags:'sky'}]})});t.after(app.cleanup);const{$,requests}=app;
 $('feedTab').click();await app.tick();const first=()=> $('grid').querySelector('.post-tags').children[0];
 first().click();await app.tick();assert.equal(new URL(JSON.parse(requests.at(-1).options.body).url).searchParams.get('tags'),'sky');
 $('selectedTags').children[0].querySelector('.exclude-toggle').click();await app.tick();assert.equal(new URL(JSON.parse(requests.at(-1).options.body).url).searchParams.get('tags'),'-sky');
 first().click();await app.tick();assert.equal(new URL(JSON.parse(requests.at(-1).options.body).url).searchParams.get('tags'),'sky');assert.equal($('selectedTags').children.length,1);
 $('gridView').click();$('grid').querySelector('.view-label').click();$('tags').querySelector('.post-tags').children[0].click();await app.tick();assert.equal($('viewer').open,false);assert.equal(new URL(JSON.parse(requests.at(-1).options.body).url).searchParams.get('tags'),'sky');
});
test('saved posts have separate booru sections and only individual original posts can be shared',async t=>{
 const media='https://example.org/a.jpg';const favorites=[{id:'1',key:'https://safebooru.org/#1',source:'Safebooru',file:media,preview:media,tags:['sky']},{id:'2',key:'https://e621.net/#2',source:'e621',file:media,preview:media,tags:['sky']}];
 const app=await setup({storage:{'bp.saved':favorites}});t.after(app.cleanup);const{$}=app;
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');let shared;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{share:async payload=>{shared=payload;}}});t.after(()=>{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;});
 $('savedTab').click();assert.deepEqual($('grid').querySelectorAll('.saved-group').map(n=>n.dataset.booru),['safebooru','e621']);assert.equal($('shareSearch').hidden,true);
 $('grid').querySelectorAll('.share-post')[1].click();await app.tick();assert.equal(shared.url,'https://e621.net/posts/2');assert.ok(!shared.url.includes('#saved'));
 $('gridView').click();assert.equal($('grid').querySelectorAll('.posts-grid').length,2);
});
test('related posts use the original provider and viewer favorites use the recommended post',async t=>{
 let payload=[{id:1,file_url:'https://example.org/a.png',preview_url:'https://example.org/p.png',tags:'hero sky',tag_string_character:'hero'}];
 const app=await setup({server:true,fetcher:async()=>({ok:true,json:async()=>payload})});t.after(app.cleanup);const{$}=app;
 $('feedTab').click();await app.tick();payload=[...payload,{id:2,file_url:'https://example.org/b.png',preview_url:'https://example.org/b.png',tags:'hero sky'}];
 $('grid').querySelector('.similar-post').click();for(let i=0;i<8;i++)await app.tick();
 assert.equal($('similarDialog').open,true);assert.equal($('similarGrid').children.length,1);assert.match($('similarStatus').textContent,/по тегам/);
 const related=app.requests.slice(1);assert.ok(related.length<=3);assert.ok(related.every(r=>new URL(JSON.parse(r.options.body).url).hostname==='safebooru.org'));
 $('similarGrid').children[0].click();assert.equal($('viewer').open,true);assert.match($('viewerSource').textContent,/#2/);assert.equal($('downloadPost').download,'safebooru-2.png');
 $('savePost').click();assert.equal(JSON.parse(app.memory.get('bp.saved'))[0].id,'2');
});
