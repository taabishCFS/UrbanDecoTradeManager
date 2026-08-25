import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }) {
  await authenticate.admin(request);

  const [
    applicationsCount,
    tradeAccountsCount,
    commissionResult,
  ] = await Promise.all([
    // ============================================================
    // TOTAL TRADE APPLICATIONS
    // ============================================================
    prisma.tradeApplication.count(),

    // ============================================================
    // TOTAL TRADE ACCOUNTS
    // ============================================================
    prisma.tradeAccount.count(),

    // ============================================================
    // TOTAL COMMISSION
    // ============================================================
    prisma.commission.aggregate({
      _sum: {
        commissionAmount: true,
      },
    }),
  ]);

  const totalCommission =
    commissionResult._sum.commissionAmount
      ? Number(commissionResult._sum.commissionAmount)
      : 0;

  return {
    applicationsCount,
    tradeAccountsCount,
    totalCommission,
  };
}

export default function Index() {
  const {
    applicationsCount,
    tradeAccountsCount,
    totalCommission,
  } = useLoaderData();

  return (
    <s-page heading="Trade Manager">

      {/* ============================================================
          WELCOME
      ============================================================ */}

      <s-section>
        <s-stack direction="block" gap="base">

          <s-heading>
            Trade Manager Dashboard
          </s-heading>

          <s-paragraph>
            Manage your trade applications, trade accounts and
            commissions from one place.
          </s-paragraph>

        </s-stack>
      </s-section>


      {/* ============================================================
          STATISTICS
      ============================================================ */}

      <s-section heading="Overview">

        <s-grid
          gridTemplateColumns="repeat(3, 1fr)"
          gap="base"
        >

          {/* ========================================================
              APPLICATIONS
          ======================================================== */}

          <s-box
            padding="large"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >

            <s-stack direction="block" gap="small">

              <s-text>
                Trade Applications
              </s-text>

              <s-heading>
                {applicationsCount}
              </s-heading>

              <s-text>
                Applications received
              </s-text>

              <s-link href="/app/trade-applications">
                View applications →
              </s-link>

            </s-stack>

          </s-box>


          {/* ========================================================
              TRADE ACCOUNTS
          ======================================================== */}

          <s-box
            padding="large"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >

            <s-stack direction="block" gap="small">

              <s-text>
                Trade Accounts
              </s-text>

              <s-heading>
                {tradeAccountsCount}
              </s-heading>

              <s-text>
                Active trade accounts
              </s-text>

              <s-link href="/app/trade-accounts">
                View trade accounts →
              </s-link>

            </s-stack>

          </s-box>


          {/* ========================================================
              COMMISSION
          ======================================================== */}

          <s-box
            padding="large"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >

            <s-stack direction="block" gap="small">

              <s-text>
                Total Commission
              </s-text>

              <s-heading>
                £{totalCommission.toFixed(2)}
              </s-heading>

              <s-text>
                Commission generated
              </s-text>

              <s-link href="/app/commissions">
                View commissions →
              </s-link>

            </s-stack>

          </s-box>

        </s-grid>

      </s-section>


      {/* ============================================================
          QUICK ACTIONS
      ============================================================ */}

      <s-section heading="Quick access">

        <s-stack direction="inline" gap="base">

          <s-button
            href="/app/trade-applications"
            variant="primary"
          >
            Trade Applications
          </s-button>

          <s-button
            href="/app/trade-accounts"
            variant="secondary"
          >
            Trade Accounts
          </s-button>

          <s-button
            href="/app/commissions"
            variant="secondary"
          >
            Commissions
          </s-button>

        </s-stack>

      </s-section>


      {/* ============================================================
          INFORMATION
      ============================================================ */}

      <s-section
        slot="aside"
        heading="Trade Manager"
      >

        <s-stack direction="block" gap="base">

          <s-paragraph>
            Use Trade Applications to review new trade account
            requests.
          </s-paragraph>

          <s-paragraph>
            Use Trade Accounts to manage approved designers and
            their trade pricing.
          </s-paragraph>

          <s-paragraph>
            Use Commissions to review and manage commission
            payments.
          </s-paragraph>

        </s-stack>

      </s-section>

    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};