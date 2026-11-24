import { createRoot } from "react-dom/client";
import "./wearit.css";
import EmbedApp from "./EmbedApp.jsx";

createRoot(document.getElementById("root")).render(<EmbedApp modelUrl="/assets/man-model.glb" />);
