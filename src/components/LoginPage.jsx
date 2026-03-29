import { useAuth0 } from "@auth0/auth0-react";
import { LogIn } from "lucide-react";

export default function LoginPage() {
  const { loginWithRedirect, isLoading } = useAuth0();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Subtle grid background */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(#334155 1px, transparent 1px), linear-gradient(90deg, #334155 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Minimal top bar */}
      <header className="border-b border-border/60 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2.5 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-sm font-semibold text-white shadow-sm">
            S
          </div>
          <span className="text-[14px] font-semibold tracking-tight">
            Snapback
          </span>
          <span className="text-sm text-muted-foreground">No-arb Terminal</span>
        </div>
      </header>

      {/* Center card */}
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm">
          {/* Logo lockup */}
          <div className="mb-8 flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-950 text-2xl font-bold text-white shadow-lg ring-1 ring-slate-800">
              S
            </div>
            <div className="text-center">
              <h1 className="text-xl font-semibold tracking-tight">
                Snapback Terminal
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                No-arbitrage surface scanner for Polymarket
              </p>
            </div>
          </div>

          {/* Login card */}
          <div className="rounded-2xl border border-border/80 bg-white/80 p-8 shadow-sm backdrop-blur-md">
            <h2 className="mb-1 text-[15px] font-semibold">Sign in to continue</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Access is restricted to authenticated users. Sign in with your
              account to view dislocation data and spread analytics.
            </p>

            <button
              onClick={() => loginWithRedirect()}
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-2"
            >
              {isLoading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span>Connecting…</span>
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  <span>Sign in with Auth0</span>
                </>
              )}
            </button>
          </div>

          {/* Feature list */}
          <ul className="mt-6 space-y-2 px-1">
            {[
              "Strike ladder & expiry curve violation detection",
              "Live Gamma API family discovery",
              "No-arbitrage envelope visualization",
              "Corrective spread builder",
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[8px] font-bold text-slate-500">
                  ✓
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-4">
        <p className="text-center text-xs text-muted-foreground">
          Snapback · Relative-value analytics for prediction markets
        </p>
      </footer>
    </div>
  );
}
