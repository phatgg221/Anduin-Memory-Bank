"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

const CHANGE_EVENT = "dejavu:onboarding";
const storageKey = (userId: string) => `dejavu:onboarding:v1:${userId}`;

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function useOnboarding(userId: string | undefined) {
  const [reopened, setReopened] = useState(false);
  const seen = useSyncExternalStore(
    subscribe,
    () => !userId || window.localStorage.getItem(storageKey(userId)) !== null,
    () => true,
  );

  const dismiss = useCallback(() => {
    if (userId) window.localStorage.setItem(storageKey(userId), new Date().toISOString());
    window.dispatchEvent(new Event(CHANGE_EVENT));
    setReopened(false);
  }, [userId]);

  return { open: reopened || !seen, show: useCallback(() => setReopened(true), []), dismiss };
}
