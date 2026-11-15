// Wrapper React sottile dell'SDK (nessun JSX: non richiede build). Richiede solo `react` nel progetto del negozio.
//
//   import { TryOnWidget } from "@tryon/sdk/react";
//   <TryOnWidget product={tryOnProduct} size={size} onSizeChange={setSize} style={{ height: 640 }} />
import { createElement, useEffect, useRef } from "react";
import TryOn from "./tryon-sdk.mjs";

export { TryOn };

export function TryOnWidget(props) {
  const { product, size, body, widgetUrl, shareBody, title, className, style, onReady, onInitialized, onSizeChange, onFit, onBodyChange, onError } = props;
  const box = useRef(null);
  const ctl = useRef(null);
  const sent = useRef({ product: null, size: undefined, body: null });
  const cbs = useRef({});
  cbs.current = { onReady, onInitialized, onSizeChange, onFit, onBodyChange, onError };   // sempre gli ultimi callback, senza rimontare

  // montaggio: una volta (o se cambiano widgetUrl / shareBody)
  useEffect(() => {
    const c = TryOn.mount(box.current, {
      product, size, body, widgetUrl, shareBody, title,
      onReady: (p) => cbs.current.onReady && cbs.current.onReady(p),
      onInitialized: (p) => cbs.current.onInitialized && cbs.current.onInitialized(p),
      onSizeChange: (s, p) => cbs.current.onSizeChange && cbs.current.onSizeChange(s, p),
      onFit: (p) => cbs.current.onFit && cbs.current.onFit(p),
      onBodyChange: (b) => cbs.current.onBodyChange && cbs.current.onBodyChange(b),
      onError: (e) => cbs.current.onError && cbs.current.onError(e),
    });
    ctl.current = c;
    sent.current = { product: JSON.stringify(product), size, body: JSON.stringify(body) };
    return () => { c.destroy(); ctl.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetUrl, shareBody]);

  // aggiornamenti: solo se il valore e' cambiato davvero (un nuovo oggetto identico non deve rimandare tutto)
  useEffect(() => {
    const c = ctl.current; if (!c) return;
    const json = JSON.stringify(product);
    if (json !== sent.current.product) { sent.current.product = json; sent.current.size = size; c.setProduct(product, size); }
  }, [product, size]);
  useEffect(() => {
    const c = ctl.current; if (!c) return;
    if (size !== sent.current.size) { sent.current.size = size; c.setSize(size); }
  }, [size]);
  useEffect(() => {
    const c = ctl.current; if (!c || !body) return;
    const json = JSON.stringify(body);
    if (json !== sent.current.body) { sent.current.body = json; c.setBody(body); }
  }, [body]);

  return createElement("div", { ref: box, className, style: { width: "100%", height: "100%", minHeight: 480, ...style } });
}

export default TryOnWidget;
