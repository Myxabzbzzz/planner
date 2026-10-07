import { useState, type ReactNode } from "react";
import type { Api } from "../api";
import { buildEventPatch, buildHabitPatch, buildNotePatch, buildTaskPatch, splitDue, type NoteKind } from "../itemEdit";
import { saveError } from "../saveError";
import { hapticResult } from "../telegram";
import { useUndo } from "../undo";
import { Sheet } from "./Sheet";

type Base<T> = { api: Api; item: T; onClose: () => void; onSaved: () => void };

function useRun(onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      hapticResult(true);
      onSaved();
    } catch (e) {
      hapticResult(false);
      setError(saveError(e));
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** Низ шторки: сохранить, удалить и строка ошибки. Один вид у всех форм. */
function Actions({ busy, error, canSave, onSave, removeLabel, onRemove, saveLabel = "Сохранить" }: {
  busy: boolean; error: string | null; canSave: boolean; onSave: () => void;
  removeLabel?: string; onRemove?: () => void; saveLabel?: string;
}) {
  return (
    <>
      {error && <div className="sub danger">{error}</div>}
      <button type="button" className="btn wide block" onClick={onSave} disabled={busy || !canSave}>
        {busy ? "Сохраняю…" : saveLabel}
      </button>
      {onRemove && (
        <button type="button" className="btn wide danger-text" onClick={onRemove} disabled={busy}>
          {removeLabel}
        </button>
      )}
    </>
  );
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field"><span>{label}</span>{children}</label>
);

export function TaskSheet({ api, item, onClose, onSaved }: Base<{ id: string; title: string; due: string | null }>) {
  const was = splitDue(item.due);
  const [title, setTitle] = useState(item.title);
  const [date, setDate] = useState(was.date);
  const [time, setTime] = useState(was.time);
  const { busy, error, run } = useRun(onSaved);
  const undo = useUndo();
  const patch = buildTaskPatch(item, { title, date, time });
  const dirty = patch !== null;
  return (
    <Sheet title="Задача" busy={busy} dirty={dirty} onClose={onClose} footer={
      <Actions busy={busy} error={error} canSave={!!patch && patch !== "invalid"}
        onSave={() => { if (patch && patch !== "invalid") void run(() => api.updateTask(item.id, patch)); }}
        removeLabel="Удалить задачу"
        onRemove={() => void run(async () => {
          await api.deleteTask(item.id);
          undo.offer("Задача удалена", () => api.restoreTask(item.id));
        })} />
    }>
      <Field label="Что сделать">
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      </Field>
      <div className="row-2">
        <Field label="Срок">
          <input type="date" value={date} disabled={busy}
            onChange={(e) => { setDate(e.target.value); if (!e.target.value) setTime(""); }} />
        </Field>
        {date !== "" && (
          <Field label="Время">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
          </Field>
        )}
      </div>
      {date !== "" && (
        <div className="chips" style={{ marginTop: 12 }}>
          <button type="button" className="pill" onClick={() => { setDate(""); setTime(""); }} disabled={busy}>
            Убрать срок
          </button>
        </div>
      )}
      {patch === "invalid" && <div className="sub danger">Проверь название и срок.</div>}
    </Sheet>
  );
}

export function EventSheet({ api, item, onClose, onSaved }: Base<{
  id: string; title: string; date: string; time: string; with_whom: string | null;
}>) {
  const [title, setTitle] = useState(item.title);
  const [date, setDate] = useState(item.date);
  const [time, setTime] = useState(item.time);
  const [withWhom, setWithWhom] = useState(item.with_whom ?? "");
  const { busy, error, run } = useRun(onSaved);
  const undo = useUndo();
  const patch = buildEventPatch(item, { title, date, time, withWhom });
  return (
    <Sheet title="Встреча" busy={busy} dirty={patch !== null} onClose={onClose} footer={
      <Actions busy={busy} error={error} canSave={!!patch && patch !== "invalid"}
        onSave={() => { if (patch && patch !== "invalid") void run(() => api.updateEvent(item.id, patch)); }}
        removeLabel="Удалить встречу"
        onRemove={() => void run(async () => {
          await api.deleteEvent(item.id);
          undo.offer("Встреча удалена", () => api.restoreEvent(item.id));
        })} />
    }>
      <Field label="Название">
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      </Field>
      <div className="row-2">
        <Field label="Дата">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
        </Field>
        <Field label="Время">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
        </Field>
      </div>
      <Field label="С кем">
        <input value={withWhom} maxLength={200} placeholder="необязательно"
          onChange={(e) => setWithWhom(e.target.value)} disabled={busy} />
      </Field>
      {patch === "invalid" && <div className="sub danger">Проверь дату и время.</div>}
    </Sheet>
  );
}

export const KINDS: { key: NoteKind; label: string }[] = [
  { key: "thought", label: "Мысль" },
  { key: "journal", label: "Дневник" },
];

export function NoteSheet({ api, item, onClose, onSaved }: Base<{ id: string; text: string; kind: NoteKind }>) {
  const [text, setText] = useState(item.text);
  const [kind, setKind] = useState<NoteKind>(item.kind);
  const { busy, error, run } = useRun(onSaved);
  const undo = useUndo();
  const patch = buildNotePatch(item, { text, kind });
  return (
    <Sheet title="Заметка" busy={busy} dirty={patch !== null} onClose={onClose} footer={
      <Actions busy={busy} error={error} canSave={!!patch && patch !== "invalid"}
        onSave={() => { if (patch && patch !== "invalid") void run(() => api.updateNote(item.id, patch)); }}
        removeLabel="Удалить заметку"
        onRemove={() => void run(async () => {
          await api.deleteNote(item.id);
          undo.offer("Заметка удалена", () => api.restoreNote(item.id));
        })} />
    }>
      <Field label="Текст">
        <textarea rows={6} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} disabled={busy} />
      </Field>
      <div className="field">
        <span>Тип</span>
        <div className="chips">
          {KINDS.map((k) => (
            <button type="button" key={k.key} className={k.key === kind ? "pill on" : "pill"}
              aria-pressed={k.key === kind} onClick={() => setKind(k.key)} disabled={busy}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

export const TARGETS = [1, 2, 3, 4, 5, 6, 7];
export const targetLabel = (n: number) => (n === 7 ? "каждый день" : `${n}`);

export function HabitSheet({ api, item, onClose, onSaved }: Base<{
  id: string; name: string; target_per_week: number;
}>) {
  const [name, setName] = useState(item.name);
  const [target, setTarget] = useState(item.target_per_week);
  const { busy, error, run } = useRun(onSaved);
  const undo = useUndo();
  const patch = buildHabitPatch(item, { name, target });
  return (
    <Sheet title="Привычка" busy={busy} dirty={patch !== null} onClose={onClose} footer={
      <Actions busy={busy} error={error} canSave={!!patch && patch !== "invalid"}
        onSave={() => { if (patch && patch !== "invalid") void run(() => api.updateHabit(item.id, patch)); }}
        removeLabel="Убрать из списка"
        onRemove={() => void run(async () => {
          await api.archiveHabit(item.id);
          undo.offer("Привычка убрана", () => api.unarchiveHabit(item.id));
        })} />
    }>
      <Field label="Название">
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} disabled={busy} />
      </Field>
      <div className="field">
        <span>Сколько раз в неделю</span>
        <div className="chips">
          {TARGETS.map((n) => (
            <button type="button" key={n} className={n === target ? "pill on" : "pill"}
              aria-pressed={n === target} onClick={() => setTarget(n)} disabled={busy}>
              {targetLabel(n)}
            </button>
          ))}
        </div>
      </div>
      <div className="card-foot">Неделя считается выполненной, когда отметок не меньше цели.</div>
    </Sheet>
  );
}
