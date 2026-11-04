export function httpsUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { const u = new URL(value, base); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function makeRequest(source, tags, page, limit = 30) {
  const base = httpsUrl(source.base);
  if (!base) throw new Error('Адрес источника должен начинаться с https://');
  const apiBase = new URL(base);
  // Rule34 serves DAPI on a separate host; keep source.base for post links and favorite keys.
  if (source.kind === 'gelbooru' && ['rule34.xxx', 'www.rule34.xxx'].includes(apiBase.hostname)) {
    apiBase.hostname = 'api.rule34.xxx';
  }
  if (source.kind === 'gelbooru' && apiBase.hostname === 'api.rule34.xxx') {
    if (!source.userId || !source.apiKey) throw new Error('Rule34 требует User ID и API key из раздела API Access Credentials в настройках аккаунта.');
    if (!/^\d+$/.test(source.userId) || /(?:api_key|user_id)=|\s/.test(source.apiKey)) {
      throw new Error('Введи только значения User ID и API key, без api_key=, user_id=, пробелов и частей URL.');
    }
  }
  const apiRoot = apiBase.href;
  const u = new URL(['danbooru','e621'].includes(source.kind) ? 'posts.json' : 'index.php', apiRoot.endsWith('/') ? apiRoot : apiRoot + '/');
  if (['danbooru','e621'].includes(source.kind)) {
    u.searchParams.set('page', String(page + 1));
  } else {
    for (const [key, value] of Object.entries({page:'dapi', s:'post', q:'index', json:'1', pid:String(page)})) u.searchParams.set(key, value);
  }
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('tags', tags.trim());
  if(apiBase.hostname==='api.rule34.xxx')u.searchParams.set('fields','tag_info');
  credentials(u,source);
  return u.href;
}
export function postRows(payload) {
  // Never display raw API errors: providers may echo credential-bearing request URLs.
  const errors = payload && !Array.isArray(payload) ? [payload.error, payload.message, payload.reason, payload['@attributes']?.reason] : [];
  const text = errors.filter(v => typeof v === 'string').join(' ').toLowerCase();
  if (/auth|api.?key|user.?id|credential|access denied|unauthorized|forbidden/.test(text)) {
    throw new Error('API отклонил авторизацию. Проверь пару User ID и API key в API Access Credentials своего аккаунта.');
  }
  if (/rate|too many|limit exceeded/.test(text)) throw new Error('Превышен лимит запросов API. Подожди минуту и повтори.');
  if (/search down|overload|maintenance/.test(text)) throw new Error('Поиск источника временно недоступен. Повтори позже.');
  if (text || payload?.success === false || payload?.success === 'false') throw new Error('API вернул сообщение об ошибке вместо списка публикаций. Проверь доступ API в аккаунте источника.');
  const rows = Array.isArray(payload) ? payload : payload?.post ?? payload?.posts;
  if (!Array.isArray(rows)) throw new Error('Источник вернул неожиданный формат данных');
  return rows;
}
export function normalizePosts(payload, source) {
  const siteBase=['rule34.xxx','www.rule34.xxx','api.rule34.xxx'].includes(new URL(source.base).hostname)?'https://rule34.xxx/':source.base;
  return postRows(payload).filter(p => p && typeof p === 'object' && p.id != null).map(p => {
    const file = httpsUrl(p.file_url || p.file?.url || p.large_file_url, source.base);
    const preview = httpsUrl(p.preview_file_url || p.preview_url || p.preview?.url || p.sample?.url || p.sample_url || p.file_url, source.base);
    const sample = httpsUrl(p.sample?.url || p.sample_url || p.large_file_url || p.file_url || p.file?.url, source.base);
    const ext = String(p.file_ext || p.file?.ext || file.split('?')[0].split('.').pop() || '').toLowerCase();
    const tags = p.tags&&typeof p.tags==='object'&&!Array.isArray(p.tags)?Object.values(p.tags).flat().filter(t=>typeof t==='string'):String(p.tag_string || p.tags || '').split(/\s+/).filter(Boolean);
    return {id:String(p.id), key:source.base+'#'+p.id, file, preview, sample:ext==='gif'?file:sample, tags, sourceId:source.id||'', tagGroups:normalizeTagGroups(p,tags), score:Number(p.score?.total??p.score)||0, ext,
      width:Number(p.image_width || p.width || p.file?.width)||800, height:Number(p.image_height || p.height || p.file?.height)||1000,
      video:['mp4','webm'].includes(ext), rating:p.rating || '', source:source.name,
      page:['danbooru','e621'].includes(source.kind) ? new URL('posts/'+p.id, source.base).href : new URL('index.php?page=post&s=view&id='+encodeURIComponent(p.id), siteBase).href};
  }).filter(p => p.id !== 'undefined' && p.preview && p.file);
}

export function sanitizeFavorites(data) {
  if (!Array.isArray(data)) throw new Error('Ожидается массив публикаций');
  return [...new Map(data.filter(p => p && typeof p.key === 'string' && typeof p.id === 'string' && httpsUrl(p.file) && httpsUrl(p.preview) && Array.isArray(p.tags) && p.tags.every(t => typeof t === 'string')).map(p => [p.key, {...p, file:httpsUrl(p.file), preview:httpsUrl(p.preview), sample:httpsUrl(p.sample) || httpsUrl(p.file), video:!!p.video}])).values()];
}

export const SOURCE_TEMPLATES = [
  {id:'rule34',name:'Rule34',base:'https://api.rule34.xxx/',kind:'gelbooru',mark:'34',color:'green',hint:'Нужны User ID и API key из API Access Credentials.'},
  {id:'gelbooru',name:'Gelbooru',base:'https://gelbooru.com/',kind:'gelbooru',mark:'G',color:'blue',hint:'Для API могут потребоваться User ID и API key.'},
  {id:'danbooru',name:'Danbooru',base:'https://danbooru.donmai.us/',kind:'danbooru',mark:'D',color:'red',hint:'Логин и API key необязательны для публичных запросов. Действуют лимиты источника.'},
  {id:'e621',name:'e621',base:'https://e621.net/',kind:'e621',mark:'e6',color:'gold',hint:'Логин и API key необязательны для публичного API.'},
  {id:'safebooru',name:'Safebooru',base:'https://safebooru.org/',kind:'gelbooru',mark:'S',color:'purple',hint:'Публичный API без ключа. Источник по умолчанию.'},
];
export function sourceTemplate(source) {
  const host=new URL(httpsUrl(source?.base)||'https://safebooru.org/').hostname;
  return SOURCE_TEMPLATES.find(t=>new URL(t.base).hostname===host||(t.id==='rule34'&&['rule34.xxx','www.rule34.xxx','api.rule34.xxx'].includes(host)))||{mark:(typeof source?.name==='string'?source.name:'B').slice(0,2).toUpperCase(),color:'purple'};
}
export function sanitizeSources(data,legacy) {
  const fallback={...SOURCE_TEMPLATES.find(t=>t.id==='safebooru')};
  const rows=Array.isArray(data)&&data.length?data:[legacy||fallback];
  const result=[];const ids=new Set();
  for(const [index,p]of rows.slice(0,30).entries()){
    if(!p||typeof p.name!=='string'||!httpsUrl(p.base)||!['gelbooru','danbooru','e621'].includes(p.kind))continue;
    let id=typeof p.id==='string'&&/^[\w-]{1,100}$/.test(p.id)?p.id:'source-'+index;
    if(ids.has(id))continue;ids.add(id);
    result.push({id,name:p.name.slice(0,60),base:httpsUrl(p.base),kind:p.kind,userId:String(p.userId||'').slice(0,100),login:String(p.login||'').slice(0,100),apiKey:String(p.apiKey||'').slice(0,512)});
  }
  return result.length?result:[fallback];
}
function canonicalTag(value){return /^(score|sort|order|rating):/i.test(value)?value.toLowerCase():value;}
export function parseTags(query) {
  const map=new Map();
  for(const raw of String(query||'').trim().split(/\s+/).filter(Boolean).slice(0,80)){
    const excluded=raw.startsWith('-'),value=canonicalTag((excluded?raw.slice(1):raw).slice(0,150));
    if(value){if(/^(sort|order):/.test(value))for(const key of map.keys())if(/^(sort|order):/.test(key))map.delete(key);map.set(value,{value,excluded});}
  }
  return [...map.values()];
}
export function tagsQuery(tags) { return tags.map(t=>(t.excluded?'-':'')+t.value).join(' '); }
export function mergeTags(current, incoming) { const map=new Map(current.map(t=>[t.value,t]));for(const t of incoming){if(/^(sort|order):/.test(t.value))for(const key of map.keys())if(/^(sort|order):/.test(key))map.delete(key);map.set(t.value,t);}return [...map.values()].slice(0,80); }
export function sortFromTag(value) {
  const raw=String(value||'').toLowerCase().replace(/^(sort|order):/,'');
  return ({score:'score','score:desc':'score',score_desc:'score','score:asc':'score_asc',score_asc:'score_asc',random:'random',new:'new',id:'new','id:desc':'new',id_desc:'new','id:asc':'old',id_asc:'old'})[raw]||null;
}
export function searchTags(source,tags,sort='new') {
  tags=tags.map(t=>({...t,value:canonicalTag(t.value)}));
  const isOrder=t=>/^(sort|order):/.test(t.value);
  const explicit=tags.filter(t=>isOrder(t)&&!t.excluded).at(-1);
  const query=tags.filter(t=>!isOrder(t));
  const mode=explicit?sortFromTag(explicit.value):sort;
  const dapi=source.kind==='gelbooru';
  const values=dapi?{new:'',score:'sort:score:desc',score_asc:'sort:score:asc',random:'sort:random',old:'sort:id:asc'}:{new:'',score:'order:score',score_asc:'order:score_asc',random:'order:random',old:'order:id_asc'};
  const suffix=mode?values[mode]||'':explicit?(dapi?'sort:':'order:')+explicit.value.replace(/^(sort|order):/,''):'';
  return [tagsQuery(query),suffix].filter(Boolean).join(' ');
}
export function metaSuggestions(source,prefix) {
  prefix=prefix.toLowerCase();
  if(!/^(score|sort|order)(:|$)/.test(prefix))return [];
  const order=prefix.startsWith('sort')?'sort':prefix.startsWith('order')?'order':source.kind==='gelbooru'?'sort':'order';
  const names=prefix.startsWith('score')?['score:>100','score:>500','score:>=50','score:<100']:order==='sort'?['sort:score:desc','sort:score:asc','sort:random','sort:id:desc','sort:id:asc']:['order:score','order:score_asc','order:random','order:id_desc','order:id_asc'];
  return names.filter(name=>name.startsWith(prefix)).map(name=>({name,count:0}));
}
export function sanitizeCollections(data) {
  if(!Array.isArray(data))return [];
  const map=new Map();
  for(const p of data.slice(0,200)){
    if(!p||typeof p.id!=='string'||typeof p.name!=='string'||typeof p.query!=='string')continue;
    map.set(p.id,{id:p.id.slice(0,100),name:p.name.slice(0,80),query:tagsQuery(parseTags(p.query)),sourceId:typeof p.sourceId==='string'?p.sourceId:'*',sort:['new','score','score_asc','random','old'].includes(p.sort)?p.sort:'new',cover:httpsUrl(p.cover),coverKey:typeof p.coverKey==='string'?p.coverKey.slice(0,4096):'',coverCheckedAt:Number.isFinite(p.coverCheckedAt)?Math.min(Date.now(),Math.max(0,p.coverCheckedAt)):0});
  }
  return [...map.values()];
}
export function makeSuggestionsRequest(source, prefix) {
  const clean=String(prefix||'').replace(/^[+-]/,'').replace(/[*%?]/g,'').trim().slice(0,80);
  if(!clean)return '';
  const root=new URL(source.base);
  if(['rule34.xxx','www.rule34.xxx','api.rule34.xxx'].includes(root.hostname)){
    const u=new URL('https://api.rule34.xxx/autocomplete.php');u.searchParams.set('q',clean);credentials(u,source);return u.href;
  }
  const u=new URL(source.kind==='e621'?'tags/autocomplete.json':source.kind==='danbooru'?'tags.json':'index.php',root.href.endsWith('/')?root.href:root.href+'/');
  if(source.kind==='danbooru'){u.searchParams.set('search[name_matches]',clean+'*');u.searchParams.set('search[order]','count');u.searchParams.set('limit','10');}
  else if(source.kind==='e621'){u.searchParams.set('search[name_matches]',clean);u.searchParams.set('limit','10');}
  else for(const[k,v]of Object.entries({page:'dapi',s:'tag',q:'index',json:'1',name_pattern:clean+'%',limit:'10',orderby:'count',order:'desc'}))u.searchParams.set(k,v);
  credentials(u,source);return u.href;
}
export function normalizeSuggestions(payload) {
  const rows=Array.isArray(payload)?payload:payload?.tag||payload?.tags||payload?.data;
  if(!Array.isArray(rows))return [];
  const map=new Map();
  for(const p of rows){
    const name=(typeof p==='string'?p:p?.name||p?.value||p?.label||'').replace(/\s*\([\d,.]+[kmb]?\)\s*$/i,'').trim();
    if(!name||/\s/.test(name)||name.length>150)continue;
    map.set(name,{name,count:Math.max(0,Number(p?.post_count||p?.count)||0)});
  }
  return [...map.values()].slice(0,12);
}
function credentials(u,source) {
  if(source.kind==='danbooru'||source.kind==='e621'){if(source.login)u.searchParams.set('login',source.login);}
  else if(source.userId)u.searchParams.set('user_id',source.userId);
  if(source.apiKey)u.searchParams.set('api_key',source.apiKey);
}

export const TAG_GROUPS = [
  {key:'copyright',label:'Вселенная'}, {key:'character',label:'Персонажи'},
  {key:'artist',label:'Авторы'}, {key:'species',label:'Виды'},
  {key:'general',label:'Общие'}, {key:'meta',label:'Метаданные'},
  {key:'lore',label:'Лор'}, {key:'invalid',label:'Прочие'},
];
export function normalizeTagGroups(post,flatTags=[]) {
  const groups={};const assigned=new Set();
  const add=(group,values)=>{
    if(!TAG_GROUPS.some(g=>g.key===group))group='general';
    const rows=Array.isArray(values)?values:typeof values==='string'?values.split(/\s+/):[];
    for(const name of rows){if(typeof name!=='string'||!name||assigned.has(name))continue;(groups[group]??=[]).push(name);assigned.add(name);}
  };
  // e621 provides a category map; Danbooru provides tag_string_<category>.
  for(const {key}of TAG_GROUPS){
    if(post.tags&&typeof post.tags==='object'&&!Array.isArray(post.tags))add(key,post.tags[key]);
    add(key,post['tag_string_'+key]);
  }
  const category={0:'general',1:'artist',3:'copyright',4:'character',5:'meta',6:'lore',7:'species',8:'invalid'};
  if(post.tag_info&&typeof post.tag_info==='object'){
    for(const [key,value]of Object.entries(post.tag_info)){
      if(TAG_GROUPS.some(g=>g.key===key)&&Array.isArray(value)&&value.every(t=>typeof t==='string')){add(key,value);continue;}
      const name=typeof value==='object'?value?.name||value?.tag||key:key;
      const type=Array.isArray(value)?value[0]:typeof value==='object'?value?.type??value?.category:value;
      if(flatTags.includes(name)||value?.name||value?.tag)add(category[type]||type,[name]);
    }
  }
  add('general',flatTags);return groups;
}

export function parseTagPayload(text) {
  try{return JSON.parse(text);}catch{}
  if(!/^\s*(?:<\?xml[^>]*>\s*)?<tags(?:\s|>|\/)/.test(text))throw new Error('Ответ подсказок не распознан');
  const decode=value=>value.replace(/&(?:amp|lt|gt|quot|apos);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"})[x]);
  const rows=[];
  for(const match of text.matchAll(/<tag\b([^>]*)>/g)){
    const fields={};for(const attr of match[1].matchAll(/([a-z_]+)="([^"]*)"/g))fields[attr[1]]=decode(attr[2]);
    if(fields.name)rows.push({name:fields.name,count:Number(fields.count)||0,category:Number(fields.type)||0});
    if(rows.length>=20)break;
  }
  return rows;
}

export function groupCollectionsBySource(collections,sources) {
  const known=new Set(sources.map(s=>s.id)),buckets=new Map();
  for(const c of collections){const id=c.sourceId==='*'?'*':known.has(c.sourceId)?c.sourceId:null;if(!buckets.has(id))buckets.set(id,[]);buckets.get(id).push(c);}
  return [...sources.map(s=>({id:s.id,name:s.name})),{id:'*',name:'Общие коллекции'},{id:null,name:'Источник удалён'}].filter(g=>buckets.has(g.id)).map(g=>({...g,items:buckets.get(g.id)}));
}

// Only public media paths on these providers' fixed CDN hosts may be relayed.
export function mediaTarget(value){
  if(typeof value!=='string'||value.length>2048)return null;
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)return null;
    const provider=/^img[1-9][0-9]?\.gelbooru\.com$/.test(u.hostname)?'gelbooru':/^static[1-9][0-9]?\.e621\.net$/.test(u.hostname)?'e621':null;
    const path=provider==='gelbooru'?/^\/+(images|samples|thumbnails)\/[a-zA-Z0-9/_-]+\.(jpe?g|png|gif|webp|avif|webm|mp4)$/:/^\/data\/(?:preview\/|sample\/)?[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{32}\.(jpe?g|png|gif|webp|avif|webm|mp4)$/;
    return provider&&path.test(u.pathname)?{url:u.href,provider}:null;
  }catch{return null;}
}
export function mediaUrl(value,enabled={}){const target=mediaTarget(value);return target&&enabled[target.provider]===true?'/media?url='+encodeURIComponent(target.url):value;}

export function encodeRoute({page='home',booru='',tags='',sort='new',view='list',collection=''}={}){
  if(page==='home')return '#home';
  const params=new URLSearchParams();
  if(booru)params.set('booru',booru.slice(0,100));
  if(tags)params.set('tags',tagsQuery(parseTags(tags)));
  if(['score','score_asc','random','old'].includes(sort))params.set('sort',sort);
  if(view==='grid')params.set('view','grid');
  if(collection)params.set('collection',collection.slice(0,100));
  return '#'+(page==='saved'?'saved':'feed')+(params.size?'?'+params:'');
}
export function decodeRoute(hash=''){
  const [page,query='']=hash.replace(/^#/,'').split('?');
  if(!['feed','saved'].includes(page))return {page:'home'};
  const p=new URLSearchParams(query.slice(0,16384));
  return {page,booru:(p.get('booru')||'').slice(0,100),tags:tagsQuery(parseTags(p.get('tags')||'')),sort:['score','score_asc','random','old'].includes(p.get('sort'))?p.get('sort'):'new',view:p.get('view')==='grid'?'grid':'list',collection:(p.get('collection')||'').slice(0,100)};
}

export function routeHistoryMode(previous,next){
  const a=decodeRoute(previous),b=decodeRoute(next);
  return ['page','booru','tags','sort','collection'].some(key=>a[key]!==b[key])?'pushState':'replaceState';
}

export function savedPostSource(post){
  const base=httpsUrl(typeof post.key==='string'?post.key.split('#')[0]:'')||httpsUrl(post.page);
  const preset=base?sourceTemplate({base}):null;
  const known=SOURCE_TEMPLATES.find(t=>t.id===preset?.id);
  if(known)return {...known};
  const host=base?new URL(base).hostname:'unknown';
  return {id:host,name:post.source||host,base:base||'',kind:'gelbooru'};
}
export function groupSavedPosts(posts){
  const groups=new Map();
  for(const post of posts){const source=savedPostSource(post);if(!groups.has(source.id))groups.set(source.id,{source,posts:[]});groups.get(source.id).posts.push(post);}
  return [...groups.values()];
}
export function originalPostUrl(post){
  const source=savedPostSource(post);
  if(!/^\d{1,20}$/.test(String(post.id))||!httpsUrl(source.base))return '';
  const base=source.id==='rule34'?'https://rule34.xxx/':source.base;
  return ['danbooru','e621'].includes(source.kind)?new URL('posts/'+post.id,base).href:new URL('index.php?page=post&s=view&id='+post.id,base).href;
}

export function relayFilename(url,provider,type=''){
  const extensions={'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp','image/avif':'avif','video/webm':'webm','video/mp4':'mp4'};
  const ext=extensions[type.split(';')[0].trim().toLowerCase()];
  const raw=new URL(url).pathname.split('/').pop().replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,160);
  const name=ext?raw.replace(/\.[^.]+$/,'')+'.'+ext:raw;
  return provider+'-'+name;
}
export function downloadFilename(post){
  const source=savedPostSource(post),raw=String(post.ext||new URL(post.file).pathname.split('.').pop()).toLowerCase();
  const ext=['jpg','jpeg','png','gif','webp','avif','webm','mp4'].includes(raw)?raw:'bin';
  return source.id.replace(/[^a-zA-Z0-9_-]/g,'_')+'-'+String(post.id).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,60)+'.'+ext;
}
export function similarQueries(post){
  const groups=post.tagGroups||{},queries=[],seen=new Set();
  const add=(label,tags)=>{const safe=tags.filter(t=>typeof t==='string'&&t&&!/[\s:]/.test(t)&&!t.startsWith('-')).slice(0,2);const query=safe.join(' ');if(query&&!seen.has(query)){seen.add(query);queries.push({label,query});}};
  add('Тот же персонаж',(groups.character||[]).slice(0,1));
  add('Тот же автор',(groups.artist||[]).slice(0,1));
  add('Та же вселенная',(groups.copyright||[]).slice(0,1));
  if(queries.length<3)add('Тот же вид',(groups.species||[]).slice(0,1));
  const common=new Set(['1girl','1boy','solo','duo','male','female','highres','absurdres','rating','signature','watermark','english_text','translation_request','commentary_request','simple_background','white_background','looking_at_viewer']);
  const tags=(groups.general||post.tags||[]).filter(t=>!common.has(t));
  if(queries.length<3)add('Общие теги',tags.slice(0,2));
  if(queries.length<3&&tags.length>1)add('Ещё по тегу',tags.slice(1,2));
  return queries.slice(0,3);
}
export function rankSimilarPosts(original,candidates){
  const weights=new Map((original.tags||[]).map(tag=>[tag,1]));
  for(const [group,weight]of [['artist',5],['character',8],['copyright',3],['species',2]])for(const tag of original.tagGroups?.[group]||[])weights.set(tag,weight);
  const unique=[...new Map(candidates.filter(p=>p.key!==original.key&&p.id!==original.id).map(p=>[p.key,p])).values()];
  const score=p=>(p.tags||[]).reduce((sum,t)=>sum+(weights.get(t)||0),0);
  return unique.filter(p=>score(p)>0).sort((a,b)=>score(b)-score(a)||b.score-a.score).slice(0,12);
}
