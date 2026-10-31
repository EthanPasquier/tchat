// Transport : ntfy.sh (ou n'importe quel serveur ntfy auto-hébergé) comme relais pub/sub.
// Marche à travers n'importe quel NAT / réseau : tout passe en HTTPS sortant.
const { encrypt, decrypt, sanitize } = require('./crypto');

const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

async function publish(room, payload) {
  const body = encrypt(room.key, room.topic, payload);
  const res = await fetch(`${room.server}/${room.topic}`, { method: 'POST', body });
  if (!res.ok) throw new Error(`envoi refusé par le serveur (HTTP ${res.status})`);
  return res.json(); // { id, time, ... }
}

function sendMessage(cfg, room, text) {
  return publish(room, { f: cfg.name, c: cfg.clientId, t: text, ts: Date.now() });
}

// Transforme un événement ntfy en message déchiffré, ou null si illisible.
function openMessage(room, ev) {
  const p = decrypt(room.key, room.topic, ev.message);
  if (!p || typeof p.t !== 'string') return null;
  return { id: ev.id, time: ev.time, from: sanitize(p.f || '???', 32), cid: p.c, text: sanitize(p.t) };
}

// Abonnement en streaming à plusieurs salons, avec reconnexion automatique
// et watchdog (ntfy envoie un keepalive toutes les ~45 s ; sans nouvelles en 100 s on relance).
// Groupé par serveur : en pratique un seul flux HTTP pour tous les salons.
function subscribe({ rooms, since, onMessage, onStatus, signal }) {
  const byServer = {};
  for (const r of Object.values(rooms)) (byServer[r.server] ||= []).push(r);
  const seen = new Set();
  for (const [server, list] of Object.entries(byServer)) {
    loop(server, list).catch(() => {});
  }

  async function loop(server, list) {
    const topics = Object.fromEntries(list.map((r) => [r.topic, r]));
    let cursor = since;
    let backoff = 1000;
    while (!signal.aborted) {
      const conn = new AbortController();
      const kill = () => conn.abort();
      signal.addEventListener('abort', kill, { once: true });
      let watchdog;
      const pet = () => { clearTimeout(watchdog); watchdog = setTimeout(kill, 100_000); };
      try {
        const qs = cursor ? `?since=${cursor}` : '';
        pet();
        const res = await fetch(`${server}/${Object.keys(topics).join(',')}/json${qs}`, { signal: conn.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        onStatus?.('online');
        backoff = 1000;
        const dec = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body) {
          pet();
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            let ev;
            try { ev = JSON.parse(line); } catch { continue; }
            if (ev.event !== 'message' || seen.has(ev.id)) continue;
            seen.add(ev.id);
            if (seen.size > 5000) seen.delete(seen.values().next().value);
            cursor = ev.time;
            const room = topics[ev.topic];
            const msg = room && openMessage(room, ev);
            if (msg) onMessage(room, msg);
          }
        }
        throw new Error('flux fermé');
      } catch (e) {
        if (signal.aborted) break;
        onStatus?.('offline', e);
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, 30_000);
      } finally {
        clearTimeout(watchdog);
        signal.removeEventListener('abort', kill);
      }
    }
  }
}

module.exports = { publish, sendMessage, subscribe, sleep };
