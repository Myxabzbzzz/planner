import { useEffect, useState } from "react";
import type { Api } from "../api";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { fmtShortDate, fmtTime } from "../format";
import type { Note } from "../types";

export function Notes({ api }: { api: Api }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = (before?: string) => {
    setLoading(true);
    setError(false);
    api.notes(query, before)
      .then((r) => { setNotes((prev) => (before ? [...prev, ...r.notes] : r.notes)); setNext(r.next_before); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [api, query]);

  return (
    <>
      <input className="search" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && notes.length === 0 ? <ErrorCard onRetry={() => load()} />
        : loading && notes.length === 0 ? <Loading />
        : notes.length === 0 ? <Empty title={query ? "Ничего не нашлось" : "Мыслей пока нет"} hint={query ? undefined : "Скажи боту «идея: …»"} />
        : (
          <>
            {notes.map((n) => (
              <Card key={n.id}>
                <div className="note-meta">{n.kind === "journal" ? "📔 Дневник" : "💡 Мысль"} · {fmtShortDate(n.created_at)} {fmtTime(n.created_at)}</div>
                <div className="note-text">{n.text}</div>
              </Card>
            ))}
            {next && <button className="button wide" disabled={loading} onClick={() => load(next)}>{loading ? "Загрузка…" : "Показать ещё"}</button>}
          </>
        )}
    </>
  );
}
