# Grid_Control

A real-time shared grid app where multiple users can open the site, claim blocks, and instantly see everyone else’s changes. This project is designed as a hiring-assignment style submission that shows both frontend polish and backend real-time thinking.

## What it does

Users see a large interactive grid made of hundreds of cells. Each cell can be claimed by a user, and ownership is synced instantly across all connected clients through WebSockets. The app supports user identity, color selection, themes, zoom/pan, cooldown rules, block locking, leaderboard tracking, and automatic cleanup of inactive users.

## Why this project exists

This app was built to solve the assignment:

> Build a real-time shared grid app where many users can claim blocks at the same time, with instant updates for everyone.

The focus is not only on making the UI look good, but also on handling shared state, conflicts, persistence, and live updates in a way that feels smooth and reliable.

## Tech stack

Frontend:
- React
- PixiJS for fast canvas rendering
- WebSocket client
- Local storage for username, color, and client identity

Backend:
- Node.js
- Express
- `ws` WebSocket server
- Upstash Redis for persistent storage

## Core features

### Real-time shared grid
Every block on the map can be claimed by a user. When one user places or removes a block, all other connected users receive the update immediately.

### Ownership and conflict handling
Each block stores:
- `x`, `y`
- `color`
- `clientId`
- `username`
- `lockedUntil`

The server rejects invalid or conflicting actions, such as trying to overwrite a locked block owned by someone else.

### User identity
Every browser gets a persistent hidden `clientId` stored in `localStorage`. That allows the app to:
- track the same user across reloads
- support multiple tabs
- restore ownership and stats properly
- update display names seamlessly when the username changes

### Cooldown system
After placing a block, a user must wait before placing another one.

Current values:
- `USER_COOLDOWN_MS = 3000` → 3 seconds
- `PIXEL_LOCK_MS = 10000` → 10 seconds

These are defined as constants at the top of the code and can be changed easily.

### Inactivity cleanup
If a user disconnects and stays away for too long, their owned blocks are removed automatically.

Current value:
- `INACTIVITY_LIMIT_MS = 0.5 * 60 * 1000` → 30 seconds

### Leaderboard
The frontend calculates a live leaderboard from the current grid state and shows the top users by owned block count.

### Smooth UI
The interface includes:
- theme switching
- zoom and pan
- hover highlights
- ripple and flicker feedback
- tooltip previews
- rank badges and score display

## How the backend works

The backend keeps the shared grid in memory using a `Map`, while also saving each block into Redis so the board can be restored on reconnect.

Important server responsibilities:
- accept WebSocket connections
- initialize new clients with the current grid state
- track user identity and tab count
- broadcast updates to every connected client
- enforce cooldown and locking rules
- delete stale blocks after inactivity
- persist grid changes to Redis

### WebSocket message types

#### `identify`
Sent by the client after connection.

Payload:
- `clientId`
- `username`

Purpose:
- register or refresh user identity
- update ownership labels if the username changes
- track user presence and active tabs

#### `pixel`
Used for block actions.

Actions:
- `place` → claim a block
- `unown` → release a block owned by the same user

### Broadcast events
The server broadcasts changes to all clients using WebSocket:
- `init`
- `pixel`
- `rename`
- `purge_user`

## How the frontend works

The frontend uses PixiJS to render the grid efficiently on canvas. It listens to WebSocket messages and updates the local board state instantly.

Main frontend responsibilities:
- connect to the server
- identify the user
- render the grid
- handle click, drag, zoom, and hover interactions
- show the leaderboard
- show cooldown progress
- apply themes dynamically

## State and storage

### Local storage
The browser stores:
- `canvas_client_id`
- `canvas_username`
- `canvas_color`

This keeps the user experience consistent across reloads.

### Redis
Redis stores each claimed cell as persistent data. That makes the board easier to restore and keeps the shared state stable.

## Design notes

This project was built with hiring evaluation in mind, so it highlights:
- real-time collaboration logic
- backend conflict control
- fast visual feedback
- clean UI behavior
- state persistence
- code that is easy to reason about and extend

## Running the project

### Install dependencies
```bash
npm install
```

### Start the backend
```bash
node server.js
```

### Start the frontend
If the frontend is built separately, run the React build or dev server as needed for your setup.

### Production build
The backend serves the built frontend from:
```text
../frontend/dist
```

So the frontend should be built before deploying.

## Configuration

These values can be changed at the top of the code:

- `USER_COOLDOWN_MS` — time before a user can place another block
- `PIXEL_LOCK_MS` — how long a block stays locked from others
- `INACTIVITY_LIMIT_MS` — how long an inactive user’s blocks remain before cleanup

## Environment variables

The code currently contains a Redis URL and token directly in the source. For production use, move these into environment variables:

```bash
UPSTASH_REDIS_URL=
UPSTASH_REDIS_TOKEN=
PORT=3000
```

## Notes for reviewers

This app is intentionally focused on the backend + real-time layer, not just visuals. The important part is that many users can interact with the same shared board at once, and the system keeps the state consistent, responsive, and visually clear.


## Summary

Grid_Control is a real-time collaborative board built with React, PixiJS, Express, WebSockets, and Redis. It supports live ownership, conflict handling, cooldowns, inactivity cleanup, and a polished interface designed to stand out in a hiring assignment review.
