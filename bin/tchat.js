#!/usr/bin/env node
// tchat — messagerie chiffrée de bout en bout, directement dans le terminal.
const S = require('../lib/store');
const actions = require('../lib/actions');
const daemon = require('../lib/daemon');

const SITE = 'https://tchat.187-124-38-234.sslip.io';
const [cmd, ...args] = process.argv.slice(2);

const USAGE = `tchat — messagerie dans le terminal

  tchat [salon]                ouvrir le chat (raccourci : Ctrl+G)
  tchat new <salon>            créer un salon et afficher l'invitation
  tchat join <code> [alias]    rejoindre un salon
  tchat invite [salon]         réafficher le code d'invitation
  tchat rooms                  lister les salons + non-lus
  tchat send <salon> <msg…>    envoyer un message sans ouvrir le chat
  tchat leave <salon>          quitter un salon
  tchat name <pseudo>          changer de pseudo
  tchat notif on|off           notifs macOS on/off
  tchat server <url>           serveur ntfy (défaut : ${S.DEFAULT_SERVER})
  tchat update                 mettre à jour tchat
  tchat daemon start|stop|status|log
`;

function die(msg) { console.error(msg); process.exit(1); }

async function main() {
  S.ensureDirs();
  const cfg = S.loadConfig();
  switch (cmd) {
    case undefined: case 'chat': case 'open':
      return require('../lib/chat').run(args[0]);
    case 'help': case '-h': case '--help':
      return console.log(USAGE);
    case 'new': {
      const { name } = actions.createRoom(args.join(' '));
      daemon.ensureRunning();
      console.log(`Salon #${name} créé. Envoie ça à tes potes :\n\n  tchat join ${actions.inviteCode(S.loadConfig(), name)}\n`);
      return;
    }
    case 'join': {
      if (!args[0]) die('usage : tchat join <code> [alias]');
      const { name } = actions.joinRoom(args[0], args[1]);
      daemon.ensureRunning();
      return console.log(`✓ Tu as rejoint #${name}. Lance « tchat ${name} » ou Ctrl+G.`);
    }
    case 'invite': {
      const name = S.findRoom(cfg, args[0] || cfg.lastRoom)?.name || Object.keys(cfg.rooms)[0];
      if (!name) die('aucun salon');
      return console.log(`tchat join ${actions.inviteCode(cfg, name)}`);
    }
    case 'rooms': case 'ls': {
      const { perRoom } = S.refreshUnread(cfg);
      const names = Object.keys(cfg.rooms);
      if (!names.length) return console.log('Aucun salon. « tchat new <nom> » ou « tchat join <code> ».');
      for (const n of names) console.log(`#${n}${perRoom[n] ? `  (${perRoom[n]} non lu${perRoom[n] > 1 ? 's' : ''})` : ''}`);
      return;
    }
    case 'send': {
      const room = S.findRoom(cfg, args[0]);
      const text = args.slice(1).join(' ').trim();
      if (!room || !text) die('usage : tchat send <salon> <message>');
      if (!cfg.name) die('choisis d’abord un pseudo : tchat name <pseudo>');
      await require('../lib/net').sendMessage(cfg, room, text);
      return;
    }
    case 'leave': {
      const room = S.findRoom(cfg, args[0]);
      if (!room) die('salon inconnu');
      actions.leaveRoom(room.name);
      return console.log(`Tu as quitté #${room.name}.`);
    }
    case 'name': {
      if (!args[0]) return console.log(cfg.name || '(pas de pseudo)');
      cfg.name = args.join(' ').slice(0, 32);
      S.saveConfig(cfg);
      return console.log(`pseudo → ${cfg.name}`);
    }
    case 'notif': {
      cfg.desktopNotify = args[0] !== 'off';
      S.saveConfig(cfg);
      return console.log(`notifs bureau : ${cfg.desktopNotify ? 'on' : 'off'}`);
    }
    case 'server': {
      if (!args[0]) return console.log(cfg.server);
      cfg.server = args[0].replace(/\/+$/, '');
      S.saveConfig(cfg);
      return console.log(`serveur → ${cfg.server} (les salons existants gardent le leur)`);
    }
    case 'update': {
      const { spawnSync } = require('child_process');
      const r = spawnSync('sh', ['-c', `curl -fsSL ${SITE}/install.sh | sh`], { stdio: 'inherit' });
      return process.exit(r.status ?? 1);
    }
    case 'version': case '-v': case '--version':
      return console.log(require('../package.json').version);
    case 'unread':
      return console.log(S.refreshUnread(cfg).total);
    case 'daemon': {
      const sub = args[0] || 'status';
      if (sub === 'run') return daemon.run();
      if (sub === 'start') return void daemon.ensureRunning();
      if (sub === 'stop') return console.log(daemon.stop() ? 'daemon arrêté' : 'daemon pas lancé');
      if (sub === 'restart') { daemon.stop(); await new Promise((r) => setTimeout(r, 300)); daemon.ensureRunning(); return console.log('daemon relancé'); }
      if (sub === 'log') return console.log(require('fs').readFileSync(S.P.log, 'utf8').split('\n').slice(-30).join('\n'));
      const pid = Number(S.readJSON(S.P.daemonPid, 0));
      return console.log(S.pidAlive(pid) ? `daemon actif (pid ${pid})` : 'daemon arrêté');
    }
    default: {
      // « tchat potes » ouvre directement le salon #potes
      if (S.findRoom(cfg, cmd)) return require('../lib/chat').run(cmd);
      die(USAGE);
    }
  }
}

main().catch((e) => die('erreur : ' + e.message));
