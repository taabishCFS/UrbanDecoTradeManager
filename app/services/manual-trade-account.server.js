import prisma from "../db.server.js";
import { approveApplication, normalisePhone } from "./approve-application.server.js";

export const APPLICATION_SOURCE = { FORM: "FORM", MANUAL: "MANUAL" };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (value) => (typeof value === "string" ? value.trim() : "");
const orNull = (value) => str(value) || null;

export function validateManualTradeAccount(input = {}) {
  const approveNow = Boolean(input.approveNow);
  const values = {
    firstName: str(input.firstName),
    lastName: str(input.lastName),
    email: str(input.email).toLowerCase(),
    businessName: str(input.businessName),
    phone: str(input.phone),
    businessType: str(input.businessType),
    website: str(input.website),
    instagram: str(input.instagram),
    companyNumber: str(input.companyNumber),
    vatNumber: str(input.vatNumber),
    address: str(input.address),
    city: str(input.city),
    county: str(input.county),
    postcode: str(input.postcode),
    country: str(input.country),
    notes: str(input.notes),
    approveNow,
  };

  const errors = {};
  if (!values.firstName) errors.firstName = "First name is required.";
  if (!values.lastName) errors.lastName = "Last name is required.";
  if (!values.email) errors.email = "Email is required.";
  else if (!EMAIL_PATTERN.test(values.email))
    errors.email = "Enter a valid email address.";
  if (!values.businessName) errors.businessName = "Business name is required.";
  if (approveNow && !normalisePhone(values.phone))
    errors.phone = "A valid phone number is required to approve now.";

  return { errors, values };
}

export async function createManualTradeAccount({ admin, input }) {
  const { errors, values } = validateManualTradeAccount(input);
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, message: "Please fix the highlighted fields." };
  }

  const existing = await prisma.tradeApplication.findFirst({
    where: { email: { equals: values.email, mode: "insensitive" } },
  });
  if (existing) {
    return {
      ok: false,
      duplicateOf: { id: existing.id, status: existing.status },
      message: `An application with this email already exists (status: ${existing.status}).`,
    };
  }

  const application = await prisma.tradeApplication.create({
    data: {
      source: APPLICATION_SOURCE.MANUAL,
      status: "PENDING",
      termsAccepted: false,
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email,
      businessName: values.businessName,
      phone: values.phone,
      businessType: values.businessType,
      address: values.address,
      city: values.city,
      postcode: values.postcode,
      website: orNull(values.website),
      instagram: orNull(values.instagram),
      companyNumber: orNull(values.companyNumber),
      vatNumber: orNull(values.vatNumber),
      county: orNull(values.county),
      country: orNull(values.country),
      projectInformation: values.notes,
    },
  });

  if (!values.approveNow) {
    return {
      ok: true,
      application,
      approved: false,
      message: "Trade application saved as pending.",
    };
  }

  const result = await approveApplication({ admin, application });
  if (result.status === 200) {
    return {
      ok: true,
      application,
      approved: true,
      message: "Trade account created and approved.",
    };
  }
  return {
    ok: false,
    application,
    message: `Application saved as pending, but approval failed: ${result.body?.message ?? "unknown error"}`,
  };
}
