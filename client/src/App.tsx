import { useEffect, useMemo, useState } from "react";
import { createTask, deleteTask, fetchTasks, toggleTask, type Task } from "./api";
import "./App.css";

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks()
      .then(setTasks)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const remaining = useMemo(() => tasks.filter((t) => !t.done).length, [tasks]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      const created = await createTask(trimmed);
      setTasks((prev) => [...prev, created]);
      setTitle("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleToggle(task: Task) {
    try {
      const updated = await toggleTask(task.id, !task.done);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="page">
      <main className="card">
        <header className="header">
          <h1>Task Board</h1>
          <p className="subtitle">
            {loading ? "Loading…" : `${remaining} of ${tasks.length} remaining`}
          </p>
        </header>

        <form className="add-form" onSubmit={handleAdd}>
          <input
            className="input"
            placeholder="What needs to be done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="New task title"
          />
          <button className="btn" type="submit">
            Add
          </button>
        </form>

        {error && <div className="error">{error}</div>}

        <ul className="list">
          {tasks.map((task) => (
            <li key={task.id} className={`item ${task.done ? "item--done" : ""}`}>
              <label className="item-main">
                <input
                  type="checkbox"
                  checked={task.done}
                  onChange={() => handleToggle(task)}
                />
                <span className="item-title">{task.title}</span>
              </label>
              <button
                className="delete"
                onClick={() => handleDelete(task.id)}
                aria-label={`Delete ${task.title}`}
              >
                ✕
              </button>
            </li>
          ))}
          {!loading && tasks.length === 0 && (
            <li className="empty">No tasks yet. Add your first one above.</li>
          )}
        </ul>
      </main>
    </div>
  );
}
