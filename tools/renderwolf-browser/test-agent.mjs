import test from "node:test";
import assert from "node:assert/strict";
import { parseAgentArgs, validateAgentAction, classifyControl,
  publicPageUrl, readLocalDeepSeekKey, redactForModel, canInspectAction } from "./agent-core.mjs";
import { parseDeepSeekAction, requestDeepSeekAction, ACT_TOOL } from "./deepseek-client.mjs";
import { waitForRenderwolfUI, isUsefulObservation, hasGameWorkspaceControls, hasDesignWorkspaceControls, hasFreshInterface } from "./agent-ready.mjs";
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


test("inspect mode is explicit, navigation-only and cannot enable generation", () => {
  const inspect = parseAgentArgs([...basic, "--mode", "inspect"]);
  assert.equal(inspect.mode, "inspect");
  assert.equal(parseAgentArgs(basic).mode, "export");
  assert.equal(parseAgentArgs([...basic, "--mode", "produce", "--allow-generation"]).mode, "produce");
  assert.throws(() => parseAgentArgs([...basic, "--mode", "produce"]), /requires --allow-generation/);
  assert.throws(() => parseAgentArgs([...basic, "--mode", "inspect", "--allow-generation"]), /incompatible/);
  assert.throws(() => parseAgentArgs([...basic, "--mode", "unknown"]), /mode must/);
  const click = {action:"click",target_id:1};
  assert.equal(canInspectAction(click,{tag:"a",label:"Frost Ascent"}),true);
  assert.equal(canInspectAction(click,{tag:"button",role:"tab",label:"Design"}),true);
  assert.equal(canInspectAction(click,{tag:"button",label:"Projects"}),true);
  assert.equal(canInspectAction(click,{tag:"button",label:"Generate artwork"}),false);
  assert.equal(canInspectAction(click,{tag:"a",label:"Download sprite sheet"}),false);
  assert.equal(canInspectAction(click,{tag:"button",label:"Create image"}),false);
  assert.equal(canInspectAction(click,{tag:"button",label:"Delete game"}),false);
  assert.equal(canInspectAction({action:"fill",target_id:1},{tag:"textarea",label:"Prompt"}),false);
  assert.equal(canInspectAction({action:"wait"},undefined),true);
  assert.equal(canInspectAction({action:"finish"},undefined),true);
});

test("DeepSeek repairs malformed JSON once then succeeds; usage includes bad reply", async () => {
  const raw = [
    {choices:[{message:{tool_calls:[{id:"a",type:"function",function:{name:"act",arguments:'{"action":"click","target_id":'}}]}}],usage:{total_tokens:110,prompt_tokens:100,completion_tokens:10}},
    {choices:[{message:{tool_calls:[{id:"b",type:"function",function:{name:"act",arguments:'{"action":"finish","summary":"inspected"}'}}]}}],usage:{total_tokens:90,prompt_tokens:80,completion_tokens:10}},
  ];
  let calls=0;
  const transport=async (url,opts)=>{
    const request=JSON.parse(opts.body);
    if(calls===1) {
      assert.match(request.messages.at(-1).content,/complete JSON arguments/);
      assert.equal(request.tool_choice,"required");
    }
    return {ok:true,json:async()=>raw[calls++]};
  };
  const r=await requestDeepSeekAction({apiKey:"sk-test",messages:[{role:"user",content:"Inspect the project"}],transport});
  assert.equal(r.action.action,"finish");
  assert.equal(r.attempts,2);
  assert.equal(r.recoveries,1);
  assert.equal(r.usage.total_tokens,200);
  assert.equal(r.unknownUsageRequests,0);
  assert.equal(calls,2);
});

test("DeepSeek retries at most twice for missing, malformed or unsupported tool calls", async () => {
  let calls=0;
  const invalid=[
    {choices:[{message:{tool_calls:[]}}],usage:{total_tokens:10}},
    {choices:[{message:{tool_calls:[{id:"x",type:"function",function:{name:"act",arguments:'{"action":"fill"'}}]}}],usage:{total_tokens:11}},
    {choices:[{message:{tool_calls:[{id:"y",type:"function",function:{name:"shell",arguments:"{}"}}]}}],usage:{total_tokens:12}},
  ];
  await assert.rejects(
    requestDeepSeekAction({
      apiKey:"sk-test",messages:[],
      transport:async()=>({ok:true,json:async()=>invalid[calls++]}),
    }),
    e=>{
      assert.match(e.message,/after 3 attempts/);
      assert.equal(e.attempts,3);
      assert.equal(e.usage.total_tokens,33);
      return true;
    }
  );
  assert.equal(calls,3);
});

test("DeepSeek retains usage uncertainty and never retries HTTP failures", async()=>{
  let calls=0;
  await assert.rejects(
    requestDeepSeekAction({
      apiKey:"sk-test",messages:[],
      transport:async()=>{calls++;return {ok:false,status:402};},
    }),
    e=> e.message==="DeepSeek API error HTTP 402" && e.attempts===1 &&
      e.unknownUsageRequests===1
  );
  assert.equal(calls,1);
  const result=await requestDeepSeekAction({
    apiKey:"sk-test",messages:[],
    transport:async()=>({ok:true,json:async()=>({
      choices:[{message:{tool_calls:[{
        id:"ok",type:"function",function:{name:"act",arguments:'{"action":"finish"}'}
      }]}}],
    })}),
  });
  assert.equal(result.unknownUsageRequests,1);
  assert.equal(result.usage.total_tokens,0);
});


test("RenderWolf dashboard project card is safe to open in inspect mode", () => {
  const dashboard = { url: "https://slots.renderwolf.ai/dashboard",
    context: ["Frost Ascent", "Demo Game"], controls: [] };
  const project = {
    tag:"div", role:"button",
    text:"34 assets Frost Ascent Theme Icy mountain ascent at night from base camp",
  };
  const click = { action:"click", target_id:7 };
  assert.equal(canInspectAction(click, project, dashboard), true);
  assert.equal(canInspectAction(click, project, {...dashboard,url:"https://slots.renderwolf.ai/other"}),false);
  assert.equal(canInspectAction(click, {...project,tag:"button"}, dashboard),false);
  assert.equal(canInspectAction(click, {...project,text:"34 assets Delete all games"},dashboard),false);
  assert.equal(canInspectAction(click, {...project,text:"34 assets Frost Ascent"},dashboard),false);
  assert.equal(canInspectAction(click, {...project,disabled:true},dashboard),false);
});

test("Upgrade Required dialog can be dismissed without payment or project mutation", () => {
  const modal = {url:"https://slots.renderwolf.ai/dashboard",
    context:["Upgrade Required", "Subscribe to unlock full access"], controls:[]};
  const dismiss = { tag:"button", label:"Maybe Later" };
  const action = {action:"click",target_id:1};
  assert.equal(canInspectAction(action,dismiss,modal),true);
  assert.equal(canInspectAction(action,dismiss,{...modal,context:["Frost Ascent"]}),false);
  assert.equal(canInspectAction(action,{tag:"button",label:"Subscribe Now"},modal),false);
  assert.equal(canInspectAction(action,{tag:"button",label:"Add credits"},modal),false);
  assert.equal(canInspectAction(action,{tag:"button",label:"Generate"},modal),false);
  assert.equal(canInspectAction({action:"fill",target_id:1},dismiss,modal),false);
});


test("game /player route must hydrate beyond stale dashboard cards before DeepSeek",async()=>{
  const dashboardShell={
    url:"https://slots.renderwolf.ai/games/1785165208846/player",
    controls:[
      {tag:"div",role:"button",text:"34 assets Frost Ascent Theme Icy mountain ascent at night"},
      {tag:"button",text:"Move to folder"},
      {tag:"button",text:"Delete Game"},
      {tag:"button",text:"Add credits"},
    ],
    context:["Frost Ascent","Demo Game","Games Showcase"],
  };
  const ready={...dashboardShell,controls:[
    ...dashboardShell.controls,{tag:"button",text:"Design"},
    {tag:"button",text:"Symbols"},
  ]};
  assert.equal(hasGameWorkspaceControls(dashboardShell),false);
  assert.equal(isUsefulObservation(dashboardShell,{requireGameWorkspace:true}),false);
  assert.equal(hasGameWorkspaceControls(ready),true);
  let poll=0, sleeps=0;
  const page={waitForTimeout:async()=>sleeps++};
  const output=await waitForRenderwolfUI(page,async()=>++poll<4?dashboardShell:ready,{
    attempts:5,intervalMs:0,requireGameWorkspace:true,
  });
  assert.equal(output.ready,true);
  assert.equal(output.polls,4);
  assert.equal(sleeps,3);
  assert.equal(output.observation.controls.at(-1).text,"Symbols");
});

test("game /player stale dashboard shell times out rather than sending model actions",async()=>{
  const old={
    url:"https://slots.renderwolf.ai/games/1785165208846/player",
    controls:[{tag:"div",role:"button",text:"34 assets Frost Ascent Theme Demo"}],
    context:["Frost Ascent","Demo Game"],
  };
  let count=0;
  const result=await waitForRenderwolfUI({waitForTimeout:async()=>{}},async()=>{
    count++; return old;
  },{attempts:3,intervalMs:0,requireGameWorkspace:true});
  assert.equal(result.ready,false);
  assert.equal(count,3);
  // Previous export and generic readiness behavior are not affected.
  assert.equal(isUsefulObservation(old),true);
});


test("direct player-page inspection can safely dismiss the known upgrade overlay",()=>{
  const observation={
    url:"https://slots.renderwolf.ai/games/1785165208846/player",
    context:["Upgrade Required Subscribe to unlock full access"],
    controls:[{tag:"button",label:"Subscribe Now"},{tag:"button",label:"Maybe Later"}],
  };
  assert.equal(hasGameWorkspaceControls(observation),true);
  assert.equal(isUsefulObservation(observation,{requireGameWorkspace:true}),true);
  assert.equal(canInspectAction({action:"click",target_id:1},observation.controls[1],observation),true);
  assert.equal(canInspectAction({action:"click",target_id:0},observation.controls[0],observation),false);
  assert.equal(hasGameWorkspaceControls({...observation,context:["Frost Ascent"]}),false);
});


test("game sidebar toggle is reversible navigation, not a generation action",()=>{
  const inspect={url:"https://slots.renderwolf.ai/games/1785165208846/design",
    context:["Frost Ascent"],controls:[]};
  const toggle={tag:"button",label:"Toggle sidebar"};
  assert.equal(canInspectAction({action:"click",target_id:1},toggle,inspect),true);
  assert.equal(canInspectAction({action:"click",target_id:1},toggle,
    {...inspect,url:"https://slots.renderwolf.ai/dashboard"}),false);
  assert.equal(canInspectAction({action:"click",target_id:1},
    {tag:"button",label:"Generate"},inspect),false);
  assert.equal(canInspectAction({action:"click",target_id:1},
    {tag:"button",label:"Subscribe Now"},inspect),false);
});

test("direct design route waits for assets instead of using global navigation",async()=>{
  const shell={url:"https://slots.renderwolf.ai/games/1785165208846/design",
    controls:[
      {tag:"button",label:"Toggle sidebar"},
      {tag:"a",label:"Design"},
      {tag:"a",label:"Download"},
      {tag:"a",label:"Publish"},
    ]};
  const ready={...shell,controls:[...shell.controls,
    {tag:"a",label:"Add Element"},{tag:"a",label:"The Yeti Guardian"}]};
  assert.equal(hasDesignWorkspaceControls(shell),false);
  assert.equal(isUsefulObservation(shell,{requireDesignWorkspace:true}),false);
  assert.equal(hasDesignWorkspaceControls(ready),true);
  let calls=0;
  const result=await waitForRenderwolfUI({waitForTimeout:async()=>{}},
    async()=>++calls<4?shell:ready,
    {attempts:5,intervalMs:0,requireDesignWorkspace:true});
  assert.equal(result.ready,true);
  assert.equal(result.polls,4);
});


test("direct /design route can dismiss existing non-purchasing upgrade offer",()=>{
  const offer={url:"https://slots.renderwolf.ai/games/1785165208846/design",
    context:["Upgrade Required Subscribe to unlock full access"],
    controls:[{tag:"button",label:"Subscribe Now"},{tag:"button",label:"Maybe Later"}]};
  assert.equal(hasDesignWorkspaceControls(offer),true);
  assert.equal(canInspectAction({action:"click",target_id:1},offer.controls[1],offer),true);
  assert.equal(canInspectAction({action:"click",target_id:0},offer.controls[0],offer),false);
  assert.equal(hasDesignWorkspaceControls({...offer,context:["Frost Ascent"]}),false);
});


test("Add Element transition accepts a newly loaded creation wizard, not gallery controls", async()=>{
  const before={url:"https://slots.renderwolf.ai/games/1785165208846/design",
    context:["Frost Ascent","Chat with Lucky"],
    controls:[
      {tag:"a",label:"Add Element"},
      {tag:"a",label:"Design"},
      {tag:"a",label:"The Yeti Guardian"},
      {tag:"button",label:"Toggle sidebar"},
    ]};
  const waiting={...before,url:"https://slots.renderwolf.ai/games/1785165208846/design/create",
    controls:[before.controls[1],before.controls[3]]};
  const wizard={...waiting,context:["Frost Ascent","New Element"],
    controls:[...waiting.controls,
      {tag:"input",placeholder:"Element name"},
      {tag:"button",label:"Generate Image"}]};
  assert.equal(hasFreshInterface(waiting,before),false);
  assert.equal(isUsefulObservation(waiting,{requireFreshFrom:before,requireDesignWorkspace:true}),false);
  assert.equal(hasDesignWorkspaceControls(wizard),false); // old gallery check won't pass
  assert.equal(hasFreshInterface(wizard,before),true);
  assert.equal(isUsefulObservation(wizard,{requireFreshFrom:before,requireDesignWorkspace:true}),true);
  let polled=0;
  const found=await waitForRenderwolfUI({waitForTimeout:async()=>{}},
    async()=>++polled<4?waiting:wizard,{
      attempts:5,intervalMs:0,requireFreshFrom:before,requireDesignWorkspace:true,
    });
  assert.equal(found.ready,true);
  assert.equal(found.polls,4);
});

test("Add Element transition does not mistake unchanged global sidebar for a new form",async()=>{
  const old={url:"https://slots.renderwolf.ai/games/1785165208846/design",
    context:["Frost Ascent"],
    controls:[{tag:"a",label:"Design"},{tag:"button",label:"Toggle sidebar"}]};
  const stale={...old,url:"https://slots.renderwolf.ai/games/1785165208846/design/create"};
  assert.equal(hasFreshInterface(stale,old),false);
  const result=await waitForRenderwolfUI({waitForTimeout:async()=>{}},async()=>stale,
    {attempts:3,intervalMs:0,requireFreshFrom:old,requireDesignWorkspace:true});
  assert.equal(result.ready,false);
});
