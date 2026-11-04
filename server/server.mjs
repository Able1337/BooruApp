import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {isIP} from 'node:net';

const ROOT = fileURLToPath(new URL('../web/',import.meta.url));
const MAX_BODY = 16384, MAX_RESPONSE = 4 * 1024 * 1024;
const HOSTS = new Set(['safebooru.org','api.rule34.xxx','gelbooru.com','danbooru.donmai.us','e621.net']);
export function checkedTarget(value,operation='posts') {
  if(typeof value!=='string'||value.length>8192)throw new Error('invalid');
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!HOSTS.has(u.hostname))throw new Error('invalid');
  const p=u.searchParams;
  let allowed=['api_key','user_id','login'];
  if(operation==='posts'){
    if(['danbooru.donmai.us','e621.net'].includes(u.hostname)){
      if(u.pathname!=='/posts.json'||!/^\d{1,6}$/.test(p.get('page')||''))throw new Error('invalid');
      allowed.push('page','limit','tags');
    }else{
      if(u.pathname!=='/index.php')throw new Error('invalid');
      for(const[k,v]of Object.entries({page:'dapi',s:'post',q:'index',json:'1'}))if(p.get(k)!==v)throw new Error('invalid');
      if(!/^\d{1,6}$/.test(p.get('pid')||''))throw new Error('invalid');
      allowed.push('page','s','q','json','pid','limit','tags');
      if(u.hostname==='api.rule34.xxx'){allowed.push('fields');if(p.has('fields')&&p.get('fields')!=='tag_info')throw new Error('invalid');}
    }
    if(!/^\d+$/.test(p.get('limit')||'')||+p.get('limit')<1||+p.get('limit')>100||(p.get('tags')||'').length>2000)throw new Error('invalid');
  }else if(operation==='tags'){
    let prefix;
    if(u.hostname==='api.rule34.xxx'){
      if(u.pathname!=='/autocomplete.php')throw new Error('invalid');
      allowed.push('q');prefix=p.get('q');
    }else if(u.hostname==='danbooru.donmai.us'||u.hostname==='e621.net'){
      if(u.pathname!==(u.hostname==='e621.net'?'/tags/autocomplete.json':'/tags.json'))throw new Error('invalid');
      allowed.push('search[name_matches]','limit');prefix=p.get('search[name_matches]');
      if(u.hostname==='danbooru.donmai.us'){allowed.push('search[order]');if(p.get('search[order]')!=='count')throw new Error('invalid');}
    }else{
      if(u.pathname!=='/index.php')throw new Error('invalid');
      for(const[k,v]of Object.entries({page:'dapi',s:'tag',q:'index',json:'1',orderby:'count'}))if(p.get(k)!==v)throw new Error('invalid');
      allowed.push('page','s','q','json','name_pattern','orderby','limit');prefix=p.get('name_pattern');
    }
    if(!prefix||prefix.length>100||/\s/.test(prefix))throw new Error('invalid');
    if(p.has('limit')&&(!/^\d+$/.test(p.get('limit'))||+p.get('limit')<1||+p.get('limit')>20))throw new Error('invalid');
  }else throw new Error('invalid');
  const keys=new Set(allowed);
  for(const key of p.keys())if(!keys.has(key)||p.getAll(key).length!==1)throw new Error('invalid');
  if(p.has('user_id')&&!/^\d{1,20}$/.test(p.get('user_id')))throw new Error('invalid');
  if(p.has('login')&&(p.get('login').length>100||/[\r\n:]/.test(p.get('login'))))throw new Error('invalid');
  if(p.has('api_key')&&(p.get('api_key').length>512||/\s/.test(p.get('api_key'))))throw new Error('invalid');
  return u.href;
}
function send(res,status,body,type='application/json; charset=utf-8') {
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"frame-ancestors 'none'"});
  res.end(typeof body==='string'?body:JSON.stringify(body));
}
async function readBody(req){let length=0;const parts=[];for await(const part of req){length+=part.length;if(length>MAX_BODY)throw new Error('body');parts.push(part);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
export function createApp({upstream=fetch,publicOrigin=process.env.PUBLIC_ORIGIN||'',additionalOrigins=(process.env.ADDITIONAL_ORIGINS||'').split(',').filter(Boolean)}={}) {
  const allowedOrigins=new Set([publicOrigin,...additionalOrigins].filter(Boolean));
  let active=0;
  const rates=new Map();
  return async(req,res)=>{
    try{
      if(req.url==='/healthz'&&req.method==='GET')return send(res,200,{ok:true});
      if(req.url==='/api/posts'||req.url==='/api/tags'){
        if(req.method!=='POST')return send(res,405,{error:'Разрешён только POST'});
        const origins=allowedOrigins.size?allowedOrigins:new Set([`http://${req.headers.host}`]);
        if((req.headers.origin&&!origins.has(req.headers.origin))||req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'Запрос с другого сайта запрещён'});
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(res,415,{error:'Ожидается JSON'});
        const remote=req.socket.remoteAddress;
        const forwarded=req.headers['x-forwarded-for'];
        const client=(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&typeof forwarded==='string'&&isIP(forwarded))?forwarded:remote;
        const now=Date.now();
        for(const[k,v]of rates)if(v.until<now)rates.delete(k);
        const rate=rates.get(client)||{count:0,until:now+60000};
        if(rate.count>=60||active>=8||rates.size>=10000&&!rates.has(client))return send(res,429,{error:'Превышен лимит запросов. Подожди минуту.'});
        rate.count++;rates.set(client,rate);
        let target;
        try{const body=await readBody(req);target=checkedTarget(body.url,req.url==='/api/tags'?'tags':'posts');}catch{return send(res,400,{error:'Недопустимый запрос API. Поддерживаются Safebooru, Rule34, Gelbooru, Danbooru и e621.'});}
        // Recheck after reading the body: multiple slow clients must not bypass the bound.
        if(active>=8)return send(res,503,{error:'Сервер занят. Повтори позже.'});
        active++;
        try{
          const targetUrl=new URL(target);
          const headers={Accept:'application/json','User-Agent':'BooruPocket/0.3 (https://github.com/Able1337/BooruApp)'};
          if(['e621.net','danbooru.donmai.us'].includes(targetUrl.hostname)&&targetUrl.searchParams.get('login')&&targetUrl.searchParams.get('api_key')){
            headers.Authorization='Basic '+Buffer.from(targetUrl.searchParams.get('login')+':'+targetUrl.searchParams.get('api_key')).toString('base64');
            targetUrl.searchParams.delete('login');targetUrl.searchParams.delete('api_key');
          }
          const response=await upstream(targetUrl.href,{redirect:'error',signal:AbortSignal.timeout(25000),headers});
          if(!response.ok){
            await response.body?.cancel();
            const errors={401:'API отклонил авторизацию. Проверь User ID и API key.',403:'Источник запретил запрос. Проверь ключ и доступ API.',429:'Превышен лимит источника. Подожди минуту.'};
            return send(res,502,{error:errors[response.status]||`Источник вернул HTTP ${response.status}`});
          }
          const chunks=[];let length=0;
          for await(const chunk of response.body){length+=chunk.length;if(length>MAX_RESPONSE)throw new Error('size');chunks.push(chunk);}
          const text=Buffer.concat(chunks).toString('utf8');
          try{JSON.parse(text);}catch{return send(res,502,{error:'Источник вернул не JSON. Возможно, требуется проверка доступа на стороне источника.'});}
          return send(res,200,text);
        }catch(e){return send(res,502,{error:e.name==='TimeoutError'||e.name==='AbortError'?'Сервер не дождался API источника. Повтори позже.':'Сервер не смог получить ответ API источника.'});}
        finally{active--;}
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'Метод не поддерживается'});
      const files={'/':['index.html','text/html; charset=utf-8'],'/index.html':['index.html','text/html; charset=utf-8'],'/app.mjs':['app.mjs','text/javascript; charset=utf-8'],'/core.mjs':['core.mjs','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
      const entry=files[req.url?.split('?')[0]];
      if(!entry)return send(res,404,{error:'Страница не найдена'});
      let content=await readFile(resolve(ROOT,entry[0]),'utf8');
      if(entry[0]==='index.html')content=content.replace('<head>','<head><meta name="booru-api" content="same-origin">');
      return send(res,200,req.method==='HEAD'?'':content,entry[1]);
    }catch{return send(res,500,{error:'Ошибка сервера'});}
  };
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||8080);
  http.createServer({requestTimeout:15000,headersTimeout:10000},createApp()).listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Booru Pocket listening on ${port}`));
}
