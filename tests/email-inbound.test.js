import { beforeEach, describe, expect, test, vi } from "vitest";

import { processInboundEmail } from "../app/services/email-inbound.server.js";

const application = {
  id: "app_1",
  email: "ada@example.com",
  businessName: "Studio North",
};

let resend;
let prisma;
let sendCopy;
let log;

function event(overrides = {}) {
  return {
    type: "email.received",
    data: {
      email_id: "in_1",
      from: "ada@example.com",
      to: ["trade@reply.urbandeco.co.uk"],
      subject: "Re: Your application",
      ...overrides,
    },
  };
}

describe("processInboundEmail", () => {
  beforeEach(() => {
    process.env.SHOPIFY_APP_URL = "https://app.example";
    resend = {
      emails: {
        receiving: {
          get: vi.fn().mockResolvedValue({
            data: { text: "Sending the portfolio now", html: null },
            error: null,
          }),
        },
      },
    };
    prisma = {
      tradeApplication: { findFirst: vi.fn().mockResolvedValue(application) },
    };
    sendCopy = vi.fn().mockResolvedValue({ success: true });
    log = vi.fn().mockResolvedValue({ ok: true });
  });

  const run = (e = event()) =>
    processInboundEmail({ event: e, resend, prisma, sendCopy, log });

  test("ignores events other than email.received", async () => {
    const result = await run({ type: "email.sent", data: {} });

    expect(result).toEqual({ status: "ignored" });
    expect(resend.emails.receiving.get).not.toHaveBeenCalled();
  });

  test("saves a matched reply against the application and sends the copy", async () => {
    const result = await run();

    expect(result).toEqual({ status: "saved" });
    expect(log).toHaveBeenCalledWith({
      applicationId: "app_1",
      direction: "INBOUND",
      kind: "APPLICANT_REPLY",
      fromEmail: "ada@example.com",
      toEmail: "trade@reply.urbandeco.co.uk",
      subject: "Re: Your application",
      bodyText: "Sending the portfolio now",
      providerMessageId: "in_1",
    });
    expect(sendCopy).toHaveBeenCalledWith({
      application,
      subject: "Re: Your application",
      body: "Sending the portfolio now",
      threadUrl: "https://app.example/app/emails/app_1",
    });
  });

  test("matches when From is a display-name header with capitals", async () => {
    await run(event({ from: '"Ada Smith" <ADA@Example.com>' }));

    expect(prisma.tradeApplication.findFirst).toHaveBeenCalledWith({
      where: { email: "ada@example.com" },
      orderBy: { createdAt: "desc" },
    });
  });

  test("looks up the most recent application when the email applied twice", async () => {
    await run();

    expect(prisma.tradeApplication.findFirst.mock.calls[0][0].orderBy).toEqual({
      createdAt: "desc",
    });
  });

  test("saves unmatched senders with applicationId null and sends no copy", async () => {
    prisma.tradeApplication.findFirst.mockResolvedValue(null);

    const result = await run(event({ from: "stranger@example.com" }));

    expect(result).toEqual({ status: "unmatched" });
    expect(log.mock.calls[0][0].applicationId).toBeNull();
    expect(sendCopy).not.toHaveBeenCalled();
  });

  test("treats a duplicate provider id as duplicate and sends no copy", async () => {
    log.mockResolvedValue({ ok: false, duplicate: true });

    const result = await run();

    expect(result).toEqual({ status: "duplicate" });
    expect(sendCopy).not.toHaveBeenCalled();
  });

  test("falls back to converted HTML when there is no text body", async () => {
    resend.emails.receiving.get.mockResolvedValue({
      data: { text: "", html: "<div>Hello <b>there</b></div><p>Thanks</p>" },
      error: null,
    });

    await run();

    expect(log.mock.calls[0][0].bodyText).toBe("Hello there\nThanks");
  });

  test("stores '(no new text)' for a fully quoted reply", async () => {
    resend.emails.receiving.get.mockResolvedValue({
      data: { text: "> only quoted", html: null },
      error: null,
    });

    await run();

    expect(log.mock.calls[0][0].bodyText).toBe("(no new text)");
  });

  test("a copy failure does not throw and the reply stays saved", async () => {
    sendCopy.mockRejectedValue(new Error("resend down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(run()).resolves.toEqual({ status: "saved" });
    expect(log).toHaveBeenCalled();
  });

  test("throws when the received email cannot be fetched", async () => {
    resend.emails.receiving.get.mockResolvedValue({
      data: null,
      error: { message: "not found" },
    });

    await expect(run()).rejects.toThrow("Unable to retrieve received email");
  });

  test("throws when the reply cannot be saved so Resend retries", async () => {
    log.mockResolvedValue({ ok: false, error: new Error("db down") });

    await expect(run()).rejects.toThrow("Unable to save received email");
  });
});
