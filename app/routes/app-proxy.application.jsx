import prisma from "../db.server";

export async function action({ request }) {
  try {
    console.log("=================================");
    console.log("TRADE APPLICATION REQUEST RECEIVED");
    console.log("METHOD:", request.method);
    console.log("URL:", request.url);
    console.log("=================================");

    const formData = await request.formData();

    const termsValue = formData.get("terms_accepted");

const application = {
  firstName: formData.get("first_name")?.toString().trim() || "",
  lastName: formData.get("last_name")?.toString().trim() || "",
  email: formData.get("email")?.toString().trim().toLowerCase() || "",
  phone: formData.get("phone")?.toString().trim() || "",

  businessName:
    formData.get("business_name")?.toString().trim() || "",

  businessType:
    formData.get("business_type")?.toString().trim() || "",

  businessTypeOther : formData.get("business_type_other")?.toString().trim() || null,

  website:
    formData.get("website")?.toString().trim() || null,

  instagram:
    formData.get("instagram")?.toString().trim() || null,

  companyNumber:
    formData.get("company_number")?.toString().trim() || null,

  vatNumber:
    formData.get("vat_number")?.toString().trim() || null,

  yearsTrading:
    formData.get("years_trading")?.toString().trim() || null,

  typicalProjectValue:
    formData.get("typical_project_value")?.toString().trim() || null,

  portfolioUrl:
    formData.get("portfolio_url")?.toString().trim() || null,

  projectInformation:
    formData.get("project_information")?.toString().trim() || null,

  address:
    formData.get("address")?.toString().trim() || "",

  city:
    formData.get("city")?.toString().trim() || "",

  county:
    formData.get("county")?.toString().trim() || null,

  postcode:
    formData.get("postcode")?.toString().trim() || "",

  country:
    formData.get("country")?.toString().trim() || null,

  termsAccepted:
    termsValue === "on" ||
    termsValue === "true" ||
    termsValue === "1" ||
    termsValue === "yes",
};

    console.log("APPLICATION DATA:", application);

    // Validation

    const requiredFields = [
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["businessName", "Business name"],
  ["businessType", "Business type"],
  ["companyNumber", "Company registration number"],
  ["vatNumber", "VAT number"],
  ["address", "Address"],
  ["city", "City"],
  ["postcode", "Postcode"],
];

    for (const [field, label] of requiredFields) {
      if (!application[field]) {
        return Response.json(
          {
            success: false,
            message: `${label} is required.`,
          },
          { status: 400 }
        );
      }
    }

    if (!application.termsAccepted) {
      return Response.json(
        {
          success: false,
          message: "You must accept the terms and conditions.",
        },
        { status: 400 }
      );
    }

    // Check duplicate email

    const existingApplication =
      await prisma.tradeApplication.findFirst({
        where: {
          email: application.email,
        },
      });

    if (existingApplication) {
      return Response.json(
        {
          success: false,
          message:
            "An application with this email address already exists.",
        },
        { status: 409 }
      );
    }

    // Save to PostgreSQL

    const savedApplication =
      await prisma.tradeApplication.create({
        data: application,
      });

    console.log(
      "TRADE APPLICATION SAVED:",
      savedApplication.id
    );

    // return Response.json({
    //   success: true,
    //   message:
    //     "Thank you. Your trade application has been received.",
    //   applicationId: savedApplication.id,
    // });
    const reference =
  "UD-" +
  savedApplication.id
    .slice(-6)
    .toUpperCase();

return Response.json({
  success: true,
  message: "Thank you. Your trade application has been received.",
  reference,
});

  } catch (error) {

    console.error("TRADE APPLICATION ERROR:");
    console.error(error);

    return Response.json(
      {
        success: false,
        message:
          "Something went wrong while submitting your application.",
      },
      { status: 500 }
    );
  }
}