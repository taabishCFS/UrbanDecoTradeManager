import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  tradeApplication: { findUnique: vi.fn() },
  tradeAccount: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
const authenticateAdmin = vi.hoisted(() => vi.fn());
const sendTradeApprovalEmail = vi.hoisted(() => vi.fn());
const sendTradeRejectionEmail = vi.hoisted(() => vi.fn());

vi.mock("../app/db.server.js", () => ({ default: prisma }));
vi.mock("../app/shopify.server.js", () => ({
  authenticate: { admin: authenticateAdmin },
}));
vi.mock("../app/services/email.server.js", () => ({
  sendTradeApprovalEmail,
  sendTradeRejectionEmail,
}));

const { action } = await import("../app/routes/app.trade-applications.$id.jsx");

const tx = {
  tradeAccount: { create: vi.fn() },
  tradeApplication: { update: vi.fn() },
};
const admin = { graphql: vi.fn() };

const baseApplication = {
  id: "app_1",
  status: "PENDING",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  phone: "0116 296 3800",
  businessName: "Doe Interiors",
};

function jsonResponse(data) {
  return { json: async () => data };
}

function queryOf(call) {
  return call[0];
}

function mutationCalls(name) {
  return admin.graphql.mock.calls.filter((c) =>
    queryOf(c).includes(`mutation ${name}`),
  );
}

function setupGraphql({ existingCustomer = null } = {}) {
  admin.graphql.mockImplementation(async (query) => {
    if (query.includes("FindCustomerByEmail")) {
      return jsonResponse({
        data: {
          customers: {
            edges: existingCustomer ? [{ node: existingCustomer }] : [],
          },
        },
      });
    }
    if (query.includes("FindCustomerByPhone")) {
      return jsonResponse({ data: { customers: { edges: [] } } });
    }
    if (query.includes("mutation customerCreate")) {
      return jsonResponse({
        data: {
          customerCreate: {
            customer: { id: "gid://shopify/Customer/1" },
            userErrors: [],
          },
        },
      });
    }
    if (query.includes("mutation customerUpdate")) {
      return jsonResponse({
        data: { customerUpdate: { customer: {}, userErrors: [] } },
      });
    }
    if (query.includes("mutation customerDelete")) {
      return jsonResponse({
        data: {
          customerDelete: {
            deletedCustomerId: "gid://shopify/Customer/1",
            userErrors: [],
          },
        },
      });
    }
    throw new Error("unexpected graphql query: " + query);
  });
}

async function callApprove(application) {
  prisma.tradeApplication.findUnique.mockResolvedValue(application);
  const formData = new FormData();
  formData.set("action", "approve");
  const request = new Request("https://app.example/app/trade-applications/x", {
    method: "POST",
    body: formData,
  });
  const response = await action({ request, params: { id: application.id } });
  return { status: response.status, body: await response.json() };
}

describe("approve trade application (characterization)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    authenticateAdmin.mockReset().mockResolvedValue({ admin });
    admin.graphql.mockReset();
    setupGraphql();

    prisma.tradeApplication.findUnique.mockReset();
    // No existing trade account and no referral-code collision.
    prisma.tradeAccount.findUnique.mockReset().mockResolvedValue(null);

    tx.tradeAccount.create
      .mockReset()
      .mockImplementation(async ({ data }) => ({ id: "ta_1", ...data }));
    tx.tradeApplication.update
      .mockReset()
      .mockImplementation(async ({ where }) => ({
        ...baseApplication,
        id: where.id,
        status: "APPROVED",
      }));
    prisma.$transaction.mockReset().mockImplementation(async (cb) => cb(tx));

    sendTradeApprovalEmail.mockReset().mockResolvedValue({ ok: true });
    sendTradeRejectionEmail.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("approves a pending application", async () => {
    const { status, body } = await callApprove(baseApplication);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.action).toBe("approve");
    expect(body.message).toBe("Trade application approved successfully.");
    expect(body.referralCode).toMatch(/^UD-[A-Z0-9]{6}$/);
    expect(body.shopifyCustomerId).toBe("gid://shopify/Customer/1");

    expect(tx.tradeAccount.create).toHaveBeenCalledTimes(1);
    expect(tx.tradeAccount.create.mock.calls[0][0].data).toEqual({
      applicationId: "app_1",
      email: "jane@example.com",
      businessName: "Doe Interiors",
      discountPercent: 0,
      commissionPercent: 0,
      status: "ACTIVE",
      shopifyCustomerId: "gid://shopify/Customer/1",
      referralCode: body.referralCode,
    });

    expect(tx.tradeApplication.update).toHaveBeenCalledTimes(1);
    const updateArg = tx.tradeApplication.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "app_1" });
    expect(updateArg.data.status).toBe("APPROVED");
    expect(updateArg.data.approvedAt).toBeInstanceOf(Date);

    expect(sendTradeApprovalEmail).toHaveBeenCalledTimes(1);
    expect(sendTradeApprovalEmail).toHaveBeenCalledWith(baseApplication);

    const create = mutationCalls("customerCreate");
    expect(create).toHaveLength(1);
    expect(create[0][1].variables.input.phone).toBe("+441162963800");
    expect(create[0][1].variables.input.tags).toEqual(["TRADE_ACCOUNT"]);
  });

  test("returns 400 when already approved", async () => {
    const { status, body } = await callApprove({
      ...baseApplication,
      status: "APPROVED",
    });

    expect(status).toBe(400);
    expect(body).toEqual({
      success: false,
      message: "This application has already been approved.",
    });
    expect(admin.graphql).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("returns 400 when application has no phone", async () => {
    const { status, body } = await callApprove({
      ...baseApplication,
      phone: null,
    });

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toBe("The applicant does not have a phone number.");
    expect(admin.graphql).not.toHaveBeenCalled();
  });

  test("returns 400 when phone is invalid", async () => {
    const { status, body } = await callApprove({
      ...baseApplication,
      phone: "abc",
    });

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toContain("invalid");
    expect(admin.graphql).not.toHaveBeenCalled();
  });

  test("returns 400 when a trade account already exists", async () => {
    prisma.tradeAccount.findUnique.mockResolvedValue({ id: "ta_existing" });

    const { status, body } = await callApprove(baseApplication);

    expect(status).toBe(400);
    expect(body).toEqual({
      success: false,
      message: "A trade account already exists for this application.",
    });
    expect(admin.graphql).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("reuses an existing Shopify customer", async () => {
    setupGraphql({
      existingCustomer: {
        id: "gid://shopify/Customer/99",
        email: "jane@example.com",
        phone: null,
        tags: ["VIP"],
      },
    });

    const { status, body } = await callApprove(baseApplication);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message.endsWith("using an existing Shopify customer.")).toBe(
      true,
    );
    expect(body.shopifyCustomerId).toBe("gid://shopify/Customer/99");
    expect(mutationCalls("customerCreate")).toHaveLength(0);

    const update = mutationCalls("customerUpdate");
    expect(update).toHaveLength(1);
    expect(update[0][1].variables.input).toEqual({
      id: "gid://shopify/Customer/99",
      tags: ["VIP", "TRADE_ACCOUNT"],
    });
  });

  test("rolls back created customer when transaction fails", async () => {
    prisma.$transaction.mockRejectedValue(new Error("db down"));

    const { status, body } = await callApprove(baseApplication);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.rollbackSuccessful).toBe(true);
    expect(body.applicationId).toBe("app_1");

    const del = mutationCalls("customerDelete");
    expect(del).toHaveLength(1);
    expect(del[0][1].variables.input).toEqual({
      id: "gid://shopify/Customer/1",
    });
    expect(sendTradeApprovalEmail).not.toHaveBeenCalled();
  });

  test("still succeeds when approval email throws", async () => {
    sendTradeApprovalEmail.mockRejectedValue(new Error("smtp down"));

    const { status, body } = await callApprove(baseApplication);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.action).toBe("approve");
    expect(sendTradeApprovalEmail).toHaveBeenCalledTimes(1);
  });
});
