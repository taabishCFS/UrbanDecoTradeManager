import { beforeEach, describe, expect, test, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());

vi.mock("../app/db.server.js", () => ({
  default: { emailMessage: { create } },
}));

const { logEmail } = await import("../app/services/email-log.server.js");

const data = {
  applicationId: "app_1",
  direction: "OUTBOUND",
  kind: "APPROVAL",
  fromEmail: "trade@urbandeco.co.uk",
  toEmail: "ada@example.com",
  subject: "Approved",
  bodyText: "Welcome",
  providerMessageId: "re_123",
};

describe("logEmail", () => {
  beforeEach(() => {
    create.mockReset();
  });

  test("returns ok with the created message", async () => {
    create.mockResolvedValue({ id: "msg_1", ...data });

    const result = await logEmail(data);

    expect(create).toHaveBeenCalledWith({ data });
    expect(result).toEqual({ ok: true, message: { id: "msg_1", ...data } });
  });

  test("reports a duplicate on a unique violation without throwing", async () => {
    create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));

    await expect(logEmail(data)).resolves.toEqual({
      ok: false,
      duplicate: true,
    });
  });

  test("swallows other errors and returns ok false", async () => {
    const error = new Error("db down");
    create.mockRejectedValue(error);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(logEmail(data)).resolves.toEqual({ ok: false, error });
  });
});
