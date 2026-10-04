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
