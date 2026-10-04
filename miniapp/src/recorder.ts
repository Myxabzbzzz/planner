export const MIME_CANDIDATES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
export const MAX_SECONDS = 60;
export const MAX_BYTES = 2_097_152;

export const pickMime = (isSupported: (m: string) => boolean): string | null => MIME_CANDIDATES.find(isSupported) ?? null;

export const baseMime = (m: string) => m.split(";")[0].trim();

type Env = {
  mediaDevices?: { getUserMedia?: unknown };
  MediaRecorder?: { isTypeSupported?: (m: string) => boolean };
};

export function micSupported(env: Env): boolean {
  const mr = env.MediaRecorder;
  return typeof env.mediaDevices?.getUserMedia === "function" && typeof mr?.isTypeSupported === "function"
    && pickMime((m) => mr.isTypeSupported!(m)) !== null;
}

export const fmtSeconds = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export type RecorderDeps = {
  isTypeSupported: (m: string) => boolean;
  getUserMedia: () => Promise<MediaStream>;
  createRecorder: (stream: MediaStream, mime: string) => MediaRecorder;
};
export type RecorderEvents = {
  onState: (s: "idle" | "recording") => void;
  onClip: (blob: Blob) => void;
  onDenied: () => void;
};

/** Одна запись за раз: повторный тап, пока ждём доступ к микрофону, игнорируется; дорожки всегда останавливаются. */
export function makeRecorder(deps: RecorderDeps, ev: RecorderEvents) {
  let rec: MediaRecorder | null = null;
  let starting = false;
  let keep = false;

  async function start() {
    if (starting || rec) return;
    const mime = pickMime(deps.isTypeSupported);
    if (!mime) return;
    starting = true;
    let stream: MediaStream;
    try {
      stream = await deps.getUserMedia();
    } catch {
      starting = false;
      ev.onDenied();
      return;
    }
    let r: MediaRecorder;
    try {
      r = deps.createRecorder(stream, mime);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      starting = false;
      ev.onDenied();
      return;
    }
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      rec = null;
      ev.onState("idle");
      const blob = new Blob(chunks, { type: baseMime(r.mimeType || mime) });
      if (keep && blob.size > 0) ev.onClip(blob);
    };
    rec = r;
    keep = false;
    starting = false;
    r.start();
    ev.onState("recording");
  }

  function stop(send: boolean) {
    keep = send;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  return { start, stop };
}
