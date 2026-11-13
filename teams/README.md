# natively

Markdown knowledge, readable. Two ways to use it:

| | For | How |
| --- | --- | --- |
| **natively for teams** | companies and teams | web app, sign in with GitHub: https://natively-teams.vercel.app · code in this repo |
| **natively for Mac** | single users | free Mac app (Apple silicon + Intel), 100 % local, no account: [download](https://github.com/GordenID/natively/releases/latest/download/natively-mac.dmg) |

The Mac app is not notarized by Apple. On first launch macOS asks once: System Settings → Privacy & Security → "Open Anyway".

---

## natively for teams

A calm knowledge base for your team, built on Markdown files in GitHub.
GitHub stores everything (files, versions, rights). natively is only the interface: read, search, edit in place, see who changed what.

- **Areas = repositories.** Rights (Read, Edit, Admin) come from GitHub and apply per area. Teams give people their areas.
- **Edit in place.** Click a paragraph and type. natively saves automatically and bundles an editing session into one version. It never overwrites someone else's change; it warns instead.
- **History.** Timeline and table of every change across all areas you can see, with restore as a new version.
- **Admin.** Invite people, manage teams, approve access requests.
- **AI.** Connect Claude to GitHub with your own account; it only sees what you may see.
- **No natively database.** The server only forwards the GitHub sign-in to the browser. Content stays in GitHub, the access token stays in the user's browser.

## Run it yourself

1. Start the local server with `node server.js` and open `http://localhost:4880/setup`. One click creates your own GitHub App (credentials are saved to `app.local.json`, never commit it).
2. Install the app on your account or organisation.
3. Open `http://localhost:4880` and sign in with GitHub.

Try it without a GitHub account: `node server.js --mock` (port 4881) runs against a built-in fake GitHub with sample data.

### Deploy to Vercel

```bash
node scripts/build-public.js
vercel build --prod && vercel deploy --prebuilt --prod
```

Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `GITHUB_APP_SLUG` in Vercel and add `https://<your-domain>/api/auth/callback` as a callback URL in the GitHub App.

GitHub App permissions: Contents (write), Metadata (read), Administration (write), Issues (write); Organization: Members (write), Administration (write).

## Layout

| Path | What |
| --- | --- |
| `../ui/` | shared interface (also used by the natively Mac app) |
| `client/github.js` | GitHub bridge: loading, autosave, sync, history, admin |
| `lib/auth.js`, `api/auth/*` | sign-in (Vercel functions), stores nothing |
| `lib/mock.js` | fake GitHub for tests |
| `server.js` | local server |

License: MIT
