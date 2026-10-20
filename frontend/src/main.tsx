import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
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

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the original error available in the browser console for support diagnostics.
    console.error("Nova AI interface error", error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="grid min-h-[100dvh] place-items-center bg-ink-950 p-5 text-zinc-100">
          <section className="w-full max-w-md rounded-3xl border border-white/10 bg-ink-900 p-7 text-center shadow-2xl">
            <p className="text-lg font-bold">Интерфейс временно не загрузился</p>
            <p className="mt-2 text-sm leading-6 text-zinc-400">Ваше действие могло сохраниться. Обновите страницу и проверьте результат.</p>
            <button onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-gradient-to-r from-nova-500 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white">
              Обновить страницу
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
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
    </AppErrorBoundary>
  </StrictMode>,
);
