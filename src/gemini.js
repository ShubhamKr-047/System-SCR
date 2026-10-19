/**
 * Gemini AI Coaching Module
 * Generates context-aware coaching tips using Google's Gemini API.
 */

const STORAGE_KEY = "zen-chess-gemini-key";
const CACHE = new Map();

export function getApiKey() {
  return localStorage.getItem(STORAGE_KEY) || "";
}

export function setApiKey(key) {
  if (key && key.trim()) {
    localStorage.setItem(STORAGE_KEY, key.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function hasApiKey() {
  return Boolean(getApiKey());
}

export function getCachedCoaching(result, fen) {
  if (!result) return null;
  const cacheKey = `${fen || result.beforeFen || ""}_${result.san}_${result.key}`;
  return CACHE.get(cacheKey) || null;
}

/**
 * Build a concise chess coaching prompt from the move result data.
 */
function buildPrompt(result, fen) {
  const pieceNames = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  const isWhite = result.moveColor === "w" || (result.ply !== undefined ? result.ply % 2 === 0 : false);
  const colorName = isWhite ? "White" : "Black";
  const pieceName = pieceNames[result.playedPiece?.toLowerCase()] || "piece";
  const capturedName = result.capturedPiece ? (pieceNames[result.capturedPiece?.toLowerCase()] || "piece") : null;

  const moveDesc = capturedName
    ? `${colorName} played ${result.san} (${pieceName} captures ${capturedName})`
    : `${colorName} played ${result.san} (${pieceName} move)`;

  const evalBefore = result.beforeWhite !== undefined ? result.beforeWhite.toFixed(2) : "unknown";
  const evalAfter = result.afterWhite !== undefined ? result.afterWhite.toFixed(2) : "unknown";
  const lossStr = result.lossCp !== undefined ? `${(result.lossCp / 100).toFixed(2)} pawns` : "unknown";

  const bestMove = result.bestSan || result.pv?.split(" ")[0] || "unknown";
  const pvLine = result.pv || "not available";
  const punishMove = result.punishSan || "none reported";
  const punishPvLine = result.punishPv || "none reported";

  return `You are an expert grandmaster chess coach analyzing a single move from a game. Provide a clear, natural, and deeply instructive tactical explanation for the player.

Position FEN: ${fen || result.beforeFen || "not available"}
Move played: ${result.moveNo} ${moveDesc}
Classification: ${result.label} (${result.sign})
Engine's recommended move for ${colorName}: ${bestMove} (${pvLine})
Opponent's best punishment response: ${punishMove} (${punishPvLine})
${result.isSacrifice ? "Tactical note: This move involved a material sacrifice." : ""}

STRICT COACHING GUIDELINES:
1. NEVER cite robotic numbers like "X pawns of equity" or "centipawn loss". Real chess coaches speak in concrete chess terms!
2. If this move is a blunder or mistake, explain CONCRETELY:
   - What piece was left undefended or what square was weakened?
   - How can the opponent punish it immediately using ${punishMove}?
   - What did the player need to play instead (${bestMove}) and why?
3. If this move is a miss, explain what winning tactic, mate, or capture (${bestMove}) was overlooked.
4. If this move is brilliant or great, explain what makes the tactical idea so lethal and why the opponent cannot defend against it.
5. Keep explanations direct, engaging, and easy to visualize.

Respond in JSON with EXACTLY this structure:
{
  "why": "2-3 sentences explaining concretely what happened on the board. Mention the exact pieces, squares, and how the opponent can punish this with ${punishMove} (or why ${bestMove} was necessary).",
  "tip": "1-2 sentences of actionable coaching advice or mental checklist for the player to avoid this pattern or spot this motif in future games.",
  "concept": "A 1-3 word chess motif tag (e.g. 'Hanging Piece', 'Back-Rank Mate', 'Tactical Fork', 'King Exposure', 'Overworked Piece', 'Pin', 'Missed Win')"
}

Respond ONLY with valid JSON. Do not include markdown code fences, triple backticks, or any conversational preamble.`;
}

/**
 * Call Gemini API to generate coaching feedback.
 * Returns { why, tip, concept } or null on failure.
 */
export async function generateCoaching(result, fen) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const cacheKey = `${fen || result.beforeFen || ""}_${result.san}_${result.key}`;
  if (CACHE.has(cacheKey)) {
    return CACHE.get(cacheKey);
  }

  const prompt = buildPrompt(result, fen);
  const models = ["gemini-2.0-flash", "gemini-1.5-flash"];

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 350,
              topP: 0.8,
            }
          })
        }
      );

      if (!res.ok) {
        if (res.status === 404 && model === "gemini-2.0-flash") {
          continue;
        }
        const errText = await res.text().catch(() => "");
        console.warn(`Gemini API error (${model}) ${res.status}:`, errText);
        return null;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;

      // Extract JSON cleanly
      let cleaned = text.trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleaned = jsonMatch[0];
      }
      const parsed = JSON.parse(cleaned);

      const coaching = {
        why: parsed.why || null,
        tip: parsed.tip || null,
        concept: parsed.concept || null,
      };

      CACHE.set(cacheKey, coaching);
      return coaching;
    } catch (e) {
      console.warn(`Gemini attempt with ${model} failed:`, e);
      if (model === "gemini-2.0-flash") continue;
      return null;
    }
  }

  return null;
}
