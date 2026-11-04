import {isIP} from 'node:net';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {mediaTarget} from '../web/core.mjs';

const MAX_BYTES=512*1024*1024;
export function createMediaRelay(upstream,allowedOrigins){
  let active=0;const rates=new Map();
  return async(req,res)=>{
    const fail=(status,message)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(message);};
    if(!['GET','HEAD'].includes(req.method))return fail(405,'Метод не поддерживается');
    const origins=allowedOrigins.size?allowedOrigins:new Set([`http://${req.headers.host}`]);
    if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&!origins.has(req.headers.origin))return fail(403,'Запрос с другого сайта запрещён');
    const query=new URL(req.url,'http://localhost').searchParams;
    const target=mediaTarget(query.get('url'));
    if(!target||query.size!==1)return fail(400,'Недопустимый адрес медиа');
    const range=req.headers.range;
    if(range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))return fail(400,'Недопустимый диапазон');
    const now=Date.now();for(const[k,v]of rates)if(v.until<now)rates.delete(k);
    const remote=req.socket.remoteAddress,forwarded=req.headers['x-forwarded-for'];
    const client=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&typeof forwarded==='string'&&isIP(forwarded)?forwarded:remote;
    const rate=rates.get(client)||{count:0,until:now+60000};
    if(active>=12||rate.count>=240||rates.size>=10000&&!rates.has(client))return fail(429,'Повторите позже');
    rate.count++;rates.set(client,rate);active++;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
    const abort=()=>{if(!res.writableFinished)controller.abort();};res.on('close',abort);req.on('aborted',abort);
    try{
      const headers={'User-Agent':'BooruPocket/0.3 (https://github.com/Able1337/BooruApp)',Referer:target.provider==='gelbooru'?'https://gelbooru.com/':'https://e621.net/'};
      if(range)headers.Range=range;
      const response=await upstream(target.url,{method:req.method,headers,redirect:'error',signal:controller.signal});
      if(![200,206].includes(response.status)){await response.body?.cancel();return fail(response.status===416?416:502,'Источник не отдал медиа');}
      const type=response.headers.get('content-type')||'';
      if(!/^(image\/(jpeg|png|gif|webp|avif)|video\/(webm|mp4))(?:;|$)/i.test(type)){await response.body?.cancel();return fail(502,'Источник вернул неподдерживаемый формат');}
      const size=response.headers.get('content-length');
      if(size&&(!/^\d+$/.test(size)||Number(size)>MAX_BYTES)){await response.body?.cancel();return fail(502,'Файл слишком большой');}
      const outgoing={'Content-Type':type,'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Accel-Buffering':'no'};
      for(const name of ['content-length','content-range','accept-ranges'])if(response.headers.has(name))outgoing[name]=response.headers.get(name);
      res.writeHead(response.status,outgoing);
      if(req.method==='HEAD'){await response.body?.cancel();return res.end();}
      let length=0;
      const bounded=new Transform({transform(chunk,encoding,callback){length+=chunk.length;callback(length>MAX_BYTES?new Error('size'):null,chunk);}});
      await pipeline(Readable.fromWeb(response.body),bounded,res,{signal:controller.signal});
    }catch{if(res.headersSent)res.destroy();else if(!res.destroyed)fail(502,'Не удалось загрузить медиа источника');}
    finally{clearTimeout(timer);res.off('close',abort);req.off('aborted',abort);active--;}
  };
}
