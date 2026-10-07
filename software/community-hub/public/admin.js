const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const names = { posts: 'Progetti e articoli', modules: 'Moduli e codici NFC', packages: 'Pacchetti e firmware', polls: 'Votazioni', contests: 'Contest e premi', submissions: 'Candidature' };
let state, section = 'posts', selected = null, edit = {};
async function api(route, method = 'GET', data) {
  const response = await fetch(`/api/v1/${route}`, { method, credentials: 'same-origin', headers: data === undefined ? {} : { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Richiesta non riuscita');
  return result;
}
function notice(message) { $('notice').textContent = message; }
async function load() { state = await api('admin/state'); $('app').hidden = false; $('login').hidden = true; render(); }
function initial() {
  return { title: '', description: '', published: false, registryId: 1, vendorId: 1, moduleTypeId: '', available: true, kind: 'firmware', version: '', target: 'spaghettilab_backbone_v1/esp32', channel: 'stable', category: 'project', featured: false, body: '', tags: [], closesAt: new Date(Date.now() + 30 * 86400000).toISOString(), options: ['Opzione 1', 'Opzione 2'], prize: '', rules: '' };
}
function input(name, label, value = '', type = 'text') { return `<label for="${name}">${esc(label)}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}">`; }
function area(name, label, value = '', rows = 3) { return `<label for="${name}">${esc(label)}</label><textarea id="${name}" name="${name}" rows="${rows}">${esc(value)}</textarea>`; }
function select(name, label, entries, value) { return `<label for="${name}">${esc(label)}</label><select id="${name}" name="${name}">${entries.map(([id, title]) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select>`; }
function checkbox(name, label, checked) { return `<div class="check"><input type="checkbox" id="${name}" name="${name}" ${checked ? 'checked' : ''}><label for="${name}">${esc(label)}</label></div>`; }
function files(image) { return [['', image ? 'Nessuna copertina' : 'Seleziona un file'], ...state.files.filter((file) => file.contentType.startsWith('image/') === image).map((file) => [file.id, `${file.name} · ${(file.size / 1024).toFixed(0)} KB`])]; }
function currentForm() {
  const form = $('content-form'); if (!form) return edit;
  const values = Object.fromEntries(new FormData(form));
  const next = { ...edit, ...values, published: form.elements.published.checked };
  if (section === 'modules') {
    next.registryId = Number(values.registryId); next.vendorId = Number(values.vendorId); next.moduleTypeId = Number(values.moduleTypeId); next.available = form.elements.available.checked;
    next.pins = values.pins.trim() ? values.pins.split('\n').map((pin) => pin.trim()) : undefined;
    next.modes = values.modes.trim() ? values.modes.split(',').map(Number) : undefined; next.i2cSpeed = Number(values.i2cSpeed);
  }
  if (section === 'packages') next.manifest = values.manifest.trim() ? JSON.parse(values.manifest) : undefined;
  if (section === 'posts') { next.tags = values.tags.split(',').map((tag) => tag.trim()).filter(Boolean); next.featured = form.elements.featured.checked; }
  if (section === 'polls') next.options = values.options.split('\n').map((option) => option.trim()).filter(Boolean);
  return next;
}
function render() {
  $('nav').innerHTML = Object.entries(names).map(([id, name]) => `<button data-section="${id}" class="${section === id ? 'active' : ''}">${esc(name)}</button>`).join('');
  $('nav').querySelectorAll('button').forEach((button) => button.onclick = () => { section = button.dataset.section; selected = null; edit = initial(); notice(''); render(); });
  $('heading').innerHTML = `<div class="heading"><div><div class="eyebrow">COMMUNITY · REVISIONE ${state.revision}</div><h1>${names[section]}</h1><p>${section === 'packages' ? 'Carica i file, scegli la destinazione e pubblica una nuova versione. Le app ricevono la notifica in tempo reale.' : 'Crea una bozza, completala e pubblicala quando è pronta.'}</p></div>${section !== 'submissions' ? '<button id="new">+ Nuovo contenuto</button>' : ''}</div>`;
  if ($('new')) $('new').onclick = () => { selected = null; edit = initial(); render(); };
  if (section === 'submissions') { renderSubmissions(); return; }
  const items = [...state[section]].reverse();
  $('list').innerHTML = items.length ? items.map((item) => `<article class="card ${item.id === selected ? 'selected' : ''}" data-id="${esc(item.id)}">${item.coverId ? `<img src="/api/v1/files/${item.coverId}" alt="">` : item.coverPreset ? '<img src="/cover.svg" alt="">' : ''}<span class="badge ${item.published ? '' : 'draft'}">${item.published ? 'Pubblicato' : 'Bozza'}</span><h2>${esc(item.title)}</h2><p>${esc(item.description)}</p>${section === 'modules' ? `<code>NFC ${item.registryId}:${item.vendorId}:${item.moduleTypeId}</code>` : section === 'packages' ? `<code>${esc(item.kind)} · ${esc(item.version)} · ${esc(item.target)}</code>` : ''}</article>`).join('') : '<div class="empty">Il prossimo contenuto parte da qui.<br>Crea la tua prima pubblicazione.</div>';
  $('list').querySelectorAll('[data-id]').forEach((card) => card.onclick = () => { selected = card.dataset.id; edit = structuredClone(state[section].find((item) => item.id === selected)); render(); });
  if (!Object.keys(edit).length) edit = initial();
  let fields = input('title', 'Titolo', edit.title) + area('description', 'Descrizione breve', edit.description);
  if (section === 'modules') fields += `<div class="pair">${input('registryId', 'Registro NFC', edit.registryId, 'number')}${input('vendorId', 'Produttore NFC', edit.vendorId, 'number')}</div>${input('moduleTypeId', 'Codice tipo modulo NFC', edit.moduleTypeId, 'number')}${checkbox('available', 'Modulo disponibile', edit.available)}<details><summary>Definizione elettrica (opzionale)</summary><p>Connector: descrivi i sei pin. Function 2: 5V e GND fissi; modi 0 NC, 1 input, 2 LOW, 3 HIGH, 4 SDA, 5 SCL. I²C solo sui primi due segnali.</p>${area('pins', 'Sei pin, uno per riga', edit.pins?.join('\n') ?? '')}${input('modes', 'Quattro modi, separati da virgole', edit.modes?.join(',') ?? '')}${select('i2cSpeed', 'Clock I²C', [['0', '100 kHz'], ['1', '400 kHz']], String(edit.i2cSpeed ?? 0))}</details>`;
  if (section === 'packages') fields += `<div class="pair">${select('kind', 'Tipo', [['firmware', 'Firmware'], ['capability-pack', 'Capability Pack'], ['device-profile', 'Device Profile'], ['project', 'Progetto'], ['extension', 'Estensione']], edit.kind)}${input('version', 'Versione', edit.version)}</div>${input('target', 'Scheda / destinazione', edit.target)}${select('channel', 'Canale', [['stable', 'Stabile'], ['beta', 'Beta']], edit.channel)}${select('fileId', 'File scaricabile', files(false), edit.fileId ?? '')}<label class="upload">↑ Carica un nuovo file<input id="package-upload" type="file"></label><details><summary>Manifest del pacchetto / candidato OTA</summary>${area('manifest', 'Manifest JSON (opzionale)', edit.manifest ? JSON.stringify(edit.manifest, null, 2) : '', 10)}</details>`;
  if (section === 'posts') fields += select('category', 'Categoria', [['project', 'Progetto'], ['news', 'Novità'], ['tutorial', 'Tutorial']], edit.category) + area('body', 'Articolo (testo e paragrafi)', edit.body, 9) + input('tags', 'Tag, separati da virgole', edit.tags?.join(', ') ?? '') + checkbox('featured', 'Progetto in evidenza', edit.featured);
  if (section === 'polls') fields += area('options', 'Opzioni, una per riga', edit.options?.join('\n')) + input('closesAt', 'Scadenza', localDate(edit.closesAt), 'datetime-local');
  if (section === 'contests') fields += area('rules', 'Regolamento', edit.rules, 6) + input('prize', 'Premio in palio', edit.prize) + input('closesAt', 'Scadenza', localDate(edit.closesAt), 'datetime-local');
  fields += select('coverId', 'Copertina', files(true), edit.coverId ?? '') + '<label class="upload">↑ Carica una foto<input id="cover-upload" type="file" accept="image/png,image/jpeg,image/webp"></label>' + checkbox('published', 'Pubblica e sincronizza con le app', edit.published);
  $('editor').innerHTML = `<div class="editor"><h2>${selected ? 'Modifica contenuto' : 'Nuovo contenuto'}</h2><form id="content-form">${fields}<div class="buttons"><button id="save">${edit.published ? 'Salva e pubblica' : 'Salva contenuto'}</button>${selected ? '<button type="button" id="unpublish" class="quiet danger">Ritira pubblicazione</button>' : ''}</div></form></div>`;
  $('content-form').onsubmit = async (event) => {
    event.preventDefault(); $('save').disabled = true;
    try { const value = currentForm(); const result = await api(`admin/${section}${selected ? `/${selected}` : ''}`, selected ? 'PUT' : 'POST', value); selected = result.id; edit = result; await load(); notice(result.published ? 'Pubblicato. Le app collegate ricevono ora il contenuto.' : 'Bozza salvata.'); }
    catch (error) { notice(error.message); if ($('save')) $('save').disabled = false; }
  };
  if ($('unpublish')) $('unpublish').onclick = async () => { try { await api(`admin/${section}/${selected}`, 'DELETE'); edit.published = false; await load(); notice('Pubblicazione ritirata.'); } catch (error) { notice(error.message); } };
  for (const [inputId, property] of [['package-upload', 'fileId'], ['cover-upload', 'coverId']]) if ($(inputId)) $(inputId).onchange = async (event) => {
    const file = event.target.files[0]; if (!file) return;
    try { edit = currentForm(); notice('Caricamento in corso…'); const response = await fetch('/api/v1/admin/uploads', { method: 'POST', credentials: 'same-origin', headers: { 'x-filename': encodeURIComponent(file.name), 'content-type': 'application/octet-stream' }, body: file }); const result = await response.json(); if (!response.ok) throw new Error(result.error); edit[property] = result.id; if (property === 'coverId') delete edit.coverPreset; await load(); notice(`File caricato: ${file.name}. Salva il contenuto per pubblicarlo.`); } catch (error) { notice(error.message); }
  };
}
function renderSubmissions() {
  $('list').innerHTML = state.submissions.length ? state.submissions.map((submission) => `<article class="card"><span class="badge">${esc(state.contests.find((contest) => contest.id === submission.contestId)?.title)}</span><h2>${esc(submission.title)}</h2><p>${esc(submission.displayName)} · ${esc(submission.description)}</p><a class="entry-link" href="${esc(submission.projectUrl)}" target="_blank" rel="noopener noreferrer">Apri progetto ↗</a><div class="buttons">${state.awards.some((award) => award.submissionId === submission.id) ? '<span class="success">Premio assegnato</span>' : `<button data-award="${submission.id}">Assegna premio</button>`}</div></article>`).join('') : '<div class="empty">Le candidature inviate dall’app compariranno qui.</div>';
  $('editor').innerHTML = `<div class="editor"><h2>Premi assegnati</h2>${state.awards.length ? state.awards.map((award) => `<p><strong>${esc(award.prize)}</strong><br>${esc(state.submissions.find((submission) => submission.id === award.submissionId)?.displayName)}</p>`).join('') : '<p>Scegli una candidatura per assegnare un premio. Il risultato viene pubblicato nel contest.</p>'}</div>`;
  $('list').querySelectorAll('[data-award]').forEach((button) => button.onclick = async () => { const prize = prompt('Quale premio vuoi assegnare?'); if (!prize?.trim()) return; try { await api('admin/awards', 'POST', { submissionId: button.dataset.award, prize }); await load(); notice('Premio assegnato e pubblicato nel contest.'); } catch (error) { notice(error.message); } });
}
$('login-form').onsubmit = async (event) => { event.preventDefault(); try { await api('auth/admin', 'POST', { token: $('token').value }); $('token').value = ''; await load(); } catch (error) { alert(error.message); } };
$('logout').onclick = async () => { await api('auth/logout', 'POST'); $('app').hidden = true; $('login').hidden = false; };
try { await load(); }
catch { try { await api('auth/local-admin', 'POST', {}); await load(); } catch { $('login').hidden = false; } }

function localDate(value) { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

