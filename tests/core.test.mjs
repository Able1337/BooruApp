import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRequest,normalizePosts,httpsUrl} from '../web/core.mjs';
const gel={name:'Test',base:'https://example.org/',kind:'gelbooru'};
test('DAPI uses zero-based pages and safely encodes tags and credentials',()=>{
 const u=new URL(makeRequest({...gel,apiKey:'a&b',userId:'12'},'city sky',2));
 assert.equal(u.searchParams.get('pid'),'2');assert.equal(u.searchParams.get('tags'),'city sky');assert.equal(u.searchParams.get('api_key'),'a&b');
});
test('Danbooru uses one-based pages',()=>{const u=new URL(makeRequest({...gel,kind:'danbooru'},'',0));assert.equal(u.pathname,'/posts.json');assert.equal(u.searchParams.get('page'),'1');});
test('normalizes array and wrapped DAPI responses',()=>{const row={id:42,file_url:'//cdn.example.org/a.webm',preview_url:'https://cdn.example.org/p.jpg',tags:'one two',width:300,height:500};for(const data of [[row],{post:[row]}]){const[p]=normalizePosts(data,gel);assert.equal(p.video,true);assert.equal(p.file,'https://cdn.example.org/a.webm');assert.deepEqual(p.tags,['one','two']);}});
test('normalizes Danbooru field names',()=>{const[p]=normalizePosts([{id:1,file_url:'https://example.org/1.png',preview_file_url:'https://example.org/p.png',tag_string:'city',image_width:640,image_height:480}],{...gel,kind:'danbooru'});assert.equal(p.width,640);assert.equal(p.page,'https://example.org/posts/1');});
test('rejects unsafe links and malformed responses',()=>{assert.equal(httpsUrl('javascript:alert(1)'), '');assert.equal(httpsUrl('https://user:pass@example.org'), '');assert.throws(()=>normalizePosts({error:'bad'},gel));assert.deepEqual(normalizePosts([{id:2,file_url:'javascript:alert(1)',preview_url:'https://example.org/x'}],gel),[]);});
test('missing media never becomes a URL pointing at the source document',()=>{
 for(const value of [undefined,null,'', '   ',42])assert.equal(httpsUrl(value,gel.base),'');
 assert.deepEqual(normalizePosts([null,{}, {id:1}, {id:2,preview_url:'/p.jpg'}],gel),[]);
});
test('pagination counts raw rows even when unavailable posts are filtered',async()=>{
 const {postRows}=await import('../web/core.mjs');
 const payload=Array.from({length:30},(_,id)=>({id}));
 assert.equal(postRows({posts:payload}).length,30);
 assert.equal(normalizePosts(payload,gel).length,0);
});
test('favorites reject unsafe stored media and sanitize sample URLs',async()=>{
 const {sanitizeFavorites}=await import('../web/core.mjs');
 const p={key:'test#1',id:'1',file:'https://example.org/a.jpg',preview:'https://example.org/p.jpg',sample:'javascript:alert(1)',tags:['city']};
 assert.equal(sanitizeFavorites([p,p]).length,1);
 assert.equal(sanitizeFavorites([p])[0].sample,p.file);
 assert.deepEqual(sanitizeFavorites([{...p,file:'javascript:alert(1)'},null]),[]);
 assert.throws(()=>sanitizeFavorites({}));
});
test('Rule34 DAPI uses API host while preserving source identity and escaped credentials',()=>{
 for(const base of ['https://rule34.xxx/','https://www.rule34.xxx/','https://api.rule34.xxx/']){
  const source={...gel,base,userId:'123',apiKey:'test&key'};
  const u=new URL(makeRequest(source,'landscape',0));
  assert.equal(u.hostname,'api.rule34.xxx');assert.equal(u.pathname,'/index.php');
  assert.equal(u.searchParams.get('api_key'),'test&key');assert.equal(u.searchParams.get('user_id'),'123');
  assert.equal(source.base,base);
 }
 const regular=new URL(makeRequest({...gel,base:'https://rule34.xxx.example.org/'},'',0));
 assert.equal(regular.hostname,'rule34.xxx.example.org');
});
test('API errors explain authentication and rate limits without leaking server text',async()=>{
 const {postRows}=await import('../web/core.mjs');
 for(const payload of [{error:'Invalid API key SECRET'}, {message:'Missing authentication SECRET'}, {'@attributes':{reason:'Invalid user_id SECRET'}}]){
  assert.throws(()=>postRows(payload),e=>/авторизацию/.test(e.message)&&!e.message.includes('SECRET'));
 }
 assert.throws(()=>postRows({error:'Rate limit exceeded SECRET'}),/лимит/);
 assert.throws(()=>postRows({success:false,message:'unknown SECRET'}),e=>!e.message.includes('SECRET'));
});
test('Rule34 requires separate credentials and rejects pasted URL parameters',()=>{
 const source={...gel,base:'https://api.rule34.xxx/'};
 assert.throws(()=>makeRequest(source,'',0),/User ID/);
 assert.throws(()=>makeRequest({...source,userId:'12',apiKey:'&api_key=SECRET&user_id=12'},'',0),/только значения/);
});
