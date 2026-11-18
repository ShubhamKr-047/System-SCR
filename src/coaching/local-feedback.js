import { buildExplanationEvidence } from './evidence.js';
export function conciseLocalFeedback(result) {
  try {
    const e = buildExplanationEvidence(result);
    if (e.localText) return e.localText;
    if (result.key === 'forced') return 'This was the only legal move. The continuation shows the resulting position.';
    if (result.key === 'book') return 'This follows a known opening line. Its purpose still depends on the position.';
    const pressure = e.facts.find(f=>f.id==='rook-pressure');
    if (pressure) return pressure.text + '. ' + (e.facts.find(f=>f.id==='capture-comparison' || f.id==='equal-exchange')?.text || 'The continuation illustrates the resulting pressure.') + '.';
    const payoff = e.facts.find(f=>f.id.startsWith('payoff-'));
    if (payoff) return payoff.text;
    const reply = e.supportingLines.find(l=>l.id==='reply-line');
    const alt = e.supportingLines.find(l=>l.id==='alternative-line');
    if (['blunder','mistake','miss','inaccuracy'].includes(result.key))
      return `${alt && alt.moves[0].san !== e.played.san ? `The engine prefers ${alt.moves[0].san} over ${e.played.san}` : `The engine flags ${e.played.san}`}. ${reply ? `Its reply line begins ${reply.moves.slice(0,4).map(m=>m.san).join(' ')}.` : 'No verified reply line is available.'} A specific cause is not established by these lines alone.`;
    return e.facts.find(f=>f.id.startsWith('relation-'))?.text || 'The move has been evaluated locally. A specific strategic purpose has not yet been established.';
  } catch { return 'There is not enough verified evidence to explain this move.'; }
}
