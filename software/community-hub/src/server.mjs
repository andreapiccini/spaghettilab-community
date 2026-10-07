import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { ApiError, collections, publicSnapshot, seedDatabase, validateEntry } from './model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loopback = (host) => ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'].includes(host);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function createHub(options = {}) {
  const directory = options.directory ?? process.env.HUB_DATA_DIR ?? path.join(root, 'data');
  const host = options.host ?? process.env.HUB_HOST ?? '127.0.0.1';
  const allowLocalAdmin = options.allowLocalAdmin ?? (loopback(host) && process.env.HUB_LOCAL_ADMIN !== '0');
  if (!loopback(host) && !process.env.HUB_ADMIN_TOKEN && !options.adminToken) throw new Error('Set HUB_ADMIN_TOKEN before binding a public interface');
  await mkdir(path.join(directory, 'files'), { recursive: true });
  let adminToken = options.adminToken ?? process.env.HUB_ADMIN_TOKEN;
  if (!adminToken) {
    try { adminToken = await readFile(path.join(directory, 'admin-token.txt'), 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      adminToken = randomBytes(32).toString('hex');
      await writeFile(path.join(directory, 'admin-token.txt'), adminToken, { mode: 0o600 });
    }
  }
  const store = await openStore(directory, options.seed ?? await seedDatabase());
  const sessions = new Map();
  const subscribers = new Set();
  const limits = new Map();
  const origins = (process.env.HUB_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',');
  const maxFile = options.maxFile ?? 64 * 1024 * 1024;

  function identity(req) {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    if (same(bearer, adminToken)) return { admin: true, userId: 'admin' };
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)hub_session=([a-f0-9]+)/)?.[1];
    const token = bearer ?? cookie;
    const session = sessions.get(token);
    if (!session || session.expires < Date.now()) { sessions.delete(token); return null; }
    return session;
  }
  function requireAdmin(req) { if (!identity(req)?.admin) throw new ApiError(401, 'Accesso amministratore richiesto'); }
  function requireUser(req) {
    const current = identity(req);
    if (!current || current.admin) throw new ApiError(401, 'Accedi al tuo account per partecipare');
    return current;
  }
  function sessionFor(userId, admin = false) {
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { userId, admin, expires: Date.now() + 86400000 });
    return token;
  }
  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(status === 204 || status === 304 ? undefined : JSON.stringify(body));
  }
  async function body(req, maximum = 1024 * 1024) {
    if (Number(req.headers['content-length']) > maximum) throw new ApiError(413, 'File troppo grande');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maximum) throw new ApiError(413, 'File troppo grande');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function json(req) {
    try { return JSON.parse((await body(req)).toString('utf8')); }
    catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'JSON non valido'); }
  }
  function rate(req, category, maximum = 30) {
    const key = `${req.socket.remoteAddress}:${category}`;
    const now = Date.now();
    let bucket = limits.get(key);
    if (!bucket || bucket.until < now) { bucket = { count: 0, until: now + 60000 }; limits.set(key, bucket); }
    if (++bucket.count > maximum) throw new ApiError(429, 'Troppe richieste: riprova tra un minuto');
    if (limits.size > 10000) for (const [id, item] of limits) if (item.until < now) limits.delete(id);
  }
  function notify(kind, id) {
    const data = `event: sync\ndata: ${JSON.stringify({ revision: store.read().revision, kind, id })}\n\n`;
    for (const client of subscribers) client.write(data);
  }
  const change = async (kind, operation, actor = 'admin') => {
    const result = await store.change((database) => {
      const value = operation(database);
      database.audit.push({ at: new Date().toISOString(), actor, kind });
      database.audit = database.audit.slice(-1000);
      return value;
    });
    notify(kind, result?.id);
    return result;
  };

  const server = createServer(async (req, res) => {
    try {
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('referrer-policy', 'same-origin');
      const origin = req.headers.origin;
      const ownOrigin = `${process.env.HUB_PUBLIC_ORIGIN ?? `http://${req.headers.host}`}`;
      if (origin) {
        if (origin !== ownOrigin && !origins.includes(origin)) throw new ApiError(403, 'Origine non autorizzata');
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'Origin');
        res.setHeader('access-control-allow-credentials', 'true');
        res.setHeader('access-control-expose-headers', 'etag,content-disposition');
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader('access-control-allow-headers', 'content-type,authorization,x-filename,if-none-match');
        send(res, 204); return;
      }
      const url = new URL(req.url, 'http://hub.local');
      const parts = url.pathname.split('/').filter(Boolean);
      const [api, version, resource, id, action] = parts;
      if (req.method === 'GET' && url.pathname === '/health') { send(res, 200, { ok: true, revision: store.read().revision }); return; }
      if (req.method === 'GET' && ['/admin', '/admin/', '/', '/admin.js', '/admin.css', '/cover.svg'].includes(url.pathname)) {
        const name = url.pathname.endsWith('.js') ? 'admin.js' : url.pathname.endsWith('.css') ? 'admin.css' : url.pathname.endsWith('.svg') ? 'cover.svg' : 'admin.html';
        const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
        res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
        res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
        res.end(await readFile(path.join(root, 'public', name))); return;
      }
      if (api !== 'api' || version !== 'v1') throw new ApiError(404, 'Risorsa non trovata');
      if (resource === 'sync' && req.method === 'GET') {
        const snapshot = publicSnapshot(store.read());
        const etag = `"${snapshot.revision}"`;
        send(res, req.headers['if-none-match'] === etag ? 304 : 200, snapshot, { etag }); return;
      }
      if (resource === 'nfc' && req.method === 'GET') {
        const snapshot = publicSnapshot(store.read());
        const modules = snapshot.modules.filter((entry) => (!url.searchParams.has('registryId') || entry.registryId === Number(url.searchParams.get('registryId'))) && (!url.searchParams.has('vendorId') || entry.vendorId === Number(url.searchParams.get('vendorId'))) && (!url.searchParams.has('moduleTypeId') || entry.moduleTypeId === Number(url.searchParams.get('moduleTypeId'))));
        send(res, 200, { revision: snapshot.revision, modules }); return;
      }
      if (resource === 'marketplace-index' && req.method === 'GET') {
        const entries = publicSnapshot(store.read()).packages.filter((entry) => entry.manifest && ['capability-pack', 'device-profile'].includes(entry.kind)).map((entry) => ({ ...entry.manifest, kind: entry.kind === 'capability-pack' ? 'firmware-capability-pack' : 'device-profile' }));
        send(res, 200, { packs: entries }); return;
      }
      if (resource === 'events' && req.method === 'GET') {
        if (subscribers.size >= 200) throw new ApiError(503, 'Troppe connessioni');
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write(`event: sync\ndata: ${JSON.stringify({ revision: store.read().revision, kind: 'connected' })}\n\n`);
        subscribers.add(res);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
        req.on('close', () => { clearInterval(heartbeat); subscribers.delete(res); }); return;
      }
      if (resource === 'files' && req.method === 'GET') {
        const database = store.read();
        const file = database.files.find((item) => item.id === id);
        const published = collections.some((name) => database[name].some((item) => item.published && (item.fileId === id || item.coverId === id)));
        if (!file || (!published && !identity(req)?.admin)) throw new ApiError(404, 'File non disponibile');
        res.writeHead(200, { 'content-type': file.contentType, 'content-length': file.size, 'cache-control': published ? 'public,max-age=31536000,immutable' : 'private,no-store', 'content-disposition': `${file.contentType.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`, etag: `"${file.sha256}"` });
        createReadStream(path.join(directory, 'files', file.id)).on('error', () => res.destroy()).pipe(res); return;
      }
      if (resource === 'auth') {
        rate(req, 'auth', 15);
        if (id === 'me' && req.method === 'GET') {
          const current = identity(req);
          const user = current && store.read().users.find((item) => item.id === current.userId);
          send(res, 200, current ? { admin: current.admin, user: user && { id: user.id, displayName: user.displayName, username: user.username } } : { user: null }); return;
        }
        if (id === 'logout' && req.method === 'POST') {
          sessions.delete(req.headers.authorization?.replace(/^Bearer /, '') ?? req.headers.cookie?.match(/hub_session=([a-f0-9]+)/)?.[1]);
          send(res, 200, { ok: true }, { 'set-cookie': 'hub_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); return;
        }
        if (id === 'local-admin' && req.method === 'POST') {
          if (!allowLocalAdmin || !loopback(req.socket.remoteAddress) || !loopback(new URL(ownOrigin).hostname) || origin !== ownOrigin) throw new ApiError(403, 'Accesso locale non disponibile');
          const token = sessionFor('admin', true);
          send(res, 200, { admin: true }, { 'set-cookie': `hub_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400` }); return;
        }
        if (id === 'admin' && req.method === 'POST') {
          const input = await json(req);
          if (!same(input.token, adminToken)) throw new ApiError(401, 'Credenziale non valida');
          send(res, 200, { admin: true }, { 'set-cookie': `hub_session=${sessionFor('admin', true)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.HUB_SECURE_COOKIES === '1' ? '; Secure' : ''}` }); return;
        }
        if (['register', 'login'].includes(id) && req.method === 'POST') {
          const input = await json(req);
          const username = String(input.username ?? '').trim().toLowerCase();
          if (!/^[a-z0-9_.-]{3,40}$/.test(username) || typeof input.password !== 'string' || input.password.length < 10 || input.password.length > 128) throw new ApiError(400, 'Nome utente di 3–40 caratteri e password di almeno 10 caratteri richiesti');
          let user;
          if (id === 'register') {
            if (typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 80) throw new ApiError(400, 'Indica il tuo nome pubblico');
            const salt = randomBytes(16).toString('hex');
            const passwordHash = scryptSync(input.password, salt, 64).toString('hex');
            user = await store.change((database) => {
              if (database.users.some((item) => item.username === username)) throw new ApiError(409, 'Nome utente già utilizzato');
              const created = { id: randomUUID(), username, displayName: input.displayName.trim(), salt, passwordHash };
              database.users.push(created); return created;
            });
          } else {
            user = store.read().users.find((item) => item.username === username);
            const candidate = scryptSync(input.password, user?.salt ?? 'invalid-user', 64).toString('hex');
            if (!user || !same(candidate, user.passwordHash)) throw new ApiError(401, 'Credenziali non valide');
          }
          send(res, 200, { token: sessionFor(user.id), user: { id: user.id, displayName: user.displayName, username } }); return;
        }
      }
      if (resource === 'account' && req.method === 'GET') {
        const user = requireUser(req); const database = store.read();
        send(res, 200, { votes: database.votes.filter((item) => item.userId === user.userId), submissions: database.submissions.filter((item) => item.userId === user.userId) }); return;
      }
      if (resource === 'polls' && action === 'vote' && req.method === 'POST') {
        rate(req, 'participation'); const user = requireUser(req); const input = await json(req);
        const result = await change('vote', (database) => {
          const poll = database.polls.find((item) => item.id === id && item.published);
          if (!poll || Date.parse(poll.closesAt) <= Date.now()) throw new ApiError(409, 'Votazione chiusa');
          if (!Number.isInteger(input.option) || input.option < 0 || input.option >= poll.options.length) throw new ApiError(400, 'Opzione non valida');
          const existing = database.votes.find((item) => item.pollId === id && item.userId === user.userId);
          if (existing) existing.option = input.option;
          else database.votes.push({ pollId: id, userId: user.userId, option: input.option });
          return { id, option: input.option };
        }, user.userId);
        send(res, 200, result); return;
      }
      if (resource === 'contests' && action === 'submissions' && req.method === 'POST') {
        rate(req, 'participation'); const user = requireUser(req); const input = await json(req);
        if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160 || typeof input.description !== 'string' || input.description.length > 5000) throw new ApiError(400, 'Progetto non valido');
        const projectUrl = new URL(input.projectUrl);
        if (!['http:', 'https:'].includes(projectUrl.protocol) || projectUrl.username || projectUrl.password || projectUrl.href.length > 2000) throw new ApiError(400, 'Collegamento non valido');
        const result = await change('submission', (database) => {
          const contest = database.contests.find((item) => item.id === id && item.published);
          if (!contest || Date.parse(contest.closesAt) <= Date.now()) throw new ApiError(409, 'Contest chiuso');
          if (database.submissions.some((item) => item.contestId === id && item.userId === user.userId)) throw new ApiError(409, 'Hai già inviato un progetto a questo contest');
          const submitted = { id: randomUUID(), contestId: id, userId: user.userId, displayName: database.users.find((item) => item.id === user.userId).displayName, title: input.title.trim(), description: input.description, projectUrl: projectUrl.href, createdAt: new Date().toISOString() };
          database.submissions.push(submitted); return { id: submitted.id };
        }, user.userId);
        send(res, 201, result); return;
      }
      if (resource === 'admin') {
        requireAdmin(req);
        if (id === 'state' && req.method === 'GET') {
          const database = store.read(); delete database.users;
          send(res, 200, database); return;
        }
        if (id === 'uploads' && req.method === 'POST') {
          rate(req, 'uploads', 60);
          const bytes = await body(req, maxFile);
          if (!bytes.length) throw new ApiError(400, 'File vuoto');
          let name;
          try { name = decodeURIComponent(req.headers['x-filename'] ?? 'download.bin'); }
          catch { throw new ApiError(400, 'Nome file non valido'); }
          name = name.replace(/[/\\\x00-\x1f]/g, '_').slice(0, 180);
          const contentType = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : 'application/octet-stream';
          const sha256 = hash(bytes);
          await writeFile(path.join(directory, 'files', sha256), bytes, { flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
          const file = { id: sha256, name, contentType, sha256, size: bytes.length };
          await change('upload', (database) => { if (!database.files.some((item) => item.id === sha256)) database.files.push(file); return file; });
          send(res, 201, file); return;
        }
        if (id === 'awards' && req.method === 'POST') {
          const input = await json(req);
          if (typeof input.prize !== 'string' || !input.prize.trim() || input.prize.length > 500) throw new ApiError(400, 'Premio non valido');
          const awarded = await change('award', (database) => {
            const submission = database.submissions.find((item) => item.id === input.submissionId);
            if (!submission) throw new ApiError(404, 'Candidatura non trovata');
            if (database.awards.some((item) => item.submissionId === submission.id)) throw new ApiError(409, 'Candidatura già premiata');
            const award = { id: randomUUID(), contestId: submission.contestId, submissionId: submission.id, prize: input.prize.trim(), createdAt: new Date().toISOString() };
            database.awards.push(award); return award;
          }); send(res, 201, awarded); return;
        }
        if (collections.includes(id) && ['POST', 'PUT'].includes(req.method)) {
          const input = await json(req);
          const result = await change(`save-${id}`, (database) => {
            const validated = validateEntry(id, input, database.files);
            const existing = action && database[id].find((item) => item.id === action);
            if (req.method === 'PUT' && !existing) throw new ApiError(404, 'Contenuto non trovato');
            if (id === 'modules' && database.modules.some((item) => item.id !== existing?.id && item.registryId === validated.registryId && item.vendorId === validated.vendorId && item.moduleTypeId === validated.moduleTypeId)) throw new ApiError(409, 'Codice NFC già presente');
            if (id === 'polls' && existing && database.votes.some((item) => item.pollId === existing.id) && JSON.stringify(existing.options) !== JSON.stringify(validated.options)) throw new ApiError(409, 'Le opzioni non possono cambiare dopo il primo voto');
            const now = new Date().toISOString();
            const next = { ...validated, id: existing?.id ?? randomUUID(), createdAt: existing?.createdAt ?? now, updatedAt: now };
            if (existing) database[id][database[id].indexOf(existing)] = next; else database[id].push(next);
            return next;
          }); send(res, 200, result); return;
        }
        if (collections.includes(id) && action && req.method === 'DELETE') {
          await change(`unpublish-${id}`, (database) => { const entry = database[id].find((item) => item.id === action); if (!entry) throw new ApiError(404, 'Contenuto non trovato'); entry.published = false; return entry; });
          send(res, 200, { ok: true }); return;
        }
      }
      throw new ApiError(404, 'Risorsa non trovata');
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const status = error instanceof ApiError ? error.status : error instanceof TypeError || error instanceof SyntaxError ? 400 : 500;
      if (status === 500) console.error('Hub request failed:', error.message);
      send(res, status, { error: status === 500 ? 'Errore del server' : error.message });
    }
  });
  server.on('close', () => { for (const client of subscribers) client.end(); subscribers.clear(); });
  return { server, store, host, directory };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hub = await createHub();
  const port = Number(process.env.HUB_PORT ?? 8790);
  hub.server.listen(port, hub.host, () => console.log(`Spaghetti LAB Community Hub: http://${hub.host}:${port}/admin · data: ${hub.directory}`));
}
