import test from "node:test";
import assert from "node:assert/strict";
import { parseAgentArgs, validateAgentAction, classifyControl,
  publicPageUrl, readLocalDeepSeekKey, redactForModel } from "./agent-core.mjs";
import { parseDeepSeekAction, requestDeepSeekAction, ACT_TOOL } from "./deepseek-client.mjs";
import { waitForRenderwolfUI, isUsefulObservation } from "./agent-ready.mjs";
import { actionFingerprint, countSameClick, MAX_SAME_CLICK } from "./agent-stall.mjs";
import { recoverRepeatedSheetChoice } from "./agent-export-recovery.mjs";

const start = "https://slots.renderwolf.ai/games/1785165208846/design/character_symbol_set_1785165292435_symbol_1/extra/animation";
const basic = ["--task", "Télécharge l'animation existante du Yéti",
  "--session-file", "C:\\Users\\user\\Downloads\\renderwolf-session.json",
  "--start-url", start, "--output-dir", "C:\\Users\\user\\Downloads\\yeti-export"];

test("agent requires existing session, explicit task, fresh output folder", () => {
  const parsed = parseAgentArgs(basic);
  assert.equal(parsed.maxSteps, 12);
  assert.equal(parsed.model, "deepseek-flash");
  assert.equal(parsed.startUrl, start);
  assert.equal(parsed.allowGeneration, undefined);
  assert.throws(() => parseAgentArgs(["--task", "Do download"]), /session-file/);
});
test("agent caps action count and stays on provider host without token budget", () => {
  assert.equal(parseAgentArgs([...basic, "--max-steps", "4"]).maxSteps,4);
  assert.throws(() => parseAgentArgs([...basic, "--max-steps", "100"]), /maxSteps/);
  assert.equal(parseAgentArgs(basic).tokenBudget, undefined);
  assert.throws(() => parseAgentArgs([...basic, "--token-budget", "999999"]), /Unsupported/);
  assert.throws(() => parseAgentArgs([...basic, "--start-url", "https://evil.test/"]), /start-url/);
  assert.throws(() => parseAgentArgs([...basic, "--start-url", start+"?token=x"]), /start-url/);
  assert.equal(parseAgentArgs([...basic, "--allow-generation"]).allowGeneration, true);
  assert.throws(() => parseAgentArgs([...basic, "--run-js"]), /Unsupported/);
});
test("model cannot click unobserved or destructive controls", () => {
  const observation={controls:[
    {id:0,label:"Download animation",tag:"button"},
    {id:1,label:"Regenerate element image",tag:"button"},
    {id:2,label:"Delete all assets",tag:"button"},
    {id:3,label:"Add credits",tag:"button"},
    {id:4,label:"Both sheets (.zip)",tag:"label"},
    {id:5,tag:"textarea",placeholder:"Prompt"},
  ]};
  assert.equal(classifyControl(observation.controls[0]),"safe");
  assert.equal(classifyControl(observation.controls[1]),"generation");
  assert.equal(classifyControl(observation.controls[2]),"forbidden");
  assert.equal(classifyControl(observation.controls[3]),"forbidden");
  assert.equal(validateAgentAction({action:"click",target_id:0},observation).risk,"safe");
  assert.equal(validateAgentAction({action:"click",target_id:1},observation).risk,"generation");
  assert.equal(validateAgentAction({action:"click",target_id:4},observation).risk,"safe");
  assert.throws(()=>validateAgentAction({action:"click",target_id:2},observation),/blocked/);
  assert.throws(()=>validateAgentAction({action:"click",target_id:3},observation),/blocked/);
  assert.throws(()=>validateAgentAction({action:"click",target_id:100},observation),/absent/);
  assert.equal(validateAgentAction({action:"fill",target_id:5,value:"blue yeti"},observation).value,"blue yeti");
  assert.throws(()=>validateAgentAction({action:"fill",target_id:1,value:"secret"},observation),/text inputs/);
  assert.deepEqual(validateAgentAction({action:"wait"},observation),{action:"wait"});
});
test("credential fields cannot be filled by LLM", () => {
  const o={controls:[{id:1,tag:"input",placeholder:"API Key"}]};
  assert.throws(()=>validateAgentAction({action:"fill",target_id:1,value:"secret"},o),/blocked|credential/);
});
test("redact visible UI URLs, keys and emails", () => {
  const value=redactForModel("https://slots.renderwolf.ai?token=abc someone@example.org sk-abcdefghijklmnopqrstuvwxyz1234");
  assert(!value.includes("token=abc"));
  assert(!value.includes("someone@example.org"));
  assert(!value.includes("abcdefghijklmnopqrstuvwxyz"));
  assert.equal(publicPageUrl(start+"?token=sensitive"),start);
  assert.throws(()=>publicPageUrl("https://google.com/"),/outside/);
});
test("locally supplied key is read without disclosing it",async()=>{
  const file=new URL("data:text/plain,DEEPSEEK_API_KEY=sk-example-this-is-not-a-real-api-key");
  // Environment var path avoids network; no real key is used in these tests.
  const existing=process.env.DEEPSEEK_API_KEY;
  try{
    process.env.DEEPSEEK_API_KEY="sk-test-this-is-not-a-real-api-key";
    assert.equal(await readLocalDeepSeekKey(file),"sk-test-this-is-not-a-real-api-key");
  }finally{
    if(existing===undefined)delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY=existing;
  }
});
test("DeepSeek one-tool response parsing",()=>{
  const mock={choices:[{message:{tool_calls:[{
    id:"call_test_1",type:"function",function:{name:"act",
    arguments:JSON.stringify({action:"click",target_id:2})}
  }]}}]};
  assert.deepEqual(parseDeepSeekAction(mock).action,{action:"click",target_id:2});
  assert.throws(()=>parseDeepSeekAction({choices:[{message:{tool_calls:[]}}]}),/exactly one/);
  assert.throws(()=>parseDeepSeekAction({choices:[{message:{tool_calls:[{
    id:"x",type:"function",function:{name:"shell",arguments:"{}"},
  }]}}]}),/unsupported/);
});
test("DeepSeek transport sends only tool schema and sanitized observations",async()=>{
  let captured;
  const transport=async (url,options)=>{
    captured={url,options};
    return {ok:true,json:async()=>({
      choices:[{message:{tool_calls:[{id:"c1",type:"function",
      function:{name:"act",arguments:"{\"action\":\"finish\",\"summary\":\"done\"}"}}]}}],
      usage:{total_tokens:22,prompt_tokens:18,completion_tokens:4},
    })};
  };
  const result=await requestDeepSeekAction({
    apiKey:"sk-test-not-real",
    messages:[{role:"system",content:"policy"},{role:"user",content:"download Yeti"}],
    transport,
  });
  assert.equal(captured.url,"https://api.deepseek.com/chat/completions");
  assert.equal(captured.options.headers.Authorization,"Bearer sk-test-not-real");
  const body=JSON.parse(captured.options.body);
  assert.equal(body.model,"deepseek-flash");
  assert.equal(body.thinking.type,"disabled");
  assert.equal(body.tool_choice,"required");
  assert.equal(body.tools[0].function.name,"act");
  assert.equal(ACT_TOOL.function.name,"act");
  assert.equal(result.action.action,"finish");
  assert.equal(result.usage.total_tokens,22);
});


test("SPA hydration wait avoids premature DeepSeek requests",async()=>{
  let counter=0, slept=0;
  const browser={waitForTimeout:async()=>{slept++;}};
  const read=async()=>({controls:counter++<3?[]:[{id:0,label:"Download animation"}]});
  const result=await waitForRenderwolfUI(browser,read,{attempts:6,intervalMs:1});
  assert.equal(result.ready,true);
  assert.equal(result.polls,4);
  assert.equal(slept,3);
  assert.equal(result.observation.controls[0].label,"Download animation");
});

test("animation editor requires actual Download animation control on first render",async()=>{
  const states=[
    {controls:[{id:0,label:"Toggle sidebar"}]},
    {controls:[{id:0,label:"Download animation"}]},
  ];
  const browser={waitForTimeout:async()=>{}};
  const result=await waitForRenderwolfUI(browser,async()=>states.shift(),{
    requireAnimationDownload:true,attempts:3,intervalMs:0,
  });
  assert.equal(result.polls,2);
  assert.equal(result.ready,true);
  assert.equal(isUsefulObservation({controls:[{id:0,label:"Toggle sidebar"}]},
    {requireAnimationDownload:true}),false);
});

test("no control after readiness attempts returns diagnostic-worthy failure",async()=>{
  let calls=0;
  const browser={waitForTimeout:async()=>{}};
  const result=await waitForRenderwolfUI(browser,async()=>{
    calls++;
    return {controls:[]};
  },{attempts:4,intervalMs:0});
  assert.equal(calls,4);
  assert.equal(result.ready,false);
  assert.equal(result.polls,4);
});


test("repeated click on unchanged page stops before third click", () => {
  const observation = {
    url: "https://slots.renderwolf.ai/games/example/extra/animation",
    controls: [
      {id:0,tag:"button",label:"Download animation"},
      {id:1,tag:"button",label:"Generate"},
    ],
  };
  const click = {action:"click",target_id:0};
  const fp = actionFingerprint(observation, click);
  assert.ok(fp);
  const first = countSameClick(null,0,fp);
  const second = countSameClick(fp,first,fp);
  const third = countSameClick(fp,second,fp);
  assert.equal(first,1);
  assert.equal(second,2);
  assert.ok(third > MAX_SAME_CLICK);
});
test("change of UI or action clears stalled-click count", () => {
  const base = {url:"https://slots.renderwolf.ai/x",controls:[{id:0,tag:"button",label:"Download animation"}]};
  const changed = {url:"https://slots.renderwolf.ai/x",controls:[
    {id:0,tag:"button",label:"Download animation"},
    {id:1,tag:"label",text:"Both sheets (.zip)"},
  ]};
  const previous = actionFingerprint(base,{action:"click",target_id:0});
  const current = actionFingerprint(changed,{action:"click",target_id:0});
  assert.notEqual(previous,current);
  assert.equal(countSameClick(previous,2,current),1);
  assert.equal(actionFingerprint(changed,{action:"wait"}),null);
  assert.equal(countSameClick(current,2,null),0);
});


test("recover second repeated 4×4 click by clicking only final Download", () => {
  const observation = {
    url: "https://slots.renderwolf.ai/games/example/extra/animation",
    controls: [
      {id: 1, tag: "button", label: "Download sprite sheet…"},
      {id: 2, tag: "button", text: "4×4"},
      {id: 3, tag: "button", text: "Download", label: "Download"},
    ],
  };
  const task = "Télécharge l'animation existante 4x4, Both sheets (.zip)";
  const first = recoverRepeatedSheetChoice({
    observation, action: {action:"click",target_id:2}, repeatCount:1, task,
  });
  assert.equal(first, null);
  const recovered = recoverRepeatedSheetChoice({
    observation, action: {action:"click",target_id:2}, repeatCount:2, task,
  });
  assert.deepEqual(recovered.action, {action:"click",target_id:3});
});

test("selected 4×4 choice advances straight to Download", () => {
  const observation = {
    url: "https://slots.renderwolf.ai/games/example/extra/animation",
    controls: [
      {id: 2, tag: "button", text:"4×4", selected:true},
      {id: 3, tag: "button", text:"Download"},
    ],
  };
  const result = recoverRepeatedSheetChoice({
    observation, action:{action:"click",target_id:2}, repeatCount:1,
    task:"Télécharge l'animation 4x4",
  });
  assert.equal(result.action.target_id,3);
});

test("honors explicitly requested Both sheets when visibly unselected", () => {
  const observation = {
    url:"https://slots.renderwolf.ai/games/example/extra/animation",
    controls: [
      {id:1,tag:"button",text:"4×4",selected:true},
      {id:2,tag:"button",text:"Both sheets (.zip)",selected:false},
      {id:3,tag:"button",text:"Download"},
    ],
  };
  const result=recoverRepeatedSheetChoice({
    observation,action:{action:"click",target_id:1},repeatCount:2,
    task:"Télécharge l'animation en Both sheets (.zip)",
  });
  assert.equal(result.action.target_id,2);
});

test("recovery refuses ambiguous, disabled, off-domain, destructive controls", () => {
  const base = {
    url:"https://slots.renderwolf.ai/games/example/extra/animation",
    controls:[
      {id:1,tag:"button",text:"4×4"},
      {id:2,tag:"button",text:"Download",disabled:true},
    ],
  };
  const args={observation:base, action:{action:"click",target_id:1},
    repeatCount:3,task:"Télécharge cette animation"};
  assert.equal(recoverRepeatedSheetChoice(args),null);
  assert.equal(recoverRepeatedSheetChoice({
    ...args,observation:{...base,url:"https://slots.renderwolf.ai/dashboard"},
  }),null);
  assert.equal(recoverRepeatedSheetChoice({...args,task:"Réponds à un message"}),null);
  assert.equal(recoverRepeatedSheetChoice({
    ...args,observation:{...base,controls:[
      {id:1,tag:"button",text:"4×4"},
      {id:2,tag:"button",text:"Download"},
      {id:3,tag:"button",text:"Download"},
    ]},
  }),null);
});
