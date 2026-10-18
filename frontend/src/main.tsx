import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";
import { captureAttribution } from "./lib/attribution";

captureAttribution(window.location.search);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          theme="dark"
          position="top-center"
          toastOptions={{ classNames: { toast: "!bg-ink-800 !border-white/10 !rounded-2xl !font-sans" } }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
