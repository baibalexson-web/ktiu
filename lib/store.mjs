import { readFile,writeFile,mkdir,rename,unlink,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SOURCES, SOURCE_KEYS, PAGE_URL, MAX_PDF } from './config.mjs';
import { discoverSources,fetchBytes,officialURL } from './sources.mjs';
import { parsePDF,validatePDF,sortRows } from './parser.mjs';
import { weekStart,addDays,shortDate } from '../public/shared.mjs';
export const DEFAULT_CACHE=path.join(os.homedir(),'.agatu_schedule_js','v1');
export const BUNDLED=path.resolve(fileURLToPath(new URL('../data/',import.meta.url)));
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export const timeLabel=iso=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Yakutsk',dateStyle:'short',timeStyle:'short'}).format(new Date(iso))+' (Якутск)';
export async function atomicJSON(file,value){
  await mkdir(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,JSON.stringify(value,null,2));await rename(temporary,file)}finally{await rm(temporary,{force:true})}
}
async function optionalJSON(file){try{return JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
export async function readSnapshot(folder){
  const manifest=await optionalJSON(path.join(folder,'manifest.json'));
  if(manifest?.format!==2||JSON.stringify(Object.keys(manifest.sources||{}).sort())!==JSON.stringify([...SOURCE_KEYS].sort()))throw Error('Описание набора PDF неполное или несовместимое');
  if(!Number.isFinite(Date.parse(manifest.downloaded_at)))throw Error('Некорректное время получения PDF');
  for(const source of SOURCES){const info=manifest.sources[source.key];
    if(info.filename!==source.filename||!Number.isInteger(info.size)||info.size<1||info.size>MAX_PDF||!/^[a-f0-9]{64}$/.test(info.sha256))throw Error('Некорректное описание '+source.code);
    officialURL(info.url);
  }
  return {folder,manifest};
}
export async function snapshotPDF(snapshot,key){
  const source=SOURCES.find(s=>s.key===key);if(!source)throw Error('Неизвестный источник');
  const info=snapshot.manifest.sources[key],data=await readFile(path.join(snapshot.folder,source.filename));
  if(data.length!==info.size||sha256(data)!==info.sha256)throw Error(`${source.code}: PDF повреждён или изменён после скачивания. Скачайте набор заново.`);
  return data;
}
export async function pointer(cache,name){
  const value=await optionalJSON(path.join(cache,name+'.json'));if(!value)return null;
  if(!/^[a-f0-9]{32}$/.test(value.snapshot))throw Error('Повреждён указатель на набор PDF');
  if(name==='pending'){const active=await optionalJSON(path.join(cache,'active.json'));if(active?.snapshot===value.snapshot)return null;}
  return readSnapshot(path.join(cache,'snapshots',value.snapshot));
}
export async function activeSnapshot(cache=DEFAULT_CACHE,bundled=BUNDLED){return await pointer(cache,'active')||await readSnapshot(bundled)}
export async function candidateSnapshot(cache=DEFAULT_CACHE,bundled=BUNDLED){return await pointer(cache,'pending')||await activeSnapshot(cache,bundled)}
export async function pendingSummary(cache=DEFAULT_CACHE){const snapshot=await pointer(cache,'pending');return snapshot?summary(snapshot):null}
export function summary(snapshot){return {kind:snapshot.manifest.kind,downloadedAt:snapshot.manifest.downloaded_at,
  sources:SOURCES.map(s=>({...s,...snapshot.manifest.sources[s.key]}))};}
export async function downloadSnapshot({cache=DEFAULT_CACHE,fetcher=fetchBytes,progress=()=>{}}={}){
  progress('Получаем актуальные ссылки КТиУ → Очно → Расписание занятий',0,8);
  const links=discoverSources((await fetcher(PAGE_URL,2*1024*1024)).toString('utf8'));
  const id=randomUUID().replaceAll('-',''),folder=path.join(cache,'snapshots',id);
  await mkdir(folder,{recursive:true});
  const manifest={format:2,kind:'download',page_url:PAGE_URL,downloaded_at:new Date().toISOString(),sources:{}};
  const errors=[];
  try{
    for(const [i,source]of SOURCES.entries()){
      progress(`Скачиваем ${i+1}/7: ${source.code} · ${source.short}`,i+1,8);
      try{const data=await fetcher(links[source.key],MAX_PDF);await validatePDF(data);
        await writeFile(path.join(folder,source.filename),data);
        manifest.sources[source.key]={url:links[source.key],filename:source.filename,size:data.length,sha256:sha256(data)};
      }catch(e){errors.push(source.code+' · '+source.short+': '+e.message)}
    }
    if(errors.length)throw Error('Набор не скачан полностью. Проверенное расписание сохранено.\n\n'+errors.join('\n\n'));
    manifest.downloaded_at=new Date().toISOString();await atomicJSON(path.join(folder,'manifest.json'),manifest);
    const snapshot=await readSnapshot(folder);
    await atomicJSON(path.join(cache,'pending.json'),{snapshot:id});
    progress('Все 7 PDF скачаны. Теперь нажмите «Проверить»',8,8);return snapshot;
  }catch(e){await rm(folder,{recursive:true,force:true});throw e}
}
export async function analyseSnapshot(snapshot,{parser=parsePDF,progress=()=>{}}={}){
  const rows=[],warnings=[],details=[],errors=[],parts=[];
  for(const [i,source]of SOURCES.entries()){
    progress(`Проверяем ${i+1}/7: ${source.code} · ${source.short}`,i,7);
    try{
      const result=await parser(await snapshotPDF(snapshot,source.key),source.key,(page,total)=>
        progress(`Проверяем ${source.short}: страница ${page}/${total}`,i,7));
      rows.push(...result.rows);parts.push({source,rows:result.rows});
      const dates=[...new Set(result.rows.map(r=>r.day))].sort();
      details.push(`\n${source.code} — ${source.title}`,`URL: ${snapshot.manifest.sources[source.key].url}`,
        `SHA-256: ${snapshot.manifest.sources[source.key].sha256}`,`Страницы таблиц: ${result.tablePages.join(', ')}`,
        `Записей: ${result.rows.length}; даты: ${dates.map(shortDate).join(', ')}`);
      warnings.push(...result.issues.map(issue=>`${source.code} · ${source.short}, стр. ${issue.page}: ${issue.message}`));
      if(new Set(dates.map(weekStart)).size>1)warnings.push(`${source.code} · ${source.short}: в файле разные недели. Они показаны отдельно; даты не переносились.`);
    }catch(e){errors.push(`${source.code} · ${source.short}: ${e.message}`)}
  }
  if(errors.length)throw Error('Проверка не пройдена. Прежнее расписание сохранено.\n\n'+errors.join('\n\n'));
  const counts=new Map();for(const r of rows){const w=weekStart(r.day);counts.set(w,(counts.get(w)||0)+1)}
  const suggestedWeek=[...counts].sort((a,b)=>b[1]-a[1]||b[0].localeCompare(a[0]))[0]?.[0];
  if(!suggestedWeek)throw Error('В наборе не найдено ни одного занятия');
  for(const part of parts)if(!part.rows.some(r=>weekStart(r.day)===suggestedWeek))warnings.push(`${part.source.code}: нет занятий основной недели ${shortDate(suggestedWeek)}. Проверьте обновление источника.`);
  const checkedAt=new Date().toISOString();
  const report=['ПРОВЕРКА РАСПИСАНИЯ АГАТУ КТиУ · JAVASCRIPT',`Проверено: ${timeLabel(checkedAt)}`,
    `PDF получены: ${timeLabel(snapshot.manifest.downloaded_at)}`,`Страница: ${PAGE_URL}`,
    'Раздел: Колледж технологий и управления → Очно → Расписание занятий',
    `Записей: ${rows.length}; преподавателей: ${new Set(rows.map(r=>r.teacher)).size}`,
    `Основная неделя: ${shortDate(suggestedWeek)} — ${shortDate(addDays(suggestedWeek,5))}`,
    'Даты взяты из PDF без переноса. Общая пара двух групп — одна запись.',
    `\nПРЕДУПРЕЖДЕНИЯ: ${warnings.length}`,...(warnings.length?warnings:['Нет']),...details].join('\n');
  return {rows:rows.sort(sortRows),warnings,suggestedWeek,checkedAt,report,meta:summary(snapshot)};
}
export async function checkAndActivate(snapshot,{cache=DEFAULT_CACHE,parser=parsePDF,progress=()=>{}}={}){
  const result=await analyseSnapshot(snapshot,{parser,progress});await mkdir(cache,{recursive:true});
  const pending=await pointer(cache,'pending');
  await writeFile(path.join(cache,'last_report.txt'),result.report,'utf8');
  if(snapshot.manifest.kind!=='bundled'){
    if(path.resolve(path.dirname(snapshot.folder))!==path.resolve(cache,'snapshots'))throw Error('Набор не принадлежит хранилищу приложения');
    await atomicJSON(path.join(cache,'active.json'),{snapshot:path.basename(snapshot.folder),checked_at:result.checkedAt});
    // Publication is complete. Cleanup failure must not report a failed check.
    if(pending&&pending.folder===snapshot.folder)await unlink(path.join(cache,'pending.json')).catch(()=>{});
  }
  progress('Проверены все 7 PDF. Расписание применено',7,7);return result;
}
