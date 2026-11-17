import { useEffect, useRef, useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { sendTradeReply } from "../services/email.server";
import { replySubject } from "../services/email-text.server";
import { getThread, markThreadRead } from "../services/email-queries.server";

export async function loader({ request, params }) {
  await authenticate.admin(request);

  const thread = await getThread(params.applicationId);

  if (!thread) {
    throw new Response("Application not found", { status: 404 });
  }

  await markThreadRead(thread.id);

  const messages = thread.emailMessages;
  const latest = messages[messages.length - 1];

  return {
    application: {
      id: thread.id,
      name: `${thread.firstName} ${thread.lastName}`.trim(),
      businessName: thread.businessName,
      email: thread.email,
    },
    messages,
    defaultSubject: replySubject(latest?.subject),
  };
}

export async function action({ request, params }) {
  await authenticate.admin(request);

  const formData = await request.formData();

  if (formData.get("intent") !== "reply") {
    return { error: "Unknown action." };
  }

  const body = formData.get("body")?.toString().trim() || "";
  const subject = formData.get("subject")?.toString().trim() || "";

  if (!body) {
    return { error: "Please write a message before sending." };
  }

  const application = await prisma.tradeApplication.findUnique({
    where: { id: params.applicationId },
    select: { id: true, email: true, firstName: true, businessName: true },
  });

  if (!application) {
    return { error: "Application not found." };
  }

  const result = await sendTradeReply({ application, subject, body });

  if (!result.success) {
    return { error: "The email could not be sent. Please try again." };
  }

  return { success: "Reply sent." };
}

export default function EmailThread() {
  const { application, messages, defaultSubject } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const formRef = useRef(null);
  const [showAll, setShowAll] = useState(false);

  const sending = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.success) {
      formRef.current?.reset();
    }
  }, [actionData]);

  const latest = messages[messages.length - 1];
  const earlier = messages.slice(0, -1);
  const visible = showAll ? messages : latest ? [latest] : [];

  return (
    <div style={pageStyle}>
      <Link to="/app/emails" style={backStyle}>
        ← Back to Emails
      </Link>

      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>{application.businessName}</h1>

          <p style={subtitleStyle}>
            {application.name} · {application.email}
          </p>
        </div>

        <Link
          to={`/app/trade-applications/${application.id}`}
          style={viewApplicationStyle}
        >
          View application
        </Link>
      </div>

      {messages.length === 0 && (
        <div style={emptyStyle}>No emails for this applicant yet.</div>
      )}

      {earlier.length > 0 && (
        <button
          type="button"
          style={toggleStyle}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll
            ? "Hide earlier emails"
            : `Show ${earlier.length} earlier email${earlier.length !== 1 ? "s" : ""}`}
        </button>
      )}

      {visible.map((message) => {
        const isLatest = message.id === latest.id;

        return (
          <div
            key={message.id}
            style={{
              ...messageStyle,
              ...(message.direction === "INBOUND"
                ? inboundStyle
                : outboundStyle),
              ...(isLatest ? latestStyle : {}),
            }}
          >
            <div style={messageMetaStyle}>
              <strong>
                {message.direction === "INBOUND" ? application.name : "Urban Deco"}
              </strong>
              <span>{formatDateTime(message.createdAt)}</span>
            </div>

            <div style={subjectStyle}>{message.subject}</div>

            <div style={bodyStyle}>{message.bodyText}</div>
          </div>
        );
      })}

      <h3 style={replyHeadingStyle}>Reply</h3>

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

      <Form method="post" ref={formRef} style={formStyle}>
        <input type="hidden" name="intent" value="reply" />

        <label style={labelStyle} htmlFor="subject">
          Subject
        </label>
        <input
          id="subject"
          name="subject"
          defaultValue={defaultSubject}
          style={inputStyle}
        />

        <label style={labelStyle} htmlFor="body">
          Message
        </label>
        <textarea id="body" name="body" rows={7} style={inputStyle} />

        <button type="submit" style={sendButtonStyle} disabled={sending}>
          {sending ? "Sending…" : "Send reply"}
        </button>
      </Form>
    </div>
  );
}

function formatDateTime(date) {
  return new Date(date).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: "24px",
};

const titleStyle = { margin: 0, fontSize: "26px" };

const subtitleStyle = { marginTop: "8px", color: "#666" };

const viewApplicationStyle = {
  padding: "8px 14px",
  background: "#222",
  color: "#fff",
  borderRadius: "6px",
  fontSize: "13px",
  textDecoration: "none",
};

const emptyStyle = {
  padding: "30px",
  textAlign: "center",
  background: "#fff",
  border: "1px solid #e5e5e5",
  borderRadius: "8px",
  color: "#666",
};

const toggleStyle = {
  marginBottom: "14px",
  padding: "8px 14px",
  background: "#f5f5f5",
  border: "1px solid #ddd",
  borderRadius: "6px",
  fontSize: "13px",
  cursor: "pointer",
};

const messageStyle = {
  padding: "16px",
  marginBottom: "14px",
  borderRadius: "8px",
  border: "1px solid #e5e5e5",
};

const inboundStyle = { background: "#fff" };

const outboundStyle = { background: "#f7f7f7" };

const latestStyle = { borderColor: "#2c6ecb", borderWidth: "2px" };

const messageMetaStyle = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: "13px",
  color: "#555",
  marginBottom: "8px",
};

const subjectStyle = { fontWeight: 600, marginBottom: "8px" };

const bodyStyle = { whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: "14px" };

const replyHeadingStyle = { margin: "28px 0 12px" };

const formStyle = { display: "flex", flexDirection: "column", gap: "8px" };

const labelStyle = { fontSize: "13px", color: "#555" };

const inputStyle = {
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  fontSize: "14px",
  fontFamily: "inherit",
};

const sendButtonStyle = {
  alignSelf: "flex-start",
  padding: "10px 20px",
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
  marginBottom: "12px",
  fontSize: "14px",
};

const errorNoticeStyle = { background: "#f8d7da", color: "#842029" };

const successNoticeStyle = { background: "#d1e7dd", color: "#0f5132" };
