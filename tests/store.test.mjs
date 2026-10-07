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
test('damaged PDF and parser failure cannot publish incomplete data',async t=>{
  const cache=await temporary(t),a=await downloadSnapshot({cache,fetcher:fakeFetcher()});
  await atomicJSON(path.join(cache,'active.json'),{snapshot:path.basename(a.folder)});const previous=await readFile(path.join(cache,'active.json'));
  const b=await downloadSnapshot({cache,fetcher:fakeFetcher()}),file=path.join(b.folder,'it.pdf');
  await writeFile(file,Buffer.concat([pdfs.it,Buffer.from('changed')]));
  await assert.rejects(checkAndActivate(b,{cache}),/повреждён или изменён/);assert.deepEqual(await readFile(path.join(cache,'active.json')),previous);
  await writeFile(file,pdfs.it);
  await assert.rejects(checkAndActivate(b,{cache,parser:()=>{throw Error('Unsupported page format')}}),/Unsupported page format/);
  assert.deepEqual(await readFile(path.join(cache,'active.json')),previous);
});
