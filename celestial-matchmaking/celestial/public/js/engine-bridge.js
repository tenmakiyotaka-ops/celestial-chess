/**
 * engine-bridge.js — exposes the shared chess engine to the frontend
 * for legal-move preview and SAN replay. The server remains authoritative.
 */
const FILES = 'abcdefgh';
const N_DIRS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const B_DIRS = [[-1,-1],[-1,1],[1,-1],[1,1]];
const R_DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
const K_DIRS = [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];
const onb = (r,c) => r>=0 && r<8 && c>=0 && c<8;
const isWhiteP = p => p === p.toUpperCase();
const idxToAlg = i => FILES[i%8] + (8 - Math.floor(i/8));

function initialState(){
  const b = new Array(64).fill(null);
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'.split('/').forEach((row,r)=>{
    let f=0;
    for (const ch of row){
      if (ch>='1'&&ch<='8') f += +ch; else b[r*8+f++] = ch;
    }
  });
  return { board:b, turn:'w', castle:{K:true,Q:true,k:true,q:true}, ep:-1, half:0, full:1 };
}
function isAttacked(s,t,byWhite){
  const b=s.board, tr=Math.floor(t/8), tc=t%8;
  const pr = byWhite ? tr+1 : tr-1;
  for (let i=-1;i<=1;i+=2){
    const cc=tc+i;
    if (onb(pr,cc)){ const p=b[pr*8+cc]; if (p&&p.toUpperCase()==='P'&&isWhiteP(p)===byWhite) return true; }
  }
  for (const [dr,dc] of N_DIRS){
    const rr=tr+dr, cc=tc+dc;
    if (!onb(rr,cc)) continue;
    const p=b[rr*8+cc];
    if (p&&p.toUpperCase()==='N'&&isWhiteP(p)===byWhite) return true;
  }
  for (const [dr,dc] of K_DIRS){
    const rr=tr+dr, cc=tc+dc;
    if (!onb(rr,cc)) continue;
    const p=b[rr*8+cc];
    if (p&&p.toUpperCase()==='K'&&isWhiteP(p)===byWhite) return true;
  }
  for (const dirs of [B_DIRS,R_DIRS]){
    for (const [dr,dc] of dirs){
      let rr=tr+dr, cc=tc+dc;
      while (onb(rr,cc)){
        const p=b[rr*8+cc];
        if (p){
          const t2=p.toUpperCase();
          if (isWhiteP(p)===byWhite && (t2=== (dirs===B_DIRS?'B':'R') || t2==='Q')) return true;
          break;
        }
        rr+=dr; cc+=dc;
      }
    }
  }
  return false;
}
const findKing=(s,white)=>{ const t=white?'K':'k'; for(let i=0;i<64;i++) if(s.board[i]===t) return i; return -1; };
const inCheck=(s,white)=>{ const k=findKing(s,white); return k<0?false:isAttacked(s,k,!white); };

function pseudoMoves(s){
  const out=[], b=s.board, white=s.turn==='w';
  for (let i=0;i<64;i++){
    const p=b[i]; if(!p||isWhiteP(p)!==white) continue;
    const r=Math.floor(i/8), c=i%8, pu=p.toUpperCase();
    if (pu==='P'){
      const up = white?-1:1, r1=r+up;
      if (onb(r1,c)&&!b[r1*8+c]){
        out.push({from:i,to:r1*8+c});
        if ((white?r===6:r===1)&&!b[(r+2*up)*8+c]) out.push({from:i,to:(r+2*up)*8+c,double:true});
      }
      for (const j of [-1,1]){
        const cc=c+j;
        if (!onb(r1,cc)) continue;
        const t=r1*8+cc;
        if (b[t]&&isWhiteP(b[t])!==white) out.push({from:i,to:t});
        else if (t===s.ep) out.push({from:i,to:t,ep:true});
      }
    } else if (pu==='N'){
      for (const [dr,dc] of N_DIRS){
        const rr=r+dr, cc=c+dc; if(!onb(rr,cc)) continue;
        const t=rr*8+cc; if (b[t]&&isWhiteP(b[t])===white) continue;
        out.push({from:i,to:t});
      }
    } else if (pu==='B'||pu==='R'||pu==='Q'){
      const dirs = pu==='B'?B_DIRS:(pu==='R'?R_DIRS:K_DIRS);
      for (const [dr,dc] of dirs){
        let rr=r+dr, cc=c+dc;
        while (onb(rr,cc)){
          const t=rr*8+cc;
          if (b[t]){ if (isWhiteP(b[t])!==white) out.push({from:i,to:t}); break; }
          out.push({from:i,to:t}); rr+=dr; cc+=dc;
        }
      }
    } else if (pu==='K'){
      for (const [dr,dc] of K_DIRS){
        const rr=r+dr, cc=c+dc; if(!onb(rr,cc)) continue;
        const t=rr*8+cc; if (b[t]&&isWhiteP(b[t])===white) continue;
        out.push({from:i,to:t});
      }
      if (white && i===60 && !isAttacked(s,60,false)){
        if (s.castle.K && !b[61]&&!b[62]&&b[63]==='R' && !isAttacked(s,61,false)&&!isAttacked(s,62,false))
          out.push({from:60,to:62,castle:'K'});
        if (s.castle.Q && !b[59]&&!b[58]&&!b[57]&&b[56]==='R' && !isAttacked(s,59,false)&&!isAttacked(s,58,false))
          out.push({from:60,to:58,castle:'Q'});
      }
      if (!white && i===4 && !isAttacked(s,4,true)){
        if (s.castle.k && !b[5]&&!b[6]&&b[7]==='r' && !isAttacked(s,5,true)&&!isAttacked(s,6,true))
          out.push({from:4,to:6,castle:'k'});
        if (s.castle.q && !b[3]&&!b[2]&&!b[1]&&b[0]==='r' && !isAttacked(s,3,true)&&!isAttacked(s,2,true))
          out.push({from:4,to:2,castle:'q'});
      }
    }
  }
  return out;
}
function makeMove(s,m){
  const b=s.board;
  const u={castle:{...s.castle},ep:s.ep,half:s.half,full:s.full,captured:b[m.to],piece:b[m.from]};
  const p=b[m.from];
  b[m.to]=m.promo?(isWhiteP(p)?m.promo.toUpperCase():m.promo):p;
  b[m.from]=null;
  if (m.ep){ const cap=m.to+(isWhiteP(p)?8:-8); u.epCapSq=cap; u.epCapPiece=b[cap]; b[cap]=null; }
  if (m.castle==='K'){b[61]=b[63];b[63]=null;}
  else if (m.castle==='Q'){b[59]=b[56];b[56]=null;}
  else if (m.castle==='k'){b[5]=b[7];b[7]=null;}
  else if (m.castle==='q'){b[3]=b[0];b[0]=null;}
  if (p==='K'){s.castle.K=false;s.castle.Q=false;}
  if (p==='k'){s.castle.k=false;s.castle.q=false;}
  if (m.from===63||m.to===63) s.castle.K=false;
  if (m.from===56||m.to===56) s.castle.Q=false;
  if (m.from===7||m.to===7) s.castle.k=false;
  if (m.from===0||m.to===0) s.castle.q=false;
  s.ep = m.double ? (m.from+m.to)/2 : -1;
  s.half = (p.toUpperCase()==='P'||u.captured||m.ep)?0:s.half+1;
  if (s.turn==='b') s.full++;
  s.turn = s.turn==='w'?'b':'w';
  return u;
}
function unmakeMove(s,m,u){
  const b=s.board;
  b[m.from]=u.piece; b[m.to]=u.captured||null;
  if (m.ep) b[u.epCapSq]=u.epCapPiece;
  if (m.castle==='K'){b[63]=b[61];b[61]=null;}
  else if (m.castle==='Q'){b[56]=b[59];b[59]=null;}
  else if (m.castle==='k'){b[7]=b[5];b[5]=null;}
  else if (m.castle==='q'){b[0]=b[3];b[3]=null;}
  s.castle=u.castle; s.ep=u.ep; s.half=u.half; s.full=u.full;
  s.turn = s.turn==='w'?'b':'w';
}
function legalMoves(s){
  const out=[], me=s.turn==='w';
  for (const m of pseudoMoves(s)){
    const u=makeMove(s,m);
    const k=findKing(s,me);
    if (k<0||!isAttacked(s,k,!me)) out.push(m);
    unmakeMove(s,m,u);
  }
  return out;
}
function toSAN(s,m){
  const p=s.board[m.from], pu=p.toUpperCase(), white=isWhiteP(p);
  const isCap=!!s.board[m.to]||!!m.ep;
  let san='';
  if (m.castle) san=(m.castle==='K'||m.castle==='k')?'O-O':'O-O-O';
  else if (pu==='P'){
    if (isCap) san+=FILES[m.from%8]+'x';
    san+=idxToAlg(m.to);
    if (m.promo) san+='='+m.promo.toUpperCase();
  } else {
    san+=pu;
    const others=legalMoves(s).filter(o=>o.to===m.to&&o.from!==m.from&&s.board[o.from]&&s.board[o.from].toUpperCase()===pu&&isWhiteP(s.board[o.from])===white);
    if (others.length){
      const sameFile=others.some(o=>o.from%8===m.from%8);
      const sameRank=others.some(o=>Math.floor(o.from/8)===Math.floor(m.from/8));
      if (!sameFile) san+=FILES[m.from%8];
      else if (!sameRank) san+=String(8-Math.floor(m.from/8));
      else san+=idxToAlg(m.from);
    }
    if (isCap) san+='x';
    san+=idxToAlg(m.to);
  }
  const u=makeMove(s,m);
  const oppCheck=inCheck(s,s.turn==='w');
  const hasMoves=legalMoves(s).length>0;
  unmakeMove(s,m,u);
  if (oppCheck) san+=hasMoves?'+':'#';
  return san;
}
const normalizeSAN = txt => String(txt).replace(/[+#]/g,'').replace(/[!?]/g,'').replace(/0/g,'O').replace(/=/g,'').replace(/\s+/g,'').trim();

function stateFromSAN(list){
  const s=initialState();
  for (const token of list){
    const want=normalizeSAN(token);
    let found=null;
    for (const m of legalMoves(s)){
      if (normalizeSAN(toSAN(s,m))===want){ found=m; break; }
    }
    if (!found) return {ok:false, state:s, failed:token};
    makeMove(s,found);
  }
  return {ok:true, state:s};
}

/* ---- helpers used by app.js ---- */
window.__replay = function(list){
  const r = stateFromSAN(list||[]);
  return r.state.board;
};
window.__movesFrom = function(board, sq, color){
  // rebuild full state from move list isn't needed: use the board directly
  const s = stateFromBoard(board, color==='w'?'w':'b');
  const out=[];
  for (const m of legalMoves(s)){
    if (m.from===sq) out.push({to:m.to, san:toSAN(s,m)});
  }
  return out;
};
// promotion moves need explicit q/r/b/n entries
window.__promoMoves = function(board, sq, color){
  const s=stateFromBoard(board, color==='w'?'w':'b');
  const out=[];
  for (const m of legalMoves(s)){
    if (m.from!==sq) continue;
    out.push({to:m.to, san:toSAN(s,m)});
  }
  return out;
};
window.__moveSquares = function(board, san){
  const s = stateFromBoard(board, 'w');
  // try both turns
  for (const turn of ['w','b']){
    const st = stateFromBoard(board, turn);
    const want = normalizeSAN(san);
    for (const m of legalMoves(st)){
      if (normalizeSAN(toSAN(st,m))===want){
        return { from:m.from, to:m.to, captured: !!board[m.to] || !!m.ep, promo: !!m.promo };
      }
    }
  }
  return null;
};

function stateFromBoard(board, turn){
  const s = initialState();
  s.board = board.slice();
  s.turn = turn;
  // castling rights: assume allowed if king/rook are on their home squares
  s.castle = {
    K: board[60]==='K' && board[63]==='R',
    Q: board[60]==='K' && board[56]==='R',
    k: board[4]==='k' && board[7]==='r',
    q: board[4]==='k' && board[0]==='r'
  };
  // en passant is derived from the last move; approximate as none
  s.ep = -1;
  return s;
}
