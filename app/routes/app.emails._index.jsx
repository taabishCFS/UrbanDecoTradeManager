import { Form, Link, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { countUnmatched, listThreads } from "../services/email-queries.server";

export async function loader({ request }) {
  await authenticate.admin(request);

  const query = new URL(request.url).searchParams.get("q") || "";

  const [threads, unmatchedCount] = await Promise.all([
    listThreads(query),
    countUnmatched(),
  ]);

  return { threads, unmatchedCount, query };
}

export default function Emails() {
  const { threads, unmatchedCount, query } = useLoaderData();

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Emails</h1>

          <p style={subtitleStyle}>
            Email conversations with trade applicants.
          </p>
        </div>

        <Link to="/app/emails/unmatched" style={unmatchedLinkStyle}>
          Unmatched ({unmatchedCount})
        </Link>
      </div>

      <Form method="get" style={searchFormStyle}>
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search name, business or email"
          style={searchInputStyle}
        />

        <button type="submit" style={searchButtonStyle}>
          Search
        </button>
      </Form>

      {threads.length === 0 ? (
        <div style={emptyStyle}>
          <h3>No conversations yet</h3>

          <p>
            Emails sent to applicants and their replies will appear here.
          </p>
        </div>
      ) : (
        <div style={tableContainerStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Applicant</th>
                <th style={thStyle}>Latest email</th>
                <th style={thStyle}>When</th>
                <th style={thStyle}>Action</th>
              </tr>
            </thead>

            <tbody>
              {threads.map((thread) => (
                <tr key={thread.applicationId}>
                  <td style={tdStyle}>
                    {thread.unreadCount > 0 && (
                      <span style={unreadDotStyle} title="Unread reply" />
                    )}
                    <strong>{thread.applicantName}</strong>
                    <div style={mutedStyle}>{thread.businessName}</div>
                  </td>

                  <td style={tdStyle}>
                    <span style={mutedStyle}>
                      {thread.latest.direction === "OUTBOUND" ? "You: " : ""}
                    </span>
                    {thread.latest.snippet}
                  </td>

                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    {formatDateTime(thread.latest.createdAt)}
                  </td>

                  <td style={tdStyle}>
                    <Link
                      to={`/app/emails/${thread.applicationId}`}
                      style={openButtonStyle}
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

const pageStyle = { padding: "30px" };

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: "24px",
};

const titleStyle = { margin: 0, fontSize: "28px" };

const subtitleStyle = { marginTop: "8px", color: "#666" };

const unmatchedLinkStyle = {
  background: "#f5f5f5",
  padding: "8px 14px",
  borderRadius: "6px",
  fontSize: "14px",
  color: "#222",
  textDecoration: "none",
};

const searchFormStyle = { display: "flex", gap: "8px", marginBottom: "20px" };

const searchInputStyle = {
  flex: 1,
  maxWidth: "380px",
  padding: "9px 12px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  fontSize: "14px",
};

const searchButtonStyle = {
  padding: "9px 16px",
  background: "#222",
  color: "#fff",
  border: "none",
  borderRadius: "6px",
  fontSize: "14px",
  cursor: "pointer",
};

const emptyStyle = {
  padding: "50px",
  textAlign: "center",
  background: "#fff",
  border: "1px solid #e5e5e5",
  borderRadius: "8px",
};

const tableContainerStyle = {
  overflowX: "auto",
  background: "#fff",
  border: "1px solid #e5e5e5",
  borderRadius: "8px",
};

const tableStyle = { width: "100%", borderCollapse: "collapse" };

const thStyle = {
  textAlign: "left",
  padding: "14px",
  background: "#f7f7f7",
  borderBottom: "2px solid #ddd",
  fontSize: "13px",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "14px",
  borderBottom: "1px solid #eee",
  verticalAlign: "middle",
  fontSize: "14px",
};

const mutedStyle = { color: "#777", fontSize: "13px" };

const unreadDotStyle = {
  display: "inline-block",
  width: "9px",
  height: "9px",
  borderRadius: "50%",
  background: "#2c6ecb",
  marginRight: "8px",
};

const openButtonStyle = {
  display: "inline-block",
  padding: "7px 14px",
  background: "#222",
  color: "#fff",
  textDecoration: "none",
  borderRadius: "5px",
  fontSize: "13px",
};
