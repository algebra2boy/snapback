// Auth0 configuration – values are injected at build time via Vite's
// import.meta.env mechanism so they never appear in source control.
//
// Copy .env.local.example → .env.local and fill in your tenant values
// before running `npm run dev` or `npm run build`.

export const auth0Config = {
  domain: import.meta.env.VITE_AUTH0_DOMAIN,
  clientId: import.meta.env.VITE_AUTH0_CLIENT_ID,
  authorizationParams: {
    redirect_uri: typeof window !== "undefined" ? window.location.origin : "",
    // Uncomment and set if you need a custom API audience:
    // audience: import.meta.env.VITE_AUTH0_AUDIENCE,
  },
};
