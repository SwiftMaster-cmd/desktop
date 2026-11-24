# Bossman's Desktop

A personal desktop for notes, website shortcuts, and plans. Organize items into Personal, Minecraft, Work, and People workspaces; search, pin, edit, view history, move items to Trash, and restore them later.

The hosted app uses **Firebase Authentication** for email/password accounts, **Firebase Realtime Database** for saved records, and **Firebase Analytics** in supported browsers. It is configured for Firebase project `desktop-6562f`, with database URL `https://desktop-6562f-default-rtdb.firebaseio.com`. The Site is private: its owner signs in through ChatGPT to open the Site, then uses a Firebase account for their notes.

This is a new application. The original Bossman's Desktop plugin and its saved records are unchanged. Importing old records is a separate action. Notes remain plain text; shortcuts accept HTTP and HTTPS addresses. The People workspace organizes notes and does not yet include the previous People Compass prototype's interactive tracker or simulator.

## Finish Firebase setup

The web configuration in `firebase.config.mjs` identifies the Firebase project. It is public application configuration, not an administrator credential. Do not add service-account keys, administrator tokens, or personal records to source control.

In the [Firebase Console](https://console.firebase.google.com/project/desktop-6562f/overview), finish these settings before using hosted accounts and saved notes:

1. Under **Authentication → Sign-in method**, enable **Email/Password** and **Google**. For Google, select the project support email and save.
2. Under **Realtime Database → Rules**, publish the checked-in [database.rules.json](database.rules.json) for `desktop-6562f-default-rtdb`. These rules restrict each `user-desktops/{uid}` record to the Firebase account with that UID. [firebase.json](firebase.json) also points Firebase's deployment tools to this rules file.
3. Under **Authentication → Settings → Authorized domains**, add the deployed Site's hostname if it is not listed.
4. Confirm that Analytics is enabled for the project's web app if you want usage measurement.

The Firebase plugin is not connected yet, and the account configuration remains pending. The initial Authentication configuration check returned `CONFIGURATION_NOT_FOUND`. An anonymous read of an empty database test path was allowed; the desktop deliberately blocks notes until private rules are published and anonymous access is denied. Having a project ID in the code does not enable sign-in or publish database rules.

The hosted interface offers **Continue with Google**, email/password account creation and sign-in, and password-reset email. Google sign-in requires popups to be allowed. Enable Google at https://console.firebase.google.com/project/desktop-6562f/authentication/providers and add `bossmans-desktop-v2-swift.violetpetal2.chatgpt.site` under Authentication → Settings → Authorized domains. Provider enablement and authorized domains are Firebase account settings; the source change alone does not apply them. Once Firebase setup is complete, use the same Firebase account to access the same records across devices. A public Web Push VAPID key is saved in `firebase.config.mjs` for future notifications; notifications are not enabled by this version.

Target Site URL: <https://bossmans-desktop-v2-swift.violetpetal2.chatgpt.site>. This is the configured target; confirm deployment success before treating it as a live release.

## Build the hosted app

Install **Node.js 24 or later**, then run:

```sh
git clone https://github.com/SwiftMaster-cmd/desktop.git
cd desktop
npm ci
npm run build
```

The build creates the static hosted app in `dist/`, including the Firebase browser integration. Publishing through Sites uses the project's `.openai/hosting.json` configuration. Building does not publish the app or change Firebase settings.

## Keep the source and your records safe

GitHub stores the application source. Your Firebase account and Realtime Database notes are **not backed up by pushing code to GitHub**. Keep database rules under version control and publish rule changes when needed.

Use **Export backup** in the desktop to download your notes and shortcuts as JSON. Exports include items in Trash; keep these private files somewhere separate from the app. Imports add new item IDs and skip IDs already present, so they do not overwrite current records. Item exports do not contain account credentials or complete edit history.

The hosted app accepts up to **250 items per import**, with a **5 MB** limit. Split larger exports into smaller JSON files containing an `items` array before importing. Separate app installations and Firebase projects do not synchronize automatically.

## Optional local desktop

The repository also includes a separate local version that uses its own password and SQLite database. It runs directly from the source files and does not use Firebase for sign-in or saved notes:

```sh
npm start
```

Open <http://localhost:3000> and create a local desktop password of at least 10 characters. This password is separate from your Firebase account, and the local version has no email password-reset service.

No dependency installation or build is required for this local version. By default it listens on `127.0.0.1:3000` and stores its database at `.data/desktop.sqlite` beneath the current working directory. To change the port or data location:

```sh
PORT=3001 DATA_DIR=/path/to/private-data npm start
```

The local version accepts up to **1,000 items per import**, with the same 5 MB limit. It has its own records and edit history. Use JSON export/import to move item content between it and the hosted app; there is no automatic migration between them.

The ignored `.data/` directory contains local records, password credentials, sessions, and edit history. For a full local backup, stop the app and copy the entire directory to secure storage; restore it while the app is stopped. Do not commit databases, export downloads, personal notes, or secrets.

## Run the local version in a container

```sh
docker build -t bossmans-desktop .
docker run --name bossmans-desktop \
  -p 127.0.0.1:3000:3000 \
  -v bossmans-desktop-data:/app/.data \
  bossmans-desktop
```

The named volume preserves local records when the container is replaced. Back it up separately from the image. The container listens on `0.0.0.0:3000`; this example exposes it only on the host's loopback address.

For remote access to the local version, use an HTTPS reverse proxy or an authenticated private preview and persistent storage. Keep initial password setup private. A running cloud workspace is a development instance; it does not replace permanent hosting or backups.

## Check changes

```sh
npm test
```

Backend tests use temporary SQLite databases. They verify the local backend and do not establish that Firebase providers or deployed rules are configured correctly. GitHub Actions runs checks on Node.js 24.

## Project layout

```text
public/               Desktop interface and styles
firebase.config.mjs   Public Firebase web configuration
database.rules.json   Rules restricting Realtime Database records to their owner
firebase.json         Firebase deployment configuration
scripts/              Hosted build and validation tools
src/                  Local server and SQLite modules
server.mjs            Local application entry point
test/                 Automated checks
dist/                 Generated hosted app
.data/                Local records and account data (ignored)
```
