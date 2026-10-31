// Chiffrement de bout en bout : le relais (ntfy) ne voit que du bruit.
// Chaque salon = un secret aléatoire de 32 octets. Du secret on dérive :
//   - le topic ntfy (impossible à deviner)
//   - la clé AES-256-GCM
const crypto = require('crypto');

function newSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function deriveRoom(secret) {
  const s = Buffer.from(secret, 'base64url');
  const topic = 'tc_' + crypto.createHash('sha256').update('tchat-topic').update(s).digest('hex').slice(0, 40);
  const key = Buffer.from(crypto.hkdfSync('sha256', s, Buffer.alloc(0), 'tchat-key', 32));
  return { topic, key };
}

function encrypt(key, topic, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(topic));
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64url');
}

function decrypt(key, topic, data) {
  try {
    const buf = Buffer.from(data, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAAD(Buffer.from(topic));
    d.setAuthTag(buf.subarray(buf.length - 16));
    const pt = Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]);
    return JSON.parse(pt.toString('utf8'));
  } catch {
    return null;
  }
}

// Un code d'invitation contient le nom du salon + le secret (+ serveur si non standard).
function makeInvite(name, secret, server) {
  const data = { n: name, s: secret };
  if (server) data.h = server;
  return 'tc-' + Buffer.from(JSON.stringify(data)).toString('base64url');
}

function parseInvite(code) {
  try {
    const d = JSON.parse(Buffer.from(code.trim().replace(/^tc-/, ''), 'base64url').toString('utf8'));
    if (typeof d.n !== 'string' || typeof d.s !== 'string') return null;
    return { name: d.n, secret: d.s, server: d.h };
  } catch {
    return null;
  }
}

// Retire les caractères de contrôle : un message ne doit jamais pouvoir
// injecter des séquences d'échappement dans le terminal de quelqu'un.
function sanitize(str, max = 4000) {
  return String(str ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, max);
}

module.exports = { newSecret, deriveRoom, encrypt, decrypt, makeInvite, parseInvite, sanitize };
