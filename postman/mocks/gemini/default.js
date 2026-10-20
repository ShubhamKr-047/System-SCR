// Local contract simulation, based on Google's generateContent REST documentation.
// Responses are fixtures for client verification, not chess-quality judgments.
const http = require("http");
http.createServer(async (req, res) => {
  const send = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (req.url === "/health") return send(200, { ready: true });
  if (req.method !== "POST" || !/^\/v1beta\/models\/gemini-3\.8-flash:generateContent$/.test(req.url)) {
    return send(501, { error: { code: 501, status: "UNIMPLEMENTED", message: "Endpoint not modeled" } });
  }
  const key = req.headers["x-goog-api-key"];
  const status = key === "test-quota" ? 429 : key === "test-invalid" ? 403 : key === "test-unavailable" ? 503 : 0;
  if (status) return send(status, { error: { code: status, status: status === 429 ? "RESOURCE_EXHAUSTED" : status === 403 ? "PERMISSION_DENIED" : "UNAVAILABLE", message: "Simulated provider error" } });
  const body = req.body;
  let context;
  try { context = JSON.parse(body.contents[0].parts[0].text); } catch {}
  if (!key?.startsWith("test-") || !context?.before?.fen || !context?.after?.fen ||
      !context.stockfish || !body?.systemInstruction?.parts?.[0]?.text ||
      body.generationConfig?.responseFormat?.text?.mimeType !== "APPLICATION_JSON" ||
      body.generationConfig.responseFormat.text.schema.required.length !== 6) {
    return send(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "Invalid coaching contract" } });
  }
  if (key === "test-delayed") await new Promise(resolve => setTimeout(resolve, 2000));
  if (key === "test-timeout") await new Promise(resolve => setTimeout(resolve, 27000));
  const move = context.played.san;
  const coaching = {
    why: `Explanation for ${move}: the ${context.played.piece} moved from ${context.played.from} to ${context.played.to}.`,
    tactical: "The supplied engine line establishes the available replies; no additional forced tactic is assumed.",
    positional: `Consider the activity of the ${context.played.piece} on ${context.played.to} and king safety before choosing a plan.`,
    recommendation: `Stockfish recommends ${context.stockfish.recommendedMove || "no move in this terminal position"}. Compare its supplied continuation with the move played.`,
    tip: "Check your opponent's best reply before committing to the move.",
    concept: "Piece activity"
  };
  if (key === "test-long") {
    await new Promise(resolve => setTimeout(resolve, 500));
    const paragraph = "The knight supports the central pawn and helps protect the king while the opponent prepares a reply. ";
    for (const field of ["why", "tactical", "positional", "recommendation", "tip"]) coaching[field] = paragraph.repeat(10);
    coaching.positional += " LongToken" + "x".repeat(250);
    coaching.concept = "A detailed explanation of central pawn tension and piece activity in this position";
  }
  if (key === "test-html") coaching.why = '<img src=x onerror="window.aiInjected=true">';
  if (key === "test-malformed") coaching.tactical = { invalid: true };
  if (key === "test-blocked") return send(200, { promptFeedback: { blockReason: "SAFETY" } });
  return send(200, { candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(coaching) }] }, finishReason: "STOP" }] });
}).listen(process.env.PORT || 4901);
