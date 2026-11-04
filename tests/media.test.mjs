import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mediaTarget,mediaUrl,parseTags,searchTags} from '../web/core.mjs';
import {createApp} from '../server/server.mjs';
const gel='https://img4.gelbooru.com/images/03/94/03943500cce9c87959f382e0ed3c969c.webm';
const e621='https://static1.e621.net/data/preview/9c/cd/9ccd0abe04536e2ea2d30670e703b0f3.jpg';
test('media allowlist rejects arbitrary hosts, credentials, queries and nonmedia paths',()=>{
 assert.equal(mediaTarget(gel).provider,'gelbooru');assert.equal(mediaTarget(e621).provider,'e621');
 for(const url of [gel.replace('img4.gelbooru.com','localhost'),gel.replace('img4.gelbooru.com','img4.gelbooru.com.evil.test'),gel.replace('https:','http:'),gel+'?key=secret',gel+'#hash',gel.replace('https://','https://user:pass@'),gel.replace('/images/','/admin/'),gel.replace('.webm','.html'),gel.replace('03/94/','../../'),gel.replace('img4.','127.0.0.1.')])assert.equal(mediaTarget(url),null,url);
 assert.equal(mediaUrl(gel,{}),gel);assert.equal(mediaUrl(e621,{gelbooru:true}),e621);assert.equal(mediaUrl(gel,{gelbooru:true}),'/media?url='+encodeURIComponent(gel));
 assert.equal(mediaUrl('https://cdn.example.org/a.jpg',{gelbooru:true,e621:true}),'https://cdn.example.org/a.jpg');
});
test('reserved search filters are case insensitive including restored chip objects',()=>{
 assert.deepEqual(parseTags('Score:>50 SORT:Score:DESC Character_Name'),[{value:'score:>50',excluded:false},{value:'sort:score:desc',excluded:false},{value:'Character_Name',excluded:false}]);
 assert.equal(searchTags({kind:'gelbooru'},[{value:'Score:>50'},{value:'Sort:Score:DESC'}]),'score:>50 sort:score:desc');
});
test('relay streams bounded media, preserves range, supplies source referer and rejects HTML',async t=>{
 let calls=[],mode='ok';
 const server=http.createServer(createApp({publicOrigin:'https://site.test',upstream:async(url,options)=>{calls.push({url,options});return mode==='html'?new Response('<html>secret</html>',{headers:{'Content-Type':'text/html'}}):mode==='large'?new Response('',{headers:{'Content-Type':'image/jpeg','Content-Length':String(1024**3)}}):new Response(options.method==='HEAD'?null:'abc',{status:options.headers.Range?206:200,headers:{'Content-Type':'video/webm','Content-Length':'3','Accept-Ranges':'bytes',...(options.headers.Range?{'Content-Range':'bytes 0-2/10'}:{})}});}}));
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}/media?url=`;
 let response=await fetch(base+encodeURIComponent(gel),{headers:{Range:'bytes=0-2'}});
 assert.equal(response.status,206);assert.equal(await response.text(),'abc');assert.equal(response.headers.get('content-range'),'bytes 0-2/10');
 assert.equal(calls[0].options.headers.Referer,'https://gelbooru.com/');assert.equal(calls[0].options.headers.Range,'bytes=0-2');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.Authorization,undefined);
 response=await fetch(base+encodeURIComponent(e621),{method:'HEAD'});assert.equal(response.status,200);assert.equal(await response.text(),'');assert.equal(calls.at(-1).options.headers.Referer,'https://e621.net/');
 const count=calls.length;
 assert.equal((await fetch(base+encodeURIComponent(gel),{headers:{Origin:'https://evil.test'}})).status,403);
 assert.equal((await fetch(base+encodeURIComponent(gel),{headers:{Range:'bytes=0-2,5-6'}})).status,400);
 assert.equal((await fetch(base+encodeURIComponent('https://localhost/a.jpg'))).status,400);assert.equal(calls.length,count);
 mode='html';response=await fetch(base+encodeURIComponent(gel));assert.equal(response.status,502);assert.doesNotMatch(await response.text(),/secret/);
 mode='large';assert.equal((await fetch(base+encodeURIComponent(gel))).status,502);
});
