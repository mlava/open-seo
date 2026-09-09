# Bing Webmaster egress proxy

Bing Webmaster's API throttles Cloudflare Workers' shared outbound IP range
(`400 ErrorCode 17 ThrottleIP`), so the app cannot call it from the Worker.
This is a single Vercel function that relays those calls from Vercel's egress.

It forwards only `GET`/`POST` to `https://ssl.bing.com/webmaster/api.svc/json/<Method>`,
passing the caller's `Authorization` header, body, and query string through
unchanged, and refuses anything without the shared secret.

## Deploy

```sh
cd bing-proxy
vercel link            # new project, e.g. open-seo-bing-proxy
vercel env add BING_PROXY_SECRET production   # paste a long random string
vercel deploy --prod
```

Then on the Worker:

```sh
wrangler secret put BING_PROXY_URL      # https://<project>.vercel.app
wrangler secret put BING_PROXY_SECRET   # the same string
```

Leave both unset to call Bing directly (self-hosts not on Cloudflare do not
need this).
