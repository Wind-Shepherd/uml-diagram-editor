/* Shared renderer for the editable JSON, editor preview, SVG and PNG output. */
(function(root){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const center=n=>({x:n.x+n.w/2,y:n.y+n.h/2});
  function boundary(n,t){
    const c=center(n),dx=t.x-c.x,dy=t.y-c.y;if(!dx&&!dy)return c;
    const type=n.type;
    const k=['decision','relationship'].includes(type)?1/(Math.abs(dx)/(n.w/2)+Math.abs(dy)/(n.h/2)):
      ['start','end','connector','attribute','interface'].includes(type)?1/Math.sqrt((dx/(n.w/2))**2+(dy/(n.h/2))**2):
      Math.min(dx?n.w/2/Math.abs(dx):Infinity,dy?n.h/2/Math.abs(dy):Infinity);
    return {x:c.x+dx*k,y:c.y+dy*k};
  }
  function geometry(d,e){
    const a=d.nodes.find(n=>n.id===e.from),b=d.nodes.find(n=>n.id===e.to),ca=center(a),cb=center(b);
    const port=(n,p,t)=>{const c=center(n);return {l:{x:n.x,y:c.y},r:{x:n.x+n.w,y:c.y},t:{x:c.x,y:n.y},b:{x:c.x,y:n.y+n.h}}[p]||boundary(n,t)};
    let mid=(e.via||[]).map(([x,y])=>({x,y}));
    if(!mid.length&&e.route==='orthogonal')mid=[{x:ca.x,y:(ca.y+cb.y)/2},{x:cb.x,y:(ca.y+cb.y)/2}];
    let pts=[port(a,e.ports?.[0],mid[0]||cb),...mid,port(b,e.ports?.[1],mid.at(-1)||ca)];
    for(const [i,n] of [[0,a],[1,b]])if(e.anchors?.[i])pts[i?pts.length-1:0]={x:n.x+n.w*e.anchors[i][0],y:n.y+n.h*e.anchors[i][1]};
    const lengths=pts.slice(1).map((p,i)=>Math.hypot(p.x-pts[i].x,p.y-pts[i].y));let remain=lengths.reduce((a,b)=>a+b,0)/2,label=pts[0];
    for(let i=0;i<lengths.length;i++){if(remain<=lengths[i]){const t=lengths[i]?remain/lengths[i]:0;label={x:pts[i].x+(pts[i+1].x-pts[i].x)*t,y:pts[i].y+(pts[i+1].y-pts[i].y)*t};break;}remain-=lengths[i];}
    return {points:pts,d:pts.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' '),label};
  }
  function text(x,y,value,size=30,attrs='',align='middle'){
    const lines=String(value).split('\n');
    return `<text x="${x}" y="${y}" text-anchor="${align}" font-family="SimSun,Microsoft YaHei,serif" font-size="${size}" fill="#111" ${attrs}>${lines.map((line,i)=>`<tspan x="${x}" dy="${i?size*1.22:-(lines.length-1)*size*.61}">${esc(line)}</tspan>`).join('')}</text>`;
  }
  function node(n){
    const {x,y,w,h}=n,c=center(n),s=n.fontSize||30,shape='fill="white" stroke="#222" stroke-width="2.5"';let out='';
    if(n.type==='lifeline')return `<g data-node="${esc(n.id)}"><path d="M${c.x} ${y} V${y+h}" stroke="#777" stroke-width="3" stroke-dasharray="15 12" fill="none"/><path d="M${c.x} ${y} V${y+h}" stroke="transparent" stroke-width="12"/></g>`;
    if(n.type==='text')out='';
    else if(n.type==='actor')out=`<circle cx="${c.x}" cy="${y+h*.18}" r="${Math.min(w*.2,h*.12)}" ${shape}/><path d="M${c.x} ${y+h*.3} V${y+h*.7} M${x+w*.12} ${y+h*.45} H${x+w*.88} M${c.x} ${y+h*.7} L${x+w*.2} ${y+h*.98} M${c.x} ${y+h*.7} L${x+w*.8} ${y+h*.98}" fill="none" stroke="#222" stroke-width="2.5"/>`;
    else if(n.type==='system')out=`<rect x="${x}" y="${y}" width="${w}" height="${h}" ${shape}/>`;
    else if(n.type==='usecase')out=`<ellipse cx="${c.x}" cy="${c.y}" rx="${w/2}" ry="${h/2}" ${shape}/>`;
    else if(n.type==='start')out=`<ellipse cx="${c.x}" cy="${c.y}" rx="${w/2}" ry="${h/2}" fill="#222"/>`;
    else if(n.type==='end')out=`<ellipse cx="${c.x}" cy="${c.y}" rx="${w/2}" ry="${h/2}" ${shape}/><ellipse cx="${c.x}" cy="${c.y}" rx="${w/3}" ry="${h/3}" fill="#222"/>`;
    else if(['connector','attribute','interface'].includes(n.type))out=`<ellipse cx="${c.x}" cy="${c.y}" rx="${w/2}" ry="${h/2}" ${shape}/>`;
    else if(['decision','relationship'].includes(n.type))out=`<polygon points="${c.x},${y} ${x+w},${c.y} ${c.x},${y+h} ${x},${c.y}" ${shape}/>`;
    else if(n.type==='folder'){const tab=Math.min(18,h*.18);out=`<path d="M${x+8} ${y+tab} L${x+8} ${y+5} Q${x+8} ${y} ${x+16} ${y} H${x+w*.3} L${x+w*.36} ${y+tab} H${x+w-7} Q${x+w} ${y+tab} ${x+w} ${y+tab+8} L${x+w-6} ${y+h-8} Q${x+w-7} ${y+h} ${x+w-15} ${y+h} H${x+9} Q${x} ${y+h} ${x+1} ${y+h-10} L${x+5} ${y+tab+8} Q${x+5} ${y+tab} ${x+13} ${y+tab} Z" fill="#ddd" stroke="#222" stroke-width="2.5"/>`;}
    else if(n.type==='class'){const parts=String(n.text||'\n--\n\n--\n').split(/\n--\n/);const head=h*.28,rest=(h-head)/Math.max(1,parts.length-1);out=`<rect x="${x+5}" y="${y+6}" width="${w}" height="${h}" fill="#666"/><rect x="${x}" y="${y}" width="${w}" height="${h}" ${shape}/>`;parts.forEach((part,i)=>{const top=i?y+head+(i-1)*rest:y;if(i)out+=`<path d="M${x} ${top} H${x+w}" stroke="#222" stroke-width="2"/>`;out+=text(i?x+10:c.x,top+(i?rest:head)/2+s*.3,part,s,'style="dominant-baseline:alphabetic"',i?'start':'middle');});return `<g class="node" data-node="${esc(n.id)}">${out}</g>`;}
    else if(n.type==='deployment')out=`<polygon points="${x},${y} ${x+30},${y-26} ${x+w+30},${y-26} ${x+w},${y}" fill="#ddd" stroke="#222" stroke-width="2.5"/><polygon points="${x+w},${y} ${x+w+30},${y-26} ${x+w+30},${y+h-26} ${x+w},${y+h}" fill="#c7c7c7" stroke="#222" stroke-width="2.5"/><rect x="${x}" y="${y}" width="${w}" height="${h}" ${shape}/>`;
    else {
      const r=['state','action'].includes(n.type)?Math.min(w,h)*.23:0;
      if(['state','participant','component','activation','connector'].includes(n.type))out+=`<rect x="${x+4}" y="${y+5}" width="${w}" height="${h}" rx="${r}" fill="#666"/>`;
      out+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ${shape}/>`;
      if(n.type==='component'){const tw=w*.23,th=h*.23;out+=`<rect x="${x-tw/2}" y="${y+h*.1}" width="${tw}" height="${th}" fill="#aaa" stroke="#222" stroke-width="2"/><rect x="${x-tw/2}" y="${y+h*.67}" width="${tw}" height="${th}" fill="#aaa" stroke="#222" stroke-width="2"/>`;}
    }
    const wrap=value=>String(value).split('\n').flatMap(line=>{const result=[];let part='',units=0;for(const ch of line){const u=/[\x00-\x7f]/.test(ch)?.55:1;if(units+u>(w-24)/s&&part){result.push(part);part='';units=0;}part+=ch;units+=u;}result.push(part);return result;}).join('\n');
    if(n.text)out+=text(n.type==='component'?c.x+w*.04:c.x,n.type==='interface'||n.type==='actor'?y+h+s+5:n.type==='system'?y+s+12:n.type==='deployment'?y+50:c.y+s*.33,(n.type==='interface'?n.text:wrap(n.text)),s,'class="node-label" style="font-size:'+s+'px;dominant-baseline:alphabetic;pointer-events:none"');
    return `<g class="node" data-node="${esc(n.id)}">${out}</g>`;
  }
  function edge(d,e){
    const geo=geometry(d,e),arrow=e.arrow??'solid',lx=e.at?.[0]??geo.label.x,ly=e.at?.[1]??geo.label.y-13;
    let label=e.label||'',size=e.fontSize||28,labelY=ly;
    if(d.mode==='sequence'&&geo.points.length===2&&Math.abs(geo.points[0].y-geo.points[1].y)<1&&Math.abs(geo.points[0].x-geo.points[1].x)>220){
      const max=(Math.abs(geo.points[0].x-geo.points[1].x)-8)/size,lines=[];
      for(const p of label.split('\n')){let part='',units=0;for(const ch of p){const u=/[\x00-\x7f]/.test(ch)?.55:1;if(units+u>max&&part){lines.push(part);part='';units=0;}part+=ch;units+=u;}lines.push(part);}
      label=lines.join('\n');labelY-=(lines.length-1)*size*.61;
    }
    return `<g data-edge="${esc(e.id)}">${geo.points.slice(1).map((p,i)=>`<path class="edge-hit" data-segment="${i}" d="M${geo.points[i].x} ${geo.points[i].y} L${p.x} ${p.y}" fill="none" stroke="transparent" stroke-width="14"/><path data-segment="${i}" d="M${geo.points[i].x} ${geo.points[i].y} L${p.x} ${p.y}" fill="none" stroke="#222" stroke-width="2.3" ${e.dashed?'stroke-dasharray="13 9"':''} ${i===geo.points.length-2&&arrow!=='none'?`marker-end="url(#${arrow==='open'?'openArrow':'arrow'})"`:''}/>`).join('')}${e.label?text(lx,labelY,label,size,`data-label="${esc(e.id)}" style="paint-order:stroke;stroke:white;stroke-width:6;stroke-linejoin:round;cursor:move"`):''}</g>`;
  }
  function contents(d){
    const bg=d.nodes.filter(n=>['lifeline','deployment','system'].includes(n.type)),fg=d.nodes.filter(n=>!['lifeline','deployment','system'].includes(n.type));
    return `<defs><marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="15" markerHeight="14" refX="14" refY="7" orient="auto"><path d="M0 0 L14 7 L0 14 Z" fill="#222"/></marker><marker id="openArrow" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="14" refX="14" refY="7" orient="auto"><path d="M1 1 L14 7 L1 13" fill="none" stroke="#222" stroke-width="2"/></marker></defs><rect width="${d.width}" height="${d.height}" fill="white"/>${text(d.width/2,35,d.title,28)}${bg.map(node).join('')}${fg.map(node).join('')}${d.edges.map(e=>edge(d,e)).join('')}`;
  }
  const api={geometry,node,edge,contents,svg:d=>`<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}" height="${d.height}" viewBox="0 0 ${d.width} ${d.height}">${contents(d)}</svg>`};
  if(typeof module!=='undefined')module.exports=api;else root.DiagramRender=api;
})(typeof window==='undefined'?globalThis:window);
