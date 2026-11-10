import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";
import { captureAttribution } from "./lib/attribution";

captureAttribution(window.location.search);

// After a deploy the old page asks for chunk files that no longer exist. Reload once to pick up
// the new version instead of showing an error; the guard stops a reload loop if it keeps failing.
const RELOAD_KEY = "nova:chunk-reload";
const isChunkError = (error: unknown) =>
  /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically/i.test(String((error as Error)?.message ?? error));
function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 10_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { /* storage blocked: still try once */ }
  window.location.reload();
  return true;
}
window.addEventListener("vite:preloadError", (event) => {
  if (reloadForNewVersion()) event.preventDefault();
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkError(error) && reloadForNewVersion()) return;
    // Keep the original error available in the browser console for support diagnostics.
    console.error("Nova AI interface error", error, info);
    fetch("/api/v1/client-errors", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({
        message: String(error?.message ?? error).slice(0, 2000),
        stack: `${error?.stack ?? ""}\n--- component ---${info.componentStack ?? ""}`.slice(0, 4000),
        url: window.location.href.slice(0, 500),
      }),
    }).catch(() => {});
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
