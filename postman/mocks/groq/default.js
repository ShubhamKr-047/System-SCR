// Local contract simulation, based on Groq's chat completions REST documentation.
// Responses are fixtures for client verification, not chess-quality judgments.
const http = require("http");
http.createServer(async (req, res) => {
  const send = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
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
      body.response_format.json_schema.schema.required.length !== 2 || body.response_format.json_schema.schema.additionalProperties !== false) {
    return send(400, { error: { message: "Invalid coaching contract", type: "invalid_request_error" } });
  }
  const schema = body.response_format.json_schema.schema;
  if (!schema.required.includes('explanation') || !schema.required.includes('claimIds') || schema.properties.explanation?.type !== 'string' || schema.properties.claimIds?.type !== 'array') {
    return send(400, {error:{message:'Expected concise evidence contract'}});
  }
  if (key === "test-delayed") await new Promise(resolve => setTimeout(resolve, 2000));
  if (key === "test-timeout") await new Promise(resolve => setTimeout(resolve, 27000));
  const move = context.played.san;
  const coaching = {
    explanation: `Explanation for ${move}: the supplied evidence does not establish a specific positional purpose.`,
    claimIds:['played']
  };
  if (key === 'test-long') coaching.explanation = 'Unsupported filler. '.repeat(60);
  if (key === 'test-html') coaching.explanation = '<img src=x onerror="window.aiInjected=true">';
  if (key === 'test-malformed') coaching.explanation = {invalid:true};
  if (key === "test-blocked") return send(200, { choices: [{ message: { role: "assistant", content: null, refusal: "Simulated refusal" }, finish_reason: "stop" }] });
  return send(200, { choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(coaching) }, finish_reason: "stop" }] });
}).listen(process.env.PORT || 4902);
