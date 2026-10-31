/* Local-only diagram editor. Files contain data, never HTML. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const svg = $('svg'), paper = document.querySelector('.paper'), KEY = 'diagram-editor-state';
  let W=1200,H=1200;
  const insertTypes = {
    activity:['action','decision','start','end'],
    swimlane:['action','decision','start','end'],
    sequence:['participant','lifeline','state','activation','connector','start','text'],
    er:['entity','relationship','attribute','text'],
    component:['component','class','interface','text'],
    deployment:['deployment','folder','component','text'],
    classdiagram:['class','interface','text'],
    usecase:['actor','usecase','system','text']
  };
  const colors = ['#f0f5fa', '#f3f7f0'];
  let state, selected = null, multiSelected = new Set(), connect = false, source = null, drag = null;
  let copiedNodes = [], pasteCount = 0;
  let history = [], future = [], last = '', selectedBend = null;
  const uid = () => crypto.randomUUID();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const blank = (mode = 'activity') => ({version:2, width:1200, height:1200, canvasOffsetX:0, canvasOffsetY:0, mode, title:'未命名活动图', lanes:[{name:'泳道 1',x:40,w:560},{name:'泳道 2',x:600,w:560}], nodes:[], edges:[]});
  const node = () => selected?.kind === 'node' ? state.nodes.find(n => n.id === selected.id) : null;
  const edge = () => selected?.kind === 'edge' ? state.edges.find(e => e.id === selected.id) : null;
  const lane = () => selected?.kind === 'lane' ? state.lanes[selected.id] : null;
  const status = message => { $('status').textContent = message; };
  const number = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;


  function importCampusSequence(raw) {
    if(raw.diagramType!=='sequence'||!Array.isArray(raw.elements)||raw.elements.length>5000)throw Error('暂不支持此 campus 图稿类型');
    const nodes=[],edges=[],used=new Set(),els=raw.elements,offset=60;
    const finite=(...xs)=>xs.every(Number.isFinite);
    for(const [i,e] of els.entries()){
      if(!e||!['rect','text','line'].includes(e.type))throw Error('不支持的 campus 图元：'+i);
      if(e.type==='line'){
        if(!validPoints(e.points)||e.points.length<2)throw Error('无效线条：'+i);
        const [a,b]=e.points;
        if(e.points.length===2&&e.dash&&!e.arrow&&a[0]===b[0]){
          nodes.push({id:'campus-'+i,type:'lifeline',x:a[0]-1,y:Math.min(a[1],b[1])+offset,w:2,h:Math.abs(b[1]-a[1]),text:''});used.add(i);
        }
      }else if(e.type==='rect'){
        if(!finite(e.x,e.y,e.w,e.h)||e.w<=0||e.h<=0)throw Error('无效矩形：'+i);
        // Shadow rectangles are decoration belonging to the following foreground rectangle.
        const next=els[i+1];
        if(e.stroke==='none'&&next?.type==='rect'&&next.w===e.w&&next.h===e.h&&Math.abs(next.x-e.x)<=10&&Math.abs(next.y-e.y)<=10){used.add(i);continue;}
        const type=e.radius>0?'state':e.w<=40&&e.h>e.w?'activation':'participant';
        const n={id:'campus-'+i,type,x:e.x,y:e.y+offset,w:e.w,h:e.h,text:''};
        const label=els[i+1];
        if(label?.type==='text'&&Math.abs(label.x-(e.x+e.w/2))<1&&Math.abs(label.y-(e.y+e.h/2))<1){n.text=label.text;n.fontSize=label.size;used.add(i+1);}
        nodes.push(n);used.add(i);
      }else if(!finite(e.x,e.y,e.size)||typeof e.text!=='string')throw Error('无效文字：'+i);
    }
    const endpoint=p=>{
      const candidates=nodes.filter(n=>n.type!=='text'&&p[0]>=n.x-1&&p[0]<=n.x+n.w+1&&p[1]+offset>=n.y-1&&p[1]+offset<=n.y+n.h+1);
      candidates.sort((a,b)=>(a.type==='lifeline')-(b.type==='lifeline')||a.w*a.h-b.w*b.h);
      const n=candidates[0];if(!n)throw Error('消息端点没有对应的参与者或执行条');
      return {id:n.id,anchor:[Math.max(0,Math.min(1,(p[0]-n.x)/n.w)),Math.max(0,Math.min(1,(p[1]+offset-n.y)/n.h))]};
    };
    for(const [i,e] of els.entries())if(e.type==='line'&&!used.has(i)){
      const a=endpoint(e.points[0]),b=endpoint(e.points.at(-1)),label=els[i+1]?.type==='text'&&!used.has(i+1)?els[i+1]:null;
      edges.push({id:'campus-edge-'+i,from:a.id,to:b.id,anchors:[a.anchor,b.anchor],via:e.points.slice(1,-1).map(([x,y])=>[x,y+offset]),arrow:e.arrow?'solid':'none',dashed:!!e.dash,label:label?.text||'',fontSize:label?.size||28,at:label?[label.x,label.y+offset+label.size*.33]:null});
      if(label)used.add(i+1);used.add(i);
    }
    for(const [i,e] of els.entries())if(e.type==='text'&&!used.has(i)){
      const w=Math.max(30,Array.from(e.text).length*e.size),h=e.size*1.3;
      nodes.push({id:'campus-'+i,type:'text',x:e.anchor==='start'?e.x:e.anchor==='end'?e.x-w:e.x-w/2,y:e.y+offset-h/2,w,h,text:e.text,fontSize:e.size});
    }
    return {version:2,mode:'sequence',title:raw.title,width:raw.width,height:raw.height+offset,nodes,edges};
  }

  function validate(raw) {
    if(raw?.schema==='campus-diagram/v1')raw=importCampusSequence(raw);
    // The supplied G01–G11 files use center coordinates and keyed nodes.
    if(raw && raw.nodes && !Array.isArray(raw.nodes) && typeof raw.nodes==='object') {
      const nodes=Object.entries(raw.nodes).map(([id,n])=>{
        if(!n || !['action','decision','start','end'].includes(n.kind))throw Error('不支持的节点类型：'+id);
        const w=n.kind==='start'?24:n.kind==='end'?38:n.kind==='decision'?52:n.w;
        const h=n.kind==='action'?n.h:w;
        return {id,type:n.kind,x:n.x-w/2,y:n.y-h/2,w,h,text:n.text||''};
      });
      raw={...raw,width:raw.width||1400,mode:Array.isArray(raw.lanes)&&raw.lanes.length?'swimlane':'activity',nodes,
        lanes:Array.isArray(raw.lanes)?raw.lanes.map(name=>({name,w:1})):[],
        edges:Array.isArray(raw.edges)?raw.edges.map(e=>({...e,from:e.a,to:e.b})):raw.edges};
    }
    if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || raw.nodes.length > 1000 || raw.edges.length > 3000) throw Error('图稿格式无效或图形过多');
    const s = blank(['swimlane','sequence','er','component','deployment','classdiagram','usecase'].includes(raw.mode) ? raw.mode : 'activity');
    s.width=number(raw.width,1200,400,4000);s.height=number(raw.height,1200,400,6000);
    s.canvasOffsetX=number(raw.canvasOffsetX,0,-4000,4000);s.canvasOffsetY=number(raw.canvasOffsetY,0,-6000,6000);
    s.title = typeof raw.title === 'string' ? raw.title.slice(0,300) : s.title;
    const ids = new Set();
    s.nodes = raw.nodes.map(n => {
      if (!n || typeof n.id !== 'string' || ids.has(n.id) || !['action','decision','start','end','state','activation','participant','lifeline','connector','entity','attribute','relationship','component','deployment','text','folder','class','interface','actor','usecase','system'].includes(n.type) || ![n.x,n.y,n.w,n.h].every(Number.isFinite)) throw Error('图稿包含无效节点');
      ids.add(n.id);
      const w = number(n.w,200,1,4000), h = number(n.h,70,1,6000);
      return {id:n.id,type:n.type,x:number(n.x,100,-4000,4000),y:number(n.y,150,-6000,6000),w,h,text:typeof n.text === 'string' ? n.text.slice(0,3000) : '',fontSize:number(n.fontSize,30,10,80),participant:typeof n.participant==='string'?n.participant:undefined,meaning:typeof n.meaning==='string'?n.meaning:undefined};
    });
    const edgeIds=new Set();
    s.edges = raw.edges.map(e => {
      if (!e || !ids.has(e.from) || !ids.has(e.to)) throw Error('连线引用了不存在的节点');
      const id=typeof e.id==='string'&&!edgeIds.has(e.id)?e.id:uid();edgeIds.add(id);
      return {id,arrow:['solid','open','none'].includes(e.arrow)?e.arrow:'solid',dashed:!!e.dashed,fontSize:number(e.fontSize,28,10,80),from:e.from,to:e.to,label:typeof e.label === 'string' ? e.label.slice(0,1000) : '',route:['straight','orthogonal','right'].includes(e.route) ? e.route : 'straight', via:validPoints(e.via), at:validPoint(e.at), ports:Array.isArray(e.ports)&&e.ports.length===2&&e.ports.every(p=>['auto','l','r','t','b'].includes(p))?e.ports:null, anchors:validAnchors(e.anchors)};
    });
    if (Array.isArray(raw.lanes) && raw.lanes.length) {
      if (raw.lanes.length > 8) throw Error('最多支持 8 条泳道');
      s.lanes = raw.lanes.map((l,i) => ({name:typeof l?.name === 'string' ? l.name.slice(0,200) : '泳道',w:number(l?.w,560,100,1120),color:/^#[0-9a-fA-F]{6}$/.test(l?.color)?l.color:colors[i%2]}));
    }
    layoutLanes(s);
    return s;
  }
  function validPoint(p){return Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)?p:null;}
  function validPoints(points){return Array.isArray(points)&&points.length<=100&&points.every(validPoint)?points:null;}
  function validAnchors(points){return Array.isArray(points)&&points.length===2&&points.some(Boolean)&&points.every(p=>p===null||Array.isArray(p)&&p.length===2&&p.every(x=>Number.isFinite(x)&&x>=0&&x<=1))?points:null;}
  function parseFile(text){return validate(JSON.parse(text.replace(/^\uFEFF/,'')));}
  function layoutLanes(s) {
    const total = s.lanes.reduce((sum,l) => sum + l.w, 0);
    let x = 40;
    s.lanes.forEach(l => { l.w = l.w / total * (s.width-80); l.x = x; x += l.w; });
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); status('已自动保存 · ' + new Date().toLocaleTimeString()); }
    catch { status('浏览器保存不可用，请导出 JSON 图稿保存'); }
  }
  function commit() {
    const next = JSON.stringify(state);
    if (next !== last) { if (last) history.push(last); if(history.length>80)history.shift(); future=[]; last=next; }
    persist(); sync();
  }
  function travel(back) {
    const from = back ? history : future, to = back ? future : history;
    if (!from.length) return;
    to.push(JSON.stringify(state)); state=JSON.parse(from.pop()); last=JSON.stringify(state);
    selected=null;multiSelected.clear();source=null;draw();sync();persist();
  }
  function sync() {
    const n=multiSelected.size>1?null:node(), e=edge();
    if(document.activeElement!==$('title'))$('title').value=state.title;
    if(document.activeElement!==$('text'))$('text').value=n?.text??e?.label??lane()?.name??'';
    $('text').disabled=!n&&!e&&!lane();
    $('nodeWidth').value=n?.w??''; $('nodeHeight').value=n?.h??'';
    $('nodeWidth').disabled=$('nodeHeight').disabled=!n;
    $('laneColorControl').hidden=!lane();
    if(lane())$('laneColor').value=lane().color||colors[selected.id%2];
    $('catalog').value=window.DIAGRAM_LIST.findIndex(d=>d.title===state.title);
    document.querySelectorAll('[data-add]').forEach(b=>{b.hidden=!insertTypes[state.mode].includes(b.dataset.add);if(b.dataset.add==='start')b.querySelector('span').textContent=state.mode==='sequence'?'外部触发':'开始';});
    $('edgeStyleControls').hidden=!e;
    $('edgeArrow').value=e?.arrow||'solid';$('edgeDashed').checked=!!e?.dashed;
    $('addLane').hidden=state.mode!=='swimlane';
    $('mode').value=state.mode; $('addLane').disabled=state.mode!=='swimlane'||state.lanes.length>=8;
    $('edgeRoute').disabled=!e; $('edgeRoute').value=e?.route||'straight';
    $('connectionProperties').hidden=!e;
    if(e){
      for(const [control,key] of [['edgeFrom','from'],['edgeTo','to']]){
        $(control).replaceChildren(...state.nodes.map((n,i)=>new Option(`${i+1}. ${n.text.replace(/\n/g,' ')||({start:'开始',end:'结束',decision:'判断'}[n.type]||'节点')}`,n.id)));
        $(control).value=e[key];
      }
      $('fromPort').value=e.ports?.[0]||'auto';$('toPort').value=e.ports?.[1]||'auto';
    }
    $('deleteBend').disabled=!e||selectedBend===null;
    $('edgeLabel').disabled=!e; $('remove').disabled=!selected&&!multiSelected.size;
    $('copy').disabled=!multiSelected.size; $('paste').disabled=!copiedNodes.length;
    $('undo').disabled=!history.length; $('redo').disabled=!future.length;
    $('connect').textContent=connect ? (source?'连线：选择终点':'连线：选择起点') : '连线：关闭';
    $('connect').classList.toggle('active',connect);
  }
  const center = n => ({x:n.x+n.w/2,y:n.y+n.h/2});
  // Intersect a ray with the node boundary so the arrow remains visible.
  function boundary(n, toward) {
    const c=center(n), dx=toward.x-c.x, dy=toward.y-c.y;
    if(!dx&&!dy)return c;
    let t;
    if(['decision','relationship'].includes(n.type))t=1/(Math.abs(dx)/(n.w/2)+Math.abs(dy)/(n.h/2));
    else if(n.type==='start'||n.type==='end')t=1/Math.sqrt((dx/(n.w/2))**2+(dy/(n.h/2))**2);
    else {
      t=Math.min(dx ? n.w/2/Math.abs(dx):Infinity,dy ? n.h/2/Math.abs(dy):Infinity);
      // Account for the activity box's rounded corners.
      const r=Math.min(16,n.w/2,n.h/2), px=Math.abs(dx*t), py=Math.abs(dy*t);
      if(px>n.w/2-r && py>n.h/2-r){const cx=n.w/2-r,cy=n.h/2-r,a=dx*dx+dy*dy,b=-2*(Math.abs(dx)*cx+Math.abs(dy)*cy),d=cx*cx+cy*cy-r*r;t=(-b+Math.sqrt(Math.max(0,b*b-4*a*d)))/(2*a);}
    }
    return {x:c.x+dx*t,y:c.y+dy*t};
  }
  function geometry(e) {
    if(['sequence','er','component','deployment','classdiagram','usecase'].includes(state.mode))return DiagramRender.geometry(state,e);
    const a=state.nodes.find(n=>n.id===e.from),b=state.nodes.find(n=>n.id===e.to);
    const ca=center(a),cb=center(b);
    let points;
    if(e.via?.length){
      const port=(n,p,toward)=>{const c=center(n);return p&&p!=='auto'?{l:{x:n.x,y:c.y},r:{x:n.x+n.w,y:c.y},t:{x:c.x,y:n.y},b:{x:c.x,y:n.y+n.h}}[p]:boundary(n,toward);};
      const via=e.via.map(([x,y])=>({x,y}));
      points=[e.anchors?.[0]?{x:a.x+a.w*e.anchors[0][0],y:a.y+a.h*e.anchors[0][1]}:port(a,e.ports?.[0],via[0]),...via,e.anchors?.[1]?{x:b.x+b.w*e.anchors[1][0],y:b.y+b.h*e.anchors[1][1]}:port(b,e.ports?.[1],via.at(-1))];
    }else if(e.route==='right'){
      const x=Math.min(W-25,Math.max(...state.nodes.map(n=>n.x+n.w))+18);
      points=[boundary(a,{x,y:ca.y}),{x,y:ca.y},{x,y:cb.y},boundary(b,{x,y:cb.y})];
    }else if(e.route==='orthogonal' && Math.abs(ca.x-cb.x)>1 && Math.abs(ca.y-cb.y)>1){
      const y=(ca.y+cb.y)/2;
      points=[boundary(a,{x:ca.x,y}),{x:ca.x,y},{x:cb.x,y},boundary(b,{x:cb.x,y})];
    }else {
      const pair=state.edges.filter(line=>line.route==='straight'&&!line.via?.length&&((line.from===e.from&&line.to===e.to)||(line.from===e.to&&line.to===e.from)));
      if(pair.length>1){
        const first=state.nodes.find(n=>n.id===[e.from,e.to].sort()[0]),second=first===a?b:a;
        const c1=center(first),c2=center(second),distance=Math.hypot(c2.x-c1.x,c2.y-c1.y)||1;
        const offset=(pair.indexOf(e)-(pair.length-1)/2)*40;
        const bend={x:(ca.x+cb.x)/2-(c2.y-c1.y)/distance*offset,y:(ca.y+cb.y)/2+(c2.x-c1.x)/distance*offset};
        points=[boundary(a,bend),bend,boundary(b,bend)];
      }else points=[boundary(a,cb),boundary(b,ca)];
    }
    if(e.anchors){
      if(e.anchors[0])points[0]={x:a.x+a.w*e.anchors[0][0],y:a.y+a.h*e.anchors[0][1]};
      if(e.anchors[1])points[points.length-1]={x:b.x+b.w*e.anchors[1][0],y:b.y+b.h*e.anchors[1][1]};
    }
    if(e.ports){
      const portPoint=(n,p,fallback)=>{const c=center(n);return {l:{x:n.x,y:c.y},r:{x:n.x+n.w,y:c.y},t:{x:c.x,y:n.y},b:{x:c.x,y:n.y+n.h}}[p]||fallback;};
      if(!e.anchors?.[0])points[0]=portPoint(a,e.ports[0],points[0]);
      if(!e.anchors?.[1])points[points.length-1]=portPoint(b,e.ports[1],points.at(-1));
    }
    const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
    let remaining=lengths.reduce((a,b)=>a+b,0)/2, label=points[0];
    for(let i=0;i<lengths.length;i++){if(remaining<=lengths[i]){const t=lengths[i]?remaining/lengths[i]:0;label={x:points[i].x+(points[i+1].x-points[i].x)*t,y:points[i].y+(points[i+1].y-points[i].y)*t};break;}remaining-=lengths[i];}
    return {points,d:points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' '),label};
  }
  function endpointHandles(){
    const line=edge();if(!line)return '';
    const points=geometry(line).points;
    return [points[0],points.at(-1)].map((p,i)=>`<circle class="endpoint-handle" data-endpoint="${i}" cx="${p.x}" cy="${p.y}" r="8"><title>${i?'终点':'起点'}连接位置（保持原节点）</title></circle>`).join('');
  }
  function draw() {
    W=state.width;H=state.height;svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    paper.style.width=`${W}px`;paper.style.height=`${H}px`;
    paper.style.transform=`translate(${state.canvasOffsetX||0}px,${state.canvasOffsetY||0}px)`;
    $('canvasSize').textContent=`画布 ${Math.round(W)} × ${Math.round(H)}；拖动四条边可调整大小`;
    if(['sequence','er','component','deployment','classdiagram','usecase'].includes(state.mode)){
      let content=DiagramRender.contents(state);
      for(const n of state.nodes)if(multiSelected.has(n.id)||source===n.id)content+=`<rect class="selection" x="${n.x-5}" y="${n.y-5}" width="${n.w+10}" height="${n.h+10}"/>`;
      if(node()) {const n=node();content+=`<rect class="resize" data-resize="${esc(n.id)}" x="${n.x+n.w-5}" y="${n.y+n.h-5}" width="10" height="10"/>`;}
      if(edge())geometry(edge()).points.slice(1,-1).forEach((p,i)=>{content+=`<circle class="bend-handle ${selectedBend===i?'active':''}" data-bend="${i}" cx="${p.x}" cy="${p.y}" r="7"/>`;});
      if(drag?.kind==='marquee')content+=`<rect class="marquee" x="${Math.min(drag.start.x,drag.current.x)}" y="${Math.min(drag.start.y,drag.current.y)}" width="${Math.abs(drag.current.x-drag.start.x)}" height="${Math.abs(drag.current.y-drag.start.y)}"/>`;
      svg.innerHTML=content+endpointHandles();return;
    }
    let html=`<defs><marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="13" markerHeight="12" refX="12" refY="6" orient="auto"><path d="M0 0 L12 6 L0 12 Z" fill="#111"/></marker><marker id="openArrow" markerUnits="userSpaceOnUse" markerWidth="15" markerHeight="12" refX="13" refY="6" orient="auto"><path d="M1 1 L12 6 L1 11" fill="none" stroke="#111" stroke-width="2"/></marker></defs><rect width="${W}" height="${H}" fill="white"/><text class="diagram-title" x="${W/2}" y="38">${esc(state.title)}</text>`;
    if(state.mode==='swimlane')state.lanes.forEach((l,i)=>{
      const chosen=selected?.kind==='lane'&&selected.id===i;
      html+=`<g data-lane="${i}"><rect class="lane ${chosen?'selected-lane':''}" x="${l.x}" y="65" width="${l.w}" height="${H-90}" fill="${l.color||colors[i%2]}"/><rect class="lanehead" x="${l.x}" y="65" width="${l.w}" height="60" fill="${l.color||colors[i%2]}"/><text class="lanetext" x="${l.x+l.w/2}" y="95">${esc(l.name)}</text></g>`;
    });
    if(state.mode==='swimlane')state.lanes.slice(0,-1).forEach((l,i)=>{html+=`<path data-divider="${i}" class="lane-divider" d="M${l.x+l.w} 65 V${H-25}"/>`;});
    for(const e of state.edges){const {points,label}=geometry(e), chosen=selected?.kind==='edge'&&selected.id===e.id;
      const lx=e.at?.[0]??label.x+(e.route==='right'?-12:12),ly=e.at?.[1]??label.y-12;
      html+=`<g data-edge="${esc(e.id)}">${points.slice(1).map((p,i)=>`<path class="edge-hit" data-segment="${i}" d="M${points[i].x} ${points[i].y} L${p.x} ${p.y}"/><path class="edge ${chosen?'selected':''}" data-segment="${i}" d="M${points[i].x} ${points[i].y} L${p.x} ${p.y}" ${e.dashed?'stroke-dasharray="9 6"':''} ${i===points.length-2&&e.arrow!=='none'?`marker-end="url(#${e.arrow==='open'?'openArrow':'arrow'})"`:''}/>`).join('')}<text class="edgetext" data-label="${esc(e.id)}" x="${lx}" y="${ly}" style="text-anchor:${e.route==='right'?'end':'middle'};paint-order:stroke;stroke:white;stroke-width:4;stroke-linejoin:round;fill:#111">${esc(e.label)}</text></g>`;
    }
    for(const n of state.nodes){const c=center(n);let shape;
      if(n.type==='action')shape=`<rect class="shape" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="16"/>`;
      else if(['decision','relationship'].includes(n.type))shape=`<polygon class="shape" points="${c.x},${n.y} ${n.x+n.w},${c.y} ${c.x},${n.y+n.h} ${n.x},${c.y}"/>`;
      else shape=`<ellipse class="${n.type==='start'?'dot':'ring'}" cx="${c.x}" cy="${c.y}" rx="${n.w/2}" ry="${n.h/2}"/>`+(n.type==='end'?`<ellipse class="enddot" cx="${c.x}" cy="${c.y}" rx="${n.w/3}" ry="${n.h/3}"/>`:'');
      const lines=[];for(const paragraph of n.text.split('\n')){const chars=Array.from(paragraph);const count=Math.max(1,Math.floor((n.w-24)/20));if(!chars.length)lines.push('');else for(let i=0;i<chars.length;i+=count)lines.push(chars.slice(i,i+count).join(''));}
      html+=`<g class="node" data-node="${esc(n.id)}">${shape}${lines.map((line,i)=>`<text class="node-label" x="${c.x}" y="${c.y+(i-(lines.length-1)/2)*24}">${esc(line)}</text>`).join('')}</g>`;
      if(multiSelected.has(n.id)||source===n.id)html+=`<rect class="selection" x="${n.x-5}" y="${n.y-5}" width="${n.w+10}" height="${n.h+10}"/>`;
      if(multiSelected.size===1&&selected?.kind==='node'&&selected.id===n.id)html+=`<rect class="resize" data-resize="${esc(n.id)}" x="${n.x+n.w-5}" y="${n.y+n.h-5}" width="10" height="10"/>`;
    }
    if(drag?.kind==='nodes'&&Number.isFinite(drag.guideX))html+=`<line class="snap-guide" x1="${drag.guideX}" x2="${drag.guideX}" y1="65" y2="${H-25}"/>`;
    if(drag?.kind==='marquee'){
      const x=Math.min(drag.start.x,drag.current.x),y=Math.min(drag.start.y,drag.current.y);
      html+=`<rect class="marquee" x="${x}" y="${y}" width="${Math.abs(drag.current.x-drag.start.x)}" height="${Math.abs(drag.current.y-drag.start.y)}"/>`;
    }
    if(edge())geometry(edge()).points.slice(1,-1).forEach((p,i)=>{html+=`<circle class="bend-handle ${selectedBend===i?'active':''}" data-bend="${i}" cx="${p.x}" cy="${p.y}" r="7"/>`;});
    svg.innerHTML=html+endpointHandles();
  }
  function update(){draw();sync();commit();}
  function copyNodes(){
    if(!multiSelected.size)return;
    copiedNodes=state.nodes.filter(n=>multiSelected.has(n.id)).map(n=>({...n}));
    pasteCount=0;sync();status(`已复制 ${copiedNodes.length} 个节点`);
  }
  function pasteNodes(){
    if(!copiedNodes.length)return;
    pasteCount++;
    const minX=Math.min(...copiedNodes.map(n=>n.x)),maxX=Math.max(...copiedNodes.map(n=>n.x+n.w));
    const minY=Math.min(...copiedNodes.map(n=>n.y)),maxY=Math.max(...copiedNodes.map(n=>n.y+n.h));
    const dx=number(pasteCount*28,0,-minX,W-maxX),dy=number(pasteCount*28,0,50-minY,H-maxY);
    const added=copiedNodes.map(n=>({...n,id:uid(),x:n.x+dx,y:n.y+dy}));
    state.nodes.push(...added);
    multiSelected=new Set(added.map(n=>n.id));
    selected=added.length===1?{kind:'node',id:added[0].id}:null;
    source=null;update();status(`已粘贴 ${added.length} 个节点（不含连线）`);
  }
  $('copy').onclick=copyNodes;
  $('paste').onclick=pasteNodes;
  function select(kind,id){selectedBend=null;selected=kind?{kind,id}:null;multiSelected=kind==='node'?new Set([id]):new Set();draw();sync();}
  function loadTemplate(kind){
    if(!kind)return;
    state=kind==='blank'?blank(state.mode):validate(templates[kind]());
    if(kind==='activity'){
      const positions={s:[586,90],n1:[470,155],n2:[470,290],d1:[576,435],d2:[386,580],fail:[820,530],auto:[90,730],manual:[470,730],save:[280,900],ef:[930,720],e:[390,1075]};
      state.nodes.forEach(n=>{[n.x,n.y]=positions[n.id];});
    }else if(kind==='swimlane'){
      const positions={s:[300,165],input:[190,230],check:[760,345],decision:[860,480],success:[625,605],failure:[910,605],show:[625,775],save:[190,945],e1:[1005,960],e2:[300,1090]};
      state.nodes.forEach(n=>{[n.x,n.y]=positions[n.id];if(n.id==='failure')n.w=230;});
      state.nodes.push({id:'retry',type:'decision',x:998,y:795,w:48,h:48,text:''});
      const old=state.edges.find(e=>e.from==='failure');old.to='retry';old.label='';
      state.edges.push({id:uid(),from:'retry',to:'e1',label:'结束恢复',route:'straight'},{id:uid(),from:'retry',to:'input',label:'重新输入',route:'right'});
    }
    selected=null;multiSelected.clear();source=null;update();$('template').value='';
  }
  $('template').onchange=e=>loadTemplate(e.target.value);
  $('mode').onchange=e=>{state.mode=e.target.value;selected=null;multiSelected.clear();source=null;update();};
  document.querySelectorAll('[data-add]').forEach(b=>{const type=b.dataset.add;const narrow=['activation','lifeline'].includes(type),round=['start','end','connector','interface'].includes(type);b.innerHTML=`<svg class="palette-symbol" viewBox="-18 -28 180 130" aria-hidden="true">${DiagramRender.node({id:'palette-'+type,type,x:0,y:0,w:narrow?12:round?65:140,h:round?65:80,text:type==='text'?'T':''}).replaceAll('class="node"','').replaceAll('data-node=','data-symbol=')}</svg><span>${b.textContent.replace(/^[＋◇●◎]\s*/, '')}</span>`;});
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{
    if(!insertTypes[state.mode].includes(b.dataset.add))return;
    const type=b.dataset.add,small=['start','end','connector','interface'].includes(type),w=small?44:type==='state'?140:type==='actor'?90:type==='usecase'?200:type==='system'?500:type==='class'?240:type==='lifeline'?2:type==='activation'?24:['decision','relationship'].includes(type)?90:type==='deployment'?400:240,h=type==='state'?140:type==='actor'?90:type==='usecase'?200:type==='system'?500:type==='class'?240:type==='lifeline'?600:type==='deployment'?300:type==='class'?210:type==='activation'?150:['action','state','participant','entity','component'].includes(type)?90:small?44:100;
    const offset=(state.nodes.length%8)*22,n={id:uid(),type,x:400+offset,y:200+offset,w,h,text:({action:'新活动',state:'新状态',participant:'参与者',entity:'实体',attribute:'属性',relationship:'关系',component:'构件',folder:'软件',class:'类名\n--\n属性\n--\n操作()',interface:'接口',actor:'参与者',usecase:'用例',system:'系统边界',deployment:'部署节点',connector:'A',text:'文字'})[type]||''};
    state.nodes.push(n);selected={kind:'node',id:n.id};multiSelected=new Set([n.id]);update();
  });
  $('title').oninput=e=>{state.title=e.target.value;draw();commit();};
  $('text').oninput=e=>{const target=node()||edge()||lane();if(target){target[node()?'text':edge()?'label':'name']=e.target.value;draw();commit();}};
  $('laneColor').oninput=e=>{if(lane()){lane().color=e.target.value;draw();commit();}};
  for(const [id,key] of [['nodeWidth','w'],['nodeHeight','h']])$(id).onchange=e=>{const n=node();if(!n)return;n[key]=number(Number(e.target.value),n[key],n.type==='lifeline'?1:20,key==='w'?W-n.x:H-n.y-20);update();};
  $('edgeArrow').onchange=e=>{if(edge()){edge().arrow=e.target.value;update();}};
  $('edgeDashed').onchange=e=>{if(edge()){edge().dashed=e.target.checked;update();}};
  $('edgeRoute').onchange=e=>{if(edge()){selectedBend=null;edge().route=e.target.value;edge().via=null;edge().ports=null;edge().at=null;update();}};
  for(const [id,key] of [['edgeFrom','from'],['edgeTo','to']])$(id).onchange=event=>{
    const e=edge();if(!e)return;
    if(event.target.value===e[key==='from'?'to':'from']){status('起点和终点请选择不同节点');sync();return;}
    e[key]=event.target.value;selectedBend=null;update();
  };
  for(const [id,index] of [['fromPort',0],['toPort',1]])$(id).onchange=event=>{const e=edge();if(!e)return;e.ports=e.ports||['auto','auto'];e.ports[index]=event.target.value;if(e.anchors)e.anchors[index]=null;if(e.anchors&&!e.anchors.some(Boolean))e.anchors=null;update();};
  function materialize(e){const points=geometry(e).points;e.via=points.slice(1,-1).map(p=>[p.x,p.y]);e.route='straight';return points;}
  function nearestAnchor(n,p){
    const cx=n.x+n.w/2,cy=n.y+n.h/2;
    if(n.type==='lifeline')return [.5,Math.max(0,Math.min(1,(p.y-n.y)/n.h))];
    if(['start','end','connector','attribute','interface'].includes(n.type)){
      const dx=p.x-cx,dy=p.y-cy,r=Math.sqrt((dx/(n.w/2))**2+(dy/(n.h/2))**2);if(!r)return [1,.5];const k=1/r;
      return [(cx+dx*k-n.x)/n.w,(cy+dy*k-n.y)/n.h];
    }
    let candidates;
    if(['decision','relationship'].includes(n.type))candidates=[[cx,n.y],[n.x+n.w,cy],[cx,n.y+n.h],[n.x,cy]];
    else candidates=[[n.x,n.y,n.x+n.w,n.y],[n.x+n.w,n.y,n.x+n.w,n.y+n.h],[n.x+n.w,n.y+n.h,n.x,n.y+n.h],[n.x,n.y+n.h,n.x,n.y]];
    if(['decision','relationship'].includes(n.type))candidates=candidates.map((a,i)=>[...a,...[candidates[(i+1)%4][0],candidates[(i+1)%4][1]]]);
    const projected=candidates.map((v,i)=>{
      const [x1,y1,x2,y2]=v.length===2?[v[0],v[1],candidates[(i+1)%4][0],candidates[(i+1)%4][1]]:v;
      const t=Math.max(0,Math.min(1,((p.x-x1)*(x2-x1)+(p.y-y1)*(y2-y1))/((x2-x1)**2+(y2-y1)**2||1)));
      const x=x1+(x2-x1)*t,y=y1+(y2-y1)*t;return {x,y,d:(x-p.x)**2+(y-p.y)**2};
    }).sort((a,b)=>a.d-b.d)[0];
    return [(projected.x-n.x)/n.w,(projected.y-n.y)/n.h];
  }
  // Choose a compass ray from the fixed point that intersects the dragged node.
  function snapLineEndpoint(n,fixed,p){
    const candidates=[];
    for(let i=0;i<8;i++){
      const angle=i*Math.PI/4,dx=Math.cos(angle),dy=Math.sin(angle),hits=[];
      if(['usecase','attribute','interface','connector','start','end'].includes(n.type)){
        const rx=n.w/2,ry=n.h/2,cx=n.x+rx,cy=n.y+ry;
        const a=(dx/rx)**2+(dy/ry)**2,b=2*((fixed.x-cx)*dx/rx**2+(fixed.y-cy)*dy/ry**2),c=((fixed.x-cx)/rx)**2+((fixed.y-cy)/ry)**2-1;
        const disc=b*b-4*a*c;if(disc>=0)hits.push((-b-Math.sqrt(disc))/(2*a),(-b+Math.sqrt(disc))/(2*a));
      }else{
        for(const x of [n.x,n.x+n.w])if(Math.abs(dx)>1e-8){const t=(x-fixed.x)/dx,y=fixed.y+t*dy;if(y>=n.y-1e-6&&y<=n.y+n.h+1e-6)hits.push(t);}
        for(const y of [n.y,n.y+n.h])if(Math.abs(dy)>1e-8){const t=(y-fixed.y)/dy,x=fixed.x+t*dx;if(x>=n.x-1e-6&&x<=n.x+n.w+1e-6)hits.push(t);}
      }
      for(const t of hits)if(t>1e-6){const q={x:fixed.x+t*dx,y:fixed.y+t*dy};candidates.push({q,d:(q.x-p.x)**2+(q.y-p.y)**2});}
    }
    candidates.sort((a,b)=>a.d-b.d);
    return candidates[0]?.q||null;
  }
  function setSegmentPoint(e,index,p,pointCount){
    if(index===0){const n=state.nodes.find(n=>n.id===e.from);e.anchors=e.anchors||[null,null];e.anchors[0]=nearestAnchor(n,p);e.ports=e.ports||['auto','auto'];e.ports[0]='auto';}
    else if(index===pointCount-1){const n=state.nodes.find(n=>n.id===e.to);e.anchors=e.anchors||[null,null];e.anchors[1]=nearestAnchor(n,p);e.ports=e.ports||['auto','auto'];e.ports[1]='auto';}
    else e.via[index-1]=[p.x,p.y];
    if(e.anchors&&!e.anchors.some(Boolean))e.anchors=null;
  }
  $('addBend').onclick=()=>{const e=edge();if(!e)return;const points=materialize(e);let best=0,length=-1;
    points.slice(1).forEach((p,i)=>{const d=Math.hypot(p.x-points[i].x,p.y-points[i].y);if(d>length){length=d;best=i;}});
    e.via.splice(best,0,[(points[best].x+points[best+1].x)/2,(points[best].y+points[best+1].y)/2]);selectedBend=best;update();
  };
  $('deleteBend').onclick=()=>{const e=edge();if(!e||selectedBend===null)return;materialize(e);e.via.splice(selectedBend,1);selectedBend=null;update();};
  $('addLane').onclick=()=>{if(state.lanes.length>=8)return;state.lanes.push({name:'泳道 '+(state.lanes.length+1),w:(W-80)/state.lanes.length,color:colors[state.lanes.length%2]});layoutLanes(state);selected={kind:'lane',id:state.lanes.length-1};multiSelected.clear();update();};
  $('connect').onclick=()=>{connect=!connect;source=null;draw();sync();};
  function remove(){if(!selected&&!multiSelected.size)return;const {kind,id}=selected||{kind:'node'};
    if(kind==='node'){const ids=multiSelected.size?multiSelected:new Set([id]);state.nodes=state.nodes.filter(n=>!ids.has(n.id));state.edges=state.edges.filter(e=>!ids.has(e.from)&&!ids.has(e.to));}
    if(kind==='edge')state.edges=state.edges.filter(e=>e.id!==id);
    if(kind==='lane'){if(state.lanes.length<=1){status('至少保留一条泳道');return;}state.lanes.splice(id,1);layoutLanes(state);}
    selected=null;multiSelected.clear();source=null;update();
  }
  $('remove').onclick=remove;
  $('edgeLabel').onclick=()=>{$('text').focus();$('text').select();};
  $('undo').onclick=()=>travel(true);$('redo').onclick=()=>travel(false);$('save').onclick=persist;
  $('load').onclick=()=>{try{const raw=localStorage.getItem(KEY);if(!raw){status('还没有保存的图稿');return;}state=parseFile(raw);selected=null;multiSelected.clear();source=null;update();}catch(e){status('读取失败：'+e.message);}};
  function download(blob,name){if(!blob)throw Error('文件生成失败');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  const filename=()=> (state.title||'活动图').replace(/[\\/:*?"<>|]/g,'_');
  $('exportFile').onclick=()=>download(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),filename()+'.json');
  $('import').onclick=()=>$('file').click();
  $('file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>5*1024*1024)throw Error('图稿不能超过 5 MB');const bytes=new Uint8Array(await file.arrayBuffer());const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';const next=parseFile(new TextDecoder(encoding,{fatal:true}).decode(bytes));state=next;selected=null;multiSelected.clear();source=null;update();status('导入成功：'+file.name+'（'+state.nodes.length+' 个节点）');}catch(err){status('导入失败：'+err.message);alert('导入失败：'+err.message+'\n请选择具体的 JSON 图稿文件，而非图稿目录文件。');}finally{e.target.value='';}};
  $('png').onclick=async()=>{
    $('png').disabled=true;let url;
    try{
      await document.fonts.ready;
      const clone=svg.cloneNode(true);clone.setAttribute('width',W);clone.setAttribute('height',H);
      clone.querySelectorAll('.selection,.resize,.edge-hit,.lane-divider,.bend-handle,.endpoint-handle,.marquee,.snap-guide').forEach(el=>el.remove());
      clone.querySelectorAll('.selected,.selected-lane').forEach(el=>el.classList.remove('selected','selected-lane'));
      const style=document.createElementNS('http://www.w3.org/2000/svg','style');
      style.textContent=document.querySelector('style').textContent;clone.prepend(style);
      url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml;charset=utf-8'}));
      const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('绘图渲染失败'));image.src=url;});
      const canvas=document.createElement('canvas');canvas.width=W*2;canvas.height=H*2;
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));download(blob,filename()+'.png');status(`已导出 ${W*2} × ${H*2} PNG`);
    }catch(e){status('导出失败：'+e.message);}finally{if(url)URL.revokeObjectURL(url);$('png').disabled=false;}
  };
  let canvasDrag=null;
  document.querySelectorAll('[data-canvas-edge]').forEach(grip=>{
    grip.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      canvasDrag={side:grip.dataset.canvasEdge,x:event.clientX,y:event.clientY,rect:paper.getBoundingClientRect(),before:structuredClone(state)};
      grip.classList.add('dragging');grip.setPointerCapture(event.pointerId);event.preventDefault();
    });
    grip.addEventListener('pointermove',event=>{
      if(!canvasDrag)return;
      const {side,x,y,rect,before}=canvasDrag;
      state=structuredClone(before);
      const dx=event.clientX-x,dy=event.clientY-y;
      if(side==='left'||side==='right'){
        let width=number(before.width+(side==='right'?dx:-dx),before.width,400,4000);
        if(state.mode==='swimlane'){
          const boundaryLane=side==='left'?before.lanes[0]:before.lanes.at(-1);
          width=Math.max(width,before.width-(boundaryLane.w-90));
        }
        const amount=side==='left'?before.width-width:width-before.width;
        state.width=width;
        if(side==='left'){
          state.nodes.forEach(n=>n.x-=amount);
          state.edges.forEach(line=>{line.via?.forEach(p=>p[0]-=amount);if(line.at)line.at[0]-=amount;});
          if(state.mode==='swimlane')state.lanes[0].w-=amount;
        }else if(state.mode==='swimlane')state.lanes.at(-1).w+=amount;
        if(state.mode==='swimlane'){
          let laneX=40;state.lanes.forEach(lane=>{lane.x=laneX;laneX+=lane.w;});
        }
      }else{
        const height=number(before.height+(side==='bottom'?dy:-dy),before.height,400,6000);
        const amount=before.height-height;
        state.height=height;
        if(side==='top'){
          state.nodes.forEach(n=>n.y-=amount);
          state.edges.forEach(line=>{line.via?.forEach(p=>p[1]-=amount);if(line.at)line.at[1]-=amount;});
        }
      }
      draw();
      const current=paper.getBoundingClientRect();
      if(side==='left')state.canvasOffsetX+=rect.right-current.right;
      if(side==='right')state.canvasOffsetX+=rect.left-current.left;
      if(side==='top')state.canvasOffsetY+=rect.bottom-current.bottom;
      if(side==='bottom')state.canvasOffsetY+=rect.top-current.top;
      paper.style.transform=`translate(${state.canvasOffsetX}px,${state.canvasOffsetY}px)`;
    });
    const finish=()=>{if(!canvasDrag)return;canvasDrag=null;grip.classList.remove('dragging');commit();};
    grip.addEventListener('pointerup',finish);grip.addEventListener('pointercancel',finish);
  });
  const point=e=>{const p=new DOMPoint(e.clientX,e.clientY);return p.matrixTransform(svg.getScreenCTM().inverse());};
  const menu=$('contextMenu');
  const hideMenu=()=>{menu.hidden=true;};
  svg.addEventListener('contextmenu',e=>{
    e.preventDefault();
    const g=e.target.closest('[data-node]');
    if(!g){hideMenu();return;}
    const id=g.dataset.node;
    if(!multiSelected.has(id))select('node',id);
    menu.querySelectorAll('button').forEach(button=>button.disabled=multiSelected.size<2);
    menu.hidden=false;
    menu.style.left=Math.min(e.clientX,window.innerWidth-menu.offsetWidth-8)+'px';
    menu.style.top=Math.min(e.clientY,window.innerHeight-menu.offsetHeight-8)+'px';
  });
  document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))hideMenu();});
  menu.addEventListener('click',e=>{
    const axis=e.target.dataset.align;if(!axis||multiSelected.size<2)return;
    const nodes=state.nodes.filter(n=>multiSelected.has(n.id));
    const target=nodes.reduce((sum,n)=>sum+(axis==='horizontal'?n.y+n.h/2:n.x+n.w/2),0)/nodes.length;
    nodes.forEach(n=>{if(axis==='horizontal')n.y=number(target-n.h/2,n.y,50,H-n.h);else n.x=number(target-n.w/2,n.x,0,W-n.w);});
    hideMenu();update();
  });
  let lastPress = {key:null,time:0};
  svg.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    hideMenu();
    const handle=e.target.closest('[data-endpoint]');
    if(handle&&edge()){
      const line=edge(),points=geometry(line).points;
      line.anchors=[points[0],points.at(-1)].map((p,i)=>{const n=state.nodes.find(n=>n.id===(i?line.to:line.from));return [(p.x-n.x)/n.w,(p.y-n.y)/n.h];});
      drag={kind:'endpoint',id:line.id,index:Number(handle.dataset.endpoint),point:point(e),origin:points[Number(handle.dataset.endpoint)]};
      svg.setPointerCapture(e.pointerId);e.preventDefault();return;
    }
    const label=e.target.closest('[data-label]');
    if(label){const id=label.dataset.label,line=state.edges.find(item=>item.id===id);select('edge',id);const fallback=geometry(line).label;drag={kind:'label',id,point:point(e),x:line.at?.[0]??fallback.x+(line.route==='right'?-12:12),y:line.at?.[1]??fallback.y-12};svg.setPointerCapture(e.pointerId);e.preventDefault();return;}
    const bend=e.target.closest('[data-bend]'),segment=e.target.closest('[data-segment]');
    if(bend&&edge()){const eLine=edge();materialize(eLine);selectedBend=Number(bend.dataset.bend);drag={kind:'bend',id:eLine.id,index:selectedBend,point:point(e)};svg.setPointerCapture(e.pointerId);draw();sync();e.preventDefault();return;}
    if(segment){const group=segment.closest('[data-edge]'),eLine=state.edges.find(line=>line.id===group.dataset.edge);select('edge',eLine.id);const points=materialize(eLine);drag={kind:'segment',id:eLine.id,index:Number(segment.dataset.segment),point:point(e),points:points.map(p=>({...p}))};svg.setPointerCapture(e.pointerId);e.preventDefault();return;}
    const resize=e.target.closest('[data-resize]'),g=e.target.closest('[data-node]'),line=e.target.closest('[data-edge]'),divider=e.target.closest('[data-divider]'),lane=e.target.closest('[data-lane]');
    const laneHeader=lane&&(e.target.classList.contains('lanehead')||e.target.classList.contains('lanetext'));
    const key=g?'node:'+g.dataset.node:laneHeader?'lane:'+lane.dataset.lane:null;
    const twice=key&&key===lastPress.key&&Date.now()-lastPress.time<350;
    lastPress={key,time:Date.now()};
    if(twice&&!connect&&!resize&&!divider&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey){e.preventDefault();select(g?'node':'lane',g?g.dataset.node:Number(lane.dataset.lane));$('text').focus();$('text').select();lastPress.key=null;return;}
    if(divider){const i=Number(divider.dataset.divider);drag={kind:'lane',i,point:point(e),left:state.lanes[i].w,right:state.lanes[i+1].w};}
    else if(g||resize){const id=g?.dataset.node||resize.dataset.resize,n=state.nodes.find(n=>n.id===id);
      if(connect&&!resize){if(!source){source=id;select('node',id);return;}if(source!==id){state.edges.push({id:uid(),from:source,to:id,label:'',route:'straight'});commit();}source=null;select('node',id);return;}
      const shiftToggle=(e.shiftKey||e.ctrlKey||e.metaKey)&&!resize?{id,wasSelected:multiSelected.has(id)}:null;
      if(shiftToggle){if(shiftToggle.wasSelected)multiSelected.delete(id);else multiSelected.add(id);selected=multiSelected.size===1?{kind:'node',id:[...multiSelected][0]}:null;draw();sync();e.preventDefault();return;}
      if(resize){multiSelected=new Set([id]);selected={kind:'node',id};drag={kind:'resize',id,point:point(e),x:n.x,y:n.y,w:n.w,h:n.h};}
      else{
        if(!multiSelected.has(id))multiSelected=new Set([id]);
        const ids=[...multiSelected],group=new Set(ids);
        selected=ids.length===1?{kind:'node',id}:null;
        drag={kind:'nodes',primary:id,shiftToggle,moved:false,point:point(e),positions:state.nodes.filter(item=>group.has(item.id)).map(item=>({id:item.id,x:item.x,y:item.y,w:item.w,h:item.h})),
          internalEdges:state.edges.filter(line=>group.has(line.from)&&group.has(line.to)).map(line=>({id:line.id,via:line.via?.map(p=>[...p]),at:line.at?[...line.at]:null}))};
      }
    }else if(line){select('edge',line.dataset.edge);return;}
    else if(laneHeader){select('lane',Number(lane.dataset.lane));return;}
    else{multiSelected.clear();selected=null;source=null;const start=point(e);drag={kind:'marquee',point:start,start,current:start};}
    svg.setPointerCapture(e.pointerId);draw();sync();e.preventDefault();
  });
  svg.addEventListener('pointermove',e=>{if(!drag)return;const p=point(e),dx=p.x-drag.point.x,dy=p.y-drag.point.y;
    if(drag.kind==='marquee'){
      drag.current=p;
      const left=Math.min(drag.start.x,p.x),right=Math.max(drag.start.x,p.x),top=Math.min(drag.start.y,p.y),bottom=Math.max(drag.start.y,p.y);
      multiSelected=new Set(state.nodes.filter(n=>n.x<right&&n.x+n.w>left&&n.y<bottom&&n.y+n.h>top).map(n=>n.id));
      selected=multiSelected.size===1?{kind:'node',id:[...multiSelected][0]}:null;
    }
    else if(drag.kind==='nodes'){
      if(Math.hypot(dx,dy)>3)drag.moved=true;
      const positions=drag.positions;
      const lowX=Math.max(...positions.map(item=>-item.x)),highX=Math.min(...positions.map(item=>W-item.x-item.w));
      const lowY=Math.max(...positions.map(item=>50-item.y)),highY=Math.min(...positions.map(item=>H-item.y-item.h));
      let wantedX=dx,wantedY=dy;
      if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))wantedY=0;else wantedX=0;}
      let moveX=lowX<=highX?Math.max(lowX,Math.min(highX,wantedX)):wantedX;
      const moveY=lowY<=highY?Math.max(lowY,Math.min(highY,wantedY)):wantedY;
      drag.guideX=null;
      if(state.mode==='swimlane'){
        const primary=positions.find(item=>item.id===drag.primary),cx=primary.x+primary.w/2+moveX;
        const currentLane=state.lanes.find(l=>cx>=l.x&&cx<=l.x+l.w);
        if(currentLane){
          const centerX=currentLane.x+currentLane.w/2;
          if(Math.abs(cx-centerX)<=12){
            drag.guideX=centerX;
            if(!e.shiftKey||wantedX!==0)moveX=Math.max(lowX,Math.min(highX,moveX+centerX-cx));
          }
        }
      }
      positions.forEach(item=>{const n=state.nodes.find(n=>n.id===item.id);n.x=item.x+moveX;n.y=item.y+moveY;});
      drag.internalEdges.forEach(item=>{const line=state.edges.find(line=>line.id===item.id);if(item.via)line.via=item.via.map(p=>[p[0]+moveX,p[1]+moveY]);if(item.at)line.at=[item.at[0]+moveX,item.at[1]+moveY];});
    }
    else if(drag.kind==='label'){const line=state.edges.find(item=>item.id===drag.id);line.at=[number(drag.x+dx,drag.x,0,W),number(drag.y+dy,drag.y,50,H-20)];}
    else if(drag.kind==='bend'){const eLine=state.edges.find(e=>e.id===drag.id);eLine.via[drag.index]=[number(p.x,0,0,W),number(p.y,0,50,H-20)];}
    else if(drag.kind==='endpoint'){const line=state.edges.find(e=>e.id===drag.id),n=state.nodes.find(n=>n.id===(drag.index?line.to:line.from));const points=geometry(line).points,fixed=drag.index?points.at(-2):points[1],target=e.shiftKey?snapLineEndpoint(n,fixed,p):null;line.anchors[drag.index]=target?[(target.x-n.x)/n.w,(target.y-n.y)/n.h]:nearestAnchor(n,p);}
    else if(drag.kind==='segment'){const eLine=state.edges.find(e=>e.id===drag.id),i=drag.index,count=drag.points.length;setSegmentPoint(eLine,i,{x:drag.points[i].x+dx,y:drag.points[i].y+dy},count);setSegmentPoint(eLine,i+1,{x:drag.points[i+1].x+dx,y:drag.points[i+1].y+dy},count);}
    else if(drag.kind==='lane'){const a=state.lanes[drag.i],b=state.lanes[drag.i+1],delta=Math.max(90-drag.left,Math.min(drag.right-90,dx));a.w=drag.left+delta;b.w=drag.right-delta;layoutLanes(state);}
    else if(drag.kind==='resize'){const n=state.nodes.find(n=>n.id===drag.id);n.w=number(drag.w+dx,drag.w,20,W-n.x);n.h=number(drag.h+dy,drag.h,20,H-n.y-20);}
    draw();
  });
  const endDrag=()=>{if(drag){
    const marquee=drag.kind==='marquee';
    if(drag.kind==='nodes'&&drag.shiftToggle&&!drag.moved&&drag.shiftToggle.wasSelected){
      multiSelected.delete(drag.shiftToggle.id);
      selected=multiSelected.size===1?{kind:'node',id:[...multiSelected][0]}:null;
    }
    drag=null;draw();sync();commit();
  }};
  svg.addEventListener('pointerup',endDrag);svg.addEventListener('pointercancel',endDrag);svg.addEventListener('lostpointercapture',endDrag);
  document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select'))return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='c'){e.preventDefault();copyNodes();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='v'){e.preventDefault();pasteNodes();return;}
    if(e.key==='Escape'){hideMenu();connect=false;source=null;select(null);}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();travel(!e.shiftKey);}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();travel(false);}
  });
  try{const raw=localStorage.getItem(KEY);state=raw?parseFile(raw):blank();}catch{state=blank();status('旧图稿无法读取，可重新导入 JSON 文件');}
  window.diagramEditor={importData:raw=>{state=validate(raw);selected=null;multiSelected.clear();draw();sync();commit();},exportData:()=>JSON.parse(JSON.stringify(state))};

  const catalog=$('catalog');if(catalog){catalog.replaceChildren(new Option('选择教材图稿…','-1'),...window.DIAGRAM_LIST.map((d,i)=>new Option(d.title,i)));catalog.value=window.DIAGRAM_LIST.findIndex(d=>d.title===state.title);catalog.onchange=()=>{if(Number(catalog.value)>=0)window.diagramEditor.importData(window.DIAGRAM_LIST[Number(catalog.value)]);};}
  last=JSON.stringify(state);draw();sync();
})();
