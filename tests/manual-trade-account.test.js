import { beforeEach, describe, expect, test, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  tradeApplication: {
    findFirst: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));
const approveApplication = vi.hoisted(() => vi.fn());

vi.mock("../app/db.server.js", () => ({ default: prisma }));
vi.mock("../app/services/approve-application.server.js", () => ({
  approveApplication,
  normalisePhone: (phone) => {
    const digits = String(phone ?? "").replace(/\D/g, "");
    return digits.length >= 10 ? `+44${digits.slice(-10)}` : null;
  },
}));

const { validateManualTradeAccount, createManualTradeAccount } = await import(
  "../app/services/manual-trade-account.server.js"
);

const admin = { graphql: vi.fn() };

const validInput = {
  firstName: " Ada ",
  lastName: "Lovelace",
  email: " Ada@Example.com ",
  businessName: "Analytical Interiors",
  phone: "",
  website: "",
  notes: "Met at trade show",
  approveNow: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  prisma.tradeApplication.create.mockImplementation(async ({ data }) => ({
    id: "app_1",
    ...data,
  }));
});

describe("validateManualTradeAccount", () => {
  test("validate: requires first name, last name, email, business name", () => {
    const { errors } = validateManualTradeAccount({
      firstName: " ",
      lastName: "",
      email: "",
      businessName: "  ",
    });
    expect(errors).toHaveProperty("firstName");
    expect(errors).toHaveProperty("lastName");
    expect(errors).toHaveProperty("email");
    expect(errors).toHaveProperty("businessName");
  });

  test('validate: rejects malformed email "ada@"', () => {
    const { errors } = validateManualTradeAccount({ ...validInput, email: "ada@" });
    expect(errors).toHaveProperty("email");
  });

  test("validate: lower-cases and trims email", () => {
    const { errors, values } = validateManualTradeAccount(validInput);
    expect(errors).toEqual({});
    expect(values.email).toBe("ada@example.com");
    expect(values.firstName).toBe("Ada");
  });

  test("validate: phone only required/validated when approveNow", () => {
    const bad = { ...validInput, phone: "123" };
    expect(validateManualTradeAccount({ ...bad, approveNow: false }).errors).not.toHaveProperty("phone");
    expect(validateManualTradeAccount({ ...bad, approveNow: true }).errors).toHaveProperty("phone");
  });
});

describe("createManualTradeAccount", () => {
  test("create: blocks duplicate email case-insensitively", async () => {
    prisma.tradeApplication.findFirst.mockResolvedValue({ id: "old", status: "REJECTED" });
    const result = await createManualTradeAccount({ admin, input: validInput });
    expect(prisma.tradeApplication.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: "ada@example.com", mode: "insensitive" } },
    });
    expect(result.ok).toBe(false);
    expect(result.duplicateOf).toEqual({ id: "old", status: "REJECTED" });
    expect(result.message).toContain("REJECTED");
    expect(prisma.tradeApplication.create).not.toHaveBeenCalled();
    expect(approveApplication).not.toHaveBeenCalled();
  });

  test("create: approveNow=false saves PENDING manual application", async () => {
    prisma.tradeApplication.findFirst.mockResolvedValue(null);
    const result = await createManualTradeAccount({ admin, input: validInput });
    const { data } = prisma.tradeApplication.create.mock.calls[0][0];
    expect(data).toMatchObject({
      source: "MANUAL",
      status: "PENDING",
      termsAccepted: false,
      phone: "",
      address: "",
      projectInformation: "Met at trade show",
      email: "ada@example.com",
      website: null,
    });
    expect(approveApplication).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, approved: false });
  });

  test("create: approveNow=true calls approveApplication with the created application", async () => {
    prisma.tradeApplication.findFirst.mockResolvedValue(null);
    approveApplication.mockResolvedValue({ status: 200, body: {} });
    const result = await createManualTradeAccount({
      admin,
      input: { ...validInput, phone: "07123 456789", approveNow: true },
    });
    expect(approveApplication).toHaveBeenCalledWith({
      admin,
      application: expect.objectContaining({ id: "app_1" }),
    });
    expect(result).toMatchObject({ ok: true, approved: true });
  });

  test("create: approval failure keeps application PENDING", async () => {
    prisma.tradeApplication.findFirst.mockResolvedValue(null);
    approveApplication.mockResolvedValue({ status: 500, body: { message: "boom" } });
    const result = await createManualTradeAccount({
      admin,
      input: { ...validInput, phone: "07123 456789", approveNow: true },
    });
    expect(result.ok).toBe(false);
    expect(result.application).toBeDefined();
    expect(result.message).toContain("boom");
    expect(prisma.tradeApplication.delete).not.toHaveBeenCalled();
  });
});
