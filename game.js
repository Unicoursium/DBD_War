const WORLD = 1440;
const BORDER = 30;
const LOW_HP_RATIO = 0.2;
const ASSETS = {
  map: "assets/maps/normal.png",
  trapper: {
    normal: "assets/trapper/trapper_normal.png",
    attack: "assets/trapper/trapper_attack.png",
    settrap: "assets/trapper/trapper_settrap.png",
    trap: "assets/trapper/trapper_trap.png",
  },
  hillbilly: {
    normal: "assets/hillbilly/hillbilly_normal.png",
    dash: "assets/hillbilly/hillbilly_dash.png",
  },
};

const DEFAULTS = {
  trapper: {
    hp: 1000,
    speed: 200,
    contactDamage: 100,
    trapInterval: 8,
    trapSetupTime: 2,
    trapEnemyDamage: 300,
    trapSelfDamage: 150,
    trapHoldTime: 3,
    trapSelfGrace: 5,
    mapMargin: 130,
  },
  hillbilly: {
    hp: 1000,
    speed: 200,
    dashSpeed: 2000,
    skillCooldown: 7,
    chargeTime: 2.5,
    aimLockTime: 0.4,
    dashDamage: 400,
    stunTime: 3,
  },
};

const FIELD_DEFS = {
  trapper: [
    ["type", "角色", "trapper"],
    ["angle", "初始角度", "空 = 随机"],
    ["hp", "血量", "1000"],
    ["speed", "移动速度", "200"],
    ["contactDamage", "碰撞攻击伤害", "100"],
    ["trapInterval", "放夹间隔", "8"],
    ["trapSetupTime", "放夹持续时间", "2"],
    ["trapEnemyDamage", "夹子对敌伤害", "300"],
    ["trapSelfDamage", "夹子对自己伤害", "150"],
    ["trapHoldTime", "夹住时间", "3"],
    ["trapSelfGrace", "自夹保护时间", "5"],
    ["mapMargin", "地图边距", "130"],
  ],
  hillbilly: [
    ["type", "角色", "hillbilly"],
    ["angle", "初始角度", "空 = 随机"],
    ["hp", "血量", "1000"],
    ["speed", "普通速度", "200"],
    ["dashSpeed", "冲刺速度", "2000"],
    ["skillCooldown", "技能冷却", "7"],
    ["chargeTime", "蓄力时间", "2.5"],
    ["aimLockTime", "索敌锁定时间", "0.4"],
    ["dashDamage", "冲刺伤害", "400"],
    ["stunTime", "眩晕时间", "3"],
  ],
};

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const ui = {
  start: document.getElementById("startBtn"),
  restart: document.getElementById("restartBtn"),
  reset: document.getElementById("resetBtn"),
  result: document.getElementById("resultText"),
  log: document.getElementById("eventLog"),
  leftSettings: document.getElementById("leftSettings"),
  rightSettings: document.getElementById("rightSettings"),
};

const images = {};
let state = null;
let lastTime = performance.now();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rand = (min, max) => min + Math.random() * (max - min);
const degToRad = (deg) => (deg * Math.PI) / 180;
const normalize = (x, y) => {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
};

function makeSettings(container, sideType) {
  container.innerHTML = "";
  for (const [key, label, placeholder] of FIELD_DEFS[sideType]) {
    const wrap = document.createElement("label");
    wrap.textContent = label;
    const input = document.createElement("input");
    input.name = key;
    input.placeholder = placeholder;
    input.dataset.default = placeholder;
    wrap.appendChild(input);
    container.appendChild(wrap);
  }
}

async function loadImages() {
  const entries = [
    ["map", ASSETS.map],
    ["trapper_normal", ASSETS.trapper.normal],
    ["trapper_attack", ASSETS.trapper.attack],
    ["trapper_settrap", ASSETS.trapper.settrap],
    ["trapper_trap", ASSETS.trapper.trap],
    ["hillbilly_normal", ASSETS.hillbilly.normal],
    ["hillbilly_dash", ASSETS.hillbilly.dash],
  ];

  await Promise.all(
    entries.map(
      ([key, src]) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            images[key] = img;
            resolve();
          };
          img.onerror = reject;
          img.src = src;
        }),
    ),
  );
}

function readSide(container, fallbackType, side) {
  const values = Object.fromEntries(new FormData(formFromContainer(container)));
  const typeText = clean(values.type).toLowerCase();
  const type = typeText === "hillbilly" || typeText === "trapper" ? typeText : fallbackType;
  const defaults = DEFAULTS[type];
  const angleText = clean(values.angle);
  const angle = angleText === "" ? rand(0, 360) : readNumber(angleText, rand(0, 360));
  const dir = normalize(Math.cos(degToRad(angle)), Math.sin(degToRad(angle)));
  const hp = readNumber(values.hp, defaults.hp);

  return {
    id: side,
    type,
    name: type === "trapper" ? "Trapper" : "Hillbilly",
    maxHp: hp,
    hp,
    x: side === "left" ? WORLD * 0.25 : WORLD * 0.75,
    y: WORLD * 0.5,
    prevX: side === "left" ? WORLD * 0.25 : WORLD * 0.75,
    prevY: WORLD * 0.5,
    vx: dir.x * readNumber(values.speed, defaults.speed),
    vy: dir.y * readNumber(values.speed, defaults.speed),
    holdVx: dir.x * readNumber(values.speed, defaults.speed),
    holdVy: dir.y * readNumber(values.speed, defaults.speed),
    speed: readNumber(values.speed, defaults.speed),
    alive: true,
    state: "normal",
    stateTime: 0,
    attackFlash: 0,
    collisionLatch: new Set(),
    trappedBy: null,
    dashDir: null,
    dashStart: null,
    pathDir: null,
    skillTimer: type === "trapper" ? readNumber(values.trapInterval, defaults.trapInterval) : readNumber(values.skillCooldown, defaults.skillCooldown),
    config: readConfig(type, values),
  };
}

function formFromContainer(container) {
  const form = document.createElement("form");
  for (const input of container.querySelectorAll("input")) {
    const clone = input.cloneNode();
    clone.value = input.value;
    form.appendChild(clone);
  }
  return form;
}

function clean(value) {
  return String(value ?? "").trim();
}

function readNumber(value, fallback) {
  const text = clean(value);
  if (text === "") return fallback;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readConfig(type, values) {
  const defaults = DEFAULTS[type];
  const config = {};
  for (const key of Object.keys(defaults)) config[key] = readNumber(values[key], defaults[key]);
  return config;
}

function startSimulation() {
  applyLayoutSettings();
  createMatchState(true);
  ui.result.textContent = "模拟中";
  ui.log.innerHTML = "";
  logEvent("模拟开始。");
}

function resetToIdle() {
  applyLayoutSettings();
  createMatchState(false);
  ui.result.textContent = "等待开始";
  ui.log.innerHTML = "";
  draw();
}

function createMatchState(running) {
  const left = readSide(ui.leftSettings, "trapper", "left");
  const right = readSide(ui.rightSettings, "hillbilly", "right");
  state = {
    running,
    time: 0,
    fighters: [left, right],
    traps: [],
    damageTexts: [],
    resultLocked: false,
    winner: null,
  };
}

function resetAll() {
  for (const input of document.querySelectorAll(".setting-list input")) input.value = "";
  resetToIdle();
}

function applyLayoutSettings() {
  const marginInput = ui.leftSettings.querySelector('input[name="mapMargin"]');
  const margin = readNumber(marginInput?.value, DEFAULTS.trapper.mapMargin);
  const safeMargin = clamp(margin, 0, 600);
  document.documentElement.style.setProperty("--map-margin-total", `${safeMargin * 2}px`);
}

function update(dt) {
  if (!state || !state.running) return;
  state.time += dt;

  for (const fighter of state.fighters) updateFighter(fighter, dt);
  resolveFighterCollision();
  updateTraps(dt);
  updateDamageTexts(dt);
  checkResult();
}

function updateFighter(fighter, dt) {
  if (!fighter.alive) return;
  fighter.attackFlash = Math.max(0, fighter.attackFlash - dt);

  if (fighter.state === "trapped") {
    fighter.stateTime -= dt;
    if (fighter.stateTime <= 0) releaseFromTrap(fighter);
    return;
  }

  if (fighter.type === "trapper") updateTrapper(fighter, dt);
  if (fighter.type === "hillbilly") updateHillbilly(fighter, dt);
}

function updateTrapper(fighter, dt) {
  if (fighter.state === "settingTrap") {
    fighter.stateTime -= dt;
    if (fighter.stateTime <= 0) {
      placeTrap(fighter);
      fighter.state = "normal";
      fighter.vx = fighter.holdVx;
      fighter.vy = fighter.holdVy;
      resetVelocity(fighter, fighter.speed);
      fighter.skillTimer = fighter.config.trapInterval;
    }
    return;
  }

  fighter.skillTimer -= dt;
  if (fighter.skillTimer <= 0) {
    fighter.state = "settingTrap";
    fighter.stateTime = fighter.config.trapSetupTime;
    fighter.holdVx = fighter.vx;
    fighter.holdVy = fighter.vy;
    fighter.vx = 0;
    fighter.vy = 0;
    logEvent("Trapper 开始设置捕兽夹。");
    return;
  }

  moveAndBounce(fighter, dt);
}

function updateHillbilly(fighter, dt) {
  const enemy = getEnemy(fighter);

  if (fighter.state === "stunned") {
    fighter.stateTime -= dt;
    if (fighter.stateTime <= 0) {
      fighter.state = "normal";
      setRandomVelocityIfStopped(fighter);
      fighter.skillTimer = fighter.config.skillCooldown;
      logEvent("Hillbilly 从眩晕中恢复。");
    }
    return;
  }

  if (fighter.state === "charging") {
    fighter.stateTime -= dt;
    if (enemy?.alive && fighter.stateTime > fighter.config.aimLockTime) {
      fighter.pathDir = normalize(enemy.x - fighter.x, enemy.y - fighter.y);
    }
    if (fighter.stateTime <= 0) {
      fighter.state = "dashing";
      fighter.dashDir = fighter.pathDir || normalize(fighter.vx, fighter.vy);
      fighter.dashStart = { x: fighter.x, y: fighter.y };
      fighter.vx = fighter.dashDir.x * fighter.config.dashSpeed;
      fighter.vy = fighter.dashDir.y * fighter.config.dashSpeed;
      logEvent("Hillbilly 开始冲刺。");
    }
    return;
  }

  if (fighter.state === "dashing") {
    const hitWall = moveAndBounce(fighter, dt, { stunOnWall: true });
    if (hitWall) {
      fighter.state = "stunned";
      fighter.stateTime = fighter.config.stunTime;
      fighter.vx = 0;
      fighter.vy = 0;
      fighter.skillTimer = fighter.config.skillCooldown;
      logEvent("Hillbilly 撞墙并眩晕。");
    }
    return;
  }

  fighter.skillTimer -= dt;
  if (fighter.skillTimer <= 0 && enemy?.alive) {
    fighter.state = "charging";
    fighter.stateTime = fighter.config.chargeTime;
    fighter.vx = 0;
    fighter.vy = 0;
    fighter.pathDir = normalize(enemy.x - fighter.x, enemy.y - fighter.y);
    logEvent("Hillbilly 开始拉锯蓄力。");
    return;
  }

  moveAndBounce(fighter, dt);
}

function moveAndBounce(fighter, dt, options = {}) {
  const box = getFighterBox(fighter);
  fighter.prevX = fighter.x;
  fighter.prevY = fighter.y;
  fighter.x += fighter.vx * dt;
  fighter.y += fighter.vy * dt;

  let hitX = false;
  let hitY = false;
  const halfW = box.w / 2;
  const halfH = box.h / 2;
  const minX = BORDER + halfW;
  const maxX = WORLD - BORDER - halfW;
  const minY = BORDER + halfH;
  const maxY = WORLD - BORDER - halfH;

  if (fighter.x < minX || fighter.x > maxX) {
    fighter.x = clamp(fighter.x, minX, maxX);
    hitX = true;
  }
  if (fighter.y < minY || fighter.y > maxY) {
    fighter.y = clamp(fighter.y, minY, maxY);
    hitY = true;
  }

  if (hitX && hitY) {
    const targetX = fighter.x < WORLD / 2 ? 1 : -1;
    const targetY = fighter.y < WORLD / 2 ? 1 : -1;
    const angle = degToRad(40);
    const speed = Math.hypot(fighter.vx, fighter.vy) || fighter.speed;
    fighter.vx = Math.cos(angle) * speed * targetX;
    fighter.vy = Math.sin(angle) * speed * targetY;
  } else {
    if (hitX) fighter.vx *= -1;
    if (hitY) fighter.vy *= -1;
  }

  return options.stunOnWall && (hitX || hitY);
}

function resolveFighterCollision() {
  const [a, b] = state.fighters;
  if (!a?.alive || !b?.alive) return;

  const overlap = rectsOverlap(getFighterHitBox(a), getFighterHitBox(b));
  const key = b.id;
  if (!overlap) {
    a.collisionLatch.delete(key);
    b.collisionLatch.delete(a.id);
    return;
  }

  if (a.state === "dashing" || b.state === "dashing") {
    if (!a.collisionLatch.has(key)) {
      handleDashPassDamage(a, b);
      a.collisionLatch.add(key);
      b.collisionLatch.add(a.id);
    }
  } else {
    bounceFighters(a, b);
    if (!a.collisionLatch.has(key)) {
      handleCollisionAttack(a, b);
      a.collisionLatch.add(key);
      b.collisionLatch.add(a.id);
    }
  }
}

function handleDashPassDamage(a, b) {
  if (a.type === "hillbilly" && a.state === "dashing") {
    damage(b, a.config.dashDamage, a, "冲刺");
  }
  if (b.type === "hillbilly" && b.state === "dashing") {
    damage(a, b.config.dashDamage, b, "冲刺");
  }
}

function handleCollisionAttack(a, b) {
  if (a.type === "trapper" && canTrapperAttack(a)) {
    a.attackFlash = 0.1;
    damage(b, a.config.contactDamage, a, "碰撞攻击");
  }
  if (b.type === "trapper" && canTrapperAttack(b)) {
    b.attackFlash = 0.1;
    damage(a, b.config.contactDamage, b, "碰撞攻击");
  }

}

function canTrapperAttack(fighter) {
  return fighter.state === "normal" && fighter.attackFlash <= 0;
}

function bounceFighters(a, b) {
  const dir = normalize(a.x - b.x, a.y - b.y);
  const aSpeed = Math.hypot(a.vx, a.vy) || a.speed;
  const bSpeed = Math.hypot(b.vx, b.vy) || b.speed;
  a.vx = dir.x * aSpeed;
  a.vy = dir.y * aSpeed;
  b.vx = -dir.x * bSpeed;
  b.vy = -dir.y * bSpeed;

  const aBox = getFighterHitBox(a);
  const bBox = getFighterHitBox(b);
  const push = Math.max(2, Math.min(aBox.w + bBox.w, aBox.h + bBox.h) * 0.02);
  a.x += dir.x * push;
  a.y += dir.y * push;
  b.x -= dir.x * push;
  b.y -= dir.y * push;
}

function stopDashAfterHit(fighter) {
  fighter.state = "normal";
  fighter.skillTimer = fighter.config.skillCooldown;
  resetVelocity(fighter, fighter.speed);
}

function placeTrap(owner) {
  state.traps.push({
    owner,
    x: owner.x,
    y: owner.y,
    state: "armed",
    age: 0,
    holdTarget: null,
    holdTime: 0,
  });
  logEvent("Trapper 放置了捕兽夹。");
}

function updateTraps(dt) {
  for (const trap of state.traps) {
    trap.age += dt;
    if (trap.state === "holding") {
      trap.holdTime -= dt;
      if (trap.holdTime <= 0) trap.state = "expired";
      continue;
    }

    if (trap.state !== "armed") continue;
    for (const fighter of state.fighters) {
      if (!fighter.alive || fighter.state === "trapped") continue;
      if (fighter === trap.owner && trap.age < trap.owner.config.trapSelfGrace) continue;
      if (rectsOverlap(getTrapHitBox(trap), getFighterTrapSensorBox(fighter))) {
        triggerTrap(trap, fighter);
        break;
      }
    }
  }

  state.traps = state.traps.filter((trap) => trap.state !== "expired");
}

function triggerTrap(trap, fighter) {
  const sameOwner = trap.owner === fighter;
  const amount = sameOwner ? trap.owner.config.trapSelfDamage : trap.owner.config.trapEnemyDamage;
  const holdTime = trap.owner.config.trapHoldTime;
  fighter.state = "trapped";
  fighter.stateTime = holdTime;
  fighter.trappedBy = trap;
  fighter.vx = 0;
  fighter.vy = 0;
  alignFighterToTrap(fighter, trap);
  trap.state = "holding";
  trap.holdTarget = fighter;
  trap.holdTime = holdTime;
  if (fighter.type === "hillbilly") fighter.skillTimer = fighter.config.skillCooldown;
  damage(fighter, amount, trap.owner, sameOwner ? "自己的捕兽夹" : "捕兽夹");
  logEvent(`${fighter.name} 被捕兽夹夹住。`);
}

function alignFighterToTrap(fighter, trap) {
  const fighterBox = getFighterBox(fighter);
  const trapBox = getTrapBox(trap);
  fighter.x = trapBox.x + trapBox.w / 2;
  fighter.y = trapBox.y + trapBox.h - fighterBox.h / 2;
  keepFighterInsideMap(fighter);
}

function releaseFromTrap(fighter) {
  fighter.trappedBy = null;
  fighter.state = "normal";
  setRandomVelocityIfStopped(fighter);
  logEvent(`${fighter.name} 挣脱捕兽夹。`);
}

function damage(target, amount, source, reason) {
  if (!target.alive) return;
  const finalAmount = Math.round(amount);
  target.hp = Math.max(0, target.hp - finalAmount);
  state.damageTexts.push({
    x: target.x + rand(-30, 30),
    y: target.y + getFighterBox(target).h / 2 + 52,
    amount: finalAmount,
    age: 0,
  });
  logEvent(`${source.name} 的${reason}造成 ${finalAmount} 伤害。`);
  if (target.hp <= 0) killFighter(target, source);
}

function killFighter(target, source) {
  target.alive = false;
  target.state = "dead";
  target.vx = 0;
  target.vy = 0;
  logEvent(`${target.name} 被击败。`);
  if (!state.resultLocked) {
    state.resultLocked = true;
    state.winner = source.alive ? source : getEnemy(target);
    ui.result.textContent = `${state.winner?.name ?? "无人"} 胜利`;
  }
}

function checkResult() {
  if (state.resultLocked) return;
  const alive = state.fighters.filter((fighter) => fighter.alive);
  if (alive.length === 1) {
    state.resultLocked = true;
    state.winner = alive[0];
    ui.result.textContent = `${alive[0].name} 胜利`;
  }
}

function updateDamageTexts(dt) {
  for (const text of state.damageTexts) text.age += dt;
  state.damageTexts = state.damageTexts.filter((text) => text.age < 1);
}

function getFighterImage(fighter) {
  if (fighter.type === "trapper") {
    if (fighter.state === "settingTrap") return images.trapper_settrap;
    if (fighter.attackFlash > 0) return images.trapper_attack;
    return images.trapper_normal;
  }

  if (fighter.state === "charging" || fighter.state === "dashing") return images.hillbilly_dash;
  return images.hillbilly_normal;
}

function getFighterBox(fighter) {
  const img = getFighterImage(fighter);
  return {
    x: fighter.x - img.width / 2,
    y: fighter.y - img.height / 2,
    w: img.width,
    h: img.height,
  };
}

function getFighterHitBox(fighter) {
  const box = getFighterBox(fighter);
  return {
    x: box.x + box.w * 0.175,
    y: box.y + box.h * 0.175,
    w: box.w * 0.65,
    h: box.h * 0.65,
  };
}

function getFighterFootBox(fighter) {
  return getFighterFootBoxAt(fighter, fighter.x, fighter.y);
}

function getFighterFootBoxAt(fighter, x, y) {
  const box = getFighterBoxAt(fighter, x, y);
  return {
    x: box.x,
    y: box.y + box.h * 0.8,
    w: box.w,
    h: box.h * 0.2,
  };
}

function getFighterTrapSensorBox(fighter) {
  const current = getFighterFootBox(fighter);
  const previous = getFighterFootBoxAt(fighter, fighter.prevX ?? fighter.x, fighter.prevY ?? fighter.y);
  const x1 = Math.min(current.x, previous.x);
  const y1 = Math.min(current.y, previous.y);
  const x2 = Math.max(current.x + current.w, previous.x + previous.w);
  const y2 = Math.max(current.y + current.h, previous.y + previous.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function getFighterBoxAt(fighter, x, y) {
  const img = getFighterImage(fighter);
  return {
    x: x - img.width / 2,
    y: y - img.height / 2,
    w: img.width,
    h: img.height,
  };
}

function getTrapBox(trap) {
  const img = images.trapper_trap;
  return {
    x: trap.x - img.width / 2,
    y: trap.y - img.height / 2,
    w: img.width,
    h: img.height,
  };
}

function getTrapHitBox(trap) {
  const box = getTrapBox(trap);
  return {
    x: box.x + box.w * 0.25,
    y: box.y + box.h * 0.25,
    w: box.w * 0.5,
    h: box.h * 0.5,
  };
}

function keepFighterInsideMap(fighter) {
  const box = getFighterBox(fighter);
  const halfW = box.w / 2;
  const halfH = box.h / 2;
  fighter.x = clamp(fighter.x, BORDER + halfW, WORLD - BORDER - halfW);
  fighter.y = clamp(fighter.y, BORDER + halfH, WORLD - BORDER - halfH);
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function getEnemy(fighter) {
  return state.fighters.find((other) => other !== fighter);
}

function resetVelocity(fighter, speed) {
  const dir = normalize(fighter.vx, fighter.vy);
  fighter.vx = dir.x * speed;
  fighter.vy = dir.y * speed;
}

function setRandomVelocityIfStopped(fighter) {
  if (Math.hypot(fighter.vx, fighter.vy) > 0.01) return;
  const angle = rand(0, Math.PI * 2);
  fighter.vx = Math.cos(angle) * fighter.speed;
  fighter.vy = Math.sin(angle) * fighter.speed;
}

function draw() {
  ctx.clearRect(0, 0, WORLD, WORLD);
  if (!images.map) return;
  ctx.drawImage(images.map, 0, 0, WORLD, WORLD);
  drawDashPaths();
  drawTraps();
  drawFighters();
  drawDamageTexts();
}

function drawDashPaths() {
  if (!state) return;
  for (const fighter of state.fighters) {
    if (!fighter.alive || fighter.type !== "hillbilly") continue;
    if (fighter.state !== "charging" && fighter.state !== "dashing") continue;
    const dir = fighter.state === "dashing" ? fighter.dashDir : fighter.pathDir;
    if (!dir) continue;
    drawPathBar(fighter, dir);
  }
}

function drawPathBar(fighter, dir) {
  const length = WORLD * 3;
  const img = getFighterImage(fighter);
  const width = Math.hypot(img.width, img.height) * 0.7;
  const angle = Math.atan2(dir.y, dir.x);
  ctx.save();
  ctx.translate(fighter.x, fighter.y);
  ctx.rotate(angle);
  ctx.fillStyle = "rgba(160, 85, 85, 0.32)";
  ctx.strokeStyle = "rgba(214, 75, 75, 0.9)";
  ctx.lineWidth = 12;
  ctx.fillRect(0, -width / 2, length, width);
  ctx.strokeRect(0, -width / 2, length, width);
  ctx.restore();
}

function drawTraps() {
  if (!state) return;
  for (const trap of state.traps) {
    const box = getTrapBox(trap);
    ctx.globalAlpha = trap.state === "holding" ? 0.75 : 1;
    ctx.drawImage(images.trapper_trap, box.x, box.y);
    ctx.globalAlpha = 1;
  }
}

function drawFighters() {
  if (!state) return;
  for (const fighter of state.fighters) {
    if (!fighter.alive) continue;
    const img = getFighterImage(fighter);
    const box = getFighterBox(fighter);
    ctx.drawImage(img, box.x, box.y);
    drawHealth(fighter, box);
    if (fighter.type === "hillbilly" && fighter.state === "charging") drawChargeBar(fighter, box);
  }
}

function drawHealth(fighter, box) {
  const cx = box.x + box.w / 2;
  const y = box.y - 56;
  const ratio = clamp(fighter.hp / fighter.maxHp, 0, 1);
  const low = ratio < LOW_HP_RATIO;
  const armW = 92;
  const armH = 28;
  const stemW = 28;
  const stemH = 92;

  ctx.save();
  ctx.translate(cx, y);

  ctx.fillStyle = low ? "#969696" : "#ffffff";
  drawPlusShape(armW, armH, stemW, stemH);

  if (!low && ratio < 1) {
    ctx.save();
    ctx.beginPath();
    plusPath(armW, armH, stemW, stemH);
    ctx.clip();
    ctx.fillStyle = "#969696";
    ctx.fillRect(-armW / 2, -stemH / 2, armW, stemH * (1 - ratio));
    ctx.restore();
  }

  if (low) {
    ctx.save();
    ctx.beginPath();
    plusPath(armW, armH, stemW, stemH);
    ctx.clip();
    ctx.fillStyle = "#f00000";
    ctx.fillRect(-armW / 2, stemH / 2 - stemH * ratio, armW, stemH * ratio);
    ctx.restore();
  }

  ctx.fillStyle = low ? "#ff0000" : "#1295f5";
  ctx.font = "bold 36px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.round(fighter.hp)), 0, 0);
  ctx.restore();
}

function drawPlusShape(armW, armH, stemW, stemH) {
  ctx.beginPath();
  plusPath(armW, armH, stemW, stemH);
  ctx.fill();
}

function plusPath(armW, armH, stemW, stemH) {
  const x1 = -armW / 2;
  const x2 = -stemW / 2;
  const x3 = stemW / 2;
  const x4 = armW / 2;
  const y1 = -stemH / 2;
  const y2 = -armH / 2;
  const y3 = armH / 2;
  const y4 = stemH / 2;
  ctx.moveTo(x2, y1);
  ctx.lineTo(x3, y1);
  ctx.lineTo(x3, y2);
  ctx.lineTo(x4, y2);
  ctx.lineTo(x4, y3);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x3, y4);
  ctx.lineTo(x2, y4);
  ctx.lineTo(x2, y3);
  ctx.lineTo(x1, y3);
  ctx.lineTo(x1, y2);
  ctx.lineTo(x2, y2);
  ctx.closePath();
}

function drawChargeBar(fighter, box) {
  const total = fighter.config.chargeTime;
  const ratio = clamp(1 - fighter.stateTime / total, 0, 1);
  const x = box.x + box.w / 2 - 58;
  const y = box.y - 2;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x, y, 116, 8);
  ctx.fillStyle = "#f3d45e";
  ctx.fillRect(x, y, 116 * ratio, 8);
}

function drawDamageTexts() {
  if (!state) return;
  for (const text of state.damageTexts) {
    const ratio = text.age / 1;
    ctx.globalAlpha = 1 - ratio;
    ctx.fillStyle = "#e9e257";
    ctx.font = "bold 46px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`-${text.amount}`, text.x, text.y - 200 * ratio);
    ctx.globalAlpha = 1;
  }
}

function logEvent(text) {
  const item = document.createElement("li");
  item.textContent = `${state ? state.time.toFixed(1) : "0.0"}s  ${text}`;
  ui.log.prepend(item);
  while (ui.log.children.length > 40) ui.log.removeChild(ui.log.lastChild);
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

makeSettings(ui.leftSettings, "trapper");
makeSettings(ui.rightSettings, "hillbilly");
ui.leftSettings.addEventListener("input", applyLayoutSettings);
ui.start.addEventListener("click", startSimulation);
ui.restart.addEventListener("click", startSimulation);
ui.reset.addEventListener("click", resetAll);

loadImages().then(() => {
  resetToIdle();
  requestAnimationFrame(loop);
});
