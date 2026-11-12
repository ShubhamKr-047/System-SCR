// Public game-export fixtures based on Lichess's official OpenAPI contract.
const http = require('http');
let finished = false;
http.createServer((req,res) => {
  const send = (code, body) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return send(200,{ready:true});
  if (url.pathname === '/control/reset') { finished = false; return send(200,{ok:true}); }
  if (url.pathname === '/control/finish') { finished = true; return send(200,{ok:true}); }
  const id = url.pathname.match(/^\/game\/export\/([a-zA-Z0-9]{8})$/)?.[1];
  if (req.method !== 'GET' || !id) return send(501,{error:'Not modeled'});
  if (req.headers.accept !== 'application/json' || req.headers.authorization) return send(400,{error:'Contract mismatch'});
  if (id === 'gone0001') return send(404,{error:'Not found'});
  if (id === 'rate0001') return send(429,{error:'Rate limit'});
  if (id === 'oops0001') return send(503,{error:'Unavailable'});
  if (id === 'slow0001') return setTimeout(()=>send(200,{}),11000);
  const active = id === 'live0001' && !finished;
  return send(200,{id,variant:id === 'vari0001' ? 'antichess' : 'standard',status:active ? 'started' : id === 'abor0001' ? 'aborted' : 'mate',
    players:{white:{user:{name:'WhiteFixture'}},black:{user:{name:'BlackFixture'}}},
    ...(url.searchParams.get('pgnInJson') === 'true' ? {pgn:id === 'badp0001' ? '[Result "*"]\n\n1. e4 *' : '[White "WhiteFixture"]\n[Black "BlackFixture"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1'} : {})});
}).listen(process.env.PORT || 4931);
