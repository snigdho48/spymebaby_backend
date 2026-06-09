# BrainCount Backend

Express + MySQL backend for the BrainCount tracking dashboard (`braincount-frontend`).
It implements authentication and every API the dashboard pages call: trackers CRUD,
the report/`dateTracking` aggregation, the dashboard summary, and the public
impression/click tracking pixel.

## Stack

- Node.js + Express
- MySQL (via `mysql2`)
- JWT auth (`jsonwebtoken`) + password hashing (`bcryptjs`)

## Setup

1. Install dependencies:

```bash
cd backend
npm install
```

2. Create your environment file from the template and edit DB credentials:

```bash
cp .env.example .env
```

3. Create the database, tables, and a default admin user:

```bash
npm run init-db
```

This creates the `braincount` database (if missing), applies `src/db/schema.sql`,
and seeds an admin user matching the credentials the frontend already uses
(`snigdho` / `azsx1234`).

4. Start the server:

```bash
npm run dev    # auto-reload (nodemon)
# or
npm start
```

Server runs on `http://localhost:3001` by default.

## Connecting the frontend

In `braincount-frontend/src/app/constant/Urls.js`, point `url` at the local backend
while developing:

```js
const url = url2; // http://localhost:3001/api/
```

## API

All routes are prefixed with `/api`.

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| POST | `/register` | – | Create a user `{ username, password }` |
| POST | `/login` | – | Returns `{ token, username, role, name, image }` |
| POST | `/logout` | Bearer | Acknowledge logout |
| GET | `/trackers` | Bearer | List trackers (with nested `content[]`) |
| POST | `/tracker` | Bearer | Create tracker `{ name, descriptions, contents: [string] }` |
| POST | `/updatetracker` | Bearer | Update `{ uuid, name, description, content: [{ name, uuid? }] }` |
| DELETE | `/tracker/:uuid` | Bearer | Delete a tracker |
| GET | `/dashboarddata` | Bearer | Totals + per-day impressions |
| GET | `/dateTracking?tracker_uuid=&content=` | Bearer | Per-content/day report rows |
| GET | `/track?tracker_uuid=&tag=&portal_url=&client_ip=&userAgent=` | – | Tracking pixel (returns a 1×1 GIF) |

### How the tracking pixel works

Each tracker `content` row has two codes: `imp_code` (impression) and `click_code`
(click). The Tag modal in the dashboard generates `<script>` snippets that call
`/api/track?...&tag=<code>`. The backend matches the `tag` against the content codes,
parses browser/OS from the user agent, records a `tracking_events` row, and returns a
transparent pixel.

## Schema

See `src/db/schema.sql`. Tables: `users`, `trackers`, `contents`, `tracking_events`.
