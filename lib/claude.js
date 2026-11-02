// Intégration Claude Code : quand tu codes avec Claude dans le terminal, ton prompt zsh
// n'est plus affiché, donc les notifs habituelles ne se voient pas. On passe par deux
// mécanismes officiels de Claude Code :
//
//  1. La barre d'état (statusLine) : relancée toutes les 2 s, elle affiche « 💬 N » et le
//     dernier message reçu. Si tu avais déjà ta propre barre, elle est conservée au-dessus.
//  2. Des hooks (UserPromptSubmit, PostToolUse, Stop) : à chaque étape de Claude, les
//     nouveaux messages s'affichent en entier dans la conversation (« systemMessage »),
//     visibles par toi uniquement : Claude ne les lit pas et ils ne coûtent aucun token.
//
// Plus une commande /tchat dans Claude Code pour lire et répondre sans quitter la session.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const S = require('./store');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const COMMAND_FILE = path.join(CLAUDE_DIR, 'commands', 'tchat.md');
const STATE_DIR = path.join(S.P.dir, 'claude');
const ORIG_STATUS = path.join(STATE_DIR, 'statusline-orig.json');
const HOOK_EVENTS = ['UserPromptSubmit', 'PostToolUse', 'Stop'];
const MARK = 'claude hook'; // reconnaît nos hooks dans settings.json

const BIN = path.join(__dirname, '..', 'bin', 'tchat.js');
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const cmd = (sub) => `${q(process.execPath)} ${q(BIN)} claude ${sub}`;

const oneLine = (s, max) => {
  const t = String(s || '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

/* ---------------------------------------------------------------- messages récents */

// Messages des autres, tous salons confondus, plus récents que `since` (secondes).
function recentMessages(since, limit = 20) {
  const cfg = S.loadConfig();
  const out = [];
  for (const room of Object.values(S.roomsByTopic(cfg))) {
    for (const m of S.loadHistory(room.topic, 200)) {
      if (m.time > since && m.cid !== cfg.clientId) out.push({ ...m, room: room.name });
    }
  }
  return out.sort((a, b) => a.time - b.time).slice(-limit);
}

function unreadInfo() {
  let total = 0;
  try { total = Number(fs.readFileSync(S.P.unread, 'utf8')) || 0; } catch {}
  return total;
}

/* ---------------------------------------------------------------- barre d'état */

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function statusline() {
  const input = readStdin();
  // Barre d'origine de l'utilisateur, conservée telle quelle (au-dessus de la nôtre).
  const orig = S.readJSON(ORIG_STATUS, null);
  if (orig && orig.command) {
    const r = spawnSync('sh', ['-c', orig.command], { input, encoding: 'utf8', timeout: 4000 });
    const text = (r.stdout || '').replace(/\n+$/, '');
    if (text) process.stdout.write(text + '\n');
  }
  const n = unreadInfo();
  const now = Math.floor(Date.now() / 1000);
  const last = recentMessages(now - 15 * 60, 1)[0];
  if (!n && !last) return;
  const fresh = last && now - last.time < 120;
  let line = n ? `\x1b[35m💬 ${n} non lu${n > 1 ? 's' : ''}\x1b[0m` : '\x1b[2m💬\x1b[0m';
  if (last && (n || fresh)) {
    const age = now - last.time < 60 ? 'à l’instant' : `il y a ${Math.round((now - last.time) / 60)} min`;
    line += ` \x1b[2m·\x1b[0m \x1b[35m#${oneLine(last.room, 20)}\x1b[0m \x1b[1m${oneLine(last.from, 20)}\x1b[0m: ${fresh ? '' : '\x1b[2m'}${oneLine(last.text, 90)}\x1b[0m \x1b[2m(${age})\x1b[0m`;
  }
  if (n) line += ' \x1b[2m· /tchat pour lire et répondre\x1b[0m';
  process.stdout.write(line + '\n');
}

/* ---------------------------------------------------------------- hooks */

// Affiche dans la conversation les messages arrivés depuis le dernier passage de CETTE session.
function hook() {
  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch {}
  const sid = String(input.session_id || 'default').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'default';
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(STATE_DIR, `seen-${sid}.json`);
  const now = Math.floor(Date.now() / 1000);
  const seen = S.readJSON(file, null);
  // Première fois dans cette session : on ne déballe pas tout l'historique.
  const since = seen ? seen.time : now - 120;
  const msgs = recentMessages(since, 8);
  S.writeJSON(file, { time: Math.max(now, ...msgs.map((m) => m.time)) });
  // Ménage : les sessions de plus d'une semaine.
  if (Math.random() < 0.05) {
    for (const f of fs.readdirSync(STATE_DIR)) {
      const p = path.join(STATE_DIR, f);
      try { if (f.startsWith('seen-') && Date.now() - fs.statSync(p).mtimeMs > 7 * 864e5) fs.unlinkSync(p); } catch {}
    }
  }
  if (!msgs.length) return;
  const lines = msgs.map((m) => `💬 #${oneLine(m.room, 24)} · ${oneLine(m.from, 24)} : ${oneLine(m.text, 400)}`);
  process.stdout.write(JSON.stringify({ systemMessage: lines.join('\n'), suppressOutput: true }));
}

/* ---------------------------------------------------------------- installation */

function loadSettings() {
  if (!fs.existsSync(SETTINGS)) return {};
  const raw = fs.readFileSync(SETTINGS, 'utf8');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch {
    throw new Error(`${SETTINGS} n'est pas du JSON valide : corrige-le puis relance « tchat claude install ».`);
  }
}
function saveSettings(obj) {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, SETTINGS + '.avant-tchat');
  const tmp = SETTINGS + '.tchat.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, SETTINGS);
}
const isOurs = (h) => typeof h?.command === 'string' && h.command.includes('tchat') && h.command.includes(MARK);

function stripHooks(settings) {
  if (!settings.hooks) return;
  for (const ev of Object.keys(settings.hooks)) {
    const groups = (settings.hooks[ev] || []).map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length);
    if (groups.length) settings.hooks[ev] = groups; else delete settings.hooks[ev];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
}

const COMMAND_MD = `---
description: Lire mes messages tchat et y répondre
argument-hint: "[salon] [message à envoyer]"
allowed-tools: Bash(tchat send:*), Bash(tchat feed)
---
Messagerie tchat de l'utilisateur (chiffrée, dans le terminal). Derniers messages :

!\`tchat feed\`

Consignes :
- Si « $ARGUMENTS » est vide : résume brièvement ces messages en français (qui a dit quoi, ce qui attend une réponse), sans rien envoyer.
- Sinon, le premier mot est le salon et le reste est le message : envoie-le exactement tel quel avec
  tchat send <salon> "<message>"
  puis confirme en une ligne.
- N'envoie jamais rien que l'utilisateur n'a pas écrit lui-même, et ne réponds jamais à sa place.
`;

function install({ quiet = false } = {}) {
  const settings = loadSettings();
  // Barre d'état : on garde celle de l'utilisateur et on ajoute la nôtre en dessous.
  const ours = cmd('statusline');
  const current = settings.statusLine;
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  if (current && current.command && !current.command.includes('claude statusline')) {
    S.writeJSON(ORIG_STATUS, { command: current.command });
  }
  settings.statusLine = { ...(current && !current.command?.includes('claude statusline') ? current : {}), type: 'command', command: ours, refreshInterval: 2 };
  stripHooks(settings);
  settings.hooks ||= {};
  for (const ev of HOOK_EVENTS) {
    settings.hooks[ev] = [...(settings.hooks[ev] || []), { hooks: [{ type: 'command', command: cmd('hook'), timeout: 5 }] }];
  }
  saveSettings(settings);
  fs.mkdirSync(path.dirname(COMMAND_FILE), { recursive: true });
  fs.writeFileSync(COMMAND_FILE, COMMAND_MD);
  if (!quiet) {
    console.log(`✓ tchat est branché sur Claude Code (${SETTINGS}).`);
    console.log('  · barre d\'état : 💬 non-lus + dernier message, mise à jour toutes les 2 s');
    console.log('  · les nouveaux messages s\'affichent dans la conversation pendant que Claude travaille');
    console.log('  · /tchat dans Claude Code pour les lire, /tchat <salon> <message> pour répondre');
    console.log('  Relance Claude Code pour en profiter. Retirer : tchat claude uninstall');
  }
}

function uninstall() {
  const settings = loadSettings();
  stripHooks(settings);
  if (settings.statusLine?.command?.includes('claude statusline')) {
    const orig = S.readJSON(ORIG_STATUS, null);
    if (orig && orig.command) {
      settings.statusLine = { ...settings.statusLine, command: orig.command };
      delete settings.statusLine.refreshInterval;
    } else delete settings.statusLine;
  }
  saveSettings(settings);
  try { fs.unlinkSync(COMMAND_FILE); } catch {}
  try { fs.unlinkSync(ORIG_STATUS); } catch {}
  console.log('✓ tchat retiré de Claude Code.');
}

function status() {
  let settings = {};
  try { settings = loadSettings(); } catch (e) { return console.log(e.message); }
  const bar = !!settings.statusLine?.command?.includes('claude statusline');
  const hooks = HOOK_EVENTS.filter((ev) => (settings.hooks?.[ev] || []).some((g) => (g.hooks || []).some(isOurs)));
  console.log(`barre d'état : ${bar ? 'oui' : 'non'} · hooks : ${hooks.length ? hooks.join(', ') : 'aucun'} · /tchat : ${fs.existsSync(COMMAND_FILE) ? 'oui' : 'non'}`);
}

// Pour /tchat : les 30 derniers messages de chaque salon actif, en texte brut.
function feed() {
  const cfg = S.loadConfig();
  const rooms = Object.values(S.roomsByTopic(cfg));
  if (!rooms.length) return console.log('(aucun salon)');
  const read = S.readJSON(S.P.read, {});
  for (const room of rooms) {
    const msgs = S.loadHistory(room.topic, 30);
    if (!msgs.length) continue;
    console.log(`## #${room.name}`);
    for (const m of msgs) {
      const d = new Date(m.time * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const who = m.cid === cfg.clientId ? `${m.from} (moi)` : m.from;
      console.log(`[${d}] ${oneLine(who, 32)}: ${oneLine(m.text, 600)}`);
    }
    const last = msgs[msgs.length - 1];
    if (last) S.markRead(room.topic, last.time);
  }
  S.refreshUnread(cfg);
}

const isInstalled = () => {
  try { return !!loadSettings().statusLine?.command?.includes('claude statusline'); } catch { return false; }
};

module.exports = { statusline, hook, install, uninstall, status, feed, isInstalled, CLAUDE_DIR };
