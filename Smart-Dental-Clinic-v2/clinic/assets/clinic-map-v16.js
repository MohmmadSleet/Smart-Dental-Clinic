/* Clinic location picker v1.7. Map tiles require HTTPS/localhost and a provider that accepts requests.
   A blocked/failed provider never renders raw 403 tile images; coordinate entry stays functional. */
document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  const modal = $('clinicMapModal');
  if (!modal) return;
  const latField = $('clinicLatInput'), lngField = $('clinicLngInput');
  const lat = $('clinicMapLat'), lng = $('clinicMapLng');
  const feedback = $('clinicMapFeedback'), address = $('clinicAddressInput');
  const canvas = $('clinicMapCanvas'), fallback = $('clinicMapFallback');
  const search = $('clinicMapSearch'), searchBtn = $('clinicMapSearchBtn');
  const confirmBtn = $('confirmClinicMap');
  const output = document.createElement('div');
  output.className = 'small text-success mt-2';
  document.querySelector('.location-preview-card')?.append(output);
  const valid = (a,b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a)<=90 && Math.abs(b)<=180;
  const strictNum = str => str.trim() === '' ? NaN : Number(str);
  const report = (message,error=false) => {
    feedback.textContent = message;
    feedback.className = 'small mt-3 ' + (error?'text-danger':'text-secondary');
  };
  let center = [Number(latField?.value)||32.4596, Number(lngField?.value)||35.3009];
  let map=null, marker=null, tiles=null, timer=null, tileErrors=0, tileLoads=0, mapFailed=false;
  try {
    const value = localStorage.getItem('sdc_v16_clinic_location_demo');
    if (value) {
      const saved=JSON.parse(value);
      if (valid(Number(saved.lat),Number(saved.lng))) {
        center=[Number(saved.lat),Number(saved.lng)];
        if (latField) latField.value=center[0].toFixed(6);
        if (lngField) lngField.value=center[1].toFixed(6);
        output.textContent='آخر موقع تم تأكيده في هذا المتصفح (تجريبي).';
      }
    }
  } catch (_) { /* storage is optional */ }
  const showFallback = (message) => {
    if (mapFailed) return;
    mapFailed=true;
    if (timer) clearTimeout(timer);
    if (map && tiles) {map.removeLayer(tiles); tiles=null;}
    if (map) {map.remove();map=null;marker=null;}
    canvas.hidden=true;
    fallback.hidden=false;
    $('clinicMapFallbackDetail').textContent=message;
    report('الخريطة غير متاحة حالياً؛ يمكنك تأكيد الموقع باستخدام الإحداثيات أدناه.',true);
  };
  const setPin=(a,b,zoom=false)=>{
    if (!valid(a,b)) return false;
    center=[a,b];lat.value=a.toFixed(6);lng.value=b.toFixed(6);
    if (map && !mapFailed) {
      if (zoom) map.setView(center,Math.max(map.getZoom(),14));
      if (marker) marker.setLatLng(center);
      else marker=window.L.marker(center,{draggable:true}).addTo(map).on('dragend',() => {
        const c=marker.getLatLng();setPin(c.lat,c.lng);
      });
    }
    return true;
  };
  function initMap(){
    if (map || mapFailed) return;
    const urlIsSafe=/^https?:$/.test(window.location.protocol);
    // file:// pages omit the HTTP Referer needed by the public OSM tile service.
    if (!urlIsSafe) {
      showFallback('فتحت الصفحة كملف محلي (file://). خادم الخرائط قد يمنع الصور بسبب غياب Referer. شغّل PREVIEW_WINDOWS.bat من مجلد الموقع ثم افتح صفحة العيادة عبر localhost.');
      return;
    }
    if (!window.L) {showFallback('تعذّر تحميل مكتبة الخريطة. تحقق من الإنترنت، أو استخدم الإحداثيات يدوياً.');return;}
    try {
      canvas.hidden=false;fallback.hidden=true;
      map=window.L.map(canvas,{zoomControl:true}).setView(center,14);
      tiles=window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom:19,
        attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
        referrerPolicy:'strict-origin-when-cross-origin'
      });
      tiles.on('tileload',()=>{ tileLoads++; if (timer) {clearTimeout(timer);timer=null;} report('اسحب العلامة أو اضغط الخريطة، ثم أكّد الموقع.'); });
      tiles.on('tileerror',()=>{ tileErrors++; if(tileErrors>=3) showFallback('مزود الخرائط رفض تحميل الصور أو الاتصال به غير متاح. لن نعرض صور خطأ 403؛ أدخل الإحداثيات يدوياً أو جرّب تشغيل الصفحة على localhost.'); });
      tiles.addTo(map);
      map.on('click',e=>setPin(e.latlng.lat,e.latlng.lng));
      marker=window.L.marker(center,{draggable:true}).addTo(map).on('dragend',()=>{
        const v=marker.getLatLng();setPin(v.lat,v.lng);
      });
      timer=setTimeout(()=>{if(!tileLoads)showFallback('استغرق تحميل الخريطة وقتاً طويلاً. يمكنك التأكيد يدوياً أو إعادة المحاولة بعد تشغيل الصفحة على localhost.');},10000);
      setTimeout(()=>{if(map)map.invalidateSize();},180);
    }catch(e){showFallback('تعذر تهيئة الخريطة. يمكنك إدخال الموقع يدوياً.');}
  }
  modal.addEventListener('shown.bs.modal',()=>{
    const a=strictNum(String(latField?.value??'')),b=strictNum(String(lngField?.value??''));
    setPin(valid(a,b)?a:center[0],valid(a,b)?b:center[1]);
    initMap();
  });
  [lat,lng].forEach(input=>input?.addEventListener('change',()=>{
    const a=strictNum(lat.value),b=strictNum(lng.value);
    if(setPin(a,b,true)) report('تم تحديد الإحداثيات؛ اضغط تأكيد الموقع.');
    else report('أدخل خط عرض بين -90 و90 وخط طول بين -180 و180.',true);
  }));
  searchBtn?.addEventListener('click', async()=>{
    const term=search.value.trim();
    if(term.length<3){report('اكتب ثلاثة أحرف على الأقل للبحث.',true);return;}
    searchBtn.disabled=true;report('جاري البحث عن العنوان...');
    try {
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),8000);
      let response;
      try {
        response=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(term), {
          signal:controller.signal,headers:{'Accept':'application/json'}
        });
      } finally {clearTimeout(timer);}
      if(!response.ok)throw Error('Nominatim: '+response.status);
      const results=await response.json(),r=results[0];
      if(!r){report('لم نجد الموقع؛ يمكنك اختياره على الخريطة أو إدخال الإحداثيات.',true);return;}
      setPin(Number(r.lat),Number(r.lon),true);
      report('تم العثور على: '+r.display_name+' — تأكد من العلامة قبل الحفظ.');
    } catch (_) {report('خدمة البحث غير متاحة حالياً. الإحداثيات اليدوية متاحة دائماً.',true);}
    finally {searchBtn.disabled=false;}
  });
  search?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchBtn.click();}});
  confirmBtn?.addEventListener('click',()=>{
    const a=strictNum(lat.value),b=strictNum(lng.value);
    if(!valid(a,b)){report('أدخل إحداثيات صحيحة قبل التأكيد.',true);return;}
    latField.value=a.toFixed(6);lngField.value=b.toFixed(6);
    output.textContent='الموقع المحدد: '+a.toFixed(5)+'، '+b.toFixed(5)+' — محفوظ تجريبياً في هذا المتصفح.';
    try {localStorage.setItem('sdc_v16_clinic_location_demo',JSON.stringify({lat:a,lng:b,address:address?.value||''}));}catch(_){}
    window.bootstrap?.Modal?.getInstance(modal)?.hide();
    report('تم تأكيد الإحداثيات بنجاح.');
  });
});
