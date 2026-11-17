import { beforeEach, describe, expect, test, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
const logEmail = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

vi.mock("../app/services/email-log.server.js", () => ({ logEmail }));

const { sendAndLog, sendTradeReply, sendReplyCopy } = await import(
  "../app/services/email.server.js"
);

const application = {
  id: "app_1",
  firstName: "Ada",
  email: "ada@example.com",
  businessName: "Studio North",
};

describe("outbound email", () => {
  beforeEach(() => {
    send.mockReset();
    logEmail.mockReset();
    send.mockResolvedValue({ data: { id: "re_1" }, error: null });
    logEmail.mockResolvedValue({ ok: true });
    delete process.env.EMAIL_REPLY_TO;
    delete process.env.REPLY_COPY_TO;
  });

  test("sendAndLog sends with EMAIL_REPLY_TO as reply-to and logs OUTBOUND", async () => {
    process.env.EMAIL_REPLY_TO = "trade@reply.urbandeco.co.uk";

    const result = await sendAndLog({
      application,
      kind: "APPROVAL",
      subject: "Approved",
      html: "<p>Welcome <b>Ada</b></p>",
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Urban Deco Trade <trade@urbandeco.co.uk>",
        to: "ada@example.com",
        replyTo: "trade@reply.urbandeco.co.uk",
        subject: "Approved",
      })
    );
    expect(logEmail).toHaveBeenCalledWith({
      applicationId: "app_1",
      direction: "OUTBOUND",
      kind: "APPROVAL",
      fromEmail: "trade@urbandeco.co.uk",
      toEmail: "ada@example.com",
      subject: "Approved",
      bodyText: "Welcome Ada",
      providerMessageId: "re_1",
    });
    expect(result).toEqual({ data: { id: "re_1" }, error: null });
  });

  test("sendAndLog falls back to the EMAIL_FROM address when EMAIL_REPLY_TO is unset", async () => {
    await sendAndLog({ application, kind: "APPROVAL", subject: "S", html: "x" });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "trade@urbandeco.co.uk" })
    );
  });

  test("sendAndLog does not log when Resend returns an error", async () => {
    send.mockResolvedValue({ data: null, error: { message: "bad" } });

    const result = await sendAndLog({ application, kind: "APPROVAL", subject: "S", html: "x" });

    expect(logEmail).not.toHaveBeenCalled();
    expect(result.error).toEqual({ message: "bad" });
  });

  test("sendTradeReply prefixes Re:, escapes HTML, and logs MANUAL_REPLY with the plain body", async () => {
    const result = await sendTradeReply({
      application,
      subject: "Your application",
      body: "Hi <script>alert(1)</script>\nThanks",
    });

    const sent = send.mock.calls[0][0];
    expect(sent.subject).toBe("Re: Your application");
    expect(sent.html).toContain("&lt;script&gt;");
    expect(sent.html).not.toContain("<script>");
    expect(sent.html).toContain("<br");
    expect(logEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "MANUAL_REPLY",
        subject: "Re: Your application",
        bodyText: "Hi <script>alert(1)</script>\nThanks",
      })
    );
    expect(result.success).toBe(true);
  });

  test("sendTradeReply uses the branded layout with one paragraph per blank-line block", async () => {
    await sendTradeReply({
      application,
      subject: "Hello",
      body: "First para\nsecond line\n\nSecond para",
    });

    const html = send.mock.calls[0][0].html;

    // Same header, label, sign-off and footer as the automated emails.
    expect(html).toContain(
      "https://cdn.shopify.com/s/files/1/0673/0734/0017/files/URBANDECO-1200X630_1.jpg?v=1787744194"
    );
    expect(html).toContain("Trade Account");
    expect(html).toContain("Kind regards,");
    expect(html).toContain("Urban Deco Trade Team");
    expect(html).toContain(`© ${new Date().getFullYear()} Urban Deco. All rights reserved.`);
    expect(html).toContain("background:#f5f5f5");

    // Paragraphs split on blank lines, single newlines become line breaks.
    expect(html.match(/<p style="margin:0 0 16px;">/g)).toHaveLength(2);
    expect(html).toContain("First para<br />second line");
    expect(html).toContain("Second para");
  });

  test("sendTradeReply reports failure when Resend errors", async () => {
    send.mockResolvedValue({ data: null, error: { message: "bad" } });

    const result = await sendTradeReply({ application, subject: "S", body: "Hi" });

    expect(result.success).toBe(false);
  });

  test("sendReplyCopy goes to REPLY_COPY_TO with the applicant as reply-to and is not logged", async () => {
    process.env.REPLY_COPY_TO = "team@urbandeco.co.uk";
    process.env.EMAIL_REPLY_TO = "trade@reply.urbandeco.co.uk";

    const result = await sendReplyCopy({
      application,
      subject: "Re: Hello",
      body: "Thanks <b>so</b> much",
      threadUrl: "https://app.example/app/emails/app_1",
    });

    const sent = send.mock.calls[0][0];
    expect(sent.to).toBe("team@urbandeco.co.uk");
    expect(sent.replyTo).toBe("ada@example.com");
    expect(sent.subject).toBe("Reply from Studio North: Re: Hello");
    expect(sent.html).toContain("&lt;b&gt;so&lt;/b&gt;");
    expect(sent.html).toContain("https://app.example/app/emails/app_1");
    expect(logEmail).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  test("sendReplyCopy defaults to the EMAIL_FROM address, never the inbound address", async () => {
    process.env.EMAIL_REPLY_TO = "trade@reply.urbandeco.co.uk";

    await sendReplyCopy({ application, subject: "S", body: "x", threadUrl: "" });

    expect(send.mock.calls[0][0].to).toBe("trade@urbandeco.co.uk");
  });
});
