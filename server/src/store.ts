import { randomUUID } from "node:crypto";

export interface Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
}

const tasks = new Map<string, Task>();

function seed(): void {
  if (tasks.size > 0) return;
  const samples = ["Set up the Cloud Agent environment", "Wire up the API", "Ship the task board"];
  for (const title of samples) {
    const task = createTask(title);
    if (title.startsWith("Set up")) {
      task.done = true;
    }
  }
}

export function listTasks(): Task[] {
  return [...tasks.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createTask(title: string): Task {
  const task: Task = {
    id: randomUUID(),
    title,
    done: false,
    createdAt: new Date().toISOString(),
  };
  tasks.set(task.id, task);
  return task;
}

export function updateTask(id: string, patch: Partial<Pick<Task, "title" | "done">>): Task | undefined {
  const task = tasks.get(id);
  if (!task) return undefined;
  if (typeof patch.title === "string") task.title = patch.title;
  if (typeof patch.done === "boolean") task.done = patch.done;
  return task;
}

export function deleteTask(id: string): boolean {
  return tasks.delete(id);
}

seed();
