# Configuration & self-hosting

nonlinear is configured entirely through **environment variables** on the API
container (`apps/api`). There is no config file and no in-app "server settings"
screen — everything an operator sets lives in the environment, so a deployment
is reproducible and nothing security-sensitive (SSO client secrets, the SCIM
token, the AI key) is editable by end users through the UI.

Set these in `docker-compose.yml` (the `api` service `environment:` block) for a
container deploy, or in your platform's app settings on Azure. Every integration
is **off unless configured** — the default `docker compose up` needs none of them.

## Core

| Variable         | Default                                                  | Purpose                                                                                 |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `STORAGE`        | `postgres`                                               | `postgres` or `memory` (memory is for dev/tests; data is ephemeral)                     |
| `DATABASE_URL`   | `postgres://nonlinear:nonlinear@postgres:5432/nonlinear` | Postgres connection string                                                              |
| `PORT` / `HOST`  | `3000` / `0.0.0.0`                                       | API listen address                                                                      |
| `APP_URL`        | `http://localhost:8080`                                  | Public base URL — used in emails, intake links, invite links, and the OIDC redirect URI |
| `SECURE_COOKIES` | `false`                                                  | Set `true` when serving over HTTPS so the session cookie is `Secure`                    |
| `BLOB_DIR`       | `./blobs`                                                | Filesystem directory for attachment blobs (when Azure Blob is off)                      |
| `INTAKE_SECRET`  | _(per-boot random)_                                      | Signs public-intake status links. Set a stable value so a submitter's status URL survives restarts; unset regenerates each boot |

> **Production:** put HTTPS in front, set `SECURE_COOKIES=true`, and decide your
> registration policy (below). There is no built-in rate limiting.

## Who can create an account (registration policy)

This is the security model, and it matters — see the note in the login flow.

- The **first** person to register creates the workspace and becomes its **admin**
  (the "owner"). This always works; it's how you set up a fresh instance.
- **After that, registration is closed by default.** Reaching the server is _not_
  enough to get an account. New teammates join one of three ways:
  1. **An admin invite** — Settings → Members → _Invite people_ generates a
     single-use link (valid 14 days) you share out-of-band.
  2. **SSO** — if OIDC is configured, sign-in provisions/links accounts (below).
  3. **SCIM** — your IdP pushes users (below).
- `ALLOW_SIGNUPS=true` reopens **open self-registration** (anyone who can reach
  the server may create an account). Only do this behind a trusted network
  boundary (VPN/private network). Default is `false`.

| Variable        | Default | Purpose                                              |
| --------------- | ------- | ---------------------------------------------------- |
| `ALLOW_SIGNUPS` | `false` | `true` lets anyone self-register from the login page |

## Single sign-on (OIDC)

SSO is **configured in the environment, not in the database.** Set the following
on the API and restart; the login page then shows a "Continue with …" button and
`GET /api/meta` reports SSO as available.

| Variable               | Required | Purpose                                                                                               |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `OIDC_ISSUER`          | yes      | The provider's issuer URL (its `/.well-known/openid-configuration` is discovered from this)           |
| `OIDC_CLIENT_ID`       | yes      | The application/client ID registered with the provider                                                |
| `OIDC_CLIENT_SECRET`   | usually  | The client secret (confidential clients; omit only for public/PKCE-only apps)                         |
| `OIDC_LABEL`           | no       | Button text, e.g. `Microsoft Entra ID` (default: "Single sign-on")                                    |
| `OIDC_ALLOWED_DOMAINS` | no       | Comma-separated email domains allowed to sign in, e.g. `acme.com,acme.io`                             |
| `OIDC_AUTO_PROVISION`  | no       | `true` (default) creates an account on first SSO login; `false` requires the account to already exist |

**The redirect URI to register with your provider is:**

```
<APP_URL>/api/auth/sso/callback
```

e.g. `https://issues.acme.com/api/auth/sso/callback`. It must match exactly.

### Setup by provider

**Microsoft Entra ID (Azure AD).** Azure Portal → App registrations → New
registration. Add a **Web** redirect URI of `<APP_URL>/api/auth/sso/callback`.
Under _Certificates & secrets_ create a client secret. Then set:

```
OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
OIDC_CLIENT_ID=<application (client) id>
OIDC_CLIENT_SECRET=<the secret value>
OIDC_LABEL=Microsoft Entra ID
OIDC_ALLOWED_DOMAINS=acme.com
```

**Okta.** Applications → Create App Integration → OIDC / Web Application. Set the
sign-in redirect URI to `<APP_URL>/api/auth/sso/callback`. Then:

```
OIDC_ISSUER=https://<your-org>.okta.com
OIDC_CLIENT_ID=<client id>
OIDC_CLIENT_SECRET=<client secret>
OIDC_LABEL=Okta
```

**Google Workspace.** Google Cloud Console → Credentials → OAuth client ID → Web
application. Authorized redirect URI `<APP_URL>/api/auth/sso/callback`. Then:

```
OIDC_ISSUER=https://accounts.google.com
OIDC_CLIENT_ID=<...>.apps.googleusercontent.com
OIDC_CLIENT_SECRET=<...>
OIDC_LABEL=Google
OIDC_ALLOWED_DOMAINS=acme.com
```

**Keycloak / Auth0 / any spec-compliant OIDC provider** work the same way: set
`OIDC_ISSUER` to the realm/tenant issuer, register the redirect URI, and supply
client id/secret.

How it resolves an account on sign-in: match by the provider's stable subject →
else link an existing account by email → else just-in-time provision a member
(when `OIDC_AUTO_PROVISION` isn't `false` and the email domain is allowed). The
IdP subject is stored server-side only and never synced to clients.

`docker-compose.ssotest.yml` in the repo stands up a mock OIDC provider for local
verification.

## SCIM provisioning

Let an IdP create and deactivate accounts. Set a bearer token; the endpoints live
at `/scim/v2/Users`.

| Variable     | Purpose                                                |
| ------------ | ------------------------------------------------------ |
| `SCIM_TOKEN` | Bearer secret your IdP presents; unset = SCIM disabled |

Point your IdP's SCIM connector at `<APP_URL>/scim/v2/Users` with
`Authorization: Bearer <SCIM_TOKEN>`. Users are provisioned as members;
deactivation (SCIM `active:false` or DELETE) revokes sessions. Groups are not
implemented — team membership is managed in-product.

## AI features (bring-your-own-key)

AI is **configured in the app**, not the environment: an admin sets it under
Settings → AI (provider, model, API key). The key is stored server-side and never
synced to browsers. There are no AI env vars. Features: a Pulse "Summarize with
AI" action and issue label suggestions. With nothing configured, no AI surface
appears.

## Attachment storage (Azure Blob)

By default attachments live on a local filesystem volume (`BLOB_DIR`). For a
stateless/Azure deploy, point them at Azure Blob Storage:

| Variable                       | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `AZURE_BLOB_CONNECTION_STRING` | Storage account connection string; unset = fs volume |
| `AZURE_BLOB_CONTAINER`         | Container name (default `attachments`)               |

`docker-compose.azuretest.yml` verifies this against the Azurite emulator.

## Email digests (SMTP)

| Variable    | Purpose                                                      |
| ----------- | ------------------------------------------------------------ |
| `SMTP_URL`  | e.g. `smtp://mailhog:1025`; unset = digests off              |
| `SMTP_FROM` | From header (default `nonlinear <no-reply@nonlinear.local>`) |

## GitHub PR integration

| Variable                | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret for the inbound PR webhook; unset = disabled |

Point a repo webhook at `<APP_URL>/api/integrations/github` (JSON, this secret).
