// Isometric turn-based RPG with rooms, doors, keys, pistols, potions and enemy waves
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let DPR = window.devicePixelRatio || 1;
function resize(){
  DPR = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * DPR);
  canvas.height = Math.floor(window.innerHeight * DPR);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// Map / tile config
const MAP_W = 20;
const MAP_H = 20;
const TILE_W = 64;
const TILE_H = 32;

let MAX_ACTIVE_ENEMIES = 4;
const WAVE_INTERVAL = 15; // player turns per wave
const WAVE_MIN = 1;
const WAVE_MAX = 2;

// world state
let map = [];
let rooms = [];
let items = [];
let enemies = [];

let playerTurnCounter = 0;
let level = 1;
let victoryPending = false;
let lastEnemySpawnTurn = 0;
let aimMode = false;
let aimDir = null;
let aimKey = null;
let noGunFlashFrames = 0;
let currentTheme = { wall: '#7d7d7d', floor: '#2e8b57' };
const THEMES = [
  { wall: '#7d7d7d', floor: '#2e8b57' },   // классический
  { wall: '#2d5a27', floor: '#1a4a1a' },    // тёмно-зелёный
  { wall: '#8bc34a', floor: '#689f38' },    // салатовый
  { wall: '#e8e0d4', floor: '#d4c8b4' },    // белый
  { wall: '#64b5f6', floor: '#42a5f5' },    // голубой
  { wall: '#ffd700', floor: '#d4a017' },    // золотой
  { wall: '#b8860b', floor: '#8b6508' },    // тёмно-золотой
  { wall: '#1a2e1a', floor: '#0d1f0d' },    // чёрно-зелёный
  { wall: '#7b1fa2', floor: '#4a148c' },    // фиолетовый
];
let hasRadar = false;

function randInt(min, max){ return Math.floor(Math.random() * (max - min + 1)) + min; }

function pickRandomTheme(){
  currentTheme = THEMES[randInt(0, THEMES.length - 1)];
}

function initDungeon(roomCount = 12){
  // start with all walls
  map = Array.from({length: MAP_H}, ()=> Array.from({length: MAP_W}, ()=> 1));
  rooms = [];

  let attempts = 0;
  while (rooms.length < roomCount && attempts < 2000){
    attempts++;
    const w = randInt(3,5);
    const h = randInt(3,5);
    const x = randInt(1, MAP_W - w - 2);
    const y = randInt(1, MAP_H - h - 2);
    // check overlap with buffer
    let ok = true;
    for (const r of rooms){
      if (!(x + w + 1 < r.x || x - 1 > r.x + r.w || y + h + 1 < r.y || y - 1 > r.y + r.h)) { ok = false; break; }
    }
    if (!ok) continue;
    const room = { x, y, w, h, cx: Math.floor(x + w/2), cy: Math.floor(y + h/2) };
    rooms.push(room);
    // carve interior
    for (let ry = y; ry < y + h; ry++){
      for (let rx = x; rx < x + w; rx++){
        map[ry][rx] = 0; // floor
      }
    }
  }

  // mark roomMask for interiors so we can distinguish corridors later
  const roomMask = Array.from({length: MAP_H}, ()=> Array.from({length: MAP_W}, ()=> false));
  for (const r of rooms){
    for (let ry = r.y; ry < r.y + r.h; ry++) for (let rx = r.x; rx < r.x + r.w; rx++) roomMask[ry][rx] = true;
  }

  // carve corridors between room centers (simple chain)
  for (let i = 1; i < rooms.length; i++){
    const a = rooms[i-1];
    const b = rooms[i];
    carveCorridor(a.cx, a.cy, b.cx, b.cy);
  }

  // (No doors: corridors are open passages)

  // ensure at least one room exists; if not, create a central room
  if (rooms.length === 0){
    const w = Math.min(5, MAP_W-4);
    const h = Math.min(5, MAP_H-4);
    const x = Math.floor((MAP_W - w)/2);
    const y = Math.floor((MAP_H - h)/2);
    const room = { x, y, w, h, cx: Math.floor(x + w/2), cy: Math.floor(y + h/2) };
    rooms.push(room);
    for (let ry = y; ry < y + h; ry++) for (let rx = x; rx < x + w; rx++) map[ry][rx] = 0;
  }
  // ensure player start is inside first room
  if (rooms.length > 0){ const r = rooms[0]; const sx = Math.floor(r.x + r.w/2); const sy = Math.floor(r.y + r.h/2); map[sy][sx] = 0; }
}

function carveCorridor(x1,y1,x2,y2){
  // L-shaped corridor: horizontal then vertical (randomize order)
  if (Math.random() < 0.5){
    carveLine(x1,y1,x2,y1);
    carveLine(x2,y1,x2,y2);
  } else {
    carveLine(x1,y1,x1,y2);
    carveLine(x1,y2,x2,y2);
  }
}

function carveLine(x1,y1,x2,y2){
  let x = x1, y = y1;
  const dx = x2 > x1 ? 1 : (x2 < x1 ? -1 : 0);
  const dy = y2 > y1 ? 1 : (y2 < y1 ? -1 : 0);
  while (true){
    if (x >= 0 && x < MAP_W && y >= 0 && y < MAP_H){
      if (map[y][x] === 1) map[y][x] = 0; // carve floor unless it's already door (2)
    }
    if (x === x2 && y === y2) break;
    if (x !== x2) x += dx; else if (y !== y2) y += dy; else break;
  }
}

function inBounds(x,y){ return x >= 0 && x < MAP_W && y >= 0 && y < MAP_H; }

function isPassable(x,y){ return inBounds(x,y) && map[y][x] === 0; }

// A* pathfinding on grid (4-directional). Returns array of {x,y} from start to target inclusive, or null.
function findPath(sx,sy,tx,ty){
  if (!inBounds(sx,sy) || !inBounds(tx,ty)) return null;
  // if target not passable, still allow if target equals player's position (player stands on floor)
  if (!isPassable(tx,ty)) return null;
  if (sx === tx && sy === ty) return [{x:sx,y:sy}];
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  const g = Array.from({length: MAP_H}, ()=> Array.from({length: MAP_W}, ()=> Infinity));
  const f = Array.from({length: MAP_H}, ()=> Array.from({length: MAP_W}, ()=> Infinity));
  const came = Array.from({length: MAP_H}, ()=> Array.from({length: MAP_W}, ()=> null));
  function h(x,y){ return Math.abs(x - tx) + Math.abs(y - ty); }
  const open = [];
  g[sy][sx] = 0; f[sy][sx] = h(sx,sy);
  open.push({x:sx,y:sy,f:f[sy][sx]});
  while (open.length){
    // pop lowest f
    let bestIdx = 0;
    for (let i=1;i<open.length;i++) if (open[i].f < open[bestIdx].f) bestIdx = i;
    const node = open.splice(bestIdx,1)[0];
    const {x,y} = node;
    if (x === tx && y === ty){
      // reconstruct path
      const path = [];
      let cx = x, cy = y;
      while (cx !== null){ path.push({x:cx,y:cy}); const p = came[cy][cx]; if (!p) break; cx = p.x; cy = p.y; }
      return path.reverse();
    }
    for (const [dx,dy] of dirs){
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx,ny)) continue;
      if (!isPassable(nx,ny) && !(nx === tx && ny === ty)) continue;
      const tentative = g[y][x] + 1;
      if (tentative < g[ny][nx]){
        came[ny][nx] = {x,y};
        g[ny][nx] = tentative;
        f[ny][nx] = tentative + h(nx,ny);
        // add to open if not already
        if (!open.some(n=>n.x===nx && n.y===ny)) open.push({x:nx,y:ny,f:f[ny][nx]});
      }
    }
  }
  return null;
}

// BFS to find nearest free tile not in occupied set and not the player's tile
function findNearestFreeTileBFS(sx,sy, occupied){
  const q = [];
  const visited = new Set();
  const startKey = `${sx},${sy}`;
  q.push({x:sx,y:sy}); visited.add(startKey);
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (q.length){
    const cur = q.shift();
    for (const [dx,dy] of dirs){
      const nx = cur.x + dx, ny = cur.y + dy;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (!inBounds(nx,ny)) continue;
      if (map[ny][nx] !== 0) continue; // must be passable
      // avoid player's tile
      if (player && player.x === nx && player.y === ny) continue;
      // avoid occupied positions
      if (occupied && occupied.has(key)){
        // still add to queue so we can search beyond occupied tiles
        q.push({x:nx,y:ny});
        continue;
      }
      // suitable free tile
      return {x:nx,y:ny};
    }
  }
  return null;
}

// helper: find a free floor tile not occupied (optionally in rooms)
function findFreeTileAway(minDistFromPlayer = 4){
  const free = [];
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    if (map[y][x] !== 0) continue;
    if (player && player.x === x && player.y === y) continue;
    if (items.find(it => it.x === x && it.y === y)) continue;
    if (enemies.find(e => e.alive && e.x === x && e.y === y)) continue;
    const dist = Math.abs(x - player.x) + Math.abs(y - player.y);
    if (dist < minDistFromPlayer) continue;
    free.push({x,y});
  }
  if (free.length === 0) return null;
  return free[randInt(0, free.length - 1)];
}

// Items spawn inside rooms
function spawnItemsInRooms(keysCount = 3, pistolsCount = 2, potionsCount = 2){
  items = [];
  const allRoomTiles = [];
  for (const r of rooms){
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) allRoomTiles.push({x,y});
  }
  if (allRoomTiles.length === 0) return; // nothing to place into
  function place(type){
    let tries = 0;
    while (tries++ < 500){
      const t = allRoomTiles[randInt(0, allRoomTiles.length - 1)];
      if (player && player.x === t.x && player.y === t.y) continue;
      if (items.find(it => it.x === t.x && it.y === t.y)) continue;
      if (enemies.find(e => e.x === t.x && e.y === t.y)) continue;
      items.push({x: t.x, y: t.y, type});
      return;
    }
  }
  // keys removed from game - do not place them
  // for (let i=0;i<keysCount;i++) place('key');
  for (let i=0;i<pistolsCount;i++) place('pistol');
  for (let i=0;i<potionsCount;i++) place('potion');
  if (!hasRadar) place('radar');
}

// Entities
class Entity{
  constructor(x,y,opts={}){
    this.x = x; this.y = y;
    this.hp = opts.hp ?? 3;
    this.maxHp = opts.maxHp ?? this.hp;
    this.color = opts.color ?? '#ffcc33';
    this.char = opts.char ?? '?';
    this.alive = true;
    this.weapon = opts.weapon || null; // {name,dmg,range,ammo?}
  }
}

// player
let player = null;

function spawnInitialPlayer(){
  if (rooms.length === 0) throw new Error('no rooms');
  const r = rooms[0];
  const sx = Math.floor(r.x + r.w/2);
  const sy = Math.floor(r.y + r.h/2);
  player = new Entity(sx, sy, {hp:10, maxHp:10, color:'#ffcc33', char:'@'});
  player.weapon = { name: 'Sword', dmg: 3, range: 1 };
  // keys removed
  player.keys = 0;
  player.facing = {dx: 0, dy: 1};
}

function spawnEnemiesInitial(){
  enemies = [];
  const toSpawn = Math.min(MAX_ACTIVE_ENEMIES, 3);
  for (let i=0;i<toSpawn;i++) spawnSingleEnemyAtFreeTile();
}

function spawnSingleEnemyAtFreeTile(){
  const pos = findFreeTileAway(4);
  if (!pos) return null;
  const isRanged = Math.random() < 0.4;
  if (isRanged){
    const e = new Entity(pos.x,pos.y,{hp:5,maxHp:5,color:'#4a7bf3',char:'r'});
    e.weapon = { name: 'Rifle', dmg: 2, range: 5 };
    // initial target = player's spawn location (current player position)
    e.targetX = player ? player.x : pos.x;
    e.targetY = player ? player.y : pos.y;
    e.alerted = false;
    e.vision = 2; // same as player: 5x5
    enemies.push(e);
    return e;
  } else {
    const e = new Entity(pos.x,pos.y,{hp:4,maxHp:4,color:'#d14a4a',char:'g'});
    e.weapon = { name: 'Claws', dmg: 2, range: 1 };
    e.targetX = player ? player.x : pos.x;
    e.targetY = player ? player.y : pos.y;
    e.alerted = false;
    e.vision = 2;
    enemies.push(e);
    return e;
  }
}

function spawnWaveIfNeeded(){
  const alive = enemies.filter(e => e.alive).length;
  const remain = MAX_ACTIVE_ENEMIES - alive;
  if (remain <= 0) return;
  if (playerTurnCounter - lastEnemySpawnTurn < 30) return;
  lastEnemySpawnTurn = playerTurnCounter;
  const toSpawn = Math.min(remain, randInt(WAVE_MIN, WAVE_MAX));
  for (let i=0;i<toSpawn;i++) spawnSingleEnemyAtFreeTile();
}

// LOS: Bresenham
function lineOfSight(x0,y0,x1,y1){
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  let dy = Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  while (!(x === x1 && y === y1)){
    const e2 = err * 2;
    if (e2 > -dy){ err -= dy; x += sx; }
    if (e2 < dx){ err += dx; y += sy; }
    if (x === x1 && y === y1) break;
    if (map[y] && (map[y][x] === 1 || map[y][x] === 2)) return false;
  }
  return true;
}

// input
const AIM_ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const AIM_DIRS = { ArrowUp: {dx:0,dy:-1}, ArrowDown: {dx:0,dy:1}, ArrowLeft: {dx:-1,dy:0}, ArrowRight: {dx:1,dy:0} };

window.addEventListener('keydown', (e)=>{
  if (!player) return;
  if (e.code === 'KeyR'){ restart(); return; }
  // Shift toggles aim mode (or flash cross if no gun)
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight'){
    const hasGun = player.weapon && player.weapon.name === 'Pistol' && player.weapon.ammo > 0;
    if (hasGun){ aimMode = true; aimDir = null; aimKey = null; }
    else { noGunFlashFrames = 48; }
    return;
  }
  if (turn !== 'player') return;
  if (e.code === 'KeyH'){ attemptRangedFire(); return; }
  if (aimMode && AIM_ARROWS.includes(e.code)){
    aimDir = AIM_DIRS[e.code];
    aimKey = e.code;
    return;
  }
  if (aimMode) return; // suppress all movement keys while aiming
  if (['ArrowUp','KeyW','ArrowDown','KeyS','ArrowLeft','KeyA','ArrowRight','KeyD'].includes(e.code)){
    handleMoveKey(e.code);
  }
});

window.addEventListener('keyup', (e)=>{
  if (!player) return;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight'){ aimMode = false; aimDir = null; aimKey = null; return; }
  if (aimMode && AIM_ARROWS.includes(e.code) && e.code === aimKey && aimDir){
    performAimFire(aimDir.dx, aimDir.dy);
    aimDir = null; aimKey = null;
  }
});

// Global error handlers to show errors on the UI overlay (helps debugging in-browser)
window.addEventListener('error', (ev)=>{
  try{ const el = document.getElementById('ui'); if (el){ const pre = document.createElement('pre'); pre.style.background='rgba(128,0,0,0.7)'; pre.style.color='#fff'; pre.style.padding='8px'; pre.textContent = `Error: ${ev.message} at ${ev.filename}:${ev.lineno}`; el.appendChild(pre);} }catch(e){}
});
window.addEventListener('unhandledrejection', (ev)=>{ try{ const el = document.getElementById('ui'); if (el){ const pre = document.createElement('pre'); pre.style.background='rgba(128,0,0,0.7)'; pre.style.color='#fff'; pre.style.padding='8px'; pre.textContent = `UnhandledRejection: ${ev.reason}`; el.appendChild(pre);} }catch(e){} });

function restart(){
  level = 1;
  MAX_ACTIVE_ENEMIES = 4;
  pickRandomTheme();
  hasRadar = false;
  victoryPending = false;
  lastEnemySpawnTurn = 0;
  aimMode = false; aimDir = null; aimKey = null; noGunFlashFrames = 0;
  playerTurnCounter = 0;
  initDungeon(12);
  spawnItemsInRooms(4,2,3);
  spawnInitialPlayer();
  spawnEnemiesInitial();
  turn = 'player';
}

function nextLevel(){
  level++;
  MAX_ACTIVE_ENEMIES = 4 + (level - 1);
  pickRandomTheme();
  victoryPending = false;
  lastEnemySpawnTurn = playerTurnCounter;
  aimMode = false; aimDir = null; aimKey = null; noGunFlashFrames = 0;
  initDungeon(12);
  spawnItemsInRooms(4,2,3);
  spawnInitialPlayer();
  spawnEnemiesInitial();
  turn = 'player';
}

function handleMoveKey(code){
  let dx = 0, dy = 0;
  if (code === 'ArrowUp' || code === 'KeyW') dy = -1;
  else if (code === 'ArrowDown' || code === 'KeyS') dy = 1;
  else if (code === 'ArrowLeft' || code === 'KeyA') dx = -1;
  else if (code === 'ArrowRight' || code === 'KeyD') dx = 1;
  else return;
  player.facing = {dx, dy};
  const nx = player.x + dx, ny = player.y + dy;
  if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) return;
  const tile = map[ny][nx];
  if (tile === 1) return; // wall
  // no doors anymore
  if (tile === 2) return;
  // attack enemy on that tile
  const target = enemies.find(e => e.alive && e.x === nx && e.y === ny);
  if (target){ attack(player, target); endPlayerTurn(); return; }
  // move
  const occupied = enemies.find(e => e.alive && e.x === nx && e.y === ny);
  if (!occupied){ player.x = nx; player.y = ny; pickupItemAt(nx, ny); }
  // after player moves, update enemies' perception immediately
  updateEnemyPerception();
  endPlayerTurn();
}

function updateEnemyPerception(){
  if (!player) return;
  for (const e of enemies){
    if (!e.alive) continue;
    const vis = e.vision ?? 2;
    const withinVis = Math.abs(player.x - e.x) <= vis && Math.abs(player.y - e.y) <= vis;
    const canSee = withinVis && lineOfSight(e.x, e.y, player.x, player.y);
    if (canSee){ e.alerted = true; e.targetX = player.x; e.targetY = player.y; }
  }
}

function pickupItemAt(x,y){
  const idx = items.findIndex(it => it.x === x && it.y === y);
  if (idx === -1) return;
  const it = items.splice(idx,1)[0];
  if (it.type === 'potion'){
    player.hp = Math.min(player.maxHp, player.hp + 6);
  } else if (it.type === 'pistol'){
    // give player pistol with ammo
    const pistol = { name: 'Pistol', dmg: 6, range: 4, ammo: 6 };
    if (player.weapon && player.weapon.name === 'Pistol'){
      player.weapon.ammo = (player.weapon.ammo || 0) + pistol.ammo;
    } else {
      player.weapon = pistol;
    }
  } else if (it.type === 'radar'){
    hasRadar = true;
  }
}

function attack(attacker, defender){
  if (!defender || !defender.alive) return;
  const dmg = attacker.weapon ? attacker.weapon.dmg : 1;
  defender.hp -= dmg;
  if (defender.hp <= 0) defender.alive = false;
}

function shootInDirection(dx, dy){
  if (!player.weapon || player.weapon.name !== 'Pistol') return false;
  if (player.weapon.ammo !== undefined && player.weapon.ammo <= 0) return false;
  if (dx === 0 && dy === 0) return false;
  for (let step = 1; step <= player.weapon.range; step++){
    const tx = player.x + dx*step, ty = player.y + dy*step;
    if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) break;
    if (map[ty][tx] === 1 || map[ty][tx] === 2) break;
    const hit = enemies.find(e => e.alive && e.x === tx && e.y === ty);
    if (hit){ const dmg = step <= 2 ? 4 : 6; hit.hp -= dmg; if (hit.hp <= 0) hit.alive = false; break; }
  }
  if (player.weapon.ammo !== undefined){ player.weapon.ammo -= 1; if (player.weapon.ammo <= 0) player.weapon = { name: 'Sword', dmg: 3, range: 1 }; }
  return true;
}

function attemptRangedFire(){
  const dx = player.facing.dx, dy = player.facing.dy;
  if (shootInDirection(dx, dy)) endPlayerTurn();
}

function performAimFire(dx, dy){
  if (shootInDirection(dx, dy)) endPlayerTurn();
}

let turn = 'player';

function endPlayerTurn(){
  playerTurnCounter += 1;
  // check waves
  if (playerTurnCounter % WAVE_INTERVAL === 0){
    spawnWaveIfNeeded();
  }
  turn = 'enemies';
  setTimeout(enemyTurn, 200);
}

function enemyTurn(){
  for (const e of enemies){
    if (!e.alive) continue;
    // Perception: enemy can see player if there's line-of-sight (no walls) and within a reasonable distance
    const dxToPlayer = player.x - e.x;
    const dyToPlayer = player.y - e.y;
    const cheb = Math.max(Math.abs(dxToPlayer), Math.abs(dyToPlayer));
    // Limited vision: enemy can see only within vision radius (default 2 => 5x5)
    const vis = e.vision ?? 2;
    const withinVis = Math.abs(player.x - e.x) <= vis && Math.abs(player.y - e.y) <= vis;
    const canSeePlayer = withinVis && lineOfSight(e.x, e.y, player.x, player.y);
    if (canSeePlayer){
      // become alerted and remember last known position
      e.alerted = true;
      e.targetX = player.x; e.targetY = player.y;
    }

    // If ranged and player is in straight line AND in visibility (LOS + within vision) and within range -> shoot
    if (e.weapon && e.weapon.range > 1){
      const sameLine = (e.x === player.x) || (e.y === player.y);
      if (sameLine && canSeePlayer && cheb <= e.weapon.range){
        // ensure blue (ranged) only shoots when player is visible and in same row/column
        const dmg = Math.max(0, e.weapon.dmg - 1);
        player.hp -= dmg;
        if (player.hp <= 0) player.alive = false;
        e.alerted = true; // confirm alerted state
        continue;
      }
    }

    // Movement: if have a target (spawn point or last known player pos), path towards it
    if (e.targetX !== undefined && (e.x !== e.targetX || e.y !== e.targetY)){
      const path = findPath(e.x, e.y, e.targetX, e.targetY);
      if (path && path.length > 1){
        const step = path[1];
        // build occupied set of enemy positions (excluding current enemy)
        const occupied = new Set(enemies.filter(o=>o.alive && o!==e).map(o=> `${o.x},${o.y}`));
        const key = `${step.x},${step.y}`;
        if (!occupied.has(key) && !(player && player.x === step.x && player.y === step.y)){
          e.x = step.x; e.y = step.y;
        } else {
          // find nearest free tile reachable
          const free = findNearestFreeTileBFS(step.x, step.y, occupied);
          if (free){ e.x = free.x; e.y = free.y; }
        }
      }
      // if after moving it sees the player, update alert
      if (lineOfSight(e.x, e.y, player.x, player.y)){
        e.alerted = true;
        e.targetX = player.x; e.targetY = player.y;
      }
      continue;
    }
    // melee if adjacent
    const dman = Math.abs(e.x - player.x) + Math.abs(e.y - player.y);
    if (dman === 1){ attack(e, player); if (player.hp <= 0) player.alive = false; continue; }
    // move towards player
    const dx = player.x > e.x ? 1 : (player.x < e.x ? -1 : 0);
    const dy = player.y > e.y ? 1 : (player.y < e.y ? -1 : 0);
    const tries = [];
    if (dx !== 0) tries.push([e.x + dx, e.y]);
    if (dy !== 0) tries.push([e.x, e.y + dy]);
    for (const [nx, ny] of tries){
      if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
      if (map[ny][nx] === 1 || map[ny][nx] === 2) continue;
      if (player.x === nx && player.y === ny) continue;
      if (enemies.find(o => o !== e && o.alive && o.x === nx && o.y === ny)) continue;
      e.x = nx; e.y = ny; break;
    }
  }
  turn = 'player';
}

// rendering
function iso(x,y){ return { x: (x - y) * (TILE_W/2), y: (x + y) * (TILE_H/2) }; }

function drawTile(cx, cy, type){
  ctx.beginPath(); ctx.moveTo(cx, cy - TILE_H/2); ctx.lineTo(cx + TILE_W/2, cy); ctx.lineTo(cx, cy + TILE_H/2); ctx.lineTo(cx - TILE_W/2, cy); ctx.closePath();
  if (type === 1) ctx.fillStyle = currentTheme.wall;
  else if (type === 2) ctx.fillStyle = '#c08b57';
  else ctx.fillStyle = currentTheme.floor;
  ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.stroke();
  if (type === 2){ ctx.fillStyle = '#6b3e1e'; ctx.fillRect(cx - 8, cy - TILE_H*0.4 - 8, 16, TILE_H*0.8 + 16); ctx.fillStyle = '#00000022'; ctx.fillRect(cx + 4, cy - 2, 2, 4); }
}

function drawItem(it, cam){
  const isoP = iso(it.x, it.y); const sx = isoP.x - cam.x; const sy = isoP.y - cam.y;
  if (it.type === 'key'){ /* keys removed visually */ }
  else if (it.type === 'pistol'){ ctx.fillStyle = '#bdbdbd'; ctx.fillRect(sx - 8, sy - 6, 16, 6); ctx.fillStyle = '#666'; ctx.fillRect(sx + 6, sy - 4, 6, 4); }
  else if (it.type === 'potion'){ ctx.fillStyle = '#57c6a7'; ctx.beginPath(); ctx.ellipse(sx, sy - 2, 6, 8, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = '#00000022'; ctx.fillRect(sx - 2, sy + 2, 4, 4); }
  else if (it.type === 'radar'){ ctx.strokeStyle = '#66ff66'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy - 2, 10, 0, Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.arc(sx, sy - 2, 5, 0, Math.PI*2); ctx.stroke(); ctx.fillStyle = '#66ff66'; ctx.beginPath(); ctx.arc(sx, sy - 2, 2, 0, Math.PI*2); ctx.fill(); }
}

function drawEntity(ent, cam){
  const isoP = iso(ent.x, ent.y); const sx = isoP.x - cam.x; const sy = isoP.y - cam.y;
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(sx, sy + TILE_H*0.35, TILE_W*0.18, TILE_H*0.14, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = ent.color; ctx.beginPath(); ctx.moveTo(sx, sy - TILE_H*0.6); ctx.lineTo(sx + TILE_W*0.18, sy - TILE_H*0.25); ctx.lineTo(sx, sy + TILE_H*0.05); ctx.lineTo(sx - TILE_W*0.18, sy - TILE_H*0.25); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx-18, sy - TILE_H*0.8, 36, 6); const ratio = Math.max(0, ent.hp) / (ent.maxHp || 6); ctx.fillStyle = '#ff5b5b'; ctx.fillRect(sx-18, sy - TILE_H*0.8, 36 * Math.min(1, ratio), 6);
}

function render(){
  if (!player) return;
  const w = canvas.width / DPR, h = canvas.height / DPR; ctx.clearRect(0,0,w,h);
  // view window: 5x5 centered on player
  const viewRadius = 2; // radius in tiles (2 => 5x5)
  const minX = Math.max(0, player.x - viewRadius);
  const maxX = Math.min(MAP_W-1, player.x + viewRadius);
  const minY = Math.max(0, player.y - viewRadius);
  const maxY = Math.min(MAP_H-1, player.y + viewRadius);
  // camera should center on player but constrained so that only these tiles are visible
  // compute camera centered on player
  const playerIso = iso(player.x, player.y);
  const cam = { x: playerIso.x - w/2, y: playerIso.y - h/2 };
  // tiles (only visible window)
  const tiles = [];
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) tiles.push({x,y,type:map[y][x]});
  tiles.sort((a,b)=> (a.x+a.y) - (b.x+b.y));
  for (const t of tiles){ const isoP = iso(t.x,t.y); drawTile(isoP.x - cam.x, isoP.y - cam.y, t.type); }
  // items (visible)
  const itemsSorted = items.filter(it=> it.x >= minX && it.x <= maxX && it.y >= minY && it.y <= maxY).slice().sort((a,b)=> (a.x+a.y) - (b.x+b.y)); for (const it of itemsSorted) drawItem(it, cam);
  // entities (visible only)
  const ents = [...enemies.filter(e=>e.alive && e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY), player].sort((a,b)=> (a.x+a.y) - (b.x+b.y)); for (const e of ents) drawEntity(e, cam);
  // aim arrows when Shift is held
  if (aimMode){
    const hasGun = player.weapon && player.weapon.name === 'Pistol' && player.weapon.ammo > 0;
    const dirs = [
      {dx:0, dy:-1, label:'↗'},
      {dx:0, dy:1, label:'↙'},
      {dx:-1, dy:0, label:'↖'},
      {dx:1, dy:0, label:'↘'},
    ];
    ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const d of dirs){
      const tileIso = iso(player.x + d.dx, player.y + d.dy);
      const ax = tileIso.x - cam.x, ay = tileIso.y - cam.y;
      const isSelected = aimDir && aimDir.dx === d.dx && aimDir.dy === d.dy;
      if (isSelected && !hasGun) ctx.fillStyle = '#ff4444';
      else if (isSelected) ctx.fillStyle = '#ffd700';
      else ctx.fillStyle = 'rgba(200,200,200,0.5)';
      ctx.fillText(d.label, ax, ay);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  // flashing cross when no pistol
  if (noGunFlashFrames > 0){
    noGunFlashFrames--;
    const show = Math.floor(noGunFlashFrames / 12) % 2 === 0;
    if (show){
      const pIso = iso(player.x, player.y);
      const cx = pIso.x - cam.x, cy = pIso.y - cam.y;
      ctx.fillStyle = '#ff4444'; ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✕', cx, cy);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  }
  // minimap (radar)
  if (hasRadar){
    const mmSize = 120, tilePx = mmSize / MAP_W;
    const mmX = w - mmSize - 10, mmY = 10;
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(mmX - 2, mmY - 2, mmSize + 4, mmSize + 4);
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++){
      ctx.fillStyle = map[y][x] === 1 ? '#444' : '#222';
      ctx.fillRect(mmX + x * tilePx, mmY + y * tilePx, tilePx, tilePx);
    }
    for (const e of enemies){ if (!e.alive) continue;
      ctx.fillStyle = '#ff4444'; ctx.fillRect(mmX + e.x * tilePx + 1, mmY + e.y * tilePx + 1, tilePx - 2, tilePx - 2);
    }
    ctx.fillStyle = '#ffd700'; ctx.fillRect(mmX + player.x * tilePx + 1, mmY + player.y * tilePx + 1, tilePx - 2, tilePx - 2);
    ctx.strokeStyle = '#88ff88'; ctx.lineWidth = 1; ctx.strokeRect(mmX - 2, mmY - 2, mmSize + 4, mmSize + 4);
  }
  // HUD
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(10, h - 130, 520, 120);
  ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif'; const weaponLabel = player.weapon ? `${player.weapon.name}${player.weapon.ammo!==undefined ? ` (ammo:${player.weapon.ammo})` : ''}` : 'None';
  ctx.fillText(`HP: ${player.hp}/${player.maxHp}   Weapon: ${weaponLabel}${hasRadar ? '   [RADAR]' : ''}`, 18, h - 104);
  ctx.fillText(`Turn: ${turn}   Enemies: ${enemies.filter(e=>e.alive).length}/${MAX_ACTIVE_ENEMIES}   Level: ${level}`, 18, h - 84);
  const toNext = WAVE_INTERVAL - (playerTurnCounter % WAVE_INTERVAL || WAVE_INTERVAL); ctx.fillText(`Turns: ${playerTurnCounter}   Next wave in: ${toNext}`, 18, h - 64);
  ctx.fillText('Controls: WASD/Arrows move, H/Shift+Arrow shoot (pistol), R restart', 18, h - 44);
  // messages
  if (!player.alive){ ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(w/2 - 200, h/2 - 40, 400, 80); ctx.fillStyle = '#fff'; ctx.font = '22px sans-serif'; ctx.fillText('You died. Press R to restart.', w/2 - 170, h/2); }
  else if (enemies.filter(e=>e.alive).length === 0){
    if (!victoryPending){
      victoryPending = true;
      setTimeout(nextLevel, 1500);
    }
    const cx = w/2, cy = h/2 - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(cx - 240, cy - 55, 480, 110);
    function drawWreath(x, y, dir){
      ctx.strokeStyle = '#c4a44a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 28, -Math.PI/2.5, Math.PI/2.5, dir < 0); ctx.stroke();
      for (let i = 0; i < 6; i++){
        const t = -Math.PI/2.5 + (i/5) * Math.PI/1.25;
        const lx = x + 28 * Math.cos(t), ly = y + 28 * Math.sin(t);
        ctx.beginPath(); ctx.ellipse(lx + dir*6*Math.cos(t), ly + 6*Math.sin(t), 6, 3.5, t + Math.PI/2, 0, Math.PI*2);
        ctx.fillStyle = '#4a8a3a'; ctx.fill(); ctx.strokeStyle = '#2a5a1a'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    drawWreath(cx - 75, cy, -1); drawWreath(cx + 75, cy, 1);
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('ПОБЕДА', cx, cy + 10);
    ctx.fillStyle = '#eee'; ctx.font = '14px sans-serif';
    ctx.fillText('Уровень ' + (level + 1) + '...', cx, cy + 42);
    ctx.textAlign = 'left';
  }
}

function loop(){ render(); requestAnimationFrame(loop); }

// initial setup with error reporting to UI overlay
function showErrorOverlay(msg){
  try{
    const el = document.getElementById('ui');
    if (el){
      const pre = document.createElement('pre');
      pre.style.background = 'rgba(0,0,0,0.7)';
      pre.style.color = '#ffdddd';
      pre.style.padding = '8px';
      pre.style.marginTop = '8px';
      pre.textContent = msg;
      el.appendChild(pre);
    }
  }catch(e){ /* ignore */ }
}

function showDebugOverlay(){
  try{
    const el = document.getElementById('ui');
    if (!el) return;
    // remove old debug if present
    const old = document.getElementById('debug-info'); if (old) old.remove();
    const pre = document.createElement('pre');
    pre.id = 'debug-info';
    pre.style.background = 'rgba(0,0,0,0.45)';
    pre.style.color = '#dfefff';
    pre.style.padding = '8px';
    pre.style.marginTop = '8px';
    let floor = 0, wall = 0, door = 0;
    for (let yy = 0; yy < MAP_H; yy++){
      for (let xx = 0; xx < MAP_W; xx++){
        const v = map[yy][xx];
        if (v === 0) floor++; else if (v === 1) wall++; else if (v === 2) door++;
      }
    }
    const roomCount = rooms.length;
    const itemsCount = items.length;
    const enemiesCount = enemies.length;
    pre.textContent = `rooms: ${roomCount}\nfloor tiles: ${floor}\nwalls: ${wall}\ndoors: ${door}\nitems: ${itemsCount}\nenemies: ${enemiesCount}\nplayer: ${player ? `${player.x},${player.y}` : 'none'}`;
    el.appendChild(pre);
  }catch(e){}
}

try{
  initDungeon(12);
  spawnItemsInRooms(4,2,3);
  spawnInitialPlayer();
  spawnEnemiesInitial();
  loop();
  showDebugOverlay();
}catch(err){
  console.error('Initialization error', err);
  showErrorOverlay(String(err.stack || err));
}
