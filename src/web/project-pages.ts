import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  PROJECT_IMAGE_PREVIEW_CLIENT_SCRIPT,
  PROJECT_IMAGE_PREVIEW_STYLES,
  PROJECT_SHELL_CLIENT_SCRIPT,
  PROJECT_SHELL_STYLES,
  projectShellMarkup,
} from './project-shell.js';

function send(res: ServerResponse, html: string): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(html);
}

function guard(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET') return true;
  res.statusCode = 405;
  res.setHeader('allow', 'GET');
  res.end();
  return false;
}

export function projectDashboardHandler(req: IncomingMessage, res: ServerResponse): void {
  if (!guard(req, res)) return;
  send(res, DASHBOARD);
}

export function projectCanonHandler(req: IncomingMessage, res: ServerResponse): void {
  if (!guard(req, res)) return;
  send(res, CANON);
}

export function projectCollectionHandler(req: IncomingMessage, res: ServerResponse): void {
  if (!guard(req, res)) return;
  send(res, COLLECTION);
}

export function projectAnchorDetailHandler(req: IncomingMessage, res: ServerResponse): void {
  if (!guard(req, res)) return;
  send(res, ANCHOR);
}

const BASE_STYLE = `:root{font-family:Inter,ui-sans-serif,system-ui;color:#f4f7fa;background:#0c1117;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0c1117}
main{max-width:1200px;margin:auto;padding:28px}
a{color:#aab5c2}
.status{padding:14px;border:1px solid #2d3947;border-radius:12px;background:#141b23;margin:18px 0}
.error{color:#ffc0c0;border-color:#743a3a}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}
.card{background:#141b23;border:1px solid #293542;border-radius:14px;overflow:hidden;color:inherit;text-decoration:none}
.card>img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}
.body{padding:13px}
.meta{font-size:11px;color:#8997a8;margin-top:5px}
.empty{padding:28px;color:#7d8b9d}
.nav{display:flex;gap:8px;flex-wrap:wrap}
.nav a{padding:7px 10px;border:1px solid #293542;border-radius:999px;text-decoration:none}
.nav a[aria-current="page"]{color:#fff;border-color:#5c728b;background:#1b2632}
${PROJECT_SHELL_STYLES}
${PROJECT_IMAGE_PREVIEW_STYLES}`;

const DASHBOARD = String.raw`<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Project · Visual Director</title><style>${BASE_STYLE}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.stat{padding:14px;border:1px solid #293542;border-radius:12px;background:#141b23}
.value{font-size:25px;font-weight:750}
@media(max-width:640px){.stats{grid-template-columns:repeat(2,1fr)}}
</style></head>
<body><main>
${projectShellMarkup('Project')}
<div id="status" class="status">Loading project…</div>
<div id="anchors" class="grid"></div>
<h2>Workflow</h2>
<div id="stats" class="stats"></div>
</main><script>
${PROJECT_SHELL_CLIENT_SCRIPT}
${PROJECT_IMAGE_PREVIEW_CLIENT_SCRIPT}
const m=location.pathname.match(/^\/projects\/([^/]+)\/?$/),project=m?decodeURIComponent(m[1]):'';
const q=s=>document.querySelector(s),el=(t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;if(x!==undefined)n.textContent=x;return n};
const root='/projects/'+encodeURIComponent(project),asset=p=>'/api/projects/'+encodeURIComponent(project)+'/asset?path='+encodeURIComponent(p);
setupProjectShell(project,'overview');
Promise.all([
  fetch('/api/projects').then(r=>r.json()),
  fetch('/api/projects/'+encodeURIComponent(project)+'/overview').then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'Overview failed');return d}),
]).then(([c,o])=>{
  const p=c.projects?.find(x=>x.project_id===project);
  if(!p)throw new Error('Unknown project_id: '+project);
  q('#title').textContent=p.display_name;
  setProjectContext(p);
  q('#status').textContent=p.repository+' @ '+p.ref;
  for(const a of o.approved_anchors){
    const name=a.display_name||a.subject_id;const card=el('a','card');card.href=root+'/anchors/'+encodeURIComponent(a.subject_id);
    card.append(createImagePreview(asset(a.path),a.path,name),el('div','body',name));q('#anchors').append(card);
  }
  const counts={anchors:o.approved_anchors.length,candidates:o.workflow.assets.filter(a=>a.status==='candidate').length,jobs:o.workflow.jobs.length,failed:o.workflow.jobs.filter(j=>j.status==='failed').length};
  for(const [k,v] of Object.entries(counts)){const s=el('div','stat');s.append(el('div','value',String(v)),el('div','meta',k));q('#stats').append(s)}
}).catch(e=>{q('#status').className='status error';q('#status').textContent=e.message});
</script></body></html>`;

const CANON = String.raw`<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Global Visual Canon · Visual Director</title><style>${BASE_STYLE}
.hero{display:grid;grid-template-columns:minmax(280px,1.35fr) minmax(260px,.65fr);gap:18px;align-items:start;margin:20px 0 30px}
.reference{background:#10171f;border:1px solid #334253;border-radius:16px;overflow:hidden}
.reference img{display:block;width:100%;height:auto;max-height:660px;object-fit:contain;background:#080c11}
.panel{padding:18px;border:1px solid #293542;border-radius:14px;background:#141b23}
.badge{display:inline-block;padding:5px 9px;border-radius:999px;background:#253548;color:#dbe8f7;font-size:11px;font-weight:700;letter-spacing:.08em}
.path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;color:#b7c4d2}
.flow{display:grid;grid-template-columns:minmax(190px,.8fr) 36px minmax(220px,1fr) 36px minmax(190px,.8fr);gap:10px;align-items:center;margin:16px 0 28px}
.node{border:1px solid #334253;border-radius:14px;background:#141b23;padding:15px;min-height:112px}
.rootnode{border-color:#657f9d;background:#182331}
.arrow{text-align:center;color:#708196;font-size:26px}
.anchorlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:8px;margin-top:10px}
.mini{display:flex;gap:8px;align-items:center;padding:7px;border-radius:10px;background:#0f151c}
.mini img{width:42px;height:42px;border-radius:8px;object-fit:cover}
.legend{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 18px}
.legend span{font-size:12px;color:#9cabbc}
.note{border-left:3px solid #526b87;padding:10px 14px;color:#aab7c5;background:#111820}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.stat{padding:14px;border:1px solid #293542;border-radius:12px;background:#141b23}
.value{font-size:24px;font-weight:750}
@media(max-width:760px){.hero{grid-template-columns:1fr}.flow{grid-template-columns:1fr}.arrow{transform:rotate(90deg)}.stats{grid-template-columns:1fr}}
</style></head>
<body><main>
${projectShellMarkup('Global Visual Canon')}
<div id="status" class="status">Loading Canon…</div>
<div id="content" hidden>
  <div class="hero"><div class="reference"><img id="reference" alt="Global Visual Canon reference"></div>
    <div class="panel"><span class="badge">ROOT CANON</span><h2>Source of truth</h2>
      <div class="meta">Definition document</div><div id="documentPath" class="path"></div>
      <div class="meta" style="margin-top:14px">Canonical reference</div><div id="assetPath" class="path"></div>
      <p>The reference image and its style definition are the root visual authority for this project. Approved Anchors inherit from this Canon; generated assets inherit from those Anchors.</p>
      <div class="note">Hosted Visual Director keeps repository writes read-only. Canon changes are reviewed in the project repository, then this view reflects the new source of truth.</div>
    </div>
  </div>
  <h2>Visual inheritance</h2>
  <div class="legend"><span>Root Canon = project-wide appearance</span><span>•</span><span>Approved Anchors = subject identity</span><span>•</span><span>Derived Assets = scene variations</span></div>
  <div class="flow"><div class="node rootnode"><strong>Global Visual Canon</strong><div class="meta">Every generated visual starts here</div></div><div class="arrow">→</div><div class="node"><strong>Approved Visual Anchors</strong><div id="anchorList" class="anchorlist"></div></div><div class="arrow">→</div><div class="node"><strong>Managed Assets</strong><div class="meta">Candidates and approved derivatives must preserve Canon + Anchor constraints.</div></div></div>
  <h2>Managed state</h2><div id="stats" class="stats"></div>
</div>
</main><script>
${PROJECT_SHELL_CLIENT_SCRIPT}
${PROJECT_IMAGE_PREVIEW_CLIENT_SCRIPT}
const m=location.pathname.match(/^\/projects\/([^/]+)\/canon\/?$/),project=m?decodeURIComponent(m[1]):'';
const q=s=>document.querySelector(s),el=(t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;if(x!==undefined)n.textContent=x;return n};
const root='/projects/'+encodeURIComponent(project),asset=p=>'/api/projects/'+encodeURIComponent(project)+'/asset?path='+encodeURIComponent(p);
setupProjectShell(project,'canon');
Promise.all([
  fetch('/api/projects').then(r=>r.json()),
  fetch('/api/projects/'+encodeURIComponent(project)+'/overview').then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'Overview failed');return d}),
]).then(([c,o])=>{
  const p=c.projects?.find(x=>x.project_id===project);
  if(!p)throw new Error('Unknown project_id: '+project);
  const canon=o.visual_direction.global_style;
  if(!canon?.asset_path||!canon?.document_path)throw new Error('Global Visual Canon is not configured.');
  setProjectContext(p);
  q('#status').textContent=p.display_name+' · '+p.repository+' @ '+p.ref;
  q('#reference').src=asset(canon.asset_path);q('#documentPath').textContent=canon.document_path;q('#assetPath').textContent=canon.asset_path;
  const list=q('#anchorList');
  for(const a of o.approved_anchors){const name=a.display_name||a.subject_id;const item=el('a','mini');item.href=root+'/anchors/'+encodeURIComponent(a.subject_id);item.append(createImagePreview(asset(a.path),a.path,name),el('span','',name));list.append(item)}
  if(!o.approved_anchors.length)list.append(el('div','meta','No approved anchors yet.'));
  const approved=o.workflow.assets.filter(a=>a.status==='approved'||a.status==='registered').length;
  for(const [label,value] of [['Approved Anchors',o.approved_anchors.length],['Managed Assets',o.workflow.assets.length],['Approved / Registered',approved]]){const s=el('div','stat');s.append(el('div','value',String(value)),el('div','meta',label));q('#stats').append(s)}
  q('#content').hidden=false;
}).catch(e=>{q('#status').className='status error';q('#status').textContent=e.message});
</script></body></html>`;

const COLLECTION = String.raw`<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Project view · Visual Director</title><style>${BASE_STYLE}</style></head>
<body><main>
${projectShellMarkup('Loading…')}
<div id="status" class="status">Loading repository state…</div><div id="content"></div>
</main><script>
${PROJECT_SHELL_CLIENT_SCRIPT}
${PROJECT_IMAGE_PREVIEW_CLIENT_SCRIPT}
const m=location.pathname.match(/^\/projects\/([^/]+)\/(anchors|assets|generations)\/?$/),project=m?decodeURIComponent(m[1]):'',mode=m?m[2]:'';
const q=s=>document.querySelector(s),el=(t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;if(x!==undefined)n.textContent=x;return n};
const root='/projects/'+encodeURIComponent(project),asset=p=>'/api/projects/'+encodeURIComponent(project)+'/asset?path='+encodeURIComponent(p);
setupProjectShell(project,mode);
q('#title').textContent={anchors:'Approved Anchors',assets:'Asset Gallery',generations:'Generation Jobs'}[mode]||'Project workflow';
Promise.all([
  fetch('/api/projects').then(r=>r.json()),
  fetch('/api/projects/'+encodeURIComponent(project)+'/overview').then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'Overview failed');return d}),
]).then(([c,o])=>{
  const p=c.projects?.find(x=>x.project_id===project);
  if(!p)throw new Error('Unknown project_id: '+project);
  setProjectContext(p);q('#status').textContent=p.display_name;
  const out=q('#content'),grid=el('div','grid');
  if(mode==='anchors')for(const a of o.approved_anchors){const name=a.display_name||a.subject_id;const card=el('a','card');card.href=root+'/anchors/'+encodeURIComponent(a.subject_id);card.append(createImagePreview(asset(a.path),a.path,name),el('div','body',name));grid.append(card)}
  else if(mode==='assets')for(const a of o.workflow.assets){const card=el('div','card'),pth=a.registered_path||a.candidate_path;if(pth)card.append(createImagePreview(asset(pth),pth,a.asset_id||a.asset_type));card.append(el('div','body',a.asset_type+' · '+a.status));grid.append(card)}
  else for(const j of o.workflow.jobs)grid.append(el('div','card body',(j.request_text||j.job_id)+' · '+j.status));
  out.append(grid.children.length?grid:el('div','empty','No items registered.'));
}).catch(e=>{q('#status').className='status error';q('#status').textContent=e.message});
</script></body></html>`;

const ANCHOR = String.raw`<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Approved Anchor · Visual Director</title><style>${BASE_STYLE}</style></head>
<body><main>
${projectShellMarkup('Approved Anchor')}
<div id="status" class="status">Loading…</div><div id="content" class="grid"></div>
</main><script>
${PROJECT_SHELL_CLIENT_SCRIPT}
const m=location.pathname.match(/^\/projects\/([^/]+)\/anchors\/([^/]+)\/?$/),project=m?decodeURIComponent(m[1]):'',subject=m?decodeURIComponent(m[2]):'';
const q=s=>document.querySelector(s),asset=p=>'/api/projects/'+encodeURIComponent(project)+'/asset?path='+encodeURIComponent(p);
setupProjectShell(project,'anchors');
Promise.all([
  fetch('/api/projects').then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'Project catalog request failed');return d}),
  fetch('/api/projects/'+encodeURIComponent(project)+'/anchor-detail?subject_id='+encodeURIComponent(subject)).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'Anchor detail failed');return d}),
]).then(([catalog,d])=>{
  const p=catalog.projects?.find(x=>x.project_id===project);
  if(!p)throw new Error('Unknown project_id: '+project);
  setProjectContext(p);
  q('#title').textContent=d.anchor.display_name;
  q('#status').textContent=d.anchor.path;
  const img=document.createElement('img');img.src=asset(d.anchor.path);img.alt=d.anchor.display_name||subject;img.style.width='100%';img.style.height='auto';img.style.aspectRatio='auto';img.style.objectFit='contain';
  const card=document.createElement('div');card.className='card';card.append(img);q('#content').append(card);
  const info=document.createElement('div');info.className='card body';info.textContent=d.canon_constraints.subject_lock.join(' ');q('#content').append(info);
}).catch(e=>{q('#status').className='status error';q('#status').textContent=e.message});
</script></body></html>`;
