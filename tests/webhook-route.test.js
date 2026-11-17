import { beforeEach, describe, expect, test, vi } from "vitest";

const verify = vi.hoisted(() => vi.fn());
const processInboundEmail = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    webhooks = { verify };
    emails = { receiving: { get: vi.fn() } };
  },
}));
vi.mock("../app/db.server.js", () => ({ default: {} }));
vi.mock("../app/services/email.server.js", () => ({ sendReplyCopy: vi.fn() }));
vi.mock("../app/services/email-log.server.js", () => ({ logEmail: vi.fn() }));
vi.mock("../app/services/email-inbound.server.js", () => ({
  processInboundEmail,
}));

const { action, loader } = await import("../app/routes/webhooks.resend.jsx");

const goodHeaders = {
  "svix-id": "msg_1",
  "svix-timestamp": "1700000000",
  "svix-signature": "v1,abc",
};

function post(headers = goodHeaders, body = '{"type":"email.received"}') {
  return new Request("https://app.example/webhooks/resend", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /webhooks/resend", () => {
  beforeEach(() => {
    verify.mockReset();
    processInboundEmail.mockReset();
    process.env.RESEND_WEBHOOK_SECRET = "whsec_test";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("returns 400 when signature headers are missing", async () => {
    const response = await action({ request: post({}) });

    expect(response.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });

  test("returns 400 when verification throws", async () => {
    verify.mockImplementation(() => {
      throw new Error("bad signature");
    });

    const response = await action({ request: post() });

    expect(response.status).toBe(400);
    expect(processInboundEmail).not.toHaveBeenCalled();
  });

  test("verifies with the secret and returns 200 for a verified event", async () => {
    const event = { type: "email.received", data: { email_id: "in_1" } };
    verify.mockReturnValue(event);
    processInboundEmail.mockResolvedValue({ status: "saved" });

    const response = await action({ request: post() });

    expect(verify).toHaveBeenCalledWith({
      payload: '{"type":"email.received"}',
      headers: { id: "msg_1", timestamp: "1700000000", signature: "v1,abc" },
      webhookSecret: "whsec_test",
    });
    expect(processInboundEmail).toHaveBeenCalledWith(
      expect.objectContaining({ event })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, status: "saved" });
  });

  test("returns 500 when processing throws so Resend retries", async () => {
    verify.mockReturnValue({ type: "email.received", data: {} });
    processInboundEmail.mockRejectedValue(new Error("db down"));

    const response = await action({ request: post() });

    expect(response.status).toBe(500);
  });

  test("the loader answers 405 because the route is POST only", async () => {
    const response = await loader();

    expect(response.status).toBe(405);
  });
});
