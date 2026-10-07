import https from 'node:https';
import { PAGE_URL, SOURCES } from './config.mjs';

function decode(value){return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,code)=>{
  if(code[0]==='#'){const n=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):parseInt(code.slice(1),10);
    return n<=0x10ffff?String.fromCodePoint(n):''}
  return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[code.toLowerCase()];})}
class Node{
  constructor(tag,attrs={}){this.tag=tag;this.attrs=attrs;this.children=[];}
  text(){return this.children.map(c=>typeof c==='string'?c:c.text()).join(' ')}
  *nodes(){yield this;for(const c of this.children)if(c instanceof Node)yield* c.nodes()}
  has(name){return (this.attrs.class||'').split(/\s+/).includes(name)}
}
function tree(html){
  const root=new Node('root'),stack=[root],voids=new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  const tokens=html.match(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?[\w:-]+\b(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+/gi)||[];
  for(const token of tokens){
    if(/^<!--|^<(script|style)\b/i.test(token))continue;
    if(token.startsWith('</')){const tag=token.match(/^<\/([\w:-]+)/)[1].toLowerCase();
      for(let i=stack.length-1;i>0;i--)if(stack[i].tag===tag){stack.length=i;break}continue;}
    if(token.startsWith('<')){const match=token.match(/^<([\w:-]+)/);if(!match)continue;
      const tag=match[1].toLowerCase(),attrs={};
      for(const m of token.slice(match[0].length).matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]??'');
      const node=new Node(tag,attrs);stack.at(-1).children.push(node);
      if(!voids.has(tag)&&!token.endsWith('/>'))stack.push(node);
    }else stack.at(-1).children.push(decode(token));
  }return root;
}
const header=node=>node.children.find(c=>c instanceof Node&&c.has('timeline-item-header'))?.text().replace(/\s+/g,' ').trim().toLowerCase()||'';
function section(node,title){const matches=[...node.nodes()].filter(n=>n.has('timeline-item')&&header(n)===title.toLowerCase());
  if(matches.length!==1)throw Error(`На официальной странице не найден однозначный раздел «${title}». Возможно, изменился формат страницы.`);
  return matches[0];}
export function officialURL(value){const url=new URL(value);
  if(url.protocol!=='https:'||!['agatu.ru','www.agatu.ru'].includes(url.hostname)||url.port&&url.port!=='443'||url.username||url.password)
    throw Error('Источник должен быть HTTPS-ссылкой официального сайта agatu.ru');return url.href;}
export function discoverSources(html){
  const classes=section(section(section(tree(html),'Колледж технологий и управления'),'Очно'),'Расписание занятий');
  const choices=new Map(SOURCES.map(s=>[s.key,new Set()]));
  for(const node of classes.nodes()){
    if(node.tag!=='a'||!node.attrs.href)continue;
    const url=new URL(node.attrs.href,PAGE_URL);if(!url.pathname.toLowerCase().endsWith('.pdf'))continue;
    const code=node.text().match(/\b\d{2}\.\d{2}\.\d{2}\b/)?.[0],source=SOURCES.find(s=>s.code===code);
    if(source)choices.get(source.key).add(officialURL(url.href));
  }
  const errors=SOURCES.filter(s=>choices.get(s.key).size!==1).map(s=>`${s.code} ${s.short}: найдено PDF-ссылок ${choices.get(s.key).size} вместо 1`);
  if(errors.length)throw Error('Нельзя получить полный набор очного расписания:\n'+errors.join('\n'));
  return Object.fromEntries([...choices].map(([key,urls])=>[key,[...urls][0]]));
}
// Node 24.5+ supports environment proxy settings on HTTPS agents.
const agent=new https.Agent({keepAlive:true,proxyEnv:process.env});
function requestBytes(url,limit,redirects=0){
  officialURL(url);if(redirects>5)throw Error('Слишком много перенаправлений сайта');
  return new Promise((resolve,reject)=>{
    let timer;
    const request=https.get(url,{agent,headers:{'User-Agent':'Mozilla/5.0 AGATU-KTiU-JavaScript/1.0',
      'Cache-Control':'no-cache, no-store, max-age=0','Pragma':'no-cache','Accept-Encoding':'identity'}},response=>{
      if([301,302,303,307,308].includes(response.statusCode)){
        response.resume();clearTimeout(timer);
        try{resolve(requestBytes(new URL(response.headers.location,url).href,limit,redirects+1))}catch(e){reject(e)}return;
      }
      if(response.statusCode!==200){response.resume();clearTimeout(timer);const e=Error('Сайт вернул HTTP '+response.statusCode);e.status=response.statusCode;reject(e);return;}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>limit){request.destroy(Error('Ответ сайта превышает допустимый размер'));return}chunks.push(chunk)});
      response.on('end',()=>{clearTimeout(timer);resolve(Buffer.concat(chunks))});
      response.on('error',e=>{clearTimeout(timer);reject(e)});
    });
    request.on('error',e=>{clearTimeout(timer);reject(e)});
    timer=setTimeout(()=>request.destroy(Error('Сайт не ответил за 35 секунд')),35000);
  });
}
export async function fetchBytes(value,limit){
  const url=new URL(officialURL(value));url.searchParams.set('_agatu_refresh',Date.now()+'-'+Math.random().toString(16).slice(2));
  for(let attempt=0;attempt<2;attempt++){
    try{return await requestBytes(url.href,limit)}catch(e){
      if(attempt===0&&(!e.status||[429,500,502,503,504].includes(e.status)))continue;
      throw Error(`Не удалось скачать ${value}\n${e.message}. Проверьте интернет и доступ к официальному сайту.`);
    }
  }
}
