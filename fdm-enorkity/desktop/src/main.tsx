import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { bootstrapApi } from "./lib/api";
import "./index.css";

const client = new QueryClient();

void bootstrapApi().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
