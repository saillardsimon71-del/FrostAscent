import test from "node:test";
import assert from "node:assert/strict";
import { parseAgentArgs, validateAgentAction, classifyControl,
  publicPageUrl, readLocalDeepSeekKey, redactForModel } from "./agent-core.mjs";
import { parseDeepSeekAction, requestDeepSeekAction, ACT_TOOL } from "./deepseek-client.mjs";

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
test("agent command caps requests, tokens and host", () => {
  assert.equal(parseAgentArgs([...basic, "--max-steps", "4"]).maxSteps,4);
  assert.throws(() => parseAgentArgs([...basic, "--max-steps", "100"]), /maxSteps/);
  assert.throws(() => parseAgentArgs([...basic, "--token-budget", "999999"]), /tokenBudget/);
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
  assert.throws(()=>validateAgentAction({action:"fill",target_id:1,value:"secret"},o),/credential/);
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
