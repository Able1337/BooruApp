import {readFileSync} from 'node:fs';
import {SOURCE_TEMPLATES} from '../web/core.mjs';
class Element {
 constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.value='';this.textContent='';this.className='';this.open=false;this.hidden=false;this.disabled=false;this.classList={add:c=>this.classList.toggle(c,true),remove:c=>this.classList.toggle(c,false),toggle:(c,force)=>{const set=new Set(this.className.split(/\s+/).filter(Boolean));const on=force??!set.has(c);if(on)set.add(c);else set.delete(c);this.className=[...set].join(' ');return on;},contains:c=>this.className.split(/\s+/).includes(c)};}
 append(...nodes){for(const n of nodes){if(n.tag==='#fragment')this.append(...n.children);else{this.children.push(n);n.parent=this;}}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(k,v){this.attributes[k]=String(v);if(k==='class')this.className=String(v);}
 getAttribute(k){return this.attributes[k]??null;}
 removeAttribute(k){delete this.attributes[k];}
 matches(selector){if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));if(selector.startsWith('[data-')){const key=selector.slice(6,-1).replace(/-([a-z])/g,(_,x)=>x.toUpperCase());return key in this.dataset;}return this.tag===selector;}
 querySelectorAll(selector){const list=[];for(const c of this.children){if(c.matches(selector))list.push(c);list.push(...c.querySelectorAll(selector));}return list;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 showModal(){this.open=true;}
 close(){const wasOpen=this.open;this.open=false;if(wasOpen)this.onclose?.();}
 focus(){this.focused=true;}
 pause(){this.paused=true;}
 click(){this.onclick?.({preventDefault(){},stopPropagation(){}});}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
}
export async function setup({storage={},server=false,defaultSources=false,fetcher=async()=>({ok:true,json:async()=>[]})}={}){
 const ids=new Map();const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
 for(const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const n=new Element(match[1]);n.id=match[3];n.hidden=/\bhidden\b/.test(match[2]);ids.set(n.id,n);}
 const $=id=>{if(!ids.has(id))throw new Error('Missing HTML id: '+id);return ids.get(id);};
 globalThis.document={getElementById:$,querySelector:selector=>selector.startsWith('meta[')&&server?{content:'same-origin'}:null,querySelectorAll:selector=>{const nodes=[];for(const root of ids.values()){if(root.matches(selector))nodes.push(root);nodes.push(...root.querySelectorAll(selector));}return[...new Set(nodes)];},createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('#fragment'),addEventListener(){}};
 if(!defaultSources&&!Object.hasOwn(storage,'bp.sourceDefaults'))storage={...storage,'bp.sourceDefaults':SOURCE_TEMPLATES.map(s=>s.id)};
 const memory=new Map(Object.entries(storage).map(([k,v])=>[k,JSON.stringify(v)]));
 globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
 const listeners={};globalThis.window={addEventListener:(type,cb)=>{listeners[type]=cb;},scrollTo(){}};
 const observers=[];globalThis.IntersectionObserver=class{constructor(callback){this.callback=callback;this.targets=[];observers.push(this);}observe(n){this.targets.push(n);}unobserve(n){this.targets=this.targets.filter(x=>x!==n);}disconnect(){this.targets=[];}};
 const requests=[];globalThis.fetch=async(url,options)=>{requests.push({url,options});return fetcher(url,options);};
 const timer=globalThis.setTimeout;globalThis.setTimeout=(...args)=>{const t=timer(...args);if(Number(args[1])>=30000)t.unref();return t;};
 const files=[],create=URL.createObjectURL,revoke=URL.revokeObjectURL;
 URL.createObjectURL=blob=>{files.push(blob);return'blob:test';};URL.revokeObjectURL=()=>{};
 await import('../web/app.mjs?test='+Math.random());
 return{$,memory,requests,files,listeners,intersectCollections(ids=null){for(const observer of observers){const targets=observer.targets.filter(n=>n.dataset.collectionId&&(!ids||ids.includes(n.dataset.collectionId)));if(targets.length)observer.callback(targets.map(target=>({target,isIntersecting:true})));}},cleanup(){globalThis.setTimeout=timer;URL.createObjectURL=create;URL.revokeObjectURL=revoke;},tick:()=>new Promise(r=>setImmediate(r))};
}
