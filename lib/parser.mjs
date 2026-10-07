import { getDocument } from '../vendor/pdfjs/pdf.mjs';
import { WorkerMessageHandler } from '../vendor/pdfjs/pdf.worker.mjs';
import { tableGroups } from './geometry.mjs';
import { weekStart, WEEKDAYS, weekdayIndex } from '../public/shared.mjs';
import { fileURLToPath } from 'node:url';
globalThis.pdfjsWorker = { WorkerMessageHandler };
const clean=s=>s.replace(/\u00ad/g,'').replace(/\s+/g,' ').replace(/\(\s+/g,'(').replace(/\s+([),.])/g,'$1').trim();
const names=s=>[...s.matchAll(/([А-ЯЁ][а-яё-]+)\s+([А-ЯЁ][а-яё]?)\s*[.,]\s*([А-ЯЁ][а-яё]?)\s*[.,]/g)];
const dateRE=/(\d{2})\.\s*(\d{2})\.\s*(20\d{2})/;
const dayRE=/Понедельник|Вторник|Среда|Четверг|Пятница|Суббота|Воскресенье/;
const overlap=(a,b)=>Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
const within=(c,l,r)=>c[0]>=l-1.2&&c[2]<=r+1.2;
const intersection=(a,b)=>[a[0],Math.max(a[1],b[1]),a[2],Math.min(a[3],b[3])];
function closest(options,cell){let best=.25,result='—';for(const [c,value]of options){if(!value)continue;
  const score=Math.min(overlap(c,cell)/Math.max(.1,cell[3]-cell[1]),overlap(c,cell)/Math.max(.1,c[3]-c[1]));
  if(score>best){best=score;result=value}}return result}
function subject(value, ns){
  for(const m of [...ns].reverse())value=value.slice(0,m.index)+value.slice(m.index+m[0].length);
  value=clean(value.replace(/Отв\s*\.?\s*/gi,'').replace(/\(\s*\)/g,'').replace(/\s+([.,)])/g,'$1').replace(/\(\s+/g,'(')).replace(/^[ .]+|[ .]+$/g,'');
  while(value.endsWith(')')&&(value.match(/\(/g)||[]).length<(value.match(/\)/g)||[]).length)value=value.slice(0,-1).trim();
  while(value.endsWith('('))value=value.slice(0,-1).trim();return value;
}
function textLines(items,cell){
  const values=items.filter(t=>t.x>cell[0]+.15&&t.x<cell[2]-.15&&t.y>cell[1]+.15&&t.y<cell[3]-.15)
    .sort((a,b)=>a.base-b.base||a.left-b.left);
  const lines=[];for(const t of values){let line=lines.find(l=>Math.abs(l.base-t.base)<2);
    if(!line){line={base:t.base,y:t.y,items:[]};lines.push(line)}line.items.push(t)}
  return lines.sort((a,b)=>a.base-b.base).map(l=>({y:l.y,text:clean(l.items.sort((a,b)=>a.left-b.left).map(t=>t.str).join(' '))}));
}
const text=(items,cell)=>clean(textLines(items,cell).map(l=>l.text).join(' '));
function clock(value){const[h,m]=value.split(/[.:]/).map(Number);
  if(h>23||m>59)throw Error('Некорректное время в PDF: '+value);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;}
export function sortRows(a,b){return a.day.localeCompare(b.day)||a.time.localeCompare(b.time)||
  a.subject.localeCompare(b.subject,'ru')||a.groups.join().localeCompare(b.groups.join(),'ru')||a.teacher.localeCompare(b.teacher,'ru')}
async function openPDF(raw){
  if(Buffer.from(raw).subarray(0,5).toString()!=='%PDF-')throw Error('Ответ не является PDF');
  return getDocument({data:new Uint8Array(raw),useSystemFonts:false,disableFontFace:true,isEvalSupported:false,
    verbosity:0,standardFontDataUrl:fileURLToPath(new URL('../vendor/pdfjs/standard_fonts/',import.meta.url))}).promise;
}
export async function validatePDF(raw){const doc=await openPDF(raw);try{
  if(!doc.numPages)throw Error('PDF не содержит страниц');for(let n=1;n<=doc.numPages;n++)await doc.getPage(n);
}finally{await doc.destroy()}}
export async function parsePDF(raw,source,onProgress=()=>{}){
  const doc=await openPDF(raw);const rows=[],issues=[],tablePages=[];
  try{for(let n=1;n<=doc.numPages;n++){
    onProgress(n,doc.numPages);await new Promise(resolve=>setImmediate(resolve));
    const page=await doc.getPage(n),height=page.view[3];
    const items=(await page.getTextContent()).items.filter(t=>t.str?.trim()).map(t=>({str:t.str,left:t.transform[4],
      x:t.transform[4]+t.width/2,base:height-t.transform[5],y:height-t.transform[5]-t.height*.35}));
    const candidates=[];
    for(const cells of tableGroups(await page.getOperatorList(),height)){
      const top=Math.min(...cells.map(c=>c[1]));
      const headers=cells.filter(c=>Math.abs(c[1]-top)<.2).sort((a,b)=>a[0]-b[0]).map(c=>[c,text(items,c)]);
      if(headers.some(([,t])=>t==='Время')&&headers.some(([,t])=>t.startsWith('Ауд')))candidates.push({cells,headers,top});
    }
    if(candidates.length!==1){
      if(n===1&&!candidates.length&&!dayRE.test(items.map(t=>t.str).join(' ')))continue;
      throw Error(`Стр. ${n}: таблица не распознана однозначно. Возможно, изменился формат PDF или страница отсканирована.`);
    }
    tablePages.push(n);
    const {cells,headers,top}=candidates[0],bottom=Math.max(...cells.map(c=>c[3]));
    const timeHead=headers.find(([,t])=>t==='Время')[0],roomHead=[...headers].reverse().find(([,t])=>t.startsWith('Ауд'))[0];
    const teacherHead=headers.find(([,t])=>t==='Преподаватель')?.[0],single=!!teacherHead;
    let groups,bounds,first,second;
    if(single){const head=textLines(items,[0,0,page.view[2],top]).map(l=>l.text).join('\n');
      const gm=head.match(/(?:^|\n)\s*([А-ЯЁа-яё]{1,8}(?:-\d+){1,3})(?![\dА-ЯЁа-яё])/);
      if(!gm)throw Error(`Стр. ${n}: группа не распознана`);groups=[gm[1]];
      bounds={subject:[timeHead[2],teacherHead[0]],teacher:[teacherHead[0],teacherHead[2]],room:[roomHead[0],roomHead[2]]};
    }else{const gh=headers.filter(([,t])=>t.toLowerCase().includes('группа'));
      if(gh.length!==2)throw Error(`Стр. ${n}: колонки групп не распознаны`);[first,second]=gh;groups=[first[1],second[1]];
      bounds={subject0:[first[0][0],first[0][2]],room0:[first[0][2],second[0][0]],subject1:[second[0][0],second[0][2]],room1:[second[0][2],roomHead[2]]};
    }
    const headerBottom=Math.max(...headers.map(([c])=>c[3])),contents=[];
    for(const c of cells){if(c[1]<headerBottom-.2||c[0]>page.view[2]+1)continue;let role;
      if(c[2]<=timeHead[0]+1.2)role='day';else if(within(c,timeHead[0],timeHead[2]))role='time';
      else{role=Object.keys(bounds).find(k=>within(c,...bounds[k]));if(!role&&!single&&within(c,first[0][0],second[0][2]))role='shared'}
      if(role)contents.push({c,role,value:text(items,c)});
    }
    const dayCells=contents.filter(o=>o.role==='day'&&dayRE.test(o.value)),dateCells=contents.filter(o=>o.role==='day'&&dateRE.test(o.value));
    const starts=[...new Set(dayCells.map(o=>o.c[1]))].sort((a,b)=>a-b),days=[];
    starts.forEach((upper,i)=>{const lower=starts[i+1]??bottom;
      const found=dateCells.filter(o=>(o.c[1]+o.c[3])/2>=upper-.2&&(o.c[1]+o.c[3])/2<lower);
      const dates=[...new Set(found.map(o=>{const m=o.value.match(dateRE);return `${m[3]}-${m[2]}-${m[1]}`}))];
      if(dates.length!==1)throw Error(`Стр. ${n}: у учебного дня нет однозначной даты`);
      const iso=dates[0],day=new Date(iso+'T12:00:00Z');
      if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==iso)throw Error(`Стр. ${n}: некорректная дата ${iso}`);
      const printed=dayCells.find(o=>o.c[1]===upper).value.match(dayRE)[0];
      if(WEEKDAYS[weekdayIndex(iso)]!==printed)issues.push({page:n,code:'weekday',message:`Дата ${iso} не соответствует дню «${printed}». Дата сохранена из PDF.`});
      days.push([[0,upper,page.view[2],lower],iso]);
    });
    if(!days.length)throw Error(`Стр. ${n}: учебные дни не распознаны`);
    if(new Set(days.map(([,d])=>weekStart(d))).size>1)issues.push({page:n,code:'mixed_weeks',message:'В одной таблице даты разных недель: '+days.map(([,d])=>d).join(', ')+'. Даты не исправлялись.'});
    const slots=[];
    for(const o of contents.filter(o=>o.role==='time')){const records=[];
      for(const line of textLines(items,o.c))for(const m of line.text.matchAll(/(?<!\d)(\d{1,2}[.:]\d{2})(?:\s*[-–—−]\s*(\d{1,2}[.:]\d{2}))?(?!\d)/g)){
        const start=clock(m[1]),end=m[2]?clock(m[2]):'';if(end&&end<=start)throw Error(`Стр. ${n}: время окончания раньше начала`);
        records.push([line.y,start+(end?'–'+end:'')]);
      }
      records.sort((a,b)=>a[0]-b[0]);records.forEach(([y,label],i)=>slots.push([[o.c[0],i===0?o.c[1]:(records[i-1][0]+y)/2,
        o.c[2],i===records.length-1?o.c[3]:(records[i+1][0]+y)/2],label]));
    }
    const before=rows.length;
    for(const o of contents){if(!['subject','subject0','subject1','shared'].includes(o.role)||!o.value)continue;
      let segments;
      if(single)segments=contents.filter(x=>x.role==='teacher'&&overlap(x.c,o.c)>0).map(x=>({c:intersection(o.c,x.c),ns:names(x.value),sub:o.value,gs:groups,roomRole:'room'})).filter(x=>x.ns.length);
      else{const ns=names(o.value),shared=o.role==='shared';segments=ns.length?[{c:o.c,ns,sub:subject(o.value,ns),gs:shared?groups:[groups[o.role==='subject0'?0:1]],roomRole:shared||o.role==='subject1'?'room1':'room0'}]:[]}
      if(!segments.length)throw Error(`Стр. ${n}: не распознан преподаватель: ${o.value.slice(0,160)}`);
      for(const {c,ns,sub,gs,roomRole}of segments){const ds=days.filter(([d])=>overlap(d,c)>0);
        if(ds.length!==1)throw Error(`Стр. ${n}: не определена дата занятия «${sub}»`);
        const relevant=slots.filter(([s])=>{const amount=overlap(s,c);return amount&&(amount/Math.max(.1,c[3]-c[1])>.34||amount/Math.max(.1,s[3]-s[1])>.54)});
        if(!relevant.length)throw Error(`Стр. ${n}: не определено время занятия «${sub}»`);
        const seen=new Set();for(const[slot,label]of relevant){if(seen.has(label))continue;seen.add(label);
          const room=closest(contents.filter(x=>x.role===roomRole).map(x=>[x.c,x.value]),intersection(c,slot));
          if(room==='—')issues.push({page:n,code:'no_room',message:'Не определена аудитория: '+sub});
          for(const m of ns)rows.push({day:ds[0][1],time:label,subject:sub,teacher:`${m[1]} ${m[2]}.${m[3]}.`,groups:gs,room,source,page:n});
        }
      }
    }
    if(rows.length===before)throw Error(`Стр. ${n}: в таблице не найдено ни одного занятия`);
  }}finally{await doc.destroy()}
  const unique=[...new Map(rows.map(r=>[JSON.stringify(r),r])).values()].sort(sortRows);
  if(!unique.length)throw Error('В PDF не найдено расписание преподавателей');return {rows:unique,issues,tablePages};
}
