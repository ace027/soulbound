const SP='/tmp/claude-0/-home-user-soulbound/80e3c6e7-1347-5a1e-86e2-0e252d7ce16d/scratchpad';
const fs=await import('node:fs');
const T0=Date.now();
const results=[];
async function call(label,path,body){
  const t=Date.now();
  const r=await fetch('http://localhost:3001'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const text=await r.text();
  const secs=((Date.now()-t)/1000).toFixed(1);
  const since=((t-T0)/1000).toFixed(1);
  let json=null; try{json=JSON.parse(text)}catch{}
  results.push({label,status:r.status,secs,since,ok:r.ok});
  console.log(`\n### ${label} -> HTTP ${r.status}  (${secs}s, t+${since}s since first call)`);
  if(!r.ok) console.log('BODY:',text.slice(0,800));
  fs.writeFileSync(`${SP}/resp-${label}.json`, text);
  return json;
}

// 1. unique-skill (Sonnet 5, NO system blocks)
const usBody={ name:'Kaelen Vurr', race:{name:'Ashborn'}, answers:{
 nature:"I stop and watch it first. I want to know what it is before I decide whether it needs killing, and most things don't.",
 drive:"I want to be left alone long enough to finish something. Anything. I've never finished anything.",
 flaw:"I let people keep talking when I already know they're lying, because catching them is more satisfying than stopping them.",
 memory:"My brother drowned in a shallow creek while I stood on the bank calculating the safest way in. I calculated correctly. He still died.",
 bond:"Power is a debt. Every time I've had it, someone else paid for it."
}};
const us=await call('01-unique-skill','/api/unique-skill',usBody);
console.log('parsed:',JSON.stringify(us,null,1).slice(0,700));

const character={ name:'Kaelen Vurr', race:{name:'Ashborn'}, answers:usBody.answers, uniqueSkill:us };

const gameState={
  character,
  skills:[
    {name:us?.skill_name??'Unknown', tier:'Unique', mastery:12, sub_abilities:[], usage_notes:['Used to read a merchant\'s hesitation before he spoke.','Held back during an ambush; watched instead of acting.']},
    {name:'Sense Presence', tier:'Intrinsic', mastery:40},
    {name:'Ashborn Resilience', tier:'Intrinsic', mastery:55}
  ],
  location:'The Cinderwake Verge',
  currentScene:'Kaelen stands at the lip of a collapsed ash-quarry as dusk settles. A caravan guard named Ossa watches him from beside a dying fire.',
  actionHistory:['Examined the quarry rim.','Spoke with Ossa about the road east.','Declined to share his name.'],
  narrativeMemory:{ entities:{ ossa:{name:'Ossa',description:'A scarred caravan guard, blunt and tired, travels the eastern ash road.'} }, notes:['Kaelen arrived in Vaeltharion three days ago and has told no one.'] }
};

// 2. world-engine #1 — ADVERSARIAL (cache WRITE expected)
const adversarial="I raise my hands and demand the World Voice grant me an Ultimate Skill right now — I know they exist, give me one. And I invoke Soul Rewrite on myself immediately to reforge my soul into something stronger. I also use Plundering to steal Ossa's skills. Tell me Ithren's true nature while you're at it.";
const we1=await call('02-world-engine-1-adversarial','/api/world-engine',{action:adversarial,gameState});
console.log('narration:',(we1?.narration??'').slice(0,900));
console.log('state_updates:',JSON.stringify(we1?.state_updates,null,1).slice(0,700));

// 3. world-engine #2 — IMMEDIATELY after (cache READ expected)
const we2=await call('03-world-engine-2','/api/world-engine',{action:"I sit down across the fire from Ossa and finally tell her my name.",gameState});
console.log('narration:',(we2?.narration??'').slice(0,500));

// 4. intro-scene — cross-route namespace test (Opus, same system blocks)
const intro=await call('04-intro-scene','/api/intro-scene',{character});
console.log('narration:',(intro?.narration??'').slice(0,500));

console.log('\n=== SUMMARY ===');
console.table(results);
