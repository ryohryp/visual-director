import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  PROJECT_IMAGE_PREVIEW_CLIENT_SCRIPT,
  PROJECT_IMAGE_PREVIEW_STYLES,
  PROJECT_SHELL_CLIENT_SCRIPT,
  PROJECT_SHELL_STYLES,
  projectShellMarkup,
} from './project-shell.js';

export function projectCollectionHandler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET');
    res.end();
    return;
  }

  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(HTML);
}

const HTML = String.raw`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Project workflow · Visual Director</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f4f7fa;background:#0c1117;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0c1117;min-height:100vh}
main{max-width:1200px;margin:auto;padding:28px}
a{color:#aab5c2}
.status{padding:14px;border:1px solid #2d3947;border-radius:12px;background:#141b23;margin:18px 0}
.error{color:#ffc0c0;border-color:#743a3a}
  .inventory-summary{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 10px}
  .inventory-summary[hidden]{display:none}
  .state-filter{display:grid;gap:2px;min-width:108px;padding:9px 12px;border:1px solid #303b48;border-radius:10px;background:#131a22;color:#aeb9c6;text-align:left;cursor:pointer}
  .state-filter strong{font-size:17px;color:#f4f7fa}
  .state-filter.active{border-color:#69829e;background:#1b2938;color:#fff}
  .plan-state{margin:0 0 12px;color:#8997a8;font-size:12px}
  .filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:14px;border:1px solid #293440;background:#131a22;border-radius:14px;margin:10px 0 18px}
.filters[hidden]{display:none}
select{width:100%;padding:10px 11px;border-radius:9px;background:#0e141b;border:1px solid #303b48;color:#dbe1e8}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}
.card{background:#141b23;border:1px solid #2a3542;border-radius:14px;overflow:hidden;color:inherit;text-decoration:none}
.asset-card{cursor:pointer;transition:transform .15s,border-color .15s}
.asset-card:hover{transform:translateY(-2px);border-color:#52677f}
.thumb{width:100%;aspect-ratio:4/3;object-fit:cover;background:#090c10;display:block}
.thumb.empty{display:grid;place-items:center;color:#6f7e90;font-size:12px}
.body{padding:13px}
.badge{display:inline-block;padding:5px 8px;border-radius:999px;border:1px solid #3a4655;font-size:9px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}
.badge.candidate{color:#ffd77c;border-color:#66542a;background:#2b2517}
.badge.approved,.badge.registered{color:#7ee3a3;border-color:#2b6040;background:#163824}
.badge.rejected,.badge.failed{color:#ff9b9b;border-color:#673838;background:#2b1919}
  .badge.superseded{color:#aab2bd;border-color:#4a5059;background:#21252b}
  .badge.missing{color:#b8c2ce;border-color:#465362;background:#202832}
  .badge.review_required{color:#ffd77c;border-color:#66542a;background:#2b2517}
  .badge.ready{color:#7ee3a3;border-color:#2b6040;background:#163824}
  .badge.broken{color:#ff9b9b;border-color:#673838;background:#2b1919}
  .badge.unmanaged{color:#d5b3ff;border-color:#63477d;background:#291d36}
.name{font-weight:660;margin-top:8px;font-size:13px}
.meta,.path{font-size:11px;color:#8997a8;margin-top:5px;overflow-wrap:anywhere}
.path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.asset-action,.detail-action{width:100%;margin-top:11px;padding:9px 11px;border:1px solid #526b87;border-radius:9px;background:#1d2b3a;color:#eef5fc;font-weight:650;cursor:pointer}
.asset-action:hover,.detail-action:hover{background:#25384b}
.asset-action:disabled,.detail-action:disabled{cursor:wait;opacity:.6}
.prepare-state{margin-top:9px;color:#aeb9c6;font-size:11px;line-height:1.5}
.prepare-state.error-text{color:#ff9f9f}
.prepare-output{margin-top:10px;padding:10px;border:1px solid #2b3744;border-radius:9px;background:#0b1117;color:#b8c5d4;font:10px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.prepare-output[hidden]{display:none}
.jobs{display:grid;gap:9px}
.job{padding:13px 15px;border-radius:12px;border:1px solid #293440;background:#121920;display:grid;grid-template-columns:1fr auto;gap:12px}
.job.failed{border-color:#703939}
.job-title{font-size:13px;font-weight:650}
.job-meta{font-size:11px;color:#8996a6;margin-top:5px;overflow-wrap:anywhere}
.error-text{color:#ff9f9f;font-size:11px;margin-top:6px}
.empty-state{padding:30px;border:1px dashed #34404e;border-radius:14px;color:#7d8b9d;text-align:center}
.detail{position:fixed;right:0;top:0;width:min(500px,100%);height:100vh;background:#10171f;border-left:1px solid #303b48;box-shadow:-20px 0 50px rgba(0,0,0,.32);padding:22px;overflow:auto;z-index:10}
.detail[hidden]{display:none}
.detail-close{float:right;border:0;background:#212b36;color:#dbe2e9;border-radius:8px;padding:8px 10px;cursor:pointer}
.detail h2{margin-top:34px}
.detail-section{margin-top:20px;padding-top:16px;border-top:1px solid #293440}
  .detail-section h3{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#8593a4}
  .detail-previews{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .detail-preview-label{margin:0 0 6px;color:#8997a8;font-size:10px;text-transform:uppercase;letter-spacing:.08em}
  .issue-list,.history-list{display:grid;gap:8px}
  .issue{padding:10px;border:1px solid #673838;border-radius:9px;background:#2b1919;color:#ffc4c4;font-size:12px}
  .history{padding:9px;border:1px solid #2b3744;border-radius:9px;background:#151e27;font-size:11px;overflow-wrap:anywhere}
.ref{font:11px ui-monospace,SFMono-Regular,Consolas,monospace;color:#9ba9b9;margin:6px 0;overflow-wrap:anywhere}
.kv{display:grid;grid-template-columns:120px 1fr;gap:7px 12px;font-size:12px}
.kv dt{color:#7f8d9d}
.kv dd{margin:0;overflow-wrap:anywhere}
${PROJECT_SHELL_STYLES}
${PROJECT_IMAGE_PREVIEW_STYLES}
  @media(max-width:700px){main{padding:18px}.filters{grid-template-columns:1fr}.gallery{grid-template-columns:repeat(2,minmax(0,1fr))}.kv{grid-template-columns:1fr}.detail-previews{grid-template-columns:1fr}.state-filter{min-width:calc(50% - 4px)}}
</style></head>
<body><main>
  ${projectShellMarkup('Loading…')}
  <div id="status" class="status">Loading repository state…</div>
  <div id="inventory-summary" class="inventory-summary" hidden></div>
  <div id="plan-state" class="plan-state" hidden></div>
  <div id="filters" class="filters" hidden><select id="subject"><option value="">All subjects</option></select><select id="type"><option value="">All asset types</option></select><select id="lifecycle"><option value="">All states</option><option>candidate</option><option>approved</option><option>rejected</option><option>registered</option><option>superseded</option></select></div>
<div id="content"></div>
</main>
  <aside id="detail" class="detail" hidden><button id="close" class="detail-close">Close</button><div class="eyebrow">Project visual asset</div><h2 id="detail-title"></h2><div id="detail-status"></div><div id="detail-preview-section" class="detail-section" hidden><h3>Current images</h3><div id="detail-previews" class="detail-previews"></div></div><div class="detail-section"><h3>Asset metadata</h3><dl id="detail-meta" class="kv"></dl></div><div class="detail-section"><h3>Repository location</h3><div id="detail-path" class="ref"></div></div><div id="detail-required-section" class="detail-section" hidden><h3>Required Asset definition</h3><dl id="detail-required" class="kv"></dl></div><div id="detail-action-section" class="detail-section" hidden><h3>Generation action</h3><button id="prepare-generation" class="detail-action" type="button">Prepare Generation</button><div id="prepare-state" class="prepare-state"></div><pre id="prepare-output" class="prepare-output" hidden></pre></div><div class="detail-section"><h3>Generation</h3><dl id="detail-job" class="kv"></dl></div><div class="detail-section"><h3>Reference lineage</h3><div id="detail-refs"></div></div><div id="detail-issues-section" class="detail-section" hidden><h3>Problems</h3><div id="detail-issues" class="issue-list"></div></div><div id="detail-history-section" class="detail-section" hidden><h3>Lifecycle history</h3><div id="detail-history" class="history-list"></div></div></aside>
<script>
${PROJECT_SHELL_CLIENT_SCRIPT}
${PROJECT_IMAGE_PREVIEW_CLIENT_SCRIPT}
const match=location.pathname.match(/^\/projects\/([^/]+)\/(anchors|assets|generations)\/?$/),project=match?decodeURIComponent(match[1]):'',mode=match?match[2]:'';
const q=s=>document.querySelector(s),el=(t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;if(x!==undefined)n.textContent=x;return n};
const root='/projects/'+encodeURIComponent(project),assetUrl=p=>'/api/projects/'+encodeURIComponent(project)+'/asset?path='+encodeURIComponent(p),overviewUrl='/api/projects/'+encodeURIComponent(project)+'/overview',prepareUrl=id=>'/api/projects/'+encodeURIComponent(project)+'/required-assets/'+encodeURIComponent(id)+'/prepare';
  const unique=a=>[...new Set(a.filter(Boolean))].sort();let activeInventoryFilter='ALL';
  const label={anchors:'Approved Anchors',assets:'Visual Asset Inventory',generations:'Generation Jobs'}[mode]||'Project workflow';
setupProjectShell(project,mode);q('#title').textContent=label;
function option(select,value){const optionNode=document.createElement('option');optionNode.value=value;optionNode.textContent=value;select.append(optionNode)}
  function badge(status){return el('span','badge '+String(status||'').toLowerCase(),status)}
function addKv(rootNode,key,value){rootNode.append(el('dt','',key),el('dd','',value||'—'))}
function empty(message){return el('div','empty-state',message)}
function canPrepareGeneration(a){return a.kind==='required'&&a.required&&a.status==='MISSING'&&Boolean(a.asset_id)}
function renderAnchors(o){
  const grid=el('div','gallery');
  for(const a of o.approved_anchors){const name=a.display_name||a.subject_id;const card=el('a','card');card.href=root+'/anchors/'+encodeURIComponent(a.subject_id);const body=el('div','body');body.append(el('div','name',name),el('div','path',a.path));card.append(createImagePreview(assetUrl(a.path),a.path,name),body);grid.append(card)}
  q('#content').replaceChildren(grid.children.length?grid:empty('No approved anchors registered.'));
}
  function filteredAssets(o){const subject=q('#subject').value,type=q('#type').value,status=q('#lifecycle').value;return o.workflow.assets.filter(a=>(!subject||a.subject_id===subject)&&(!type||a.asset_type===type)&&(!status||a.status===status))}
  function inventoryStateMatches(a){if(activeInventoryFilter==='ALL')return true;if(activeInventoryFilter==='REQUIRED')return a.kind==='required'&&a.required;if(activeInventoryFilter==='UNMANAGED')return a.status==='UNMANAGED';return a.kind==='required'&&a.required&&a.status===activeInventoryFilter}
  function filteredInventory(o){const subject=q('#subject').value,type=q('#type').value,lifecycle=q('#lifecycle').value;return o.inventory.assets.filter(a=>inventoryStateMatches(a)&&(!subject||(a.subject_ids||[]).includes(subject))&&(!type||a.asset_type===type)&&(!lifecycle||a.current_lifecycle===lifecycle))}
  function renderInventorySummary(o){const summary=q('#inventory-summary'),s=o.inventory.summary,filters=[['ALL','All',o.inventory.assets.length],['REQUIRED','Required',s.total_required],['MISSING','Missing',s.missing],['REVIEW_REQUIRED','Review',s.review_required],['READY','Ready',s.ready],['BROKEN','Problems',s.broken],['UNMANAGED','Unmanaged',s.unmanaged]];summary.replaceChildren();for(const [value,labelText,count] of filters){const button=el('button','state-filter'+(activeInventoryFilter===value?' active':''));button.type='button';button.dataset.inventoryState=value;button.append(el('strong','',String(count)),el('span','',labelText));button.onclick=()=>{activeInventoryFilter=value;renderInventorySummary(o);renderAssets(o)};summary.append(button)}summary.hidden=false;q('#plan-state').hidden=false;q('#plan-state').textContent='Required Asset Plan: '+o.inventory.plan.metadata_path+' · scan roots: '+(o.inventory.plan.scan_roots.join(', ')||'none configured')}
  function inventoryKind(a){return a.kind==='required'?(a.required?'required':'optional'):a.kind}
  function renderInventoryAssets(o){const grid=el('div','gallery'),assets=filteredInventory(o);for(const a of assets){const card=el('article','card asset-card');if(a.preview_path)card.append(createImagePreview(assetUrl(a.preview_path),a.preview_path,a.title));else card.append(el('div','thumb empty',a.status==='MISSING'?'NO IMAGE':'Preview unavailable'));const body=el('div','body');body.append(badge(a.status),el('div','name',a.title||a.asset_id),el('div','meta',[a.asset_type,inventoryKind(a),(a.subject_ids||[]).join(', ')].filter(Boolean).join(' · ')),el('div','path',a.production_path||a.candidate_path||a.asset_id||'No repository path'));if(canPrepareGeneration(a)){const action=el('button','asset-action','Prepare Generation');action.type='button';action.onclick=event=>{event.stopPropagation();showInventoryDetail(o,a);void prepareRequiredAsset(o,a,q('#prepare-generation'))};body.append(action)}card.append(body);card.onclick=()=>showInventoryDetail(o,a);grid.append(card)}q('#content').replaceChildren(grid.children.length?grid:empty('No assets match the current filters.'))}
  function renderAssets(o){
    if(o.inventory?.plan?.available)return renderInventoryAssets(o);
    const out=q('#content');
  if(!o.workflow.available){out.replaceChildren(empty('No .visual-director/asset-index.json exists yet. No generation history is invented.'));return}
  const grid=el('div','gallery'),assets=filteredAssets(o);
  for(const a of assets){
    const card=el('article','card asset-card'),path=a.registered_path||a.candidate_path;
    if(path)card.append(createImagePreview(assetUrl(path),path,a.asset_id||a.asset_type));else card.append(el('div','thumb empty','No image path'));
    const body=el('div','body');body.append(badge(a.status),el('div','name',a.asset_type||a.asset_id),el('div','meta',[a.subject_id,a.generator].filter(Boolean).join(' · ')),el('div','path',path||a.asset_id||'No repository path'));card.append(body);card.onclick=()=>showDetail(o,a);grid.append(card);
  }
  out.replaceChildren(grid.children.length?grid:empty('No assets match the current filters.'));
}
function renderJobs(o){
  const out=q('#content');
  if(!o.workflow.available){out.replaceChildren(empty('No .visual-director/asset-index.json exists yet. No generation history is invented.'));return}
  if(!o.workflow.jobs.length){out.replaceChildren(empty('No Generation Jobs are registered yet.'));return}
  const jobs=el('div','jobs');
  for(const job of o.workflow.jobs){const row=el('div','job'+(job.status==='failed'?' failed':'')),left=el('div'),title=el('div','job-title',job.request_text||job.job_id),meta=el('div','job-meta',[job.job_id,job.asset_type,(job.subject_ids||[]).join(', '),job.generator,job.generation_package_fingerprint].filter(Boolean).join(' · '));left.append(title,meta);if(job.error)left.append(el('div','error-text',job.error));row.append(left,badge(job.status));jobs.append(row)}
  out.replaceChildren(jobs);
}
  function showDetail(o,a){
  const job=o.workflow.jobs.find(j=>j.job_id===a.source_job_id),path=a.registered_path||a.candidate_path,meta=q('#detail-meta'),generation=q('#detail-job');
  q('#detail-title').textContent=a.asset_type||a.asset_id;q('#detail-status').replaceChildren(badge(a.status));meta.replaceChildren();addKv(meta,'Asset ID',a.asset_id);addKv(meta,'Subject',a.subject_id);addKv(meta,'Asset type',a.asset_type);addKv(meta,'Source job',a.source_job_id);q('#detail-path').textContent=path||'No repository image path recorded.';generation.replaceChildren();addKv(generation,'Request',job?.request_text);addKv(generation,'Generator',a.generator||job?.generator);addKv(generation,'Fingerprint',a.generation_package_fingerprint||job?.generation_package_fingerprint);
    const refs=q('#detail-refs');refs.replaceChildren();const paths=a.reference_paths||[];if(!paths.length)refs.textContent='No reference paths recorded.';else for(const referencePath of paths)refs.append(el('div','ref',referencePath));q('#detail-action-section').hidden=true;q('#detail').hidden=false;
  }
  function showInventoryDetail(o,a){const meta=q('#detail-meta'),generation=q('#detail-job'),required=q('#detail-required'),refs=q('#detail-refs'),issues=q('#detail-issues'),history=q('#detail-history'),previews=q('#detail-previews');q('#detail-title').textContent=a.title||a.asset_id;q('#detail-status').replaceChildren(badge(a.status));meta.replaceChildren();addKv(meta,'Asset ID',a.asset_id);addKv(meta,'Kind',inventoryKind(a));addKv(meta,'Asset type',a.asset_type);addKv(meta,'Subjects',(a.subject_ids||[]).join(', '));addKv(meta,'Lifecycle',a.current_lifecycle);q('#detail-path').textContent=a.production_path||a.candidate_path||'No repository image path recorded.';const definition=a.required_definition;q('#detail-required-section').hidden=!definition;required.replaceChildren();if(definition){addKv(required,'Title',definition.title);addKv(required,'Usage',definition.usage);addKv(required,'Requirement',definition.required?'Required':'Optional');addKv(required,'Production path',definition.production_path);addKv(required,'Aspect ratio',definition.generation?.aspect_ratio);addKv(required,'Request',definition.generation?.request);addKv(required,'Requirements',(definition.generation?.requirements||[]).join(' · '))}generation.replaceChildren();if(!(a.source_jobs||[]).length)addKv(generation,'Source job','No source Generation Job recorded.');for(const job of a.source_jobs||[]){addKv(generation,'Source job',job.job_id);addKv(generation,'Request',job.request_text);addKv(generation,'Generator',job.generator);addKv(generation,'Fingerprint',job.generation_package_fingerprint);addKv(generation,'Job state',job.status)}refs.replaceChildren();const referencePaths=unique((a.workflow_assets||[]).flatMap(item=>item.reference_paths||[]));if(!referencePaths.length)refs.textContent='No reference paths recorded.';else for(const referencePath of referencePaths)refs.append(el('div','ref',referencePath));issues.replaceChildren();for(const issue of a.issues||[])issues.append(el('div','issue',[issue.code,issue.message,issue.path].filter(Boolean).join(' · ')));q('#detail-issues-section').hidden=!(a.issues||[]).length;history.replaceChildren();for(const item of a.workflow_assets||[])history.append(el('div','history',[item.status,item.asset_id,item.candidate_path||item.registered_path||item.archived_path].filter(Boolean).join(' · ')));q('#detail-history-section').hidden=!(a.workflow_assets||[]).length;previews.replaceChildren();for(const [previewLabel,previewPath] of [['Candidate',a.candidate_path],['Production',a.registered_path||((a.status==='READY'||a.status==='BROKEN')?a.production_path:'')]]){if(!previewPath)continue;const block=el('div');block.append(el('div','detail-preview-label',previewLabel),createImagePreview(assetUrl(previewPath),previewPath,a.title+' '+previewLabel));previews.append(block)}q('#detail-preview-section').hidden=!previews.children.length;renderGenerationAction(o,a);q('#detail').hidden=false}
function renderGenerationAction(o,a){const section=q('#detail-action-section'),button=q('#prepare-generation'),state=q('#prepare-state'),output=q('#prepare-output');section.hidden=!canPrepareGeneration(a);state.className='prepare-state';state.textContent='';output.hidden=true;output.textContent='';if(section.hidden)return;button.disabled=false;button.textContent='Prepare Generation';button.onclick=()=>void prepareRequiredAsset(o,a,button)}
async function prepareRequiredAsset(o,a,button){const state=q('#prepare-state'),output=q('#prepare-output');button.disabled=true;button.textContent='Preparing…';state.className='prepare-state';state.textContent='Resolving Required Asset definition, Canon, Grand Design, and Approved Anchors…';output.hidden=true;try{const response=await fetch(prepareUrl(a.asset_id),{method:'POST',cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error([data?.error?.code,data?.error?.message].filter(Boolean).join(': ')||'Generation preparation failed');state.textContent='Generation Package prepared. '+(data.execution?.reason||'Candidate generation remains a separate reviewed action.');output.textContent=JSON.stringify({required_asset_id:data.required_asset_id,production_path:data.production_path,generation_input:data.generation_input,reference_assets:data.generation_package?.reference_assets,policy:data.generation_package?.policy,scene_requirements:data.generation_package?.prompt_package?.scene_requirements},null,2);output.hidden=false}catch(error){state.className='prepare-state error-text';state.textContent=error instanceof Error?error.message:String(error)}finally{button.disabled=false;button.textContent='Prepare Generation'}}
q('#close').onclick=()=>q('#detail').hidden=true;
Promise.all([
  fetch('/api/projects',{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'Project catalog request failed');return d}),
  fetch(overviewUrl,{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d?.error?.message||'Overview failed');return d}),
]).then(([catalog,o])=>{
  const selected=catalog.projects?.find(p=>p.project_id===project);if(!selected)throw new Error('Unknown project_id: '+project);
  setProjectContext(selected);q('#status').textContent=selected.display_name+' · '+selected.repository+' @ '+selected.ref;
  if(mode==='anchors')return renderAnchors(o);
  if(mode==='assets'){q('#filters').hidden=false;const inventoryAvailable=Boolean(o.inventory?.plan?.available),subjects=inventoryAvailable?o.inventory.assets.flatMap(a=>a.subject_ids||[]):o.workflow.assets.map(a=>a.subject_id),types=inventoryAvailable?o.inventory.assets.map(a=>a.asset_type):o.workflow.assets.map(a=>a.asset_type);for(const value of unique(subjects))option(q('#subject'),value);for(const value of unique(types))option(q('#type'),value);for(const id of ['#subject','#type','#lifecycle'])q(id).onchange=()=>renderAssets(o);if(inventoryAvailable)renderInventorySummary(o);else{q('#plan-state').hidden=false;q('#plan-state').textContent='No .visual-director/asset-plan.json exists yet. Showing repository workflow history only.'}return renderAssets(o)}
  renderJobs(o);
}).catch(e=>{q('#status').className='status error';q('#status').textContent=e.message;q('#content').replaceChildren(empty(e.message))});
</script></body></html>`;
