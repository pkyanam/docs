# contact relay → Poke

The `preetham.org/contact` form can't call Poke directly: the Poke API key would
ship to the browser and anyone could spam your iMessage. So the form POSTs to this
small serverless relay, which holds the key server-side and forwards the message.

```
contact form (browser)  ──POST { name,email,message,company }──▶  relay (Vercel)
                                                                      │ Bearer POKE_API_KEY
                                                                      ▼
                                          https://poke.com/api/v1/inbound-sms/webhook ──▶ iMessage
```

This file is NOT deployed by Mintlify (see `.mintignore`). It lives here so the
form and its backend stay together. Copy it into an existing Vercel app.

## Deploy (Next.js App Router — most likely your setup)

1. Copy `contact-route.ts` into your Vercel app at:
   ```
   app/api/contact/route.ts
   ```
2. In that Vercel project → Settings → Environment Variables, add:
   ```
   POKE_API_KEY = <key from https://poke.com/settings/advanced>
   ```
   (optional) `CONTACT_ALLOWED_ORIGINS = https://preetham.org,https://www.preetham.org`
3. Redeploy.
4. Your relay URL is `https://<that-app-domain>/api/contact`.
5. Tell me that URL (or set it yourself): in the Mintlify repo, edit
   `contact.mdx` and set `data-endpoint="https://<that-app-domain>/api/contact"`.

## Pages Router variant

If the app uses `pages/`, create `pages/api/contact.ts` with a default handler
instead. Same logic; signature is `(req, res)`:

```ts
export default async function handler(req, res) {
  // set the same CORS headers, handle req.method === "OPTIONS",
  // read req.body, run the same honeypot/validation, then fetch() Poke.
  // res.status(200).json({ ok: true })
}
```

## Non-Next Vercel project

Put the file at `api/contact.ts` (Vercel's zero-config functions). The exported
`POST`/`OPTIONS` Web-handler style above also works with the Edge runtime; for the
Node signature use `(req, res)` like the Pages Router variant.

## Test it

```bash
curl -i https://<that-app-domain>/api/contact \
  -H "Origin: https://preetham.org" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"name":"test","email":"t@t.com","message":"hello from curl"}'
# expect: HTTP 200 {"ok":true} and a Poke message in your iMessage
```

## Optional: hard rate limiting

The in-memory limiter is best-effort (per warm instance). For strict per-IP limits
add Upstash (free): create a Redis DB, set `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN`, and use `@upstash/ratelimit`.
