import { useActionData, useLoaderData, useNavigation } from "react-router";
import { Form, Link } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export async function action({ request }) {
  await authenticate.admin(request);

  const formData = await request.formData();

  if (formData.get("intent") !== "delete") {
    return { error: "Unknown action." };
  }

  const id = formData.get("id")?.toString();

  if (!id) {
    return { error: "Application ID is missing." };
  }

  const application = await prisma.tradeApplication.findUnique({
    where: { id },
    select: {
      businessName: true,
      tradeAccount: { select: { id: true } },
    },
  });

  if (!application) {
    return { error: "Application not found." };
  }

  // An approved application owns a trade account (referrals,
  // commissions, Shopify customer and discount), so it must not
  // be deleted from here.
  if (application.tradeAccount) {
    return {
      error:
        "This application has a trade account and cannot be deleted.",
    };
  }

  await prisma.tradeApplication.delete({ where: { id } });

  return { success: `Deleted application from ${application.businessName}.` };
}

export async function loader() {
  const applications = await prisma.tradeApplication.findMany({
    orderBy: {
      createdAt: "desc",
    },

    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      businessName: true,
      businessType: true,
      companyNumber: true,
      vatNumber: true,
      status: true,
      createdAt: true,
      tradeAccount: { select: { id: true } },
    },
  });

  return {
    applications,
  };
}

export default function TradeApplications() {
  const { applications } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  const deletingId =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "delete"
      ? navigation.formData.get("id")
      : null;

  return (
    <div style={pageStyle}>
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

      {/* HEADER */}

      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Trade Applications</h1>

          <p style={subtitleStyle}>
            Review and manage Urban Deco Trade Account applications.
          </p>
        </div>

        <div style={countStyle}>
          {applications.length} application
          {applications.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* EMPTY STATE */}

      {applications.length === 0 ? (
        <div style={emptyStyle}>
          <h3>No trade applications found</h3>

          <p>
            New trade applications will appear here.
          </p>
        </div>
      ) : (
        /* APPLICATION TABLE */

        <div style={tableContainerStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Applicant</th>
                <th style={thStyle}>Business</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Company No.</th>
                <th style={thStyle}>VAT No.</th>
                <th style={thStyle}>Applied</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Action</th>
              </tr>
            </thead>

            <tbody>
              {applications.map((application) => (
                <tr key={application.id}>

                  {/* APPLICANT */}

                  <td style={tdStyle}>
                    <strong>
                      {application.firstName}{" "}
                      {application.lastName}
                    </strong>
                  </td>

                  {/* BUSINESS */}

                  <td style={tdStyle}>
                    {application.businessName}
                  </td>

                  {/* TYPE */}

                  <td style={tdStyle}>
                    {application.businessType}
                  </td>

                  {/* EMAIL */}

                  <td style={tdStyle}>
                    {application.email}
                  </td>

                  {/* COMPANY NUMBER */}

                  <td style={tdStyle}>
                    {application.companyNumber || "—"}
                  </td>

                  {/* VAT NUMBER */}

                  <td style={tdStyle}>
                    {application.vatNumber || "—"}
                  </td>

                  {/* DATE */}

                  <td style={tdStyle}>
                    {formatDate(application.createdAt)}
                  </td>

                  {/* STATUS */}

                  <td style={tdStyle}>
                    <StatusBadge
                      status={application.status}
                    />
                  </td>

                  {/* VIEW */}

                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    <Link
                      to={`/app/trade-applications/${application.id}`}
                      style={viewButtonStyle}
                    >
                      View
                    </Link>

                    <Link
                      to={`/app/emails/${application.id}`}
                      style={{ ...viewButtonStyle, marginLeft: "8px" }}
                    >
                      Email
                    </Link>

                    <Form
                      method="post"
                      style={{ display: "inline", marginLeft: "8px" }}
                      onSubmit={(event) => {
                        if (
                          !window.confirm(
                            `Delete the application from ${application.businessName}? This cannot be undone.`
                          )
                        ) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={application.id} />

                      <button
                        type="submit"
                        style={
                          application.tradeAccount
                            ? { ...deleteButtonStyle, ...disabledButtonStyle }
                            : deleteButtonStyle
                        }
                        disabled={
                          Boolean(application.tradeAccount) ||
                          deletingId === application.id
                        }
                        title={
                          application.tradeAccount
                            ? "Applications with a trade account cannot be deleted"
                            : "Delete application"
                        }
                      >
                        {deletingId === application.id
                          ? "Deleting…"
                          : "Delete"}
                      </button>
                    </Form>
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


/* =========================================================
   STATUS BADGE
========================================================= */

function StatusBadge({ status }) {
  const styles = {
    PENDING: {
      background: "#fff3cd",
      color: "#856404",
    },

    APPROVED: {
      background: "#d1e7dd",
      color: "#0f5132",
    },

    REJECTED: {
      background: "#f8d7da",
      color: "#842029",
    },
  };

  const currentStyle = styles[status] || {
    background: "#e9ecef",
    color: "#495057",
  };

  return (
    <span
      style={{
        ...badgeStyle,
        ...currentStyle,
      }}
    >
      {status}
    </span>
  );
}


/* =========================================================
   DATE FORMAT
========================================================= */

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}


/* =========================================================
   STYLES
========================================================= */

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
};

const subtitleStyle = {
  marginTop: "8px",
  color: "#666",
};

const countStyle = {
  background: "#f5f5f5",
  padding: "8px 14px",
  borderRadius: "6px",
  fontSize: "14px",
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

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
};

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

const badgeStyle = {
  display: "inline-block",
  padding: "5px 10px",
  borderRadius: "5px",
  fontSize: "12px",
  fontWeight: "600",
};

const deleteButtonStyle = {
  padding: "7px 14px",
  background: "#fff",
  color: "#b42318",
  border: "1px solid #b42318",
  borderRadius: "5px",
  fontSize: "13px",
  cursor: "pointer",
};

const disabledButtonStyle = {
  opacity: 0.4,
  cursor: "not-allowed",
};

const noticeStyle = {
  padding: "12px 16px",
  borderRadius: "6px",
  marginBottom: "20px",
  fontSize: "14px",
};

const errorNoticeStyle = {
  background: "#f8d7da",
  color: "#842029",
};

const successNoticeStyle = {
  background: "#d1e7dd",
  color: "#0f5132",
};

const viewButtonStyle = {
  display: "inline-block",
  padding: "7px 14px",
  background: "#222",
  color: "#fff",
  textDecoration: "none",
  borderRadius: "5px",
  fontSize: "13px",
};