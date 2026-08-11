import express, { type Request, type Response } from "express";
import cors from "cors";
import { createTask, deleteTask, listTasks, updateTask } from "./store.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/tasks", (_req: Request, res: Response) => {
  res.json(listTasks());
});

app.post("/api/tasks", (req: Request, res: Response) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  res.status(201).json(createTask(title));
});

app.patch("/api/tasks/:id", (req: Request, res: Response) => {
  const updated = updateTask(req.params.id, {
    title: req.body?.title,
    done: req.body?.done,
  });
  if (!updated) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  res.json(updated);
});

app.delete("/api/tasks/:id", (req: Request, res: Response) => {
  const removed = deleteTask(req.params.id);
  if (!removed) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
