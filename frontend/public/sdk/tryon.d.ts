// Tipi TypeScript del contratto dati v1 e dell'SDK. Vedi docs/integration.md.

/** Misure del CAPO in cm. Obbligatorio il torace: `chest` (giro completo) OPPURE `chestWidth` (larghezza a piatto ascella-ascella). */
export interface GarmentMeasurements {
  /** Circonferenza del torace (giro completo, sotto le ascelle), cm. */
  chest?: number;
  /** Alternativa a `chest`: larghezza a piatto ascella-ascella, cm (il Try-On la raddoppia). */
  chestWidth?: number;
  /** Dal punto alto della spalla all'orlo, cm. */
  length?: number;
  /** Larghezza spalle da cucitura a cucitura, cm. */
  shoulder?: number;
  /** Lunghezza manica fino al polsino, cm. */
  sleeve?: number;
  /** Da dove e' misurata la manica (default "shoulder"). */
  sleeveFrom?: "shoulder" | "centerBack";
  /** Circonferenza dell'orlo (o `hemWidth` a piatto), cm. */
  hem?: number;
  hemWidth?: number;
  /** Circonferenza in vita (o `waistWidth` a piatto), cm. Solo se il capo e' sagomato. */
  waist?: number;
  waistWidth?: number;
  /** Circonferenza dell'apertura della manica, cm. */
  sleeveOpening?: number;
  /** Circonferenza del bicipite, cm. */
  bicep?: number;
}

/** Misure del CORPO (in cm) per cui il negozio pensa la taglia: usate solo per consigliare la taglia. */
export interface BodyFit {
  chest?: [number, number];
  waist?: [number, number];
  hips?: [number, number];
  height?: [number, number];
}

export interface TryOnSize {
  /** Etichetta univoca ("S", "M", ...). */
  label: string;
  /** Misure del CAPO per questa taglia. */
  garmentMeasurements: GarmentMeasurements;
  /** Opzionale: misure del CORPO previste per la taglia. */
  bodyFit?: BodyFit;
  /** Default true. Le taglie esaurite si possono provare ma non vengono consigliate. */
  available?: boolean;
}

export interface TryOnProduct {
  /** Identificativo del prodotto nel negozio (opaco per il Try-On). */
  id: string | number;
  name: string;
  category: "tshirt" | "hoodie";
  /** Colore del capo (#rrggbb) per la resa 3D. */
  color?: string;
  /** Immagini: solo anteprima nell'interfaccia (URL http/https). */
  images?: string[];
  sizes: TryOnSize[];
  units?: "cm";
  /** Id di un capo 3D reale ospitato dal Try-On (es. "grillz-tee"). Opzionale: senza, o per taglie non disponibili, si usa il capo parametrico. */
  asset?: string;
}

/** Misure del corpo dell'utente in cm (le inserisce l'utente nel widget; il negozio puo' precompilarle). */
export interface BodyMeasurements {
  chest?: number;
  waist?: number;
  hips?: number;
  height?: number;
}

export interface FitZone { easeCm: number; verdict: "stretto" | "aderente" | "regular" | "morbido" | "oversize" }
export interface FitEvent { productId: string; size: string; zones: Record<string, FitZone>; recommendedSize: string | null }
export interface TryOnError { code: string; message: string; details?: string[] }

export interface TryOnOptions {
  product: TryOnProduct;
  /** Taglia iniziale (etichetta). */
  size?: string;
  /** Misure del corpo se il negozio le conosce (opzionale). */
  body?: BodyMeasurements;
  /** URL del widget (default: dedotto dallo script dell'SDK). */
  widgetUrl?: string;
  /** Altezza dell'iframe con mount() (default "100%"). */
  height?: string;
  /** Se true, il widget invia al negozio anche le misure del corpo (evento bodyChange). Default false: restano sul dispositivo dell'utente. */
  shareBody?: boolean;
  title?: string;
  onReady?: (p: { protocol: number }) => void;
  onInitialized?: (p: { productId: string; size: string; recommendedSize: string | null; warnings: string[] }) => void;
  onSizeChange?: (size: string) => void;
  onFit?: (e: FitEvent) => void;
  onBodyChange?: (body: BodyMeasurements) => void;
  onError?: (e: TryOnError) => void;
  onClose?: () => void;
}

export interface TryOnController {
  iframe: HTMLIFrameElement;
  setSize(size: string): void;
  setProduct(product: TryOnProduct, size?: string): void;
  setBody(body: BodyMeasurements): void;
  on(event: "ready" | "initialized" | "sizeChange" | "fit" | "bodyChange" | "error" | "destroy", fn: (...args: any[]) => void): () => void;
  destroy(): void;
  /** Solo per i controller creati con open(). */
  close?(): void;
}

export interface TryOnStatic {
  version: string;
  protocol: number;
  configure(options: { widgetUrl?: string }): { widgetUrl: string | null };
  mount(container: HTMLElement, options: TryOnOptions): TryOnController;
  open(options: TryOnOptions): TryOnController;
}

declare const TryOn: TryOnStatic;
export default TryOn;

// --- @tryon/sdk/react ---
export interface TryOnWidgetProps extends Omit<TryOnOptions, "onClose"> {
  className?: string;
  style?: Record<string, string | number>;
}
export function TryOnWidget(props: TryOnWidgetProps): any;
export { TryOn };
