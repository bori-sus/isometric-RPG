// Test script to run dungeon generation from src/main.js logic
function randInt(min, max){ return Math.floor(Math.random() * (max - min + 1)) + min; }
const MAP_W = 20, MAP_H = 20;
function initDungeonLocal(roomCount = 12){
  let map = Array.from({length: MAP_H}, ()=> Array.from({length: MAP_W}, ()=> 1));
  const rooms = [];
  let attempts = 0;
  while (rooms.length < roomCount && attempts < 2000){
    attempts++;
    const w = randInt(3,5);
    const h = randInt(3,5);
    const x = randInt(1, MAP_W - w - 2);
    const y = randInt(1, MAP_H - h - 2);
    let ok = true;
    for (const r of rooms){
      if (!(x + w + 1 < r.x || x - 1 > r.x + r.w || y + h + 1 < r.y || y - 1 > r.y + r.h)) { ok = false; break; }
    }
    if (!ok) continue;
    const room = { x, y, w, h, cx: Math.floor(x + w/2), cy: Math.floor(y + h/2) };
    rooms.push(room);
    for (let ry = y; ry < y + h; ry++){
      for (let rx = x; rx < x + w; rx++) map[ry][rx] = 0;
    }
  }
  function carveLine(map,x1,y1,x2,y2){
    let x = x1, y = y1;
    const dx = x2 > x1 ? 1 : (x2 < x1 ? -1 : 0);
    const dy = y2 > y1 ? 1 : (y2 < y1 ? -1 : 0);
    while (true){
      if (x >= 0 && x < MAP_W && y >= 0 && y < MAP_H){ if (map[y][x] === 1) map[y][x] = 0; }
      if (x === x2 && y === y2) break;
      if (x !== x2) x += dx; else if (y !== y2) y += dy; else break;
    }
  }
  function carveCorridor(map,x1,y1,x2,y2){ if (Math.random() < 0.5){ carveLine(map,x1,y1,x2,y1); carveLine(map,x2,y1,x2,y2);} else { carveLine(map,x1,y1,x1,y2); carveLine(map,x1,y2,x2,y2); } }
  for (let i = 1; i < rooms.length; i++){ const a = rooms[i-1]; const b = rooms[i]; carveCorridor(map,a.cx,a.cy,b.cx,b.cy); }
  if (rooms.length === 0){ const w = Math.min(5, MAP_W-4); const h = Math.min(5, MAP_H-4); const x = Math.floor((MAP_W - w)/2); const y = Math.floor((MAP_H - h)/2); const room = { x, y, w, h, cx: Math.floor(x + w/2), cy: Math.floor(y + h/2) }; rooms.push(room); for (let ry = y; ry < y + h; ry++) for (let rx = x; rx < x + w; rx++) map[ry][rx] = 0; }
  return {map, rooms};
}

function printMap(m){
  for (let y=0;y<MAP_H;y++){
    let line = '';
    for (let x=0;x<MAP_W;x++){
      line += m[y][x] === 1 ? '#' : (m[y][x] === 0 ? '.' : '?');
    }
    console.log(line);
  }
}

const {map, rooms} = initDungeonLocal(12);
console.log('rooms:', rooms.length);
printMap(map);
