'use strict';
// Server-side clock arithmetic. No browser time or client-provided elapsed time
// determines the result. Values are milliseconds in the server's time domain.
const TIME_CONTROLS = Object.freeze([1, 3, 5, 10, 15, 30]);
function makeClock(minutes) {
  if (!TIME_CONTROLS.includes(minutes)) throw new RangeError('Unsupported time control');
  return {initialMinutes:minutes, remaining:{w:minutes*60000,b:minutes*60000}, running:null, since:null};
}
function view(clock, now=Date.now()) {
  const remaining={...clock.remaining};
  if (clock.running && clock.since !== null) remaining[clock.running]=Math.max(0,remaining[clock.running]-Math.max(0,now-clock.since));
  return {...clock, remaining, serverTime:now};
}
function pause(clock, now=Date.now()) {
  const v=view(clock,now);
  return {...clock,remaining:v.remaining,running:null,since:null};
}
function start(clock, turn, now=Date.now()) {
  if (turn!=='w' && turn!=='b') throw new RangeError('Invalid turn');
  if (clock.running) throw new Error('Clock already running');
  return {...clock, running:turn, since:now};
}
function move(clock, turn, now=Date.now()) {
  if (clock.running!==turn) throw new Error('Clock is not running for that side');
  const settled=pause(clock,now);
  if (settled.remaining[turn]===0) return {clock:settled, timedOut:turn};
  return {clock:start(settled,turn==='w'?'b':'w',now), timedOut:null};
}
module.exports={TIME_CONTROLS,makeClock,view,pause,start,move};
