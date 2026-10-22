// Only the local demo receives operator messages. Google Forms is never inspected.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.channel !== "spaghettilab-fair") return;
  const id = crypto.randomUUID();
  const timer = setTimeout(() => {
    window.removeEventListener("message", receive);
    sendResponse({ ok: false, error: "La demo non ha confermato il comando." });
  }, 115000);
  function receive(event) {
    if (event.source !== window || event.origin !== location.origin ||
        event.data?.channel !== "spaghettilab-fair-result" || event.data.id !== id) return;
    clearTimeout(timer);
    window.removeEventListener("message", receive);
    sendResponse(event.data.result);
  }
  window.addEventListener("message", receive);
  window.postMessage({ channel: "spaghettilab-fair", id, action: message.action }, location.origin);
  return true;
});
