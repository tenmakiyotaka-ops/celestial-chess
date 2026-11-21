
var FILES = 'abcdefgh';
function onb(r,c){ return r>=0 && r<8 && c>=0 && c<8; }
function idxToAlg(i){ return FILES[i%8] + (8 - Math.floor(i/8)); }
function isWhiteP(p){ return p === p.toUpperCase(); }
var N_DIRS=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
var B_DIRS=[[-1,-1],[-1,1],[1,-1],[1,1]];
var R_DIRS=[[-1,0],[1,0],[0,-1],[0,1]];
var K_DIRS=[[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];

function initialState(){
  var b = new Array(64).fill(null);
  var rows = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'.split('/');
  for(var r=0;r<8;r++){
    var f=0;
    for(var k=0;k<rows[r].length;k++){
      var ch=rows[r][k];
      if(ch>='1'&&ch<='8'){ f += (+ch); } else { b[r*8+f]=ch; f++; }
    }
  }
  return { board:b, turn:'w', castle:{K:true,Q:true,k:true,q:true}, ep:-1, half:0, full:1 };
}

function isAttacked(s, t, byWhite){
  var b=s.board, tr=Math.floor(t/8), tc=t%8, i, rr, cc, p;
  var pr = byWhite ? tr+1 : tr-1;
  for(i=-1;i<=1;i+=2){
    cc=tc+i;
    if(onb(pr,cc)){ p=b[pr*8+cc]; if(p && p.toUpperCase()==='P' && isWhiteP(p)===byWhite) return true; }
  }
  for(i=0;i<8;i++){
    rr=tr+N_DIRS[i][0]; cc=tc+N_DIRS[i][1];
    if(!onb(rr,cc)) continue;
    p=b[rr*8+cc];
    if(p && p.toUpperCase()==='N' && isWhiteP(p)===byWhite) return true;
  }
  for(i=0;i<8;i++){
    rr=tr+K_DIRS[i][0]; cc=tc+K_DIRS[i][1];
    if(!onb(rr,cc)) continue;
    p=b[rr*8+cc];
    if(p && p.toUpperCase()==='K' && isWhiteP(p)===byWhite) return true;
  }
  for(i=0;i<4;i++){
    rr=tr+B_DIRS[i][0]; cc=tc+B_DIRS[i][1];
    while(onb(rr,cc)){
      p=b[rr*8+cc];
      if(p){ if(isWhiteP(p)===byWhite && (p.toUpperCase()==='B'||p.toUpperCase()==='Q')) return true; break; }
      rr+=B_DIRS[i][0]; cc+=B_DIRS[i][1];
    }
  }
  for(i=0;i<4;i++){
    rr=tr+R_DIRS[i][0]; cc=tc+R_DIRS[i][1];
    while(onb(rr,cc)){
      p=b[rr*8+cc];
      if(p){ if(isWhiteP(p)===byWhite && (p.toUpperCase()==='R'||p.toUpperCase()==='Q')) return true; break; }
      rr+=R_DIRS[i][0]; cc+=R_DIRS[i][1];
    }
  }
  return false;
}

function findKing(s, white){
  var target = white ? 'K' : 'k';
  for(var i=0;i<64;i++) if(s.board[i]===target) return i;
  return -1;
}
function inCheck(s, white){
  var k=findKing(s, white);
  if(k<0) return false;
  return isAttacked(s, k, !white);
}

function addPawnMove(out, s, from, to){
  var r = Math.floor(to/8);
  if(r===0 || r===7){
    var qs=['q','r','b','n'];
    for(var i=0;i<4;i++) out.push({from:from, to:to, promo:qs[i]});
  } else out.push({from:from, to:to});
}

function pseudoMoves(s){
  var out=[], b=s.board, white = (s.turn==='w'), i, j, r, c, rr, cc, t, p, pu;
  for(i=0;i<64;i++){
    p=b[i]; if(!p) continue;
    if(isWhiteP(p)!==white) continue;
    r=Math.floor(i/8); c=i%8; pu=p.toUpperCase();
    if(pu==='P'){
      var up = white ? -1 : 1;
      var r1 = r+up;
      if(onb(r1,c) && !b[r1*8+c]){
        addPawnMove(out, s, i, r1*8+c);
        var r2 = r+2*up;
        if((white ? r===6 : r===1) && !b[r2*8+c]) out.push({from:i, to:r2*8+c, double:true});
      }
      for(j=-1;j<=1;j+=2){
        cc=c+j;
        if(!onb(r1,cc)) continue;
        t=r1*8+cc;
        if(b[t] && isWhiteP(b[t])!==white) addPawnMove(out, s, i, t);
        else if(t===s.ep) out.push({from:i, to:t, ep:true});
      }
    } else if(pu==='N'){
      for(j=0;j<8;j++){
        rr=r+N_DIRS[j][0]; cc=c+N_DIRS[j][1];
        if(!onb(rr,cc)) continue;
        t=rr*8+cc;
        if(b[t] && isWhiteP(b[t])===white) continue;
        out.push({from:i, to:t});
      }
    } else if(pu==='B' || pu==='R' || pu==='Q'){
      var dirs = pu==='B' ? B_DIRS : (pu==='R' ? R_DIRS : K_DIRS);
      for(j=0;j<dirs.length;j++){
        rr=r+dirs[j][0]; cc=c+dirs[j][1];
        while(onb(rr,cc)){
          t=rr*8+cc;
          if(b[t]){
            if(isWhiteP(b[t])!==white) out.push({from:i, to:t});
            break;
          }
          out.push({from:i, to:t});
          rr+=dirs[j][0]; cc+=dirs[j][1];
        }
      }
    } else if(pu==='K'){
      for(j=0;j<8;j++){
        rr=r+K_DIRS[j][0]; cc=c+K_DIRS[j][1];
        if(!onb(rr,cc)) continue;
        t=rr*8+cc;
        if(b[t] && isWhiteP(b[t])===white) continue;
        out.push({from:i, to:t});
      }
      if(white){
        if(i===60 && !isAttacked(s,60,false)){
          if(s.castle.K && !b[61] && !b[62] && b[63]==='R' && !isAttacked(s,61,false) && !isAttacked(s,62,false))
            out.push({from:60, to:62, castle:'K'});
          if(s.castle.Q && !b[59] && !b[58] && !b[57] && b[56]==='R' && !isAttacked(s,59,false) && !isAttacked(s,58,false))
            out.push({from:60, to:58, castle:'Q'});
        }
      } else {
        if(i===4 && !isAttacked(s,4,true)){
          if(s.castle.k && !b[5] && !b[6] && b[7]==='r' && !isAttacked(s,5,true) && !isAttacked(s,6,true))
            out.push({from:4, to:6, castle:'k'});
          if(s.castle.q && !b[3] && !b[2] && !b[1] && b[0]==='r' && !isAttacked(s,3,true) && !isAttacked(s,2,true))
            out.push({from:4, to:2, castle:'q'});
        }
      }
    }
  }
  return out;
}

function makeMove(s, m){
  var b=s.board;
  var u = { castle:{K:s.castle.K,Q:s.castle.Q,k:s.castle.k,q:s.castle.q},
            ep:s.ep, half:s.half, full:s.full, captured:b[m.to], piece:b[m.from] };
  var p = b[m.from];
  b[m.to] = m.promo ? (isWhiteP(p) ? m.promo.toUpperCase() : m.promo) : p;
  b[m.from] = null;
  if(m.ep){
    var capSq = m.to + (isWhiteP(p) ? 8 : -8);
    u.epCapSq = capSq; u.epCapPiece = b[capSq]; b[capSq] = null;
  }
  if(m.castle==='K'){ b[61]=b[63]; b[63]=null; }
  else if(m.castle==='Q'){ b[59]=b[56]; b[56]=null; }
  else if(m.castle==='k'){ b[5]=b[7]; b[7]=null; }
  else if(m.castle==='q'){ b[3]=b[0]; b[0]=null; }
  if(p==='K'){ s.castle.K=false; s.castle.Q=false; }
  if(p==='k'){ s.castle.k=false; s.castle.q=false; }
  if(m.from===63||m.to===63) s.castle.K=false;
  if(m.from===56||m.to===56) s.castle.Q=false;
  if(m.from===7||m.to===7) s.castle.k=false;
  if(m.from===0||m.to===0) s.castle.q=false;
  s.ep = m.double ? ((m.from+m.to)/2) : -1;
  s.half = (p.toUpperCase()==='P' || u.captured || m.ep) ? 0 : s.half+1;
  if(s.turn==='b') s.full++;
  s.turn = (s.turn==='w') ? 'b' : 'w';
  return u;
}

function unmakeMove(s, m, u){
  var b=s.board;
  b[m.from] = u.piece;
  b[m.to] = u.captured || null;
  if(m.ep) b[u.epCapSq] = u.epCapPiece;
  if(m.castle==='K'){ b[63]=b[61]; b[61]=null; }
  else if(m.castle==='Q'){ b[56]=b[59]; b[59]=null; }
  else if(m.castle==='k'){ b[7]=b[5]; b[5]=null; }
  else if(m.castle==='q'){ b[0]=b[3]; b[3]=null; }
  s.castle = u.castle; s.ep = u.ep; s.half = u.half; s.full = u.full;
  s.turn = (s.turn==='w') ? 'b' : 'w';
}

function legalMoves(s){
  var res=[], ms=pseudoMoves(s), me=(s.turn==='w'), i, m, u, k;
  for(i=0;i<ms.length;i++){
    m=ms[i];
    u=makeMove(s,m);
    k=findKing(s,me);
    if(k<0 || !isAttacked(s,k,!me)) res.push(m);
    unmakeMove(s,m,u);
  }
  return res;
}

function toSAN(s, m){
  var b=s.board, p=b[m.from], pu=p.toUpperCase(), white=isWhiteP(p);
  var arr=legalMoves(s), i, san='';
  var isCap = !!b[m.to] || !!m.ep;
  if(m.castle){
    san = (m.castle==='K'||m.castle==='k') ? 'O-O' : 'O-O-O';
  } else if(pu==='P'){
    if(isCap) san += FILES[m.from%8] + 'x';
    san += idxToAlg(m.to);
    if(m.promo) san += '=' + m.promo.toUpperCase();
  } else {
    san += pu;
    var others = [];
    for(i=0;i<arr.length;i++){
      var o=arr[i];
      if(o.from===m.from && o.to===m.to) continue;
      if(o.to!==m.to) continue;
      var op=b[o.from];
      if(!op) continue;
      if(op.toUpperCase()!==pu || isWhiteP(op)!==white) continue;
      others.push(o);
    }
    if(others.length){
      var sameFile=false, sameRank=false, fr=Math.floor(m.from/8);
      for(i=0;i<others.length;i++){
        if(others[i].from%8 === m.from%8) sameFile=true;
        if(Math.floor(others[i].from/8) === fr) sameRank=true;
      }
      if(!sameFile) san += FILES[m.from%8];
      else if(!sameRank) san += String(8 - fr);
      else san += idxToAlg(m.from);
    }
    if(isCap) san += 'x';
    san += idxToAlg(m.to);
  }
  var u = makeMove(s, m);
  var oppCheck = inCheck(s, s.turn==='w');
  var hasMoves = (legalMoves(s).length > 0);
  unmakeMove(s, m, u);
  if(oppCheck) san += hasMoves ? '+' : '#';
  return san;
}

function normalizeSAN(txt){
  return String(txt)
    .replace(/[+#]/g,'')
    .replace(/[!?]/g,'')
    .replace(/0/g,'O')
    .replace(/=/g,'')
    .replace(/\s+/g,'')
    .trim();
}

function parseSAN(s, txt){
  var want = normalizeSAN(txt);
  var arr = legalMoves(s), i, san;
  for(i=0;i<arr.length;i++){
    san = normalizeSAN(toSAN(s, arr[i]));
    if(san === want) return arr[i];
  }
  return null;
}

function applySANList(list){
  var s = initialState(), applied=[], i, m;
  for(i=0;i<list.length;i++){
    m = parseSAN(s, list[i]);
    if(!m) return { ok:false, applied:i, index:i, token:list[i], state:s, moves:applied };
    applied.push({ san: toSAN(s,m), move:m, undo: makeMove(s,m) });
  }
  return { ok:true, applied:list.length, state:s, moves:applied };
}

// FIDE position identity: side to move, castling rights, and an en-passant
// target only when an en-passant capture is actually legal.
function repetitionKey(s){
  var rights = (s.castle.K?'K':'') + (s.castle.Q?'Q':'') + (s.castle.k?'k':'') + (s.castle.q?'q':'');
  var hasEp = s.ep >= 0 && legalMoves(s).some(function(m){ return !!m.ep; });
  return s.board.map(function(p){return p || '.';}).join('') + '|' + s.turn + '|' + rights + '|' + (hasEp ? s.ep : '-');
}
function repetitionCount(list){
  var s=initialState(), counts={}, key=repetitionKey(s), i, m;
  counts[key]=1;
  for(i=0;i<list.length;i++){
    m=parseSAN(s,list[i]);
    if(!m) return 0;
    makeMove(s,m); key=repetitionKey(s); counts[key]=(counts[key]||0)+1;
  }
  return counts[key];
}

function insufficientMaterial(s){
  var pieces=[], i, p;
  for(i=0;i<64;i++){ p=s.board[i]; if(p && p.toUpperCase()!=='K') pieces.push({p:p.toUpperCase(), i:i}); }
  if(pieces.length===0) return true;
  if(pieces.length===1 && (pieces[0].p==='B' || pieces[0].p==='N')) return true;
  // Any number of bishops restricted to the same square colour can never
  // create mate without another piece type (including promoted bishops).
  if(pieces.length>0 && pieces.every(function(x){return x.p==='B';})){
    var col=(Math.floor(pieces[0].i/8)+pieces[0].i%8)%2;
    if(pieces.every(function(x){return (Math.floor(x.i/8)+x.i%8)%2===col;})) return true;
  }
  return false;
}

// On time expiry a bare king cannot checkmate, even if the flagged side has
// lots of material. Also recognise globally dead positions.
function insufficientForTimeout(s, winnerColor){
  if (insufficientMaterial(s)) return true;
  return !s.board.some(function(p){
    return p && p.toUpperCase() !== 'K' && (isWhiteP(p) ? 'w' : 'b') === winnerColor;
  });
}

function moveListToCode(sanList){
  var body = sanList.join(' ');
  var h = 2166136261;
  for(var i=0;i<body.length;i++){ h ^= body.charCodeAt(i); h = (h*16777619)>>>0; }
  return body + (body?' ':'') + '~' + h.toString(36).slice(-4);
}

function parseCodeToSanList(code){
  var raw = String(code||'');
  raw = raw.replace(/~\s*[0-9a-z]+/i,' ');
  raw = raw.replace(/CHESS1:?/i,' ');
  var toks = raw.split(/[\s,]+/).filter(function(t){ return t.length>0; });
  var out=[];
  for(var i=0;i<toks.length;i++){
    var t = toks[i];
    if(/^\d+\.*$/.test(t)) continue;
    if(/^(1-0|0-1|1\/2-1\/2|\*|chess:?)$/i.test(t)) continue;
    if(/^\d+\.\.\.$/.test(t)) continue;
    t = t.replace(/^\d+\.+/,'');
    if(t.length) out.push(t);
  }
  return out;
}
