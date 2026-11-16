import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTags,tagsQuery,searchTags,validateOrTags,matchesTags,createSearchPager,SOURCE_TEMPLATES,encodeRoute,decodeRoute,sanitizeCollections} from '../web/core.mjs';
const source=id=>({...SOURCE_TEMPLATES.find(s=>s.id===id),userId:'123',apiKey:'fixture-key'});
const row=(id,score=0)=>({id,file_url:`https://example.org/${id}.png`,preview_url:`https://example.org/${id}.png`,tags:'animated cat dog',score});
test('OR shortcuts, braces and tilde lists round-trip as one editable group',()=>{
 for(const text of ['animated cat~dog -comic','animated cat|dog -comic','animated {cat ~ dog} -comic','animated ~cat ~dog -comic']){
  const tags=parseTags(text);assert.equal(tags.filter(t=>t.any).length,1);assert.deepEqual(tags.find(t=>t.any).any,['cat','dog']);validateOrTags(tags);
  assert.deepEqual(parseTags(tagsQuery(tags)),tags);
 }
 const query='animated {cat ~ dog} -comic';assert.equal(tagsQuery(parseTags(query)),query);
 const link=encodeRoute({page:'feed',booru:'rule34',tags:query});assert.equal(decodeRoute(link).tags,query);assert.equal(sanitizeCollections([{id:'or',name:'Either',query}])[0].query,query);
});
test('native OR serialization is source-specific; excluding a group excludes every member',()=>{
 const tags=parseTags('animated {cat ~ dog} -comic');
 assert.equal(searchTags(source('gelbooru'),tags),'animated {cat ~ dog} -comic');
 for(const id of ['danbooru','e621'])assert.equal(searchTags(source(id),tags),'animated ~cat ~dog -comic');
 for(const id of ['rule34','safebooru','gelbooru','danbooru','e621'])assert.equal(searchTags(source(id),parseTags('animated -{cat ~ dog}')),'animated -cat -dog');
 assert.ok(matchesTags({tags:['animated','cat']},tags));assert.ok(!matchesTags({tags:['animated']},tags));assert.ok(!matchesTags({tags:['animated','dog','comic']},tags));assert.ok(!matchesTags({tags:['cat']},parseTags('-{cat ~ dog}')));
});
test('invalid groups fail before making API requests',()=>{
 for(const query of ['{cat}','{a ~ b ~ c ~ d ~ e}','{score:>50 ~ cat}','{cat ~ dog} {red ~ blue}','cat ~ dog','{cat ~ dog'])assert.throws(()=>validateOrTags(parseTags(query)));
 let calls=0;assert.throws(()=>createSearchPager(source('rule34'),parseTags('{rating:safe ~ cat}'),'new',async()=>{calls++;return [];}));assert.equal(calls,0);
});
test('Rule34 and Safebooru merge branch pages in order, without duplicates or skipped posts',async()=>{
 for(const id of ['rule34','safebooru','danbooru']){
  const calls=[];const pager=createSearchPager(source(id),parseTags('animated {cat ~ dog} -comic'),'new',async(query,page,limit)=>{calls.push({query,page,limit});assert.ok(!/[{}~|]/.test(query));assert.match(query,/animated/);assert.match(query,/-comic/);const pages=query.includes('cat')?[[row(10),row(8)],[row(6)]]:[[row(9),row(8)],[row(7),row(5)]];return pages[page]||[];},{pageSize:2});
  const first=await pager.next(3),second=await pager.next(3),last=await pager.next(3);assert.deepEqual([...first.items,...second.items].map(p=>p.id),['10','9','8','7','6','5']);assert.equal(last.done,true);assert.equal(last.items.length,0);assert.ok(calls.some(c=>c.page===1));
 }
});
test('union honors score ordering, and retries do not consume partially fetched results',async()=>{
 let fail=true;
 const pager=createSearchPager(source('safebooru'),parseTags('{cat ~ dog}'),'score',async query=>{assert.match(query,/sort:score:desc/);if(query.includes('dog')&&fail){fail=false;throw new Error('temporary');}return query.includes('cat')?[row(1,100)]:[row(9,10)];},{pageSize:2});
 await assert.rejects(pager.next(),/temporary/);const result=await pager.next();assert.deepEqual(result.items.map(p=>p.id),['1','9']);assert.equal(result.done,true);
});
test('native sources make one OR request and preserve raw pagination counts when media is missing',async()=>{
 for(const id of ['gelbooru','danbooru','e621']){let calls=0;const pager=createSearchPager(source(id),parseTags('{cat ~ dog}'),'new',async()=>{calls++;return calls===1?[row(2),{id:1}]:[];},{pageSize:2});const first=await pager.next();assert.equal(calls,1);assert.equal(first.items.length,1);assert.equal(first.done,false);assert.equal((await pager.next()).done,true);}
});
test('four-way fallback bounds concurrent API calls and canonicalizes option order',async()=>{
 const {setTimeout:delay}=await import('node:timers/promises');let active=0,peak=0,calls=0;
 const pager=createSearchPager(source('rule34'),parseTags('{dog ~ bird ~ cat ~ fish}'),'new',async()=>{calls++;active++;peak=Math.max(peak,active);await delay(1);active--;return [];});
 assert.equal((await pager.next()).done,true);assert.equal(calls,4);assert.equal(peak,2);
 assert.deepEqual(parseTags('dog|cat'),parseTags('cat~dog'));
});
