import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {discoverSources,officialURL} from '../lib/sources.mjs';
import {downloadSnapshot,checkAndActivate,activeSnapshot,candidateSnapshot,atomicJSON,sha256} from '../lib/store.mjs';
import {parsePDF} from '../lib/parser.mjs';import {sourcePage,urls,pdfs,fakeFetcher,temporary} from './helpers.mjs';
test('discovery selects full-time classes of college and excludes exams',()=>assert.deepEqual(discoverSources(sourcePage()),urls));
test('new month and PDF filename are discovered',()=>{
  const changed=Object.fromEntries(Object.keys(urls).map(key=>[key,'https://agatu.ru/wp-content/uploads/2026/11/'+key+'-rev-9.pdf']));
  assert.deepEqual(discoverSources(sourcePage(changed)),changed);
});
test('missing and duplicate source links fail without static fallback',()=>{
  assert.throws(()=>discoverSources(sourcePage().replace('09.02.07 Информационные','00.00.00 Информационные')),/PDF-ссылок 0/);
  assert.throws(()=>discoverSources(sourcePage().replace('<ul><li><a href=', '<ul><li><a href="https://agatu.ru/duplicate.pdf">09.02.07</a></li><li><a href=')),/PDF-ссылок 2/);
});
test('unofficial and insecure sources are refused',()=>{
  assert.throws(()=>officialURL('https://example.com/a.pdf'));assert.throws(()=>officialURL('http://agatu.ru/a.pdf'));
});
test('download and check are separate; check performs no network request',async t=>{
  const cache=await temporary(t),snapshot=await downloadSnapshot({cache,fetcher:fakeFetcher()});
  await assert.rejects(readFile(path.join(cache,'active.json')),e=>e.code==='ENOENT');
  assert.equal((await candidateSnapshot(cache)).folder,snapshot.folder);
  let calls=0;const result=await checkAndActivate(snapshot,{cache,parser:async(...args)=>{calls++;return parsePDF(...args)}});
  assert.equal(calls,7);assert.equal(result.rows.length,464);
  assert.equal((await activeSnapshot(cache)).folder,snapshot.folder);
  await assert.rejects(readFile(path.join(cache,'pending.json')),e=>e.code==='ENOENT');
});
test('failure of one PDF preserves active and existing pending snapshot',async t=>{
  const cache=await temporary(t),snapshot=await downloadSnapshot({cache,fetcher:fakeFetcher()});
  await atomicJSON(path.join(cache,'active.json'),{snapshot:path.basename(snapshot.folder)});
  const before=await readFile(path.join(cache,'active.json')),pending=await readFile(path.join(cache,'pending.json'));
  await assert.rejects(downloadSnapshot({cache,fetcher:fakeFetcher({failed:'law'})}),/Набор не скачан полностью/);
  assert.deepEqual(await readFile(path.join(cache,'active.json')),before);assert.deepEqual(await readFile(path.join(cache,'pending.json')),pending);
});
test('changed bytes at same URL are downloaded and hashed again',async t=>{
  const cache=await temporary(t),a=await downloadSnapshot({cache,fetcher:fakeFetcher()});
  const oldIt=await readFile(new URL('fixtures/2026-10-03/it.pdf',import.meta.url));
  const b=await downloadSnapshot({cache,fetcher:fakeFetcher({bytes:{...pdfs,it:oldIt}})});
  assert.equal(a.manifest.sources.it.url,b.manifest.sources.it.url);assert.notEqual(a.manifest.sources.it.sha256,b.manifest.sources.it.sha256);
  assert.equal(b.manifest.sources.it.sha256,sha256(oldIt));
});
test('damaged PDF is reported while valid sources remain visible',async t=>{
  const cache=await temporary(t),a=await downloadSnapshot({cache,fetcher:fakeFetcher()});
  await atomicJSON(path.join(cache,'active.json'),{snapshot:path.basename(a.folder)});
  const b=await downloadSnapshot({cache,fetcher:fakeFetcher()}),file=path.join(b.folder,'it.pdf');
  await writeFile(file,Buffer.concat([pdfs.it,Buffer.from('changed')]));
  const result=await checkAndActivate(b,{cache});
  assert.ok(result.rows.length>0);assert.ok(result.rows.every(row=>row.source!=='it'));
  assert.ok(result.warnings.some(w=>w.includes('09.02.07')&&w.includes('повреждён')));
  assert.equal((await activeSnapshot(cache)).folder,b.folder);
});
test('one unreadable source does not block other teachers, but zero lessons keeps prior data',async t=>{
  const cache=await temporary(t),a=await downloadSnapshot({cache,fetcher:fakeFetcher()});
  await checkAndActivate(a,{cache});
  const b=await downloadSnapshot({cache,fetcher:fakeFetcher()});
  const partly=await checkAndActivate(b,{cache,parser:async(raw,key)=>{
    if(key==='accounting')throw Error('Запись без времени');return parsePDF(raw,key);
  }});
  assert.ok(partly.rows.length>0);assert.ok(partly.warnings.some(w=>w.includes('38.02.01')&&w.includes('Запись без времени')));
  const c=await downloadSnapshot({cache,fetcher:fakeFetcher()});
  await assert.rejects(checkAndActivate(c,{cache,parser:()=>{throw Error('Все страницы не распознаны')}}),/Не удалось распознать ни одного занятия/);
  assert.equal((await activeSnapshot(cache)).folder,b.folder);
});
