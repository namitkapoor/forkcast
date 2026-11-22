import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

function clearForkcastLocalCache(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("forkcast:")) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[Forkcast] Uncaught UI error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-crash" role="alert">
        <div className="app-crash__card">
          <div className="app-crash__eyebrow">Forkcast · Recovery</div>
          <h1>Something went wrong in this view</h1>
          <p className="muted">
            Your recorded journeys and server history are safe. You can reload the studio or clear cached browser state if a local draft got out of sync.
          </p>
          <pre className="app-crash__msg">{this.state.error.message}</pre>
          <div className="app-crash__actions">
            <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
              Reload Forkcast
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                clearForkcastLocalCache();
                window.location.reload();
              }}
            >
              Reset local cache & reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
