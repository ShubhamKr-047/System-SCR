import test from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from 'chess.js';
import {gameEnding} from '../src/game-ending.js';

test('mate comes from the board, including games without termination headers',()=>{
  const chess=new Chess(); chess.loadPgn('1. f3 e5 2. g4 Qh4# 0-1');
  assert.deepEqual(gameEnding(chess),{loser:'w',kind:'checkmate',label:'Checkmate'});
  assert.equal(gameEnding(chess,{preview:true}),null);
});

test('resignation and time forfeits use the result, not the side to move',()=>{
  for(const [Result,loser] of [['1-0','b'],['0-1','w']]) {
    for(const Termination of ['White won by resignation','Black resigned']) {
      assert.equal(gameEnding(new Chess(),{headers:{Result,Termination},finalOriginal:true}).loser,loser);
    }
    for(const Termination of ['Time forfeit','Black won on time','White won by timeout']) {
      assert.equal(gameEnding(new Chess(),{headers:{Result,Termination},finalOriginal:true}).kind,'timeout');
    }
  }
});

test('no ending is invented on earlier positions, variations, draws or unspecified wins',()=>{
  const headers={Result:'1-0',Termination:'Black resigned'};
  assert.equal(gameEnding(new Chess(),{headers}),null);
  assert.equal(gameEnding(new Chess(),{headers,finalOriginal:true,preview:true}),null);
  for(const Result of ['*','1/2-1/2','?']) assert.equal(gameEnding(new Chess(),{headers:{...headers,Result},finalOriginal:true}),null);
  assert.equal(gameEnding(new Chess(),{headers:{Result:'1-0',Termination:'normal'},finalOriginal:true}),null);
});
