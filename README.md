# App

A full-stack **Task Board** demonstrating an end-to-end development setup:

- **`server/`** — Express + TypeScript REST API with an in-memory task store (`/api/tasks`, `/api/health`).
- **`client/`** — Vite + React + TypeScript UI that talks to the API (dev proxy `/api` → `http://localhost:3001`).

The project is an npm workspaces monorepo.

## Prerequisites

- Node.js >= 20 (Node 22 recommended)
- npm 10+

## Install

```bash
npm install
```

This installs dependencies for both the `server` and `client` workspaces.

## Develop

Run the API and the client dev server together:

```bash
npm run dev
```

- Client: http://localhost:5173
- API: http://localhost:3001

Or run them individually:

```bash
npm run dev:server   # Express API on :3001
npm run dev:client   # Vite dev server on :5173
```

## Other commands

```bash
npm run build       # Type-check + build server and client
npm run typecheck   # Type-check both workspaces
npm run start       # Run the built API (after npm run build)
```

## API

| Method | Path             | Description        |
| ------ | ---------------- | ------------------ |
| GET    | `/api/health`    | Health check       |
| GET    | `/api/tasks`     | List tasks         |
| POST   | `/api/tasks`     | Create a task      |
| PATCH  | `/api/tasks/:id` | Update a task      |
| DELETE | `/api/tasks/:id` | Delete a task      |
