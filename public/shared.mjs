export const WEEKDAYS = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
export function weekStart(iso) {
  const day = new Date(iso+'T12:00:00Z');
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay()+6)%7);
  return day.toISOString().slice(0,10);
}
export function addDays(iso, amount) {
  const day = new Date(iso+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+amount);
  return day.toISOString().slice(0,10);
}
export const shortDate = iso => iso.slice(8,10)+'.'+iso.slice(5,7)+'.'+iso.slice(0,4);
export const weekdayIndex = iso => (new Date(iso+'T12:00:00Z').getUTCDay()+6)%7;
export const isCurator = row => row.subject.toLowerCase().includes('кураторск');
export function matchesTeacher(name, query) {
  const clean = s=>s.toLowerCase().replaceAll('ё','е').replace(/[^а-я]/g,'');
  const parts=query.match(/[А-ЯЁа-яё-]+/g)||[];
  const found=name.match(/^([А-ЯЁ][а-яё-]+)\s+([А-ЯЁ][а-яё]?)\.([А-ЯЁ][а-яё]?)\./);
  return !parts.length || !!found && clean(found[1]).startsWith(clean(parts[0])) &&
    (!parts[1]||clean(found[2])[0]===clean(parts[1])[0]) &&
    (!parts[2]||clean(found[3])[0]===clean(parts[2])[0]);
}
export function filterLessons(rows, {teacher=null, week=null, hideCurator=true, day=null}={}) {
  return rows.filter(r=>(!teacher||r.teacher===teacher)&&(!week||weekStart(r.day)===week)&&
    (!hideCurator||!isCurator(r))&&(!day||r.day===day));
}
export function publishedSlots(row, allRows) {
  const [start,end]=row.time.split('–');if(!end)return [row.time];
  // Split a long printed block only using shorter intervals explicitly
  // published elsewhere in the same PDF; never assume universal bell times.
  const options=[...new Set(allRows.filter(r=>r.source===row.source).map(r=>r.time))]
    .filter(time=>time!==row.time&&time.includes('–'))
    .map(time=>({time,start:time.split('–')[0],end:time.split('–')[1]}))
    .filter(r=>r.start>=start&&r.end<=end)
    .sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
  const chain=[];let last=start;
  for(const slot of options){if(slot.start<last)continue;
    if(!chain.length&&slot.start!==start)continue;chain.push(slot.time);last=slot.end;if(last===end)break;}
  return chain.length>1&&last===end?chain:[row.time];
}
export const countPairs=(rows,allRows)=>rows.reduce((total,row)=>total+publishedSlots(row,allRows).length,0);
const csvCell = value => '"'+String(value).replaceAll('"','""')+'"';
export function csvExport(rows, sources) {
  const byKey=new Map(sources.map(s=>[s.key,s]));
  return '\uFEFF'+[['Дата','День','Время','Дисциплина','Преподаватель','Группы','Аудитория','Специальность','Источник','Страница PDF'],
    ...rows.map(r=>[shortDate(r.day),WEEKDAYS[weekdayIndex(r.day)],r.time,r.subject,r.teacher,r.groups.join(', '),r.room,
      byKey.get(r.source)?.title||r.source,byKey.get(r.source)?.url||'',r.page])].map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n';
}
const escapeICS = value => value.replaceAll('\\','\\\\').replaceAll(';','\\;').replaceAll(',','\\,').replace(/\r?\n/g,'\\n');
function foldICS(line) {
  const result=[];let part='',size=0;
  for(const char of line){const bytes=new TextEncoder().encode(char).length;
    if(size+bytes>75){result.push(part);part=' '+char;size=1+bytes}else{part+=char;size+=bytes}}
  result.push(part);return result.join('\r\n');
}
export function calendarExport(rows, sources, teacher, stamp=new Date()) {
  const byKey=new Map(sources.map(s=>[s.key,s]));
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AGATU KTiU Schedule JS//RU','CALSCALE:GREGORIAN',
    'X-WR-CALNAME:'+escapeICS('АГАТУ КТиУ · '+teacher),'X-WR-TIMEZONE:Asia/Yakutsk',
    'BEGIN:VTIMEZONE','TZID:Asia/Yakutsk','BEGIN:STANDARD','DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900','TZOFFSETTO:+0900','TZNAME:+09','END:STANDARD','END:VTIMEZONE'];
  rows.forEach(r=>{
    const [start,end]=r.time.split('–');
    // Hash a canonical row for stable UIDs without any network service.
    let hash=2166136261;for(const c of JSON.stringify(r))hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
    lines.push('BEGIN:VEVENT',`UID:${r.source}-${r.day}-${hash.toString(16)}@agatu-ktiu.local`,
      'DTSTAMP:'+stamp.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'),
      'DTSTART;TZID=Asia/Yakutsk:'+r.day.replaceAll('-','')+'T'+start.replace(':','')+'00');
    if(end)lines.push('DTEND;TZID=Asia/Yakutsk:'+r.day.replaceAll('-','')+'T'+end.replace(':','')+'00');
    lines.push('SUMMARY:'+escapeICS(r.subject),'DESCRIPTION:'+escapeICS(teacher+' · '+r.groups.join(', ')+' · PDF стр. '+r.page),
      'LOCATION:'+escapeICS(r.room),'URL:'+(byKey.get(r.source)?.url||'')+'#page='+r.page,'END:VEVENT');
  });
  lines.push('END:VCALENDAR');return lines.map(foldICS).join('\r\n')+'\r\n';
}
