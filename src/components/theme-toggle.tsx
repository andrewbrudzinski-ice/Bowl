"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Choice = "dark" | "light" | "system";
const KEY = "sweeper-theme";
const OPTIONS: { value: Choice; label: string; Icon: typeof Sun }[] = [
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "Auto", Icon: Monitor },
];

/**
 * Dark / light / follow-the-device switch. Dark is the default. The choice is kept in this browser only; <html data-theme> is set
 * before first paint by a script in the root layout ("light" and "system" are stored; dark is simply the absence of a choice).
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [choice, setChoice] = useState<Choice>("dark");
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "light" || v === "system") setChoice(v);
    } catch {
      /* storage blocked: stays on the dark default */
    }
  }, []);
  const pick = (value: Choice) => {
    setChoice(value);
    const root = document.documentElement;
    if (value === "dark") root.removeAttribute("data-theme");
    else root.dataset.theme = value;
    try {
      if (value === "dark") localStorage.removeItem(KEY);
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
