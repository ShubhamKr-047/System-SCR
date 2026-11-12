// Board truth establishes mate. Non-board endings require explicit PGN metadata
// at the original game's final node; never guess resignation from Result alone.
export function gameEnding(chess, {headers = {}, finalOriginal = false, preview = false} = {}) {
  if (preview) return null;
  if (chess.isCheckmate()) return {loser:chess.turn(), kind:'checkmate', label:'Checkmate'};
  if (chess.isDraw()) return null;
  if (!finalOriginal || !['1-0', '0-1'].includes(headers.Result)) return null;
  const termination = String(headers.Termination || '');
  const loser = headers.Result === '1-0' ? 'b' : 'w';
  if (/\b(?:time[ -]?out|time forfeit(?:ure)?|on time|out of time|time expired|time ran out)\b/i.test(termination)) {
    return {loser, kind:'timeout', label:'Lost on time'};
  }
  if (/\bresign(?:ation|ed|s)?\b/i.test(termination)) return {loser, kind:'resignation', label:'Resigned'};
  return null;
}

export const ENDING_ICONS = {
  checkmate: '<span aria-hidden="true">#</span>',
  timeout: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 8v5l3 2M9 2h6M12 2v3"/></svg>',
  resignation: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 21V3m0 1h13l-3 4 3 4H5"/></svg>'
};
