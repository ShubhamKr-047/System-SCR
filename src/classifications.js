import { classifyEvidence, sacrificeCandidates, gameAccuracy } from "./move-quality.js";

export const CLASSIFICATIONS = {
  brilliant: {
    key: "brilliant",
    name: "Brilliant",
    sign: "!!",
    color: "#1baca6",
    textColor: "#ffffff",
    description: "A brilliant move! You found a sharp idea, offering a sound piece sacrifice with verified compensation.",
    badgeClass: "badge-brilliant"
  },
  great: {
    key: "great",
    name: "Great Move",
    sign: "!",
    color: "#5c8bb0",
    textColor: "#ffffff",
    description: "A great find! You found the critical move to keep the upper hand or turn the tide.",
    badgeClass: "badge-great"
  },
  best: {
    key: "best",
    name: "Best Move",
    sign: "★",
    color: "#81b64c",
    textColor: "#ffffff",
    description: "The engine's top choice or an equivalent continuation.",
    badgeClass: "badge-best"
  },
  excellent: {
    key: "excellent",
    name: "Excellent",
    sign: "✓",
    color: "#96bc4b",
    textColor: "#ffffff",
    description: "Almost as strong as the best engine continuation in this position.",
    badgeClass: "badge-excellent"
  },
  good: {
    key: "good",
    name: "Good",
    sign: "✓",
    color: "#97af8d",
    textColor: "#ffffff",
    description: "A playable continuation with a small concession compared with the best move.",
    badgeClass: "badge-good"
  },
  book: {
    key: "book",
    name: "Book Move",
    sign: "📖",
    color: "#bca377",
    textColor: "#ffffff",
    description: "A recognized opening line with no significant engine-confirmed concession.",
    badgeClass: "badge-book"
  },
  inaccuracy: {
    key: "inaccuracy",
    name: "Inaccuracy",
    sign: "?!",
    color: "#f7c631",
    textColor: "#201802",
    description: "An inaccuracy. It lets some advantage slip, though the position remains playable.",
    badgeClass: "badge-inaccuracy"
  },
  mistake: {
    key: "mistake",
    name: "Mistake",
    sign: "?",
    color: "#fa8c35",
    textColor: "#ffffff",
    description: "A mistake. This gave your opponent a clear opportunity to improve their chances.",
    badgeClass: "badge-mistake"
  },
  miss: {
    key: "miss",
    name: "Miss",
    sign: "✕",
    color: "#db4a38",
    textColor: "#ffffff",
    description: "A missed win or tactical opportunity. You had a winning continuation but overlooked it.",
    badgeClass: "badge-miss"
  },
  blunder: {
    key: "blunder",
    name: "Blunder",
    sign: "??",
    color: "#fa412d",
    textColor: "#ffffff",
    description: "A serious blunder! This severely damages your position or drops decisive material.",
    badgeClass: "badge-blunder"
  },
  forced: {
    key: "forced",
    name: "Forced",
    sign: "□",
    color: "#7d8c83",
    textColor: "#ffffff",
    description: "The only legal move available in the position.",
    badgeClass: "badge-forced"
  }
};

// Keep the public label definitions stable; decision evidence lives in move-quality.
export const isMaterialSacrifice = (before, after, move) => sacrificeCandidates(before, after, move).length > 0;
export const classifyMove = evidence => CLASSIFICATIONS[classifyEvidence(evidence).key];
export const calculateAccuracy = gameAccuracy;

/**
 * Predict / Estimate player rating (performance Elo) based on accuracy, ACPL, and move quality
 */
export function calculateEstimatedRating(moves, accuracy, headerElo = null) {
  if (!moves || moves.length === 0) return 0;

  const count = moves.length;
  const totalCpLoss = moves.reduce((sum, m) => sum + (m.lossCp || 0), 0);
  const acpl = totalCpLoss / count;

  // 1. Base Elo curve mapped smoothly from CAPS accuracy
  let baseElo = 0;
  if (accuracy <= 50) {
    baseElo = 300 + (accuracy / 50) * 400; // 300 - 700
  } else if (accuracy <= 65) {
    baseElo = 700 + ((accuracy - 50) / 15) * 350; // 700 - 1050
  } else if (accuracy <= 78) {
    baseElo = 1050 + ((accuracy - 65) / 13) * 400; // 1050 - 1450
  } else if (accuracy <= 88) {
    baseElo = 1450 + ((accuracy - 78) / 10) * 450; // 1450 - 1900
  } else if (accuracy <= 94) {
    baseElo = 1900 + ((accuracy - 88) / 6) * 400; // 1900 - 2300
  } else if (accuracy <= 97) {
    baseElo = 2300 + ((accuracy - 94) / 3) * 350; // 2300 - 2650
  } else {
    baseElo = 2650 + ((accuracy - 97) / 3) * 350; // 2650 - 3000
  }

  // 2. ACPL influence
  let acplElo = 2850 - (acpl * 17.5);
  acplElo = Math.max(350, Math.min(2950, acplElo));

  // Blend accuracy (70%) and ACPL (30%)
  let est = (baseElo * 0.70) + (acplElo * 0.30);

  // 3. Move classification modifiers
  const brilliants = moves.filter(m => m?.key === "brilliant").length;
  const greats = moves.filter(m => m?.key === "great").length;
  const bests = moves.filter(m => m?.key === "best").length;
  const blunders = moves.filter(m => m?.key === "blunder").length;
  const mistakes = moves.filter(m => m?.key === "mistake").length;
  const misses = moves.filter(m => m?.key === "miss").length;

  est += (brilliants * 65);
  est += (greats * 30);
  est += (bests * 10);
  est -= (blunders * 75);
  est -= (mistakes * 35);
  est -= (misses * 45);

  // 4. If PGN header has a rating, blend slightly (75% performance, 25% anchor)
  if (headerElo) {
    const parsed = parseInt(headerElo, 10);
    if (!isNaN(parsed) && parsed > 200 && parsed < 3500) {
      est = (est * 0.75) + (parsed * 0.25);
    }
  }

  // Confidence scaling for short games (< 8 moves)
  if (count < 8) {
    const weight = count / 8;
    est = (est * weight) + (1200 * (1 - weight));
  }

  // Bound between 350 and 3100 and round to nearest 25
  const rounded = Math.round(Math.max(350, Math.min(3100, est)) / 25) * 25;
  return rounded;
}
