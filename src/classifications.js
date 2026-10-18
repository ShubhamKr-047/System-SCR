import { Chess } from "chess.js";

export const CLASSIFICATIONS = {
  brilliant: {
    key: "brilliant",
    name: "Brilliant",
    sign: "!!",
    color: "#1baca6",
    textColor: "#ffffff",
    description: "A brilliant move! You found a sharp idea, sacrificing material for a decisive advantage.",
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
    description: "The engine’s top choice. This move is objectively the strongest continuation.",
    badgeClass: "badge-best"
  },
  excellent: {
    key: "excellent",
    name: "Excellent",
    sign: "✓",
    color: "#96bc4b",
    textColor: "#ffffff",
    description: "An excellent move! Almost as strong as the top engine line, maintaining full control.",
    badgeClass: "badge-excellent"
  },
  good: {
    key: "good",
    name: "Good",
    sign: "✓",
    color: "#97af8d",
    textColor: "#ffffff",
    description: "A sound, solid move that keeps the position healthy.",
    badgeClass: "badge-good"
  },
  book: {
    key: "book",
    name: "Book Move",
    sign: "📖",
    color: "#bca377",
    textColor: "#ffffff",
    description: "Standard opening book theory. You’re following established grandmaster principles.",
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

const PIECE_VALS = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/**
 * Check if the played move involves sacrificing a minor or major piece
 */
export function isMaterialSacrifice(beforeFen, afterFen, playedMove) {
  try {
    if (!beforeFen || !afterFen || !playedMove) return false;
    const piece = playedMove.piece; // 'p', 'n', 'b', 'r', 'q', 'k'
    
    const cAfter = new Chess(afterFen);
    const opponentMoves = cAfter.moves({ verbose: true });
    
    // Check 1: The played piece itself landed on an attacked square or was left en prise
    const targetSq = playedMove.to;
    const directAttackers = opponentMoves.filter(m => m.to === targetSq);
    
    if (directAttackers.length > 0 && piece !== 'k' && piece !== 'p') {
      const pieceVal = PIECE_VALS[piece] || 3;
      const capturedVal = playedMove.captured ? (PIECE_VALS[playedMove.captured] || 1) : 0;
      if (pieceVal > capturedVal) {
        for (const atk of directAttackers) {
          const cSim = new Chess(afterFen);
          try {
            cSim.move(atk);
            const moverRecaptures = cSim.moves({ verbose: true }).filter(m => m.to === targetSq);
            if (moverRecaptures.length === 0) {
              return true; // Undefended piece sacrificed
            }
            const atkVal = PIECE_VALS[atk.piece] || 1;
            if (pieceVal - atkVal >= 2) {
              return true; // Exchange or Queen sacrifice
            }
          } catch {
            // Ignore illegal simulation move
          }
        }
      }
    }

    // Check 2: Player moved a piece, leaving another major/minor piece hanging
    const majorMinorCaptures = opponentMoves.filter(m => m.captured && (m.captured === 'n' || m.captured === 'b' || m.captured === 'r' || m.captured === 'q'));
    for (const oppCap of majorMinorCaptures) {
      if (oppCap.to === targetSq) continue;
      const cSim = new Chess(afterFen);
      try {
        cSim.move(oppCap);
        const moverRecaptures = cSim.moves({ verbose: true }).filter(m => m.to === oppCap.to);
        if (moverRecaptures.length === 0) {
          return true;
        }
        const capVal = PIECE_VALS[oppCap.captured] || 3;
        const oppPieceVal = PIECE_VALS[oppCap.piece] || 1;
        if (capVal - oppPieceVal >= 2) {
          return true;
        }
      } catch {
        // Ignore illegal simulation move
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Classify a move given evaluation scores and context
 */
export function classifyMove({
  lossCp,
  ply,
  isBest,
  beforePlayerScore,
  afterPlayerScore,
  legalMovesCount = 10,
  capturedPiece = null,
  playedPiece = null,
  isSacrifice = false
}) {
  // 1. Forced move
  if (legalMovesCount === 1) {
    return CLASSIFICATIONS.forced;
  }

  // 2. Missed Win / Miss:
  // Player had a winning advantage (>= +1.4) and dropped significantly, or missed decisive blow
  const evalDrop = beforePlayerScore - afterPlayerScore;
  const isMiss = beforePlayerScore >= 1.4 && (evalDrop >= 0.8 || afterPlayerScore <= 0.6) && lossCp >= 70;
  if (isMiss) {
    return CLASSIFICATIONS.miss;
  }

  // 3. Blunder: Mate swing or massive advantage loss
  const isMateSwing = (beforePlayerScore > 4 && afterPlayerScore < 0.5) ||
                      (beforePlayerScore > 0 && afterPlayerScore <= -4);

  if (isMateSwing || lossCp >= 240) {
    return CLASSIFICATIONS.blunder;
  }

  // 4. Mistake
  if (lossCp >= 120) {
    return CLASSIFICATIONS.mistake;
  }

  // 5. Inaccuracy
  if (lossCp >= 50) {
    return CLASSIFICATIONS.inaccuracy;
  }

  // 6. Book moves: first 8 plies with minimal loss
  if (ply < 8 && lossCp <= 18) {
    return CLASSIFICATIONS.book;
  }

  // 7. Best, Great, or Brilliant moves
  if (isBest || lossCp <= 12) {
    // Brilliant Move: Material sacrifice with winning/solid evaluation
    if (isSacrifice && ply >= 4 && afterPlayerScore >= -0.2 && lossCp <= 20) {
      return CLASSIFICATIONS.brilliant;
    }

    // Great Move: Critical finding that swings or preserves the game, or sharp tactical blow
    const evalImprovement = afterPlayerScore - beforePlayerScore;
    const isCriticalEscape = beforePlayerScore <= 0.2 && (evalImprovement >= 0.5 || (beforePlayerScore <= -1.0 && evalImprovement >= 0.4));
    const isSharpBreakthrough = beforePlayerScore >= 0.4 && evalImprovement >= 0.7;
    const isLongCalculation = ply >= 4 && (isCriticalEscape || isSharpBreakthrough);

    if (isLongCalculation) {
      return CLASSIFICATIONS.great;
    }

    return CLASSIFICATIONS.best;
  }

  // 8. Excellent
  if (lossCp <= 28) {
    return CLASSIFICATIONS.excellent;
  }

  // 9. Good
  return CLASSIFICATIONS.good;
}

/**
 * Calculate Chess.com / CAPS style accuracy from an array of move losses
 */
export function calculateAccuracy(moves) {
  if (!moves || !moves.length) return 0;
  // CAPS formula approximation: 103.1668 * exp(-0.04354 * cpLoss) - 3.1669
  const scores = moves.map(m => {
    const cp = Math.max(0, m.lossCp || 0);
    const acc = 103.1668 * Math.exp(-0.04354 * (cp / 10)) - 3.1669;
    return Math.max(0, Math.min(100, acc));
  });
  const avg = scores.reduce((sum, v) => sum + v, 0) / scores.length;
  return Math.round(avg * 10) / 10;
}

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
