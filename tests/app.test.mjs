import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './dom-fixture.mjs';
const legacy={name:'My Rule34',base:'https://rule34.xxx/',kind:'gelbooru',userId:'123',apiKey:'private-test'};
test('migrates legacy credentials and adds a second prefilled provider without replacing the first',async t=>{
 const app=await setup({storage:{'bp.source':legacy}});t.after(app.cleanup);const{$,memory}=app;
 assert.equal(app.requests.length,0);assert.equal($('homeView').hidden,false);
 const initial=JSON.parse(memory.get('bp.sources'));assert.equal(initial[0].apiKey,'private-test');
 $('addSource').click();assert.equal($('sourceBase').value,'https://rule34.xxx/');
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
 $('collectionCards').children[0].querySelector('.collection-card-main').click();await app.tick();
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
