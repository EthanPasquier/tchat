// Interface de chat interactive dans le terminal.
const readline = require('readline');
const fs = require('fs');
const S = require('./store');
const { subscribe, sendMessage } = require('./net');
const actions = require('./actions');
const daemon = require('./daemon');

const out = process.stdout;
const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
  inv: (s) => `\x1b[7m${s}\x1b[0m`,
};
const PALETTE = [39, 208, 170, 114, 220, 75, 203, 141, 49, 214];
function nameColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `\x1b[1;38;5;${PALETTE[h % PALETTE.length]}m${name}\x1b[0m`;
}
const hhmm = (t) => new Date(t * 1000).toTimeString().slice(0, 5);

const HELP = `
  ${c.bold('Commandes')}
  /r <salon>        changer de salon (préfixe suffit)
  /rooms            liste des salons + non-lus
  /new <salon>      créer un salon
  /join <code>      rejoindre avec un code d'invitation
  /invite           afficher le code d'invitation du salon
  /leave            quitter le salon courant
  /name <pseudo>    changer de pseudo
  /notif on|off     notifs macOS on/off
  /clear            nettoyer l'écran
  /quit             fermer (ou Ctrl+C / Ctrl+D)
`;

async function run(roomArg) {
  let cfg = S.loadConfig();
  if (!cfg.name) cfg = await actions.askName();
  daemon.ensureRunning();

  let room = S.findRoom(cfg, roomArg || cfg.lastRoom) || Object.values(S.roomsByTopic(cfg))[0] || null;
  let status = 'connecting';
  let ctrl = null;
  const startTime = Math.floor(Date.now() / 1000);
  const shown = new Set();

  const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true, historySize: 200 });

  function print(line) {
    readline.clearLine(out, 0);
    readline.cursorTo(out, 0);
    out.write(line + '\n');
    rl.prompt(true);
  }
  const info = (s) => print(c.dim('  ' + s));

  function setPrompt() {
    rl.setPrompt(room ? `${c.magenta('#' + room.name)} ${c.dim('›')} ` : c.dim('(aucun salon) › '));
  }

  function fmt(msg) {
    const me = msg.cid === cfg.clientId;
    return `${c.dim(hhmm(msg.time))} ${me ? c.bold(c.green(msg.from)) : nameColor(msg.from)} ${c.dim('│')} ${msg.text}`;
  }

  function header() {
    const rooms = Object.keys(cfg.rooms).length;
    const title = ` tchat · ${room ? '#' + room.name : 'aucun salon'} · ${cfg.name} · ${rooms} salon${rooms > 1 ? 's' : ''} `;
    out.write(`${c.inv(title)} ${c.dim('🔒 chiffré de bout en bout — /help')}\n\n`);
  }

  function focus() {
    if (!room) { try { fs.unlinkSync(S.P.focus); } catch {} return; }
    S.writeJSON(S.P.focus, { topic: room.topic, pid: process.pid });
    cfg.lastRoom = room.name;
    S.saveConfig(cfg);
    const last = S.loadHistory(room.topic, 1)[0];
    S.markRead(room.topic, Math.max(last?.time || 0, Math.floor(Date.now() / 1000)));
    S.refreshUnread(cfg);
  }

  function redraw() {
    out.write('\x1b[2J\x1b[H');
    header();
    if (!room) {
      out.write(`  Pas encore de salon.\n  ${c.bold('/new <nom>')} pour en créer un, ou ${c.bold('/join <code>')} avec l'invitation d'un pote.\n\n`);
    } else {
      const hist = S.loadHistory(room.topic, Math.max(20, (out.rows || 30) - 4));
      if (!hist.length) out.write(c.dim('  Aucun message pour l’instant. /invite pour inviter tes potes.\n'));
      for (const m of hist) { shown.add(m.id); out.write(fmt(m) + '\n'); }
    }
    setPrompt();
    rl.prompt(true);
  }

  function onMessage(r, msg) {
    if (shown.has(msg.id)) return;
    shown.add(msg.id);
    if (room && r.topic === room.topic) {
      print(fmt(msg));
      S.markRead(r.topic, msg.time);
    } else if (msg.time >= startTime && msg.cid !== cfg.clientId) {
      out.write('\x07');
      print(c.dim(`  ↳ #${r.name} · `) + nameColor(msg.from) + c.dim(': ' + msg.text.slice(0, 120)));
    }
  }

  function connect() {
    ctrl?.abort();
    const rooms = S.roomsByTopic(cfg);
    if (!Object.keys(rooms).length) return;
    ctrl = new AbortController();
    subscribe({
      rooms,
      since: 'all', // rattrape le cache du serveur (12 h sur ntfy.sh), dédoublonné via `shown`
      onMessage,
      onStatus: (s) => {
        if (s === status) return;
        if (s === 'online' && status === 'offline') info(c.green('● reconnecté'));
        if (s === 'offline') info(c.red('● hors ligne, reconnexion…'));
        status = s;
      },
      signal: ctrl.signal,
    });
  }

  function reload() {
    cfg = S.loadConfig();
    connect();
  }

  async function handleCommand(line) {
    const [cmd, ...rest] = line.slice(1).split(' ');
    const arg = rest.join(' ').trim();
    switch (cmd) {
      case 'h': case 'help': print(HELP); break;
      case 'q': case 'quit': case 'exit': quit(); break;
      case 'clear': redraw(); break;
      case 'r': case 'room': case 'switch': {
        const r = S.findRoom(cfg, arg);
        if (!r) { info(`salon introuvable : ${arg || '(vide)'} — /rooms pour la liste`); break; }
        room = r; focus(); redraw(); break;
      }
      case 'rooms': {
        const { perRoom } = S.refreshUnread(cfg);
        const names = Object.keys(cfg.rooms);
        if (!names.length) { info('aucun salon'); break; }
        for (const n of names) {
          const u = perRoom[n] ? c.magenta(` (${perRoom[n]} non lu${perRoom[n] > 1 ? 's' : ''})`) : '';
          print(`  ${room && n === room.name ? c.bold('› #' + n) : '  #' + n}${u}`);
        }
        break;
      }
      case 'new': case 'join': {
        try {
          const res = cmd === 'new' ? actions.createRoom(arg) : actions.joinRoom(arg);
          reload();
          room = S.findRoom(cfg, res.name);
          focus(); redraw();
          if (cmd === 'new') printInvite();
        } catch (e) { info(e.message); }
        break;
      }
      case 'invite': printInvite(); break;
      case 'leave': {
        if (!room) break;
        const name = room.name;
        actions.leaveRoom(name);
        reload();
        room = Object.values(S.roomsByTopic(cfg))[0] || null;
        focus(); redraw();
        info(`tu as quitté #${name}`);
        break;
      }
      case 'name': {
        if (!arg) { info(`pseudo actuel : ${cfg.name}`); break; }
        cfg.name = arg.slice(0, 32);
        S.saveConfig(cfg);
        info(`pseudo → ${cfg.name}`);
        break;
      }
      case 'notif': {
        cfg.desktopNotify = arg !== 'off';
        S.saveConfig(cfg);
        info(`notifs bureau : ${cfg.desktopNotify ? 'on' : 'off'}`);
        break;
      }
      default: info(`commande inconnue /${cmd} — /help`);
    }
  }

  function printInvite() {
    if (!room) return;
    const code = actions.inviteCode(cfg, room.name);
    print(`\n  Invitation pour ${c.bold('#' + room.name)} — envoie ça à tes potes :\n\n  ${c.green('tchat join ' + code)}\n\n  ${c.dim('(quiconque a ce code peut lire et écrire dans le salon)')}\n`);
  }

  function quit() {
    ctrl?.abort();
    try {
      const f = S.readJSON(S.P.focus, null);
      if (f?.pid === process.pid) fs.unlinkSync(S.P.focus);
    } catch {}
    S.refreshUnread();
    rl.close();
    process.exit(0);
  }

  rl.on('line', async (raw) => {
    const line = raw.trim();
    // efface la ligne tapée (elle sera réaffichée formatée)
    readline.moveCursor(out, 0, -1);
    readline.clearLine(out, 0);
    if (!line) { rl.prompt(true); return; }
    if (line.startsWith('/')) return handleCommand(line);
    if (!room) { info('pas de salon : /new <nom> ou /join <code>'); return; }
    if (line.length > 2000) { info('message trop long (2000 caractères max)'); return; }
    try {
      const ev = await sendMessage(cfg, room, line);
      onMessage(room, { id: ev.id, time: ev.time, from: cfg.name, cid: cfg.clientId, text: line });
    } catch (e) {
      info(c.red('✗ non envoyé : ' + e.message));
    }
  });
  rl.on('close', quit);
  process.on('SIGTERM', quit);

  // Écran alternatif : en quittant, le terminal retrouve exactement son état d'avant.
  out.write('\x1b[?1049h');
  process.on('exit', () => out.write('\x1b[?1049l'));

  focus();
  redraw();
  connect();
}

module.exports = { run };
