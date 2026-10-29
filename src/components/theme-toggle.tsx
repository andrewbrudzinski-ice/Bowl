"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Choice = "system" | "light" | "dark";
const KEY = "sweeper-theme";
const OPTIONS: { value: Choice; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "Auto", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** Light / dark / follow-the-device switch. The choice is kept in this browser only; <html data-theme> is set before first paint by a script in the root layout. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [choice, setChoice] = useState<Choice>("system");
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "light" || v === "dark") setChoice(v);
    } catch {
      /* storage blocked: stays on "system" */
    }
  }, []);
  const pick = (value: Choice) => {
    setChoice(value);
    const root = document.documentElement;
    if (value === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = value;
    try {
      if (value === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, value);
    } catch {
      /* ignore */
    }
  };
  return (
    <div role="radiogroup" aria-label="Appearance" className="seg">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button key={value} type="button" role="radio" aria-checked={choice === value} onClick={() => pick(value)} className="seg-item" data-active={choice === value}>
          <Icon size={15} aria-hidden />
          {compact ? <span className="sr-only">{label}</span> : label}
        </button>
      ))}
    </div>
  );
}
