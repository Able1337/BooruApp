// Check browser installability and offline shell; no OS-level installation is performed.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createApp} from '../server/server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const server=createServer(createApp({publicOrigin:'',additionalOrigins:[],upstream:async()=>new Response('[]')}));
server.listen(0,'127.0.0.1');await once(server,'listening');
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:20000});
  const cdp=await context.newCDPSession(page);const {installabilityErrors}=await cdp.send('Page.getInstallabilityErrors');assert.deepEqual(installabilityErrors,[]);
  const {data}=await cdp.send('Page.getAppManifest');const manifest=JSON.parse(data);assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/#home');
  await page.click('#settingsOpen');assert.ok(await page.locator('#installApp').isVisible());
  await page.evaluate(()=>{const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{window.installRequested=true;};event.userChoice=Promise.resolve({outcome:'dismissed'});dispatchEvent(event);});
  await page.click('#installApp');await page.waitForFunction(()=>window.installRequested===true);await page.click('#settingsClose');
  await page.evaluate(()=>localStorage.setItem('pwa-offline-test','preserved'));
  const cached=await page.evaluate(async()=>{const result=[];for(const name of await caches.keys())for(const request of await(await caches.open(name)).keys())result.push(new URL(request.url).pathname);return result;});
  assert.ok(cached.includes('/app.mjs'));assert.ok(cached.includes('/index.html'));assert.ok(!cached.some(path=>path.startsWith('/api/')||path==='/media'));
  await context.setOffline(true);await page.reload();await page.locator('#brandHome').waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('pwa-offline-test')),'preserved');assert.equal(await page.locator('#homeView').isVisible(),true);
  await context.setOffline(false);await page.reload();await page.locator('#brandHome').waitFor();assert.deepEqual(errors,[]);
  await context.close();console.log('PWA passed: Chrome installability, manifest, install button, offline shell, preserved storage, no cached API/media.');
}finally{await browser.close();server.close();}
