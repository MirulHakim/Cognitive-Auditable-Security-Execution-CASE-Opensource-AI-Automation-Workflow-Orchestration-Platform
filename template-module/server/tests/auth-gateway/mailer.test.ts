import { describe, expect, it, vi } from "vitest";
import {
  buildInvitationMessage,
  createMailer,
  explainSmtpFailure,
  MailDeliveryError,
  redactSmtpTranscript,
  type InvitationMail,
  type OutboundMessage,
} from "../../src/auth-gateway/mailer.js";
import { testConfig } from "./helpers.js";

const MAGIC_LINK =
  "http://localhost:5174/api/invitations/accept?token=abc123def456ghi789";

const MAIL: InvitationMail = {
  to: "invitee@agency.gov.my",
  magicLink: MAGIC_LINK,
  role: "operator",
  expiresAt: new Date("2026-11-17T12:00:00.000Z"),
  expiresInMinutes: 120,
  appName: "CASE",
};

const SMTP_ENV = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "587",
  SMTP_USER: "noreply.case@agency.gov.my",
  SMTP_PASS: "abcd efgh ijkl mnop",
};

describe("invitation email template", () => {
  it("renders a styled accept button and states the two-hour expiry", () => {
    const { subject, text, html } = buildInvitationMessage(MAIL);

    expect(subject).toBe("You are invited to CASE");
    // The button is a real anchor to the locally hosted CASE magic link.
    expect(html).toContain(`href="${MAGIC_LINK}"`);
    expect(html).toMatch(/Accept invitation\s*<\/a>/);
    expect(html).toContain("This invitation expires in 2 hours.");
    expect(html).toContain("Tue, 17 Nov 2026 12:00:00 GMT");
    expect(html).toContain("single-use");
    // Plain-text clients get the same link and expiry.
    expect(text).toContain(MAGIC_LINK);
    expect(text).toContain("expires in 2 hours");
  });

  it("escapes invitee-controlled and configuration-controlled values", () => {
    const { html } = buildInvitationMessage({
      ...MAIL,
      magicLink: "http://localhost:5174/x?token=<script>",
      appName: "CASE & Co",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("CASE &amp; Co");
  });
});

describe("SMTP invitation mailer", () => {
  it("sends from the dedicated CASE account through the configured transport", async () => {
    const sent: OutboundMessage[] = [];
    const config = testConfig(SMTP_ENV);
    const mailer = createMailer(config, { NODE_ENV: "production" }, {
      transportFactory: () => ({
        sendMail: async (message) => {
          sent.push(message);
          return { messageId: "<invite-1@case>" };
        },
      }),
    });

    const result = await mailer.sendInvitation(MAIL);

    expect(result).toEqual({ transport: "SMTP", messageId: "<invite-1@case>" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      // Default From is the authenticated mailbox, which Gmail will not rewrite.
      from: "CASE <noreply.case@agency.gov.my>",
      to: "invitee@agency.gov.my",
      subject: "You are invited to CASE",
    });
    expect(sent[0]!.html).toContain(MAGIC_LINK);
    expect(sent[0]!.html).toContain("expires in 2 hours");
  });

  it("maps rejected credentials to SMTP_AUTH_FAILED without leaking the password", async () => {
    const config = testConfig(SMTP_ENV);
    const mailer = createMailer(config, { NODE_ENV: "production" }, {
      transportFactory: () => ({
        sendMail: async () => {
          throw Object.assign(new Error("Invalid login: 535-5.7.8"), { code: "EAUTH" });
        },
      }),
    });

    const failure = await mailer.sendInvitation(MAIL).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MailDeliveryError);
    expect(failure).toMatchObject({ code: "SMTP_AUTH_FAILED" });
    expect((failure as Error).message).not.toContain("efgh");
  });

  it("maps an unreachable host to SMTP_CONNECTION_FAILED", async () => {
    const mailer = createMailer(testConfig(SMTP_ENV), { NODE_ENV: "production" }, {
      transportFactory: () => ({
        sendMail: async () => {
          throw Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
        },
      }),
    });

    await expect(mailer.sendInvitation(MAIL)).rejects.toMatchObject({
      code: "SMTP_CONNECTION_FAILED",
    });
  });

  it("treats a rejected recipient as a failure instead of a silent success", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mailer = createMailer(testConfig(SMTP_ENV), { NODE_ENV: "production" }, {
      transportFactory: () => ({
        sendMail: async () => ({
          messageId: null,
          accepted: [],
          rejected: [MAIL.to],
          response: "550-5.7.1 Message rejected by policy",
        }),
      }),
    });

    const failure = await mailer.sendInvitation(MAIL).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MailDeliveryError);
    expect(failure).toMatchObject({ code: "SMTP_SEND_FAILED" });
    expect((failure as MailDeliveryError).detail).toContain("550-5.7.1");
    errorSpy.mockRestore();
  });

  it("reports Google's auth failure with actionable hints on boot", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mailer = createMailer(testConfig(SMTP_ENV), { NODE_ENV: "production" }, {
      transportFactory: () => ({
        sendMail: async () => ({}),
        verify: async () => {
          throw Object.assign(
            new Error("Invalid login: 535-5.7.8 Username and Password not accepted"),
            {
              code: "EAUTH",
              responseCode: 535,
              response: "535-5.7.8 Username and Password not accepted. For more information, go to 535-5.7.8 https://support.google.com/mail/?p=BadCredentials",
            },
          );
        },
      }),
    });

    const result = await mailer.verify();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("535-5.7.8");
    expect(result.hints.join(" ")).toContain("App Password");
    // The raw object is printed, including the numeric reply and command.
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("responseCode: 535");
    expect(logged).toContain("BadCredentials");
    errorSpy.mockRestore();
  });

  it("passes the debug flag to the transport and redacts AUTH credentials", () => {
    const expected = "C: AUTH PLAIN AG5vcmVwbHkAYWJjZGVmZ2hpamtsbW5vcA==";
    const redacted = redactSmtpTranscript(expected);
    expect(redacted).toBe("C: AUTH PLAIN [credentials redacted]");
    // Server replies and the capability line survive redaction.
    expect(redactSmtpTranscript("S: 235 2.7.0 Accepted")).toBe("S: 235 2.7.0 Accepted");
    expect(redactSmtpTranscript("S: 250-AUTH PLAIN LOGIN")).toBe("S: 250-AUTH PLAIN LOGIN");

    const seen: boolean[] = [];
    createMailer(testConfig({ ...SMTP_ENV, SMTP_DEBUG: "false" }), { NODE_ENV: "production" }, {
      transportFactory: (settings) => {
        seen.push(settings.debug);
        return { sendMail: async () => ({}) };
      },
    });
    // SMTP_DEBUG is off in production unless explicitly enabled.
    expect(seen).toEqual([false]);
  });

  it("explains connection timeouts without inventing a credential problem", () => {
    const hints = explainSmtpFailure(
      Object.assign(new Error("connect ETIMEDOUT 142.250.4.108:587"), { code: "ETIMEDOUT" }),
    );
    expect(hints.join(" ")).not.toContain("App Password");
    expect(hints.join(" ")).toContain("firewall");
  });

  it("fails with a clear code when SMTP is not configured in production", async () => {
    const mailer = createMailer(testConfig(), { NODE_ENV: "production" });

    await expect(mailer.sendInvitation(MAIL)).rejects.toMatchObject({
      code: "SMTP_NOT_CONFIGURED",
    });
    expect((await mailer.verify()).ok).toBe(false);
  });

  it("logs the magic link instead of sending when development delivery is enabled", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const mailer = createMailer(
      testConfig({ AUTH_DEV_LOG_MAGIC_LINKS: "true" }),
      { NODE_ENV: "development" },
    );

    const result = await mailer.sendInvitation(MAIL);

    expect(result.transport).toBe("DEV_LOG");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(MAGIC_LINK),
    );
    log.mockRestore();
  });
});
