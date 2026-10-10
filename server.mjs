import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID,createHash,timingSafeEqual } from 'node:crypto';
import { DEFAULT_CACHE,BUNDLED,activeSnapshot,candidateSnapshot,analyseSnapshot,downloadSnapshot,
  checkAndActivate,pendingSummary,snapshotPDF,summary } from './lib/store.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const STATIC=new Map([['/','index.html'],['/index.html','index.html'],['/app.mjs','app.mjs'],
  ['/shared.mjs','shared.mjs'],['/boot.js','boot.js'],['/style.css','style.css'],['/logo.png','logo.png']]);
const MIME={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.png':'image/png'};
const PRODUCT='agatu-ktiu-web-v1.3.0';
const sameSecret=(provided,expected)=>{
  if(typeof provided!=='string'||!provided)return false;
  const digest=value=>createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided),digest(expected));
};
const headerPolicy={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
function json(response,status,data){response.writeHead(status,{...headerPolicy,'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(data));}
export async function createApp({cache=process.env.AGATU_CACHE_DIR||DEFAULT_CACHE,bundled=BUNDLED,fetcher,parser,
  publicMode=process.env.PUBLIC_MODE==='1',adminToken=process.env.ADMIN_TOKEN||''}={}){
  if(publicMode&&adminToken.length<16)throw Error('Для публичного сайта задайте ADMIN_TOKEN длиной не менее 16 символов.');
  let snapshot,startupWarning='';
  try{snapshot=await activeSnapshot(cache,bundled)}catch(e){
    snapshot=await activeSnapshot(path.join(cache,'empty-fallback'),bundled);
    startupWarning='Не удалось открыть сохранённый набор. Открыта встроенная копия. '+e.message;
  }
  let analysis;
  try{analysis=await analyseSnapshot(snapshot,{parser})}catch(e){
    // Explicit whole-set recovery, never mix individual PDFs.
    snapshot=await activeSnapshot(path.join(cache,'empty-fallback'),bundled);
    analysis=await analyseSnapshot(snapshot,{parser});startupWarning='Открыта встроенная копия после ошибки сохранённых данных: '+e.message;
  }
  let report=analysis.report,job=null;
  const server=http.createServer(async(request,response)=>{
    try{
      const port=server.address()?.port,allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
      if(!publicMode&&!allowedHosts.has(request.headers.host))return json(response,403,{error:'Недопустимый адрес приложения'});
      if(publicMode&&(!request.headers.host||!(/^[a-z\d.-]+(?::\d{1,5})?$/i).test(request.headers.host)))
        return json(response,403,{error:'Недопустимый адрес приложения'});
      const url=new URL(request.url,'http://'+request.headers.host);
      if(request.method==='GET'&&url.pathname==='/api/health')return json(response,200,{product:PRODUCT});
      if(request.method==='GET'&&url.pathname==='/api/state'){
        let pending=null,pendingWarning='';
        try{pending=await pendingSummary(cache)}catch(e){pendingWarning='Скачанный непроверенный набор недоступен. Повторите «Обновить расписание». '+e.message;}
        return json(response,200,{...analysis,pending,protectedUpdates:publicMode,startupWarning:[startupWarning,pendingWarning].filter(Boolean).join(' '),
          job:job?.status==='running'?job:null});
      }
      if(request.method==='GET'&&url.pathname==='/api/job')return json(response,200,{job});
      if(request.method==='GET'&&url.pathname==='/api/report'){
        response.writeHead(200,{...headerPolicy,'Content-Type':'text/plain; charset=utf-8'});response.end(report);return;
      }
      if(request.method==='POST'&&['/api/download','/api/check','/api/update'].includes(url.pathname)){
        const origin=request.headers.origin;
        const permittedOrigin=publicMode?origin===`https://${request.headers.host}`:
          (!origin||['http://'+request.headers.host,`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(origin));
        if(request.headers['x-agatu-action']!=='1'||!permittedOrigin)
          return json(response,403,{error:'Действие разрешено только из окна приложения'});
        if(publicMode&&!sameSecret(request.headers['x-agatu-admin-token'],adminToken))
          return json(response,401,{error:'Неверный пароль обновления'});
        if(job?.status==='running')return json(response,409,{error:'Дождитесь завершения текущего действия'});
        request.resume();
        job={id:randomUUID(),kind:url.pathname.slice('/api/'.length),status:'running',
          message:'Начинаем…',done:0,total:url.pathname.endsWith('update')?15:7,error:null};
        json(response,202,{job});
        const progress=(message,done,total)=>{Object.assign(job,{message,done,total})};
        setImmediate(async()=>{
          try{
            if(job.kind==='update'){
              const downloaded=await downloadSnapshot({cache,fetcher,progress:(message,done)=>progress(message,done,15)});
              const checked=await checkAndActivate(downloaded,{cache,parser,
                progress:(message,done)=>progress(message,8+done,15)});
              analysis=checked;snapshot=downloaded;report=checked.report;startupWarning='';
              job.message=checked.warnings.length?`Расписание обновлено с замечаниями (${checked.warnings.length}). Откройте отчёт.`:'Расписание обновлено.';
            }else if(job.kind==='download'){
              const downloaded=await downloadSnapshot({cache,fetcher,progress});
              report='СКАЧИВАНИЕ PDF АГАТУ КТиУ\nСкачаны все 7 источников. Анализ ещё не выполнен.\n\n'+
                JSON.stringify(summary(downloaded),null,2);
              await mkdir(cache,{recursive:true});await writeFile(path.join(cache,'last_download.txt'),report);
              job.message='Все 7 PDF скачаны. Нажмите «Проверить и составить расписание».';
            }else{
              const candidate=await candidateSnapshot(cache,bundled);
              const checked=await checkAndActivate(candidate,{cache,parser,progress});
              analysis=checked;snapshot=candidate;report=checked.report;startupWarning='';
              job.message=checked.warnings.length?`Расписание применено. Замечаний к источникам: ${checked.warnings.length}. Откройте отчёт.`:'Расписание проверено и применено.';
            }
            job.status='done';job.done=job.total;
          }catch(e){job.status='error';job.error=e.message;job.message='Действие не завершено. Прежнее расписание сохранено.';report=e.message;
            try{await mkdir(cache,{recursive:true});await writeFile(path.join(cache,'last_error.txt'),report)}catch{}}
        });return;
      }
      if(request.method==='GET'&&url.pathname.startsWith('/api/pdf/')){
        const key=url.pathname.slice('/api/pdf/'.length),data=await snapshotPDF(snapshot,key);
        response.writeHead(200,{...headerPolicy,'Content-Type':'application/pdf','Content-Length':data.length,
          'Content-Disposition':`inline; filename="${key}.pdf"`});response.end(data);return;
      }
      const filename=STATIC.get(url.pathname);
      if(request.method==='GET'&&filename){const data=await readFile(path.join(ROOT,'public',filename));
        response.writeHead(200,{...headerPolicy,'Content-Type':MIME[path.extname(filename)],'Content-Length':data.length});response.end(data);return;}
      json(response,404,{error:'Страница не найдена'});
    }catch(e){if(!response.headersSent)json(response,500,{error:e.message});else response.end();}
  });
  return {server,getAnalysis:()=>analysis,getJob:()=>job};
}
export async function listen(server,port=8787,host='127.0.0.1'){
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve()})});
  return `http://${host}:${server.address().port}`;
}
function openWindow(url){
  const args=process.platform==='win32'?['rundll32',['url.dll,FileProtocolHandler',url]]:
    process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
  try{const child=spawn(args[0],args[1],{detached:true,stdio:'ignore',windowsHide:true});child.on('error',()=>{});child.unref()}catch{}
}
async function run(){
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<24||major===24&&minor<5)throw Error('Требуется Node.js 24.5 или новее. Установите Node.js LTS: https://nodejs.org/en/download');
  console.log('АГАТУ КТиУ · JavaScript\nЧитаем сохранённые PDF…');
  const publicMode=process.env.PUBLIC_MODE==='1';
  const {server}=await createApp();let url;
  if(publicMode){
    const port=Number(process.env.PORT||10000);
    if(!Number.isInteger(port)||port<1||port>65535)throw Error('Некорректный PORT');
    await listen(server,port,'0.0.0.0');
    console.log(`Веб-сервер слушает порт ${port}. Публичный HTTPS-адрес выдаёт хостинг.`);
    return;
  }
  try{url=await listen(server,8787)}catch(e){
    if(e.code!=='EADDRINUSE')throw e;
    try{const health=await fetch('http://127.0.0.1:8787/api/health',{signal:AbortSignal.timeout(2000)});
      if((await health.json()).product===PRODUCT){if(process.argv.includes('--open'))openWindow('http://127.0.0.1:8787');console.log('Эта версия уже открыта: http://127.0.0.1:8787');return;}}
    catch{}
    for(let port=8788;port<8798;port++){try{url=await listen(server,port);break}catch(error){if(error.code!=='EADDRINUSE')throw error}}
    if(!url)throw Error('Нет свободного локального порта 8787–8797');
  }
  console.log(`\nОткройте ${url}\nОставьте это окно открытым. Для завершения нажмите Ctrl+C.`);
  if(process.argv.includes('--open'))openWindow(url);
  const stop=()=>server.close(()=>process.exit(0));process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)run().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
