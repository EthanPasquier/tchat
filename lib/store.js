// Stockage local : config, historique, compteurs de non-lus, inbox des shells.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { deriveRoom } = require('./crypto');

const DIR = process.env.TCHAT_HOME || path.join(os.homedir(), '.tchat');
const P = {
  dir: DIR,
  config: path.join(DIR, 'config.json'),
  history: path.join(DIR, 'history'),
  shells: path.join(DIR, 'shells'),
  read: path.join(DIR, 'read.json'),
  unread: path.join(DIR, 'unread'),
  focus: path.join(DIR, 'focus.json'),
  daemonPid: path.join(DIR, 'daemon.pid'),
  daemonState: path.join(DIR, 'daemon-state.json'),
  log: path.join(DIR, 'daemon.log'),
};

const DEFAULT_SERVER = 'https://relay.tchat.187-124-38-234.sslip.io';

function ensureDirs() {
  for (const d of [P.dir, P.history, P.shells]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Écriture atomique : le daemon et le chat lisent ces fichiers en parallèle.
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const writeJSON = (file, obj) => writeAtomic(file, JSON.stringify(obj, null, 2));

function loadConfig() {
  const cfg = readJSON(P.config, {});
  cfg.rooms ||= {};
  cfg.server ||= DEFAULT_SERVER;
  cfg.clientId ||= crypto.randomBytes(8).toString('hex');
  if (cfg.desktopNotify === undefined) cfg.desktopNotify = true;
  return cfg;
}
const saveConfig = (cfg) => { ensureDirs(); writeJSON(P.config, cfg); };

// topic ntfy -> { name, key, server }
function roomsByTopic(cfg) {
  const out = {};
  for (const [name, r] of Object.entries(cfg.rooms)) {
    const { topic, key } = deriveRoom(r.secret);
    out[topic] = { name, topic, key, server: r.server || cfg.server };
  }
  return out;
}

function findRoom(cfg, name) {
  if (!name) return null;
  const rooms = roomsByTopic(cfg);
  return Object.values(rooms).find((r) => r.name === name)
    || Object.values(rooms).find((r) => r.name.toLowerCase().startsWith(name.toLowerCase()))
    || null;
}

const historyFile = (topic) => path.join(P.history, `${topic}.jsonl`);

function appendHistory(topic, msg) {
  fs.appendFileSync(historyFile(topic), JSON.stringify(msg) + '\n', { mode: 0o600 });
}

function loadHistory(topic, limit = Infinity) {
  let raw;
  try { raw = fs.readFileSync(historyFile(topic), 'utf8'); } catch { return []; }
  const lines = raw.split('\n').filter(Boolean);
  const msgs = [];
  for (const l of lines.slice(-Math.min(limit, lines.length))) {
    try { msgs.push(JSON.parse(l)); } catch {}
  }
  return msgs;
}

function markRead(topic, time) {
  const read = readJSON(P.read, {});
  if ((read[topic] || 0) >= time) return;
  read[topic] = time;
  writeJSON(P.read, read);
}

// Recalcule le total des non-lus et l'écrit dans ~/.tchat/unread (lu par le prompt zsh).
function refreshUnread(cfg = loadConfig()) {
  const read = readJSON(P.read, {});
  const perRoom = {};
  let total = 0;
  for (const room of Object.values(roomsByTopic(cfg))) {
    const since = read[room.topic] || 0;
    const n = loadHistory(room.topic, 500).filter((m) => m.time > since && m.cid !== cfg.clientId).length;
    perRoom[room.name] = n;
    total += n;
  }
  try { writeAtomic(P.unread, String(total)); } catch {}
  return { total, perRoom };
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

module.exports = {
  P, DEFAULT_SERVER, ensureDirs, readJSON, writeJSON, writeAtomic,
  loadConfig, saveConfig, roomsByTopic, findRoom,
  appendHistory, loadHistory, markRead, refreshUnread, pidAlive,
};
