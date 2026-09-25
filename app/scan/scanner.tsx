"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseLumaQr } from "@/lib/qr";
import {
  deviceLabel,
  loadCheckedIn,
  loadGuests,
  loadQueue,
  saveCheckedIn,
  saveGuests,
  saveQueue,
  type GuestTuple,
  type QueuedScan,
} from "./storage";

type Outcome = "ok" | "duplicate" | "unknown" | "foreign" | "malformed";

type Shown = {
  /** Bumped on every scan so a late server correction can't overwrite a newer result. */
  id: number;
  outcome: Outcome;
  name: string | null;
  at: string | null;
  detail: string | null;
};

/** How long each result stays up before the camera takes over again. */
const LINGER: Record<Outcome, number> = {
  ok: 800,
  duplicate: 2000,
  unknown: 2400,
  foreign: 2400,
  malformed: 1600,
};

/** Ignore the same payload for this long — one QR lingering in frame is one person. */
const REPEAT_MS = 3000;

/** How long to wait for the server before falling back to the offline answer. */
const SERVER_MS = 1500;

/** How long to wait for a painted video frame before giving up on rVFC. */
const RVFC_TIMEOUT_MS = 400;

type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

export default function Scanner() {
  const [phase, setPhase] = useState<"idle" | "starting" | "scanning" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [pending, setPending] = useState(0);
  const [tally, setTally] = useState(0);
  const [engine, setEngine] = useState<"native" | "wasm" | null>(null);
  const [listSize, setListSize] = useState(0);
  const [torch, setTorch] = useState<"off" | "on" | "unavailable">("unavailable");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const beepBufRef = useRef<AudioBuffer | null>(null);

  const guestsRef = useRef<Map<string, string | null>>(new Map());
  const checkedInRef = useRef<Map<string, string>>(new Map());
  const stoppedRef = useRef(false);
  const busyRef = useRef(false);
  const lastRef = useRef({ raw: "", at: 0 });
  const idRef = useRef(0);
  const deviceRef = useRef("");

  // --- feedback -------------------------------------------------------------

  /**
   * A tone, not an audio file: no asset to fetch, and nothing to fail offline.
   * The AudioContext is created inside the start tap because iOS refuses to
   * produce sound from a context that wasn't born of a user gesture.
   */
  const beep = useCallback((outcome: Outcome) => {
    const ctx = audioRef.current;
    if (!ctx) return;

    const sample = beepBufRef.current;
    if (outcome === "ok" && sample) {
      try {
        const src = ctx.createBufferSource();
        src.buffer = sample;
        src.connect(ctx.destination);
        src.start();
      } catch {
        // Never let sound stop the queue.
      }
      try {
        navigator.vibrate?.(40);
      } catch {
        // Android-only.
      }
      return;
    }

    const [freq, ms] =
      outcome === "ok" ? [880, 90] : outcome === "duplicate" ? [520, 220] : [200, 320];
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = outcome === "ok" ? "sine" : "square";
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + ms / 1000);
    } catch {
      // A blocked or suspended context must never stop the queue.
    }
    try {
      navigator.vibrate?.(
        outcome === "ok" ? 40 : outcome === "duplicate" ? [30, 60, 30] : [180],
      );
    } catch {
      // Android-only; absent on iOS.
    }
  }, []);

  // --- the offline queue ----------------------------------------------------

  const flush = useCallback(async () => {
    const queue = loadQueue();
    if (!queue.length || !navigator.onLine) return;

    try {
      const res = await fetch("/api/scan/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: deviceRef.current, scans: queue }),
      });
      if (!res.ok) return;

      // Only clear what we actually sent: a scan made while this request was in
      // flight is still in localStorage and must survive.
      const sent = new Set(queue.map((s) => `${s.guestKey}|${s.scannedAt}`));
      const rest = loadQueue().filter((s) => !sent.has(`${s.guestKey}|${s.scannedAt}`));
      saveQueue(rest);
      setPending(rest.length);
    } catch {
      // Still offline. It stays queued.
    }
  }, []);

  const enqueue = useCallback((scan: QueuedScan) => {
    const queue = [...loadQueue(), scan];
    saveQueue(queue);
    setPending(queue.length);
  }, []);

  // --- recording a scan -----------------------------------------------------

  /**
   * Posts one scan and returns the server's verdict, or null if the network
   * didn't answer in time — in which case it's queued and the caller keeps the
   * optimistic local answer.
   */
  const record = useCallback(
    async (scan: QueuedScan): Promise<{ outcome: Outcome; name: string | null; checkedInAt: string | null } | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SERVER_MS);
      try {
        const res = await fetch("/api/scan/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device: deviceRef.current, scans: [scan] }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        return body?.results?.[0] ?? null;
      } catch {
        enqueue(scan);
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
    [enqueue],
  );

  // --- handling one decoded payload ----------------------------------------

  const handle = useCallback(
    async (raw: string) => {
      const now = Date.now();
      if (raw === lastRef.current.raw && now - lastRef.current.at < REPEAT_MS) return;
      lastRef.current = { raw, at: now };

      const id = ++idRef.current;
      const parsed = parseLumaQr(raw);

      const present = (outcome: Outcome, name: string | null, at: string | null, detail: string | null) => {
        if (idRef.current !== id) return; // a newer scan already took over
        setShown({ id, outcome, name, at, detail });
        beep(outcome);
      };

      if (!parsed.ok) {
        busyRef.current = true;
        const outcome = parsed.reason === "foreign" ? "foreign" : "malformed";
        present(
          outcome,
          null,
          null,
          parsed.reason === "foreign" ? "A ticket for a different Luma event" : null,
        );
        // Worth logging: it tells you afterwards how many wrong-event tickets
        // turned up, and whether it was one person trying repeatedly.
        if (parsed.reason === "foreign" && parsed.guestKey) {
          void record({ guestKey: parsed.guestKey, scannedAt: new Date().toISOString(), foreign: true });
        }
        setTimeout(() => {
          busyRef.current = false;
          setShown((s) => (s?.id === id ? null : s));
        }, LINGER[outcome]);
        return;
      }

      const { guestKey } = parsed;
      busyRef.current = true;

      const known = guestsRef.current.has(guestKey);
      const already = checkedInRef.current.get(guestKey);
      const name = guestsRef.current.get(guestKey) ?? null;

      // Answer from the local cache first — instant, and correct without a network.
      const optimistic: Outcome = !known ? "unknown" : already ? "duplicate" : "ok";
      present(optimistic, name, already ?? null, known ? null : guestKey);

      if (optimistic === "ok") {
        checkedInRef.current.set(guestKey, new Date().toISOString());
        saveCheckedIn(checkedInRef.current.keys());
        setTally((t) => t + 1);
      }

      const scannedAt = new Date().toISOString();
      const verdict = await record({ guestKey, scannedAt });

      // The server is authoritative: another desk may have taken this person
      // already, which no amount of local state could have known.
      if (verdict && verdict.outcome !== optimistic) {
        if (verdict.outcome === "duplicate" && verdict.checkedInAt) {
          checkedInRef.current.set(guestKey, verdict.checkedInAt);
          saveCheckedIn(checkedInRef.current.keys());
          if (optimistic === "ok") setTally((t) => Math.max(0, t - 1));
        }
        if (verdict.outcome === "ok") {
          checkedInRef.current.set(guestKey, verdict.checkedInAt ?? new Date().toISOString());
          saveCheckedIn(checkedInRef.current.keys());
          setTally((t) => t + 1);
        }
        present(verdict.outcome, verdict.name ?? name, verdict.checkedInAt, null);
      }

      setTimeout(
        () => {
          busyRef.current = false;
          setShown((s) => (s?.id === id ? null : s));
        },
        LINGER[verdict?.outcome ?? optimistic],
      );
    },
    [beep, record],
  );

  // --- the decode loop ------------------------------------------------------

  const startLoop = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const native = typeof window !== "undefined" && "BarcodeDetector" in window;
    let detect: (v: HTMLVideoElement) => Promise<string | null>;

    if (native && window.BarcodeDetector) {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      setEngine("native");
      detect = async (v) => {
        const codes = await detector.detect(v);
        return codes[0]?.rawValue ?? null;
      };
    } else {
      // Safari has no BarcodeDetector, so iPhones land here. The wasm is served
      // from our own origin rather than a CDN, so it keeps working offline.
      const { prepareZXingModule, readBarcodesFromImageData } = await import("zxing-wasm/reader");
      prepareZXingModule({ overrides: { locateFile: () => "/zxing_reader.wasm" } });
      setEngine("wasm");

      const canvas = (canvasRef.current ??= document.createElement("canvas"));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      detect = async (v) => {
        if (!ctx || !v.videoWidth) return null;
        // Downscale: decoding a 1280px frame costs several times more than a
        // 640px one and finds nothing extra at arm's length.
        const scale = Math.min(1, 640 / v.videoWidth);
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = await readBarcodesFromImageData(image, {
          formats: ["QRCode"],
          maxNumberOfSymbols: 1,
          tryHarder: false, // false is markedly faster and enough for a screen-bright QR
        });
        return found[0]?.text ?? null;
      };
    }

    const tick = async () => {
      if (stoppedRef.current) return;
      if (!busyRef.current) {
        try {
          const raw = await detect(video);
          if (raw) await handle(raw);
        } catch {
          // A dropped frame. Next one will do.
        }
      }
      schedule();
    };

    // requestVideoFrameCallback fires once per presented frame, so the loop tracks
    // the camera rather than a timer that drifts against it.
    const rvfc = (video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    }).requestVideoFrameCallback?.bind(video);

    // ...but it only fires for frames the browser actually paints. Some in-app
    // browsers (opening the link from WhatsApp, say) never present, and the loop
    // would sit there decoding nothing while a queue built up. So: if no frame
    // arrives promptly, stop trusting it and drive the loop from a timer.
    let useRvfc = !!rvfc;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (stoppedRef.current) return;

      if (useRvfc && rvfc) {
        let fired = false;
        rvfc(() => {
          fired = true;
          clearTimeout(watchdog);
          void tick();
        });
        watchdog = setTimeout(() => {
          if (fired || stoppedRef.current) return;
          useRvfc = false;
          void tick();
        }, RVFC_TIMEOUT_MS);
        return;
      }

      setTimeout(() => void tick(), 80);
    };

    schedule();
  }, [handle]);

  // --- camera + startup -----------------------------------------------------

  const start = useCallback(async () => {
    setPhase("starting");
    setError(null);

    // Deliberately NOT awaited. `resume()` settles only on a trusted gesture, and
    // if it never settles the camera never starts and the door stops dead on
    // "Starting…". The beep is a nicety; opening the camera is the job.
    try {
      audioRef.current ??= new AudioContext();
      void audioRef.current.resume().catch(() => {});
      if (!beepBufRef.current) {
        const ctx = audioRef.current;
        void fetch("/beep.mp3")
          .then((r) => r.arrayBuffer())
          .then((b) => ctx.decodeAudioData(b))
          .then((buf) => {
            beepBufRef.current = buf;
          })
          .catch(() => {});
      }
    } catch {
      // No sound. Everything else still works.
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch {
      try {
        // Laptops and some Androids reject `exact: environment` outright.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch (err) {
        setPhase("error");
        setError(
          !window.isSecureContext
            ? "The camera needs HTTPS. Open this page over https:// (or on localhost)."
            : `Camera unavailable: ${(err as Error).message}`,
        );
        return;
      }
    }

    streamRef.current = stream;

    const track = stream.getVideoTracks()[0];
    const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
    setTorch(caps?.torch ? "off" : "unavailable");

    // Attaching the stream is deliberately left to the effect below: the <video>
    // does not exist until this state change has actually rendered.
    setPhase("scanning");
  }, []);

  /**
   * Binds the camera to the <video> and starts decoding, once the element is
   * really in the DOM. Doing this inside `start()` silently did nothing — the
   * ref was still null, so the stream was dropped and the loop never ran.
   */
  useEffect(() => {
    if (phase !== "scanning") return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    stoppedRef.current = false;
    void video.play().catch(() => {});
    void startLoop();

    return () => {
      stoppedRef.current = true;
    };
  }, [phase, startLoop]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = torch === "on" ? false : true;
    try {
      // `torch` is real on Android Chrome but absent from the DOM typings.
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
      setTorch(next ? "on" : "off");
    } catch {
      setTorch("unavailable");
    }
  }, [torch]);

  // --- lifecycle ------------------------------------------------------------

  useEffect(() => {
    deviceRef.current = deviceLabel();

    // Paint from the cache first so a reload at the door is instant and works
    // even with no connection, then refresh from the server in the background.
    const cached = loadGuests();
    guestsRef.current = new Map(cached);
    checkedInRef.current = new Map(loadCheckedIn().map((k) => [k, ""]));
    setListSize(cached.length);
    setPending(loadQueue().length);

    void (async () => {
      try {
        const res = await fetch("/api/scan/manifest");
        if (!res.ok) return;
        const body: { guests: GuestTuple[]; checkedIn: string[] } = await res.json();
        guestsRef.current = new Map(body.guests);
        saveGuests(body.guests);

        // REPLACE the checked-in set rather than merging into it. The server is
        // authoritative, and a merge can never forget: a check-in recorded on
        // this device during a test would survive into the real event and show a
        // false "Already in" for someone who has not actually arrived.
        // The one thing worth keeping is scans still sitting in the offline
        // queue, which the server legitimately hasn't seen yet.
        const pending = new Set(loadQueue().map((q) => q.guestKey));
        checkedInRef.current = new Map(
          [...body.checkedIn, ...pending].map((key) => [key, ""] as const),
        );
        saveCheckedIn(checkedInRef.current.keys());
        setListSize(body.guests.length);
      } catch {
        // Offline on load: the cache above is what we run on.
      }
    })();

    void flush();
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    const timer = setInterval(() => void flush(), 10_000);

    return () => {
      stoppedRef.current = true;
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [flush]);

  // --- render ---------------------------------------------------------------

  if (phase === "idle" || phase === "starting" || phase === "error") {
    return (
      <main className="gate">
        <h1>Door check-in</h1>
        <p className="gate-sub">
          {listSize ? `${listSize} guests loaded` : "Loading the guest list…"}
        </p>
        {error && <p className="gate-error">{error}</p>}
        <button className="gate-start" onClick={() => void start()} disabled={phase === "starting"}>
          {phase === "starting" ? "Starting…" : "Start scanning"}
        </button>
        <p className="gate-note">
          Tap to allow the camera. Keep this tab open — the sound and the camera both stop if you
          switch away.
        </p>
      </main>
    );
  }

  return (
    <main className={`scan ${shown ? `scan--${shown.outcome}` : ""}`}>
      <video ref={videoRef} className="scan-video" playsInline muted autoPlay />

      <header className="scan-bar">
        <span className="scan-tally">{tally} scanned</span>
        {pending > 0 && <span className="scan-pending">{pending} queued</span>}
        {torch !== "unavailable" && (
          <button className="scan-torch" onClick={() => void toggleTorch()}>
            {torch === "on" ? "Torch off" : "Torch"}
          </button>
        )}
      </header>

      {!shown && <div className="scan-reticle" aria-hidden />}

      {shown && (
        <div className="scan-result" role="status" aria-live="assertive">
          <p className="scan-verdict">
            {shown.outcome === "ok" && "Checked in"}
            {shown.outcome === "duplicate" && "Already in"}
            {shown.outcome === "unknown" && "Not on the list"}
            {shown.outcome === "foreign" && "Wrong event"}
            {shown.outcome === "malformed" && "Not a ticket"}
          </p>
          {shown.name && <p className="scan-name">{shown.name}</p>}
          {shown.at && <p className="scan-detail">since {timeLabel(shown.at)}</p>}
          {shown.detail && <p className="scan-detail">{shown.detail}</p>}
        </div>
      )}

      <footer className="scan-foot">
        {engine === "wasm" ? "zxing" : "native"} · {deviceRef.current}
      </footer>
    </main>
  );
}

function timeLabel(iso: string): string {
  if (!iso) return "earlier";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "earlier";
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(d);
}
