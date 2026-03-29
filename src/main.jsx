import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";
import "./index.css";
import App from "./App.jsx";
import { auth0Config } from "@/lib/auth0Config";
import { ThemeProvider } from "@/lib/ThemeContext";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ThemeProvider>
      <Auth0Provider {...auth0Config}>
        <App />
      </Auth0Provider>
    </ThemeProvider>
  </StrictMode>,
);
