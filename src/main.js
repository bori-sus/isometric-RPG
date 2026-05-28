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

const MAX_ACTIVE_ENEMIES = 4;
const WAVE_INTERVAL = 15; // player turns per wave
const WAVE_MIN = 1;
const WAVE_MAX = 2;

// world state
let map = [];
let rooms = [];
let items = [];
let enemies = [];

let playerTurnCounter = 0;

function randInt(min, max){ return Math.floor(Math.random() * (max - min + 1)) + min; }

function initDungeon(roomCount = 12){
  // start with all walls
  map = Array.from({length: MAP_H}, ()=> Array.from({length: MAP_W}, ()=> 1));
  rooms = [];
  doors = [];

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
    enemies.push(e);
    return e;
  } else {
    const e = new Entity(pos.x,pos.y,{hp:4,maxHp:4,color:'#d14a4a',char:'g'});
    e.weapon = { name: 'Claws', dmg: 2, range: 1 };
    enemies.push(e);
    return e;
  }
}

function spawnWaveIfNeeded(){
  const alive = enemies.filter(e => e.alive).length;
  const remain = MAX_ACTIVE_ENEMIES - alive;
  if (remain <= 0) return;
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
window.addEventListener('keydown', (e)=>{
  if (!player) return;
  if (e.code === 'KeyR'){ restart(); return; }
  if (turn !== 'player') return;
  if (e.code === 'KeyH'){ attemptRangedFire(); return; }
  if (['ArrowUp','KeyW','ArrowDown','KeyS','ArrowLeft','KeyA','ArrowRight','KeyD'].includes(e.code)){
    handleMoveKey(e.code);
  }
});

function restart(){
  playerTurnCounter = 0;
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
  endPlayerTurn();
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
  }
}

function attack(attacker, defender){
  if (!defender || !defender.alive) return;
  const dmg = attacker.weapon ? attacker.weapon.dmg : 1;
  defender.hp -= dmg;
  if (defender.hp <= 0) defender.alive = false;
}

function attemptRangedFire(){
  // H key attack: pistol deals damage directly to first target in line; pistol damage set higher above
  if (!player.weapon || player.weapon.name !== 'Pistol') return;
  if (player.weapon.ammo !== undefined && player.weapon.ammo <= 0) return;
  const dx = player.facing.dx, dy = player.facing.dy;
  if (dx === 0 && dy === 0) return;
  for (let step = 1; step <= player.weapon.range; step++){
    const tx = player.x + dx*step, ty = player.y + dy*step;
    if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) break;
    if (map[ty][tx] === 1 || map[ty][tx] === 2) break;
    const hit = enemies.find(e => e.alive && e.x === tx && e.y === ty);
    if (hit){ hit.hp -= player.weapon.dmg; if (hit.hp <= 0) hit.alive = false; break; }
  }
  if (player.weapon.ammo !== undefined){ player.weapon.ammo -= 1; if (player.weapon.ammo <= 0) player.weapon = { name: 'Sword', dmg: 3, range: 1 }; }
  endPlayerTurn();
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
    // ranged try shoot
    if (e.weapon && e.weapon.range > 1){
      // ranged enemies only shoot if player is exactly on same row or same column (straight line)
      const sameLine = (e.x === player.x) || (e.y === player.y);
      const cheb = Math.max(Math.abs(e.x - player.x), Math.abs(e.y - player.y));
      if (sameLine && cheb <= e.weapon.range && lineOfSight(e.x,e.y,player.x,player.y)){
        // enemies deal 1 less damage
        const dmg = Math.max(0, e.weapon.dmg - 1);
        player.hp -= dmg;
        if (player.hp <= 0) player.alive = false;
        continue;
      }
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
  if (type === 1) ctx.fillStyle = '#7d7d7d';
  else if (type === 2) ctx.fillStyle = '#c08b57';
  else ctx.fillStyle = '#2e8b57';
  ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.stroke();
  if (type === 2){ ctx.fillStyle = '#6b3e1e'; ctx.fillRect(cx - 8, cy - TILE_H*0.4 - 8, 16, TILE_H*0.8 + 16); ctx.fillStyle = '#00000022'; ctx.fillRect(cx + 4, cy - 2, 2, 4); }
}

function drawItem(it, cam){
  const isoP = iso(it.x, it.y); const sx = isoP.x - cam.x; const sy = isoP.y - cam.y;
  if (it.type === 'key'){ /* keys removed visually */ }
  else if (it.type === 'pistol'){ ctx.fillStyle = '#bdbdbd'; ctx.fillRect(sx - 8, sy - 6, 16, 6); ctx.fillStyle = '#666'; ctx.fillRect(sx + 6, sy - 4, 6, 4); }
  else if (it.type === 'potion'){ ctx.fillStyle = '#57c6a7'; ctx.beginPath(); ctx.ellipse(sx, sy - 2, 6, 8, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = '#00000022'; ctx.fillRect(sx - 2, sy + 2, 4, 4); }
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
  const playerIso = iso(player.x, player.y); const cam = { x: playerIso.x - w/2, y: playerIso.y - h/2 };
  // tiles
  const tiles = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) tiles.push({x,y,type:map[y][x]});
  tiles.sort((a,b)=> (a.x+a.y) - (b.x+b.y));
  for (const t of tiles){ const isoP = iso(t.x,t.y); drawTile(isoP.x - cam.x, isoP.y - cam.y, t.type); }
  // items
  const itemsSorted = items.slice().sort((a,b)=> (a.x+a.y) - (b.x+b.y)); for (const it of itemsSorted) drawItem(it, cam);
  // entities
  const ents = [...enemies.filter(e=>e.alive), player].sort((a,b)=> (a.x+a.y) - (b.x+b.y)); for (const e of ents) drawEntity(e, cam);
  // HUD
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(10, h - 130, 520, 120);
  ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif'; const weaponLabel = player.weapon ? `${player.weapon.name}${player.weapon.ammo!==undefined ? ` (ammo:${player.weapon.ammo})` : ''}` : 'None';
  ctx.fillText(`HP: ${player.hp}/${player.maxHp}   Weapon: ${weaponLabel}`, 18, h - 104);
  ctx.fillText(`Turn: ${turn}   Enemies: ${enemies.filter(e=>e.alive).length}/${MAX_ACTIVE_ENEMIES}`, 18, h - 84);
  const toNext = WAVE_INTERVAL - (playerTurnCounter % WAVE_INTERVAL || WAVE_INTERVAL); ctx.fillText(`Turns: ${playerTurnCounter}   Next wave in: ${toNext}`, 18, h - 64);
  ctx.fillText('Controls: WASD/Arrows move/attack, Space shoot, R restart', 18, h - 44);
  // messages
  if (!player.alive){ ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(w/2 - 200, h/2 - 40, 400, 80); ctx.fillStyle = '#fff'; ctx.font = '22px sans-serif'; ctx.fillText('You died. Press R to restart.', w/2 - 170, h/2); }
  else if (enemies.filter(e=>e.alive).length === 0){ ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(w/2 - 220, h/2 - 40, 440, 80); ctx.fillStyle = '#fff'; ctx.font = '22px sans-serif'; ctx.fillText('All enemies slain! Press R to restart.', w/2 - 210, h/2); }
}

function loop(){ render(); requestAnimationFrame(loop); }

// initial setup
  initDungeon(12);
spawnItemsInRooms(4,2,3);
spawnInitialPlayer();
spawnEnemiesInitial();
loop();
