/**
 * contact relay → Poke
 * ------------------------------------------------------------------
 * Drop this into an existing Vercel (Next.js App Router) app as:
 *     app/api/contact/route.ts
 *
 * Then in that Vercel project's settings, add an env var:
 *     POKE_API_KEY = <your V2 key from https://poke.com/kitchen>
 * (Optional) override the allowed origin(s):
 *     CONTACT_ALLOWED_ORIGINS = https://preetham.org,https://www.preetham.org
 *
 * The Mintlify contact form (preetham.org/contact) POSTs:
 *     { name, email, message, company (honeypot), source }
 * This route validates, drops bots, and forwards a single message to
 * Poke's API Message endpoint.
 *
 * The Poke key NEVER reaches the browser — it lives only here, server-side.
 *
 * For a Pages Router app or a non-Next Vercel project, see relay/README.md.
 */

const ALLOWED_ORIGINS = (
  process.env.CONTACT_ALLOWED_ORIGINS ||
  "https://preetham.org,https://www.preetham.org"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const POKE_API_MESSAGE_ENDPOINT = "https://poke.com/api/v1/inbound/api-message";

// best-effort in-memory rate limit (per warm instance — not a hard guarantee
// across serverless instances; add Upstash if you need strict limits, see README)
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 4;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");

  // defense in depth: block browser requests from other origins
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ ok: false, error: "forbidden origin" }, 403, origin);
  }

  if (!process.env.POKE_API_KEY) {
    return json({ ok: false, error: "relay not configured" }, 500, origin);
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return json({ ok: false, error: "too many requests" }, 429, origin);
  }

  let data: Record<string, unknown>;
  try {
    data = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400, origin);
  }

  // honeypot: humans never fill `company`. silently 200 so bots learn nothing.
  if (typeof data.company === "string" && data.company.trim() !== "") {
    return json({ ok: true }, 200, origin);
  }

  const name = String(data.name || "").trim().slice(0, 100);
  const email = String(data.email || "").trim().slice(0, 200);
  const message = String(data.message || "").trim().slice(0, 4000);
  const source = String(data.source || "preetham.org/contact").trim().slice(0, 200);

  if (!name || !email || !message) {
    return json({ ok: false, error: "missing fields" }, 400, origin);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "invalid email" }, 400, origin);
  }

  const text = `📬 new message from preetham.org\n\nfrom: ${name} <${email}>\n\n${message}`;

  try {
    const res = await fetch(POKE_API_MESSAGE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.POKE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: text,
        contact: { name, email, message, source },
      }),
    });
    if (!res.ok) {
      return json({ ok: false, error: "delivery failed" }, 502, origin);
    }
  } catch {
    return json({ ok: false, error: "delivery failed" }, 502, origin);
  }

  return json({ ok: true }, 200, origin);
}
