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
  return postRows(payload).filter(p => p && typeof p === 'object' && p.id != null).map(p => {
    const file = httpsUrl(p.file_url || p.file?.url || p.large_file_url, source.base);
    const preview = httpsUrl(p.preview_file_url || p.preview_url || p.preview?.url || p.sample?.url || p.sample_url || p.file_url, source.base);
    const sample = httpsUrl(p.sample?.url || p.sample_url || p.large_file_url || p.file_url || p.file?.url, source.base);
    const ext = String(p.file_ext || p.file?.ext || file.split('?')[0].split('.').pop() || '').toLowerCase();
    const tags = p.tags&&typeof p.tags==='object'&&!Array.isArray(p.tags)?Object.values(p.tags).flat().filter(t=>typeof t==='string'):String(p.tag_string || p.tags || '').split(/\s+/).filter(Boolean);
    return {id:String(p.id), key:source.base+'#'+p.id, file, preview, sample:ext==='gif'?file:sample, tags, sourceId:source.id||'', tagGroups:normalizeTagGroups(p,tags), score:Number(p.score?.total??p.score)||0, ext,
      width:Number(p.image_width || p.width || p.file?.width)||800, height:Number(p.image_height || p.height || p.file?.height)||1000,
      video:['mp4','webm'].includes(ext), rating:p.rating || '', source:source.name,
      page:['danbooru','e621'].includes(source.kind) ? new URL('posts/'+p.id, source.base).href : new URL('index.php?page=post&s=view&id='+encodeURIComponent(p.id), source.base).href};
  }).filter(p => p.id !== 'undefined' && p.preview && p.file);
}

export function sanitizeFavorites(data) {
  if (!Array.isArray(data)) throw new Error('Ожидается массив публикаций');
  return [...new Map(data.filter(p => p && typeof p.key === 'string' && typeof p.id === 'string' && httpsUrl(p.file) && httpsUrl(p.preview) && Array.isArray(p.tags) && p.tags.every(t => typeof t === 'string')).map(p => [p.key, {...p, file:httpsUrl(p.file), preview:httpsUrl(p.preview), sample:httpsUrl(p.sample) || httpsUrl(p.file), video:!!p.video}])).values()];
}

export const SOURCE_TEMPLATES = [
  {id:'rule34',name:'Rule34',base:'https://rule34.xxx/',kind:'gelbooru',mark:'34',color:'green',hint:'Нужны User ID и API key из API Access Credentials.'},
  {id:'gelbooru',name:'Gelbooru',base:'https://gelbooru.com/',kind:'gelbooru',mark:'G',color:'blue',hint:'Для API могут потребоваться User ID и API key.'},
  {id:'danbooru',name:'Danbooru',base:'https://danbooru.donmai.us/',kind:'danbooru',mark:'D',color:'red',hint:'Логин и API key необязательны для публичных запросов. Действуют лимиты источника.'},
  {id:'e621',name:'e621',base:'https://e621.net/',kind:'e621',mark:'e6',color:'gold',hint:'Логин и API key необязательны для публичного API.'},
  {id:'safebooru',name:'Safebooru',base:'https://safebooru.org/',kind:'gelbooru',mark:'S',color:'purple',hint:'Публичный API без ключа. Источник по умолчанию.'},
];
export function sourceTemplate(source) {
  const host=new URL(httpsUrl(source?.base)||'https://safebooru.org/').hostname;
  return SOURCE_TEMPLATES.find(t=>new URL(t.base).hostname===host||(t.id==='rule34'&&host==='api.rule34.xxx'))||{mark:(typeof source?.name==='string'?source.name:'B').slice(0,2).toUpperCase(),color:'purple'};
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
export function parseTags(query) {
  const map=new Map();
  for(const raw of String(query||'').trim().split(/\s+/).filter(Boolean).slice(0,80)){
    const excluded=raw.startsWith('-'),value=(excluded?raw.slice(1):raw).slice(0,150);
    if(value)map.set(value,{value,excluded});
  }
  return [...map.values()];
}
export function tagsQuery(tags) { return tags.map(t=>(t.excluded?'-':'')+t.value).join(' '); }
export function mergeTags(current, incoming) { const map=new Map(current.map(t=>[t.value,t]));for(const t of incoming)map.set(t.value,t);return [...map.values()].slice(0,80); }
export function sortFromTag(value) {
  const raw=String(value||'').replace(/^(sort|order):/,'');
  return ({score:'score','score:desc':'score',score_desc:'score','score:asc':'score_asc',score_asc:'score_asc',random:'random',new:'new',id:'new','id:desc':'new',id_desc:'new','id:asc':'old',id_asc:'old'})[raw]||null;
}
export function searchTags(source,tags,sort='new') {
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
    map.set(p.id,{id:p.id.slice(0,100),name:p.name.slice(0,80),query:tagsQuery(parseTags(p.query)),sourceId:typeof p.sourceId==='string'?p.sourceId:'*',sort:['new','score','score_asc','random','old'].includes(p.sort)?p.sort:'new',cover:httpsUrl(p.cover)});
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
  else for(const[k,v]of Object.entries({page:'dapi',s:'tag',q:'index',json:'1',name_pattern:clean+'%',limit:'10',orderby:'count'}))u.searchParams.set(k,v);
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
