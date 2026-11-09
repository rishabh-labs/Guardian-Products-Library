/* Products Library — static front end on Supabase (database, file storage, sign-in). */
const CATS=["PMS","AIF Cat I","AIF Cat II","AIF Cat III","Mutual Fund","SIF","Bonds / Fixed income","Structured product","Unlisted equity","Other"];
const DEC={accepted:"Accepted",rejected:"Rejected",review:"In review"};
const MAX=50*1024*1024; // Supabase free-tier per-file limit
const BLOCK=new Set(["exe","msi","bat","cmd","com","scr","ps1","vbs","js","jar","sh","dll","lnk","reg","html","htm","svg"]);
const INLINE=new Set(["pdf","png","jpg","jpeg","gif","webp","txt","mp4","webm"]);   // open in a browser tab
const PREVIEW={xlsx:"sheet",xlsm:"sheet",xls:"sheet",xlsb:"sheet",ods:"sheet",csv:"sheet",docx:"doc"};
const BUCKET="documents";

const cfg=window.PL_CONFIG||{};
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtDate=d=>{if(!d)return"—";const t=new Date(String(d).length===10?d+"T00:00:00":d);return isNaN(t)?"—":t.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})};
const fmtSize=b=>b>1048576?(b/1048576).toFixed(1)+" MB":Math.max(1,Math.round((b||0)/1024))+" KB";
const extOf=n=>(String(n).includes(".")?String(n).split(".").pop():"").toLowerCase();
const extClass=e=>e==="pdf"?"pdf":/^xl|^ods|^csv/.test(e)?"xl":/^doc|^odt|^rtf/.test(e)?"wd":/^ppt|^odp/.test(e)?"pp":"";
const safeUrl=u=>/^https?:\/\//i.test(u)?u:null;
const safeKey=n=>n.normalize("NFKD").replace(/[^\w.\-]+/g,"_").replace(/_+/g,"_").slice(-120)||"file";
const hue=s=>{let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))>>>0;return h%360};
const initials=n=>String(n||"?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
const av=(id,name)=>`<span class="av" style="background:hsl(${hue(id||name)} 38% 42%)" aria-hidden="true">${esc(initials(name))}</span>`;

let sb=null,me=null,myName="",isAdmin=false;
let products=[],loaded=false,filter="all",openId=null,notes=[],mode=null,renderTok=0,channel=null;

/* ---------- boot & auth ---------- */
document.title="Guardian Product Library";
$("#auth-team").textContent="Sign in with your work email to continue";
$("#cat-f").insertAdjacentHTML("beforeend",CATS.map(c=>`<option>${esc(c)}</option>`).join(""));

function show(view){$("#auth").hidden=view!=="auth";$("#app").hidden=view!=="app"}
function authPanel(which){["login-form","name-form","setup-msg"].forEach(id=>$("#"+id).hidden=id!==which)}

(async function boot(){
  if(!/^https:\/\//.test(cfg.SUPABASE_URL||"")||!window.supabase){show("auth");authPanel("setup-msg");return}
  sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange((ev,session)=>{if(ev==="SIGNED_OUT")onSignedOut()});
  const {data:{session}}=await sb.auth.getSession();
  if(session)onSignedIn(session);else onSignedOut();
})();

$("#login-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const email=$("#l-email").value.trim(),password=$("#l-pass").value,btn=$("#l-btn"),err=$("#l-err");
  err.textContent="";
  if(!email||!password){err.textContent="Enter your email and password.";return}
  btn.disabled=true;btn.textContent="Signing in…";
  const {data,error}=await sb.auth.signInWithPassword({email,password});
  btn.disabled=false;btn.textContent="Sign in";
  if(error){err.textContent=/invalid/i.test(error.message)?"That email and password don't match. Check them, or ask the admin to reset your password.":error.message;return}
  onSignedIn(data.session);
});

$("#name-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const name=$("#n-name").value.trim(),pass=$("#n-pass").value,err=$("#n-err");
  err.textContent="";
  if(!name){err.textContent="Enter your name.";return}
  if(pass&&pass.length<8){err.textContent="Use at least 8 characters for the password, or leave it blank.";return}
  const upd={data:{full_name:name}};if(pass)upd.password=pass;
  const {data,error}=await sb.auth.updateUser(upd);
  if(error){err.textContent=error.message;return}
  myName=name;enterApp();
});

async function onSignedIn(session){
  me=session.user.id;
  myName=(session.user.user_metadata&&session.user.user_metadata.full_name)||"";
  if(!myName){show("auth");authPanel("name-form");$("#n-name").focus();return}
  enterApp();
}
function onSignedOut(){
  me=null;products=[];loaded=false;closeDrawer();
  if(channel){sb.removeChannel(channel);channel=null}
  show("auth");authPanel("login-form");
}
async function enterApp(){
  show("app");
  $("#u-name").textContent=myName;
  $("#u-av").textContent=initials(myName);
  const [t,a]=await Promise.all([sb.rpc("is_team"),sb.rpc("is_admin")]);
  isAdmin=!!a.data;
  if(t.data===false){status("Your account isn't on the team list, so the library is hidden. Ask the admin to add your email.");}
  await loadProducts();
  if(!channel){
    let tm=null;const later=()=>{clearTimeout(tm);tm=setTimeout(loadProducts,400)};
    channel=sb.channel("library")
      .on("postgres_changes",{event:"*",schema:"public",table:"products"},later)
      .on("postgres_changes",{event:"*",schema:"public",table:"documents"},later)
      .on("postgres_changes",{event:"*",schema:"public",table:"notes"},()=>{if(openId&&mode==="detail")loadNotes(openId)})
      .subscribe();
  }
  const h=location.hash.slice(1);if(h&&products.find(p=>p.id===h))openDetail(h);
}
$("#u-out").onclick=()=>sb.auth.signOut();
$("#u-pass").onclick=()=>openPasswordForm();
window.addEventListener("focus",()=>{if(me&&loaded)loadProducts()});

function status(msg){const s=$("#status");s.hidden=!msg;s.textContent=msg||""}

/* ---------- data ---------- */
function norm(r){
  return {id:r.id,name:r.name,manager:r.manager,category:r.category,strategy:r.strategy,decision:r.decision,decidedOn:r.decided_on,
    rationale:r.rationale,tags:r.tags||[],links:Array.isArray(r.links)?r.links:[],createdBy:r.created_by,createdByName:r.created_by_name,
    createdAt:r.created_at,updatedBy:r.updated_by,updatedByName:r.updated_by_name,updatedAt:r.updated_at,
    docs:(r.documents||[]).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))};
}
async function loadProducts(){
  const {data,error}=await sb.from("products").select("*, documents(*)").order("created_at",{ascending:false});
  if(error){status("The library couldn't load: "+error.message);loaded=true;renderList();return}
  products=data.map(norm);loaded=true;
  if(!$("#status").textContent.startsWith("Your account"))status("");
  renderList();
  if(mode==="detail"&&openId)paintDetail();
}
async function loadNotes(pid){
  const {data}=await sb.from("notes").select("*").eq("product_id",pid).order("created_at",{ascending:true});
  if(openId===pid){notes=data||[];paintNotes()}
}
const who=(id,name)=>id===me?"You":(name||"A teammate");

/* ---------- list ---------- */
function visible(){
  const q=$("#q").value.trim().toLowerCase(),c=$("#cat-f").value,s=$("#sort").value;
  let list=products.filter(p=>(filter==="all"||p.decision===filter)&&(!c||p.category===c));
  if(q)list=list.filter(p=>[p.name,p.manager,p.strategy,p.rationale,p.tags.join(" "),p.category,p.docs.map(d=>d.name).join(" ")].join(" ").toLowerCase().includes(q));
  const by={date:(a,b)=>String(b.decidedOn||"").localeCompare(String(a.decidedOn||""))||String(b.createdAt).localeCompare(String(a.createdAt)),
    name:(a,b)=>String(a.name).localeCompare(String(b.name)),
    updated:(a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||""))};
  return list.sort(by[s]);
}
function renderList(){
  const cnt={all:products.length,accepted:0,rejected:0,review:0};
  products.forEach(p=>{if(cnt[p.decision]!=null)cnt[p.decision]++});
  for(const k in cnt)$("#c-"+k).textContent=loaded?cnt[k]:"";
  $("#n-all").textContent=loaded?cnt.all:"–";
  $("#n-acc").textContent=loaded?cnt.accepted:"–";$("#n-rej").textContent=loaded?cnt.rejected:"–";$("#n-rev").textContent=loaded?cnt.review:"–";
  const pct=n=>cnt.all?Math.round(n/cnt.all*100)+"%":"0%";
  $("#b-acc").style.width=pct(cnt.accepted);$("#b-rej").style.width=pct(cnt.rejected);$("#b-rev").style.width=pct(cnt.review);
  if(!loaded)return;
  const rows=$("#rows");
  if(!products.length){
    rows.innerHTML=`<div class="empty"><img class="mark" src="assets/guardian-mark.png" alt=""><h2>The library is empty</h2><p>Each product the team reviews goes here: its name, the fund house, the documents you studied and the reason it was accepted or rejected.</p><button class="btn primary" id="first-add">+ Add the first product</button></div>`;
    $("#first-add").onclick=()=>openForm(null);return;
  }
  const list=visible();
  if(!list.length){rows.innerHTML=`<div class="empty"><p>No products match these filters.</p></div>`;return}
  rows.innerHTML=list.map(p=>{
    const d=DEC[p.decision]?p.decision:"review";
    const nd=p.docs.length+p.links.length;
    return `<button class="row" data-id="${esc(p.id)}">
      <span class="c-stamp"><span class="stamp ${d}">${DEC[d]}</span></span>
      <span class="c-main"><div class="nm">${esc(p.name)}</div><div class="mg">${esc(p.manager)}${p.strategy?" · "+esc(p.strategy):""}</div>${p.rationale?`<div class="why">${esc(p.rationale)}</div>`:""}</span>
      <span class="c-cat cat">${esc(p.category||"—")}</span>
      <span class="c-date mono">${fmtDate(p.decidedOn)}</span>
      <span class="c-docs docs-n">${nd?nd+" file"+(nd>1?"s":""):"—"}</span>
      <span class="c-who who">${av(p.createdBy,p.createdByName)}<span>${esc(who(p.createdBy,p.createdByName))}</span></span>
      <span class="c-meta"><span>${esc(p.category||"")}</span><span class="mono">${fmtDate(p.decidedOn)}</span><span>${nd} file${nd===1?"":"s"}</span><span>${esc(who(p.createdBy,p.createdByName))}</span></span>
    </button>`}).join("");
}
$("#rows").addEventListener("click",e=>{const r=e.target.closest(".row");if(r)openDetail(r.dataset.id)});
$("#tabs").addEventListener("click",e=>{const t=e.target.closest(".tab");if(!t)return;filter=t.dataset.f;document.querySelectorAll(".tab").forEach(b=>b.setAttribute("aria-pressed",b===t));renderList()});
["#q","#cat-f","#sort"].forEach(s=>$(s).addEventListener("input",renderList));
$("#add-btn").onclick=()=>openForm(null);

/* ---------- drawer ---------- */
function showDrawer(html){const d=$("#drawer");d.innerHTML=html;d.hidden=false;$("#scrim").hidden=false;const b=d.querySelector(".db");if(b)b.scrollTop=0}
function closeDrawer(){
  $("#drawer").hidden=true;$("#scrim").hidden=true;$("#drawer").innerHTML="";
  openId=null;mode=null;notes=[];
  try{if(location.hash)history.replaceState(null,"",location.pathname+location.search)}catch{}
}
$("#scrim").onclick=()=>{if(mode==="detail"||mode==="password")closeDrawer()};
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&(mode==="detail"||mode==="password"))closeDrawer()});
window.addEventListener("hashchange",()=>{const h=location.hash.slice(1);if(h&&h!==openId&&products.find(p=>p.id===h))openDetail(h)});

function openDetail(id){
  if(!products.find(x=>x.id===id))return;
  const fresh=openId!==id;
  openId=id;mode="detail";
  try{if(location.hash!=="#"+id)history.replaceState(null,"","#"+id)}catch{}
  if(fresh){notes=[];loadNotes(id)}
  paintDetail();
}
function paintDetail(){
  const p=products.find(x=>x.id===openId);if(!p){closeDrawer();return}
  const d=DEC[p.decision]?p.decision:"review";
  const mayDelete=isAdmin||p.createdBy===me;
  const files=p.docs.map((f,i)=>{const e=extOf(f.name);
    return `<div class="file"><span class="ext ${extClass(e)}">${esc(e.slice(0,4)||"file")}</span><div class="fmeta"><span class="fn" title="${esc(f.name)}">${esc(f.name)}</span><small>${fmtSize(f.size)} · ${esc(who(f.uploaded_by,f.uploaded_by_name))} · ${fmtDate(f.created_at)}</small></div>
      <div class="fbtns">${PREVIEW[e]?`<button class="btn quiet" data-pv="${i}">Preview</button>`:""}${INLINE.has(e)?`<button class="btn quiet" data-op="${i}">Open</button>`:""}<button class="btn" data-dl="${i}">Download</button></div></div>`}).join("");
  const links=p.links.map(l=>{const u=safeUrl(l.url);if(!u)return"";let host="";try{host=new URL(u).hostname}catch{}
    return `<div class="file"><span class="ext">link</span><div class="fmeta"><a class="fn" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(l.label||u)}</a><small>${esc(host)}</small></div></div>`}).join("");
  showDrawer(`
    <div class="dh"><span class="lbl" id="d-label">Product dossier</span><button class="x" id="d-x" aria-label="Close">×</button></div>
    <div class="db">
      <div class="dossier-top"><span class="stamp big ${d}">${DEC[d]}</span><h2>${esc(p.name)}</h2><div class="mg">${esc(p.manager)}</div></div>
      <dl class="facts">
        <div><dt>Category</dt><dd>${esc(p.category||"—")}</dd></div>
        <div><dt>Strategy</dt><dd>${esc(p.strategy||"—")}</dd></div>
        <div><dt>Decision date</dt><dd class="mono">${fmtDate(p.decidedOn)}</dd></div>
        <div><dt>Added by</dt><dd>${esc(who(p.createdBy,p.createdByName))}</dd></div>
        ${p.updatedBy&&p.updatedAt&&p.updatedAt!==p.createdAt?`<div><dt>Last edited</dt><dd>${esc(who(p.updatedBy,p.updatedByName))}, <span class="mono">${fmtDate(p.updatedAt)}</span></dd></div>`:""}
      </dl>
      <div class="sec"><h3>Why we ${d==="accepted"?"accepted it":d==="rejected"?"rejected it":"are still reviewing"}</h3><div class="rationale">${esc(p.rationale||"No reasoning recorded yet.")}</div></div>
      ${p.tags.length?`<div class="sec"><h3>Tags</h3><div class="tags">${p.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div></div>`:""}
      <div class="sec"><h3>Documents <span>${p.docs.length+p.links.length}</span></h3>${files||links?`<div class="files" id="d-files">${files}${links}</div>`:`<p class="muted small">No documents attached.</p>`}<span class="err" id="dl-err"></span><div class="pv" id="pv" hidden></div></div>
      <div class="sec"><h3>Team notes</h3><div class="notes" id="notes"></div>
        <div class="compose"><textarea id="note-in" class="field" style="min-height:70px" placeholder="Add a note for the team: a follow-up call, a change in the manager, a reason to revisit…"></textarea><div><button class="btn" id="note-add">Post note</button> <span class="err" id="note-err"></span></div></div>
      </div>
    </div>
    <div class="df" id="d-actions">${mayDelete?`<button class="btn danger" id="d-del">Delete</button>`:""}<button class="btn primary" id="d-edit">Edit product</button></div>`);
  $("#d-x").onclick=closeDrawer;
  $("#d-edit").onclick=()=>openForm(p.id);
  if($("#d-del"))$("#d-del").onclick=()=>askDelete(p);
  $("#note-add").onclick=postNote;
  if($("#d-files"))$("#d-files").onclick=e=>{
    const b=e.target.closest("[data-dl],[data-pv],[data-op]");if(!b)return;
    const f=p.docs[+(b.dataset.dl??b.dataset.pv??b.dataset.op)];if(!f)return;
    if(b.dataset.dl!=null)downloadDoc(f,b);else if(b.dataset.op!=null)openDoc(f);else previewDoc(f);
  };
  paintNotes();
}
function paintNotes(){
  const box=$("#notes");if(!box)return;
  box.innerHTML=notes.length?notes.map(n=>`<div class="note">${av(n.author,n.author_name)}<div class="bd"><div class="hd"><b>${esc(who(n.author,n.author_name))}</b><span class="mono">${fmtDate(n.created_at)}</span>${n.author===me||isAdmin?`<button class="linkbtn" data-del="${esc(n.id)}">Remove</button>`:""}</div><div class="tx">${esc(n.body)}</div></div></div>`).join(""):`<p class="muted small">No notes yet.</p>`;
  box.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{await sb.from("notes").delete().eq("id",b.dataset.del);loadNotes(openId)});
}
async function postNote(){
  const t=$("#note-in"),txt=t.value.trim(),btn=$("#note-add");if(!txt)return;
  btn.disabled=true;$("#note-err").textContent="";
  const {error}=await sb.from("notes").insert({product_id:openId,body:txt.slice(0,5000),author_name:myName});
  btn.disabled=false;
  if(error){$("#note-err").textContent="Couldn't post the note: "+error.message;return}
  t.value="";loadNotes(openId);
}
function askDelete(p){
  const a=$("#d-actions");
  a.innerHTML=`<div class="confirm"><span id="dc-msg">Delete “${esc(p.name)}”, its ${p.docs.length} document${p.docs.length===1?"":"s"} and notes for everyone?</span><span style="flex:1"></span><button class="btn" id="dc-no">Keep it</button><button class="btn danger" id="dc-yes">Delete</button></div>`;
  $("#dc-no").onclick=paintDetail;
  $("#dc-yes").onclick=async()=>{
    $("#dc-yes").disabled=true;
    if(p.docs.length){const {error}=await sb.storage.from(BUCKET).remove(p.docs.map(d=>d.path));if(error){$("#dc-msg").textContent="Couldn't remove the files: "+error.message;$("#dc-yes").disabled=false;return}}
    const {error}=await sb.from("products").delete().eq("id",p.id);
    if(error){$("#dc-msg").textContent="Couldn't delete: "+error.message;$("#dc-yes").disabled=false;return}
    closeDrawer();loadProducts();
  };
}

/* ---------- files ---------- */
async function signed(f,download){
  const {data,error}=await sb.storage.from(BUCKET).createSignedUrl(f.path,300,download?{download:f.name}:undefined);
  if(error)throw error;return data.signedUrl;
}
async function downloadDoc(f,btn){
  const err=$("#dl-err");err.textContent="";btn.disabled=true;
  try{const url=await signed(f,true);const a=document.createElement("a");a.href=url;a.rel="noopener";document.body.append(a);a.click();a.remove()}
  catch(e){err.textContent="Couldn't download "+f.name+": "+(e.message||"try again")}
  btn.disabled=false;
}
async function openDoc(f){
  const w=window.open("","_blank");
  try{const url=await signed(f,false);if(w)w.location=url;else location.href=url}
  catch(e){if(w)w.close();$("#dl-err").textContent="Couldn't open "+f.name+": "+(e.message||"try again")}
}
const libs={};
function loadLib(src,g){return libs[src]||(libs[src]=new Promise((res,rej)=>{if(window[g])return res(window[g]);const s=document.createElement("script");s.src=src;s.onload=()=>res(window[g]);s.onerror=()=>{delete libs[src];rej(new Error("lib"))};document.head.appendChild(s)}))}
async function previewDoc(f){
  const pv=$("#pv"),kind=PREVIEW[extOf(f.name)];
  pv.hidden=false;pv.innerHTML="";
  const head=document.createElement("div");head.className="pv-h";
  const t=document.createElement("b");t.textContent=f.name;head.append(t);
  const x=document.createElement("button");x.className="btn quiet";x.textContent="Close preview";x.onclick=()=>{pv.hidden=true;pv.innerHTML=""};head.append(x);
  const body=document.createElement("div");body.className="pv-b";body.innerHTML="<p>Loading preview…</p>";
  pv.append(head,body);pv.scrollIntoView({block:"nearest",behavior:"smooth"});
  try{
    const {data:blob,error}=await sb.storage.from(BUCKET).download(f.path);if(error)throw error;
    const buf=await blob.arrayBuffer();
    if(kind==="sheet"){
      const X=await loadLib("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js","XLSX");
      const wb=X.read(new Uint8Array(buf),{type:"array"});
      const sel=document.createElement("select");sel.className="field";sel.setAttribute("aria-label","Sheet");
      wb.SheetNames.forEach(n=>{const o=document.createElement("option");o.textContent=n;sel.append(o)});
      if(wb.SheetNames.length>1)head.insertBefore(sel,x);
      const draw=()=>{
        const rows=X.utils.sheet_to_json(wb.Sheets[sel.value||wb.SheetNames[0]],{header:1,raw:false,blankrows:false,defval:""});
        body.innerHTML="";
        if(!rows.length){body.innerHTML="<p>This sheet is empty.</p>";return}
        const shown=rows.slice(0,300),cols=Math.min(40,Math.max(...shown.map(r=>r.length)));
        const tb=document.createElement("table");
        shown.forEach((r,i)=>{const tr=document.createElement("tr");for(let j=0;j<cols;j++){const td=document.createElement(i===0?"th":"td");td.textContent=r[j]??"";td.title=String(r[j]??"");tr.append(td)}tb.append(tr)});
        body.append(tb);
        if(rows.length>300){const m=document.createElement("p");m.className="muted small";m.textContent=`Showing the first 300 of ${rows.length} rows. Download the file for the rest.`;body.append(m)}
      };
      sel.onchange=draw;draw();
    }else{
      const M=await loadLib("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js","mammoth");
      const r=await M.extractRawText({arrayBuffer:buf});
      body.innerHTML="";const d=document.createElement("div");d.className="pv-doc";d.textContent=r.value.trim()||"No text found in this document.";body.append(d);
    }
  }catch{body.innerHTML="<p>Couldn't preview this file. Use Download to open it in Excel or Word.</p>"}
}

/* ---------- form ---------- */
let pending=[],keptDocs=[];
function openForm(id){
  const p=id?products.find(x=>x.id===id):null;
  mode="form";openId=id;pending=[];keptDocs=p?[...p.docs]:[];
  const today=new Date().toISOString().slice(0,10);
  const v=p||{decision:"review",decidedOn:today,category:"PMS",tags:[],links:[]};
  showDrawer(`
    <div class="dh"><span class="lbl" id="d-label">${p?"Edit product":"Add a product"}</span><button class="x" id="f-x" aria-label="Close">×</button></div>
    <form id="pf" novalidate>
    <div class="db">
      <div class="fg"><label for="f-name">Product name</label><input id="f-name" class="field" required maxlength="200" value="${esc(v.name)}" placeholder="e.g. Alpha Long-Short Fund"></div>
      <div class="fg"><label for="f-mgr">Fund house / manager</label><input id="f-mgr" class="field" required maxlength="200" value="${esc(v.manager)}" placeholder="e.g. Example Capital, fund manager's name"></div>
      <div class="two">
        <div class="fg"><label for="f-cat">Category</label><select id="f-cat" class="field" style="width:100%">${CATS.map(c=>`<option ${c===v.category?"selected":""}>${esc(c)}</option>`).join("")}</select></div>
        <div class="fg"><label for="f-str">Strategy / style <span class="hint">optional</span></label><input id="f-str" class="field" maxlength="200" value="${esc(v.strategy)}" placeholder="e.g. Multi-cap growth"></div>
      </div>
      <div class="fg"><span class="lab">Decision</span><div class="seg" id="f-dec">${Object.entries(DEC).map(([k,l])=>`<label class="${v.decision===k?"on-"+k:""}"><input type="radio" name="dec" value="${k}" ${v.decision===k?"checked":""}> ${l}</label>`).join("")}</div></div>
      <div class="fg" style="max-width:220px"><label for="f-date">Decision date</label><input id="f-date" type="date" class="field" value="${esc(v.decidedOn||"")}"></div>
      <div class="fg"><label for="f-why">Why we accepted or rejected it</label><textarea id="f-why" class="field" required maxlength="20000" style="min-height:160px" placeholder="The reasoning the team should remember: performance vs benchmark, drawdowns, manager track record, portfolio concentration, fees, red flags from the call…">${esc(v.rationale)}</textarea></div>
      <div class="fg"><label for="f-tags">Tags <span class="hint">comma separated</span></label><input id="f-tags" class="field" value="${esc(v.tags.join(", "))}" placeholder="e.g. small-cap, high fees, revisit 2027"></div>
      <div class="fg"><span class="lab">Documents</span>
        <div class="files" id="f-files"></div>
        <div class="drop" id="drop" tabindex="0" role="button"><b>Drop files here</b> or click to choose<br><span class="hint">Excel, Word, PowerPoint, PDF, emails, images · up to 50 MB each</span></div>
        <input type="file" id="f-file" multiple hidden>
        <span class="err" id="f-ferr"></span>
      </div>
      <div class="fg"><label for="f-links">Links <span class="hint">one per line, optionally “Label | https://…”</span></label><textarea id="f-links" class="field" style="min-height:70px" placeholder="Factsheet Oct 2026 | https://…">${esc(v.links.map(l=>l.label&&l.label!==l.url?l.label+" | "+l.url:l.url).join("\n"))}</textarea></div>
    </div>
    <div class="df"><span class="err" id="f-err" style="flex:1;align-self:center"></span><button type="button" class="btn" id="f-cancel">Cancel</button><button type="submit" class="btn primary" id="f-save">${p?"Save changes":"Add to library"}</button></div>
    </form>`);
  const back=()=>{if(id)openDetail(id);else closeDrawer()};
  $("#f-x").onclick=back;$("#f-cancel").onclick=back;
  $("#f-dec").addEventListener("change",()=>document.querySelectorAll("#f-dec label").forEach(l=>{const i=l.querySelector("input");l.className=i.checked?"on-"+i.value:""}));
  const drop=$("#drop"),fi=$("#f-file");
  drop.onclick=()=>fi.click();drop.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();fi.click()}};
  fi.onchange=()=>{addFiles(fi.files);fi.value=""};
  drop.ondragover=e=>{e.preventDefault();drop.classList.add("over")};
  drop.ondragleave=()=>drop.classList.remove("over");
  drop.ondrop=e=>{e.preventDefault();drop.classList.remove("over");addFiles(e.dataTransfer.files)};
  $("#pf").onsubmit=e=>{e.preventDefault();save(p)};
  paintFiles();$("#f-name").focus();
}
function addFiles(list){
  const bad=[];
  for(const f of list){
    const e=extOf(f.name);
    if(!f.size){bad.push(f.name+" (empty file)");continue}
    if(BLOCK.has(e)){bad.push(f.name+" (program files aren't allowed)");continue}
    if(f.size>MAX){bad.push(f.name+" (over 50 MB)");continue}
    pending.push(f);
  }
  $("#f-ferr").textContent=bad.length?"Skipped: "+bad.join(", ")+". Very large files can go in as a OneDrive link below.":"";
  paintFiles();
}
function paintFiles(){
  const box=$("#f-files");
  const row=(name,size,note,attr)=>`<div class="file"><span class="ext ${extClass(extOf(name))}">${esc(extOf(name).slice(0,4)||"file")}</span><div class="fmeta"><span class="fn">${esc(name)}</span><small>${fmtSize(size)} · ${note}</small></div><button type="button" class="btn quiet" ${attr}>Remove</button></div>`;
  const rows=[...keptDocs.map((d,i)=>row(d.name,d.size,"attached",`data-k="${i}"`)),...pending.map((f,i)=>row(f.name,f.size,"uploads when you save",`data-p="${i}"`))];
  box.hidden=!rows.length;box.innerHTML=rows.join("");
  box.querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>{keptDocs.splice(+b.dataset.k,1);paintFiles()});
  box.querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{pending.splice(+b.dataset.p,1);paintFiles()});
}
async function save(p){
  const err=$("#f-err"),btn=$("#f-save");err.textContent="";
  const name=$("#f-name").value.trim(),manager=$("#f-mgr").value.trim(),rationale=$("#f-why").value.trim();
  if(!name||!manager||!rationale){err.textContent="Add the product name, fund house and the reasoning before saving.";return}
  const links=$("#f-links").value.split("\n").map(s=>s.trim()).filter(Boolean).map(s=>{const i=s.lastIndexOf("|");const url=(i>=0?s.slice(i+1):s).trim(),label=(i>=0?s.slice(0,i):"").trim();return safeUrl(url)?{label:label||url,url}:null}).filter(Boolean);
  const row={name,manager,category:$("#f-cat").value,strategy:$("#f-str").value.trim(),
    decision:(document.querySelector('input[name="dec"]:checked')||{}).value||"review",
    decided_on:$("#f-date").value||null,rationale,
    tags:$("#f-tags").value.split(",").map(s=>s.trim()).filter(Boolean).slice(0,20),links,updated_by_name:myName};
  btn.disabled=true;btn.textContent="Saving…";
  const fail=m=>{err.textContent=m;btn.disabled=false;btn.textContent=p?"Save changes":"Add to library"};
  let id=p&&p.id;
  if(p){const {error}=await sb.from("products").update(row).eq("id",id);if(error)return fail("Couldn't save: "+error.message)}
  else{const {data,error}=await sb.from("products").insert({...row,created_by_name:myName}).select("id").single();if(error)return fail("Couldn't save: "+error.message);id=data.id}
  // removed attachments
  if(p){
    const gone=p.docs.filter(d=>!keptDocs.find(k=>k.id===d.id));
    if(gone.length){await sb.storage.from(BUCKET).remove(gone.map(d=>d.path));await sb.from("documents").delete().in("id",gone.map(d=>d.id))}
  }
  // new uploads
  const failed=[];
  for(let i=0;i<pending.length;i++){
    const f=pending[i];btn.textContent=`Uploading ${i+1} of ${pending.length}…`;
    const path=`${id}/${crypto.randomUUID()}-${safeKey(f.name)}`;
    const up=await sb.storage.from(BUCKET).upload(path,f,{contentType:f.type||"application/octet-stream",upsert:false});
    if(up.error){failed.push(f.name);continue}
    const {error}=await sb.from("documents").insert({product_id:id,name:f.name,size:f.size,mime:f.type||"",path,uploaded_by_name:myName});
    if(error){failed.push(f.name);await sb.storage.from(BUCKET).remove([path])}
  }
  pending=[];
  await loadProducts();
  openDetail(id);
  if(failed.length)$("#dl-err").textContent="These files didn't upload: "+failed.join(", ")+". Edit the product to try again.";
}

/* ---------- password ---------- */
function openPasswordForm(){
  mode="password";openId=null;
  showDrawer(`
    <div class="dh"><span class="lbl" id="d-label">Change password</span><button class="x" id="p-x" aria-label="Close">×</button></div>
    <div class="db"><div class="fg"><label for="p-new">New password <span class="hint">at least 8 characters</span></label><input id="p-new" type="password" class="field" autocomplete="new-password"></div>
    <div class="fg"><label for="p-new2">Type it again</label><input id="p-new2" type="password" class="field" autocomplete="new-password"></div><span id="p-msg"></span></div>
    <div class="df"><button class="btn" id="p-cancel">Cancel</button><button class="btn primary" id="p-save">Save password</button></div>`);
  $("#p-x").onclick=closeDrawer;$("#p-cancel").onclick=closeDrawer;
  $("#p-save").onclick=async()=>{
    const a=$("#p-new").value,b=$("#p-new2").value,m=$("#p-msg");
    m.className="err";
    if(a.length<8){m.textContent="Use at least 8 characters.";return}
    if(a!==b){m.textContent="The two passwords don't match.";return}
    const {error}=await sb.auth.updateUser({password:a});
    if(error){m.textContent=error.message;return}
    m.className="ok-msg";m.textContent="Password changed.";setTimeout(closeDrawer,1200);
  };
  $("#p-new").focus();
}
