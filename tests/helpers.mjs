import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {SOURCES,PAGE_URL} from '../lib/config.mjs';
import {BUNDLED} from '../lib/store.mjs';
export const manifest=JSON.parse(await readFile(path.join(BUNDLED,'manifest.json')));
export const urls=Object.fromEntries(SOURCES.map(s=>[s.key,manifest.sources[s.key].url]));
export const pdfs=Object.fromEntries(await Promise.all(SOURCES.map(async s=>[s.key,await readFile(path.join(BUNDLED,s.filename))])));
export function sourcePage(links=urls){const anchors=SOURCES.map(s=>`<li><a href="${links[s.key]}">${s.code} ${s.title}</a></li>`).join('');
  return `<li class="timeline-item"><div class="timeline-item-header">Другой факультет</div><a href="/wrong-faculty.pdf">09.02.07</a></li>
  <li class="timeline-item"><div class="timeline-item-header">Колледж технологий и управления</div><ul>
  <li class="timeline-item"><div class="timeline-item-header">Очно</div><ul>
  <li class="timeline-item"><div class="timeline-item-header">Расписание занятий</div><ul>${anchors}</ul></li>
  <li class="timeline-item"><div class="timeline-item-header">Расписание экзаменов</div><a href="/exam.pdf">09.02.07</a></li></ul></li>
  <li class="timeline-item"><div class="timeline-item-header">Заочно</div><ul><li class="timeline-item"><div class="timeline-item-header">Расписание занятий</div><a href="/part-time.pdf">09.02.07</a></li></ul></li></ul></li>`;
}
export function fakeFetcher({links=urls,bytes=pdfs,failed=null}={}){return async url=>{
  if(url===PAGE_URL)return Buffer.from(sourcePage(links));const key=SOURCES.find(s=>links[s.key]===url)?.key;
  if(!key)throw Error('Unexpected URL '+url);return key===failed?Buffer.from('<html>Not PDF</html>'):bytes[key];
}}
export async function temporary(test){const folder=await mkdtemp(path.join(os.tmpdir(),'agatu-js-test-'));test.after(()=>rm(folder,{recursive:true,force:true}));return folder;}
