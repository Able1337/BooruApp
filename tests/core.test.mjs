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
test('e621 nested media, tag categories and score normalize without losing source data',()=>{
 const s={name:'e621',base:'https://e621.net/',kind:'e621',id:'e6'};
 const [p]=normalizePosts({posts:[{id:7,file:{url:'https://static.example/a.webm',ext:'webm',width:900,height:600},preview:{url:'https://static.example/p.jpg'},sample:{url:'https://static.example/s.jpg'},score:{total:42},tags:{artist:['artist_name'],character:['character_name'],species:['cat'],general:['sky']}}]},s);
 assert.equal(p.video,true);assert.equal(p.width,900);assert.equal(p.score,42);assert.equal(p.sourceId,'e6');assert.deepEqual(p.tagGroups.species,['cat']);assert.deepEqual(p.tagGroups.artist,['artist_name']);assert.ok(p.tags.includes('sky'));
});
test('Danbooru categories and DAPI tag_info preserve groups with a general fallback',()=>{
 const row={id:1,file_url:'https://example.org/a.jpg',tag_string:'artist_a char_a world_a sky',tag_string_artist:'artist_a',tag_string_character:'char_a',tag_string_copyright:'world_a'};
 const [p]=normalizePosts([row],{...gel,kind:'danbooru'});assert.deepEqual(p.tagGroups.artist,['artist_a']);assert.deepEqual(p.tagGroups.general,['sky']);
 const [dapi]=normalizePosts([{...row,tag_string_artist:'',tag_string_character:'',tag_string_copyright:'',tag_info:{artist_a:{type:1},char_a:4,world_a:[3,123]}}],gel);
 assert.deepEqual(dapi.tagGroups.artist,['artist_a']);assert.deepEqual(dapi.tagGroups.character,['char_a']);assert.deepEqual(dapi.tagGroups.copyright,['world_a']);assert.deepEqual(dapi.tagGroups.general,['sky']);
});
test('source migration, collections and tag changes retain data and exclude tags predictably',async()=>{
 const {sanitizeSources,sanitizeCollections,parseTags,tagsQuery,mergeTags,searchTags}=await import('../web/core.mjs');
 const old={...gel,apiKey:'keep-me'};const rows=sanitizeSources(null,old);assert.equal(rows[0].apiKey,'keep-me');
 assert.equal(sanitizeSources([{id:'unsafe',name:'Bad',base:'javascript:alert(1)',kind:'gelbooru'}])[0].name,'Safebooru');
 const tags=mergeTags(parseTags('sky city'),parseTags('-city'));assert.equal(tagsQuery(tags),'sky -city');assert.equal(searchTags({...gel,kind:'e621'},tags,'score'),'sky -city order:score');
 const c=sanitizeCollections([{id:'x',name:'View',query:'sky -city',cover:'javascript:alert(1)'}])[0];assert.equal(c.cover,'');assert.equal(c.query,'sky -city');
});
test('suggestion adapters encode prefixes, keep credentials and accept provider response shapes',async()=>{
 const {makeSuggestionsRequest,normalizeSuggestions}=await import('../web/core.mjs');
 const rule={...gel,base:'https://rule34.xxx/',userId:'12',apiKey:'test'};
 const u=new URL(makeSuggestionsRequest(rule,'long_h'));assert.equal(u.pathname,'/autocomplete.php');assert.equal(u.searchParams.get('q'),'long_h');assert.equal(u.searchParams.get('api_key'),'test');
 const dan=new URL(makeSuggestionsRequest({...gel,kind:'danbooru'},'blue'));assert.equal(dan.searchParams.get('search[name_matches]'),'blue*');
 assert.deepEqual(normalizeSuggestions([{value:'long_hair',count:30},{name:'sky',post_count:20}]),[{name:'long_hair',count:30},{name:'sky',count:20}]);
});
test('explicit sort/order tags override default sorting and score filters are preserved',async()=>{
 const {searchTags,parseTags,metaSuggestions}=await import('../web/core.mjs');
 assert.equal(searchTags(gel,parseTags('city score:>100 sort:score:desc'),'new'),'city score:>100 sort:score:desc');
 assert.equal(searchTags({...gel,kind:'e621'},parseTags('sky sort:score:desc'),'new'),'sky order:score');
 assert.equal(searchTags(gel,parseTags('sky order:score_asc'),'random'),'sky sort:score:asc');
 assert.equal(searchTags({...gel,kind:'danbooru'},parseTags('score:>=50'),'old'),'score:>=50 order:id_asc');
 assert.ok(metaSuggestions(gel,'score').some(x=>x.name==='score:>100'));assert.ok(metaSuggestions(gel,'sort').some(x=>x.name==='sort:score:desc'));
});
test('DAPI XML autocomplete is parsed without evaluating external entities',async()=>{
 const {parseTagPayload,normalizeSuggestions}=await import('../web/core.mjs');
 const xml='<?xml version="1.0"?><tags type="array"><tag name="landscape" count="123" type="0"/><tag name="artist_a" count="5" type="1"/></tags>';
 assert.deepEqual(normalizeSuggestions(parseTagPayload(xml)),[{name:'landscape',count:123},{name:'artist_a',count:5}]);
 assert.deepEqual(parseTagPayload('<tags type="array"/>'),[]);assert.throws(()=>parseTagPayload('<html>challenge</html>'));
});
test('a newly selected sort filter replaces the previous sort or order filter',async()=>{
 const {parseTags,mergeTags,tagsQuery}=await import('../web/core.mjs');
 assert.equal(tagsQuery(mergeTags(parseTags('sky sort:score:desc'),parseTags('order:random'))),'sky order:random');
 assert.equal(tagsQuery(parseTags('sky sort:score:desc sort:random')),'sky sort:random');
});
test('Rule34 template displays API host while post links stay on the main site',async()=>{
 const {SOURCE_TEMPLATES,sourceTemplate}=await import('../web/core.mjs');
 const template=SOURCE_TEMPLATES.find(s=>s.id==='rule34');assert.equal(template.base,'https://api.rule34.xxx/');
 for(const base of ['https://rule34.xxx/','https://www.rule34.xxx/','https://api.rule34.xxx/']){
  assert.equal(sourceTemplate({base}).id,'rule34');
  const [post]=normalizePosts([{id:123,file_url:'https://cdn.example.org/test.jpg'}],{...template,base});assert.equal(new URL(post.page).hostname,'rule34.xxx');
 }
});
test('collections are grouped by their own booru with common and missing sources kept separate',async()=>{
 const {groupCollectionsBySource}=await import('../web/core.mjs');
 const sources=[{id:'safe',name:'Safebooru'},{id:'rule',name:'Rule34'}];
 const rows=[{id:'a',sourceId:'rule'},{id:'b',sourceId:'*'},{id:'c',sourceId:'safe'},{id:'d',sourceId:'removed'}];
 const groups=groupCollectionsBySource(rows,sources);
 assert.deepEqual(groups.map(g=>g.id),['safe','rule','*',null]);assert.deepEqual(groups.map(g=>g.items[0].id),['c','a','b','d']);
});
test('route links preserve the public search state and omit credentials and unknown fields',async()=>{
 const {encodeRoute,decodeRoute}=await import('../web/core.mjs');
 const route=encodeRoute({page:'feed',booru:'gelbooru',tags:'sky -night Score:>50',sort:'score',view:'grid',collection:'my-collection',apiKey:'private-secret',login:'private-user'});
 assert.doesNotMatch(route,/private|apiKey|login/);
 assert.deepEqual(decodeRoute(route),{page:'feed',booru:'gelbooru',tags:'sky -night score:>50',sort:'score',view:'grid',collection:'my-collection'});
 assert.deepEqual(decodeRoute('#evil?api_key=secret'),{page:'home'});assert.equal(encodeRoute({page:'home',tags:'sky'}),'#home');
 assert.equal(decodeRoute('#feed?sort=bad&view=bad&tags=sky').sort,'new');
});
test('search changes push history while layout-only changes replace the current entry',async()=>{
 const {encodeRoute,routeHistoryMode}=await import('../web/core.mjs');
 const search=encodeRoute({page:'feed',booru:'gelbooru',tags:'sky'});
 assert.equal(routeHistoryMode('#home',search),'pushState');
 for(const next of [{tags:'sky night'},{tags:'-sky'},{booru:'e621'},{sort:'score'},{page:'home'}])assert.equal(routeHistoryMode(search,encodeRoute({page:'feed',booru:'gelbooru',tags:'sky',...next})),'pushState');
 assert.equal(routeHistoryMode(search,encodeRoute({page:'feed',booru:'gelbooru',tags:'sky',view:'grid'})),'replaceState');
 assert.equal(routeHistoryMode(search,search),'replaceState');
});
