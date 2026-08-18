import { Link, useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  await authenticate.admin(request);

  const tradeAccounts = await prisma.tradeAccount.findMany({
    orderBy: {
      createdAt: "desc",
    },
    include: {
      application: true,
    },
  });

  return {
    tradeAccounts: tradeAccounts.map((account) => ({
      id: account.id,
      email: account.email,
      businessName: account.businessName,
      referralCode: account.referralCode,
      discountPercent: Number(account.discountPercent),
      commissionPercent: Number(account.commissionPercent),
      status: account.status,
      application: account.application
        ? {
            firstName: account.application.firstName,
            lastName: account.application.lastName,
          }
        : null,
    })),
  };
}

export default function TradeAccountsList() {
  const { tradeAccounts } = useLoaderData();

  return (
    <div style={pageStyle}>

      {/* HEADER */}

      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>
            Trade Accounts
          </h1>

          <p style={subtitleStyle}>
            Manage approved Urban Deco trade accounts.
          </p>
        </div>

        <div style={countStyle}>
          {tradeAccounts.length} account
          {tradeAccounts.length !== 1 ? "s" : ""}
        </div>
      </div>


      {/* EMPTY STATE */}

      {tradeAccounts.length === 0 ? (

        <div style={emptyStyle}>
          <h3>No trade accounts found</h3>

          <p>
            Approved trade accounts will appear here.
          </p>
        </div>

      ) : (

        /* TABLE */

        <div style={tableContainerStyle}>

          <table style={tableStyle}>

            <thead>

              <tr>

                <th style={thStyle}>
                  Contact
                </th>

                <th style={thStyle}>
                  Business
                </th>

                <th style={thStyle}>
                  Email
                </th>

                <th style={thStyle}>
                  Referral Code
                </th>

                <th style={thStyle}>
                  Discount
                </th>

                <th style={thStyle}>
                  Commission
                </th>

                <th style={thStyle}>
                  Status
                </th>

                <th style={thStyle}>
                  Action
                </th>

              </tr>

            </thead>


            <tbody>

              {tradeAccounts.map((account) => (

                <tr key={account.id}>

                  {/* CONTACT */}

                  <td style={tdStyle}>

                    <strong>
                      {account.application
                        ? `${account.application.firstName} ${account.application.lastName}`
                        : "—"}
                    </strong>

                  </td>


                  {/* BUSINESS */}

                  <td style={tdStyle}>
                    {account.businessName}
                  </td>


                  {/* EMAIL */}

                  <td style={tdStyle}>
                    {account.email}
                  </td>


                  {/* REFERRAL */}

                  <td style={tdStyle}>

                    <span style={referralStyle}>
                      {account.referralCode}
                    </span>

                  </td>


                  {/* DISCOUNT */}

                  <td style={tdStyle}>
                    {account.discountPercent}%
                  </td>


                  {/* COMMISSION */}

                  <td style={tdStyle}>
                    {account.commissionPercent}%
                  </td>


                  {/* STATUS */}

                  <td style={tdStyle}>
                    <StatusBadge
                      status={account.status}
                    />
                  </td>


                  {/* VIEW */}

                  <td style={tdStyle}>

                    <Link
                      to={`/app/trade-accounts/${account.id}`}
                      style={viewButtonStyle}
                    >
                      View
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


/* ============================================================
   STATUS BADGE
============================================================ */

function StatusBadge({ status }) {

  const styles = {
    ACTIVE: {
      background: "#d1e7dd",
      color: "#0f5132",
    },

    SUSPENDED: {
      background: "#fff3cd",
      color: "#856404",
    },

    CLOSED: {
      background: "#f8d7da",
      color: "#842029",
    },
  };

  const currentStyle =
    styles[status] || {
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

const countStyle = {
  background: "#f5f5f5",
  padding: "8px 14px",
  borderRadius: "6px",
  fontSize: "14px",
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

const referralStyle = {
  fontFamily: "monospace",
  fontSize: "13px",
  background: "#f5f5f5",
  padding: "5px 8px",
  borderRadius: "4px",
};

const badgeStyle = {
  display: "inline-block",
  padding: "5px 10px",
  borderRadius: "5px",
  fontSize: "12px",
  fontWeight: "600",
};

const viewButtonStyle = {
  display: "inline-block",
  padding: "7px 14px",
  background: "#222",
  color: "#fff",
  textDecoration: "none",
  borderRadius: "5px",
  fontSize: "13px",
  fontWeight: "500",
};

const emptyStyle = {
  padding: "40px",
  background: "#f8f8f8",
  borderRadius: "8px",
  textAlign: "center",
  color: "#666",
};