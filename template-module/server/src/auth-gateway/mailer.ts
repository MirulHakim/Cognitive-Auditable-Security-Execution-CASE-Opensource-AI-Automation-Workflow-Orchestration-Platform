import { inspect } from "node:util";
import nodemailer from "nodemailer";
import type { Logger } from "nodemailer/lib/shared/index.js";
import type { AuthGatewayConfig } from "./config.js";

/**
 * Invitation email for the auth gateway.
 *
 * The CASE platform sends from its own dedicated system mailbox over standard
 * SMTP (Gmail SMTP, a Workspace relay, SES, Mailgun, …). Admins no longer lend
 * their personal mailbox to the platform, so delivery does not depend on who
 * clicked "invite" or on the lifetime of their Google grant.
 *
 * Everything here is inside the gateway sidecar: no workflow API or FastAPI
 * module is imported, and neither backend learns that email exists.
 */

/** Where an invitation actually went. Recorded in the audit trail. */
export type DeliveryChannel = "SMTP" | "DEV_LOG";

export interface InvitationMail {
  to: string;
  magicLink: string;
  role: "operator" | "auditor";
  expiresAt: Date;
  /** Config TTL, used for the "expires in …" copy (default 120 = 2 hours). */
  expiresInMinutes: number;
  appName: string;
}

export interface DeliveryResult {
  transport: DeliveryChannel;
  messageId: string | null;
}

export interface VerifyResult {
  ok: boolean;
  /** One-line, credential-free summary of the failure. */
  error: string | null;
  /** Concrete things to check, derived from Google's reply / error code. */
  hints: string[];
}

export interface Mailer {
  sendInvitation(mail: InvitationMail): Promise<DeliveryResult>;
  /** Best-effort startup check; never throws and never blocks listening. */
  verify(): Promise<VerifyResult>;
}

/** The exact message handed to the transport; keeps test fakes trivial. */
export interface OutboundMessage {
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  sendMail(message: OutboundMessage): Promise<unknown>;
  verify?(): Promise<unknown>;
}

export type MailTransportFactory = (settings: {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  /** Nodemailer protocol transcript; credentials are redacted by our logger. */
  debug: boolean;
}) => MailTransport;

/**
 * Stable, non-secret failure codes. The route maps these to a helpful HTTP
 * message; the SMTP server's raw response is logged but never returned to the
 * browser (it can contain mailbox policy details).
 */
export type MailFailureCode =
  | "SMTP_NOT_CONFIGURED"
  | "SMTP_AUTH_FAILED"
  | "SMTP_CONNECTION_FAILED"
  | "SMTP_SEND_FAILED";

export class MailDeliveryError extends Error {
  constructor(
    readonly code: MailFailureCode,
    message: string,
    /** Short, credential-free detail for the server log. */
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = "MailDeliveryError";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function describeExpiry(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return `${minutes} minutes`;
}

/** One renderer for every deployment, so the invitation always looks the same. */
export function buildInvitationMessage(mail: InvitationMail): {
  subject: string;
  text: string;
  html: string;
} {
  const expires = mail.expiresAt.toUTCString();
  const expiresIn = describeExpiry(mail.expiresInMinutes);
  const subject = `You are invited to ${mail.appName}`;
  const text = [
    `You have been invited to join ${mail.appName} as ${mail.role}.`,
    "",
    "Open this single-use link to accept the invitation:",
    mail.magicLink,
    "",
    `This invitation expires in ${expiresIn} (${expires}) and can be used once.`,
    "Sign in with this exact Google account; invitations are bound to your email address.",
    "",
    `This email was sent automatically by the ${mail.appName} platform.`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0">
    Your ${escapeHtml(mail.appName)} invitation expires in ${escapeHtml(expiresIn)}.
  </span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:#f3f4f6;padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px">
          <tr>
            <td style="padding:32px 32px 0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
              <p style="margin:0 0 20px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;
                        font-weight:700;color:#6b7280">${escapeHtml(mail.appName)}</p>
              <h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:700;color:#111827">
                You have been invited
              </h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#374151">
                An administrator has invited you to join <strong>${escapeHtml(mail.appName)}</strong>
                as <strong>${escapeHtml(mail.role)}</strong>. Accepting the invitation creates
                your account; from then on you sign in with Google using this address.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">
                <tr>
                  <td style="border-radius:8px;background:#111827">
                    <a href="${escapeHtml(mail.magicLink)}"
                       style="display:inline-block;padding:14px 24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
                              font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px">
                      Accept invitation
                    </a>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                     style="margin:0 0 24px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px">
                <tr>
                  <td style="padding:14px 16px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
                    <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#92400e">
                      This invitation expires in ${escapeHtml(expiresIn)}.
                    </p>
                    <p style="margin:0;font-size:12px;line-height:1.6;color:#a16207">
                      Expires ${escapeHtml(expires)}. The link is single-use.
                    </p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#4b5563">
                If the button does not open, paste this link into your browser:
              </p>
              <p style="margin:0 0 24px;font-size:12px;line-height:1.5;word-break:break-all;color:#2563eb">
                ${escapeHtml(mail.magicLink)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px" />
              <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280">
                Sign in with the Google account that owns this address — the invitation is
                bound to it. This message was sent automatically by the
                ${escapeHtml(mail.appName)} platform; please do not reply.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

function shortDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 600);
  const code = (error as { code?: unknown }).code;
  const hint = typeof code === "string" ? `${code}: ` : "";
  return `${hint}${error.message}`.slice(0, 600);
}

/**
 * Nodemailer's protocol transcript includes the AUTH exchange. Printing a
 * base64 password to the terminal is exactly the kind of leak debugging logs
 * are famous for, so scrub credentials while keeping every server reply.
 */
export function redactSmtpTranscript(text: string): string {
  return text
    // Only a long base64 payload is a credential; the capability line
    // "250-AUTH PLAIN LOGIN" must stay readable.
    .replace(/\b(AUTH\s+(?:PLAIN|XOAUTH2))\s+[A-Za-z0-9+/]{16,}={0,2}/gi, "$1 [credentials redacted]")
    // AUTH LOGIN sends the username/password as bare base64 lines.
    .replace(/(\bC:\s*)[A-Za-z0-9+/=]{8,}\s*$/gm, "$1[base64 credentials redacted]");
}

function createSmtpLogger(): Logger {
  const emit = (...params: unknown[]): void => {
    const text = params
      .map((param) =>
        typeof param === "string"
          ? param
          : inspect(param, { depth: 2, breakLength: Infinity }),
      )
      .join(" ");
    console.log(`[auth-gateway][smtp] ${redactSmtpTranscript(text)}`);
  };
  const emitError = (...params: unknown[]): void => {
    const text = params
      .map((param) => (typeof param === "string" ? param : inspect(param, { depth: 2 })))
      .join(" ");
    console.error(`[auth-gateway][smtp] ${redactSmtpTranscript(text)}`);
  };

  return {
    trace: emit,
    debug: emit,
    info: emit,
    warn: emitError,
    error: emitError,
    fatal: emitError,
  };
}

/**
 * Google's SMTP replies are terse numbers. Turn the ones that actually occur
 * during invitation setup into an actionable sentence for the operator.
 */
export function explainSmtpFailure(error: unknown): string[] {
  const code = (error as { code?: unknown } | null)?.code;
  const responseCode = (error as { responseCode?: unknown } | null)?.responseCode;
  const message = error instanceof Error ? error.message : String(error);
  const response = (error as { response?: unknown } | null)?.response;
  const text = `${code ?? ""} ${String(responseCode ?? "")} ${message} ${typeof response === "string" ? response : ""}`.toLowerCase();
  const hints: string[] = [];

  if (
    text.includes("535") ||
    text.includes("eauth") ||
    text.includes("invalid login") ||
    text.includes("username and password not accepted")
  ) {
    hints.push(
      "Google rejected the login (535-5.7.8): SMTP_USER/SMTP_PASS are wrong or the password is not an App Password.",
      "A 16-character App Password is required; the account's normal password always fails. Regenerate it at https://myaccount.google.com/apppasswords after enabling 2-Step Verification.",
      "Paste the App Password without the four grouping spaces (16 characters, no quotes around it in .env).",
      "Workspace accounts can have App Passwords disabled by policy — check Admin console → Security → Less secure apps / App Passwords.",
    );
  }
  if (text.includes("454") || text.includes("too many login attempts")) {
    hints.push(
      "Google is throttling failed logins (454-4.7.0). Stop retrying, wait 10–30 minutes, then verify once.",
    );
  }
  if (text.includes("application-specific password required")) {
    hints.push("2-Step Verification is on but this password is not an App Password.");
  }
  if (text.includes("enotfound") || text.includes("edns")) {
    hints.push("SMTP_HOST does not resolve. Use smtp.gmail.com for Gmail.");
  }
  if (
    text.includes("etimedout") ||
    text.includes("econnection") ||
    text.includes("esocket") ||
    text.includes("econnrefused") ||
    text.includes("ehostunreach")
  ) {
    hints.push(
      "The connection never completed: check the port (587 for STARTTLS, 465 for implicit TLS), the corporate firewall/VPN, and that outbound SMTP is not blocked.",
      "Try port 465 with SMTP_SECURE=true if 587 hangs.",
    );
  }
  if (text.includes("certificate") || text.includes("self signed") || text.includes("tls")) {
    hints.push(
      "TLS negotiation failed: a corporate proxy may be intercepting SMTP. Use the organisation's relay or install its root CA.",
    );
  }
  if (text.includes("550") || text.includes("553") || text.includes("5.4.5")) {
    hints.push(
      "Google accepted the login but refused this message/recipient (daily sending limit, bad address, or policy).",
    );
  }
  if (hints.length === 0) {
    hints.push("No known signature matched — read the raw code/response above.");
  }
  return hints;
}

/**
 * Print the transport error itself, not a paraphrase. SMTP errors carry
 * `code`, `responseCode`, `response`, `command` and `stack`; those fields are
 * what identify a 535-5.7.8 or a timeout in the terminal.
 */
export function logSmtpFailure(context: string, error: unknown): void {
  const fields = error as Record<string, unknown> | null;
  console.error("");
  console.error("┌──────────────────────────────────────────────────────────────┐");
  console.error(`│ [auth-gateway][smtp] FAILURE — ${context}`);
  console.error("└──────────────────────────────────────────────────────────────┘");
  console.error(`  error:        ${error instanceof Error ? error.name : typeof error}`);
  console.error(`  message:      ${error instanceof Error ? error.message : String(error)}`);
  console.error(`  code:         ${String(fields?.code ?? "(none)")}`);
  console.error(`  responseCode: ${String(fields?.responseCode ?? "(none)")}`);
  console.error(`  response:     ${String(fields?.response ?? "(none)")}`);
  console.error(`  command:      ${String(fields?.command ?? "(none)")}`);
  console.error(`  stack:        ${error instanceof Error ? (error.stack ?? "(none)") : "(none)"}`);
  for (const hint of explainSmtpFailure(error)) {
    console.error(`  hint:         ${hint}`);
  }
  console.error("");
}

/**
 * Nodemailer surfaces transport problems as Error objects with a `code`.
 * Mapping them keeps the API honest: bad credentials are configurable by the
 * operator, while an unreachable host is a different failure entirely.
 */
export function classifySmtpError(error: unknown): MailDeliveryError {
  if (error instanceof MailDeliveryError) return error;
  const code = (error as { code?: unknown }).code;
  const detail = shortDetail(error);

  const responseCode = (error as { responseCode?: unknown })?.responseCode;
  const message = error instanceof Error ? error.message : "";
  const looksLikeAuthFailure =
    code === "EAUTH" ||
    code === "ENOAUTH" ||
    responseCode === 535 ||
    /535[- ]5\.7\.8|username and password not accepted|invalid login/i.test(message);

  if (looksLikeAuthFailure) {
    return new MailDeliveryError(
      "SMTP_AUTH_FAILED",
      "The mail server rejected the CASE system account's credentials.",
      detail,
    );
  }
  if (
    code === "ECONNECTION" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKET" ||
    code === "EDNS" ||
    code === "EHOSTUNREACH" ||
    code === "ENOTFOUND"
  ) {
    return new MailDeliveryError(
      "SMTP_CONNECTION_FAILED",
      "The invitation mail server could not be reached.",
      detail,
    );
  }
  return new MailDeliveryError(
    "SMTP_SEND_FAILED",
    "The mail server refused to send the invitation.",
    detail,
  );
}

function defaultTransportFactory(settings: {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  debug: boolean;
}): MailTransport {
  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    ...(settings.user
      ? { auth: { user: settings.user, pass: settings.pass ?? "" } }
      : {}),
    // Invitations are sent inside an HTTP request: fail within a predictable
    // window instead of leaving the admin's "Invite" button hanging.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    tls: { minVersion: "TLSv1.2" },
    // Full protocol transcript (SMTP handshake, capabilities, AUTH result and
    // Google's numeric replies). The custom logger redacts credentials.
    logger: settings.debug ? createSmtpLogger() : false,
    debug: settings.debug,
  });
  return {
    sendMail: (message) => transporter.sendMail(message),
    verify: () => transporter.verify(),
  };
}

export function createMailer(
  config: AuthGatewayConfig,
  env: NodeJS.ProcessEnv = process.env,
  options: { transportFactory?: MailTransportFactory } = {},
): Mailer {
  const smtp = config.smtp;
  let transport: MailTransport | null = null;

  if (smtp) {
    const factory = options.transportFactory ?? defaultTransportFactory;
    try {
      transport = factory({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        user: smtp.user,
        pass: smtp.pass,
        debug: smtp.debug,
      });
    } catch (error) {
      // A broken transport configuration must not stop the gateway from
      // booting; invitation attempts will return a descriptive error instead.
      console.error("[auth-gateway] could not initialise SMTP transport:", shortDetail(error));
    }
  }

  return {
    async sendInvitation(mail) {
      const { subject, text, html } = buildInvitationMessage(mail);

      if (!transport || !smtp) {
        if (env.NODE_ENV === "production" || !config.invitation.devLogLinks) {
          throw new MailDeliveryError(
            "SMTP_NOT_CONFIGURED",
            "Invitation email is not configured on this server.",
            "SMTP_HOST is unset (or SMTP transport initialisation failed).",
          );
        }
        // Development convenience only. Never enable in production: the URL is
        // a live credential.
        console.log(`[auth-gateway] invitation link for ${mail.to}: ${mail.magicLink}`);
        return { transport: "DEV_LOG", messageId: null };
      }

      console.log(
        `[auth-gateway][smtp] sending invitation to ${mail.to} via ${smtp.host}:${smtp.port} (secure=${smtp.secure}, from=${smtp.from})`,
      );

      try {
        const info = (await transport.sendMail({
          from: smtp.from,
          ...(smtp.replyTo ? { replyTo: smtp.replyTo } : {}),
          to: mail.to,
          subject,
          text,
          html,
        })) as {
          messageId?: unknown;
          response?: unknown;
          accepted?: unknown;
          rejected?: unknown;
          envelope?: unknown;
        } | null;

        const accepted = Array.isArray(info?.accepted) ? info.accepted : [];
        const rejected = Array.isArray(info?.rejected) ? info.rejected : [];
        const response = typeof info?.response === "string" ? info.response : null;
        const messageId = typeof info?.messageId === "string" ? info.messageId : null;

        // This line is the difference between "SMTP failed" and "Gmail said
        // 250 OK but the invitee still has nothing": accepted != delivered.
        console.log(
          `[auth-gateway][smtp] server reply: ${response ?? "(no response recorded)"}`,
        );
        console.log(
          `[auth-gateway][smtp] accepted=${JSON.stringify(accepted)} rejected=${JSON.stringify(rejected)} messageId=${messageId ?? "(none)"}`,
        );

        // Nodemailer can resolve sendMail() with every recipient in `rejected`
        // (for example a 550 policy rejection). Without this guard the endpoint
        // would report success for a message that was never accepted.
        if (rejected.length > 0) {
          throw new MailDeliveryError(
            "SMTP_SEND_FAILED",
            "The mail server rejected the invitation recipient.",
            `rejected=${rejected.join(", ")}; response=${response ?? "n/a"}`,
          );
        }
        if (accepted.length === 0) {
          console.warn(
            "[auth-gateway][smtp] transport reported no accepted recipient; treat delivery as unconfirmed.",
          );
        }

        return { transport: "SMTP", messageId };
      } catch (error) {
        // Raw object first: a swallowed 535-5.7.8 is undebuggable.
        logSmtpFailure(`send to ${mail.to}`, error);
        throw classifySmtpError(error);
      }
    },

    async verify() {
      if (!transport) {
        return {
          ok: false,
          error: "SMTP is not configured.",
          hints: [
            "SMTP_HOST is unset, so no invitation can be sent.",
            "Set SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER and SMTP_PASS in template-module/server/.env, then restart.",
          ],
        };
      }
      try {
        await transport.verify?.();
        console.log("[auth-gateway][smtp] verify() succeeded: connection, TLS and authentication are working.");
        return { ok: true, error: null, hints: [] };
      } catch (error) {
        logSmtpFailure("startup verify()", error);
        return {
          ok: false,
          error: shortDetail(error),
          hints: explainSmtpFailure(error),
        };
      }
    },
  };
}
