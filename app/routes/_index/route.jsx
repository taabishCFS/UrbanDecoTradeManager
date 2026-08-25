import {
  useLoaderData,
  Link,
} from "react-router";

import prisma from "./db.server";
import { authenticate } from "./shopify.server";


/* ============================================================
   LOADER
============================================================ */

export async function loader({ request }) {
  await authenticate.admin(request);


  /* ----------------------------------------------------------
     APPLICATIONS
  ---------------------------------------------------------- */

  const applicationsReceived =
    await prisma.tradeApplication.count();


  /* ----------------------------------------------------------
     TRADE ACCOUNTS
  ---------------------------------------------------------- */

  const tradeAccounts =
    await prisma.tradeAccount.count({
      where: {
        status: {
          not: "CLOSED",
        },
      },
    });


  /* ----------------------------------------------------------
     TOTAL COMMISSION
  ---------------------------------------------------------- */

  const commissionResult =
    await prisma.commission.aggregate({
      _sum: {
        commissionAmount: true,
      },
    });


  const totalCommission =
    Number(
      commissionResult._sum
        ?.commissionAmount || 0
    );


  /* ----------------------------------------------------------
     RECENT APPLICATIONS
  ---------------------------------------------------------- */

  const recentApplications =
    await prisma.tradeApplication.findMany({
      orderBy: {
        createdAt: "desc",
      },

      take: 5,

      select: {
        id: true,
        firstName: true,
        lastName: true,
        businessName: true,
        email: true,
        createdAt: true,
      },
    });


  return {
    applicationsReceived,
    tradeAccounts,
    totalCommission,
    recentApplications,
  };
}


/* ============================================================
   PAGE
============================================================ */

export default function Dashboard() {

  const {
    applicationsReceived,
    tradeAccounts,
    totalCommission,
    recentApplications,
  } = useLoaderData();


  return (
    <div style={pageStyle}>

      {/* ======================================================
          HEADER
      ====================================================== */}

      <div style={headerStyle}>

        <div>

          <div style={eyebrowStyle}>
            URBAN DECO TRADE MANAGER
          </div>

          <h1 style={headingStyle}>
            Trade Dashboard
          </h1>

          <p style={subtitleStyle}>
            Manage trade applications, accounts,
            referrals and designer commissions.
          </p>

        </div>

      </div>


      {/* ======================================================
          SUMMARY CARDS
      ====================================================== */}

      <div style={statsGridStyle}>

        <StatCard
          label="Applications Received"
          value={applicationsReceived}
          description="Total trade applications"
          href="/app/trade-applications"
        />


        <StatCard
          label="Trade Accounts"
          value={tradeAccounts}
          description="Active and suspended accounts"
          href="/app/trade-accounts"
        />


        <StatCard
          label="Total Commission"
          value={`£${totalCommission.toFixed(2)}`}
          description="Commission generated"
          href="/app/commissions"
        />

      </div>


      {/* ======================================================
          QUICK ACTIONS
      ====================================================== */}

      <section style={sectionStyle}>

        <div style={sectionHeaderStyle}>

          <div>

            <h2 style={sectionTitleStyle}>
              Quick Actions
            </h2>

            <p style={sectionDescriptionStyle}>
              Quickly access the main areas of your
              Trade Manager.
            </p>

          </div>

        </div>


        <div style={quickLinksGridStyle}>

          <DashboardLink
            href="/app/trade-applications"
            title="Trade Applications"
            description="Review and manage incoming trade applications."
            icon="📋"
          />


          <DashboardLink
            href="/app/trade-accounts"
            title="Trade Accounts"
            description="View designers, pricing models and account status."
            icon="👤"
          />


          <DashboardLink
            href="/app/commissions"
            title="Commissions"
            description="View referral orders and designer commission."
            icon="£"
          />

        </div>

      </section>


      {/* ======================================================
          RECENT APPLICATIONS
      ====================================================== */}

      <section style={sectionStyle}>

        <div style={sectionHeaderStyle}>

          <div>

            <h2 style={sectionTitleStyle}>
              Recent Applications
            </h2>

            <p style={sectionDescriptionStyle}>
              The latest trade applications received.
            </p>

          </div>


          <Link
            to="/app/trade-applications"
            style={viewAllStyle}
          >
            View all →
          </Link>

        </div>


        {recentApplications.length === 0 ? (

          <div style={emptyStateStyle}>
            No trade applications have been received yet.
          </div>

        ) : (

          <div style={applicationsListStyle}>

            {recentApplications.map(
              (application) => (

                <Link
                  key={application.id}
                  to={`/app/trade-applications/${application.id}`}
                  style={applicationRowStyle}
                >

                  <div>

                    <div style={applicationNameStyle}>
                      {application.businessName ||
                        `${application.firstName} ${application.lastName}`}
                    </div>

                    <div style={applicationEmailStyle}>
                      {application.email}
                    </div>

                  </div>


                  <div style={applicationDateStyle}>
                    {formatDate(
                      application.createdAt
                    )}
                  </div>

                </Link>

              )
            )}

          </div>

        )}

      </section>


      {/* ======================================================
          MANAGEMENT
      ====================================================== */}

      <section style={sectionStyle}>

        <h2 style={sectionTitleStyle}>
          Trade Management
        </h2>

        <div style={managementGridStyle}>

          <ManagementItem
            title="Applications"
            description="Review new applications and approve or reject trade accounts."
            href="/app/trade-applications"
          />


          <ManagementItem
            title="Trade Accounts"
            description="Manage designer pricing, referrals and account status."
            href="/app/trade-accounts"
          />


          <ManagementItem
            title="Commissions"
            description="Track commission generated from referred orders."
            href="/app/commissions"
          />

        </div>

      </section>

    </div>
  );
}


/* ============================================================
   STAT CARD
============================================================ */

function StatCard({
  label,
  value,
  description,
  href,
}) {
  return (
    <Link
      to={href}
      style={statCardStyle}
    >

      <div style={statLabelStyle}>
        {label}
      </div>

      <div style={statValueStyle}>
        {value}
      </div>

      <div style={statDescriptionStyle}>
        {description}
      </div>

      <div style={statArrowStyle}>
        View →
      </div>

    </Link>
  );
}


/* ============================================================
   DASHBOARD LINK
============================================================ */

function DashboardLink({
  href,
  title,
  description,
  icon,
}) {
  return (
    <Link
      to={href}
      style={quickLinkStyle}
    >

      <div style={quickLinkIconStyle}>
        {icon}
      </div>

      <div>

        <div style={quickLinkTitleStyle}>
          {title}
        </div>

        <div style={quickLinkDescriptionStyle}>
          {description}
        </div>

      </div>

      <div style={quickLinkArrowStyle}>
        →
      </div>

    </Link>
  );
}


/* ============================================================
   MANAGEMENT ITEM
============================================================ */

function ManagementItem({
  title,
  description,
  href,
}) {
  return (
    <Link
      to={href}
      style={managementItemStyle}
    >

      <div style={managementItemTitleStyle}>
        {title}
      </div>

      <div style={managementItemDescriptionStyle}>
        {description}
      </div>

      <div style={managementItemArrowStyle}>
        Open →
      </div>

    </Link>
  );
}


/* ============================================================
   DATE
============================================================ */

function formatDate(date) {

  if (!date) {
    return "—";
  }

  return new Date(date)
    .toLocaleDateString(
      "en-GB",
      {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }
    );
}


/* ============================================================
   PAGE STYLES
============================================================ */

const pageStyle = {
  minHeight: "100vh",
  background: "#f6f6f7",
  padding: "36px",
  boxSizing: "border-box",
};


const headerStyle = {
  maxWidth: "1400px",
  margin: "0 auto 30px",
};


const eyebrowStyle = {
  fontSize: "12px",
  fontWeight: "700",
  letterSpacing: "0.12em",
  color: "#6b6b6b",
  marginBottom: "8px",
};


const headingStyle = {
  margin: 0,
  fontSize: "34px",
  lineHeight: "1.2",
  fontWeight: "650",
  color: "#202223",
};


const subtitleStyle = {
  margin: "10px 0 0",
  fontSize: "15px",
  color: "#6d7175",
};


const statsGridStyle = {
  maxWidth: "1400px",
  margin: "0 auto 24px",
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(250px, 1fr))",
  gap: "18px",
};


const statCardStyle = {
  position: "relative",
  display: "block",
  background: "#ffffff",
  border: "1px solid #e1e3e5",
  borderRadius: "12px",
  padding: "24px",
  textDecoration: "none",
  color: "#202223",
  boxSizing: "border-box",
};


const statLabelStyle = {
  fontSize: "13px",
  fontWeight: "600",
  color: "#6d7175",
  marginBottom: "12px",
};


const statValueStyle = {
  fontSize: "32px",
  lineHeight: "1",
  fontWeight: "650",
  color: "#202223",
};


const statDescriptionStyle = {
  marginTop: "12px",
  fontSize: "13px",
  color: "#8c9196",
};


const statArrowStyle = {
  marginTop: "18px",
  fontSize: "13px",
  fontWeight: "600",
  color: "#202223",
};


const sectionStyle = {
  maxWidth: "1400px",
  margin: "0 auto 24px",
  background: "#ffffff",
  border: "1px solid #e1e3e5",
  borderRadius: "12px",
  padding: "24px",
  boxSizing: "border-box",
};


const sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "20px",
  marginBottom: "20px",
};


const sectionTitleStyle = {
  margin: 0,
  fontSize: "20px",
  fontWeight: "650",
  color: "#202223",
};


const sectionDescriptionStyle = {
  margin: "6px 0 0",
  fontSize: "13px",
  color: "#6d7175",
};


const viewAllStyle = {
  fontSize: "13px",
  fontWeight: "600",
  color: "#202223",
  textDecoration: "none",
  whiteSpace: "nowrap",
};


const quickLinksGridStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "12px",
};


const quickLinkStyle = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  padding: "18px",
  border: "1px solid #e1e3e5",
  borderRadius: "10px",
  textDecoration: "none",
  color: "#202223",
  background: "#fafbfb",
};


const quickLinkIconStyle = {
  width: "42px",
  height: "42px",
  borderRadius: "8px",
  background: "#f1f2f3",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "18px",
  fontWeight: "700",
  flexShrink: 0,
};


const quickLinkTitleStyle = {
  fontSize: "14px",
  fontWeight: "650",
  marginBottom: "4px",
};


const quickLinkDescriptionStyle = {
  fontSize: "12px",
  color: "#6d7175",
  lineHeight: "1.5",
};


const quickLinkArrowStyle = {
  marginLeft: "auto",
  fontSize: "18px",
  color: "#6d7175",
};


const applicationsListStyle = {
  borderTop: "1px solid #e1e3e5",
};


const applicationRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "20px",
  padding: "16px 4px",
  borderBottom: "1px solid #e1e3e5",
  textDecoration: "none",
  color: "#202223",
};


const applicationNameStyle = {
  fontSize: "14px",
  fontWeight: "600",
};


const applicationEmailStyle = {
  marginTop: "4px",
  fontSize: "12px",
  color: "#6d7175",
};


const applicationDateStyle = {
  fontSize: "12px",
  color: "#6d7175",
  whiteSpace: "nowrap",
};


const emptyStateStyle = {
  padding: "30px",
  textAlign: "center",
  color: "#6d7175",
  background: "#f6f6f7",
  borderRadius: "8px",
};


const managementGridStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "14px",
  marginTop: "18px",
};


const managementItemStyle = {
  padding: "20px",
  border: "1px solid #e1e3e5",
  borderRadius: "10px",
  textDecoration: "none",
  color: "#202223",
};


const managementItemTitleStyle = {
  fontSize: "15px",
  fontWeight: "650",
  marginBottom: "7px",
};


const managementItemDescriptionStyle = {
  fontSize: "13px",
  color: "#6d7175",
  lineHeight: "1.5",
};


const managementItemArrowStyle = {
  marginTop: "16px",
  fontSize: "13px",
  fontWeight: "600",
};