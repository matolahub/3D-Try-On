/*!
 * Try-On SDK v0.1.0 - integrazione del Try-On in una pagina prodotto. Nessuna dipendenza, nessuna build.
 *
 *   <script src="https://TRYON-HOST/sdk/tryon-sdk.js"></script>
 *   <script>
 *     const tryOn = TryOn.open({ product: {...}, size: "M" });        // modale
 *     const inline = TryOn.mount(document.getElementById("box"), { product: {...}, size: "M" });   // inline
 *     inline.setSize("L");  inline.on("sizeChange", (size) => ...);
 *   </script>
 *
 * Funziona anche come modulo (CommonJS/ESM tramite bundler): `import TryOn from "@tryon/sdk"`.
 * Contratto dati e protocollo: docs/integration.md
 */
(function (root) {
  "use strict";

  var NS = "tryon";
  var PROTOCOL = 1;
  var VERSION = "0.1.0";
  var READY_TIMEOUT_MS = 12000;

  // L'URL del widget si ricava dallo script: /sdk/tryon-sdk.js  ->  /embed.html (stessa origine dello script)
  var scriptSrc = null;
  try { scriptSrc = document.currentScript && document.currentScript.src; } catch (e) { /* non in un browser */ }
  var config = { widgetUrl: null };
  try { if (scriptSrc) config.widgetUrl = new URL("../embed.html", scriptSrc).href; } catch (e) { /* URL non risolvibile */ }

  /** Imposta valori globali (utile quando l'SDK e' incluso da un bundler e non da un tag script). */
  function configure(options) {
    if (options && options.widgetUrl) config.widgetUrl = options.widgetUrl;
    return config;
  }

  function envelope(type, payload) {
    return { ns: NS, v: PROTOCOL, from: "host", type: type, payload: payload };
  }

  /**
   * Accetta solo messaggi provenienti dall'iframe del widget e dalla sua origine. Esposta per i test.
   * @returns {object|null} il messaggio, oppure null se va ignorato
   */
  function acceptWidgetMessage(ev, iframeWindow, widgetOrigin) {
    if (!iframeWindow || ev.source !== iframeWindow || ev.origin !== widgetOrigin) return null;
    var d = ev.data;
    if (!d || typeof d !== "object" || d.ns !== NS || d.from !== "widget" || typeof d.type !== "string") return null;
    return d;
  }

  /**
   * Monta il widget in un contenitore.
   * @param {HTMLElement} container
   * @param {object} options { product, size?, body?, widgetUrl?, height?, shareBody?, title?, onReady, onInitialized, onSizeChange, onFit, onBodyChange, onError }
   * @returns controller { iframe, setSize, setProduct, setBody, on, destroy }
   */
  function mount(container, options) {
    options = options || {};
    var widgetUrl = options.widgetUrl || config.widgetUrl;
    if (!widgetUrl) throw new Error("TryOn: widgetUrl non configurato. Passa { widgetUrl } oppure chiama TryOn.configure({ widgetUrl }).");
    if (!container) throw new Error("TryOn: contenitore mancante.");
    var widgetOrigin = new URL(widgetUrl, root.location && root.location.href).origin;

    var iframe = document.createElement("iframe");
    iframe.src = widgetUrl;
    iframe.title = options.title || "Prova virtuale";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");   // il widget non deve navigare la pagina ne' aprire finestre
    // fotocamera e sensori di orientamento: servono solo alla scansione del corpo, che li chiede all'utente; il video resta nel widget
    iframe.setAttribute("allow", "camera; accelerometer; gyroscope");
    iframe.setAttribute("referrerpolicy", "strict-origin");
    iframe.style.cssText = "width:100%;height:" + (options.height || "100%") + ";border:0;display:block;background:#0f0f0f";
    container.appendChild(iframe);

    var state = { product: options.product, size: options.size, body: options.body, ready: false, destroyed: false };
    var listeners = {};
    var timer = null;

    function emit(name, a, b) {
      var cbName = "on" + name.charAt(0).toUpperCase() + name.slice(1);
      var fns = (listeners[name] || []).slice();
      if (typeof options[cbName] === "function") fns.push(options[cbName]);
      fns.forEach(function (fn) { try { fn(a, b); } catch (e) { if (root.console) console.error("[tryon] errore nel callback " + name, e); } });
    }
    function on(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
      return function () { listeners[name] = (listeners[name] || []).filter(function (f) { return f !== fn; }); };
    }
    function post(type, payload) {
      if (state.destroyed || !iframe.contentWindow) return;
      try {
        iframe.contentWindow.postMessage(envelope(type, payload), widgetOrigin);
      } catch (e) {                                        // es. DataCloneError: il prodotto contiene funzioni/oggetti non clonabili
        emit("error", { code: "post_failed", message: "Impossibile inviare i dati al widget: " + (e && e.message) });
      }
    }
    function sendInit() {
      post("init", { product: state.product, size: state.size, body: state.body, options: { shareBody: !!options.shareBody } });
    }

    function onMessage(ev) {
      var d = acceptWidgetMessage(ev, iframe.contentWindow, widgetOrigin);
      if (!d) return;
      var p = d.payload || {};
      switch (d.type) {
        case "ready": state.ready = true; clearTimeout(timer); sendInit(); emit("ready", p); break;
        case "initialized": emit("initialized", p); break;
        case "sizeChange": state.size = p.size; emit("sizeChange", p.size, p); break;
        case "fit": emit("fit", p); break;
        case "bodyChange": emit("bodyChange", p.body); break;
        case "error": emit("error", p); break;
        default: break;
      }
    }
    root.addEventListener("message", onMessage);
    timer = setTimeout(function () {
      if (!state.ready) emit("error", { code: "widget_unreachable", message: "Il widget non ha risposto: controlla widgetUrl, la rete e le regole CSP/frame-ancestors." });
    }, READY_TIMEOUT_MS);

    return {
      iframe: iframe,
      /** Cambia la taglia mostrata (es. l'utente ha cambiato il selettore del negozio). */
      setSize: function (size) { state.size = size; if (state.ready) post("setSize", { size: size }); },
      /** Sostituisce il prodotto (es. cambio di variante/colore). */
      setProduct: function (product, size) { state.product = product; if (size !== undefined) state.size = size; if (state.ready) post("setProduct", { product: product, size: state.size }); },
      /** Se il negozio conosce gia' le misure del corpo dell'utente (profilo), puo' impostarle; altrimenti le inserisce l'utente nel widget. */
      setBody: function (body) { state.body = body; if (state.ready) post("setBody", { body: body }); },
      on: on,
      destroy: function () {
        if (state.destroyed) return;
        state.destroyed = true; clearTimeout(timer);
        root.removeEventListener("message", onMessage);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        emit("destroy");
      },
    };
  }

  /** Apre il Try-On in una finestra modale (Esc / click fuori / pulsante per chiudere). Ritorna lo stesso controller di mount() piu' close(). */
  function open(options) {
    options = options || {};
    var prevFocus = document.activeElement;
    var overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", options.title || "Prova virtuale");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:2vh 2vw";
    var panel = document.createElement("div");
    panel.style.cssText = "position:relative;width:min(1100px,100%);height:min(780px,100%);background:#0f0f0f;border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.5)";
    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Chiudi");
    close.textContent = "×";
    close.style.cssText = "position:absolute;top:8px;right:10px;z-index:5;width:32px;height:32px;border-radius:16px;border:1px solid rgba(255,255,255,.2);background:rgba(15,15,15,.85);color:#fff;font-size:20px;line-height:1;cursor:pointer";
    panel.appendChild(close);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    var controller = mount(panel, options);
    var closed = false;
    function closeModal() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey);
      controller.destroy();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.body.style.overflow = prevOverflow;
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      if (typeof options.onClose === "function") options.onClose();
    }
    function onKey(e) { if (e.key === "Escape") closeModal(); }
    document.addEventListener("keydown", onKey);
    close.addEventListener("click", closeModal);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
    close.focus();
    controller.close = closeModal;
    return controller;
  }

  const TryOn = {
    version: VERSION,
    protocol: PROTOCOL,
    configure: configure,
    mount: mount,
    open: open,
    _internals: { acceptWidgetMessage: acceptWidgetMessage, envelope: envelope },
  };

  if (typeof module === "object" && module.exports) { module.exports = TryOn; module.exports.default = TryOn; }
  else root.TryOn = TryOn;
})(typeof self !== "undefined" ? self : this);
