# scheura-api

Cloudflare Worker + D1 for Scheura: end-to-end encrypted sync (the server only stores ciphertext) and Web Push reminders sent by a cron trigger every minute. The contract lives in `../shared/protocol.ts`.

## Endpoints

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/v1/health` | none | `{ ok: true }` |
| POST | `/v1/sync` | `SyncRequest` | `SyncResponse` |
| POST | `/v1/push/subscribe` | `PushSubscribeRequest` | `{ ok: true }` |
| DELETE | `/v1/push/subscribe` | `PushUnsubscribeRequest` | `{ ok: true }` |
| PUT | `/v1/push/schedule` | `PushScheduleRequest` | `{ ok: true, scheduled: n }` |

Errors are JSON, `{ error, message }`, with status 400 (bad shape), 403 (origin not allowed), 404, 405, 413 (body too large) or 500.

## First deploy (lead)

```sh
cd server
npm install
npx wrangler login
# D1 "scheura" already exists; its database_id is already in wrangler.toml
npx wrangler d1 migrations apply scheura --remote
npx wrangler secret put VAPID_PRIVATE_JWK # paste the private JWK as one line of JSON: {"kty":"EC","crv":"P-256","x":"…","y":"…","d":"…"}
npx wrangler deploy                       # prints https://scheura-api.<subdomain>.workers.dev
```

Then set `VITE_API_URL` in the app to that URL (with no trailing slash). The JWK's `x`/`y` must match `VAPID_PUBLIC_KEY` in `wrangler.toml` and the app's `VAPID_PUBLIC_KEY`. If they do not match, the cron logs `VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_JWK` and sends nothing.

Check the deploy with `curl https://scheura-api.<subdomain>.workers.dev/v1/health`. Use `npx wrangler tail` to watch logs, including cron runs.

## Local development

```sh
npm test                                   # vitest: crypto, validation and the real SQL run on node:sqlite
npm run typecheck
npx wrangler d1 migrations apply scheura --local
echo "VAPID_PRIVATE_JWK='{\"kty\":\"EC\",...}'" > .dev.vars   # optional; without it, push sending is disabled
npx wrangler dev --test-scheduled          # http://localhost:8787 ; trigger the cron: curl "localhost:8787/__scheduled?cron=*+*+*+*+*"
```

Running locally needs no Cloudflare login.

## How it works

- **Sync**: each space (a 64-hex id derived from the sync code) has its own sequence. In a single D1 batch (one transaction), a change is applied only when its `updatedAt` is at least the stored one (last-write-wins). An identical re-push is a no-op. Each accepted row gets the next `seq`. The response returns rows with `seq > cursor`, ordered by `seq`, up to 500 rows or about 4 MB of ciphertext, whichever comes first, with `more: true` when more remain. A client's own writes come back to it in the response, which is harmless. When an `attachments` tombstone is stored, that attachment's `chunks` rows (ids `<attId>:<n>`) are deleted from the server. If a client's cursor is ahead of the server's (because the server data was reset), the server starts again from 0.
- **Push**: `schedule` replaces the device's unsent reminders. It ignores reminders more than 5 minutes in the past. A key that was already sent at the same `at` is not sent again. Every minute the cron:
  1. sends reminders due within the next 30 s;
  2. marks them sent;
  3. deletes the subscription and its queue on 404/410;
  4. retries on 429, 5xx or a network error;
  5. drops reminders more than 6 h overdue without sending them;
  6. deletes queue rows older than 7 days.
- Web Push is implemented with WebCrypto only: a VAPID ES256 JWT, and RFC 8291 `aes128gcm` encryption. The tests check it against the RFC 8291 Appendix A test vector.

## Free-plan notes

- **Cron every minute** = 1,440 scheduled invocations a day. These count toward the Workers free limit of 100,000 requests a day, together with API calls.
- **Per-invocation limits on the free plan**: 10 ms of CPU and 50 external subrequests. Each push is one `fetch` plus an ECDH/AES encryption, so the cron sends at most `PUSH_BATCH` pushes per run (default 40, in `wrangler.toml`). Anything left over goes out on the next minute. One JWT is cached per push-service origin for each run.
- **D1 free**: 5 GB of storage, 5 M rows read a day, 100 k rows written a day. Each accepted sync change writes one row, plus index updates. Each cron run reads the due rows and writes one row per sent push. An idle cron tick costs a couple of cheap queries that touch no rows.
- **Limits enforced by the API**:
  - sync body ≤ 20 MB, ≤ 500 changes, `data` ≤ 1.5 MB per change, ids ≤ 128 chars;
  - push bodies ≤ 1 MB, ≤ 500 reminders.

  The server splits big uploads into JSON parameters of about 1.8 MB, because D1 caps a single bound string at 2 MB.
