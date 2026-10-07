import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {createApp,listen} from '../server.mjs';
import {mountApp} from '../public/app.mjs';

const password='correct-horse-battery-staple-2026';

test('public mode requires an owner password before startup',async()=>{
  await assert.rejects(createApp({publicMode:true,adminToken:'short'}),/ADMIN_TOKEN/);
});

test('internet API exposes timetable but protects updates and accepts HTTPS origin',async()=>{
  const cache=await mkdtemp(path.join(os.tmpdir(),'agatu-public-api-'));
  let server;
  try{
    const app=await createApp({cache,publicMode:true,adminToken:password});server=app.server;
    const url=await listen(server,0);
    const request=(endpoint,options={})=>fetch(url+endpoint,options);
    const stateResponse=await request('/api/state');
    assert.equal(stateResponse.status,200);
    const state=await stateResponse.json();
    assert.equal(state.rows.length,464);assert.equal(state.protectedUpdates,true);
    assert.ok(!JSON.stringify(state).includes(password));
    const head={'X-AGATU-Action':'1',Origin:'https://'+new URL(url).host};
    assert.equal((await request('/api/download',{method:'POST',headers:head})).status,401);
    assert.equal((await request('/api/check',{method:'POST',headers:{...head,'X-AGATU-Admin-Token':'wrong'}})).status,401);
    assert.equal((await request('/api/check',{method:'POST',headers:{...head,Origin:'https://another.example','X-AGATU-Admin-Token':password}})).status,403);
    assert.equal((await request('/api/check',{method:'POST',headers:{...head,Origin:'http://'+new URL(url).host,'X-AGATU-Admin-Token':password}})).status,403);
    assert.equal((await request('/api/check',{method:'POST',headers:{...head,'X-AGATU-Admin-Token':password}})).status,202);
    let status='running';for(let i=0;i<100&&status==='running';i++){
      const result=await(await request('/api/job')).json();status=result.job.status;
      if(status==='running')await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(status,'done');
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await rm(cache,{recursive:true,force:true});
  }
});

test('mobile/browser interface asks for owner password and keeps it in memory',async()=>{
  const cache=await mkdtemp(path.join(os.tmpdir(),'agatu-public-ui-'));
  let server,dom;
  try{
    const app=await createApp({cache,publicMode:true,adminToken:password});server=app.server;
    const url=await listen(server,0);
    dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:'https://schedule.example/'});
    const doc=dom.window.document,win=dom.window;
    win.HTMLDialogElement.prototype.showModal=function(){this.open=true};
    win.HTMLDialogElement.prototype.close=function(){this.open=false};
    const fetcher=(endpoint,options={})=>fetch(url+endpoint,{...options,
      headers:{...(options.method==='POST'?{Origin:'https://'+new URL(url).host}:{}),...options.headers}});
    const client=mountApp({document:doc,window:win,fetcher,pollDelay:20});await client.ready;
    assert.equal(doc.querySelectorAll('.lesson').length,19);
    assert.equal(doc.getElementById('admin-hint').hidden,false);
    doc.getElementById('download-button').click();
    assert.equal(doc.getElementById('admin-dialog').open,true);
    doc.getElementById('admin-cancel').click();
    assert.equal(doc.getElementById('admin-dialog').open,false);
    assert.equal(client.state.busy,false);
    doc.getElementById('check-button').click();
    doc.getElementById('admin-password').value=password;
    doc.getElementById('admin-form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
    const deadline=Date.now()+15000;
    while(!client.state.busy&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    while(client.state.busy&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));
    assert.ok(Date.now()<deadline,'Check timed out');
    assert.match(doc.getElementById('status').textContent,/Расписание применено/);
    assert.equal(doc.querySelectorAll('.lesson').length,19);
    assert.equal(client.state.adminToken,password);
    assert.ok(!Object.values(win.localStorage).join('').includes(password));
  }finally{
    dom?.window.close();if(server)await new Promise(resolve=>server.close(resolve));
    await rm(cache,{recursive:true,force:true});
  }
});
