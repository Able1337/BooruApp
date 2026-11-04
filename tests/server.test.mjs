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
 const server=http.createServer(createApp({publicOrigin:'https://frank.eben-grad.ru',upstream:async(url,options)=>{requests.push({url,options});return result;}}));
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
 result=new Response('secret-api-key',{status:403});
 const error=await post();assert.equal(error.status,502);assert.doesNotMatch(await error.text(),/secret-api-key/);
 result=new Response('<html>challenge secret-api-key</html>');
 const html=await post();assert.equal(html.status,502);assert.doesNotMatch(await html.text(),/secret-api-key/);
});
