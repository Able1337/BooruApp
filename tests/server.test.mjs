import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {checkedTarget,createApp} from '../server/server.mjs';
const target='https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&pid=0&limit=30&tags=';
test('server proxy only accepts bounded post-list requests to supported HTTPS APIs',()=>{
 assert.equal(checkedTarget(target),target);
 for(const url of [target.replace('safebooru.org','127.0.0.1'),target.replace('https:','http:'),target+'&url=https://example.org',target+'&limit=1',target.replace('limit=30','limit=10000'),target.replace('q=index','q=delete'),target.replace('/index.php','/admin'),target.replace('safebooru.org','safebooru.org.attacker.test')])assert.throws(()=>checkedTarget(url));
});
test('same-origin server API, static mode, upstream failures and credential privacy',async t=>{
 let requests=[];let result=new Response(JSON.stringify([{id:1}]),{headers:{'Content-Type':'application/json'}});
 const server=http.createServer(createApp({publicOrigin:'https://frank.eben-grad.ru',additionalOrigins:['https://109.120.140.198'],upstream:async(url,options)=>{requests.push({url,options});return result;}}));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=(url=target,origin='https://frank.eben-grad.ru')=>fetch(base+'/api/posts',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({url})});
 assert.equal((await fetch(base+'/')).status,200);
 assert.match(await(await fetch(base+'/')).text(),/name="booru-api" content="same-origin"/);
 assert.equal((await fetch(base+'/.git/config')).status,404);
 assert.equal((await post(target,'https://evil.example')).status,403);assert.equal(requests.length,0);
 assert.equal((await post(target.replace('safebooru.org','localhost'))).status,400);assert.equal(requests.length,0);
 const ok=await post();assert.equal(ok.status,200);assert.deepEqual(await ok.json(),[{id:1}]);
 assert.equal(requests[0].options.redirect,'error');assert.equal(ok.headers.get('cache-control'),'no-store');
 result=new Response('[]');
 assert.equal((await post(target,'https://109.120.140.198')).status,200);
 assert.equal((await post(target,'https://109.120.140.198.attacker.example')).status,403);
 result=new Response('secret-api-key',{status:403});
 const error=await post();assert.equal(error.status,502);assert.doesNotMatch(await error.text(),/secret-api-key/);
 result=new Response('<html>challenge secret-api-key</html>');
 const html=await post();assert.equal(html.status,502);assert.doesNotMatch(await html.text(),/secret-api-key/);
});
test('post and autocomplete allowlists cover all presets without exposing other endpoints',async()=>{
 const {SOURCE_TEMPLATES,makeSuggestionsRequest,makeRequest}=await import('../web/core.mjs');
 for(const s of SOURCE_TEMPLATES){const source={...s,userId:'123',login:s.kind==='gelbooru'?'':'test_user',apiKey:'test-key'};assert.ok(checkedTarget(makeRequest(source,'landscape',0)));const suggestions=makeSuggestionsRequest(source,'land');assert.ok(checkedTarget(suggestions,'tags'));assert.throws(()=>checkedTarget(suggestions,'posts'));assert.throws(()=>checkedTarget(suggestions.replace('https:','http:'),'tags'));}
 assert.throws(()=>checkedTarget('https://api.rule34.xxx/autocomplete.php?q=land&url=https://evil.example','tags'));
 assert.throws(()=>checkedTarget('https://e621.net/tags/autocomplete.json?search[name_matches]=x&limit=10000','tags'));
});
test('tag route and e621 authentication use bounded server requests without putting login in upstream URL',async t=>{
 let called;
 const server=http.createServer(createApp({publicOrigin:'https://frank.eben-grad.ru',upstream:async(url,options)=>{called={url,options};return new Response('[]');}}));server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(base+'/api/tags',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://frank.eben-grad.ru'},body:JSON.stringify({url:'https://e621.net/tags/autocomplete.json?search[name_matches]=sky&limit=10&login=me&api_key=private-test'})});
 assert.equal(response.status,200);assert.ok(!called.url.includes('private-test'));assert.ok(!called.url.includes('login='));assert.equal(called.options.headers.Authorization,'Basic '+Buffer.from('me:private-test').toString('base64'));
});
test('PWA manifest, service worker and real PNG icons are served with correct types',async t=>{
 const server=http.createServer(createApp());server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(base+'/manifest.webmanifest');assert.match(response.headers.get('content-type'),/application\/manifest\+json/);const manifest=await response.json();assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'/');assert.equal(manifest.icons.length,2);
 for(const icon of manifest.icons){const r=await fetch(base+icon.src);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),Number(icon.sizes.split('x')[0]));}
 const sw=await fetch(base+'/sw.js');assert.equal(sw.status,200);assert.match(sw.headers.get('content-type'),/javascript/);assert.equal(sw.headers.get('cache-control'),'no-store');
});
