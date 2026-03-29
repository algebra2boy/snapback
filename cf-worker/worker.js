const ROUTES = {
  "/gamma/": "https://gamma-api.polymarket.com/",
  "/clob/": "https://clob.polymarket.com/",
};

const ALLOWED_ORIGIN = "https://algebra2boy.github.io";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    for (const [prefix, target] of Object.entries(ROUTES)) {
      if (url.pathname.startsWith(prefix)) {
        const upstream = target + url.pathname.slice(prefix.length) + url.search;
        const res = await fetch(upstream, { headers: { "User-Agent": "snapback/1.0" } });
        const body = await res.arrayBuffer();
        return new Response(body, {
          status: res.status,
          headers: {
            "Content-Type": res.headers.get("Content-Type") ?? "application/json",
            ...CORS_HEADERS,
          },
        });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
