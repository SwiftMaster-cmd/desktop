# Bossman's Desktop

A personal desktop for notes, website shortcuts, and plans. The app stores records in a SQLite database on the server, with password sign-in, edit history, a trash view, and JSON import/export.

This is a new application. The original Bossman's Desktop plugin and its saved records are unchanged. The new desktop starts empty; importing an old export is a separate action.

## Run locally

Install **Node.js 24 or later**, then run:

```sh
git clone <your-repository-url>
cd bossmans-desktop
npm start
```

No dependency installation or build step is required. Open <http://localhost:3000> and create your desktop password on the setup screen (at least 10 characters). Keep that password somewhere safe. There is no email password-reset service.

The server listens on `127.0.0.1:3000` by default. To use a different port:

```sh
PORT=3001 npm start
```

Set `DATA_DIR` to use another data directory. Otherwise the database is `.data/desktop.sqlite` beneath the current working directory. Keep that directory persistent when restarting or moving the server.

## Use the desktop

- Create notes or website shortcuts; choose Personal, Minecraft, Work, or People as a workspace.
- Search saved content, pin useful items, and change an item's color.
- Edit an item and inspect its saved revisions.
- Move items to Trash and restore them later.
- Export your records as JSON, or import a backup without replacing existing IDs.

Shortcuts accept HTTP and HTTPS URLs. Notes remain plain text. The People workspace organizes notes; it does not yet include the previous People Compass prototype's interactive tracker or simulator.

## Keep the source and your records safe

Git stores the application source. Personal records, password credentials, sessions, and edit history live in the ignored `.data/` directory and are **not backed up by pushing to GitHub**.

Use the desktop's Export action to download a portable JSON backup. Keep a copy somewhere separate from the server. JSON exports contain your item content; treat them as private files. Imports add new IDs and skip IDs already present, so they do not overwrite current records. An item export is not a complete database backup: account credentials and full edit history stay in the database.

Each JSON import accepts up to 1,000 items and a 5 MB request. Larger exports may need splitting into smaller JSON files containing an `items` array before importing. Export itself includes all items, including Trash.

For a complete backup, stop the application and copy the entire `.data/` directory to a secure backup location. Restore that directory while the application is stopped. Do not commit database files, personal notes, export downloads, or environment secrets to Git.

Browsers connected to the same running server use the same database. Separate installations have separate databases; there is no automatic synchronization between hosts.

## Run in a container

```sh
docker build -t bossmans-desktop .
docker run --name bossmans-desktop \
  -p 127.0.0.1:3000:3000 \
  -v bossmans-desktop-data:/app/.data \
  bossmans-desktop
```

The named volume preserves records when the container is replaced. Back up the volume separately from the image. Containers listen on `0.0.0.0:3000`; the example exposes the port only on the host's loopback address.

For remote use, place the app behind an HTTPS reverse proxy or an authenticated private environment preview. Keep access private during initial password setup. A cloud workspace process is a development instance, not a guarantee of permanent hosting; durable deployments need persistent storage and a backup routine. Do not use a static host or an ephemeral filesystem for the SQLite database.

## Check changes

```sh
npm test
```

The test suite uses temporary databases. GitHub Actions runs it on Node.js 24 for pushes and pull requests.

## Project layout

```text
public/       Browser interface and styles
src/          Server and database modules
server.mjs    Application entry point
test/         API and persistence checks
.data/        Local database and account data (ignored)
```
