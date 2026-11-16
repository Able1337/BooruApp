import {installViewerGestures} from './viewing.mjs';
import {openLibrary} from './library.mjs';
import {makeRequest,normalizePosts,httpsUrl,postRows,sanitizeFavorites,SOURCE_TEMPLATES,sourceTemplate,sanitizeSources,parseTags,tagsQuery,mergeTags,searchTags,sanitizeCollections,makeSuggestionsRequest,normalizeSuggestions,TAG_GROUPS,metaSuggestions,sortFromTag,parseTagPayload,groupCollectionsBySource,mediaUrl,encodeRoute,decodeRoute,routeHistoryMode,savedPostSource,groupSavedPosts,originalPostUrl,downloadFilename,similarQueries,rankSimilarPosts,addCollectionPresets,addDefaultSources,sourceAuthWarning,orTag,validateOrTags,matchesTags,createSearchPager} from './core.mjs';
const $=id=>document.getElementById(id);
const el=(tag,cls='',text='')=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
const button=(text,cls,action)=>{const n=el('button',cls,text);n.type='button';n.onclick=action;return n;};
const uid=prefix=>prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function persist(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{showNotice('Не удалось сохранить данные: хранилище браузера заполнено.');return false;}}
function showNotice(text=''){ $('notice').textContent=text;$('notice').hidden=!text; }
let sources=sanitizeSources(read('bp.sources',null),read('bp.source',null));
const initialSources=addDefaultSources(sources,read('bp.sourceDefaults',[]));sources=initialSources.sources;let appliedSourceDefaults=initialSources.applied;
let activeId=read('bp.activeId','');if(!sources.some(s=>s.id===activeId))activeId=(sources.find(s=>sourceTemplate(s).id==='safebooru')||sources[0]).id;
let saved;try{saved=sanitizeFavorites(read('bp.saved',[]));}catch{saved=[];}
let earlyNativeHandshake=null;const captureHandshake=event=>{if(event.data==='booru-native-v1'&&event.ports?.[0])earlyNativeHandshake=event;};window.addEventListener('message',captureHandshake);
let library=null,storageUnavailable=false;
try{library=await openLibrary(saved);if(library)saved=sanitizeFavorites(await library.posts()).sort((a,b)=>(b.savedAt||0)-(a.savedAt||0));}catch{library=null;storageUnavailable=true;}
const sessions=new Map();
try{if(library)for(const entry of (await library.sessions()).sort((a,b)=>a.at-b.at).slice(-6))if(entry?.key&&Array.isArray(entry.posts))sessions.set(entry.key,entry);}catch{}
let reading=read('bp.reading',{});if(!reading||typeof reading!=='object'||Array.isArray(reading))reading={};reading={quality:'auto',markSeen:false,hideSeen:false,exclusions:{},...reading};if(!['auto','preview','original'].includes(reading.quality))reading.quality='auto';if(!reading.exclusions||typeof reading.exclusions!=='object')reading.exclusions={};
const seenPosts=new Set();try{if(library)for(const row of await library.seen())seenPosts.add(row.key);}catch{}
let filtersBypassed=false;
let sessionPersistenceFailed=false;
let activeSessionKey='',sessionTimer=null,restoringPosition=false,feedAbort=new AbortController();
let collections=sanitizeCollections(read('bp.collections',[]));
let appliedCollectionPresets=read('bp.collectionPresets',[]);
let covers=read('bp.covers',{});if(!covers||typeof covers!=='object'||Array.isArray(covers))covers={};
let selected=[],tab='home',sort=read('bp.sort','new'),view=read('bp.view','list');
if(!['new','score','score_asc','random','old'].includes(sort))sort='new';if(!['list','grid'].includes(view))view='list';
let viewerItems=[],similarItems=[],similarToken=0;
let searchPager=null,pagerState=null,editingOr=null;
let posts=[],page=0,busy=false,done=false,generation=0,current=0,editingSource=null,editingCollection=null,activeCollection=null;
let routePage='home',routeHash='',restoringRoute=false;
let port=null,serial=0,suggestionGeneration=0,suggestionTimer=null,suggestionActions=[],suggestionIndex=-1;
const pending=new Map(),suggestionCache=new Map(),knownTags=new Map();
const coverCache=new Map(),coverPending=new Set(),coverArts=new Map(),coverQueue=[];let coverActive=0,coverEpoch=0;
const coverObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const c=collections.find(c=>c.id===entry.target.dataset.collectionId);if(c)requestCollectionCover(c);coverObserver.unobserve(entry.target);}},{rootMargin:'200px'});
const serverApi=document.querySelector('meta[name="booru-api"]')?.content==='same-origin';
let mediaRelay=read('bp.mediaRelay',{});if(!mediaRelay||typeof mediaRelay!=='object')mediaRelay={};
mediaRelay={gelbooru:true,e621:true,...mediaRelay};
if(serverApi&&read('bp.mediaRelayVersion',0)<1){mediaRelay.gelbooru=true;mediaRelay.e621=true;persist('bp.mediaRelay',mediaRelay);persist('bp.mediaRelayVersion',1);}
const slowConnection=()=>globalThis.navigator?.connection?.saveData||/^(slow-)?2g$/.test(globalThis.navigator?.connection?.effectiveType||'');
const feedImage=p=>reading.quality==='original'?p.file:reading.quality==='preview'||slowConnection()?p.preview:(p.sample||p.file);
const displayMedia=url=>serverApi?mediaUrl(url,mediaRelay):url;
const source=()=>sources.find(s=>s.id===activeId)||sources[0];
function persistSources(){ensureCollectionPresets();persist('bp.sourceDefaults',appliedSourceDefaults);persist('bp.sources',sources);persist('bp.activeId',activeId);persist('bp.source',source());}
function ensureCollectionPresets(){
  const next=addCollectionPresets(collections,sources,appliedCollectionPresets);collections=next.collections;appliedCollectionPresets=next.applied;persist('bp.collections',collections);persist('bp.collectionPresets',appliedCollectionPresets);
}
function mark(s){const t=sourceTemplate(s);const n=el('span','source-mark',t.mark);n.dataset.color=t.color;return n;}
function coverImage(url){const u=httpsUrl(url);if(!u)return null;const image=el('img','card-cover');image.src=displayMedia(u);image.alt='';image.loading='lazy';image.onerror=()=>image.remove();return image;}
function closeDialog(id){$(id).close();}
function pauseMedia(){for(const v of document.querySelectorAll('video'))v.pause();}
function releaseMedia(root){for(const v of root.querySelectorAll('video')){v.pause();v.removeAttribute('src');v.load?.();}}
function closeViewer(){pauseMedia();closeDialog('viewer');releaseMedia($('media'));$('media').replaceChildren();viewerItems=[];}
let sessionMuted=true;
document.addEventListener('play',event=>{if(event.target.tagName!=='VIDEO')return;for(const video of document.querySelectorAll('video'))if(video!==event.target)video.pause();event.target.muted=sessionMuted;},true);
document.addEventListener('volumechange',event=>{if(event.target.tagName==='VIDEO')sessionMuted=event.target.muted;},true);
const feedVideoObserver=new IntersectionObserver(entries=>{
  for(const entry of entries)if(!entry.isIntersecting||entry.intersectionRatio<0.1)entry.target.pause();
},{threshold:[0,0.1]});
function clearFeedVideos(){releaseMedia($('grid'));feedVideoObserver.disconnect();cardObserver.disconnect();seenObserver.disconnect();for(const timer of seenTimers.values())clearTimeout(timer);seenTimers.clear();}
document.addEventListener('visibilitychange',()=>{if(document.hidden){pauseMedia();checkpointSession();}});
window.addEventListener('pagehide',checkpointSession);
let scrollAnchor=window.scrollY||0,scrollDirection=0,scrollDistance=0,scrollFrame=0;
function revealSearch(){ $('searchPanel').classList.remove('scroll-hidden');$('topbar').classList.remove('scroll-hidden'); }
window.addEventListener('scroll',()=>{
  if(scrollFrame)return;
  scrollFrame=requestAnimationFrame(()=>{
    scrollFrame=0;if(!restoringPosition){clearTimeout(sessionTimer);sessionTimer=setTimeout(checkpointSession,180);}const y=Math.max(0,window.scrollY||0),delta=y-scrollAnchor;scrollAnchor=y;
    if(document.querySelector('dialog[open]'))return;
    if(y<60){revealSearch();scrollDistance=0;return;}
    const direction=Math.sign(delta);if(!direction)return;
    if(direction!==scrollDirection){scrollDirection=direction;scrollDistance=0;}
    scrollDistance+=Math.abs(delta);
    if(scrollDistance>=10){$('searchPanel').classList.toggle('scroll-hidden',direction>0);$('topbar').classList.toggle('scroll-hidden',direction>0);if(direction>0)hideSuggestions();scrollDistance=0;}
  });
},{passive:true});
$('searchPanel').addEventListener?.('focusin',revealSearch);

function count(){ $('savedCount').textContent=String(saved.length); }
function isSaved(p){return saved.some(x=>x.key===p.key);}
function connectNative(event){
  if(event.data!=='booru-native-v1'||!event.ports?.[0]||port)return;
  port=event.ports[0];port.onmessage=message=>{let r;try{r=JSON.parse(message.data);}catch{return;}const p=pending.get(r.id);if(!p)return;clearTimeout(p.timer);pending.delete(r.id);if(r.error)p.reject(new Error(r.error));else try{p.resolve(p.kind==='tags'?parseTagPayload(r.body):JSON.parse(r.body));}catch{p.reject(new Error('Ответ API не является JSON'));}};
  $('mode').textContent='ANDROID';updateInstallButton();if(tab==='feed')reload({refresh:true});
}
window.addEventListener('message',connectNative);window.removeEventListener?.('message',captureHandshake);if(earlyNativeHandshake)connectNative(earlyNativeHandshake);
function nativeGet(url,kind){return new Promise((resolve,reject)=>{const id=String(++serial);const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Время ожидания API истекло'));},35000);pending.set(id,{resolve,reject,timer,kind});try{port.postMessage(JSON.stringify({id,url}));}catch{clearTimeout(timer);pending.delete(id);reject(new Error('Соединение с Android потеряно. Перезагрузите интерфейс.'));}});}
async function get(url,kind='posts',signal){
  if(signal?.aborted)throw new DOMException('Отменено','AbortError');
  if(port){const request=nativeGet(url,kind);if(!signal)return request;return new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('Отменено','AbortError'));signal.addEventListener('abort',abort,{once:true});request.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});}
  const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});const timeout=setTimeout(()=>controller.abort(new DOMException('Источник не ответил за 30 секунд. Повторите запрос.','TimeoutError')),30000);timeout.unref?.();
  const options={credentials:'omit',signal:controller.signal};
  if(serverApi){Object.assign(options,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});url='/api/'+kind;}
  try{const response=await fetch(url,options);let data;try{data=kind==='tags'&&!serverApi?parseTagPayload(await response.text()):await response.json();}catch{if(controller.signal.aborted)throw controller.signal.reason;throw new Error('Источник вернул не JSON. Проверьте доступность API.');}
  if(!response.ok)throw new Error(serverApi&&typeof data.error==='string'?data.error:'Источник вернул HTTP '+response.status);return data;}finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
function renderSourceSelect(){
  $('sourceSelect').replaceChildren();
  for(const s of sources){const o=el('option','',s.name+(sourceAuthWarning(s)?' !':''));o.value=s.id;$('sourceSelect').append(o);}
  $('sourceSelect').value=activeId;const t=sourceTemplate(source());$('sourceMark').textContent=t.mark;$('sourceMark').dataset.color=t.color;$('sourceSelect').title=source().name;
}
function routeFor(s=source(),tags=selected,options={}){
  return encodeRoute({page:tab==='saved'?'saved':'feed',booru:sourceTemplate(s).id||s.id,tags:tagsQuery(effectiveTags(s,tags)),sort,view,collection:activeCollection||'',...options});
}
function routeLink(cls,href,action,text=''){
  const a=el('a',cls,text);a.href=href;a.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||e.button>0)return;e.preventDefault();action();};return a;
}
function syncRoute(){
  if(restoringRoute||!window.history)return;
  const hash=tab==='home'?'#home':routeFor();
  if(hash!==routeHash)checkpointSession();
  if(routePage!==tab)window.scrollTo?.({top:0});
  if(hash!==window.location.hash){window.history[routeHistoryMode(window.location.hash,hash)]({booruPocket:true,page:tab},'',hash);}
  routePage=tab;routeHash=hash;
}
function restoreRoute(force=false){
  if(!window.location)return false;
  const hash=window.location.hash;if(!force&&hash===routeHash)return false;
  checkpointSession();const route=decodeRoute(hash);restoringRoute=true;routePage=route.page;routeHash=hash;
  for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();pauseMedia();
  if(route.page!=='home'){
    let s=sources.find(s=>(sourceTemplate(s).id||s.id)===route.booru)||sources.find(s=>s.id===route.booru);
    if(!s){const preset=SOURCE_TEMPLATES.find(t=>t.id===route.booru);if(preset&&sources.length<30){s={...preset,id:uid('source')};sources.push(s);}}
    if(s){activeId=s.id;persistSources();invalidateCollectionCovers();}
    selected=parseTags(route.tags);sort=route.sort;view=route.view;activeCollection=route.collection||null;$('query').value='';renderHome();renderTags();
  }
  showTab(route.page);restoringRoute=false;syncRoute();return true;
}
function initNavigation(){
  if(!window.history||!window.location){updateView();return;}
  window.history.scrollRestoration='manual';
  const initial=window.location.hash,route=decodeRoute(initial);
  if(route.page!=='home'&&!window.history.state?.booruPocket){window.history.replaceState({booruPocket:true,page:'home'},'','#home');window.history.pushState({booruPocket:true,page:route.page},'',initial);}
  window.addEventListener('popstate',()=>restoreRoute());window.addEventListener('hashchange',()=>restoreRoute());
  restoreRoute(true);
}
function renderHome(){
  renderSourceSelect();$('sourceCards').replaceChildren();
  for(const s of sources){
    const card=el('article','source-card'+(s.id===activeId?' selected':''));card.dataset.color=sourceTemplate(s).color;
    const image=coverImage(covers[s.id]);if(image)card.append(image);
    const main=routeLink('source-card-main',routeFor(s,selected,{page:'feed',collection:''}),()=>setActive(s.id,true));main.append(mark(s),el('strong','',s.name),el('small','',new URL(s.base).hostname+'  ↗'));
    const warning=sourceAuthWarning(s);if(warning){const alert=button('!','source-warning',()=>openSource(s.id));alert.title=warning;alert.setAttribute('aria-label',s.name+': '+warning);card.append(alert);}
    const edit=button('⋯','card-edit',()=>openSource(s.id));edit.setAttribute('aria-label','Изменить '+s.name);card.append(main,edit);$('sourceCards').append(card);
  }
  const add=button('','source-card-add',()=>openSource());add.append(el('span','','＋'),el('strong','','Добавить booru'));$('sourceCards').append(add);
  renderCollections();
}
function collectionSourceName(c){return c.sourceId==='*'?'Любой booru':sources.find(s=>s.id===c.sourceId)?.name||'Источник удалён';}
function renderCollections(){
  coverObserver.disconnect();coverArts.clear();
  $('collectionCards').replaceChildren();$('collectionPicker').replaceChildren();
  for(const group of groupCollectionsBySource(collections,sources)){
    const section=el('section','collection-group');section.dataset.sourceId=group.id??'missing';
    const heading=el('div','collection-group-head'),title=el('h3');const provider=sources.find(s=>s.id===group.id);if(provider)title.append(mark(provider));title.append(el('span','',group.name),el('span','count',String(group.items.length)));heading.append(title);
    if(group.id!==null){const add=button('＋ Коллекция','soft-button',()=>openCollection(null,group.id));add.setAttribute('aria-label','Новая коллекция: '+group.name);heading.append(add);}
    const grid=el('div','collection-cards');section.append(heading,grid);$('collectionCards').append(section);
    const pickerTitle=el('h3','picker-group-title',group.name);$('collectionPicker').append(pickerTitle);
    for(const c of group.items){
    const card=el('article','collection-card');card.dataset.collectionId=c.id;const main=routeLink('collection-card-main',routeFor(sources.find(s=>s.id===c.sourceId)||source(),parseTags(c.query),{page:'feed',sort:c.sort,collection:c.id}),()=>applyCollection(c));
    const art=el('span','collection-art',c.sort==='score'?'✦':'#');coverArts.set(c.id,art);const descriptor=collectionCoverDescriptor(c);const image=descriptor&&c.coverKey===descriptor.key?coverImage(c.cover):null;if(image)art.append(image);
    const copy=el('span','collection-copy');copy.append(el('strong','',c.name),el('span','collection-query',c.query||'Все теги'),el('small','',collectionSourceName(c)));main.append(art,copy);
    const edit=button('⋯','card-edit',()=>openCollection(c.id));edit.setAttribute('aria-label','Изменить коллекцию '+c.name);card.append(main,edit);grid.append(card);coverObserver.observe(card);
    const pick=button('','collection-pick',()=>{closeDialog('collectionsDialog');applyCollection(c);});const text=el('span');text.append(el('strong','',c.name),el('small','',c.query||'Все теги'));pick.append(text);$('collectionPicker').append(pick);
    }
  }
  if(!collections.length){$('collectionCards').append(el('p','hint','Сохраните текущий поиск — он появится здесь карточкой.'));$('collectionPicker').append(el('p','hint','Коллекций пока нет.'));}
}
function collectionCoverDescriptor(c){
  const s=c.sourceId==='*'?source():sources.find(s=>s.id===c.sourceId);if(!s)return null;
  const query=tagsQuery(effectiveTags(s,parseTags(c.query)));
  return {source:{...s},query,sort:c.sort,key:JSON.stringify([s.id,s.base,s.kind,s.userId||'',s.login||'',query,c.sort])};
}
function invalidateCollectionCovers(reset=false){
  coverEpoch++;coverQueue.length=0;coverPending.clear();
  if(reset){coverCache.clear();for(const c of collections)c.coverCheckedAt=0;}
}
function updateCollectionArt(c,entry){
  const art=coverArts.get(c.id);if(!art)return;art.querySelector('.card-cover')?.remove();
  const image=coverImage(entry.url);if(image)art.append(image);art.title=entry.error||'';
}
function requestCollectionCover(c){
  const d=collectionCoverDescriptor(c);if(!d)return;
  const authWarning=sourceAuthWarning(d.source);if(authWarning){updateCollectionArt(c,{url:'',error:authWarning});return;}
  const cached=coverCache.get(d.key)||(c.coverKey===d.key&&c.cover?{url:c.cover,at:c.coverCheckedAt||0}:null);
  if(cached&&Date.now()-cached.at<(cached.error?30000:300000)){if(!cached.error&&(c.coverKey!==d.key||c.cover!==cached.url)){c.cover=cached.url;c.coverKey=d.key;c.coverCheckedAt=cached.at;persist('bp.collections',collections);}updateCollectionArt(c,cached);return;}
  const id=coverEpoch+'|'+d.key;if(coverPending.has(id))return;
  coverPending.add(id);coverQueue.push({...d,id,epoch:coverEpoch});drainCollectionCovers();
}
function drainCollectionCovers(){
  while(coverActive<2&&coverQueue.length){const job=coverQueue.shift();coverActive++;loadCollectionCover(job).finally(()=>{coverActive--;coverPending.delete(job.id);drainCollectionCovers();});}
}
async function loadCollectionCover(job){
  let entry;
  try{const pager=createSearchPager(job.source,parseTags(job.query),job.sort,(q,p,l)=>get(makeRequest(job.source,q,p,l)),{pageSize:1});const first=(await pager.next()).items[0];entry={url:first?.preview||'',at:Date.now()};}
  catch{entry={url:'',at:Date.now(),error:'Обложка недоступна. Проверьте настройки API источника.'};}
  if(job.epoch!==coverEpoch)return;
  coverCache.set(job.key,entry);
  let changed=false;
  for(const c of collections){if(collectionCoverDescriptor(c)?.key!==job.key)continue;
    if(!entry.error){c.cover=entry.url;c.coverKey=job.key;c.coverCheckedAt=entry.at;changed=true;}
    updateCollectionArt(c,entry);
  }
  if(changed)persist('bp.collections',collections);
}
function updateView(){
  syncRoute();
  if(tab==='home')clearFeedVideos();revealSearch();
  $('homeView').hidden=tab!=='home';$('feedView').hidden=tab==='home';$('viewToggle').hidden=tab==='home';$('shareSearch').hidden=tab!=='feed';
  for(const [id,key]of [['homeTab','home'],['feedTab','feed'],['savedTab','saved']])$(id).classList.toggle('active',tab===key);
  $('grid').className=tab==='saved'?'saved-groups':view==='list'?'posts-list':'posts-grid';$('listView').setAttribute('aria-pressed',String(view==='list'));$('gridView').setAttribute('aria-pressed',String(view==='grid'));$('sort').value=sort;
  $('feedView').dataset.page=tab;$('showHidden').hidden=!reading.hideSeen&&!String(reading.exclusions[activeId]||'').trim();
  $('feedTitle').textContent=tab==='saved'?'Сохранённые посты':source().name;
  $('feedSubtitle').textContent=tab==='saved'?'Посты по booru':[new URL(source().base).hostname,sort==='score'?'По оценке':sort==='random'?'Случайные посты':'Сначала новые'].join(' · ');
}
function setActive(id,openFeed=false){
  if(!sources.some(s=>s.id===id))return;invalidateCollectionCovers();activeId=id;activeCollection=null;persistSources();hideSuggestions();renderHome();
  if(openFeed){tab='feed';reload();}else if(tab==='feed')reload();else updateView();
}
function showTab(next){checkpointSession();tab=next;hideSuggestions();if(next==='home'){generation++;feedAbort.abort();busy=false;clearFeedVideos();$('grid').replaceChildren();posts=[];activeSessionKey='';showNotice();updateView();renderHome();}else reload();}
function renderTags(){
  $('selectedTags').replaceChildren();
  for(const t of selected){const chip=el('span','tag-chip'+(t.excluded?' excluded':''));
    const label=t.any?t.any.join(' ИЛИ '):t.value;const name=button(label,'tag-name',()=>{if(t.any){openOr(t);return;}selected=selected.filter(x=>x.value!==t.value);renderTags();if(tab!=='home')reload();});name.title=t.any?'Изменить группу ИЛИ':'Убрать тег';if(t.any){chip.classList.add('or-chip');const remove=button('×','remove-or',()=>{selected=selected.filter(x=>x.value!==t.value);renderTags();if(tab!=='home')reload();});remove.setAttribute('aria-label','Убрать группу ИЛИ');chip.append(remove);}
    const exclude=button('⊘','exclude-toggle',()=>{t.excluded=!t.excluded;renderTags();if(tab!=='home')reload();});exclude.disabled=/^(sort|order):/.test(t.value);exclude.setAttribute('aria-label',(t.excluded?'Включить ':'Исключить ')+t.value);exclude.setAttribute('aria-pressed',String(t.excluded));chip.append(name,exclude);$('selectedTags').append(chip);
  }
  $('clearQuery').hidden=!selected.length&&!$('query').value;
}
function commitDraft(){selected=mergeTags(selected,parseTags($('query').value));const explicit=selected.filter(t=>!t.excluded&&/^(sort|order):/.test(t.value)).at(-1);if(explicit&&sortFromTag(explicit.value)){sort=sortFromTag(explicit.value);persist('bp.sort',sort);}$('query').value='';renderTags();hideSuggestions();}
function runSearch(){commitDraft();activeCollection=null;tab='feed';reload();}
function openOr(group=null){
  commitDraft();const current=group||selected.find(t=>t.any&&!t.excluded);editingOr=current?.value||null;
  $('orTags').value=current?.any?.join('\n')||'';$('orError').hidden=true;$('orChoices').replaceChildren();
  for(const tag of selected.filter(t=>!t.any&&!t.excluded&&!t.value.includes(':'))){const pick=button(tag.value,'soft-button',()=>{const values=$('orTags').value.split(/[\s,|~]+/).filter(Boolean);if(!values.includes(tag.value))values.push(tag.value);$('orTags').value=values.join('\n');});$('orChoices').append(pick);}
  $('orDialog').showModal();$('orTags').focus();
}
$('orOpen').onclick=()=>openOr();$('orClose').onclick=()=>closeDialog('orDialog');
$('orForm').onsubmit=event=>{
  event.preventDefault();const previous=selected.find(t=>t.value===editingOr),group=orTag($('orTags').value.split(/[\s,|~]+/),previous?.excluded||false);
  try{const next=selected.filter(t=>t.value!==editingOr&&!(group.any.includes(t.value)&&!t.excluded));validateOrTags([...next,group]);selected=mergeTags(next,[group]);closeDialog('orDialog');renderTags();if(tab!=='home')reload();}catch(error){$('orError').textContent=error.message;$('orError').hidden=false;}
};
function rememberTags(s,items){let names=knownTags.get(s.id)||new Set();for(const p of items)for(const t of p.tags){if(names.size<1500)names.add(t);}knownTags.set(s.id,names);}
function hideSuggestions(){clearTimeout(suggestionTimer);suggestionGeneration++;$('suggestions').hidden=true;$('query').setAttribute('aria-expanded','false');$('query').removeAttribute('aria-activedescendant');suggestionActions=[];suggestionIndex=-1;}
function chooseTag(value,excluded){selected=mergeTags(selected,[{value,excluded}]);$('query').value='';renderTags();hideSuggestions();$('query').focus();}
function showSuggestions(rows,prefix,excluded,local=false){
  const box=$('suggestions');box.replaceChildren();suggestionActions=[];suggestionIndex=-1;
  const add=(name,count,exact=false)=>{const index=suggestionActions.length;const n=button('','suggestion',()=>chooseTag(name,excluded));n.id='suggestion-'+index;n.setAttribute('role','option');n.setAttribute('aria-selected','false');n.onpointerdown=e=>e.preventDefault();n.append(el('span','',exact?'Добавить «'+name+'»':name),el('span','suggestion-count',count?Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(count):''));suggestionActions.push(()=>chooseTag(name,excluded));box.append(n);};
  add(prefix,0,true);for(const r of rows.filter(r=>r.name!==prefix&&!selected.some(t=>t.value===r.name)).slice(0,10))add(r.name,r.count);
  box.append(el('div','suggestion-info',local==='meta'?'Фильтры: score — порог оценки, sort / order — порядок постов':local?'Локальные варианты · тег можно ввести вручную':'Подсказки '+source().name+' · выберите несколько тегов'));
  box.hidden=false;$('query').setAttribute('aria-expanded','true');
}
async function suggest(){
  const raw=$('query').value.trim().split(/\s+/).at(-1)||'';const excluded=raw.startsWith('-'),prefix=(excluded?raw.slice(1):raw);
  if(!prefix||prefix.length>80||/[{}~|]/.test($('query').value)){hideSuggestions();return;}
  const token=++suggestionGeneration,s={...source()},key=s.id+'|'+prefix;
  const meta=metaSuggestions(s,prefix);if(meta.length){if(token===suggestionGeneration)showSuggestions(meta,prefix,excluded,'meta');return;}
  let rows=suggestionCache.get(key),local=false;
  if(!rows){try{rows=normalizeSuggestions(await get(makeSuggestionsRequest(s,prefix),'tags'));if(rows.length){if(suggestionCache.size>100)suggestionCache.clear();suggestionCache.set(key,rows);}}
    catch{rows=[];}if(!rows.length){local=true;const common=['landscape','city','sky','blue_sky','cloud','tree','forest','mountain','ocean','night','long_hair','short_hair','blue_hair','green_eyes','smile','solo'];const names=new Set([...(knownTags.get(s.id)||[]),...collections.flatMap(c=>parseTags(c.query).map(t=>t.value)),...common]);rows=[...names].filter(t=>t.startsWith(prefix)).slice(0,10).map(name=>({name,count:0}));}}
  if(token===suggestionGeneration&&activeId===s.id)showSuggestions(rows,prefix,excluded,local);
}
$('query').oninput=()=>{
  clearTimeout(suggestionTimer);suggestionGeneration++;
  const value=$('query').value;
  if(/\s/.test(value)&&!/[{}~|]/.test(value)){const last=value.match(/[^\s]*$/)[0];const complete=value.slice(0,value.length-last.length);selected=mergeTags(selected,parseTags(complete));$('query').value=last;renderTags();}
  $('clearQuery').hidden=!selected.length&&!$('query').value;
  if(!$('query').value||/[{}~|]/.test($('query').value)){hideSuggestions();return;}suggestionTimer=setTimeout(suggest,250);
};
$('query').onfocus=()=>{if($('query').value)suggestionTimer=setTimeout(suggest,100);};
$('query').onblur=()=>{setTimeout(hideSuggestions,160);};
$('query').onkeydown=e=>{
  if(!$('suggestions').hidden&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const n=suggestionActions.length;suggestionIndex=(suggestionIndex+(e.key==='ArrowDown'?1:-1)+n)%n;for(const [i,node]of [...$('suggestions').querySelectorAll('.suggestion')].entries())node.setAttribute('aria-selected',String(i===suggestionIndex));$('query').setAttribute('aria-activedescendant','suggestion-'+suggestionIndex);}
  else if(e.key==='Enter'&&!$('suggestions').hidden&&suggestionIndex>=0){e.preventDefault();suggestionActions[suggestionIndex]?.();}else if(e.key==='Escape')hideSuggestions();
};
function effectiveTags(provider=source(),tags=selected){
  if(filtersBypassed)return tags;
  const permanent=parseTags(String(reading.exclusions[provider.id]||'')).filter(t=>!t.any&&!t.value.includes(':')&&!tags.some(x=>x.value===t.value)).map(t=>({value:t.value,excluded:true}));
  return mergeTags(tags,permanent);
}
function sessionKey(){return tab==='feed'?JSON.stringify([activeId,source().base,tagsQuery(effectiveTags()),sort,view,!!reading.hideSeen&&!filtersBypassed]):'';}

function positionAnchor(){
  const cards=[...$('grid').querySelectorAll('.post')];
  const card=cards.find(n=>{const r=n.getBoundingClientRect?.();return r&&r.bottom>0;});
  return {key:card?.dataset.postKey||'',offset:card?.getBoundingClientRect?.().top||0,height:card?.getBoundingClientRect?.().height||0,width:window.innerWidth||0,y:window.scrollY||0};
}
function checkpointSession(){
  if(!activeSessionKey||!posts.length||tab!=='feed'||$('feedView').hidden||restoringPosition)return;
  const previous=sessions.get(activeSessionKey);if(!previous)return;
  const entry={...previous,posts:[...posts],pager:pagerState||previous.pager,page,done,anchor:positionAnchor(),at:Date.now()};
  sessions.delete(entry.key);sessions.set(entry.key,entry);while(sessions.size>6)sessions.delete(sessions.keys().next().value);
  persist('bp.lastSession',{key:entry.key,hash:entry.hash,at:entry.at});
  updateResume();if(library)return library.saveSession(entry,[...sessions.keys()]).then(()=>{sessionPersistenceFailed=false;}).catch(()=>{if(!sessionPersistenceFailed)showNotice('Не удалось запомнить место просмотра. Освободите место на устройстве.');sessionPersistenceFailed=true;});
}
function updateResume(){const entry=sessions.get(read('bp.lastSession',{})?.key);$('resumeFeed').hidden=!entry;$('resumeFeed').textContent=entry?'Продолжить просмотр · '+entry.sourceName:'Продолжить просмотр';}
let positionEpoch=0;
function restorePosition(anchor){
  if(!anchor)return;restoringPosition=true;const epoch=++positionEpoch,token=generation;
  const apply=()=>{const card=[...$('grid').querySelectorAll('.post')].find(n=>n.dataset.postKey===anchor.key),rect=card?.getBoundingClientRect?.();const offset=rect&&anchor.height&&anchor.width!==window.innerWidth?anchor.offset*rect.height/anchor.height:anchor.offset;window.scrollTo?.({top:Math.max(0,rect?window.scrollY+rect.top-offset:anchor.y),behavior:'instant'});};
  if(typeof requestAnimationFrame==='undefined'){apply();restoringPosition=false;return;}
  let start=null;const events=['pointerdown','wheel','touchstart','keydown'];
  const finish=()=>{for(const type of events)window.removeEventListener(type,cancel);if(epoch===positionEpoch){restoringPosition=false;checkpointSession();}};
  const cancel=()=>{finish();positionEpoch++;};for(const type of events)window.addEventListener(type,cancel,{once:true,passive:true});
  const frame=time=>{if(epoch!==positionEpoch||token!==generation){finish();return;}start??=time;apply();if(time-start<600)requestAnimationFrame(frame);else finish();};
  requestAnimationFrame(frame);
}
function reload({refresh=false}={}){
  checkpointSession();generation++;feedAbort.abort();feedAbort=new AbortController();searchPager=null;pagerState=null;busy=false;done=false;page=0;posts=[];closeViewer();clearFeedVideos();$('grid').replaceChildren();showNotice();renderTags();updateView();
  activeSessionKey=sessionKey();const candidate=!refresh&&sessions.get(activeSessionKey),cached=candidate?.pager?candidate:null;
  if(tab==='saved'){try{validateOrTags(selected);}catch(error){showNotice(error.message);$('more').hidden=true;$('status').textContent='Проверьте группу ИЛИ.';return;}posts=saved.filter(p=>matchesTags(p,selected));renderPosts();$('more').hidden=true;$('status').textContent=posts.length?'':'Сохранённых постов по этим тегам пока нет.';}
  else if(tab==='feed'){
    if(cached){pagerState=cached.pager;posts=[...cached.posts];page=cached.page;done=cached.done;const s={...source()},signal=feedAbort.signal;searchPager=createSearchPager(s,effectiveTags(s),sort,(q,p,l)=>get(makeRequest(s,q,p,l),'posts',signal),{state:cached.pager});renderPosts();$('status').textContent='';$('more').hidden=done;restorePosition(cached.anchor);}
    else{sessions.set(activeSessionKey,{key:activeSessionKey,hash:routeFor(),sourceName:source().name,at:Date.now(),posts:[],heights:{}});window.scrollTo?.({top:0});load();}
  }
}
async function load(){
  if(busy||done||tab!=='feed')return;
  const token=generation,s={...source()};busy=true;$('more').hidden=true;$('status').textContent='Загружаем посты…';
  try{
    if(!searchPager){const signal=feedAbort.signal;searchPager=createSearchPager(s,effectiveTags(s),sort,(q,p,l)=>get(makeRequest(s,q,p,l),'posts',signal));}const result=await searchPager.next();const rows=result.items;
    if(token!==generation)return;
    const keys=new Set(posts.map(p=>p.key));const fresh=rows.filter(p=>{if(keys.has(p.key)||reading.hideSeen&&!filtersBypassed&&seenPosts.has(p.key))return false;keys.add(p.key);return true;});posts.push(...fresh);page++;done=result.done;pagerState=searchPager.snapshot();
    rememberTags(s,rows);renderPosts(fresh,true);showNotice();checkpointSession();
    if(fresh[0]){covers[s.id]=fresh[0].preview;persist('bp.covers',covers);}
    $('status').textContent=!posts.length?(done?'Ничего не найдено. Попробуйте другие теги.':'В этой части ответа нет доступных медиа. Можно загрузить следующую страницу.'):done?'Все посты загружены':'';
  }catch(e){if(token!==generation||feedAbort.signal.aborted)return;const message=e.message==='Failed to fetch'?'Источник недоступен. Проверьте API и подключение к сети.':e.message;$('status').replaceChildren(el('p','',s.name+': '+message),button('Повторить загрузку','soft-button',load),button('Настройки источника','soft-button',()=>openSource(s.id)));showNotice(message);}
  finally{if(token===generation){busy=false;$('more').hidden=done;}}
}
let favoriteBusy=false,undoPost=null,undoTimer=null;const favoriteQueue=[];
async function toggleFavorite(p){
  if(favoriteBusy){favoriteQueue.push(p);return;}favoriteBusy=true;const removing=isSaved(p),next=removing?saved.filter(x=>x.key!==p.key):[{...p,savedAt:Date.now()},...saved];
  try{
    if(library)await library.favorite(removing?p:next[0],removing);else if(!persist('bp.saved',next))return;
    saved=next;count();if(removing){undoPost=p;$('undoNotice').hidden=false;clearTimeout(undoTimer);undoTimer=setTimeout(()=>{$('undoNotice').hidden=true;undoPost=null;},8000);undoTimer.unref?.();}else if(undoPost?.key===p.key){$('undoNotice').hidden=true;undoPost=null;clearTimeout(undoTimer);}
    for(const n of document.querySelectorAll('[data-favorite-key]'))if(n.dataset.favoriteKey===p.key){n.textContent=isSaved(p)?'♥':'♡';n.classList.toggle('saved',isSaved(p));n.setAttribute('aria-pressed',String(isSaved(p)));n.setAttribute('aria-label',isSaved(p)?'Убрать из сохранённых':'Сохранить пост');}
    if(viewerItems[current]?.key===p.key)$('savePost').textContent=isSaved(p)?'♥ Пост сохранён':'♡ Сохранить пост';
    if(tab==='saved')reload();
  }catch{showNotice('Пост не сохранён: не удалось записать библиотеку. Освободите место и повторите.');}
  finally{favoriteBusy=false;const queued=favoriteQueue.shift();if(queued)toggleFavorite(queued);}
}
function renderPosts(items=posts,append=false){
  if(!append){clearFeedVideos();$('grid').replaceChildren();}
  if(tab==='saved'){
    for(const group of groupSavedPosts(items)){
      const section=el('section','saved-group');section.dataset.booru=group.source.id;
      const heading=el('h2','saved-group-heading');heading.append(mark(group.source),el('span','',group.source.name),el('span','count',String(group.posts.length)));
      const grid=el('div',view==='list'?'posts-list':'posts-grid');section.append(heading,grid);$('grid').append(section);renderPostCards(group.posts,grid);
    }
  }else renderPostCards(items,$('grid'));
}
function mediaFailure(container,retry,post){
  if(container.querySelector('.media-error'))return;
  const error=el('div','media-error');error.setAttribute('role','status');
  error.append(el('span','','Не удалось загрузить медиа'),button('Повторить','soft-button',()=>{error.remove();retry();}));
  const original=el('a','soft-button','Открыть оригинал ↗');original.href=originalPostUrl(post);original.target='_blank';original.rel='noopener noreferrer';error.append(original);container.append(error);
}
const seenTimers=new Map();
const seenObserver=new IntersectionObserver(entries=>{for(const entry of entries){
  const card=entry.target,key=card.dataset.postKey;clearTimeout(seenTimers.get(key));seenTimers.delete(key);
  if(entry.isIntersecting&&entry.intersectionRatio>=.25&&reading.markSeen&&!seenPosts.has(key))seenTimers.set(key,setTimeout(()=>{
    seenTimers.delete(key);seenPosts.add(key);let remove;if(seenPosts.size>5000){remove=seenPosts.values().next().value;seenPosts.delete(remove);}card.classList.add('seen-post');
    if(library)library.markSeen({key,at:Date.now()},remove).catch(()=>{});
  },1000));
}},{threshold:[0,.25]});
const virtualCards=new WeakMap();
const cardObserver=new IntersectionObserver(entries=>{
  for(const entry of entries){const card=entry.target,meta=virtualCards.get(card);if(!meta)continue;
    if(entry.isIntersecting){if(!card.children.length){const temporary=el('div');renderPostCards([meta.post],temporary,true);const built=temporary.children[0];card.style.height='';card.classList.remove('post-placeholder');card.append(...built.children);}}
    else if(card.children.length&&!card.contains?.(document.activeElement)){
      const height=card.getBoundingClientRect?.().height;if(!height)continue;
      const session=sessions.get(meta.session);if(session){session.heights||={};session.heights[meta.post.key]=height;}
      for(const video of card.querySelectorAll('video'))feedVideoObserver.unobserve(video);releaseMedia(card);card.style.height=height+'px';card.replaceChildren();card.classList.add('post-placeholder');
    }
  }
},{rootMargin:(slowConnection()?'600':'1600')+'px 0px'});
function prepareCard(card,post){
  if(!card.getBoundingClientRect)return;
  virtualCards.set(card,{post,session:activeSessionKey});
  const height=sessions.get(activeSessionKey)?.heights?.[post.key];
  const index=posts.findIndex(p=>p.key===post.key);
  if(index>8){const width=view==='list'?Math.min(790,$('grid').clientWidth):Math.max(100,$('grid').clientWidth/(window.innerWidth<600?2:4)-12);card.style.height=(height||Math.min(900,width*post.height/post.width)+112)+'px';releaseMedia(card);card.replaceChildren();card.classList.add('post-placeholder');}
  cardObserver.observe(card);seenObserver.observe(card);
}
function renderPostCards(items,target,rebuilding=false){
  const fragment=document.createDocumentFragment();
  for(const p of items){
    const card=el('article','post');card.dataset.postKey=p.key;if(reading.markSeen&&seenPosts.has(p.key))card.classList.add('seen-post');const s=sources.find(x=>x.id===p.sourceId)||savedPostSource(p);
    const head=el('div','post-head');head.append(mark(s),el('span','',p.source||s.name),el('span','post-id','#'+p.id));card.append(head);
    let media;
    if(p.video&&view==='list'){media=el('div','post-media');const video=el('video');video.src=displayMedia(p.file);video.poster=displayMedia(p.preview);video.controls=true;video.playsInline=true;video.loop=true;video.preload='none';video.muted=sessionMuted;video.onerror=()=>mediaFailure(media,()=>{video.src=displayMedia(p.file);video.load?.();},p);media.append(video);feedVideoObserver.observe(video);}
    else {media=view==='grid'?button('','post-media',()=>openPost(posts.findIndex(x=>x.key===p.key))):el('div','post-media');if(view==='grid')media.setAttribute('aria-label','Открыть пост '+p.id);const image=el('img');image.src=displayMedia(view==='grid'?p.preview:feedImage(p));image.alt=p.tags.slice(0,8).join(', ');image.loading='lazy';image.decoding='async';image.style.aspectRatio=p.width+'/'+p.height;const primary=view==='grid'?p.preview:feedImage(p);let fallback=false;image.onerror=()=>{if(!fallback&&primary!==p.preview){fallback=true;image.src=displayMedia(p.preview);}else{image.alt='';mediaFailure(media,()=>{fallback=false;image.src=displayMedia(primary);},p);}};if(view==='list'){image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label','Рассмотреть пост '+p.id);image.onclick=()=>openPost(posts.findIndex(x=>x.key===p.key));image.onkeydown=e=>{if(e.key==='Enter')image.click();};}media.append(image);if(p.video)media.append(el('span','video-badge','▶ VIDEO'));}
    card.append(media);const footer=el('div','post-footer');const save=button(isSaved(p)?'♥':'♡',isSaved(p)?'saved':'',()=>toggleFavorite(p));save.classList.add('favorite-button');save.dataset.favoriteKey=p.key;save.setAttribute('aria-pressed',String(isSaved(p)));save.setAttribute('aria-label',isSaved(p)?'Убрать из сохранённых':'Сохранить пост');let open;if(view==='grid')open=button('Открыть','view-label',()=>openPost(posts.findIndex(x=>x.key===p.key)));else{open=el('a','post-original','Оригинал ↗');open.href=displayMedia(p.file);open.target='_blank';open.rel='noopener noreferrer';}
    const share=button('↗','share-post',()=>sharePost(p));share.setAttribute('aria-label','Поделиться постом '+p.id);share.title='Поделиться ссылкой на оригинальный пост';const download=el('a','download-post','↓');download.href=displayMedia(p.file);download.download=downloadFilename(p);download.setAttribute('aria-label','Скачать оригинал '+p.id);download.title='Скачать оригинал';const similar=button('Похожие','similar-post',()=>openSimilar(p));similar.setAttribute('aria-label','Похожие на пост '+p.id);const actions=el('details','post-menu');const summary=el('summary','','⋯');summary.setAttribute('aria-label','Действия с постом');const menu=el('div','post-menu-items');menu.append(download,share,similar);actions.append(summary,menu);footer.append(save,open,actions,el('span','post-score','↑ '+p.score));card.append(footer);
    const details=el('details','inline-tags');details.append(el('summary','','Теги · '+p.tags.length));const tags=el('div','grouped-tags');details.ontoggle=()=>{if(details.open&&!tags.children.length)renderGroupedTags(tags,p,addPostTag);};details.append(tags);card.append(details);if(!rebuilding)prepareCard(card,p);fragment.append(card);
  }
  target.append(fragment);
}
function renderGroupedTags(container,p,action){
  const groups=p.tagGroups&&typeof p.tagGroups==='object'?p.tagGroups:{general:p.tags};
  for(const {key,label}of TAG_GROUPS){if(!Array.isArray(groups[key])||!groups[key].length)continue;
    const block=el('section','tag-group');block.dataset.group=key;block.append(el('h3','',label));const list=el('div','post-tags');for(const tag of groups[key].slice(0,150))if(typeof tag==='string')list.append(routeLink('',routeFor(source(),mergeTags(selected,[{value:tag,excluded:false}]),{page:'feed',collection:''}),()=>action(tag),tag));block.append(list);container.append(block);
  }
}
function addPostTag(value){
  commitDraft();selected=mergeTags(selected,[{value,excluded:false}]);activeCollection=null;tab='feed';reload();window.scrollTo?.({top:0,behavior:'smooth'});
}
function openPost(index,items=posts){
  if(index<0||index>=items.length)return;viewerItems=items;current=index;const p=items[index];pauseMedia();releaseMedia($('media'));$('media').replaceChildren();
  const media=el(p.video?'video':'img');media.src=displayMedia(p.video?p.file:(reading.quality==='original'?p.file:(p.sample||p.file)));if(p.video){media.controls=true;media.playsInline=true;media.loop=true;media.muted=sessionMuted;media.onerror=()=>mediaFailure($('media'),()=>{media.src=displayMedia(p.file);media.load?.();},p);}else media.alt=p.tags.join(', ');
  $('media').classList.remove('image-stage');$('media').append(media);installViewerGestures(media,()=>openPost(current-1,viewerItems),()=>openPost(current+1,viewerItems));if(!p.video)media.onerror=()=>mediaFailure($('media'),()=>{media.src=displayMedia(p.file);},p);$('viewerSource').textContent=(p.source||'Booru')+' / #'+p.id;$('original').href=displayMedia(p.file);$('downloadPost').href=displayMedia(p.file);$('downloadPost').download=downloadFilename(p);$('savePost').textContent=isSaved(p)?'♥ Пост сохранён':'♡ Сохранить пост';$('tags').replaceChildren();
  renderGroupedTags($('tags'),p,addPostTag);
  $('previous').disabled=index===0;$('next').disabled=index===items.length-1;if(!$('viewer').open)$('viewer').showModal();
}
async function openSimilar(post){
  pauseMedia();const token=++similarToken;similarItems=[];$('similarGrid').replaceChildren();$('similarTitle').textContent='Похожие на #'+post.id;$('similarStatus').textContent='Ищем по тегам персонажа, автора и другим совпадениям…';if(!$('similarDialog').open)$('similarDialog').showModal();
  const descriptor=savedPostSource(post),s=sources.find(s=>s.id===post.sourceId)||sources.find(s=>sourceTemplate(s).id===descriptor.id)||descriptor;
  const plans=similarQueries(post);if(!plans.length){$('similarStatus').textContent='У поста нет подходящих тегов для подбора.';return;}
  const constraints=effectiveTags(s,selected).filter(t=>t.excluded||/^rating:/.test(t.value));const rows=[];let failed=false;
  for(const plan of plans){
    if(token!==similarToken)return;$('similarStatus').textContent='Ищем: '+plan.label.toLowerCase()+'…';
    try{const query=searchTags(s,mergeTags(parseTags(plan.query),constraints),'score');const payload=await get(makeRequest(s,query,0,12));rows.push(...normalizePosts(payload,s));}catch{failed=true;}
  }
  if(token!==similarToken)return;
  similarItems=rankSimilarPosts(post,rows);
  for(const [index,p]of similarItems.entries()){
    const card=button('','similar-card',()=>{const items=similarItems;closeDialog('similarDialog');openPost(index,items);});card.setAttribute('aria-label','Открыть похожий пост '+p.id);const image=el('img');image.src=displayMedia(p.preview);image.alt='Пост #'+p.id;image.loading='lazy';card.append(image,el('span','','#'+p.id+' · ↑ '+p.score));$('similarGrid').append(card);
  }
  $('similarStatus').textContent=similarItems.length?'Совпадения по тегам. Визуальное сходство не анализируется.' :failed?'Не удалось получить подборку. Проверьте доступ к API источника.':'Других постов с подходящими тегами не найдено.';
}
$('similarClose').onclick=()=>closeDialog('similarDialog');$('similarDialog').onclose=()=>{similarToken++;};$('similarPost').onclick=()=>{if(viewerItems[current])openSimilar(viewerItems[current]);};
function applyTemplate(t){
  $('sourceTitle').value=t.name;$('sourceBase').value=t.base;$('sourceKind').value=t.kind;$('sourceUser').value='';$('sourceKey').value='';$('sourceMediaRelay').checked=mediaRelay[t.id]===true;updateSourceHint();
}
function updateSourceHint(){
  const kind=$('sourceKind').value;$('sourceUserLabel').textContent=kind==='gelbooru'?'User ID':'Логин';
  const t=sourceTemplate({base:$('sourceBase').value,name:$('sourceTitle').value});$('sourceHint').textContent=t?.hint||'Сервер поддерживает Safebooru, Rule34, Gelbooru, Danbooru и e621.';
  $('sourceMediaRow').hidden=!serverApi||!['gelbooru','e621'].includes(t?.id);
  for(const n of $('sourceTemplates').querySelectorAll('button'))n.classList.toggle('active',n.dataset.template===t?.id);
}
function openSource(id=null){
  editingSource=id;$('sourceEditorTitle').textContent=id?'Изменить booru':'Добавить booru';$('sourceError').hidden=true;$('deleteSource').hidden=!id;$('deleteSource').disabled=sources.length===1;$('deleteSource').title=sources.length===1?'Нужен хотя бы один источник':'';
  $('sourceTemplates').replaceChildren();for(const t of SOURCE_TEMPLATES){const n=button('','template-button',()=>applyTemplate(t));n.dataset.template=t.id;n.append(mark(t),el('span','',t.name));$('sourceTemplates').append(n);}
  const s=sources.find(s=>s.id===id);if(s){$('sourceTitle').value=s.name;$('sourceBase').value=s.base;$('sourceKind').value=s.kind;$('sourceUser').value=s.kind==='gelbooru'?s.userId||'':s.login||s.userId||'';$('sourceKey').value=s.apiKey||'';$('sourceMediaRelay').checked=mediaRelay[sourceTemplate(s).id]===true;updateSourceHint();}else applyTemplate(SOURCE_TEMPLATES[0]);
  if($('settings').open)closeDialog('settings');$('sourceEditor').showModal();
}
$('sourceForm').onsubmit=e=>{
  e.preventDefault();const base=httpsUrl($('sourceBase').value.trim());const kind=$('sourceKind').value,name=$('sourceTitle').value.trim();
  if(!base||!name){$('sourceError').textContent='Укажите название и HTTPS-адрес без логина и пароля.';$('sourceError').hidden=false;return;}
  if(!editingSource&&sources.length>=30){$('sourceError').textContent='Можно сохранить до 30 источников.';$('sourceError').hidden=false;return;}
  const user=$('sourceUser').value.trim();if(kind==='gelbooru'&&user&&!/^\d+$/.test(user)){$('sourceError').textContent='User ID — только число из настроек API аккаунта.';$('sourceError').hidden=false;return;}
  const s={id:editingSource||uid('source'),name,base,kind,userId:kind==='gelbooru'?user:'',login:kind!=='gelbooru'?user:'',apiKey:$('sourceKey').value.trim()};
  const provider=sourceTemplate(s).id;if(serverApi&&['gelbooru','e621'].includes(provider)){mediaRelay[provider]=$('sourceMediaRelay').checked;persist('bp.mediaRelay',mediaRelay);}
  sources=editingSource?sources.map(x=>x.id===editingSource?s:x):[...sources,s];activeId=s.id;invalidateCollectionCovers(true);persistSources();closeDialog('sourceEditor');suggestionCache.clear();for(const [key,entry]of sessions)if(JSON.parse(key)[0]===activeId)sessions.delete(key);activeSessionKey='';renderHome();if(tab==='feed')reload({refresh:true});else updateView();
};
$('deleteSource').onclick=()=>{if(sources.length===1)return;invalidateCollectionCovers();sources=sources.filter(s=>s.id!==editingSource);if(activeId===editingSource)activeId=sources[0].id;persistSources();closeDialog('sourceEditor');renderHome();if(tab==='feed')reload();};
function openCollection(id=null,targetSourceId=null){
  editingCollection=id;const c=collections.find(c=>c.id===id);$('collectionEditorTitle').textContent=c?'Изменить коллекцию':'Сохранить коллекцию';$('collectionName').value=c?.name||'';$('collectionQuery').value=c?.query||tagsQuery(mergeTags(selected,parseTags($('query').value)));$('collectionSort').value=c?.sort||sort;
  $('collectionSource').replaceChildren();const all=el('option','','Любой выбранный booru');all.value='*';$('collectionSource').append(all);for(const s of sources){const n=el('option','',s.name);n.value=s.id;$('collectionSource').append(n);}$('collectionSource').value=c?.sourceId||targetSourceId||activeId;$('deleteCollection').hidden=!c;
  if($('collectionsDialog').open)closeDialog('collectionsDialog');$('collectionEditor').showModal();
}
$('collectionForm').onsubmit=e=>{e.preventDefault();const c={id:editingCollection||uid('collection'),name:$('collectionName').value.trim(),query:tagsQuery(parseTags($('collectionQuery').value)),sourceId:$('collectionSource').value,sort:$('collectionSort').value,cover:''};if(!c.name)return;collections=editingCollection?collections.map(x=>x.id===editingCollection?c:x):[c,...collections];persist('bp.collections',collections);closeDialog('collectionEditor');renderCollections();};
$('deleteCollection').onclick=()=>{collections=collections.filter(c=>c.id!==editingCollection);persist('bp.collections',collections);closeDialog('collectionEditor');renderCollections();};
function applyCollection(c){
  if(c.sourceId!=='*'){if(!sources.some(s=>s.id===c.sourceId)){showNotice('Источник этой коллекции удалён. Измените источник в настройках коллекции.');return;}if(activeId!==c.sourceId)invalidateCollectionCovers();activeId=c.sourceId;persistSources();renderSourceSelect();}
  selected=parseTags(c.query);sort=c.sort;persist('bp.sort',sort);$('query').value='';activeCollection=c.id;tab='feed';reload();window.scrollTo?.({top:0,behavior:'smooth'});
}
function renderManage(){ $('manageSources').replaceChildren();for(const s of sources){const n=button('','manage-row',()=>openSource(s.id));const text=el('span');text.append(el('strong','',s.name),el('small','',sourceAuthWarning(s)||new URL(s.base).hostname));n.append(mark(s),text,el('span','edit-mark','✎'));$('manageSources').append(n);} }
$('exportKeys').checked=read('bp.exportKeys',true)===true;
$('exportSaved').onclick=()=>{
  const includeKeys=$('exportKeys').checked;persist('bp.exportKeys',includeKeys);const data={version:3,sources:sources.map(s=>{const copy={...s};if(!includeKeys)delete copy.apiKey;return copy;}),collections,saved,activeId,view,sort,mediaRelay,collectionPresets:appliedCollectionPresets,sourceDefaults:appliedSourceDefaults,covers,reading};const body=JSON.stringify(data,null,2);
  if(port){port.postMessage(JSON.stringify({id:String(++serial),op:'export',body}));return;}
  const a=el('a');a.href=URL.createObjectURL(new Blob([body],{type:'application/json'}));a.download='booru-pocket-library.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
$('importSaved').onchange=async e=>{
  try{
    const file=e.target.files[0];if(!file)return;if(file.size>20*1024*1024)throw new Error('Файл больше 20 МБ');let data=JSON.parse(await file.text());if(data&&!Array.isArray(data)&&data.source&&!data.sources)data={...data,sources:[data.source]};
    const legacy=Array.isArray(data);if(!legacy&&(!data||typeof data!=='object'))throw new Error('Ожидается JSON библиотеки');
    const incoming=legacy?data:data.saved||[];if(!Array.isArray(incoming)||!legacy&&!['saved','sources','collections'].some(k=>Array.isArray(data[k])))throw new Error('Ожидается библиотека или массив публикаций');
    const sourceAliases=new Map();let restoredKeys=0;
    let nextSources=[...sources],nextCollections=collections,nextActive=activeId,nextView=view,nextSort=sort,nextRelay=mediaRelay,nextCovers={...covers},nextPresets=appliedCollectionPresets,nextDefaults=appliedSourceDefaults;
    const nextSaved=[...new Map([...saved,...sanitizeFavorites(incoming)].map(p=>[p.key,p])).values()];
    if(!legacy){
      if(data.sources!==undefined){
        if(!Array.isArray(data.sources)||data.sources.length>30)throw new Error('Недопустимый список booru');
        for(const entry of data.sources){
          const raw={...entry};if(!Object.hasOwn(raw,'apiKey')&&Object.hasOwn(raw,'api_key'))raw.apiKey=raw.api_key;if(!Object.hasOwn(raw,'userId')&&Object.hasOwn(raw,'user_id'))raw.userId=raw.user_id;if(!Object.hasOwn(raw,'login')&&Object.hasOwn(raw,'username'))raw.login=raw.username;
          if(!entry||typeof raw.name!=='string'||!httpsUrl(raw.base)||!['gelbooru','danbooru','e621'].includes(raw.kind)||Object.hasOwn(raw,'apiKey')&&(typeof raw.apiKey!=='string'||raw.apiKey.length>512))throw new Error('Недопустимые настройки booru');
          const s=sanitizeSources([raw])[0];const existing=nextSources.find(x=>x.id===s.id);
          if(typeof raw.apiKey==='string'&&raw.apiKey.trim()){s.apiKey=raw.apiKey.trim();restoredKeys++;}else if(existing)s.apiKey=existing.apiKey||'';
          const provider=sourceTemplate(s).id;const builtin=nextSources.find(x=>x.id!==s.id&&!data.sources.some(raw=>raw?.id===x.id)&&(x.id==='builtin-'+provider||x.id===provider)&&sourceTemplate(x).id===provider&&!x.apiKey);
          if(builtin){sourceAliases.set(builtin.id,s.id);nextSources=nextSources.filter(x=>x.id!==builtin.id);nextCollections=nextCollections.map(c=>c.sourceId===builtin.id?{...c,sourceId:s.id}:c);if(nextActive===builtin.id)nextActive=s.id;}
          nextSources=[...new Map([...nextSources,s].map(x=>[x.id,x])).values()];
        }
        if(nextSources.length>30)throw new Error('После импорта будет больше 30 booru');
      }
      if(data.collections!==undefined){if(!Array.isArray(data.collections))throw new Error('Недопустимый список коллекций');nextCollections=[...new Map([...nextCollections,...sanitizeCollections(data.collections).map(c=>({...c,sourceId:sourceAliases.get(c.sourceId)||c.sourceId}))].map(c=>[c.id,c])).values()].slice(0,200);}
      if(nextSources.some(s=>s.id===data.activeId))nextActive=data.activeId;
      if(['list','grid'].includes(data.view))nextView=data.view;if(['new','score','score_asc','random','old'].includes(data.sort))nextSort=data.sort;
      if(data.mediaRelay&&typeof data.mediaRelay==='object'){nextRelay={...mediaRelay};for(const id of ['gelbooru','e621'])if(typeof data.mediaRelay[id]==='boolean')nextRelay[id]=data.mediaRelay[id];}
      if(data.covers&&typeof data.covers==='object')for(const [id,url]of Object.entries(data.covers))if(nextSources.some(s=>s.id===id)&&httpsUrl(url))nextCovers[id]=httpsUrl(url);
      if(Array.isArray(data.collectionPresets))nextPresets=[...new Set([...appliedCollectionPresets,...data.collectionPresets.filter(x=>typeof x==='string')])].slice(0,2000);
      if(Array.isArray(data.sourceDefaults))nextDefaults=[...new Set([...appliedSourceDefaults,...data.sourceDefaults.filter(x=>SOURCE_TEMPLATES.some(t=>t.id===x))])];
    }
    if(library)await library.replacePosts(nextSaved);else if(!persist('bp.saved',nextSaved))throw new Error('Не удалось сохранить посты');
    if(!legacy&&data.reading&&typeof data.reading==='object'){const prefs=data.reading;reading={quality:['auto','preview','original'].includes(prefs.quality)?prefs.quality:reading.quality,markSeen:prefs.markSeen===true,hideSeen:prefs.hideSeen===true,exclusions:{...reading.exclusions}};if(prefs.exclusions&&typeof prefs.exclusions==='object')for(const [id,value]of Object.entries(prefs.exclusions))if(typeof value==='string'&&value.length<=2000&&nextSources.some(s=>s.id===(sourceAliases.get(id)||id)))reading.exclusions[sourceAliases.get(id)||id]=value;persist('bp.reading',reading);}
    sources=nextSources;collections=nextCollections;saved=nextSaved;activeId=nextActive;view=nextView;sort=nextSort;mediaRelay=nextRelay;covers=nextCovers;appliedCollectionPresets=nextPresets;appliedSourceDefaults=nextDefaults;
    invalidateCollectionCovers();persistSources();persist('bp.view',view);persist('bp.sort',sort);persist('bp.mediaRelay',mediaRelay);persist('bp.covers',covers);count();renderHome();closeDialog('settings');if(tab!=='home')reload();else updateView();showNotice(legacy?'Импортированы посты. Этот файл не содержит настроек booru и API-ключей.':'Библиотека импортирована: booru, коллекции, посты и настройки. '+(restoredKeys?'API-ключей восстановлено: '+restoredKeys+'.':'API-ключей в файле нет. Имеющиеся ключи сохранены; для переноса создайте новый экспорт с включёнными ключами.'));
  }catch(err){showNotice('Не удалось импортировать: '+err.message);}finally{e.target.value='';}
};
$('searchForm').onsubmit=e=>{e.preventDefault();runSearch();};$('clearQuery').onclick=()=>{selected=[];$('query').value='';renderTags();hideSuggestions();if(tab!=='home')reload();};
$('sourceSelect').onchange=()=>setActive($('sourceSelect').value);
$('sort').onchange=()=>{const next=$('sort').value;commitDraft();selected=selected.filter(t=>!(/^(sort|order):/.test(t.value)));sort=next;persist('bp.sort',sort);renderTags();if(tab!=='home')reload();};
function changeView(next){
  checkpointSession();const cached=sessions.get(activeSessionKey);view=next;persist('bp.view',view);
  if(tab==='feed'&&cached){const key=sessionKey();sessions.set(key,{...cached,key,hash:routeFor(),heights:{}});}
  reload();
}
$('listView').onclick=()=>changeView('list');$('gridView').onclick=()=>changeView('grid');
$('brandHome').onclick=()=>showTab('home');$('homeTab').onclick=()=>showTab('home');$('feedTab').onclick=()=>showTab('feed');$('savedTab').onclick=()=>showTab('saved');$('more').onclick=load;
new IntersectionObserver(entries=>{if(entries[0].isIntersecting&&posts.length>0)load();},{rootMargin:slowConnection()?'250px':'700px'}).observe($('sentinel'));
$('sourceKind').onchange=updateSourceHint;$('sourceBase').oninput=updateSourceHint;
$('addSource').onclick=()=>openSource();$('addSourceFromSettings').onclick=()=>openSource();$('sourceClose').onclick=()=>closeDialog('sourceEditor');
$('newCollection').onclick=()=>openCollection();$('saveCollection').onclick=()=>openCollection();$('collectionClose').onclick=()=>closeDialog('collectionEditor');$('collectionsOpen').onclick=()=>{renderCollections();$('collectionsDialog').showModal();};$('collectionsClose').onclick=()=>closeDialog('collectionsDialog');$('createCollectionFromPicker').onclick=()=>openCollection();
$('settingsOpen').onclick=()=>{renderManage();$('settings').showModal();};$('settingsClose').onclick=()=>closeDialog('settings');
$('closeViewer').onclick=closeViewer;$('viewer').onclose=()=>{releaseMedia($('media'));$('media').replaceChildren();viewerItems=[];};$('previous').onclick=()=>openPost(current-1,viewerItems);$('next').onclick=()=>openPost(current+1,viewerItems);$('savePost').onclick=()=>{if(viewerItems[current])toggleFavorite(viewerItems[current]);};
document.addEventListener('keydown',e=>{if($('viewer').open&&!$('similarDialog').open){if(e.key==='ArrowLeft')openPost(current-1,viewerItems);if(e.key==='ArrowRight')openPost(current+1,viewerItems);}});
async function shareLink(url,title='Booru Pocket'){
  try{if(navigator.share)await navigator.share({title,url});else if(navigator.clipboard){await navigator.clipboard.writeText(url);showNotice('Ссылка скопирована.');}else showNotice('Ссылка: '+url);}catch(error){if(error.name!=='AbortError')showNotice('Ссылка: '+url);}
}
function sharePost(post){const url=originalPostUrl(post);if(!url){showNotice('У поста нет ссылки на оригинал.');return;}return shareLink(url,(post.source||'Booru')+' · #'+post.id);}
$('undoFavorite').onclick=()=>{if(undoPost&&!isSaved(undoPost))toggleFavorite(undoPost);};
$('clearHistory').onclick=async()=>{try{if(library){await library.clearSessions();await library.clearSeen();}seenPosts.clear();sessions.clear();activeSessionKey='';persist('bp.lastSession',null);updateResume();$('updateStatus').textContent='История просмотра очищена.';}catch{$('updateStatus').textContent='Не удалось очистить историю. Повторите.';}};
function openReading(){
  $('readingSource').textContent=source().name;$('permanentExclusions').value=String(reading.exclusions[activeId]||'');$('mediaQuality').value=reading.quality;$('markSeen').checked=reading.markSeen;$('hideSeen').checked=reading.hideSeen;$('readingDialog').showModal();
}
$('readingOpen').onclick=openReading;$('readingSettings').onclick=()=>{closeDialog('settings');openReading();};$('readingClose').onclick=()=>closeDialog('readingDialog');
$('readingForm').onsubmit=event=>{event.preventDefault();const exclusions=parseTags($('permanentExclusions').value).filter(t=>!t.any&&!t.value.includes(':')).map(t=>t.value).join(' ');const next={quality:$('mediaQuality').value,markSeen:$('markSeen').checked||$('hideSeen').checked,hideSeen:$('hideSeen').checked,exclusions:{...reading.exclusions,[activeId]:exclusions}};if(!persist('bp.reading',next))return;reading=next;filtersBypassed=false;invalidateCollectionCovers(true);delete covers[activeId];persist('bp.covers',covers);closeDialog('readingDialog');if(tab==='feed')reload({refresh:true});else if(tab==='saved'){renderPosts();}else renderHome();};
$('showHidden').onclick=()=>{filtersBypassed=!filtersBypassed;$('showHidden').textContent=filtersBypassed?'Применять фильтры просмотра':'Показать скрытое';if(tab==='feed')reload({refresh:true});};
$('refreshFeed').onclick=()=>reload({refresh:true});
$('resumeFeed').onclick=()=>{const entry=sessions.get(read('bp.lastSession',{})?.key);if(entry){window.history.pushState({booruPocket:true},'',entry.hash);restoreRoute(true);}};
$('shareSearch').onclick=()=>shareLink(new URL(routeFor(),window.location.href).href,$('feedTitle').textContent);
$('sharePost').onclick=()=>{if(viewerItems[current])sharePost(viewerItems[current]);};
count();persistSources();renderHome();renderTags();initNavigation();updateResume();if(storageUnavailable)showNotice('Расширенное хранилище недоступно. Посты сохраняются в памяти браузера; создавайте резервные копии.');

let installPrompt=null,waitingWorker=null,applyingUpdate=false;
function updateInstallButton(){
  const standalone=window.matchMedia?.('(display-mode: standalone)').matches||(typeof navigator!=='undefined'&&navigator.standalone);
  $('installApp').hidden=!serverApi||!!port||!window.isSecureContext||!!standalone;
}
if(serverApi&&typeof navigator!=='undefined'){
  updateInstallButton();
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;updateInstallButton();});
  window.addEventListener('appinstalled',()=>{installPrompt=null;$('installApp').hidden=true;$('installHint').hidden=true;});
  if('serviceWorker' in navigator&&window.isSecureContext){
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(applyingUpdate)window.location.reload();});
    navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(registration=>{
      const offer=()=>{waitingWorker=registration.waiting;if(waitingWorker){$('updateApp').hidden=false;$('updateStatus').textContent='Обновление готово. Позиция просмотра и библиотека сохранятся.';}};
      offer();registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)offer();});});
      $('updateApp').onclick=async()=>{await checkpointSession();if(waitingWorker){applyingUpdate=true;waitingWorker.postMessage('APPLY_UPDATE');}};
      registration.update().catch(()=>{});
    }).catch(()=>{ $('installHint').textContent='Не удалось подготовить установку. Обновите страницу при доступном интернете.';$('installHint').hidden=false; });
  }
}
$('installApp').onclick=async()=>{
  if(installPrompt){const prompt=installPrompt;installPrompt=null;try{await prompt.prompt();await prompt.userChoice;}catch{}return;}
  $('installHint').textContent='В Chrome откройте меню ⋮ → «Добавить на главный экран» → «Установить». На iPhone: Safari → «Поделиться» → «На экран Домой». Если установка ещё недоступна, обновите страницу онлайн.';$('installHint').hidden=false;
};

$('searchOptions').addEventListener?.('click',event=>{if(event.target.closest('button'))$('searchOptions').open=false;});
