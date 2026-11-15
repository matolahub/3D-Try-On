import { createRoot } from "react-dom/client";
import "./embed.base.css";
import "./embed.extra.css";
import EmbedApp from "./EmbedApp.jsx";

createRoot(document.getElementById("root")).render(<EmbedApp modelUrl="/assets/man-model.glb" />);
