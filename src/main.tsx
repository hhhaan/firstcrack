import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { initI18n } from "./shared/i18n";
import 'uplot/dist/uPlot.min.css';

const bootstrap = async () => {
  await initI18n();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

void bootstrap();
