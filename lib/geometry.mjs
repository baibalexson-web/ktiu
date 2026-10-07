import {OPS, Util} from '../vendor/pdfjs/pdf.mjs';
function tableGroups(ops,height){
 let matrix=[1,0,0,1,0,0],stack=[],segments=[];
 const point=(x,y)=>{const p=Util.applyTransform([x,y],matrix);return [p[0],height-p[1]]};
 const line=(a,b)=>{if(Math.abs(a[0]-b[0])<.2&&Math.abs(a[1]-b[1])>3)segments.push({o:'v',pos:(a[0]+b[0])/2,lo:Math.min(a[1],b[1]),hi:Math.max(a[1],b[1])});else if(Math.abs(a[1]-b[1])<.2&&Math.abs(a[0]-b[0])>3)segments.push({o:'h',pos:(a[1]+b[1])/2,lo:Math.min(a[0],b[0]),hi:Math.max(a[0],b[0])})};
 for(let i=0;i<ops.fnArray.length;i++){const op=ops.fnArray[i],args=ops.argsArray[i];if(op===OPS.save)stack.push([...matrix]);else if(op===OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];else if(op===OPS.transform)matrix=Util.transform(matrix,args);else if(op===OPS.constructPath){if([OPS.clip,OPS.eoClip].includes(ops.fnArray[i+1]))continue;let k=0,last=null,start=null;for(const kind of args[0]){if(kind===OPS.moveTo){last=point(args[1][k++],args[1][k++]);start=last}else if(kind===OPS.lineTo){const next=point(args[1][k++],args[1][k++]);if(last)line(last,next);last=next}else if(kind===OPS.rectangle){const [x,y,w,h]=args[1].slice(k,k+4);k+=4;const pts=[point(x,y),point(x+w,y),point(x+w,y+h),point(x,y+h)];for(let j=0;j<4;j++)line(pts[j],pts[(j+1)%4]);last=pts[0];start=last}else if(kind===OPS.closePath){if(last&&start)line(last,start);last=start}else if(kind===OPS.curveTo)k+=6;else if(kind===OPS.curveTo2||kind===OPS.curveTo3)k+=4}}}
 const merged=[];
 for(const o of ['v','h']){const edges=segments.filter(s=>s.o===o).sort((a,b)=>a.pos-b.pos);const clusters=[];for(const e of edges){const c=clusters.at(-1);if(c&&e.pos-c.at(-1).pos<=3)c.push(e);else clusters.push([e])}for(const cluster of clusters){const pos=cluster.reduce((a,e)=>a+e.pos,0)/cluster.length;const spans=cluster.sort((a,b)=>a.lo-b.lo);let current=null;for(const e of spans){if(current&&e.lo<=current.hi+3)current.hi=Math.max(current.hi,e.hi);else {current={o,pos,lo:e.lo,hi:e.hi};merged.push(current)}}}}
 const vs=merged.filter(e=>e.o==='v'),hs=merged.filter(e=>e.o==='h');const points=new Map();
 for(const v of vs)for(const h of hs)if(v.lo<=h.pos+3&&v.hi>=h.pos-3&&h.lo<=v.pos+3&&h.hi>=v.pos-3){const key=v.pos+','+h.pos;let p=points.get(key);if(!p){p={x:v.pos,y:h.pos,v:[],h:[]};points.set(key,p)}p.v.push(v);p.h.push(h)}
 const pts=[...points.values()].sort((a,b)=>a.x-b.x||a.y-b.y),cells=[];
 const connects=(a,b)=>a.x===b.x?a.v.some(e=>b.v.includes(e)):a.y===b.y&&a.h.some(e=>b.h.includes(e));
 for(const p of pts){const below=pts.filter(q=>q.x===p.x&&q.y>p.y),right=pts.filter(q=>q.y===p.y&&q.x>p.x);let cell=null;for(const b of below){if(!connects(p,b))continue;for(const r of right){if(!connects(p,r))continue;const br=points.get(r.x+','+b.y);if(br&&connects(br,r)&&connects(br,b)){cell=[p.x,p.y,r.x,b.y];break}}if(cell)break}if(cell)cells.push(cell)}
 // Keep the largest connected table (title/signature boxes are separate).
 const groups=[];const remaining=new Set(cells);while(remaining.size){const seed=remaining.values().next().value;remaining.delete(seed);const group=[seed],corners=new Set();const add=c=>{for(const x of [c[0],c[2]])for(const y of [c[1],c[3]])corners.add(x+','+y)};add(seed);let changed=true;while(changed){changed=false;for(const c of remaining)if([c[0]+','+c[1],c[0]+','+c[3],c[2]+','+c[1],c[2]+','+c[3]].some(p=>corners.has(p))){remaining.delete(c);group.push(c);add(c);changed=true}}groups.push(group)}
 return groups.sort((a,b)=>b.length-a.length);
}

export {tableGroups};
