export interface Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
}

const BASE = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Request failed (${res.status}): ${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchTasks(): Promise<Task[]> {
  return json<Task[]>(await fetch(`${BASE}/tasks`));
}

export async function createTask(title: string): Promise<Task> {
  return json<Task>(
    await fetch(`${BASE}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  );
}

export async function toggleTask(id: string, done: boolean): Promise<Task> {
  return json<Task>(
    await fetch(`${BASE}/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    }),
  );
}

export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`${BASE}/tasks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
}
