# MoSCoW Requirements Prioritization Dashboard

Dashboard for prioritizing project requirements with shared Netlify state.

## Live URL

https://priisk-moscow-dashboard-719.netlify.app

## Runtime

- Static UI: `index.html`, `styles.css`, `app.js`
- Source data: `chunks.json` and `data-chunks/`
- Shared state: Netlify Functions + Netlify Blobs
- Required Netlify environment variables:
  - `ADMIN_PIN`
  - `ADMIN_TOKEN_SECRET`

## Behavior

- Users enter a display name and vote for the active task.
- Admin logs in with PIN, moves cards by drag-and-drop, starts/finishes voting, and archives/restores cards.
- The Done lane is represented by the `done` MoSCoW column.
- Archived cards are hidden from the main board and visible to admin in archive mode.
