// Daemon d'arrière-plan : écoute tous les salons, garde l'historique,
// et pousse les notifs directement dans les terminaux zsh ouverts.
//
// L'astuce : chaque shell zsh s'enregistre dans ~/.tchat/shells/<pid>.
// À chaque message, le daemon écrit la ligne dans ce fichier (une "inbox" par shell)
// puis envoie SIGUSR1 au shell. Le TRAPUSR1 de zsh affiche la notif au-dessus
// du prompt, sans toucher à ce que tu es en train de taper.
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const S = require('./store');
const { subscribe } = require('./net');

const log = (...a) => console.log(new Date().toISOString(), ...a);

function isFocused(topic) {
  const f = S.readJSON(S.P.focus, null);
  return !!f && f.topic === topic && S.pidAlive(f.pid);
}

// Un pid peut être réutilisé par un autre programme après la fermeture d'un shell :
// on ne signale que de vrais shells (SIGUSR1 tuerait un processus qui ne l'attend pas).
function isShell(pid) {
  try {
    const comm = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim();
    return /(^|[/-])(zsh|bash)$/.test(comm);
  } catch { return false; }
}

function notifyShells(line) {
  let files = [];
  try { files = fs.readdirSync(S.P.shells); } catch {}
  for (const f of files) {
    const pid = Number(f);
    const file = path.join(S.P.shells, f);
    if (!S.pidAlive(pid) || !isShell(pid)) { try { fs.unlinkSync(file); } catch {} continue; }
    try {
      fs.appendFileSync(file, line + '\n');
      process.kill(pid, 'SIGUSR1');
    } catch {}
  }
}

const asStr = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function notifyDesktop(roomName, msg) {
  if (process.platform === 'darwin') {
    const script = `display notification ${asStr(msg.text.slice(0, 200))} with title ${asStr('tchat · #' + roomName)} subtitle ${asStr(msg.from)} sound name "Pop"`;
    spawn('osascript', ['-e', script], { stdio: 'ignore' }).on('error', () => {});
  } else {
    spawn('notify-send', [`tchat · #${roomName} — ${msg.from}`, msg.text.slice(0, 200)], { stdio: 'ignore' }).on('error', () => {});
  }
}

function run() {
  S.ensureDirs();
  // Verrou via création exclusive du fichier pid : un seul daemon même si 2 shells démarrent en même temps.
  for (;;) {
    try {
      fs.writeFileSync(S.P.daemonPid, String(process.pid), { flag: 'wx' });
      break;
    } catch {
      const other = Number(S.readJSON(S.P.daemonPid, 0));
      if (S.pidAlive(other)) { log('déjà lancé (pid', other + ')'); process.exit(0); }
      try { fs.unlinkSync(S.P.daemonPid); } catch {}
    }
  }
  const cleanup = () => {
    if (Number(S.readJSON(S.P.daemonPid, 0)) === process.pid) try { fs.unlinkSync(S.P.daemonPid); } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  const state = S.readJSON(S.P.daemonState, {});
  const startTime = Math.floor(Date.now() / 1000);
  let ctrl = null;
  let cfgRaw = '';

  // Ids déjà en historique → pas de doublons quand on rattrape le retard.
  const known = new Set();
  const loadKnown = (cfg) => {
    for (const topic of Object.keys(S.roomsByTopic(cfg))) {
      for (const m of S.loadHistory(topic, 300)) known.add(m.id);
    }
  };

  function onMessage(room, msg) {
    if (known.has(msg.id)) return;
    known.add(msg.id);
    S.appendHistory(room.topic, msg);
    state.since = Math.max(state.since || 0, msg.time);
    S.writeJSON(S.P.daemonState, state);

    const cfg = S.loadConfig();
    if (msg.cid === cfg.clientId || isFocused(room.topic)) return;
    S.refreshUnread(cfg);
    if (msg.time < startTime - 5) return; // rattrapage d'anciens messages : compteur mais pas de notif
    log(`#${room.name} ${msg.from}: ${msg.text.slice(0, 60)}`);
    notifyShells(`\x1b[35m💬 #${room.name}\x1b[0m \x1b[1m${msg.from}\x1b[0m: ${msg.text.slice(0, 300)}`);
    if (cfg.desktopNotify) notifyDesktop(room.name, msg);
  }

  function restart() {
    let raw = '';
    try { raw = fs.readFileSync(S.P.config, 'utf8'); } catch {}
    if (raw === cfgRaw) return;
    cfgRaw = raw;
    ctrl?.abort();
    const cfg = S.loadConfig();
    const rooms = S.roomsByTopic(cfg);
    if (!Object.keys(rooms).length) { log('aucun salon, en attente…'); return; }
    loadKnown(cfg);
    ctrl = new AbortController();
    log('écoute de', Object.values(rooms).map((r) => '#' + r.name).join(' '));
    subscribe({
      rooms,
      since: state.since ? state.since : 'all',
      onMessage,
      onStatus: (s, e) => log('statut:', s, e ? e.message : ''),
      signal: ctrl.signal,
    });
  }

  restart();
  fs.watchFile(S.P.config, { interval: 1500 }, restart);
  S.refreshUnread();
}

function ensureRunning() {
  S.ensureDirs();
  const pid = Number(S.readJSON(S.P.daemonPid, 0));
  if (S.pidAlive(pid)) return pid;
  const out = fs.openSync(S.P.log, 'a');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'tchat.js'), 'daemon', 'run'], {
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  return child.pid;
}

function stop() {
  const pid = Number(S.readJSON(S.P.daemonPid, 0));
  if (!S.pidAlive(pid)) return false;
  process.kill(pid, 'SIGTERM');
  return true;
}

module.exports = { run, ensureRunning, stop };
