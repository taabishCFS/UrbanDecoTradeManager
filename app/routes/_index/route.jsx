import {
  redirect,
  useLoaderData,
} from "react-router";

import { authenticate, login } from "./shopify.server";
import prisma from "./db.server";

import styles from "./styles.module.css";

/* ============================================================
   LOADER
============================================================ */

export async function loader({ request }) {
  const url = new URL(request.url);

  /*
   * ----------------------------------------------------------
   * Shopify login redirect
   * ----------------------------------------------------------
   */

  if (url.searchParams.get("shop")) {
    throw redirect(
      `/app?${url.searchParams.toString()}`
    );
  }

  /*
   * ----------------------------------------------------------
   * If login is not available
   * ----------------------------------------------------------
   */

  if (!login) {
    return {
      showForm: false,
      dashboard: null,
    };
  }

  /*
   * ----------------------------------------------------------
   * Authenticate Shopify admin
   * ----------------------------------------------------------
   */

  const { session } =
    await authenticate.admin(request);

  /*
   * ----------------------------------------------------------
   * TRADE APPLICATIONS
   * ----------------------------------------------------------
   */

  const totalApplications =
    await prisma.tradeApplication.count();

  const pendingApplications =
    await prisma.tradeApplication.count({
      where: {
        status: "PENDING",
      },
    });

  /*
   * ----------------------------------------------------------
   * TRADE ACCOUNTS
   * ----------------------------------------------------------
   */

  const totalTradeAccounts =
    await prisma.tradeAccount.count();

  const activeTradeAccounts =
    await prisma.tradeAccount.count({
      where: {
        status: "ACTIVE",
      },
    });

  /*
   * ----------------------------------------------------------
   * COMMISSIONS
   * ----------------------------------------------------------
   */

  const commissionTotals =
    await prisma.commission.aggregate({
      _sum: {
        commissionAmount: true,
      },
    });

  const pendingCommissionTotals =
    await prisma.commission.aggregate({
      _sum: {
        commissionAmount: true,
      },

      where: {
        status: "PENDING",
      },
    });

  /*
   * ----------------------------------------------------------
   * RECENT APPLICATIONS
   * ----------------------------------------------------------
   */

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
        status: true,
        createdAt: true,
      },
    });

  /*
   * ----------------------------------------------------------
   * RETURN DASHBOARD DATA
   * ----------------------------------------------------------
   */

  return {
    showForm: true,

    dashboard: {
      totalApplications,
      pendingApplications,

      totalTradeAccounts,
      activeTradeAccounts,

      totalCommission:
        Number(
          commissionTotals._sum.commissionAmount || 0
        ),

      pendingCommission:
        Number(
          pendingCommissionTotals._sum.commissionAmount || 0
        ),

      recentApplications,
    },

    shop: session?.shop || null,
  };
}

/* ============================================================
   COMPONENT
============================================================ */

export default function App() {
  const {
    showForm,
    dashboard,
  } = useLoaderData();

  /*
   * ----------------------------------------------------------
   * LOGIN SCREEN
   * ----------------------------------------------------------
   */

  if (!dashboard) {
    return (
      <div className={styles.loginPage}>
        <div className={styles.loginCard}>
          <h1>Urban Deco Trade Manager</h1>

          <p>
            Manage trade applications, trade accounts
            and commissions from one place.
          </p>

          {showForm && (
            <form
              method="post"
              action="/auth/login"
              className={styles.loginForm}
            >
              <label>
                <span>Shop domain</span>

                <input
                  type="text"
                  name="shop"
                  placeholder="urban-deco.myshopify.com"
                />
              </label>

              <button type="submit">
                Log in
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const {
    totalApplications,
    pendingApplications,

    totalTradeAccounts,
    activeTradeAccounts,

    totalCommission,
    pendingCommission,

    recentApplications,
  } = dashboard;

  return (
    <div className={styles.dashboard}>
      {/* =====================================================
          HEADER
      ===================================================== */}

      <div className={styles.header}>
        <div>
          <h1>
            Trade Manager
          </h1>

          <p>
            Manage your trade accounts, applications
            and commissions.
          </p>
        </div>
      </div>

      {/* =====================================================
          SUMMARY CARDS
      ===================================================== */}

      <div className={styles.statsGrid}>

        {/* APPLICATIONS */}

        <a
          href="/app/trade-applications"
          className={styles.statCard}
        >
          <div className={styles.statTop}>
            <span className={styles.statLabel}>
              Trade Applications
            </span>

            <span className={styles.statIcon}>
              👤
            </span>
          </div>

          <div className={styles.statNumber}>
            {totalApplications}
          </div>

          <div className={styles.statFooter}>
            {pendingApplications} pending
          </div>
        </a>

        {/* TRADE ACCOUNTS */}

        <a
          href="/app/trade-accounts"
          className={styles.statCard}
        >
          <div className={styles.statTop}>
            <span className={styles.statLabel}>
              Trade Accounts
            </span>

            <span className={styles.statIcon}>
              🏢
            </span>
          </div>

          <div className={styles.statNumber}>
            {totalTradeAccounts}
          </div>

          <div className={styles.statFooter}>
            {activeTradeAccounts} active
          </div>
        </a>

        {/* TOTAL COMMISSION */}

        <a
          href="/app/commissions"
          className={styles.statCard}
        >
          <div className={styles.statTop}>
            <span className={styles.statLabel}>
              Total Commission
            </span>

            <span className={styles.statIcon}>
              £
            </span>
          </div>

          <div className={styles.statNumber}>
            £{totalCommission.toFixed(2)}
          </div>

          <div className={styles.statFooter}>
            All commissions
          </div>
        </a>

        {/* PENDING COMMISSION */}

        <a
          href="/app/commissions"
          className={styles.statCard}
        >
          <div className={styles.statTop}>
            <span className={styles.statLabel}>
              Pending Commission
            </span>

            <span className={styles.statIcon}>
              ⏳
            </span>
          </div>

          <div className={styles.statNumber}>
            £{pendingCommission.toFixed(2)}
          </div>

          <div className={styles.statFooter}>
            Awaiting action
          </div>
        </a>

      </div>

      {/* =====================================================
          QUICK ACTIONS
      ===================================================== */}

      <div className={styles.section}>

        <div className={styles.sectionHeader}>
          <div>
            <h2>
              Manage Trade Accounts
            </h2>

            <p>
              Quickly access the main areas of your
              Trade Manager.
            </p>
          </div>
        </div>

        <div className={styles.actionGrid}>

          <a
            href="/app/trade-applications"
            className={styles.actionCard}
          >
            <div className={styles.actionIcon}>
              👤
            </div>

            <div>
              <h3>
                Trade Applications
              </h3>

              <p>
                Review and manage incoming trade
                applications.
              </p>
            </div>

            <span className={styles.arrow}>
              →
            </span>
          </a>

          <a
            href="/app/trade-accounts"
            className={styles.actionCard}
          >
            <div className={styles.actionIcon}>
              🏢
            </div>

            <div>
              <h3>
                Trade Accounts
              </h3>

              <p>
                Manage approved trade customers and
                their pricing.
              </p>
            </div>

            <span className={styles.arrow}>
              →
            </span>
          </a>

          <a
            href="/app/commissions"
            className={styles.actionCard}
          >
            <div className={styles.actionIcon}>
              £
            </div>

            <div>
              <h3>
                Commissions
              </h3>

              <p>
                View, approve and manage designer
                commissions.
              </p>
            </div>

            <span className={styles.arrow}>
              →
            </span>
          </a>

        </div>
      </div>

      {/* =====================================================
          RECENT APPLICATIONS
      ===================================================== */}

      <div className={styles.section}>

        <div className={styles.sectionHeader}>
          <div>
            <h2>
              Recent Applications
            </h2>

            <p>
              The latest trade applications received.
            </p>
          </div>

          <a
            href="/app/trade-applications"
            className={styles.viewAll}
          >
            View all →
          </a>
        </div>

        <div className={styles.tableCard}>

          {recentApplications.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>
                👤
              </div>

              <h3>
                No applications yet
              </h3>

              <p>
                New trade applications will appear here.
              </p>
            </div>
          ) : (
            <div className={styles.tableWrapper}>

              <table className={styles.table}>

                <thead>
                  <tr>
                    <th>
                      Applicant
                    </th>

                    <th>
                      Business
                    </th>

                    <th>
                      Email
                    </th>

                    <th>
                      Status
                    </th>

                    <th>
                      Date
                    </th>
                  </tr>
                </thead>

                <tbody>

                  {recentApplications.map(
                    (application) => (
                      <tr key={application.id}>

                        <td>
                          <strong>
                            {application.firstName}{" "}
                            {application.lastName}
                          </strong>
                        </td>

                        <td>
                          {application.businessName}
                        </td>

                        <td>
                          {application.email}
                        </td>

                        <td>
                          <span
                            className={`${styles.status} ${
                              styles[
                                application.status.toLowerCase()
                              ]
                            }`}
                          >
                            {application.status}
                          </span>
                        </td>

                        <td>
                          {new Date(
                            application.createdAt
                          ).toLocaleDateString(
                            "en-GB"
                          )}
                        </td>

                      </tr>
                    )
                  )}

                </tbody>

              </table>

            </div>
          )}

        </div>

      </div>

    </div>
  );
}