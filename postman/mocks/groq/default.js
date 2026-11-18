// Local contract simulation, based on Groq's chat completions REST documentation.
// Responses are fixtures for client verification, not chess-quality judgments.
const http = require("http");
http.createServer(async (req, res) => {
  const send = (status, data, limits = {}) => {
    const headers = { ...(status === 429 ? {"Retry-After":"10"} : {}), ...limits };
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Expose-Headers": Object.keys(headers).join(", "),
      ...headers
    });
    res.end(JSON.stringify(data));
  };
  if (req.url === "/health") return send(200, { ready: true });
  if (req.method !== "POST" || req.url !== "/openai/v1/chat/completions") {
    return send(501, { error: { message: "Endpoint not modeled", type: "invalid_request_error" } });
  }
  const key = req.headers.authorization?.replace(/^Bearer /, "");
  const status = key === "test-quota" ? 429 : key === "test-invalid" ? 401 : key === "test-unavailable" ? 503 : 0;
  if (status) return send(status, { error: { message: "Simulated provider error", type: status === 429 ? "rate_limit_error" : status === 401 ? "authentication_error" : "server_error" } });
  const body = req.body;
  let context;
  try { context = JSON.parse(body.messages[1].content); } catch {}
  if (!key?.startsWith("test-") || !context?.positions?.before || !context?.positions?.after ||
      !context.facts || body?.model !== "openai/gpt-oss-120b" || body.messages[0]?.role !== "system" ||
      body.response_format?.type !== "json_schema" || body.response_format.json_schema.strict !== true ||
      body.response_format.json_schema.schema.required.length !== 3 || body.response_format.json_schema.schema.additionalProperties !== false) {
    return send(400, { error: { message: "Invalid coaching contract", type: "invalid_request_error" } });
  }
  const schema = body.response_format.json_schema.schema;
  if (!schema.required.includes('summary') || schema.properties.summary?.type !== 'object' || context.explanationOptions) return send(400,{error:{message:'Expected natural coaching contract'}});
  if (key === "test-delayed" || key === "test-cross-tab") await new Promise(resolve => setTimeout(resolve, key === 'test-cross-tab' ? 8000 : 2000));
  if (key === "test-timeout") await new Promise(resolve => setTimeout(resolve, 27000));
  const coaching = {
    summary:{text:`${context.played.side === 'w' ? 'White' : 'Black'} played ${context.played.san}, moving the ${context.played.piece} from ${context.played.from} to ${context.played.to}. The available evidence does not establish a unique strategic reason.`,evidenceIds:['played']},
    comparison:null,claims:[]
  };
  const quotaFixture = key === 'test-consecutive';
  const usage = quotaFixture
    ? {prompt_tokens:2150,completion_tokens:370,total_tokens:2520,prompt_tokens_details:{cached_tokens:120}}
    : {prompt_tokens:240,completion_tokens:60,total_tokens:300};
  const limits = quotaFixture ? {
    "x-ratelimit-limit-tokens":"8000", "x-ratelimit-remaining-tokens":"4800", "x-ratelimit-reset-tokens":"30s",
    "x-ratelimit-limit-requests":"1000", "x-ratelimit-remaining-requests":"990", "x-ratelimit-reset-requests":"20h"
  } : {};
  if (key === 'test-hallucination') coaching.summary.text = 'The knight forks the queen and bishop, winning material.';
  if (key === 'test-long') coaching.summary.text = 'Unsupported filler. '.repeat(150);
  if (key === 'test-html') coaching.summary.text = '<img src=x onerror="window.aiInjected=true">';
  if (key === 'test-malformed') coaching.summary.text = {invalid:true};
  if (key === "test-blocked") return send(200, { choices: [{ message: { role: "assistant", content: null, refusal: "Simulated refusal" }, finish_reason: key === "test-truncated" ? "length" : "stop" }], usage }, limits);
  return send(200, { choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(coaching) }, finish_reason: key === "test-truncated" ? "length" : "stop" }], usage }, limits);
}).listen(process.env.PORT || 4902);
