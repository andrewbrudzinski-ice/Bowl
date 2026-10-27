import { log } from "./log";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Optional email. With no provider configured the message is only written to the server log (without the
 * recipient's address), so the app is fully functional without any external service.
 */
export async function sendMail(mail: Mail): Promise<{ delivered: boolean }> {
  const provider = process.env.EMAIL_PROVIDER;
  if (provider === "resend" && process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text }),
      });
      if (!res.ok) {
        log("error", "email_failed", { status: res.status });
        return { delivered: false };
      }
      return { delivered: true };
    } catch (e) {
      log("error", "email_failed", { error: e });
      return { delivered: false };
    }
  }
  log("info", "email_not_configured", { subject: mail.subject, note: "Set EMAIL_PROVIDER=resend to deliver email." });
  if (process.env.NODE_ENV !== "production") console.log(`\n[dev mail] ${mail.subject}\n${mail.text}\n`);
  return { delivered: false };
}

export function appUrl(path = ""): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return base + path;
}
