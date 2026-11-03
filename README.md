# Zaakhub

Lightweight case and HR workspace (Express + EJS + lowdb). One container, data on a volume.

The UI is available in English, Danish, German and Dutch. You can run several **workspaces** (branches) on one installation. Each workspace has its own cases, people, companies, staff and integrations.

## Run with Docker

```bash
docker compose up --build -d
```

Open http://localhost:3000

## First install

On an **empty** data volume the onboarding wizard opens:

1. Create a **global administrator** account.
2. Create the **first workspace** (name, language, profile, optional login domain).

You then sign in as that administrator and finish setup under **Settings**: extra workspaces, staff, login domains, OmniDocs Create and Microsoft Entra ID.

Existing volumes that already have a global administrator skip the wizard.

A workspace can be **case management**, **HR**, or both. Sample persons, companies, case types and cases can be imported later under **Settings → General** (in the current UI language). Demo staff are only created if you opt in when creating a workspace, or with:

```bash
SEED_DEMO=true docker compose up --build -d
```

| Role | Email | Password |
| --- | --- | --- |
| Global administrator | admin@zaakhub.local | ChangeMe!Admin |
| Case manager | manager@zaakhub.local | ChangeMe!Manager |
| Employee | medewerker@zaakhub.local | ChangeMe!User |

Change `SESSION_SECRET` in `.env` or in `docker-compose.yml` before going live.

## Workspaces and roles

- **Global administrators** are not tied to one branch. They manage all workspaces and platform admins under **Settings → Workspaces** and **Settings → Administrators**.
- Other employees belong to one workspace and only see that branch.
- The login form has a workspace dropdown. Optional **login domains** on a workspace restrict who may sign in there (email host must match; subdomains are allowed). Leave the field empty for no restriction. Global administrators always get in.
- Hostnames can also map to a workspace when they match a linked domain.

Health: `GET /api/health`

## Data

JSON databases and attachments live on volume `zaakhub-data` → `/app/data`:

- `platform.json` — workspaces and global administrators
- `tenants/{slug}/db.json` — workspace data
- `tenants/{slug}/uploads/` — attachments

Bind-mount locally instead of a named volume:

```yaml
volumes:
  - ./data:/app/data
```

Do not commit `data/platform.json` or `data/tenants/`; they contain accounts and live records.

## OmniDocs Create

Connection uses OAuth client credentials (`POST /api/v1/oauth2/token`). Templates: `GET .../recipes/search`. Documents: `POST .../recipes/{id}/generate` (fileUri) or `POST .../generate/prepare` (interactive).

Configure per workspace under **Settings → Integrations**, or via environment as a fallback:

- `CREATE_CLIENT_ID` / `CREATE_CLIENT_SECRET`
- `CREATE_UNIT_ID` / `CREATE_CONTENT_SOURCE_ID`
- optional `PUBLIC_BASE_URL` for webhooks (Create must be able to reach Zaakhub)

Then use **Test connection** and **Sync templates**.

## Microsoft Entra ID

Optional under **Settings → Integrations**.

1. Register an app in Entra (Web).
2. Redirect URI: `https://your-host/auth/azure/callback` (locally `http://localhost:3000/auth/azure/callback`).
3. API permission `User.Read`, then create a client secret.
4. Enter tenant ID, application (client) ID and secret.

Unknown Microsoft accounts are created as employees in the current workspace, but only if that workspace allows their email domain.

## Local without Docker

```bash
copy .env.example .env
npm install
npm start
```
