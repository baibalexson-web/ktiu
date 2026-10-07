import test,{before} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {SOURCES} from '../lib/config.mjs';import {parsePDF} from '../lib/parser.mjs';
import {matchesTeacher,filterLessons,countPairs,publishedSlots,calendarExport,csvExport} from '../public/shared.mjs';
import {pdfs,manifest} from './helpers.mjs';
let rows=[];
const canonical=r=>JSON.stringify([r.source,r.page,r.day,r.time,r.subject,r.teacher,r.groups,r.room]);
before(async()=>{for(const source of SOURCES)rows.push(...(await parsePDF(pdfs[source.key],source.key)).rows)});
test('all 464 current records match independently extracted reference fields',async()=>{
  const expected=JSON.parse(await readFile(new URL('fixtures/reference-oct05.json',import.meta.url)));
  assert.equal(rows.length,464);assert.deepEqual(new Set(rows.map(canonical)),new Set(expected.map(canonical)));
});
test('all seven October 3 PDFs retain the exact previous 466 records',async()=>{
  const actual=[];for(const source of SOURCES)actual.push(...(await parsePDF(await readFile(new URL('fixtures/2026-10-03/'+source.filename,import.meta.url)),source.key)).rows);
  const expected=JSON.parse(await readFile(new URL('fixtures/reference-oct03.json',import.meta.url)));
  assert.deepEqual(new Set(actual.map(canonical)),new Set(expected.map(canonical)));
});
test('Fedorov has 19 source blocks and 20 published pairs in current PDFs',()=>{
  const chosen=filterLessons(rows,{teacher:'Федоров П.И.',week:'2026-10-05'});
  assert.equal(chosen.length,19);assert.equal(countPairs(chosen,rows),20);
  const block=chosen.find(r=>r.time==='12:00–15:35');assert.ok(block);
  assert.deepEqual(publishedSlots(block,rows),['12:00–13:35','14:00–15:35']);
  assert.equal(countPairs([block],[block]),1,'do not invent bell intervals absent from source');
});
test('shared groups are one record and distinct subgroup staff stay separate',()=>{
  const shared=rows.filter(r=>r.teacher==='Федоров П.И.'&&r.day==='2026-10-05'&&r.time==='15:45–17:20');
  assert.equal(shared.length,1);assert.equal(shared[0].groups.length,2);assert.equal(shared[0].room,'2.102');
});
test('single merged subject keeps two teachers and two rooms',async()=>{
  const r=await parsePDF(await readFile(new URL('fixtures/single_subject_two_teachers.pdf',import.meta.url)),'zoo');
  assert.deepEqual(r.rows.map(e=>[e.teacher,e.time,e.room]),[['Попова В.Г.','08:30–10:05','1.101'],['Федоров П.И.','10:15–11:50','2.202']]);
});
test('same teacher in a merged subject can move room at the next pair',async()=>{
  const r=await parsePDF(await readFile(new URL('fixtures/single_subject_two_rooms.pdf',import.meta.url)),'zoo');
  assert.deepEqual(r.rows.map(e=>[e.teacher,e.time,e.room]),[['Федоров П.И.','08:30–10:05','1.101'],['Федоров П.И.','10:15–11:50','2.202']]);
});
test('comma typo after teacher initials does not lose history lesson',async()=>{
  const r=await parsePDF(await readFile(new URL('fixtures/2026-09/heat.pdf',import.meta.url)),'heat');
  const chosen=r.rows.filter(e=>e.day==='2026-09-30'&&e.subject==='История');
  assert.equal(chosen.length,1);assert.equal(chosen[0].teacher,'Васильев А.А.');assert.equal(chosen[0].time,'10:15–11:50');
});
test('source dates from different weeks are reported and never shifted',async()=>{
  const r=await parsePDF(pdfs.zoo,'zoo');assert.ok(r.issues.some(e=>e.code==='mixed_weeks'&&e.page===3));
  assert.ok(r.rows.some(e=>e.page===3&&e.day==='2026-09-30'));assert.ok(!r.rows.some(e=>e.page===3&&e.day==='2026-10-07'));
  assert.ok(filterLessons(r.rows,{week:'2026-10-05',hideCurator:false}).every(e=>e.day>='2026-10-05'));
});
test('full name, ё/е and unusual initials search correctly',()=>{
  assert.ok(matchesTeacher('Федоров П.И.','Фёдоров Павел Иванович'));
  assert.ok(matchesTeacher('Никаноров Дь.Н.','Никаноров Дь Н'));assert.ok(!matchesTeacher('Федоров П.И.','Федоров Алексей'));
});
test('CSV and calendar use actual current URL and exclude curator',()=>{
  const chosen=filterLessons(rows,{teacher:'Попова В.Г.',week:'2026-10-05',hideCurator:true});
  const sources=SOURCES.map(s=>({...s,...manifest.sources[s.key]}));
  const csv=csvExport(chosen,sources),ics=calendarExport(chosen,sources,'Попова В.Г.').replace(/\r\n /g,'');
  assert.ok(csv.includes(manifest.sources.it.url));assert.ok(ics.includes(manifest.sources.it.url));
  assert.ok(!csv.includes('Кураторский'));assert.equal(ics.match(/BEGIN:VEVENT/g).length,chosen.length);assert.ok(ics.includes('TZID=Asia/Yakutsk'));
});
test('parsing saved PDF never makes a network request',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=()=>{throw Error('Unexpected network request')};
  try{assert.ok((await parsePDF(pdfs.software,'software')).rows.length>0)}finally{globalThis.fetch=previous}
});
test('invalid PDF is rejected',async()=>{await assert.rejects(parsePDF(Buffer.from('<html>failure</html>'),'it'),/не является PDF/)});
