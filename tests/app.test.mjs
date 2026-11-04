import test from 'node:test';
import assert from 'node:assert/strict';
class Element {
 constructor(){this.children=[];this.value='';this.classList={add(){},remove(){}};this.style={};this.open=false;}
 append(...v){this.children.push(...v);}
 replaceChildren(...v){this.children=v;}
 setAttribute(){}
 querySelector(tag){return this.children.find(v=>v.tag===tag)||null;}
 showModal(){this.open=true;}
 close(){this.open=false;this.onclose?.();}
 pause(){this.paused=true;}
}
test('native bridge, viewer, favorites and stale responses',async()=>{
 const elements=new Map();
 globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(tag){const el=new Element();el.tag=tag;return el;},createDocumentFragment(){return new Element();},addEventListener(){}};
 const $=id=>document.getElementById(id);
 const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
 let receive;globalThis.window={addEventListener(type,cb){if(type==='message')receive=cb;}};
 globalThis.IntersectionObserver=class {observe(){}};
 let browserRequests=0;globalThis.fetch=()=>{browserRequests++;throw new Error('unexpected browser request');};
 const realTimer=globalThis.setTimeout;globalThis.setTimeout=(...args)=>{const timer=realTimer(...args);timer.unref();return timer;};
 const sent=[];const port={postMessage:s=>sent.push(JSON.parse(s))};
 await import('../web/app.mjs');
 receive({data:'booru-native-v1',ports:[port]});
 assert.equal($('mode').textContent,'ANDROID');assert.equal(sent.length,1);
 const first=sent[0];
 $('query').value='city';$('searchForm').onsubmit({preventDefault(){}});
 const second=sent[1];assert.equal(new URL(second.url).searchParams.get('tags'),'city');
 const reply=(request,rows)=>port.onmessage({data:JSON.stringify({id:request.id,body:JSON.stringify(rows)})});
 reply(first,[{id:99,file_url:'https://example.org/old.jpg'}]);
 reply(second,[{id:1,file_url:'https://example.org/a.webm',preview_url:'https://example.org/p.jpg',tags:'city'}]);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(browserRequests,0);assert.equal($('grid').children.at(-1).children.length,1);
 $('grid').children.at(-1).children[0].onclick();
 assert.equal($('viewer').open,true);assert.equal($('media').children[0].tag,'video');
 $('savePost').onclick();assert.equal(JSON.parse(memory.get('bp.saved')).length,1);
 $('closeViewer').onclick();assert.equal($('media').children[0].paused,true);
 $('savedTab').onclick();$('grid').children.at(-1).children[0].onclick();
 $('savePost').onclick();assert.equal(JSON.parse(memory.get('bp.saved')).length,0);assert.equal($('viewer').open,false);
 assert.equal($('grid').children.at(-1).children.length,0);
 globalThis.setTimeout=realTimer;
});
