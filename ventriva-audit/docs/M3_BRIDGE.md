# M3: Read-only Ventriva integration boundary

## Endpoints
- Authenticated AuditFlow API: `GET /api/validation/analyses` (Supabase Auth, per-user database rate limit, no-store).
- Internal Ventriva backend API: `GET /api/internal/v1/analyses` (server-to-server signed HMAC assertion, read-only, scoped by verified legacy account link).
- New integration provides **no browser-direct Ventriva backend credentials** and cannot queue reports or alter billing.

## Expected responses
| Condition | Gateway response |
| --- | --- |
| No Supabase session | 401 Unauthorized |
| Rate limit exceeded | 429 |
| No verified account link | 409 Account linking not yet complete |
| Bridge not configured, invalid response, timeout or unavailable | 503 generic unavailable |
| Successfully linked with validated output | 200 `{ analyses: [{id,name,status,kind,created_at}] }` |

A 409 is the expected normal result before M4. The current `/validate` page still directs users to the independent legacy sign-in; do not claim unified login or report access.

## Security
- Server-only env `VENTRIVA_BRIDGE_SECRET` (32+ random chars) and `VENTRIVA_BRIDGE_ORIGIN` pinned to `https://venturelens-l2q2.onrender.com`.
- Exact server-only GET path, HTTPS allowlisted origin, signed timestamp and canonical Supabase UUID. No client-supplied URL or email identity.
- 5-second timeout, redirect rejection, bounded 64KiB response, Zod strict output schema, no caching, 20 responses per 10-minute rate-limit bucket.
- Python bridge derives the legacy owner solely from an explicitly verified and unrevoked Mongo link. M3 does not create mappings. No report body, credentials or billing state returned.
- Tests cover anonymous requests, rate limits, invalid upstream/credentials/response, forbidden cross-tenant access, expired signatures, oversize output and missing mappings.

## Staging and rollout
1. Leave Ventriva Render live branch intact. Implement and test on isolated branch/preview.
2. Add a shared unique high-entropy secret to both **server** environments (not GitHub, not `NEXT_PUBLIC_`).
3. Deploy the backend endpoint before enabling the Next gateway; use the known HTTPS origin.
4. Confirm unsigned backend requests return 401; authenticated AuditFlow gateway requests return 409 before M4 account linking.
5. Confirm existing separate Ventriva login, audit scans, Stripe webhooks and monitoring remain unaffected. No production migration in M3.

The merged application is **not** complete merely because CI passes: real user linking, provider failure tests and live customer journey remain release gates.
