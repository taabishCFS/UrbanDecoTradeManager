import { describe, expect, test } from "vitest";

import { buildImportRow } from "../app/services/email-import.server.js";

const OWN = "trade@urbandeco.co.uk";

const applicants = new Map([
  ["ada@example.com", "app_ada"],
  ["tom@example.com", "app_tom"],
]);

const addr = (address, name = "") => ({ value: [{ address, name }] });

function parsed(overrides = {}) {
  return {
    messageId: "<m1@mail.example>",
    date: new Date("2026-10-20T10:00:00Z"),
    subject: "Re: Your application",
    text: "Sending the portfolio now",
    html: false,
    from: addr("ada@example.com", "Ada"),
    to: addr(OWN),
    ...overrides,
  };
}

const run = (p) => buildImportRow({ parsed: p, ownAddress: OWN, applicants });

describe("buildImportRow", () => {
  test("turns an applicant's email into a read INBOUND row", () => {
    const row = run(parsed());

    expect(row).toEqual({
      applicationId: "app_ada",
      direction: "INBOUND",
      kind: "IMPORTED",
      fromEmail: "ada@example.com",
      toEmail: OWN,
      subject: "Re: Your application",
      bodyText: "Sending the portfolio now",
      providerMessageId: "imap:<m1@mail.example>",
      createdAt: new Date("2026-10-20T10:00:00Z"),
      readAt: expect.any(Date),
    });
  });

  test("turns a team email to an applicant into an OUTBOUND row", () => {
    const row = run(
      parsed({
        from: addr(OWN),
        to: addr("ada@example.com"),
        messageId: "<m2@mail.example>",
      })
    );

    expect(row.direction).toBe("OUTBOUND");
    expect(row.applicationId).toBe("app_ada");
    expect(row.fromEmail).toBe(OWN);
    expect(row.toEmail).toBe("ada@example.com");
    expect(row.readAt).toBeNull();
  });

  test("finds the applicant among several recipients including cc", () => {
    const row = run(
      parsed({
        from: addr(OWN),
        to: addr("someone@else.com"),
        cc: addr("TOM@Example.com"),
      })
    );

    expect(row.applicationId).toBe("app_tom");
  });

  test("lowercases the sender address", () => {
    expect(run(parsed({ from: addr("ADA@Example.COM") })).applicationId).toBe(
      "app_ada"
    );
  });

  test("skips senders that are not applicants", () => {
    expect(run(parsed({ from: addr("stranger@example.com") }))).toBeNull();
  });

  test("skips the app's own reply copies (trade@ to trade@)", () => {
    expect(run(parsed({ from: addr(OWN), to: addr(OWN) }))).toBeNull();
  });

  test("skips messages without a Message-ID", () => {
    expect(run(parsed({ messageId: undefined }))).toBeNull();
  });

  test("converts an HTML-only body and strips the quoted chain", () => {
    const row = run(
      parsed({
        text: "",
        html: "<div>Thanks</div><div>On Tue, 17 Nov 2026 at 15:13, Urban Deco Trade &lt;trade@urbandeco.co.uk&gt; wrote:</div><div>&gt; old</div>",
      })
    );

    expect(row.bodyText).toBe("Thanks");
  });

  test("keeps '(no new text)' for a fully quoted email", () => {
    expect(run(parsed({ text: "> only quoted" })).bodyText).toBe("(no new text)");
  });

  test("falls back to the current time when the date is missing", () => {
    expect(run(parsed({ date: undefined })).createdAt).toBeInstanceOf(Date);
  });
});
