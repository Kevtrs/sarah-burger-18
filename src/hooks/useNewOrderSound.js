import { useCallback, useEffect, useRef, useState } from "react";

const SOUND_STORAGE_KEY = "sarah-burger-kitchen-sound-enabled";
const SILENT_STATUSES = new Set(["served", "cancelled"]);
const SOUND_COOLDOWN_MS = 650;

function readStoredSoundPreference() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(SOUND_STORAGE_KEY) !== "off";
}

function writeStoredSoundPreference(enabled) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "on" : "off");
}

function getAudioConstructor() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function playDing(audioContext) {
  const start = audioContext.currentTime;
  const duration = 0.36;

  const output = audioContext.createGain();
  output.gain.setValueAtTime(0.0001, start);
  output.gain.exponentialRampToValueAtTime(0.08, start + 0.018);
  output.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  output.connect(audioContext.destination);

  const tone = audioContext.createOscillator();
  tone.type = "sine";
  tone.frequency.setValueAtTime(880, start);
  tone.frequency.exponentialRampToValueAtTime(1320, start + 0.08);
  tone.frequency.exponentialRampToValueAtTime(990, start + duration);
  tone.connect(output);
  tone.start(start);
  tone.stop(start + duration);

  const chime = audioContext.createOscillator();
  chime.type = "triangle";
  chime.frequency.setValueAtTime(1760, start + 0.02);
  chime.connect(output);
  chime.start(start + 0.02);
  chime.stop(start + 0.16);
}

export function useNewOrderSound(orders, { archived = false, snapshotReady = true } = {}) {
  const [soundEnabled, setSoundEnabledState] = useState(readStoredSoundPreference);
  const audioContextRef = useRef(null);
  const knownOrderIdsRef = useRef(new Set());
  const hasPrimedRef = useRef(false);
  const pendingSoundRef = useRef(0);
  const lastSoundAtRef = useRef(0);

  const unlockAudio = useCallback(async () => {
    const AudioContextConstructor = getAudioConstructor();
    if (!AudioContextConstructor) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor();
    }

    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }

    return audioContextRef.current;
  }, []);

  const queueSound = useCallback(() => {
    if (!soundEnabled || pendingSoundRef.current) return;

    const waitMs = Math.max(0, SOUND_COOLDOWN_MS - (Date.now() - lastSoundAtRef.current));

    pendingSoundRef.current = window.setTimeout(async () => {
      pendingSoundRef.current = 0;

      try {
        const audioContext = await unlockAudio();
        if (!audioContext) return;
        lastSoundAtRef.current = Date.now();
        playDing(audioContext);
      } catch {
        // Browsers may still block audio until the next user gesture.
      }
    }, waitMs);
  }, [soundEnabled, unlockAudio]);

  const setSoundEnabled = useCallback((enabled) => {
    setSoundEnabledState(enabled);
    writeStoredSoundPreference(enabled);
    if (enabled) void unlockAudio();
  }, [unlockAudio]);

  const toggleSound = useCallback(() => {
    setSoundEnabledState((current) => {
      const next = !current;
      writeStoredSoundPreference(next);
      if (next) void unlockAudio();
      return next;
    });
  }, [unlockAudio]);

  useEffect(() => {
    if (!soundEnabled || typeof window === "undefined") return undefined;

    const handleFirstInteraction = () => {
      void unlockAudio();
    };

    window.addEventListener("pointerdown", handleFirstInteraction, { passive: true });
    window.addEventListener("keydown", handleFirstInteraction);

    return () => {
      window.removeEventListener("pointerdown", handleFirstInteraction);
      window.removeEventListener("keydown", handleFirstInteraction);
    };
  }, [soundEnabled, unlockAudio]);

  useEffect(
    () => () => {
      if (pendingSoundRef.current) window.clearTimeout(pendingSoundRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!snapshotReady) return;

    const currentIds = new Set();
    let hasNewAudibleOrder = false;

    orders.forEach((order) => {
      if (!order?.id) return;
      currentIds.add(order.id);

      if (
        hasPrimedRef.current &&
        !knownOrderIdsRef.current.has(order.id) &&
        !SILENT_STATUSES.has(order.status)
      ) {
        hasNewAudibleOrder = true;
      }
    });

    currentIds.forEach((id) => knownOrderIdsRef.current.add(id));

    if (!hasPrimedRef.current) {
      hasPrimedRef.current = true;
      return;
    }

    if (!archived && hasNewAudibleOrder) {
      queueSound();
    }
  }, [archived, orders, queueSound, snapshotReady]);

  return {
    soundEnabled,
    setSoundEnabled,
    toggleSound,
    unlockAudio,
  };
}
