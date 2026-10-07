import test,{before,after} from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {JSDOM} from 'jsdom';import {mountApp} from '../public/app.mjs';
import {createApp,listen} from '../server.mjs';import {SOURCES} from '../lib/config.mjs';
import {fakeFetcher,pdfs} from './helpers.mjs';
let cache,server,url,dom,client,doc,mode='current',downloads=[],blobs=new Map(),printed=0;
before(async()=>{
  cache=await mkdtemp(path.join(os.tmpdir(),'agatu-ui-test-'));
  const old=Object.fromEntries(await Promise.all(SOURCES.map(async s=>[s.key,await readFile(new URL('fixtures/2026-10-03/'+s.filename,import.meta.url))])));
  const app=await createApp({cache,fetcher:(...args)=>fakeFetcher({bytes:mode==='old'?old:pdfs,failed:mode==='failure'?'law':null})(...args)});
  server=app.server;url=await listen(server,0);
  dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url});doc=dom.window.document;
  const win=dom.window;win.Blob=globalThis.Blob;
  win.HTMLDialogElement.prototype.showModal=function(){this.open=true};win.HTMLDialogElement.prototype.close=function(){this.open=false};
  win.URL.createObjectURL=blob=>{const key='blob:test/'+blobs.size;blobs.set(key,blob);return key};win.URL.revokeObjectURL=()=>{};
  win.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:blobs.get(this.href)})};win.print=()=>{printed++};
  client=mountApp({document:doc,window:win,fetcher:(endpoint,options)=>fetch(url+endpoint,options),pollDelay:20});await client.ready;
});
after(async()=>{dom?.window.close();await new Promise(resolve=>server.close(resolve));await rm(cache,{recursive:true,force:true});});
const $=id=>doc.getElementById(id);
async function idle(){const deadline=Date.now()+15000;while(client.state.busy){if(Date.now()>deadline)throw Error('UI operation timed out');await new Promise(resolve=>setTimeout(resolve,20));}}
test('initial UI shows Fedorov, 19 source cards and 20 pairs',()=>{
  assert.equal($('heading').textContent,'Федоров П.И.');assert.equal(doc.querySelectorAll('.lesson').length,19);assert.equal($('stat-lessons').textContent,'20');
  assert.equal(doc.querySelectorAll('.teacher').length,35);assert.ok(!$('download-button').disabled);assert.ok(!$('check-button').disabled);
});
test('full name search and Enter choose teacher',()=>{
  $('search').value='Фёдоров Павел Иванович';$('search').dispatchEvent(new dom.window.Event('input'));
  assert.equal(doc.querySelectorAll('.teacher').length,1);$('search').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter'}));assert.equal($('heading').textContent,'Федоров П.И.');
});
test('day filter changes cards while CSV exports whole selected week',async()=>{
  [...doc.querySelectorAll('.day-tab')].find(b=>b.textContent.startsWith('Вт')).click();assert.equal(doc.querySelectorAll('.lesson').length,4);
  $('csv-button').click();const csv=await downloads.at(-1).blob.text();assert.equal(downloads.at(-1).name,'Расписание_Федоров.csv');
  assert.equal(csv.trim().split('\r\n').length,20);assert.match(csv,/informaczionnye-sistemy-i-programmirovanie-1.pdf/);
  $('ics-button').click();const ics=await downloads.at(-1).blob.text();assert.equal(ics.match(/BEGIN:VEVENT/g).length,19);assert.match(ics,/TZID=Asia\/Yakutsk/);
  [...doc.querySelectorAll('.day-tab')].find(b=>b.textContent==='Все дни').click();
});
test('source dialog lists seven local files and official URLs',()=>{
  $('sources-button').click();assert.ok($('sources-dialog').open);assert.equal(doc.querySelectorAll('.source-item').length,7);
  assert.ok(doc.querySelector('.local-link').href.includes('/api/pdf/'));assert.ok(doc.querySelector('.original-link').href.startsWith('https://agatu.ru/'));
  doc.querySelector('[data-close="sources-dialog"]').click();assert.ok(!$('sources-dialog').open);
});
test('curator checkbox and week filter use actual records',()=>{
  client.choose('Попова В.Г.');const before=client.selectedRows().length;
  $('hide-curator').checked=false;$('hide-curator').dispatchEvent(new dom.window.Event('change'));assert.ok(client.selectedRows().length>before);
  $('hide-curator').checked=true;$('hide-curator').dispatchEvent(new dom.window.Event('change'));
  client.choose('Федоров П.И.');$('week').value='2026-09-28';$('week').dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelectorAll('.lesson').length,0);assert.match($('schedule').textContent,/Нет занятий/);
  $('week').value='2026-10-05';$('week').dispatchEvent(new dom.window.Event('change'));
});
test('download button leaves active cards untouched until separate check button',async()=>{
  mode='old';const before=client.state.data.rows;$('download-button').click();assert.ok(client.state.busy);await idle();
  assert.equal(client.state.data.rows.length,before.length);assert.equal(doc.querySelectorAll('.lesson').length,19);
  assert.ok($('check-button').classList.contains('ready'));assert.match($('check-caption').textContent,/Новый набор/);
  $('check-button').click();assert.ok(client.state.busy);await idle();
  assert.equal(client.state.data.rows.length,466);assert.equal(doc.querySelectorAll('.lesson').length,18);
  assert.ok(!$('check-button').classList.contains('ready'));
});
test('failed download shows report and preserves previous timetable',async()=>{
  mode='failure';const before=JSON.stringify(client.state.data.rows);$('download-button').click();await idle();
  assert.equal(JSON.stringify(client.state.data.rows),before);assert.ok($('report-dialog').open);assert.match($('report-content').textContent,/40.02.04/);
  assert.ok(!$('download-button').disabled);assert.ok(!$('check-button').disabled);
  $('save-report').click();assert.match(await downloads.at(-1).blob.text(),/Набор не скачан полностью/);
});
test('print action is connected',()=>{$('print-button').click();assert.equal(printed,1)});
