import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CACHE,BUNDLED,activeSnapshot,candidateSnapshot,downloadSnapshot,checkAndActivate,analyseSnapshot } from './lib/store.mjs';
const action=process.argv[2],args=process.argv.slice(3);
const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
const cache=option('--cache')?path.resolve(option('--cache')):DEFAULT_CACHE;
const progress=message=>console.log(message);
try{
  let report;
  if(action==='update'){const snapshot=await downloadSnapshot({cache,progress});report=(await checkAndActivate(snapshot,{cache,progress})).report;}
  else if(action==='download'){const snapshot=await downloadSnapshot({cache,progress});report=JSON.stringify(snapshot.manifest,null,2)+'\nВсе 7 PDF скачаны. Для анализа выполните check.';}
  else if(action==='check'){const result=await checkAndActivate(await candidateSnapshot(cache,BUNDLED),{cache,progress});report=result.report;}
  else if(action==='current'){report=(await analyseSnapshot(await activeSnapshot(cache,BUNDLED))).report;}
  else throw Error('Использование: node cli.mjs update|download|check|current [--cache папка] [--report report.txt]');
  console.log(report);if(option('--report'))await writeFile(option('--report'),report,'utf8');
}catch(e){console.error(e.message);if(option('--report'))await writeFile(option('--report'),e.message,'utf8');process.exitCode=1;}
