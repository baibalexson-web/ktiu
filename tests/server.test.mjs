import test,{before,after} from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createApp,listen} from '../server.mjs';import {sha256} from '../lib/store.mjs';
import {fakeFetcher,pdfs} from './helpers.mjs';
let cache,url,app,failed=null,calls=0;
before(async()=>{cache=await mkdtemp(path.join(os.tmpdir(),'agatu-server-test-'));
  app=await createApp({cache,fetcher:async(...args)=>{calls++;return fakeFetcher({failed})(...args)}});url=await listen(app.server,0);});
after(async()=>{await new Promise(resolve=>app.server.close(resolve));await rm(cache,{recursive:true,force:true});});
const action=kind=>fetch(url+'/api/'+kind,{method:'POST',headers:{'X-AGATU-Action':'1'}});
async function finish(){const deadline=Date.now()+15000;while(Date.now()<deadline){const {job}=await (await fetch(url+'/api/job')).json();
  if(job.status!=='running')return job;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Job timed out');}
test('server serves local assets and 464 saved records with zero network calls',async()=>{
  const response=await fetch(url);assert.equal(response.status,200);assert.match(await response.text(),/АГАТУ КТиУ/);
  const data=await (await fetch(url+'/api/state')).json();assert.equal(data.rows.length,464);assert.equal(data.pending,null);assert.equal(calls,0);
  assert.equal((await fetch(url+'/app.mjs')).headers.get('content-type'),'text/javascript; charset=utf-8');
});
test('local PDF is the exact document used in active timetable',async()=>{
  const response=await fetch(url+'/api/pdf/it');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');
  assert.equal(sha256(Buffer.from(await response.arrayBuffer())),sha256(pdfs.it));
});
test('check is available without any download or internet request',async()=>{
  const before=calls;assert.equal((await action('check')).status,202);assert.equal((await finish()).status,'done');assert.equal(calls,before);
});
test('one update action downloads and activates the new timetable',async()=>{
  const before=calls;assert.equal((await action('update')).status,202);
  const job=await finish();assert.equal(job.status,'done');assert.ok(calls>before);
  const data=await (await fetch(url+'/api/state')).json();
  assert.equal(data.meta.kind,'download');assert.equal(data.pending,null);assert.equal(data.rows.length,464);
});
test('download does not alter visible data and concurrent mutation is refused',async()=>{
  const before=app.getAnalysis();assert.equal((await action('download')).status,202);
  assert.equal((await action('check')).status,409);assert.equal((await finish()).status,'done');
  assert.equal(app.getAnalysis(),before);const data=await (await fetch(url+'/api/state')).json();assert.ok(data.pending);
});
test('explicit check activates complete downloaded snapshot',async()=>{
  assert.equal((await action('check')).status,202);assert.equal((await finish()).status,'done');
  const data=await (await fetch(url+'/api/state')).json();assert.equal(data.pending,null);assert.equal(data.meta.kind,'download');assert.equal(data.rows.length,464);
});
test('failed download keeps active records and report names failing source',async()=>{
  failed='law';const before=app.getAnalysis();await action('download');const job=await finish();
  assert.equal(job.status,'error');assert.match(job.error,/40.02.04/);assert.equal(app.getAnalysis(),before);
  assert.match(await (await fetch(url+'/api/report')).text(),/Набор не скачан полностью/);failed=null;
});
test('write requests require app header and same origin; source files are not exposed',async()=>{
  assert.equal((await fetch(url+'/api/download',{method:'POST'})).status,403);
  assert.equal((await fetch(url+'/api/download',{method:'POST',headers:{'X-AGATU-Action':'1',Origin:'https://example.com'}})).status,403);
  assert.equal((await fetch(url+'/server.mjs')).status,404);
});
test('broken pending metadata does not block opening checked timetable or re-downloading',async()=>{
  const {writeFile,unlink}=await import('node:fs/promises');
  await writeFile(path.join(cache,'pending.json'),'{broken');
  const response=await fetch(url+'/api/state');assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.rows.length,464);assert.equal(data.pending,null);assert.match(data.startupWarning,/Повторите «Обновить расписание»/);
  await unlink(path.join(cache,'pending.json'));
});
