import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/analyze.mjs';
import {computeDelta,sanitizeCard} from '../public/live-core.mjs';
const url='https://demo.netlify.app/.netlify/functions/analyze';
const fakeState={projectType:'Salon',summary:'Remont salonu.',requirements:[{title:'Tapeta',detail:'Ciemna tapeta na jednej ścianie',room:'Salon',status:'active',evidence:'Ciemno tapetę'},{title:'Fototapeta',detail:'Naprzeciwko, pasująca do koloru sofy',room:'Salon',status:'active',evidence:'fototapetę'},{title:'Montaż TV',detail:'Wiszący telewizor',room:'Salon',status:'active',evidence:'wiszącym telewizorem'},{title:'Oświetlenie',detail:'Inteligentne',room:'Salon',status:'active',evidence:'Oświetlenie również ma być inteligentny'}],facts:[],questions:['Jakie wymiary ścian?']};
function request(pin='test-pin-123',body={newText:'Chciałbym remont salonu',language:'pl-PL',previousState:null},origin='https://demo.netlify.app'){
 return new Request(url,{method:'POST',headers:{'content-type':'application/json','x-test-pin':pin,origin},body:JSON.stringify(body)});
}

test('delta dopisanej wypowiedzi i reset po korekcie transkrypcji',()=>{
 assert.deepEqual(computeDelta('Chcę wannę. Teraz prysznic.','Chcę wannę.'),{reset:false,delta:' Teraz prysznic.'});
 assert.deepEqual(computeDelta('Nie chcę wanny','Chcę wannę.'),{reset:true,delta:'Nie chcę wanny'});
});
test('karta czyści nieznane pola i pozwala na status cancelled',()=>{
 const r=sanitizeCard({...fakeState,requirements:[{title:'Wanna',detail:'Odwołana',room:'Łazienka',status:'cancelled',evidence:'Rezygnuję z wanny',hacked:true}]});
 assert.equal(r.requirements[0].status,'cancelled');assert.ok(!('hacked' in r.requirements[0]));
});
test('bez konfiguracji AI zwraca 503 bez wykonywania zapytań',async()=>{
 delete process.env.GROQ_API_KEY;delete process.env.WYCENNIKAI_TEST_PIN;
 const r=await handler(request());assert.equal(r.status,503);assert.equal((await r.json()).error,'not_configured');
});
test('nieprawidłowy PIN zwraca 401',async()=>{
 process.env.GROQ_API_KEY='test-key';process.env.WYCENNIKAI_TEST_PIN='test-pin-123';
 const r=await handler(request('wrong-pin'));assert.equal(r.status,401);
});
test('żądanie spoza origin jest odrzucane',async()=>{
 const r=await handler(request('test-pin-123',undefined,'https://attacker.test'));assert.equal(r.status,403);
});
test('prawidłowa analiza przekazuje tekst i pamięć do Groq, nie ujawnia sekretu',async()=>{
 const original=globalThis.fetch;let payload,headers;
 globalThis.fetch=async(_url,options)=>{payload=JSON.parse(options.body);headers=options.headers;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(fakeState)}}],usage:{prompt_tokens:500,completion_tokens:140}}),{status:200})};
 try{
  const prev={projectType:'Łazienka',summary:'Pierwotnie wanna',requirements:[{title:'Wanna',detail:'Wanna',room:'Łazienka',status:'active',evidence:'wannę'}],facts:[],questions:[]};
  const r=await handler(request('test-pin-123',{newText:'Jednak rezygnuję z wanny, wybieram prysznic',language:'pl-PL',previousState:prev}));
  assert.equal(r.status,200);
  const out=await r.json();assert.equal(out.analysisType,'groq-live-ai');assert.equal(out.state.requirements.length,4);
  assert.equal(payload.response_format.json_schema.strict,true);assert.equal(payload.model,'openai/gpt-oss-20b');
  assert.match(payload.messages[1].content,/rezygnuję z wanny/);assert.match(payload.messages[1].content,/Pierwotnie wanna/);
  assert.equal(headers.authorization,'Bearer test-key');assert.ok(!JSON.stringify(out).includes('test-key'));
 }finally{globalThis.fetch=original}
});
test('limit Groq 429 jest czytelnie przekazany do klienta',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response('{}',{status:429});
 try{const r=await handler(request());assert.equal(r.status,429);assert.match((await r.json()).message,/Limit/)}finally{globalThis.fetch=original}
});
