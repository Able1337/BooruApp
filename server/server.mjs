import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {isIP} from 'node:net';

const ROOT = fileURLToPath(new URL('../web/',import.meta.url));
const MAX_BODY = 16384, MAX_RESPONSE = 4 * 1024 * 1024;
const HOSTS = new Map([
  ['safebooru.org','/index.php'],
  ['api.rule34.xxx','/index.php'],
  ['danbooru.donmai.us','/posts.json'],
]);
export function checkedTarget(value) {
  if(typeof value!=='string'||value.length>8192)throw new Error('invalid');
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||HOSTS.get(u.hostname)!==u.pathname)throw new Error('invalid');
  const allowed=new Set(['limit','tags','page','pid','s','q','json','user_id','api_key']);
  for(const key of u.searchParams.keys())if(!allowed.has(key)||u.searchParams.getAll(key).length!==1)throw new Error('invalid');
  const p=u.searchParams;
  if(!/^\d+$/.test(p.get('limit')||'')||Number(p.get('limit'))<1||Number(p.get('limit'))>100||(p.get('tags')||'').length>2000)throw new Error('invalid');
  if(u.pathname==='/index.php'){
    for(const [k,v]of Object.entries({page:'dapi',s:'post',q:'index',json:'1'}))if(p.get(k)!==v)throw new Error('invalid');
    if(!/^\d{1,6}$/.test(p.get('pid')||''))throw new Error('invalid');
  }else if(!/^\d{1,6}$/.test(p.get('page')||''))throw new Error('invalid');
  if(p.has('user_id')&&!/^\d{1,20}$/.test(p.get('user_id')))throw new Error('invalid');
  if(p.has('api_key')&&(p.get('api_key').length>512||/\s/.test(p.get('api_key'))))throw new Error('invalid');
  return u.href;
}
function send(res,status,body,type='application/json; charset=utf-8') {
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"frame-ancestors 'none'"});
  res.end(typeof body==='string'?body:JSON.stringify(body));
}
async function readBody(req){let length=0;const parts=[];for await(const part of req){length+=part.length;if(length>MAX_BODY)throw new Error('body');parts.push(part);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
export function createApp({upstream=fetch,publicOrigin=process.env.PUBLIC_ORIGIN||''}={}) {
  let active=0;
  const rates=new Map();
  return async(req,res)=>{
    try{
      if(req.url==='/healthz'&&req.method==='GET')return send(res,200,{ok:true});
      if(req.url==='/api/posts'){
        if(req.method!=='POST')return send(res,405,{error:'Разрешён только POST'});
        const origin=publicOrigin||`http://${req.headers.host}`;
        if((req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'Запрос с другого сайта запрещён'});
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
        try{const body=await readBody(req);target=checkedTarget(body.url);}catch{return send(res,400,{error:'Недопустимый запрос API. Поддерживаются Safebooru, Rule34 и Danbooru.'});}
        // Recheck after reading the body: multiple slow clients must not bypass the bound.
        if(active>=8)return send(res,503,{error:'Сервер занят. Повтори позже.'});
        active++;
        try{
          const response=await upstream(target,{redirect:'error',signal:AbortSignal.timeout(25000),headers:{Accept:'application/json','User-Agent':'BooruPocket/0.2 (personal API client)'}});
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
