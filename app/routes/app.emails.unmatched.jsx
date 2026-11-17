import { Form, Link, useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import {
  assignUnmatched,
  listApplicationOptions,
  listUnmatched,
} from "../services/email-queries.server";

export async function loader({ request }) {
  await authenticate.admin(request);

  const [messages, applications] = await Promise.all([
    listUnmatched(),
    listApplicationOptions(),
  ]);

  return { messages, applications };
}

export async function action({ request }) {
  await authenticate.admin(request);

  const formData = await request.formData();

  const messageId = formData.get("messageId")?.toString();
  const applicationId = formData.get("applicationId")?.toString();

  if (!messageId || !applicationId) {
    return { error: "Choose an application to assign this email to." };
  }

  const result = await assignUnmatched(messageId, applicationId);

  if (result.count === 0) {
    return { error: "That email has already been assigned." };
  }

  return { success: "Email assigned." };
}

export default function UnmatchedEmails() {
  const { messages, applications } = useLoaderData();
  const actionData = useActionData();

  return (
    <div style={pageStyle}>
      <Link to="/app/emails" style={backStyle}>
        ← Back to Emails
      </Link>

      <h1 style={titleStyle}>Unmatched emails</h1>

      <p style={subtitleStyle}>
        Replies from addresses that do not match any trade application.
        Assign each one to the right applicant.
      </p>

      {actionData?.error && (
        <div style={{ ...noticeStyle, ...errorNoticeStyle }}>
          {actionData.error}
        </div>
      )}

      {actionData?.success && (
        <div style={{ ...noticeStyle, ...successNoticeStyle }}>
          {actionData.success}
        </div>
      )}

      {messages.length === 0 ? (
        <div style={emptyStyle}>No unmatched emails.</div>
      ) : (
        messages.map((message) => (
          <div key={message.id} style={cardStyle}>
            <div style={metaStyle}>
              <strong>{message.fromEmail}</strong>
              <span>
                {new Date(message.createdAt).toLocaleString("en-GB")}
              </span>
            </div>

            <div style={subjectStyle}>{message.subject}</div>

            <div style={bodyStyle}>{message.bodyText}</div>

            <Form method="post" style={assignFormStyle}>
              <input type="hidden" name="messageId" value={message.id} />

              <select name="applicationId" style={selectStyle} defaultValue="">
                <option value="" disabled>
                  Assign to application…
                </option>

                {applications.map((application) => (
                  <option key={application.id} value={application.id}>
                    {application.businessName} — {application.firstName}{" "}
                    {application.lastName} ({application.email})
                  </option>
                ))}
              </select>

              <button type="submit" style={buttonStyle}>
                Assign
              </button>
            </Form>
          </div>
        ))
      )}
    </div>
  );
}

/* STYLES */

const pageStyle = { padding: "30px", maxWidth: "860px" };

const backStyle = {
  display: "inline-block",
  marginBottom: "20px",
  padding: "8px 14px",
  fontSize: "14px",
  color: "#4A4A4A",
  backgroundColor: "#F6F6F6",
  borderRadius: "6px",
  textDecoration: "none",
};

const titleStyle = { margin: 0, fontSize: "26px" };

const subtitleStyle = { margin: "8px 0 24px", color: "#666" };

const emptyStyle = {
  padding: "30px",
  textAlign: "center",
  background: "#fff",
  border: "1px solid #e5e5e5",
  borderRadius: "8px",
  color: "#666",
};

const cardStyle = {
  padding: "16px",
  marginBottom: "14px",
  background: "#fff",
  border: "1px solid #e5e5e5",
  borderRadius: "8px",
};

const metaStyle = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: "13px",
  color: "#555",
  marginBottom: "8px",
};

const subjectStyle = { fontWeight: 600, marginBottom: "8px" };

const bodyStyle = { whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: "14px" };

const assignFormStyle = { display: "flex", gap: "8px", marginTop: "14px" };

const selectStyle = {
  flex: 1,
  padding: "9px 12px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  fontSize: "14px",
};

const buttonStyle = {
  padding: "9px 16px",
  background: "#222",
  color: "#fff",
  border: "none",
  borderRadius: "6px",
  fontSize: "14px",
  cursor: "pointer",
};

const noticeStyle = {
  padding: "12px 16px",
  borderRadius: "6px",
  marginBottom: "16px",
  fontSize: "14px",
};

const errorNoticeStyle = { background: "#f8d7da", color: "#842029" };

const successNoticeStyle = { background: "#d1e7dd", color: "#0f5132" };
