import { readFile } from 'node:fs/promises';

export const collections = ['modules', 'packages', 'posts', 'polls', 'contests'];
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (message) => { throw new ApiError(400, message); };
function text(value, label, max = 500, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${label}: testo non valido`);
  return value.trim();
}
function integer(value, label, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) fail(`${label}: numero non valido`);
  return value;
}
export function validateEntry(collection, input, files) {
  if (!collections.includes(collection) || !input || typeof input !== 'object') fail('Contenuto non valido');
  const entry = { title: text(input.title, 'Titolo', 160), description: text(input.description ?? '', 'Descrizione', 2000, false), published: input.published === true };
  if (input.coverId) {
    const cover = files.find((file) => file.id === input.coverId && file.contentType.startsWith('image/'));
    if (!cover) fail('Copertina non trovata');
    entry.coverId = cover.id;
  }
  if (input.coverPreset === 'sense-dial') entry.coverPreset = input.coverPreset;
  if (collection === 'modules') {
    Object.assign(entry, { registryId: integer(input.registryId, 'Registro', 65535), vendorId: integer(input.vendorId, 'Produttore', 65535), moduleTypeId: integer(input.moduleTypeId, 'Codice modulo', 0xffffffff), available: input.available !== false });
    if (input.pins !== undefined) {
      if (!Array.isArray(input.pins) || input.pins.length !== 6 || input.pins.some((pin) => typeof pin !== 'string' || pin.length > 40)) fail('Il pinout deve contenere sei descrizioni');
      entry.pins = input.pins;
    }
    if (input.modes !== undefined) {
      if (!Array.isArray(input.modes) || input.modes.length !== 4 || input.modes.some((mode) => !Number.isInteger(mode) || mode < 0 || mode > 255 || (mode & 15) > 12 || (mode & 0xc0) || (mode & 0x30) === 0x30 || ((mode & 15) !== 1 && (mode & 0x30)))) fail('Configurazione dei quattro segnali non valida');
      for (const group of [[4,5],[6,7],[8,9,10,11]]) {
        const used = input.modes.filter(mode => group.includes(mode & 15));
        if (used.length && (used.length !== group.length || group.some(mode => used.filter(value => value === mode).length !== 1))) fail('Assegna una sola volta tutti i segnali dell’interfaccia');
      }
      const names = ['NC','GPIO IN','GPIO OUT','GPIO OUT','SDA','SCL','UART TX','UART RX','SPI CLK','SPI MOSI','SPI MISO','SPI CS','PWM'];
      const labels = ['5V', ...input.modes.map(mode => (mode & 15) === 1 ? `GPIO IN${mode & 16 ? ' · ↑' : mode & 32 ? ' · ↓' : ''}` : names[mode & 15]), 'GND'];
      if (!entry.pins || labels.some((label, i) => label !== entry.pins[i])) fail('Il pinout non corrisponde alla configurazione elettrica');
      entry.modes = input.modes;
      entry.i2cSpeed = input.i2cSpeed ?? 0;
      if (![0, 1].includes(entry.i2cSpeed)) fail('Clock I²C non valido');
      if (input.settings !== undefined) {
        const s = input.settings;
        if (!s || ![s.baud,s.spiHz,s.pwmHz].every(Number.isInteger) || s.baud < 1200 || s.baud > 2000000 || s.spiHz < 10000 || s.spiHz > 20000000 || s.pwmHz < 1 || s.pwmHz > 20000 || ![7,8].includes(s.dataBits) || !['none','even','odd'].includes(s.parity) || ![1,2].includes(s.stopBits) || ![0,1,2,3].includes(s.spiMode) || !['msb','lsb'].includes(s.bitOrder) || typeof s.pwmInverted !== 'boolean') fail('Impostazioni delle interfacce non valide');
        entry.settings = s;
      }
    }
  }
  if (collection === 'packages') {
    if (!['firmware', 'capability-pack', 'device-profile', 'project', 'extension'].includes(input.kind)) fail('Tipo pacchetto non valido');
    entry.kind = input.kind;
    entry.version = text(input.version, 'Versione', 80);
    entry.target = text(input.target ?? 'any', 'Destinazione', 160);
    entry.channel = input.channel === 'beta' ? 'beta' : 'stable';
    if (input.fileId) {
      if (!files.some((file) => file.id === input.fileId && !file.contentType.startsWith('image/'))) fail('File del pacchetto non trovato');
      entry.fileId = input.fileId;
    }
    if (entry.published && !entry.fileId) fail('Carica un file prima di pubblicare il pacchetto');
    if (input.manifest !== undefined && input.manifest !== null) {
      if (typeof input.manifest !== 'object' || Array.isArray(input.manifest) || JSON.stringify(input.manifest).length > 512000) fail('Manifest JSON non valido');
      entry.manifest = input.manifest;
    }
  }
  if (collection === 'posts') {
    entry.body = text(input.body ?? '', 'Articolo', 30000, false);
    entry.category = ['project', 'news', 'tutorial'].includes(input.category) ? input.category : 'project';
    entry.featured = input.featured === true;
    entry.tags = Array.isArray(input.tags) ? input.tags.slice(0, 8).map((tag) => text(tag, 'Tag', 40)) : [];
    if (input.packageId) entry.packageId = text(input.packageId, 'Pacchetto', 80);
  }
  if (collection === 'polls' || collection === 'contests') {
    if (!input.closesAt || !Number.isFinite(Date.parse(input.closesAt))) fail('Indica una scadenza valida');
    entry.closesAt = new Date(input.closesAt).toISOString();
  }
  if (collection === 'polls') {
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 10) fail('Indica da due a dieci opzioni');
    entry.options = input.options.map((option) => text(option, 'Opzione', 100));
    if (new Set(entry.options).size !== entry.options.length) fail('Le opzioni devono essere diverse');
  }
  if (collection === 'contests') {
    entry.rules = text(input.rules ?? '', 'Regolamento', 20000, false);
    entry.prize = text(input.prize ?? '', 'Premio', 500, false);
  }
  return entry;
}

export async function seedDatabase() {
  const catalog = JSON.parse(await readFile(new URL('../../micro-flow-editor/packages/catalog-model/src/nfc-module-catalog.json', import.meta.url), 'utf8'));
  const now = new Date().toISOString();
  const closesAt = new Date(Date.now() + 30 * 86400000).toISOString();
  const stamp = { published: true, createdAt: now, updatedAt: now };
  return { schemaVersion: 1, revision: 1, updatedAt: now, files: [], users: [], votes: [], submissions: [], awards: [], audit: [],
    modules: catalog.map((entry) => ({ ...stamp, id: `module-${entry.registryId}-${entry.vendorId}-${entry.moduleTypeId}`, title: entry.nameIt, description: 'Voce demo del catalogo NFC condiviso. Pinout elettrico da completare.', registryId: entry.registryId, vendorId: entry.vendorId, moduleTypeId: entry.moduleTypeId, available: true })),
    packages: [],
    posts: [{ ...stamp, id: 'sense-dial', title: 'Sense Dial: dai sensori a un’interfaccia tangibile', description: 'Un progetto dal laboratorio per immaginare nuove interazioni con i moduli Spaghetti LAB.', body: 'Parti da un sensore, collega una backbone e trasforma i segnali in un’interfaccia che puoi toccare.\n\nIl progetto Sense Dial è disponibile negli esempi del repository. Questa è una scheda dimostrativa: puoi modificarla, caricare una fotografia e pubblicare il tuo racconto dal pannello del server.', category: 'project', featured: true, coverPreset: 'sense-dial', tags: ['Ispirazione', 'Esempio'] }],
    polls: [{ ...stamp, id: 'next-module', title: 'Quale modulo vorresti nel prossimo laboratorio?', description: 'Votazione dimostrativa. Scegli una direzione e aiutaci a progettare il prossimo modulo.', options: ['Sensori ambientali', 'Controllo luci', 'Interfacce tattili'], closesAt }],
    contests: [{ ...stamp, id: 'first-prototype', title: 'Il tuo primo prototipo Spaghetti LAB', description: 'Contest dimostrativo: racconta un’idea e condividi il tuo progetto.', rules: 'Invia un titolo, una descrizione e un collegamento al progetto. I premi vengono assegnati dall’organizzatore dal pannello di gestione.', prize: 'Premio dimostrativo da definire dall’organizzatore', closesAt }],
  };
}

export function publicSnapshot(database) {
  const visible = (name) => database[name].filter((entry) => entry.published).map((entry) => {
    const next = { ...entry };
    if (name === 'polls') next.counts = entry.options.map((_, index) => database.votes.filter((vote) => vote.pollId === entry.id && vote.option === index).length);
    if (name === 'contests') {
      next.submissionCount = database.submissions.filter((submission) => submission.contestId === entry.id).length;
      next.awards = database.awards.filter((award) => award.contestId === entry.id).map((award) => {
        const submission = database.submissions.find((item) => item.id === award.submissionId);
        return { id: award.id, prize: award.prize, winner: submission?.displayName, projectTitle: submission?.title };
      });
    }
    if (entry.fileId) next.file = database.files.find((file) => file.id === entry.fileId);
    return next;
  });
  return { schemaVersion: 1, revision: database.revision, updatedAt: database.updatedAt, ...Object.fromEntries(collections.map((name) => [name, visible(name)])) };
}
