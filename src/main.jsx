import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { assetPath } from "./data/menu";
import "./styles/tokens.css";
import "./styles/background.css";
import "./styles/components.css";
import "./styles/ticket.css";
import "./styles/success.css";
import "./styles/motion.css";

document.documentElement.style.setProperty(
  "--checker-image",
  `url("${assetPath("checker.svg")}")`,
);

createRoot(document.getElementById("root")).render(<App />);
