import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function CardHead({ title, right, icon, sub }: { title: ReactNode; right?: ReactNode; icon?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="card-head">
      <div className="min-w-0">
        <h2 className="h-section flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {sub ? <p className="muted mt-0.5 text-[13px]">{sub}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-3 text-[13px] font-semibold">{right}</div> : null}
    </header>
  );
}

export function PageHeader({ title, sub, actions, eyebrow }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <h1 className="h-page">{title}</h1>
        {sub ? <p className="muted mt-2 max-w-2xl text-[15px]">{sub}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "win" | "loss" | "warn" | "info" | "accent"; title?: string }) {
  const cls = tone === "neutral" ? "badge" : `badge badge-${tone}`;
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, href }: { label: string; value: ReactNode; sub?: ReactNode; href?: string }) {
  const body = (
    <div className="card h-full px-4 py-4">
      <div className="eyebrow">{label}</div>
      <div className="score mt-1.5 text-[26px] leading-tight">{value}</div>
      {sub ? <div className="muted mt-1 truncate text-[13px]">{sub}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-[20px] transition-colors hover:[&>div]:bg-raised">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-12 text-center">
      {icon ? <div className="text-faint">{icon}</div> : null}
      <p className="text-[15px] font-semibold">{title}</p>
      {children ? <p className="muted max-w-md text-[14px]">{children}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Alert({ tone = "info", children, title }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode; title?: string }) {
  const Icon = tone === "error" ? XCircle : tone === "warn" ? AlertTriangle : tone === "ok" ? CheckCircle2 : Info;
  const color = tone === "error" ? "text-loss" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-win" : "text-info";
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={16} className={`mt-0.5 shrink-0 ${color}`} aria-hidden />
      <div className="min-w-0">
        {title ? <div className="font-semibold">{title}</div> : null}
        <div className="text-[14px]">{children}</div>
      </div>
    </div>
  );
}

export function Avatar({ name, color, url, size = 32 }: { name: string; color: string; url?: string | null; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
  const style = { width: size, height: size, fontSize: size * 0.38 };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden className="relative inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-raised font-bold tracking-tight text-muted" style={style}>
      {initials}
      <span className="absolute -bottom-px -right-px rounded-full ring-2 ring-[var(--color-surface)]" style={{ width: Math.max(7, size * 0.26), height: Math.max(7, size * 0.26), background: color }} />
    </span>
  );
}

export function TeamMark({ name, color, logo, size = 28 }: { name: string; color: string; logo?: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0 items-center justify-center rounded-[10px] border border-line bg-raised font-extrabold tracking-tight text-fg"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {(logo || name.slice(0, 1)).toUpperCase()}
      <span className="absolute -bottom-px -right-px rounded-full ring-2 ring-[var(--color-surface)]" style={{ width: Math.max(7, size * 0.27), height: Math.max(7, size * 0.27), background: color }} />
    </span>
  );
}

export function FormChips({ form }: { form: ("W" | "L" | "T")[] }) {
  if (!form.length) return <span className="faint">—</span>;
  return (
    <span className="inline-flex gap-1" aria-label={`Recent results: ${form.join(", ")}`}>
      {form.map((f, i) => (
        <span key={i} className={`form-chip form-${f}`}>
          {f}
        </span>
      ))}
    </span>
  );
}

export function Tabs({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav className="pill-nav mb-6" aria-label="Sections">
      {items.map((i) => (
        <Link key={i.key} href={i.href} className="tab" aria-current={i.key === current ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function Delta({ value, digits = 0, suffix = "" }: { value: number; digits?: number; suffix?: string }) {
  const v = Number(value.toFixed(digits));
  if (v === 0) return <span className="faint">±0{suffix}</span>;
  return (
    <span className={v > 0 ? "text-win" : "text-loss"}>
      {v > 0 ? "▲" : "▼"} {Math.abs(v).toFixed(digits)}
      {suffix}
    </span>
  );
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <dt className="muted text-[14px]">{k}</dt>
      <dd className="num text-right text-[14px] font-medium">{children}</dd>
    </div>
  );
}
