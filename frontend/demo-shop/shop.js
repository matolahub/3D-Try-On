// Pagina prodotto del negozio di ESEMPIO. Mostra cosa deve fare un e-commerce per integrare il Try-On:
//   1) includere lo script dell'SDK;   2) tradurre il proprio prodotto nel contratto (toTryOnProduct);   3) TryOn.open(...) / TryOn.mount(...).
(function () {
  // in sviluppo il widget gira su :5173 (origine diversa dal negozio, come in produzione); pubblicato su un solo sito sta nella stessa origine
  var DEV = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var TRYON_HOST = new URLSearchParams(location.search).get("tryon") || (DEV ? "http://localhost:5173" : location.origin);
  var state = { item: window.SHOP_CATALOG[0], size: "M", controller: null };
  var $ = function (id) { return document.getElementById(id); };

  // --- (2) ADATTATORE: dal formato del negozio al contratto v1 del Try-On. E' l'unico codice specifico da scrivere. ---------------
  function range(s) { var m = /^(\d+)-(\d+)$/.exec(s || ""); return m ? [Number(m[1]), Number(m[2])] : undefined; }
  function toTryOnProduct(item) {
    return {
      id: item.sku,
      name: item.title,
      category: item.kind === "Hoodie" ? "hoodie" : "tshirt",
      color: item.colorHex,
      asset: item.asset,                                                          // opzionale: capo 3D reale ospitato dal Try-On
      sizes: item.variants.map(function (v) {
        var s = v.spec;
        var g = { chestWidth: s.chest_flat_cm, length: s.length_cm, shoulder: s.shoulder_cm };       // chestWidth = larghezza a piatto: nessuna conversione lato negozio
        if (s.hem_flat_cm) g.hemWidth = s.hem_flat_cm;
        if (s.sleeve_cm) g.sleeve = s.sleeve_cm;
        if (s.sleeve_from_center_back_cm) { g.sleeve = s.sleeve_from_center_back_cm; g.sleeveFrom = "centerBack"; }
        var fit = v.fits ? { chest: range(v.fits.chest), height: range(v.fits.height) } : undefined;
        return { label: v.size, available: v.stock > 0, garmentMeasurements: g, bodyFit: fit };
      }),
    };
  }

  // --- pagina -------------------------------------------------------------------------------------------------------------------
  function log(line) { var el = $("log"); el.textContent += line + "\n"; el.scrollTop = el.scrollHeight; }
  function render() {
    var it = state.item;
    $("title").textContent = it.title; $("price").textContent = it.price; $("ph").style.background = it.colorHex;
    $("sizes").innerHTML = "";
    it.variants.forEach(function (v) {
      var b = document.createElement("button");
      b.textContent = v.size; b.className = (v.size === state.size ? "on " : "") + (v.stock ? "" : "out");
      b.onclick = function () { selectSize(v.size, true); };
      $("sizes").appendChild(b);
    });
  }
  function selectSize(size, fromShop) {
    state.size = size; render();
    if (fromShop && state.controller) state.controller.setSize(size);          // il selettore del negozio guida il Try-On
  }
  function events() {                                                            // eventi del Try-On verso il negozio
    return {
      onSizeChange: function (size) { log("sizeChange -> " + size); selectSize(size, false); },     // l'utente ha cambiato taglia nel widget
      onFit: function (e) { log("fit " + e.size + " " + JSON.stringify(e.zones.chest || {}) + " consigliata=" + e.recommendedSize); $("fitline").textContent = "Vestibilità al torace: " + (e.zones.chest ? e.zones.chest.verdict + " (" + (e.zones.chest.easeCm >= 0 ? "+" : "") + e.zones.chest.easeCm + " cm)" : "—") + (e.recommendedSize ? " · taglia consigliata " + e.recommendedSize : ""); },
      onInitialized: function (e) { log("initialized " + e.productId + " " + e.size + (e.warnings.length ? " (" + e.warnings.length + " avvisi)" : "")); },
      onReady: function () { log("ready"); },
      onError: function (e) { log("ERROR " + e.code + ": " + e.message + (e.details ? "\n  - " + e.details.join("\n  - ") : "")); },
    };
  }
  function options() { return Object.assign({ product: toTryOnProduct(state.item), size: state.size }, events()); }

  function tabs() { $("tabs").innerHTML = ""; window.SHOP_CATALOG.forEach(function (it) {
    var b = document.createElement("button"); b.textContent = it.title; b.className = it === state.item ? "on" : "";
    b.onclick = function () { state.item = it; state.size = "M"; $("fitline").textContent = ""; tabs(); render(); if (state.controller) state.controller.setProduct(toTryOnProduct(it), state.size); };
    $("tabs").appendChild(b); }); }

  // --- (1) SDK: caricato da chi ospita il Try-On, cosi' i negozi ricevono sempre la versione corrente --------------------------
  var s = document.createElement("script");
  s.src = TRYON_HOST + "/sdk/tryon-sdk.js";
  s.crossOrigin = "anonymous";        // l'host del Try-On serve /sdk/* con Access-Control-Allow-Origin (obbligatorio col server di sviluppo di Vite)
  s.onload = function () {
    tabs(); render();
    $("tryon").onclick = function () {                                            // (3) modale
      var c = window.TryOn.open(Object.assign(options(), { onClose: function () { state.controller = null; log("close"); } }));
      state.controller = c;
    };
    $("inline").onclick = function () {                                           // (3) inline
      var box = $("inlineBox");
      if (state.controller) { state.controller.destroy(); state.controller = null; }
      box.hidden = false; box.innerHTML = "";
      state.controller = window.TryOn.mount(box, Object.assign(options(), { height: "100%" }));
    };
    $("cart").onclick = function () { alert("Aggiunto al carrello: " + state.item.title + " · " + state.size); };
  };
  s.onerror = function () { log("Impossibile caricare l'SDK da " + s.src + " — il widget e' avviato? (npm run dev)"); };
  document.head.appendChild(s);
})();
