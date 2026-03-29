import { useAuth0 } from "@auth0/auth0-react";
import LoginPage from "@/components/LoginPage";

/**
 * AuthGuard
 *
 * Wraps any subtree and gates rendering behind Auth0 authentication.
 *
 * States handled:
 *   1. Auth0 SDK is still initialising  → full-screen skeleton / spinner
 *   2. User is not authenticated        → <LoginPage />
 *   3. User is authenticated            → renders children
 */
export default function AuthGuard({ children }) {
  const { isLoading, isAuthenticated, error } = useAuth0();

  // ── 1. SDK initialising ───────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        {/* Branded spinner */}
        <div className="relative flex h-14 w-14 items-center justify-center">
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-sm font-semibold text-white shadow-sm">
            S
          </div>
        </div>
        <p className="text-sm text-muted-foreground animate-pulse">
          Initialising…
        </p>
      </div>
    );
  }

  // ── 2. Auth0 configuration / network error ────────────────────────────────
  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-foreground">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-500">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-800">
            Authentication error
          </p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            {error.message ?? "Could not connect to the authentication service."}
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── 3. Not authenticated → login wall ─────────────────────────────────────
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // ── 4. Authenticated → render the app ────────────────────────────────────
  return <>{children}</>;
}
