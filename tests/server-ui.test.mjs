import test from 'node:test';
import assert from 'node:assert/strict';
class Element {
 constructor(){this.children=[];this.value='';this.classList={add(){},remove(){}};this.style={};}
 append(...v){this.children.push(...v);}
 replaceChildren(...v){this.children=v;}
 setAttribute(){}
}
test('server-hosted UI sends upstream URL and credentials in same-origin POST body',async()=>{
 const elements=new Map();
 globalThis.document={querySelector(){return{content:'same-origin'};},getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();},createDocumentFragment(){return new Element();},addEventListener(){}};
 globalThis.localStorage={getItem:key=>key==='bp.source'?JSON.stringify({name:'Rule34',kind:'gelbooru',base:'https://rule34.xxx/',userId:'123',apiKey:'test-key'}):null,setItem(){}};
 globalThis.window={addEventListener(){}};
 globalThis.IntersectionObserver=class{observe(){}};
 const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>[]};};
 const original=setTimeout;
 globalThis.setTimeout=(cb,delay)=>{const t=original(cb,delay===450?0:delay);t.unref();return t;};
 await import('../web/app.mjs');
 await new Promise(resolve=>original(resolve,20));
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/posts');assert.equal(calls[0].options.method,'POST');
 const target=new URL(JSON.parse(calls[0].options.body).url);
 assert.equal(target.hostname,'api.rule34.xxx');assert.equal(target.searchParams.get('api_key'),'test-key');
 assert.ok(!calls[0].url.includes('test-key'));
 globalThis.setTimeout=original;
});
