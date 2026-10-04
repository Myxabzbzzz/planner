import { useEffect, useRef, useState } from "react";
import { baseMime, MAX_SECONDS, pickMime } from "./recorder";

export function useRecorder(onClip: (blob: Blob) => void) {
  const [state, setState] = useState<"idle" | "recording">("idle");
  const [seconds, setSeconds] = useState(0);
  const [denied, setDenied] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const keep = useRef(false);
  const timer = useRef<number | null>(null);
  const clip = useRef(onClip);
  clip.current = onClip;

  function stop(send: boolean) {
    keep.current = send;
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
  }

  async function start() {
    const mime = pickMime((m) => MediaRecorder.isTypeSupported(m));
    if (!mime || rec.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setDenied(true);
      return;
    }
    const r = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => {
      if (timer.current !== null) clearInterval(timer.current);
      timer.current = null;
      stream.getTracks().forEach((t) => t.stop());
      rec.current = null;
      setState("idle");
      setSeconds(0);
      const blob = new Blob(chunks, { type: baseMime(r.mimeType || mime) });
      if (keep.current && blob.size > 0) clip.current(blob);
    };
    rec.current = r;
    keep.current = false;
    r.start();
    setState("recording");
    setSeconds(0);
    timer.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
  }

  useEffect(() => {
    if (state === "recording" && seconds >= MAX_SECONDS) stop(true);
  }, [state, seconds]);

  useEffect(() => () => stop(false), []);

  return { state, seconds, denied, start, stop };
}
