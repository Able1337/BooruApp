import {makeRequest,normalizePosts,httpsUrl,postRows,sanitizeFavorites,SOURCE_TEMPLATES,sourceTemplate,sanitizeSources,parseTags,tagsQuery,mergeTags,searchTags,sanitizeCollections,makeSuggestionsRequest,normalizeSuggestions,TAG_GROUPS,metaSuggestions,sortFromTag,parseTagPayload,groupCollectionsBySource} from './core.mjs';
const $=id=>document.getElementById(id);
const el=(tag,cls='',text='')=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
const button=(text,cls,action)=>{const n=el('button',cls,text);n.type='button';n.onclick=action;return n;};
const uid=prefix=>prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function persist(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{showNotice('Не удалось сохранить данные: хранилище браузера заполнено.');return false;}}
function showNotice(text=''){ $('notice').textContent=text;$('notice').hidden=!text; }
let sources=sanitizeSources(read('bp.sources',null),read('bp.source',null));
let activeId=read('bp.activeId','');if(!sources.some(s=>s.id===activeId))activeId=sources[0].id;
let saved;try{saved=sanitizeFavorites(read('bp.saved',[]));}catch{saved=[];}
const seeds=[{id:'landscape',name:'Пейзажи',query:'landscape',sourceId:'*',sort:'new'},{id:'city',name:'Город',query:'city',sourceId:'*',sort:'new'},{id:'sky',name:'Небо',query:'sky',sourceId:'*',sort:'new'},{id:'top',name:'По оценке',query:'',sourceId:'*',sort:'score'}];
let collections=sanitizeCollections(read('bp.collections',seeds));
let covers=read('bp.covers',{});if(!covers||typeof covers!=='object'||Array.isArray(covers))covers={};
let selected=[],tab='home',sort=read('bp.sort','new'),view=read('bp.view','list');
if(!['new','score','score_asc','random','old'].includes(sort))sort='new';if(!['list','grid'].includes(view))view='list';
let posts=[],page=0,busy=false,done=false,generation=0,current=0,editingSource=null,editingCollection=null,activeCollection=null;
let port=null,serial=0,suggestionGeneration=0,suggestionTimer=null,suggestionActions=[],suggestionIndex=-1;
const pending=new Map(),suggestionCache=new Map(),knownTags=new Map();
const coverCache=new Map(),coverPending=new Set(),coverArts=new Map(),coverQueue=[];let coverActive=0,coverEpoch=0;
const coverObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const c=collections.find(c=>c.id===entry.target.dataset.collectionId);if(c)requestCollectionCover(c);coverObserver.unobserve(entry.target);}},{rootMargin:'200px'});
const serverApi=document.querySelector('meta[name="booru-api"]')?.content==='same-origin';
const source=()=>sources.find(s=>s.id===activeId)||sources[0];
function persistSources(){persist('bp.sources',sources);persist('bp.activeId',activeId);persist('bp.source',source());}
function mark(s){const t=sourceTemplate(s);const n=el('span','source-mark',t.mark);n.dataset.color=t.color;return n;}
function coverImage(url){const u=httpsUrl(url);if(!u)return null;const image=el('img','card-cover');image.src=u;image.alt='';image.loading='lazy';image.onerror=()=>image.remove();return image;}
function closeDialog(id){$(id).close();}
function pauseMedia(){const v=$('media').querySelector('video');if(v)v.pause();}
function closeViewer(){pauseMedia();closeDialog('viewer');}
function count(){ $('savedCount').textContent=String(saved.length); }
function isSaved(p){return saved.some(x=>x.key===p.key);}
window.addEventListener('message',event=>{
  if(event.data!=='booru-native-v1'||!event.ports?.[0]||port)return;
  port=event.ports[0];port.onmessage=message=>{let r;try{r=JSON.parse(message.data);}catch{return;}const p=pending.get(r.id);if(!p)return;clearTimeout(p.timer);pending.delete(r.id);if(r.error)p.reject(new Error(r.error));else try{p.resolve(p.kind==='tags'?parseTagPayload(r.body):JSON.parse(r.body));}catch{p.reject(new Error('Ответ API не является JSON'));}};
  $('mode').textContent='ANDROID';if(tab==='feed')reload();
});
function nativeGet(url,kind){return new Promise((resolve,reject)=>{const id=String(++serial);const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Время ожидания API истекло'));},35000);pending.set(id,{resolve,reject,timer,kind});try{port.postMessage(JSON.stringify({id,url}));}catch{clearTimeout(timer);pending.delete(id);reject(new Error('Соединение с Android потеряно. Перезагрузите интерфейс.'));}});}
async function get(url,kind='posts'){
  if(port)return nativeGet(url,kind);
  const options={credentials:'omit',signal:AbortSignal.timeout(30000)};
  if(serverApi){Object.assign(options,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});url='/api/'+kind;}
  const response=await fetch(url,options);let data;try{data=kind==='tags'&&!serverApi?parseTagPayload(await response.text()):await response.json();}catch{throw new Error('Источник вернул не JSON. Проверьте доступность API.');}
  if(!response.ok)throw new Error(serverApi&&typeof data.error==='string'?data.error:'Источник вернул HTTP '+response.status);return data;
}
function renderSourceSelect(){
  $('sourceSelect').replaceChildren();
  for(const s of sources){const o=el('option','',s.name);o.value=s.id;$('sourceSelect').append(o);}
  $('sourceSelect').value=activeId;const t=sourceTemplate(source());$('sourceMark').textContent=t.mark;$('sourceMark').dataset.color=t.color;$('sourceSelect').title=source().name;
}
function renderHome(){
  renderSourceSelect();$('sourceCards').replaceChildren();
  for(const s of sources){
    const card=el('article','source-card'+(s.id===activeId?' selected':''));card.dataset.color=sourceTemplate(s).color;
    const image=coverImage(covers[s.id]);if(image)card.append(image);
    const main=button('','source-card-main',()=>setActive(s.id,true));main.append(mark(s),el('strong','',s.name),el('small','',new URL(s.base).hostname+'  ↗'));
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
    const card=el('article','collection-card');card.dataset.collectionId=c.id;const main=button('','collection-card-main',()=>applyCollection(c));
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
  const query=searchTags(s,parseTags(c.query),c.sort);
  return {source:{...s},query,key:JSON.stringify([s.id,s.base,s.kind,s.userId||'',s.login||'',query])};
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
  try{const payload=await get(makeRequest(job.source,job.query,0,1));const first=normalizePosts(payload,job.source)[0];entry={url:first?.preview||'',at:Date.now()};}
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
  $('homeView').hidden=tab!=='home';$('feedView').hidden=tab==='home';$('viewToggle').hidden=tab==='home';
  for(const [id,key]of [['homeTab','home'],['feedTab','feed'],['savedTab','saved']])$(id).classList.toggle('active',tab===key);
  $('grid').className=view==='list'?'posts-list':'posts-grid';$('listView').setAttribute('aria-pressed',String(view==='list'));$('gridView').setAttribute('aria-pressed',String(view==='grid'));$('sort').value=sort;
  $('feedTitle').textContent=tab==='saved'?'Сохранённые посты':source().name;
  $('feedSubtitle').textContent=tab==='saved'?'Локальная библиотека публикаций':[new URL(source().base).hostname,sort==='score'?'По оценке':sort==='random'?'Случайные посты':'Сначала новые'].join(' · ');
}
function setActive(id,openFeed=false){
  if(!sources.some(s=>s.id===id))return;invalidateCollectionCovers();activeId=id;activeCollection=null;persistSources();hideSuggestions();renderHome();
  if(openFeed){tab='feed';reload();}else if(tab==='feed')reload();else updateView();
}
function showTab(next){tab=next;hideSuggestions();if(next==='home'){generation++;busy=false;showNotice();updateView();renderHome();}else reload();}
function renderTags(){
  $('selectedTags').replaceChildren();
  for(const t of selected){const chip=el('span','tag-chip'+(t.excluded?' excluded':''));
    const name=button(t.value,'tag-name',()=>{selected=selected.filter(x=>x.value!==t.value);renderTags();if(tab!=='home')reload();});name.title='Убрать тег';
    const exclude=button('⊘','exclude-toggle',()=>{t.excluded=!t.excluded;renderTags();if(tab!=='home')reload();});exclude.disabled=/^(sort|order):/.test(t.value);exclude.setAttribute('aria-label',(t.excluded?'Включить ':'Исключить ')+t.value);exclude.setAttribute('aria-pressed',String(t.excluded));chip.append(name,exclude);$('selectedTags').append(chip);
  }
  $('clearQuery').hidden=!selected.length&&!$('query').value;
}
function commitDraft(){selected=mergeTags(selected,parseTags($('query').value));const explicit=selected.filter(t=>!t.excluded&&/^(sort|order):/.test(t.value)).at(-1);if(explicit&&sortFromTag(explicit.value)){sort=sortFromTag(explicit.value);persist('bp.sort',sort);}$('query').value='';renderTags();hideSuggestions();}
function runSearch(){commitDraft();activeCollection=null;tab='feed';reload();}
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
  if(!prefix||prefix.length>80){hideSuggestions();return;}
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
  if(/\s/.test(value)){const last=value.match(/[^\s]*$/)[0];const complete=value.slice(0,value.length-last.length);selected=mergeTags(selected,parseTags(complete));$('query').value=last;renderTags();}
  $('clearQuery').hidden=!selected.length&&!$('query').value;
  if(!$('query').value){hideSuggestions();return;}suggestionTimer=setTimeout(suggest,250);
};
$('query').onfocus=()=>{if($('query').value)suggestionTimer=setTimeout(suggest,100);};
$('query').onblur=()=>{setTimeout(hideSuggestions,160);};
$('query').onkeydown=e=>{
  if(!$('suggestions').hidden&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const n=suggestionActions.length;suggestionIndex=(suggestionIndex+(e.key==='ArrowDown'?1:-1)+n)%n;for(const [i,node]of [...$('suggestions').querySelectorAll('.suggestion')].entries())node.setAttribute('aria-selected',String(i===suggestionIndex));$('query').setAttribute('aria-activedescendant','suggestion-'+suggestionIndex);}
  else if(e.key==='Enter'&&!$('suggestions').hidden&&suggestionIndex>=0){e.preventDefault();suggestionActions[suggestionIndex]?.();}else if(e.key==='Escape')hideSuggestions();
};
function reload(){
  generation++;busy=false;done=false;page=0;posts=[];closeViewer();$('grid').replaceChildren();showNotice();renderTags();updateView();
  if(tab==='saved'){posts=saved.filter(p=>selected.every(t=>t.excluded?!p.tags.includes(t.value):p.tags.includes(t.value)));renderPosts();$('more').hidden=true;$('status').textContent=posts.length?'':'Сохранённых постов по этим тегам пока нет.';}
  else if(tab==='feed')load();
}
async function load(){
  if(busy||done||tab!=='feed')return;
  const token=generation,s={...source()};busy=true;$('more').hidden=true;$('status').textContent='Загружаем посты…';
  try{
    const payload=await get(makeRequest(s,searchTags(s,selected,sort),page));const rows=normalizePosts(payload,s);
    if(token!==generation)return;
    const keys=new Set(posts.map(p=>p.key));const fresh=rows.filter(p=>{if(keys.has(p.key))return false;keys.add(p.key);return true;});posts.push(...fresh);page++;done=postRows(payload).length<30;
    rememberTags(s,rows);renderPosts(fresh,true);showNotice();
    if(fresh[0]){covers[s.id]=fresh[0].preview;persist('bp.covers',covers);}
    $('status').textContent=!posts.length?(done?'Ничего не найдено. Попробуйте другие теги.':'В этой части ответа нет доступных медиа. Можно загрузить следующую страницу.'):done?'Все посты загружены':'';
  }catch(e){if(token!==generation)return;$('status').textContent='Не удалось загрузить ленту.';showNotice((e.message==='Failed to fetch'?'Источник недоступен. Проверьте API и подключение к сети.':e.message)+' Можно повторить запрос или изменить источник.');}
  finally{if(token===generation){busy=false;$('more').hidden=done;}}
}
function toggleFavorite(p){
  saved=isSaved(p)?saved.filter(x=>x.key!==p.key):[p,...saved];persist('bp.saved',saved);count();
  if(tab==='saved'){reload();return;}
  for(const n of document.querySelectorAll('[data-favorite-key]'))if(n.dataset.favoriteKey===p.key){n.textContent=isSaved(p)?'♥':'♡';n.classList.toggle('saved',isSaved(p));n.setAttribute('aria-label',isSaved(p)?'Убрать из сохранённых':'Сохранить пост');}
  if(posts[current]?.key===p.key)$('savePost').textContent=isSaved(p)?'♥ Пост сохранён':'♡ Сохранить пост';
}
function renderPosts(items=posts,append=false){
  if(!append)$('grid').replaceChildren();const fragment=document.createDocumentFragment();
  for(const p of items){
    const card=el('article','post');const s=sources.find(x=>x.id===p.sourceId)||{name:p.source,base:p.page||p.file};
    const head=el('div','post-head');head.append(mark(s),el('span','',p.source||source().name),el('span','post-id','#'+p.id));card.append(head);
    let media;
    if(p.video&&view==='list'){media=el('div','post-media');const video=el('video');video.src=p.file;video.poster=p.preview;video.controls=true;video.playsInline=true;video.preload='none';media.append(video);}
    else {media=view==='grid'?button('','post-media',()=>openPost(posts.findIndex(x=>x.key===p.key))):el('div','post-media');if(view==='grid')media.setAttribute('aria-label','Открыть пост '+p.id);const image=el('img');image.src=view==='grid'?p.preview:(p.sample||p.file);image.alt=p.tags.slice(0,8).join(', ');image.loading='lazy';image.decoding='async';image.style.aspectRatio=p.width+'/'+p.height;let fallback=false;image.onerror=()=>{if(!fallback&&image.src!==p.preview){fallback=true;image.src=p.preview;}else image.alt='Медиа недоступно — откройте оригинал';};media.append(image);if(p.video)media.append(el('span','video-badge','▶ VIDEO'));}
    card.append(media);const footer=el('div','post-footer');const save=button(isSaved(p)?'♥':'♡',isSaved(p)?'saved':'',()=>toggleFavorite(p));save.dataset.favoriteKey=p.key;save.setAttribute('aria-label',isSaved(p)?'Убрать из сохранённых':'Сохранить пост');let open;if(view==='grid')open=button('Открыть','view-label',()=>openPost(posts.findIndex(x=>x.key===p.key)));else{open=el('a','post-original','Оригинал ↗');open.href=p.file;open.target='_blank';open.rel='noopener noreferrer';}
    footer.append(save,open,el('span','post-score','↑ '+p.score));card.append(footer);
    const details=el('details','inline-tags');details.append(el('summary','','Теги · '+p.tags.length));const tags=el('div','grouped-tags');renderGroupedTags(tags,p,tag=>{selected=mergeTags(selected,[{value:tag,excluded:false}]);tab='feed';reload();window.scrollTo?.({top:0,behavior:'smooth'});});details.append(tags);card.append(details);fragment.append(card);
  }
  $('grid').append(fragment);
}
function renderGroupedTags(container,p,action){
  const groups=p.tagGroups&&typeof p.tagGroups==='object'?p.tagGroups:{general:p.tags};
  for(const {key,label}of TAG_GROUPS){if(!Array.isArray(groups[key])||!groups[key].length)continue;
    const block=el('section','tag-group');block.dataset.group=key;block.append(el('h3','',label));const list=el('div','post-tags');for(const tag of groups[key].slice(0,150))if(typeof tag==='string')list.append(button(tag,'',()=>action(tag)));block.append(list);container.append(block);
  }
}
function openPost(index){
  if(index<0||index>=posts.length)return;current=index;const p=posts[index];pauseMedia();$('media').replaceChildren();
  const media=el(p.video?'video':'img');media.src=p.video?p.file:(p.sample||p.file);if(p.video){media.controls=true;media.playsInline=true;media.loop=true;}else media.alt=p.tags.join(', ');
  $('media').append(media);$('viewerSource').textContent=(p.source||'Booru')+' / #'+p.id;$('original').href=p.file;$('savePost').textContent=isSaved(p)?'♥ Пост сохранён':'♡ Сохранить пост';$('tags').replaceChildren();
  renderGroupedTags($('tags'),p,tag=>{closeViewer();selected=mergeTags(selected,[{value:tag,excluded:false}]);tab='feed';reload();});
  $('previous').disabled=index===0;$('next').disabled=index===posts.length-1;if(!$('viewer').open)$('viewer').showModal();
}
function applyTemplate(t){
  $('sourceTitle').value=t.name;$('sourceBase').value=t.base;$('sourceKind').value=t.kind;$('sourceUser').value='';$('sourceKey').value='';updateSourceHint();
}
function updateSourceHint(){
  const kind=$('sourceKind').value;$('sourceUserLabel').textContent=kind==='gelbooru'?'User ID':'Логин';
  const t=sourceTemplate({base:$('sourceBase').value,name:$('sourceTitle').value});$('sourceHint').textContent=t?.hint||'Сервер поддерживает Safebooru, Rule34, Gelbooru, Danbooru и e621.';
  for(const n of $('sourceTemplates').querySelectorAll('button'))n.classList.toggle('active',n.dataset.template===t?.id);
}
function openSource(id=null){
  editingSource=id;$('sourceEditorTitle').textContent=id?'Изменить booru':'Добавить booru';$('sourceError').hidden=true;$('deleteSource').hidden=!id;$('deleteSource').disabled=sources.length===1;$('deleteSource').title=sources.length===1?'Нужен хотя бы один источник':'';
  $('sourceTemplates').replaceChildren();for(const t of SOURCE_TEMPLATES){const n=button('','template-button',()=>applyTemplate(t));n.dataset.template=t.id;n.append(mark(t),el('span','',t.name));$('sourceTemplates').append(n);}
  const s=sources.find(s=>s.id===id);if(s){$('sourceTitle').value=s.name;$('sourceBase').value=s.base;$('sourceKind').value=s.kind;$('sourceUser').value=s.kind==='gelbooru'?s.userId||'':s.login||s.userId||'';$('sourceKey').value=s.apiKey||'';updateSourceHint();}else applyTemplate(SOURCE_TEMPLATES[0]);
  if($('settings').open)closeDialog('settings');$('sourceEditor').showModal();
}
$('sourceForm').onsubmit=e=>{
  e.preventDefault();const base=httpsUrl($('sourceBase').value.trim());const kind=$('sourceKind').value,name=$('sourceTitle').value.trim();
  if(!base||!name){$('sourceError').textContent='Укажите название и HTTPS-адрес без логина и пароля.';$('sourceError').hidden=false;return;}
  if(!editingSource&&sources.length>=30){$('sourceError').textContent='Можно сохранить до 30 источников.';$('sourceError').hidden=false;return;}
  const user=$('sourceUser').value.trim();if(kind==='gelbooru'&&user&&!/^\d+$/.test(user)){$('sourceError').textContent='User ID — только число из настроек API аккаунта.';$('sourceError').hidden=false;return;}
  const s={id:editingSource||uid('source'),name,base,kind,userId:kind==='gelbooru'?user:'',login:kind!=='gelbooru'?user:'',apiKey:$('sourceKey').value.trim()};
  sources=editingSource?sources.map(x=>x.id===editingSource?s:x):[...sources,s];activeId=s.id;invalidateCollectionCovers(true);persistSources();closeDialog('sourceEditor');suggestionCache.clear();renderHome();if(tab==='feed')reload();else updateView();
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
function renderManage(){ $('manageSources').replaceChildren();for(const s of sources){const n=button('','manage-row',()=>openSource(s.id));const text=el('span');text.append(el('strong','',s.name),el('small','',new URL(s.base).hostname));n.append(mark(s),text,el('span','edit-mark','✎'));$('manageSources').append(n);} }
$('exportSaved').onclick=()=>{
  const data={version:2,sources:sources.map(({apiKey,...s})=>s),collections,saved,activeId,view,sort};const body=JSON.stringify(data,null,2);
  if(port){port.postMessage(JSON.stringify({id:String(++serial),op:'export',body}));return;}
  const a=el('a');a.href=URL.createObjectURL(new Blob([body],{type:'application/json'}));a.download='booru-pocket-library.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
$('importSaved').onchange=async e=>{
  try{const file=e.target.files[0];if(!file)return;if(file.size>5*1024*1024)throw new Error('Файл больше 5 МБ');const data=JSON.parse(await file.text());
    const incoming=Array.isArray(data)?data:data?.saved;if(!Array.isArray(incoming))throw new Error('Ожидается библиотека или массив публикаций');
    saved=[...new Map([...saved,...sanitizeFavorites(incoming)].map(p=>[p.key,p])).values()];
    if(!Array.isArray(data)){
      if(Array.isArray(data.sources)&&data.sources.length){const imported=sanitizeSources(data.sources).map(s=>({...s,apiKey:''}));sources=[...new Map([...imported,...sources].map(s=>[s.id,s])).values()].slice(0,30);persistSources();}
      collections=[...new Map([...collections,...sanitizeCollections(data.collections)].map(c=>[c.id,c])).values()].slice(0,200);persist('bp.collections',collections);
    }
    persist('bp.saved',saved);count();renderHome();closeDialog('settings');if(tab!=='home')reload();showNotice('Библиотека импортирована. API-ключи введите отдельно для новых источников.');
  }catch(err){showNotice('Не удалось импортировать: '+err.message);}finally{e.target.value='';}
};
$('searchForm').onsubmit=e=>{e.preventDefault();runSearch();};$('clearQuery').onclick=()=>{selected=[];$('query').value='';renderTags();hideSuggestions();if(tab!=='home')reload();};
$('sourceSelect').onchange=()=>setActive($('sourceSelect').value);
$('sort').onchange=()=>{const next=$('sort').value;commitDraft();selected=selected.filter(t=>!(/^(sort|order):/.test(t.value)));sort=next;persist('bp.sort',sort);renderTags();if(tab!=='home')reload();};
$('listView').onclick=()=>{view='list';persist('bp.view',view);updateView();renderPosts();};$('gridView').onclick=()=>{view='grid';persist('bp.view',view);updateView();renderPosts();};
$('brandHome').onclick=()=>showTab('home');$('homeTab').onclick=()=>showTab('home');$('feedTab').onclick=()=>showTab('feed');$('savedTab').onclick=()=>showTab('saved');$('more').onclick=load;
new IntersectionObserver(entries=>{if(entries[0].isIntersecting&&posts.length>0)load();},{rootMargin:'700px'}).observe($('sentinel'));
$('sourceKind').onchange=updateSourceHint;$('sourceBase').oninput=updateSourceHint;
$('addSource').onclick=()=>openSource();$('addSourceFromSettings').onclick=()=>openSource();$('sourceClose').onclick=()=>closeDialog('sourceEditor');
$('newCollection').onclick=()=>openCollection();$('saveCollection').onclick=()=>openCollection();$('collectionClose').onclick=()=>closeDialog('collectionEditor');$('collectionsOpen').onclick=()=>{renderCollections();$('collectionsDialog').showModal();};$('collectionsClose').onclick=()=>closeDialog('collectionsDialog');$('createCollectionFromPicker').onclick=()=>openCollection();
$('settingsOpen').onclick=()=>{renderManage();$('settings').showModal();};$('settingsClose').onclick=()=>closeDialog('settings');
$('closeViewer').onclick=closeViewer;$('viewer').onclose=pauseMedia;$('previous').onclick=()=>openPost(current-1);$('next').onclick=()=>openPost(current+1);$('savePost').onclick=()=>{if(posts[current])toggleFavorite(posts[current]);};
document.addEventListener('keydown',e=>{if($('viewer').open){if(e.key==='ArrowLeft')openPost(current-1);if(e.key==='ArrowRight')openPost(current+1);}});
count();persistSources();renderHome();renderTags();updateView();
