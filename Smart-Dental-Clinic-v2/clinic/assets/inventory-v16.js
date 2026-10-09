/* Inventory v1.6 frontend demo: browser-only state, audit movements, no backend. */
document.addEventListener("DOMContentLoaded", () => {
  const STORAGE = "sdc_inventory_v16_demo";
  const demo = {
    items: [
      { id:"itm-gloves", name:"كفوف طبية", category:"مستهلكات طبية", unit:"حبة", qty:5, min:2, expiry:"" },
      { id:"itm-masks", name:"كمامات طبية", category:"مستهلكات طبية", unit:"حبة", qty:22, min:10, expiry:"" },
      { id:"itm-composite", name:"مادة حشوات مركبة", category:"مواد علاجية", unit:"عبوة", qty:3, min:2, expiry:"2027-02-15" },
      { id:"itm-disinfect", name:"محلول تعقيم", category:"تعقيم", unit:"عبوة", qty:1, min:3, expiry:"2027-07-01" }
    ], moves: []
  };
  const clone=x=>JSON.parse(JSON.stringify(x));
  let state=clone(demo), activeId=null;
  const HISTORY_PAGE_SIZE=10;
  let historyPage=1;
  const $=id=>document.getElementById(id);
  const num=v=>Number.isSafeInteger(Number(v)) && Number(v)>=0 && Number(v)<=1000000 ? Number(v) : null;
  try {
    const raw=localStorage.getItem(STORAGE);
    if(raw){
      const loaded=JSON.parse(raw);
      if(Array.isArray(loaded.items)&&Array.isArray(loaded.moves)) {
        const valid=loaded.items.every(it=>typeof it.id==="string"&&typeof it.name==="string"&&num(it.qty)!==null&&num(it.min)!==null);
        if(valid)state={items:loaded.items.slice(0,500),moves:loaded.moves.slice(0,2000)};
      }
    }
  }catch(e){/* Storage blocked, demo remains usable in memory */}
  function persist(){try{localStorage.setItem(STORAGE,JSON.stringify(state));}catch(e){}}
  function toast(message){
    const el=$("appToast");
    if(el && window.bootstrap?.Toast){el.querySelector(".toast-body").textContent=message;window.bootstrap.Toast.getOrCreateInstance(el).show();}
    else {const msg=$("inventoryStatus");if(msg)msg.textContent=message;}
  }
  const escape=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const today=()=>new Date(new Date().toDateString());
  const daysUntil=x=>{if(!x)return null;const d=new Date(x+"T12:00:00");return Number.isNaN(d.getTime())?null:Math.ceil((d.getTime()-today().getTime())/86400000)};
  function label(it){
    if(it.qty===0)return ["نفد المخزون","danger"];
    if(it.qty<=it.min)return ["مخزون منخفض","warning"];
    return ["متوفر","success"];
  }
  function expiryInfo(it){
    const days=daysUntil(it.expiry);
    if(days===null)return ["غير محددة",false];
    if(days<0)return ["انتهت الصلاحية",true];
    if(days<=30)return ["خلال "+days+" يوم",true];
    return [it.expiry,false];
  }
  function render(){
    const q=$("inventorySearch").value.trim().toLocaleLowerCase("ar"),filter=$("inventoryFilter").value;
    const filtered=state.items.filter(it=>{
      const low=it.qty<=it.min,soon=expiryInfo(it)[1];
      return (!q||(it.name+" "+it.category+" "+it.id).toLocaleLowerCase("ar").includes(q)) &&
        (filter==="all"||filter==="low"&&low||filter==="expired"&&soon||filter==="available"&&it.qty>it.min&&!soon);
    });
    $("invTotal").textContent=state.items.length;
    $("invLow").textContent=state.items.filter(it=>it.qty>0&&it.qty<=it.min).length;
    $("invEmpty").textContent=state.items.filter(it=>it.qty===0).length;
    $("invExpiry").textContent=state.items.filter(it=>expiryInfo(it)[1]).length;
    $("inventoryCount").textContent=`${filtered.length} من أصل ${state.items.length} مواد`;
    const body=$("inventoryRows");body.replaceChildren();
    filtered.forEach(it=>{
      const tr=document.createElement("tr"),[status,color]=label(it),[expText,expWarn]=expiryInfo(it);
      tr.innerHTML=`<td><strong>${escape(it.name)}</strong><div class="small text-secondary">${escape(it.category)}</div></td>
      <td><strong class="fs-5">${it.qty}</strong> <span class="small text-secondary">${escape(it.unit)}</span></td>
      <td>${it.min} ${escape(it.unit)}</td><td><span class="${expWarn?"text-danger fw-bold":"text-secondary"}">${escape(expText)}</span></td>
      <td><span class="badge text-bg-${color}">${status}</span></td>
      <td><div class="d-flex gap-2 flex-wrap"><button type="button" class="btn btn-sm btn-outline-primary quick-issue" ${it.qty===0?"disabled":""}> <i class="bi bi-dash-circle ms-1"></i>صرف 1</button><button type="button" class="btn btn-sm btn-light border move-item">إدارة الكمية</button></div></td>`;
      tr.querySelector(".quick-issue").addEventListener("click",()=>move(it,"issue",1,"صرف سريع"));
      tr.querySelector(".move-item").addEventListener("click",()=>openMove(it.id));body.append(tr);
    });
    $("inventoryEmpty").classList.toggle("d-none",filtered.length>0);
    const hist=$("inventoryHistory");hist.replaceChildren();
    const totalMovements=state.moves.length;
    const pageCount=Math.max(1, Math.ceil(totalMovements/HISTORY_PAGE_SIZE));
    historyPage=Math.min(Math.max(1, historyPage),pageCount);
    const start=(historyPage-1)*HISTORY_PAGE_SIZE;
    state.moves.slice(start,start+HISTORY_PAGE_SIZE).forEach(m=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`<td class="text-nowrap">${escape(new Date(m.time).toLocaleString("ar-PS",{dateStyle:"short",timeStyle:"short"}))}</td>
      <td>${escape(m.name)}</td><td>${escape(({issue:"صرف",in:"توريد",damaged:"تالف",adjust:"جرد",initial:"رصيد أولي"})[m.kind]||m.kind)}</td>
      <td class="${m.change<0?"text-danger":"text-success"} fw-bold" dir="ltr">${m.change>0?"+":""}${m.change}</td>
      <td dir="ltr">${m.before} → ${m.after}</td><td>${escape(m.actor||"موظف العيادة (تجريبي)")}</td><td>${escape(m.reason||"—")}</td>`;
      hist.append(tr);
    });
    $("inventoryNoHistory").classList.toggle("d-none",totalMovements>0);
    const pager=$("inventoryHistoryPagination"), buttons=$("inventoryHistoryPages");
    pager.hidden=totalMovements===0;
    $("inventoryHistoryRange").textContent=totalMovements
      ? `عرض ${start+1}–${Math.min(start+HISTORY_PAGE_SIZE,totalMovements)} من ${totalMovements} حركة`
      : "";
    buttons.replaceChildren();
    if(totalMovements>0){
      const addButton=(label,page,disabled=false,current=false,accessibleLabel=label)=>{
        const btn=document.createElement("button");btn.type="button";btn.textContent=label;
        btn.setAttribute("aria-label",accessibleLabel);if(current)btn.setAttribute("aria-current","page");
        btn.disabled=disabled;btn.addEventListener("click",()=>{if(page===historyPage)return;historyPage=page;render();
          $("inventoryHistoryTitle").scrollIntoView?.({block:"start",behavior:"smooth"});});
        buttons.append(btn);
      };
      addButton("السابق",historyPage-1,historyPage===1,false,"الصفحة السابقة");
      // Compact page sequence when there are many movements.
      const pages=new Set([1,pageCount]);
      for(let p=Math.max(1,historyPage-2);p<=Math.min(pageCount,historyPage+2);p++)pages.add(p);
      let prev=0;for(const page of [...pages].sort((a,b)=>a-b)){
        if(prev&&page-prev>1){const dots=document.createElement("span");dots.className="px-1 text-secondary";dots.textContent="…";dots.setAttribute("aria-hidden","true");buttons.append(dots);}
        addButton(String(page),page,false,page===historyPage,`الصفحة ${page}`);prev=page;
      }
      addButton("التالي",historyPage+1,historyPage===pageCount,false,"الصفحة التالية");
    }
  }
  const kinds={issue:"صرف للاستخدام",in:"إضافة وارد",damaged:"تالف",adjust:"تسوية جرد"};
  function move(item,kind,amount,reason){
    const n=num(amount);if(n===null || (kind!=="adjust"&&n<1))return "أدخل كمية صحيحة أكبر من صفر.";
    if((kind==="issue"||kind==="damaged")&&n>item.qty)return "لا يمكن صرف كمية أكبر من المتوفر ("+item.qty+").";
    if(kind==="in"&&item.qty+n>1000000)return "تجاوزت الحد الأعلى التجريبي للمادة.";
    if(!kinds[kind])return "نوع الحركة غير صالح.";
    const before=item.qty,after=kind==="adjust"?n:kind==="in"?before+n:before-n;
    item.qty=after;
    state.moves.unshift({id:Date.now()+"-"+Math.random().toString(16).slice(2),itemId:item.id,name:item.name,
      kind,change:after-before,before,after,reason:reason||"",actor:"موظف العيادة (تجريبي)",time:new Date().toISOString()});
    historyPage=1;persist();render();toast(`تم ${kinds[kind]} — ${item.name}: الكمية الآن ${after} ${item.unit}`);
    return null;
  }
  function openMove(id){
    activeId=id;const it=state.items.find(x=>x.id===id);if(!it)return;
    $("inventoryMoveTitle").textContent="حركة مخزون — "+it.name;
    $("inventoryMoveAvailable").textContent=`المتوفر الآن: ${it.qty} ${it.unit} • حد التنبيه: ${it.min}`;
    $("inventoryMoveType").value="issue";$("inventoryMoveQty").value="1";
    $("inventoryMoveReason").value="";$("inventoryMoveError").textContent="";
    $("inventoryMoveSubmit").disabled=false; // Never inherit the global submit guard state.
    window.bootstrap?.Modal?.getOrCreateInstance($("inventoryMoveModal")).show();
  }
  $("inventoryMoveType").addEventListener("change",()=>{
    $("inventoryMoveQtyLabel").textContent=$("inventoryMoveType").value==="adjust"?"الرصيد الجديد بعد الجرد":"الكمية";
    $("inventoryMoveQty").min=$("inventoryMoveType").value==="adjust"?"0":"1";
  });
  $("inventoryMoveForm").addEventListener("submit",e=>{
    e.preventDefault();const it=state.items.find(x=>x.id===activeId);if(!it)return;
    $("inventoryMoveSubmit").disabled=false;
    const kind=$("inventoryMoveType").value,reason=$("inventoryMoveReason").value.trim();
    if((kind==="damaged"||kind==="adjust")&&!reason){$("inventoryMoveError").textContent="يرجى كتابة سبب التلف أو تسوية الجرد.";return;}
    const err=move(it,kind,$("inventoryMoveQty").value,reason);
    if(err){$("inventoryMoveError").textContent=err;return;}
    $("inventoryMoveError").textContent="";
    window.bootstrap?.Modal?.getInstance($("inventoryMoveModal"))?.hide();
  });
  $("inventoryAddForm").addEventListener("submit",e=>{
    e.preventDefault();const name=$("invName").value.trim(),qty=num($("invInitial").value),min=num($("invMin").value);
    if(!name||qty===null||min===null){toast("أدخل اسماً وكمية وحد تنبيه صحيحين.");return;}
    const it={id:"i-"+Date.now().toString(36)+Math.random().toString(36).slice(2,6),name,
      category:$("invCategory").value,unit:$("invUnit").value,qty,min,expiry:$("invExp").value};
    state.items.unshift(it);
    if(qty>0)state.moves.unshift({id:"init-"+it.id,itemId:it.id,name:it.name,kind:"initial",change:qty,before:0,after:qty,
      reason:"إضافة مادة جديدة",actor:"موظف العيادة (تجريبي)",time:new Date().toISOString()});
    historyPage=1;persist();render();e.target.reset();window.bootstrap?.Modal?.getInstance($("inventoryAddModal"))?.hide();toast("تمت إضافة المادة للمخزون تجريبياً.");
  });
  ["inventorySearch","inventoryFilter"].forEach(id=>$(id).addEventListener(id==="inventorySearch"?"input":"change",render));
  render();
});
