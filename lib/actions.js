// Actions partagées entre la CLI et les /commandes du chat.
const readline = require('readline');
const S = require('./store');
const { newSecret, makeInvite, parseInvite } = require('./crypto');

const cleanName = (s) => String(s || '').trim().replace(/^#/, '').replace(/[^\p{L}\p{N}_.-]/gu, '-').slice(0, 32);

function askName() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = () => rl.question('Ton pseudo : ', (ans) => {
      const name = ans.trim().slice(0, 32);
      if (!name) return ask();
      rl.close();
      const cfg = S.loadConfig();
      cfg.name = name;
      S.saveConfig(cfg);
      resolve(cfg);
    });
    ask();
  });
}

function uniqueName(cfg, base) {
  let name = base;
  for (let i = 2; cfg.rooms[name]; i++) name = `${base}-${i}`;
  return name;
}

function createRoom(rawName) {
  const cfg = S.loadConfig();
  const base = cleanName(rawName);
  if (!base) throw new Error('usage : new <nom-du-salon>');
  const name = uniqueName(cfg, base);
  cfg.rooms[name] = { secret: newSecret() };
  S.saveConfig(cfg);
  return { name };
}

function joinRoom(code, alias) {
  const inv = parseInvite(code || '');
  if (!inv) throw new Error('code d’invitation invalide');
  const cfg = S.loadConfig();
  const existing = Object.entries(cfg.rooms).find(([, r]) => r.secret === inv.secret);
  if (existing) return { name: existing[0] };
  const name = uniqueName(cfg, cleanName(alias || inv.name) || 'salon');
  cfg.rooms[name] = { secret: inv.secret };
  if (inv.server && inv.server !== cfg.server) cfg.rooms[name].server = inv.server;
  S.saveConfig(cfg);
  return { name };
}

function leaveRoom(name) {
  const cfg = S.loadConfig();
  if (!cfg.rooms[name]) throw new Error(`salon inconnu : ${name}`);
  delete cfg.rooms[name];
  if (cfg.lastRoom === name) delete cfg.lastRoom;
  S.saveConfig(cfg);
}

function inviteCode(cfg, name) {
  const r = cfg.rooms[name];
  if (!r) throw new Error(`salon inconnu : ${name}`);
  const server = r.server || (cfg.server !== S.DEFAULT_SERVER ? cfg.server : undefined);
  return makeInvite(name, r.secret, server);
}

module.exports = { askName, createRoom, joinRoom, leaveRoom, inviteCode };
