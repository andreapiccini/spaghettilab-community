import { settings } from "./settings.js"; // Generated during installation; contains a local token.
const forms = {
  it: "https://forms.gle/9FZeA8Nia5YQjBG99",
  en: "https://forms.gle/JYR3mTrTidfDf5E38",
};
const endpoint = "http://127.0.0.1:8767";
let polling = false;
let tabs = {};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function api(path, data) {
  const response = await fetch(endpoint + path, {
    headers: { Authorization: `Bearer ${settings.token}`, ...(data ? { "Content-Type": "application/json" } : {}) },
    ...(data ? { method: "POST", body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(path.startsWith("/next") ? 22000 : 5000),
  });
  if (!response.ok) throw new Error(`Controllo chiosco: HTTP ${response.status}`);
  return response.json();
}

async function existing(id) {
  if (!Number.isInteger(id)) return null;
  try { return await chrome.tabs.get(id); } catch { return null; }
}
async function remember() { await chrome.storage.session.set({ tabs }); }
async function demoTab() {
  let tab = await existing(tabs.demo);
  if (tab && !/^http:\/\/(localhost|127\.0\.0\.1):5173(?:\/|$)/.test(tab.url ?? "")) tab = null;
  if (!tab) {
    tab = (await chrome.tabs.query({})).find(t => /^http:\/\/(localhost|127\.0\.0\.1):5173(?:\/|$)/.test(t.url ?? ""));
    if (!tab) tab = await chrome.tabs.create({ url: settings.demoUrl, active: false });
    tabs.demo = tab.id;
    await remember();
  }
  await chrome.tabs.update(tab.id, { autoDiscardable: false });
  return tab;
}
async function activate(tab) {
  await chrome.tabs.update(tab.id, { active: true, autoDiscardable: false });
  await chrome.windows.update(tab.windowId, { focused: true, state: "fullscreen" });
}
async function questionnaire(language, fresh = false) {
  const demo = await demoTab();
  let tab = await existing(tabs.form);
  if (!tab || fresh || tabs.language !== language) {
    // Create first; never risk losing the old questionnaire if creating fails.
    const previous = tab;
    tab = await chrome.tabs.create({ windowId: demo.windowId, url: forms[language], active: false });
    tabs.form = tab.id;
    tabs.language = language;
    await remember();
    if (previous) await chrome.tabs.remove(previous.id);
  }
  await activate(tab);
}
async function dashboardTab() {
  let tab = await existing(tabs.dashboard);
  if (!tab) {
    const demo = await demoTab();
    tab = await chrome.tabs.create({ windowId: demo.windowId, url: "http://127.0.0.1:8080", active: false });
    tabs.dashboard = tab.id;
    await remember();
  }
  await activate(tab);
}
async function closeDashboard() {
  const tab = await existing(tabs.dashboard);
  if (tab) await chrome.tabs.remove(tab.id);
  delete tabs.dashboard;
  await remember();
}
async function app(action) {
  const tab = await demoTab();
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await chrome.tabs.get(tab.id)).status === "complete") {
      try {
        return await chrome.tabs.sendMessage(tab.id, { channel: "spaghettilab-fair", action });
      } catch (error) {
        if (attempt === 29) throw error;
      }
    }
    await delay(300);
  }
  throw new Error("La demo non è pronta.");
}
async function perform(action) {
  if (action === "dashboard") {
    await dashboardTab();
  } else if (action === "italiano" || action === "inglese") {
    await questionnaire(action === "italiano" ? "it" : "en");
  } else if (action === "questionario") {
    if (!await existing(tabs.form)) throw new Error("Scegli prima italiano o inglese.");
    await activate(await existing(tabs.form)); // No URL update or page reload.
  } else if (action === "demo") {
    await activate(await demoTab());
  } else if (action === "ripristina") {
    const result = await app("restore");
    if (!result?.ok) throw new Error(result?.error ?? "Ripristino non confermato");
    await questionnaire(tabs.language ?? "it", true);
  } else if (action === "salva-base" || action === "stop") {
    const result = await app(action === "stop" ? "stop" : "capture");
    if (!result?.ok) throw new Error(result?.error ?? "Comando non confermato");
    return result;
  } else throw new Error("Comando sconosciuto");
  if (["demo", "italiano", "inglese", "questionario", "ripristina"].includes(action)) await closeDashboard();
  return { ok: true };
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    tabs = (await chrome.storage.session.get("tabs")).tabs ?? {};
    if (!await existing(tabs.form)) await questionnaire(tabs.language ?? "it");
    let cursor = (await chrome.storage.session.get("cursor")).cursor ?? 0;
    for (;;) {
      const { command } = await api(`/next?after=${cursor}`);
      // An extension API call also keeps the service worker alive between long polls.
      await chrome.storage.session.set({ lastContact: Date.now() });
      if (!command) continue;
      if (command.expires <= Date.now() / 1000) {
        cursor = command.id;
        continue;
      }
      // Persist before executing: a worker restart must never repeat a reset.
      cursor = command.id;
      await chrome.storage.session.set({ cursor });
      let result;
      try { result = await perform(command.action); }
      catch (error) { result = { ok: false, error: String(error.message ?? error) }; }
      await api("/ack", { ...result, id: command.id,
        state: { language: tabs.language, demoTab: tabs.demo, questionnaireTab: tabs.form, dashboardTab: tabs.dashboard } });
    }
  } catch (error) {
    console.warn("SpaghettiLAB kiosk:", String(error.message ?? error));
  } finally {
    polling = false;
    setTimeout(poll, 1500);
  }
}
chrome.alarms.onAlarm.addListener(() => { void poll(); });
chrome.runtime.onStartup.addListener(() => { void poll(); });
chrome.runtime.onInstalled.addListener(() => { void poll(); });
void chrome.alarms.create("kiosk-reconnect", { periodInMinutes: 0.5 });
void poll();
