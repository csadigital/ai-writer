# Deployment

For local installation, run `npm run setup`. It can provision MySQL through Docker Compose or configure an existing server, generates local secrets and imports the account schema. The Docker database binds only to 127.0.0.1 and stores data in a named volume. This local installer does not configure HTTPS, network egress or a production host.

1. Use Node.js 22.12+, MySQL 8+ and a dedicated MySQL user scoped to the application database. Install dependencies with `npm ci` and initialize `schema.sql`.
2. Configure fresh credentials through your host's secret manager. Never publish `.env`. Use a random `SESSION_SECRET` of at least 32 characters. Previously committed credentials must be rotated even after Git history is replaced.
3. Serve HTTPS through one trusted reverse proxy. Set `NODE_ENV=production` and `TRUST_PROXY=1` only when that topology applies. Secure session cookies will not work over plain HTTP in production.
4. The application uses persistent MySQL-backed sessions; allow its DB user to create the session table on initial startup.
5. Run Puppeteer as an unprivileged user with a working Chromium sandbox. Do not add `--no-sandbox` to a publicly reachable server. Install Chrome with `npx puppeteer browsers install chrome` if install-time downloads were skipped, and install its system libraries for your OS.
6. Apply outbound firewall rules blocking private, loopback, link-local and cloud metadata networks for the browser worker. URL checks are defense in depth: DNS changes between validation and connection can bypass application-only checks. Prefer an isolated worker with strict egress for untrusted pages.
7. Install FFmpeg/FFprobe for video processing. Temporary files are stored under `work/videos` and removed after each request; delete abandoned files after a crash as part of normal maintenance. Video generation is limited to three minutes, 50 MB and eight frames. Upstream YouTube downloads may stop working.
8. Add monitoring, database backups, account policy, API spend caps and deployment-level concurrency limits suitable for your traffic. The in-memory rate limiter is per process; use a shared limiter or gateway when running multiple instances. New accounts get ten credits, so public registration requires abuse controls appropriate to your deployment.
9. Set an OpenAI model available to your account and perform a real generation with a non-sensitive product image. The repository tests use service doubles and do not verify live API availability.

`GET /health` verifies the HTTP process responds. It does not probe MySQL or OpenAI. Use separate dependency monitoring.

The previous unfinished WordPress publishing route and password debugging scripts were removed. There is no payment, password recovery, email verification or automatic external publication workflow.
