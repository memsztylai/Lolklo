import {computeDelta,sanitizeCard} from './live-core.mjs';
const $=id=>document.getElementById(id),storeKey='wycennikai-v03-live-state',textKey='wycennikai-mobile-text';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const source=()=>localStorage.getItem(textKey)||'';
const getPin=()=>$('pin').value.trim();
let card=null,confirmed='',busy=false,queued=false,timer=null,calls=0,epoch=0,lastCallAt=0,lastResult=null,controller=null;
function status(s){$('liveStatus').textContent=s}
function save(){try{localStorage.setItem(storeKey,JSON.stringify({confirmed,state:card,calls,lastResult}))}catch{}}
function render(){
 if(!card){$('analysis').textContent='Brak analizy. Rozpocznij nagrywanie lub kliknij „Analizuj teraz”.';return}
 const labels={active:'Aktualne',changed:'Zmienione',cancelled:'Odwołane',uncertain:'Niepewne',declared:'Deklarowane',confirmed:'Potwierdzone'};
 const proven=e=>{const n=x=>String(x||'').toLocaleLowerCase().replace(/\s+/g,' ').trim();return !!n(e) && n(source()).includes(n(e))};
 const reqs=card.requirements.map(x=>'<li><b>'+escape(x.title)+'</b> — '+escape(x.detail)+' <span class="muted">('+escape(labels[x.status]||x.status)+')</span> '+escape(x.room||'')+'<br><small>Źródło: „'+escape(x.evidence||'brak cytatu')+'” '+(proven(x.evidence)?'✓ cytat':'⚠ cytat nieodnaleziony')+'</small></li>').join('');
 const facts=card.facts.map(x=>'<li><b>'+escape(x.label)+':</b> '+escape(x.value)+' <span class="muted">('+escape(labels[x.status]||x.status)+')</span><br><small>Źródło: „'+escape(x.evidence||'brak cytatu')+'”</small></li>').join('');
 const questions=card.questions.map(x=>'<li>'+escape(x)+'</li>').join('');
 $('analysis').innerHTML='<small>AI LIVE • wymaga sprawdzenia z klientem</small><p><b>Projekt:</b> '+escape(card.projectType||'Nieokreślony')+'</p><p>'+escape(card.summary)+'</p><b>Ustalenia ('+card.requirements.length+')</b>'+(reqs?'<ul>'+reqs+'</ul>':'<p>Brak wykrytych prac.</p>')+'<b>Parametry</b>'+(facts?'<ul>'+facts+'</ul>':'<p>Nie podano.</p>')+'<b>3 kluczowe pytania</b>'+(questions?'<ol>'+questions+'</ol>':'<p>Nie zaproponowano.</p>');
 $('exportCard').disabled=false;$('exportCardTxt').disabled=false;
}
function resetState(){epoch++;controller?.abort();controller=null;clearTimeout(timer);busy=false;queued=false;confirmed='';card=null;calls=0;lastResult=null;localStorage.removeItem(storeKey);$('exportCard').disabled=true;$('exportCardTxt').disabled=true;status('AI: pamięć wyczyszczona');render()}
async function execute(force=false){
 clearTimeout(timer);
 if(busy){queued=true;return}
 const full=source(),diff=computeDelta(full,confirmed);
 if(diff.reset){card=null;confirmed='';calls=0;lastResult=null}
 const addition=diff.delta.trim();
 if(!addition){if(force)status('AI: brak nowych fragmentów');return}
 if(!getPin()){status('AI: wpisz PIN testowy');return}
 const delay=5000-(Date.now()-lastCallAt);if(delay>0&&!force){schedule(delay+150);return}
 busy=true;queued=false;lastCallAt=Date.now();const myEpoch=epoch;controller=new AbortController();const since=performance.now();status('AI: analizuje nowy fragment… mikrofon nadal pracuje');
 let success=false;
 try{
  const r=await fetch('/.netlify/functions/analyze',{method:'POST',headers:{'content-type':'application/json','x-test-pin':getPin()},body:JSON.stringify({language:$('lang').value,newText:addition.slice(0,7000),previousState:card}),signal:controller.signal});
  let out;try{out=await r.json()}catch{throw Error('Brak odpowiedzi JSON. Sprawdź wdrożenie funkcji Netlify (HTTP '+r.status+').')}
  if(!r.ok)throw Error(out.message||out.error||('HTTP '+r.status));
  if(epoch!==myEpoch)return;
  const next=sanitizeCard(out.state);if(!next)throw Error('Niepoprawny format danych AI');
  card=next;confirmed+=diff.delta.slice(0,7000);calls++;lastResult={at:out.createdAt,latencyMs:Math.round(performance.now()-since),model:out.model,usage:out.usage};
  render();save();status('AI LIVE: '+calls+' aktualizacji · '+(lastResult.latencyMs/1000).toFixed(1)+' s · '+new Date().toLocaleTimeString('pl-PL'));success=true;
 }catch(e){if(epoch===myEpoch&&e?.name!=='AbortError')status('AI: '+e.message+' · nie utracono transkrypcji. Po poprawieniu problemu kliknij „Analizuj teraz”.')}
 finally{if(epoch===myEpoch){busy=false;controller=null;const rest=computeDelta(source(),confirmed);if(success&&(queued||rest.delta.trim())&&$('liveEnabled').checked&&getPin())schedule(5000)}}
}
function schedule(ms=1800){if(!$('liveEnabled').checked)return;clearTimeout(timer);timer=setTimeout(()=>execute(),ms)}
window.addEventListener('wycennikai:final',()=>schedule(1800));
window.addEventListener('wycennikai:cleared',()=>resetState());
$('pin').value=sessionStorage.getItem('wycennikai-test-pin')||'';
$('pin').addEventListener('input',()=>{sessionStorage.setItem('wycennikai-test-pin',getPin());if(getPin()&&source()&&!card)schedule(700)});
$('analyze').addEventListener('click',()=>execute(true));
$('liveEnabled').addEventListener('change',()=>{if($('liveEnabled').checked)schedule(300);else{clearTimeout(timer);status('AI LIVE: automatyczna analiza wyłączona')}});
$('resetAI').addEventListener('click',()=>{if(confirm('Wyczyścić pamięć AI? Transkrypcja pozostanie.'))resetState()});
function download(s,n,type){const u=URL.createObjectURL(new Blob([s],{type})),a=document.createElement('a');a.href=u;a.download=n;a.click();setTimeout(()=>URL.revokeObjectURL(u),1500)}
$('exportCard').onclick=()=>{if(card)download(JSON.stringify({version:'0.3.1',analysisType:'groq-live-ai',transcriptLanguage:$('lang').value,sourceText:source(),state:card,liveDiagnostics:{calls,lastResult,analyzedCharacters:confirmed.length}},null,2),'wycennikai-ai-live-karta.json','application/json;charset=utf-8')};
$('exportCardTxt').onclick=()=>{if(!card)return;download(['WYCENNIKAI AI LIVE v0.3.1','Projekt: '+card.projectType,'Podsumowanie: '+card.summary,'','USTALENIA:',...card.requirements.map(x=>'- '+x.title+' ('+x.status+'): '+x.detail+' / Źródło: '+x.evidence),'','PARAMETRY:',...card.facts.map(x=>'- '+x.label+': '+x.value+' ('+x.status+') / Źródło: '+x.evidence),'','PYTANIA:',...card.questions.map((x,i)=>(i+1)+'. '+x),'','TRANSKRYPCJA:',source()].join('\n'),'wycennikai-ai-live-karta.txt','text/plain;charset=utf-8')};
try{const saved=JSON.parse(localStorage.getItem(storeKey)||'null');if(saved&&typeof saved.confirmed==='string'&&source().startsWith(saved.confirmed)){confirmed=saved.confirmed;card=sanitizeCard(saved.state);calls=saved.calls||0;lastResult=saved.lastResult||null;render();status('AI: przywrócono kartę · '+calls+' analiz');if(source().length>confirmed.length)schedule(800)}else{localStorage.removeItem(storeKey)}}catch{}
if(!card)render();
