# Zaakhub

Lightweight case and HR workspace (Express + EJS + lowdb). One container, data on a volume.

The UI is available in English, Danish, German and Dutch. On first run you choose whether the workspace is **case management**, **HR**, or both.

## Run with Docker

```bash
docker compose up --build -d
```

Open http://localhost:3000

On an **empty** database the onboarding wizard opens: organisation name and number prefixes, application profile, first administrator, optional OmniDocs Create, optional Microsoft Entra ID.

Existing volumes that already have users skip the wizard.

Sample persons and companies can be imported later under **Settings → General** (in the current UI language). Demo users are only created if you opt in:

```bash
SEED_DEMO=true docker compose up --build -d
```

| Role | Email | Password |
| --- | --- | --- |
| Administrator | admin@zaakhub.local | ChangeMe!Admin |
| Case manager | manager@zaakhub.local | ChangeMe!Manager |
| Employee | medewerker@zaakhub.local | ChangeMe!User |

Change `SESSION_SECRET` in `.env` or in `docker-compose.yml` before going live.

Data (JSON database + attachments) lives on volume `zaakhub-data` → `/app/data`.

Bind-mount locally instead of a named volume:

```yaml
volumes:
  - ./data:/app/data
```

Health: `GET /api/health`

## OmniDocs Create

Connection uses OAuth client credentials (`POST /api/v1/oauth2/token`). Templates: `GET .../recipes/search`. Documents: `POST .../recipes/{id}/generate` (fileUri) or `POST .../generate/prepare` (interactive).

Configure during onboarding, under Settings, or via environment:

- `CREATE_CLIENT_ID` / `CREATE_CLIENT_SECRET`
- `CREATE_UNIT_ID` / `CREATE_CONTENT_SOURCE_ID`
- optional `PUBLIC_BASE_URL` for webhooks (Create must be able to reach Zaakhub)

Then use **Test connection** and **Sync templates**.

## Microsoft Entra ID

Optional during onboarding or later under Settings → Integrations.

1. Register an app in Entra (Web).
2. Redirect URI: `https://your-host/auth/azure/callback` (locally `http://localhost:3000/auth/azure/callback`).
3. API permission `User.Read`, then create a client secret.
4. Enter tenant ID, application (client) ID and secret.

Unknown Microsoft accounts are created as employees.

## Local without Docker

```bash
copy .env.example .env
npm install
npm start
```
