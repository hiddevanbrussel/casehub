# Zaakhub

Lichtgewicht zaaksysteem (Express + EJS + lowdb). Eén container, data op een volume.

## Starten met Docker

```bash
docker compose up --build -d
```

Open http://localhost:3000

Bij een **lege** database opent de onboarding: organisatienaam en zaaknummer-prefix, eerste beheerder, optioneel OmniDocs Create, optioneel Microsoft Entra ID.

Bestaande volumes met gebruikers slaan de wizard over.

Voorbeelddata (demo-accounts) alleen als je die bewust wilt:

```bash
SEED_DEMO=true docker compose up --build -d
```

| Rol | E-mail | Wachtwoord |
| --- | --- | --- |
| Beheerder | admin@zaakhub.local | ChangeMe!Admin |
| Zaakmanager | manager@zaakhub.local | ChangeMe!Manager |
| Medewerker | medewerker@zaakhub.local | ChangeMe!User |

Wijzig `SESSION_SECRET` in `.env` of in `docker-compose.yml` voordat je live gaat.

Data (JSON-database + bijlagen) staat op volume `zaakhub-data` → `/app/data`.

Lokaal bind-mounten in plaats van een named volume:

```yaml
volumes:
  - ./data:/app/data
```

Health: `GET /api/health`

## OmniDocs Create

Koppeling via OAuth client credentials (`POST /api/v1/oauth2/token`). Templates: `GET .../recipes/search`. Documenten: `POST .../recipes/{id}/generate` (fileUri) of `POST .../generate/prepare` (interactief).

Vul in onboarding, Settings of via environment:

- `CREATE_CLIENT_ID` / `CREATE_CLIENT_SECRET`
- `CREATE_UNIT_ID` / `CREATE_CONTENT_SOURCE_ID`
- optioneel `PUBLIC_BASE_URL` voor webhooks (Create moet Zaakhub kunnen bereiken)

Daarna **Test verbinding** en **Sync templates**.

## Microsoft Entra ID

Optioneel tijdens onboarding of later onder Settings → Integrations.

1. App-registratie in Entra (Web).
2. Redirect URI: `https://jouw-host/auth/azure/callback` (lokaal `http://localhost:3000/auth/azure/callback`).
3. API-machtiging `User.Read`, client secret aanmaken.
4. Tenant ID, Application (client) ID en secret invullen.

Onbekende Microsoft-accounts worden als medewerker aangemaakt.

## Lokaal zonder Docker

```bash
copy .env.example .env
npm install
npm start
```
