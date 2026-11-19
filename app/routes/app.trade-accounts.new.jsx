import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { createManualTradeAccount } from "../services/manual-trade-account.server";

const TEXT_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "businessName",
  "businessType",
  "website",
  "instagram",
  "companyNumber",
  "vatNumber",
  "address",
  "city",
  "county",
  "postcode",
  "country",
  "notes",
];

export async function loader({ request }) {
  await authenticate.admin(request);
  return null;
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const values = {};
  for (const key of TEXT_FIELDS) {
    const value = formData.get(key);
    values[key] = typeof value === "string" ? value : "";
  }
  const approveNowValue = formData.get("approveNow");
  values.approveNow = approveNowValue === "on" || approveNowValue === "true";

  const result = await createManualTradeAccount({ admin, input: values });

  if (result.ok) {
    return redirect(
      result.approved
        ? result.tradeAccountId
          ? `/app/trade-accounts/${result.tradeAccountId}`
          : "/app/trade-accounts"
        : `/app/trade-applications/${result.application.id}`,
    );
  }

  // Application created but approval failed -> 500, otherwise 400.
  const status = result.application ? 500 : 400;

  return Response.json(
    {
      ok: false,
      errors: result.errors || {},
      message: result.message,
      duplicateOf: result.duplicateOf || null,
      applicationId: result.application?.id || null,
      values,
    },
    { status },
  );
}

export default function NewTradeAccount() {
  const actionData = useActionData();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  const errors = actionData?.errors || {};
  const values = actionData?.values || {};
  const approveNowDefault =
    actionData?.values ? Boolean(values.approveNow) : true;

  const field = (name, label, { required = false, type = "text" } = {}) => (
    <div style={fieldStyle}>
      <label htmlFor={name} style={labelStyle}>
        {label}
        {required ? " *" : ""}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={values[name] ?? ""}
        style={{
          ...inputStyle,
          ...(errors[name] ? { borderColor: "#842029" } : {}),
        }}
      />
      {errors[name] && <div style={errorTextStyle}>{errors[name]}</div>}
    </div>
  );

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Add Trade Account</h1>
          <p style={subtitleStyle}>
            Manually add a trade customer and optionally approve them straight
            away.
          </p>
        </div>
      </div>

      {actionData && !actionData.ok && actionData.message && (
        <div style={bannerStyle}>
          <div>{actionData.message}</div>

          {actionData.duplicateOf && (
            <div style={{ marginTop: "6px" }}>
              <Link to={`/app/trade-applications/${actionData.duplicateOf.id}`}>
                View the existing application
              </Link>
            </div>
          )}

          {actionData.applicationId && (
            <div style={{ marginTop: "6px" }}>
              <Link to={`/app/trade-applications/${actionData.applicationId}`}>
                View the pending application
              </Link>
            </div>
          )}
        </div>
      )}

      <Form method="post" style={formStyle}>
        <fieldset style={groupStyle}>
          <legend style={legendStyle}>Contact</legend>
          <div style={gridStyle}>
            {field("firstName", "First name", { required: true })}
            {field("lastName", "Last name", { required: true })}
            {field("email", "Email", { required: true, type: "email" })}
            {field("phone", "Phone", { required: true, type: "tel" })}
          </div>
        </fieldset>

        <fieldset style={groupStyle}>
          <legend style={legendStyle}>Business</legend>
          <div style={gridStyle}>
            {field("businessName", "Business name", { required: true })}
            {field("businessType", "Business type")}
            {field("website", "Website")}
            {field("instagram", "Instagram")}
            {field("companyNumber", "Company number")}
            {field("vatNumber", "VAT number")}
          </div>
        </fieldset>

        <fieldset style={groupStyle}>
          <legend style={legendStyle}>Address</legend>
          <div style={gridStyle}>
            {field("address", "Address")}
            {field("city", "City")}
            {field("county", "County")}
            {field("postcode", "Postcode")}
            {field("country", "Country")}
          </div>
        </fieldset>

        <fieldset style={groupStyle}>
          <legend style={legendStyle}>Notes</legend>
          <div style={fieldStyle}>
            <label htmlFor="notes" style={labelStyle}>
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={4}
              defaultValue={values.notes ?? ""}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
        </fieldset>

        <div style={fieldStyle}>
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              name="approveNow"
              defaultChecked={approveNowDefault}
            />
            Approve and send welcome email now
          </label>
        </div>

        <div style={actionsStyle}>
          <button type="submit" disabled={submitting} style={submitButtonStyle}>
            {submitting ? "Saving..." : "Save trade account"}
          </button>

          <Link to="/app/trade-accounts" style={cancelStyle}>
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  );
}

/* ============================================================
   STYLES
============================================================ */

const pageStyle = {
  padding: "30px",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: "30px",
};

const titleStyle = {
  margin: 0,
  fontSize: "28px",
  fontWeight: "600",
};

const subtitleStyle = {
  marginTop: "8px",
  color: "#666",
};

const formStyle = {
  maxWidth: "820px",
};

const groupStyle = {
  background: "#fff",
  border: "1px solid #e5e5e5",
  borderRadius: "8px",
  padding: "18px 20px",
  marginBottom: "20px",
};

const legendStyle = {
  padding: "0 8px",
  fontSize: "14px",
  fontWeight: "600",
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: "14px",
};

const fieldStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const labelStyle = {
  fontSize: "13px",
  fontWeight: "500",
};

const inputStyle = {
  padding: "9px 10px",
  border: "1px solid #ccc",
  borderRadius: "5px",
  fontSize: "14px",
  fontFamily: "inherit",
};

const errorTextStyle = {
  color: "#842029",
  fontSize: "12px",
};

const bannerStyle = {
  maxWidth: "820px",
  marginBottom: "20px",
  padding: "12px 16px",
  background: "#f8d7da",
  color: "#842029",
  borderRadius: "6px",
  fontSize: "14px",
};

const checkboxLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "14px",
};

const actionsStyle = {
  display: "flex",
  alignItems: "center",
  gap: "16px",
  marginTop: "20px",
};

const submitButtonStyle = {
  padding: "9px 18px",
  background: "#222",
  color: "#fff",
  border: "none",
  borderRadius: "5px",
  fontSize: "14px",
  fontWeight: "500",
  cursor: "pointer",
};

const cancelStyle = {
  color: "#444",
  fontSize: "14px",
  textDecoration: "none",
};
