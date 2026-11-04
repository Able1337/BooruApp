import {makeRequest, normalizePosts, httpsUrl, postRows, sanitizeFavorites} from './core.mjs';
const $ = id => document.getElementById(id);
const DEFAULT = {name:'Safebooru',base:'https://safebooru.org/',kind:'gelbooru'};
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
let source = read('bp.source', DEFAULT), saved = read('bp.saved', []);
try { saved = sanitizeFavorites(saved); } catch { saved = []; }
if (!source || typeof source !== 'object' || !httpsUrl(source.base) || !['gelbooru','danbooru'].includes(source.kind)) source = {...DEFAULT};
let posts = [], page = 0, busy = false, done = false, tab = 'feed', query = '', generation = 0, current = 0;
let port = null, serial = 0;
const pending = new Map();
const serverApi = document.querySelector?.('meta[name="booru-api"]')?.content === 'same-origin';
window.addEventListener('message', event => {
  // A port is supplied by the APK only after its trusted main page has loaded.
  if (event.data !== 'booru-native-v1' || !event.ports?.[0] || port) return;
  port = event.ports[0];
  port.onmessage = message => { let r; try { r = JSON.parse(message.data); } catch { return; }
    const p = pending.get(r.id); if (!p) return; clearTimeout(p.timer); pending.delete(r.id);
    if (r.error) p.reject(new Error(r.error)); else { try { p.resolve(JSON.parse(r.body)); } catch { p.reject(new Error('Ответ API не является JSON')); } }
  };
  $('mode').textContent = 'ANDROID';
  if (tab === 'feed') reload();
});
function persist(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { showNotice('Не удалось сохранить данные: хранилище устройства заполнено.'); } }
function showNotice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
function nativeGet(url) {
  return new Promise((resolve,reject) => {
    const id = String(++serial), timer = setTimeout(() => { pending.delete(id); reject(new Error('Время ожидания API истекло')); }, 35000);
    pending.set(id,{resolve,reject,timer}); port.postMessage(JSON.stringify({id,url}));
  });
}
async function get(url) {
  if (port) return nativeGet(url);
  if (serverApi) {
    const response = await fetch('/api/posts', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url}), credentials:'omit', signal:AbortSignal.timeout(30000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Ошибка сервера');
    return data;
  }
  const response = await fetch(url, {credentials:'omit',signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error('HTTP '+response.status);
  return response.json();
}
function count() { $('savedCount').textContent = saved.length; }
function isSaved(post) { return saved.some(p => p.key === post.key); }
function render(items, append = false) {
  if (!append) $('grid').replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const post of items) {
    const card = document.createElement('button'); card.className = 'post'; card.type = 'button'; card.setAttribute('aria-label','Открыть публикацию '+post.id);
    const image = document.createElement('img'); image.src = post.preview; image.alt = post.tags.slice(0,8).join(', '); image.loading = 'lazy'; image.decoding = 'async'; image.style.aspectRatio = `${post.width}/${post.height}`;
    image.onerror = () => { image.alt = 'Превью недоступно'; image.style.minHeight = '180px'; };
    const meta = document.createElement('span'); meta.className = 'post-meta';
    const id = document.createElement('span'); id.textContent = '#'+post.id;
    const heart = document.createElement('span'); heart.textContent = isSaved(post) ? '♥' : '↗'; meta.append(id,heart); card.append(image,meta);
    if(post.video) { const badge=document.createElement('span'); badge.className='post-badge';badge.textContent='▶ VIDEO';card.append(badge); }
    card.onclick = () => openPost(posts.findIndex(p => p.key === post.key)); fragment.append(card);
  }
  $('grid').append(fragment);
}
async function load() {
  if (busy || done || tab !== 'feed') return;
  const token = generation; busy=true; $('more').hidden=true; $('status').textContent='Загружаем публикации…';
  try {
    const payload = await get(makeRequest(source,query,page));
    const rows = normalizePosts(payload,source);
    if (token !== generation) return;
    const keys = new Set(posts.map(p=>p.key)), fresh = rows.filter(p=>!keys.has(p.key));
    posts.push(...fresh); page++; done = postRows(payload).length < 30;
    render(fresh,true); showNotice();
    $('status').textContent=posts.length === 0 ? 'Ничего не найдено. Попробуй другие теги.' : done ? 'Пока всё. Попробуем другой поиск?' : '';
  } catch (error) {
    if (token !== generation) return;
    $('status').textContent='Не удалось загрузить ленту.';
    showNotice((error.message === 'Failed to fetch' ? 'Источник недоступен или запрещает запросы из браузера (CORS). В APK запросы выполняются напрямую.' : error.message) + ' Можно повторить запрос или сменить источник в настройках.');
  } finally { if(token === generation) { busy=false; $('more').hidden=done; } }
}
function reload() {
  generation++;busy=false;done=false;page=0;posts=[];render([]);showNotice();$('sourceName').textContent=source.name;
  if(tab === 'saved') { posts = saved.filter(p=>!query || query.split(/\s+/).every(t=>p.tags?.includes(t)));render(posts);$('more').hidden=true;$('status').textContent=posts.length?'':'Здесь появятся сохранённые публикации.'; }
  else load();
}
function openPost(index) {
  if(index<0 || index>=posts.length) return;current=index;const p=posts[index];
  const old=$('media').querySelector('video');if(old)old.pause();$('media').replaceChildren();
  const media=document.createElement(p.video?'video':'img');media.src=p.video?p.file:(p.sample||p.file);
  if(p.video){media.controls=true;media.playsInline=true;media.loop=true;}else media.alt=p.tags.join(', ');
  $('media').append(media);$('viewerSource').textContent=p.source+' / #'+p.id;
  $('original').href=p.file;$('savePost').textContent=isSaved(p)?'♥ Сохранено':'♡ Сохранить';$('tags').replaceChildren();
  for(const tag of p.tags.slice(0,100)){const button=document.createElement('button');button.textContent=tag;button.onclick=()=>{$('viewer').close();search(tag);};$('tags').append(button);}
  $('previous').disabled=index===0;$('next').disabled=index===posts.length-1;
  if(!$('viewer').open)$('viewer').showModal();
}
function search(value){query=value.trim();$('query').value=query;reload();}
$('searchForm').onsubmit=event=>{event.preventDefault();search($('query').value);};
$('more').onclick=load;
new IntersectionObserver(entries=>{if(entries[0].isIntersecting&&posts.length>0)load();},{rootMargin:'600px'}).observe($('sentinel'));
$('feedTab').onclick=()=>{tab='feed';$('feedTab').classList.add('active');$('savedTab').classList.remove('active');reload();};
$('savedTab').onclick=()=>{tab='saved';$('savedTab').classList.add('active');$('feedTab').classList.remove('active');reload();};
$('closeViewer').onclick=()=>$('viewer').close();$('viewer').onclose=()=>{const v=$('media').querySelector('video');if(v)v.pause();};
$('previous').onclick=()=>openPost(current-1);$('next').onclick=()=>openPost(current+1);
document.addEventListener('keydown',e=>{if($('viewer').open){if(e.key==='ArrowLeft')openPost(current-1);if(e.key==='ArrowRight')openPost(current+1);}});
$('savePost').onclick=()=>{const p=posts[current];saved=isSaved(p)?saved.filter(x=>x.key!==p.key):[p,...saved];persist('bp.saved',saved);count();$('savePost').textContent=isSaved(p)?'♥ Сохранено':'♡ Сохранить';if(tab==='saved'){ $('viewer').close();reload(); }else render(posts);};
$('settingsOpen').onclick=()=>{for(const [id,key]of Object.entries({sourceTitle:'name',sourceBase:'base',sourceKind:'kind',sourceUser:'userId',sourceKey:'apiKey'}))$(id).value=source[key]||'';$('settings').showModal();};
$('settingsClose').onclick=()=>$('settings').close();
$('sourceForm').onsubmit=e=>{e.preventDefault();const base=httpsUrl($('sourceBase').value);if(!base){alert('Укажи HTTPS-адрес без логина и пароля.');return;}source={name:$('sourceTitle').value.trim(),base,kind:$('sourceKind').value,userId:$('sourceUser').value.trim(),apiKey:$('sourceKey').value.trim()};persist('bp.source',source);$('settings').close();reload();};
$('resetSource').onclick=()=>{source={...DEFAULT};persist('bp.source',source);$('settings').close();reload();};
$('exportSaved').onclick=()=>{const body=JSON.stringify(saved,null,2);if(port){port.postMessage(JSON.stringify({id:String(++serial),op:'export',body}));return;}const blob=new Blob([body],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='booru-pocket-favorites.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
$('importSaved').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>5*1024*1024)throw new Error('Файл больше 5 МБ');const data=JSON.parse(await file.text());if(!Array.isArray(data))throw new Error('Ожидается массив публикаций');const valid=sanitizeFavorites(data);saved=[...new Map([...saved,...valid].map(p=>[p.key,p])).values()];persist('bp.saved',saved);count();$('settings').close();reload();}catch(err){alert('Не удалось импортировать: '+err.message);}finally{e.target.value='';}};
count();$('sourceName').textContent=source.name;
// Give the native port handshake a moment before the first network request.
setTimeout(()=>{if(!busy&&posts.length===0)reload();},450);
