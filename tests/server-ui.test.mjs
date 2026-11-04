import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './dom-fixture.mjs';
test('autocomplete, included and excluded chips and search use the selected provider through same-origin POST',async t=>{
 const app=await setup({server:true,storage:{'bp.source':{name:'Rule34',kind:'gelbooru',base:'https://rule34.xxx/',userId:'123',apiKey:'test-key'}},fetcher:async url=>({ok:true,json:async()=>url==='/api/tags'?[{value:'long_hair',count:12345}]:[]})});t.after(app.cleanup);
 const{$,requests}=app;assert.equal(requests.length,0);
 $('query').value='lo';$('query').oninput();await new Promise(r=>setTimeout(r,300));
 assert.equal(requests[0].url,'/api/tags');const u=new URL(JSON.parse(requests[0].options.body).url);assert.equal(u.hostname,'api.rule34.xxx');assert.equal(u.searchParams.get('q'),'lo');
 const choices=$('suggestions').querySelectorAll('.suggestion');assert.equal(choices.length,2);choices[1].click();assert.equal($('selectedTags').children.length,1);
 $('query').value='sky';$('searchForm').onsubmit({preventDefault(){}});await app.tick();
 const post=requests.find(r=>r.url==='/api/posts');assert.equal(post.options.method,'POST');assert.equal(new URL(JSON.parse(post.options.body).url).searchParams.get('tags'),'long_hair sky');assert.ok(!post.url.includes('test-key'));
 $('selectedTags').children[0].querySelector('.exclude-toggle').click();await app.tick();assert.equal(new URL(JSON.parse(requests.at(-1).options.body).url).searchParams.get('tags'),'-long_hair sky');
 $('selectedTags').children[0].querySelector('.tag-name').click();await app.tick();assert.equal(new URL(JSON.parse(requests.at(-1).options.body).url).searchParams.get('tags'),'sky');
});
test('optional media relay routes Gelbooru feed and viewer while stored favorites retain original URLs',async t=>{
 const media='https://img4.gelbooru.com/images/ab/cd/example.jpg';
 const app=await setup({server:true,storage:{'bp.source':{name:'Gelbooru',kind:'gelbooru',base:'https://gelbooru.com/'},'bp.mediaRelay':{gelbooru:true}},fetcher:async()=>({ok:true,json:async()=>[{id:1,file_url:media,preview_url:media,width:100,height:100,tags:'sky'}]})});t.after(app.cleanup);
 const{$}=app;$('searchForm').onsubmit({preventDefault(){}});await app.tick();
 assert.equal($('grid').querySelector('img').src,'/media?url='+encodeURIComponent(media));
 $('grid').querySelector('.post-footer').children[0].click();assert.equal(JSON.parse(app.memory.get('bp.saved'))[0].file,media);
});
