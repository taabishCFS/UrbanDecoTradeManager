import { describe, expect, test } from "vitest";

import { buildThreadList } from "../app/services/email-queries.server.js";

const msg = (direction, bodyText, createdAt, readAt = null, subject = "S") => ({
  direction,
  bodyText,
  subject,
  createdAt: new Date(createdAt),
  readAt: readAt ? new Date(readAt) : null,
});

const applications = [
  {
    id: "a1",
    firstName: "Ada",
    lastName: "Smith",
    businessName: "Studio North",
    email: "ada@example.com",
    emailMessages: [
      msg("OUTBOUND", "Welcome", "2026-11-01T10:00:00Z"),
      msg("INBOUND", "Thanks, portfolio coming", "2026-11-03T10:00:00Z"),
      msg("INBOUND", "Also a second note", "2026-11-03T11:00:00Z", "2026-11-04T09:00:00Z"),
    ],
  },
  {
    id: "a2",
    firstName: "Tom",
    lastName: "Jones",
    businessName: "Ada Interiors",
    email: "tom@example.com",
    emailMessages: [msg("OUTBOUND", "Approved", "2026-11-05T10:00:00Z")],
  },
  {
    id: "a3",
    firstName: "No",
    lastName: "Mail",
    businessName: "Quiet Ltd",
    email: "quiet@example.com",
    emailMessages: [],
  },
];

describe("buildThreadList", () => {
  test("drops applications without messages", () => {
    const ids = buildThreadList(applications).map((t) => t.applicationId);

    expect(ids).not.toContain("a3");
  });

  test("sorts by latest message, newest first", () => {
    const ids = buildThreadList(applications).map((t) => t.applicationId);

    expect(ids).toEqual(["a2", "a1"]);
  });

  test("counts unread inbound messages only", () => {
    const [, ada] = buildThreadList(applications);

    expect(ada.unreadCount).toBe(1);
    expect(buildThreadList(applications)[0].unreadCount).toBe(0);
  });

  test("exposes the latest message with direction and subject", () => {
    const [, ada] = buildThreadList(applications);

    expect(ada.latest.direction).toBe("INBOUND");
    expect(ada.latest.snippet).toBe("Also a second note");
    expect(ada.applicantName).toBe("Ada Smith");
  });

  test("search matches name, business and email case-insensitively", () => {
    expect(buildThreadList(applications, "ADA").map((t) => t.applicationId)).toEqual([
      "a2",
      "a1",
    ]);
    expect(buildThreadList(applications, "tom@exa").map((t) => t.applicationId)).toEqual([
      "a2",
    ]);
    expect(buildThreadList(applications, "studio").map((t) => t.applicationId)).toEqual([
      "a1",
    ]);
  });

  test("snippet is trimmed to 120 characters", () => {
    const long = "x".repeat(300);
    const list = buildThreadList([
      {
        ...applications[0],
        emailMessages: [msg("INBOUND", long, "2026-11-06T10:00:00Z")],
      },
    ]);

    expect(list[0].latest.snippet).toHaveLength(120);
  });
});
