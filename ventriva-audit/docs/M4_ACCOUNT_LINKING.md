# M4: Manual identity proof and link/unlink

The customer signs into both systems independently. Ventriva creates a short-lived code from the authenticated legacy session; AuditFlow redeems it under a confirmed Supabase identity through a server-only signed bridge. This proves both accounts without guessing by email.

- UI: the legacy dashboard provides a 10-minute one-time code; `/validate` provides the code entry, read-only summaries and revoke button.
- AuditFlow routes: `POST /api/validation/link`, `DELETE /api/validation/link`, plus the existing read-only `GET /api/validation/analyses`.
- Code: 32 URL-safe characters generated via 24 random bytes, stored only as SHA-256 in Mongo; atomic single-use consume and expiry.
- Server side: 32+ char `VENTRIVA_BRIDGE_SECRET` on both runtimes and pinned HTTPS `VENTRIVA_BRIDGE_ORIGIN`. Canonical signed POST includes fixed path, identity, timestamp and exact body hash.
- Identity: Supabase Auth session and confirmed email for redemption; existing legacy session and same-origin for code issuance; Mongo unique indexes for active verified mapping on both user ids.
- Failures: 400 invalid code; 401 unauthenticated; 403 wrong origin/unconfirmed; 409 used/expired/collision; 429 per-user rate limit; 503 upstream unavailable. Generic errors do not disclose IDs or secrets.
- Revocation: available from both original apps, changes mapping status without deleting users, reports or payments. Account linking does **not** merge logins, billing, stored data or subscriptions.
- Security: code/username cannot be chosen by browser; signed requests use a strict origin, network timeouts, response bounds and no-store; no raw report bodies returned through the gateway.
- Test plan: offline cross-user isolation and one-time code tests; live staging cross-service verification and real Mongo concurrency remain **required**. The FastAPI implementation remains off the live Render deployed branch until explicitly approved and proven in staging.
- Rollback: unset server-only bridge environment variables on either service; gateway fails closed. Existing legacy and audit authentication/billing functions remain independently accessible.
