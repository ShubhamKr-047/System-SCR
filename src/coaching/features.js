import { Chess } from 'chess.js';
const names = {p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'};
const values = {p:1,n:3,b:3,r:5,q:9,k:0};
export function material(fen, color) {
  return new Chess(fen).board().flat().reduce((n,p) => n + (p ? values[p.type] * (p.color === color ? 1 : -1) : 0), 0);
}
export function boardFeatures(fen, color) {
  const board = new Chess(fen), pieces = board.board().flat().filter(Boolean);
  const own = pieces.filter(p=>p.color === color), enemy = pieces.filter(p=>p.color !== color);
  const features = [];
  const add = (id,text) => features.push({id,type:id.split('-')[0],text,certainty:'direct',origin:'local',scope:fen});
  for (const piece of own) {
    const center=['d4','e4','d5','e5'].filter(square=>board.attackers(square,color).includes(piece.square));
    if(center.length) add(`center-${piece.square}`,`The ${names[piece.type]} on ${piece.square} geometrically controls ${center.join(', ')} in the center. Legal mobility may be restricted by pins.`);
    const targets = enemy.filter(p => board.attackers(p.square,color).includes(piece.square));
    if(targets.length >= 2 && targets.filter(p => p.type !== 'p').length >= 2)
      add(`fork-${piece.square}`,`The ${names[piece.type]} on ${piece.square} geometrically attacks ${targets.map(p=>`${names[p.type]} on ${p.square}`).join(' and ')}. This does not prove a material gain; pinned attackers may not legally capture.`);
    if (piece.type === 'r') {
      const file = piece.square[0], pawns = pieces.filter(p=>p.type === 'p' && p.square[0] === file);
      if (!pawns.length) add(`file-${piece.square}`,`The rook on ${piece.square} occupies an open ${file}-file.`);
    }
    if(piece.type==='k') {
      const file=piece.square.charCodeAt(0),rank=+piece.square[1]+(color==='w'?1:-1);
      const shield=own.filter(p=>p.type==='p' && +p.square[1]===rank && Math.abs(p.square.charCodeAt(0)-file)<=1);
      if(!shield.length) add(`shield-${piece.square}`,`There is no friendly pawn immediately ahead of the king on ${piece.square} on its file or neighboring files. This geometry alone does not establish a mating attack.`);
    }
    if(piece.type!=='k' && piece.type!=='p') {
      const defended=own.filter(p=>p!==piece && values[p.type]>=3 && board.attackers(p.square,color).includes(piece.square));
      if(defended.length>=2) add(`coordination-${piece.square}`,`The ${names[piece.type]} on ${piece.square} defends ${defended.map(p=>`${names[p.type]} on ${p.square}`).join(' and ')}. Multiple defensive duties alone do not prove an overload.`);
    }
    if (piece.type === 'p') {
      const file = piece.square.charCodeAt(0), rank = +piece.square[1];
      if (!enemy.some(p=>p.type === 'p' && Math.abs(p.square.charCodeAt(0)-file)<=1 && (color === 'w' ? +p.square[1]>rank : +p.square[1]<rank)))
        add(`passed-${piece.square}`,`The pawn on ${piece.square} is passed: no opposing pawn remains ahead on its file or adjacent files. This does not prove it can promote.`);
      if (own.some(p=>p !== piece && p.type === 'p' && p.square[0]===piece.square[0]))
        add(`doubled-${piece.square}`,`The pawn on ${piece.square} shares its file with another friendly pawn.`);
      if (!own.some(p=>p.type==='p' && Math.abs(p.square.charCodeAt(0)-file)===1))
        add(`isolated-${piece.square}`,`The pawn on ${piece.square} has no friendly pawn on an adjacent file.`);
    }
    if(['b','r','q'].includes(piece.type)) {
      const directions=piece.type==='b'?[[1,1],[1,-1],[-1,1],[-1,-1]]:piece.type==='r'?[[1,0],[-1,0],[0,1],[0,-1]]:[[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
      let clearSquares=0;
      for(const [dx,dy] of directions) {
        const hits=[];
        for(let x=piece.square.charCodeAt(0)-97+dx,y=+piece.square[1]-1+dy;x>=0&&x<8&&y>=0&&y<8;x+=dx,y+=dy) {
          const square=String.fromCharCode(97+x)+(y+1),p=board.get(square);
          if(!hits.length && !p) clearSquares++;
          if(p) hits.push({...p,square});
          if(hits.length===2) break;
        }
        if(hits.length===2 && hits.every(p=>p.color!==color)) {
          if(hits[1].type==='k') add(`pin-${piece.square}-${hits[0].square}`,`The ${names[piece.type]} on ${piece.square} geometrically pins the ${names[hits[0].type]} on ${hits[0].square} to the king on ${hits[1].square}. This does not prove the pinned piece can be won.`);
          else if(values[hits[0].type]>values[hits[1].type] || hits[0].type==='k') add(`skewer-${piece.square}`,`The ${names[piece.type]} on ${piece.square} is aligned with the ${names[hits[0].type]} on ${hits[0].square} and ${names[hits[1].type]} behind it on ${hits[1].square}. Legal defenses determine whether the alignment wins material.`);
        }
      }
      if(clearSquares) add(`activity-${piece.square}`,`The ${names[piece.type]} on ${piece.square} has ${clearSquares} unobstructed empty squares along its rays. This measures geometry, not legal mobility or a forced gain.`);
    }
  }
  return features;
}
export function pieceMap(fen) {
  return new Chess(fen).board().flat().filter(Boolean).map(p=>`${p.color}:${p.type}:${p.square}`).join(' ');
}
