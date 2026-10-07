import { WEEKDAYS,weekStart,weekdayIndex,shortDate,addDays,matchesTeacher,filterLessons,csvExport,calendarExport,publishedSlots,countPairs } from './shared.mjs';

export function mountApp({document:doc=globalThis.document,window:win=globalThis.window,
  fetcher=(...args)=>win.fetch(...args),pollDelay=600}={}){
  const $=id=>doc.getElementById(id),state={data:null,selected:null,week:null,day:null,busy:false,report:'',adminToken:''};
  const el=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node};
  const icon=name=>{const node=doc.createElementNS('http://www.w3.org/2000/svg','svg');node.setAttribute('class','icon');node.setAttribute('aria-hidden','true');
    const use=doc.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-'+name);node.append(use);return node};
  function saved(name,fallback){try{return win.localStorage.getItem('agatu-js-'+name)??fallback}catch{return fallback}}
  function save(name,value){try{win.localStorage.setItem('agatu-js-'+name,value)}catch{}}
  function formatTime(value){return new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Yakutsk',dateStyle:'short',timeStyle:'short'}).format(new Date(value))+' (Якутск)'}
  async function api(url,options){const response=await fetcher(url,options);const data=await response.json();if(!response.ok){const error=Error(data.error||'Ошибка сервера');error.status=response.status;throw error}return data}
  function setStatus(text,error=false){$('status').textContent=text;$('status-dot').classList.toggle('error',error)}
  function busy(value){state.busy=value;for(const id of ['download-button','check-button'])$(id).disabled=value||!state.data;
    $('progress').hidden=!value;$('status-dot').classList.toggle('busy',value)}
  function choose(name){state.selected=name;state.day=null;save('teacher',name);renderTeachers();renderSchedule()}
  const names=()=>[...new Set((state.data?.rows||[]).map(r=>r.teacher))].sort((a,b)=>a.localeCompare(b,'ru'));
  function renderTeachers(){
    const choices=names().filter(name=>matchesTeacher(name,$('search').value));$('teacher-count').textContent=choices.length;
    $('teachers').replaceChildren();for(const name of choices){const button=el('button','teacher'+(name===state.selected?' active':''));
      button.type='button';button.setAttribute('aria-pressed',String(name===state.selected));
      const surname=name.split(' ')[0],letters=(surname[0]||'')+(name.split(' ')[1]?.[0]||'');
      button.append(el('span','avatar',letters),el('span','',name));button.addEventListener('click',()=>choose(name));$('teachers').append(button)}
    if(!choices.length)$('teachers').append(el('p','no-teachers','Совпадений нет. Попробуйте фамилию без имени.'));
    return choices;
  }
  function selectedRows(){return filterLessons(state.data?.rows||[],{teacher:state.selected,week:state.week,hideCurator:$('hide-curator').checked})}
  function renderSchedule(){
    if(!state.data)return;
    const rows=state.selected?selectedRows():[],days=[...new Set(rows.map(r=>r.day))].sort(),groups=new Set(rows.flatMap(r=>r.groups));
    $('heading').textContent=state.selected||'Выберите преподавателя';
    $('period').textContent=(state.week?`${shortDate(state.week)} — ${shortDate(addDays(state.week,5))}`:'Все даты из PDF')+' · очная форма';
    $('stat-lessons').textContent=countPairs(rows,state.data.rows);$('stat-days').textContent=days.length;$('stat-groups').textContent=groups.size;
    for(const id of ['csv-button','ics-button','print-button'])$(id).disabled=!rows.length;
    $('day-tabs').replaceChildren();
    for(const [day,label]of [[null,'Все дни'],...days.map(day=>[day,`${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][weekdayIndex(day)]} · ${day.slice(8)}.${day.slice(5,7)}`])]){
      const button=el('button','day-tab'+(state.day===day?' active':''),label);button.type='button';button.setAttribute('aria-pressed',String(state.day===day));
      button.addEventListener('click',()=>{state.day=day;renderSchedule()});$('day-tabs').append(button);
    }
    const shown=filterLessons(rows,{hideCurator:false,day:state.day});$('schedule').replaceChildren();
    if(!shown.length){const empty=el('div','empty');empty.append(icon('calendar'),el('h2','',state.selected?'Нет занятий за выбранный период':'Выберите преподавателя'),
      el('p','',state.selected?'Проверьте неделю и настройку кураторских часов. Даты и замечания к источникам указаны в отчёте.':'Введите фамилию или выберите человека в списке слева.'));
      $('schedule').append(empty);return;}
    for(const day of [...new Set(shown.map(r=>r.day))]){
      const section=el('section','day-section'),title=el('div','day-title'),part=shown.filter(r=>r.day===day);
      const dayLabel=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
      title.append(el('h2','',WEEKDAYS[weekdayIndex(day)]+' · '+dayLabel),el('span','',`${part.length} занятий`));section.append(title);
      for(const r of part){const card=el('article','lesson'),time=el('div','lesson-time'),detail=el('div','lesson-detail'),room=el('div','lesson-room');
        const slots=publishedSlots(r,state.data.rows);
        time.append(el('strong','',r.time),el('small','',slots.length>1?`${slots.length} пары · объединённый блок`:shortDate(r.day)));
        if(slots.length>1)time.title='Интервалы из того же PDF: '+slots.join(', ');
        detail.append(el('h3','',r.subject),el('p','groups',r.groups.join(' · ')));
        const source=state.data.meta.sources.find(s=>s.key===r.source),link=el('a','source-link',`${source?.code||''} · PDF, стр. ${r.page}`);
        link.href=`/api/pdf/${encodeURIComponent(r.source)}#page=${r.page}`;link.target='_blank';link.rel='noopener noreferrer';link.append(icon('arrow'));detail.append(link);
        room.append(icon('pin'),el('span','',r.room));card.append(time,detail,room);section.append(card);
      }
      $('schedule').append(section);
    }
  }
  function applyData(data,{resetWeek=false}={}){
    const previous=state.selected;state.data=data;
    const available=names(),remembered=saved('teacher','Федоров П.И.');
    state.selected=available.includes(previous)?previous:available.includes(remembered)?remembered:
      available.find(name=>matchesTeacher(name,'Федоров П И'))||available[0]||null;
    const weeks=[...new Set(data.rows.map(r=>weekStart(r.day)))].sort().reverse();
    if(resetWeek||state.week&&!weeks.includes(state.week)||!previous)state.week=data.suggestedWeek;
    $('week').replaceChildren(...[...weeks.map(week=>{const option=el('option','',`${shortDate(week)} — ${shortDate(addDays(week,5))}`);option.value=week;return option}),
      Object.assign(el('option','','Все даты из PDF'),{value:''})]);
    $('week').value=state.week||'';
    $('check-button').classList.toggle('ready',!!data.pending);
    $('check-caption').textContent=data.pending?'Новый набор скачан — нажмите для проверки':'Прочитать сохранённые PDF и применить данные';
    $('admin-hint').hidden=!data.protectedUpdates;
    $('dataset-time').textContent=(data.meta.kind==='bundled'?'Встроенная копия':'Скачанные PDF')+' от '+formatTime(data.meta.downloadedAt);
    const warnings=data.warnings||[];$('warnings').hidden=!warnings.length;
    $('warning-text').textContent=`В источниках есть замечания (${warnings.length}). Даты сохранены из PDF; недели показаны отдельно.`;
    if(resetWeek)state.day=null;
    renderTeachers();renderSchedule();busy(state.busy);
  }
  function sources(){
    if(!state.data)return;$('source-list').replaceChildren();
    for(const s of state.data.meta.sources){const item=el('article','source-item');item.append(el('h3','',s.code+' · '+s.title));
      const local=el('a','local-link','Открыть локальный PDF ↗');local.href='/api/pdf/'+encodeURIComponent(s.key);local.target='_blank';local.rel='noopener noreferrer';
      const original=el('a','original-link',s.url);original.href=s.url;original.target='_blank';original.rel='noopener noreferrer';
      item.append(local,original);$('source-list').append(item)}$('sources-dialog').showModal();
  }
  async function report(){
    $('report-dialog').showModal();$('report-content').textContent='Отчёт загружается…';
    try{const response=await fetcher('/api/report');if(!response.ok)throw Error('Не удалось получить отчёт');state.report=await response.text();$('report-content').textContent=state.report}
    catch(e){state.report=e.message;$('report-content').textContent=e.message}
  }
  function downloadFile(content,name,type){
    const blob=new win.Blob([content],{type}),url=win.URL.createObjectURL(blob),link=el('a');link.href=url;link.download=name;
    doc.body.append(link);link.click();link.remove();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);
  }
  async function watchJob(){
    while(true){const {job}=await api('/api/job');if(!job)throw Error('Задача не найдена');
      setStatus(job.message,job.status==='error');$('progress').max=job.total||7;$('progress').value=job.done||0;
      if(job.status==='running'){await new Promise(resolve=>win.setTimeout(resolve,pollDelay));continue;}
      if(job.status==='error'){state.report=job.error;$('report-content').textContent=job.error;$('report-dialog').showModal();return job;}
      const data=await api('/api/state');applyData(data,{resetWeek:job.kind==='check'});setStatus(job.message);return job;
    }
  }
  async function adminPassword(){
    if(!state.data?.protectedUpdates)return '';
    if(state.adminToken)return state.adminToken;
    const dialog=$('admin-dialog'),form=$('admin-form'),input=$('admin-password'),cancel=$('admin-cancel');
    dialog.showModal();input.focus();
    return new Promise(resolve=>{
      const done=value=>{form.removeEventListener('submit',submit);cancel.removeEventListener('click',abandon);
        dialog.removeEventListener('cancel',onEscape);dialog.close();input.value='';resolve(value)};
      const submit=event=>{event.preventDefault();if(input.value.trim()){state.adminToken=input.value;done(state.adminToken)}};
      const abandon=()=>done(null);
      const onEscape=event=>{event.preventDefault();done(null)};
      form.addEventListener('submit',submit);cancel.addEventListener('click',abandon);dialog.addEventListener('cancel',onEscape);
    });
  }
  async function run(kind){
    if(state.busy)return;
    const token=state.data?.protectedUpdates?await adminPassword():'';if(token===null)return;
    busy(true);setStatus(kind==='download'?'Получаем актуальные ссылки с сайта…':'Проверяем сохранённые PDF…');
    try{await api('/api/'+kind,{method:'POST',headers:{'X-AGATU-Action':'1',...(state.data?.protectedUpdates?{'X-AGATU-Admin-Token':token}:{})}});return await watchJob()}
    catch(e){if(e.status===401)state.adminToken='';setStatus(e.status===401?'Неверный пароль обновления. Повторите действие.':'Не удалось завершить действие. Прежнее расписание сохранено.',true);state.report=e.message;
      $('report-content').textContent=e.message;$('report-dialog').showModal();}
    finally{busy(false)}
  }
  $('search').addEventListener('input',renderTeachers);
  $('search').addEventListener('keydown',e=>{if(e.key==='Enter'){const available=renderTeachers();if(available[0])choose(available[0])}});
  $('week').addEventListener('change',()=>{state.week=$('week').value||null;state.day=null;renderSchedule()});
  $('hide-curator').checked=saved('hide-curator','true')!=='false';
  $('hide-curator').addEventListener('change',()=>{save('hide-curator',String($('hide-curator').checked));state.day=null;renderSchedule()});
  $('download-button').addEventListener('click',()=>run('download'));$('check-button').addEventListener('click',()=>run('check'));
  $('sources-button').addEventListener('click',sources);$('report-button').addEventListener('click',report);$('warning-report').addEventListener('click',report);
  doc.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  for(const id of ['sources-dialog','report-dialog'])$(id).addEventListener('click',e=>{if(e.target===$(id)){const rect=$(id).getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)$(id).close()}});
  $('save-report').addEventListener('click',()=>downloadFile(state.report,'Проверка_АГАТУ_КТиУ.txt','text/plain;charset=utf-8'));
  $('csv-button').addEventListener('click',()=>downloadFile(csvExport(selectedRows(),state.data.meta.sources),`Расписание_${state.selected.split(' ')[0]}.csv`,'text/csv;charset=utf-8'));
  $('ics-button').addEventListener('click',()=>downloadFile(calendarExport(selectedRows(),state.data.meta.sources,state.selected),`Расписание_${state.selected.split(' ')[0]}.ics`,'text/calendar;charset=utf-8'));
  $('print-button').addEventListener('click',()=>win.print());
  const ready=(async()=>{
    try{const data=await api('/api/state');applyData(data,{resetWeek:true});
      setStatus(data.startupWarning||`${data.meta.kind==='bundled'?'Открыта встроенная копия':'Открыт проверенный набор'} · PDF от ${formatTime(data.meta.downloadedAt)}`+(data.pending?' · Новый набор скачан: нажмите «Проверить».':''));
      if(data.job){busy(true);try{await watchJob()}finally{busy(false)}}
    }catch(e){setStatus('Не удалось подключиться к расписанию. Обновите страницу. '+e.message,true);
      if(win.location.protocol==='file:')$('file-help').hidden=false;busy(false)}
  })();
  return {ready,state,run,choose,selectedRows,renderSchedule,report};
}
if(typeof window!=='undefined'&&typeof document!=='undefined')mountApp();
