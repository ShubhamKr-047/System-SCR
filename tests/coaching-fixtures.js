import { Chess } from 'chess.js';
function result() {
  const chess = new Chess();
  const beforeFen = chess.fen();
  chess.move("e3");
  return { beforeFen, afterFen: chess.fen(), san: "e3", moveColor: "w", from: "e2", to: "e3", playedPiece: "p",
    beforeWhite: 0.3, afterWhite: 0.1, label: "Good", bestSan: "e4", bestUci: "e2e4", punishSan: "d5",
    engineEvidence: { before: { pv: "e2e4 e7e5 g1f3", moveTime: 250 }, after: { pv: "d7d5 d2d4", moveTime: 250 } } };
}

function queenFixture(extra='') {
  const chess=new Chess(`6k1/6b1/8/8/8/8/${extra || '8'}/3Q2K1 w - - 0 1`);
  const beforeFen=chess.fen();const move=chess.move('Qd4');
  return {beforeFen,afterFen:chess.fen(),san:move.san,moveColor:'w',key:'blunder',label:'Blunder',
    engineEvidence:{after:{pv:'g7d4 g1h2 g8f8'}}};
}
function rookSacrificeFixture(){
  const chess=new Chess('4r3/2q2prk/5Qpp/2p1P3/3p2R1/7R/1PP3PP/6K1 w - - 3 33');
  const beforeFen=chess.fen();chess.move('Rxh6+');
  return {beforeFen,afterFen:chess.fen(),san:'Rxh6+',moveColor:'w',key:'brilliant',label:'Brilliant',
    classificationEvidence:{sacrifice:{verified:true,acceptances:[{capture:'h7h6',piece:'r',search:{pv:'g4h4'}}]}}};
}
const reportedFen='k2r3r/pp1q1pp1/4pn1p/n2p4/P2P1B2/RNP1P3/4QPPP/1R4K1 b - - 0 1';
function reportedPosition(recapture=false) {
  const chess=new Chess(reportedFen);
  if(recapture) chess.move('Nxb3');
  const beforeFen=chess.fen(),move=chess.move(recapture?'Rbxb3':'Nxb3');
  return {beforeFen,afterFen:chess.fen(),san:move.san,moveColor:move.color,key:recapture?'miss':'blunder',
    engineEvidence:{before:{pv:recapture?'a3b3 d8c8 e2b2':'a5c4 b3c5 d7c6'},
      after:{pv:recapture?'f6e4 a4a5 d8c8':'a3b3 d8c8 e2b2'}}};
}
export {result,queenFixture,rookSacrificeFixture,reportedPosition};
