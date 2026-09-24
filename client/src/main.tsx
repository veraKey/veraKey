import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./app.css";

const root = document.getElementById("root")!;
// Docs pages arrive prerendered (scripts/prerender-docs.mjs): hydrate them, so the page stays up while its code loads.
if (root.hasChildNodes()) hydrateRoot(root, <App />);
else createRoot(root).render(<App />);
