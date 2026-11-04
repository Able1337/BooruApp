import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
test('server starts through the release symlink used by systemd',{timeout:10000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'booru-entry-'));
 const link=join(dir,'current');await symlink(fileURLToPath(new URL('../',import.meta.url)),link);
 const child=spawn(process.execPath,[join(link,'server/server.mjs')],{env:{...process.env,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{child.kill();await rm(dir,{recursive:true,force:true});});
 const output=await new Promise((resolve,reject)=>{child.stdout.once('data',data=>resolve(data.toString()));child.once('exit',code=>reject(new Error('Server exited '+code)));child.once('error',reject);});
 assert.match(output,/Booru Pocket listening/);
});
