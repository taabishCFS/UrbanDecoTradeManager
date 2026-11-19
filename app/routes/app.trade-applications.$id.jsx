
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

import {
  sendTradeRejectionEmail,
} from "../services/email.server";

import {
  approveApplication,
  deleteShopifyCustomer,
} from "../services/approve-application.server";



/**
 * ============================================================
 * LOADER
 * ============================================================
 */
export async function loader({
  request,
  params,
}) {
  /**
   * ----------------------------------------------------------
   * Authenticate Shopify Admin request
   * ----------------------------------------------------------
   */
  await authenticate.admin(request);

  console.log(
    "================================="
  );

  console.log(
    "TRADE APPLICATION DETAIL LOADER"
  );

  console.log(
    "APPLICATION ID:",
    params.id
  );

  console.log(
    "================================="
  );

  /**
   * ----------------------------------------------------------
   * Get application
   * ----------------------------------------------------------
   */
  const application =
    await prisma.tradeApplication.findUnique({
      where: {
        id: params.id,
      },
    });

  if (!application) {
    console.error(
      "TRADE APPLICATION NOT FOUND:",
      params.id
    );

    throw new Response(
      "Trade application not found",
      {
        status: 404,
      }
    );
  }

  console.log(
    "APPLICATION FOUND:",
    application.id
  );

  /**
   * ----------------------------------------------------------
   * Get trade account
   * ----------------------------------------------------------
   */
  const tradeAccount =
    await prisma.tradeAccount.findUnique({
      where: {
        applicationId:
          application.id,
      },
    });

  console.log(
    "TRADE ACCOUNT:",
    tradeAccount?.id || "NONE"
  );
/**
   * ----------------------------------------------------------
   * Serialise Decimal fields
   * ----------------------------------------------------------
   *
   * IMPORTANT:
   *
   * Prisma returns discountPercent / commissionPercent as
   * Decimal instances, not plain numbers. React Router's
   * loader data transport does not know how to serialise a
   * Decimal instance - it walks its internal properties
   * instead of calling toString() on it, so the page ends up
   * doing Number(<mangled object>), which is NaN.
   *
   * Convert to plain numbers here, before the data leaves
   * the loader.
   * ----------------------------------------------------------
   */
  const formattedTradeAccount =
    tradeAccount
      ? {
          ...tradeAccount,

          discountPercent:
            Number(
              tradeAccount.discountPercent
            ),

          commissionPercent:
            Number(
              tradeAccount.commissionPercent
            ),

          allocationPercent:
            Number(
              tradeAccount.allocationPercent
            ),
        }
      : null;

  return {
    application,
     tradeAccount:
      formattedTradeAccount,
  };
}

/**
 * ============================================================
 * ACTION
 * ============================================================
 */
export async function action({
  request,
  params,
}) {
  try {
    /**
     * --------------------------------------------------------
     * Authenticate Shopify Admin request
     * --------------------------------------------------------
     */
    const { admin } =
      await authenticate.admin(request);

    const formData =
      await request.formData();

    const actionType =
      formData
        .get("action")
        ?.toString();

    console.log(
      "================================="
    );

    console.log(
      "TRADE APPLICATION ACTION"
    );

    console.log(
      "APPLICATION ID:",
      params.id
    );

    console.log(
      "ACTION:",
      actionType
    );

    console.log(
      "================================="
    );

    /**
     * --------------------------------------------------------
     * Get application
     * --------------------------------------------------------
     */
    const application =
      await prisma.tradeApplication.findUnique({
        where: {
          id: params.id,
        },
      });

    if (!application) {
      return Response.json(
        {
          success: false,

          message:
            "Trade application not found.",
        },
        {
          status: 404,
        }
      );
    }
    /**
 * ========================================================
 * DELETE CUSTOMER
 * ========================================================
 *
 * Deletes:
 *
 * 1. Shopify Customer
 * 2. Prisma Trade Account
 *
 * The Trade Application itself is NOT deleted.
 *
 * This preserves the application history.
 */
if (actionType === "deleteCustomer") {
  /**
   * ------------------------------------------------------
   * Make sure application is approved
   * ------------------------------------------------------
   */
  if (application.status !== "APPROVED") {
    return Response.json(
      {
        success: false,
        message:
          "Only an approved trade application can have its customer deleted.",
      },
      {
        status: 400,
      }
    );
  }

  /**
   * ------------------------------------------------------
   * Find Trade Account
   * ------------------------------------------------------
   */
  const tradeAccount =
    await prisma.tradeAccount.findUnique({
      where: {
        applicationId: application.id,
      },
    });

  if (!tradeAccount) {
    return Response.json(
      {
        success: false,
        message:
          "No trade account exists for this application.",
      },
      {
        status: 404,
      }
    );
  }

  /**
   * ------------------------------------------------------
   * Make sure Shopify Customer ID exists
   * ------------------------------------------------------
   */
  if (!tradeAccount.shopifyCustomerId) {
    return Response.json(
      {
        success: false,
        message:
          "No Shopify customer ID is associated with this trade account.",
      },
      {
        status: 400,
      }
    );
  }

  console.log(
    "================================="
  );

  console.log(
    "ADMIN CUSTOMER DELETE REQUEST"
  );

  console.log(
    "APPLICATION ID:",
    application.id
  );

  console.log(
    "TRADE ACCOUNT ID:",
    tradeAccount.id
  );

  console.log(
    "SHOPIFY CUSTOMER ID:",
    tradeAccount.shopifyCustomerId
  );

  console.log(
    "================================="
  );

  /**
   * ------------------------------------------------------
   * DELETE SHOPIFY CUSTOMER
   * ------------------------------------------------------
   *
   * We MUST successfully delete the Shopify customer
   * before deleting the local Trade Account.
   */
  const deleted =
    await deleteShopifyCustomer(
      admin,
      tradeAccount.shopifyCustomerId
    );

  /**
   * ------------------------------------------------------
   * Shopify deletion failed
   * ------------------------------------------------------
   */
  if (!deleted) {
    return Response.json(
      {
        success: false,
        message:
          "Shopify customer could not be deleted. The trade account has NOT been deleted.",
      },
      {
        status: 500,
      }
    );
  }

  /**
   * ------------------------------------------------------
   * Shopify deletion succeeded
   *
   * Now delete the local Trade Account.
   *
   * IMPORTANT:
   *
   * Per the Prisma schema, Referral and Commission do NOT
   * cascade from TradeAccount (no onDelete: Cascade on
   * those relations), so tradeAccount.delete() alone will
   * throw a foreign key constraint error if either exists
   * for this account. ClientSpecialOffer DOES cascade, so
   * it does not need to be deleted manually here.
   *
   * Deleting a Commission automatically cascades its
   * CommissionAdjustment rows (onDelete: Cascade), so those
   * do not need to be deleted manually either.
   * ------------------------------------------------------
   */
  try {
    await prisma.$transaction([

      prisma.commission.deleteMany({
        where: {
          tradeAccountId:
            tradeAccount.id,
        },
      }),

      prisma.referral.deleteMany({
        where: {
          tradeAccountId:
            tradeAccount.id,
        },
      }),

      prisma.tradeAccount.delete({
        where: {
          id: tradeAccount.id,
        },
      }),

    ]);

    console.log(
      "TRADE ACCOUNT DELETED:",
      tradeAccount.id
    );

    /**
     * ------------------------------------------------------
     * IMPORTANT
     *
     * We intentionally DO NOT delete the application.
     *
     * The application remains as historical record.
     * ------------------------------------------------------
     */
    return Response.json({
      success: true,

      action: "deleteCustomer",

      message:
        "Shopify customer and trade account deleted successfully.",

      applicationId:
        application.id,

      shopifyCustomerId:
        tradeAccount.shopifyCustomerId,

      tradeAccountId:
        tradeAccount.id,
    });
  } catch (databaseError) {
    /**
     * ------------------------------------------------------
     * IMPORTANT EDGE CASE
     * ------------------------------------------------------
     *
     * Shopify customer has already been deleted.
     *
     * Prisma deletion failed.
     *
     * We cannot recreate the Shopify customer automatically.
     *
     * Therefore clearly report the situation.
     */
    console.error(
      "================================="
    );

    console.error(
      "TRADE ACCOUNT DELETE FAILED AFTER SHOPIFY CUSTOMER DELETE"
    );

    console.error(
      databaseError
    );

    console.error(
      "TRADE ACCOUNT ID:",
      tradeAccount.id
    );

    console.error(
      "SHOPIFY CUSTOMER ID:",
      tradeAccount.shopifyCustomerId
    );

    console.error(
      "================================="
    );

    return Response.json(
      {
        success: false,

        message:
          "The Shopify customer was deleted, but the local trade account could not be deleted. Check the server logs.",

        applicationId:
          application.id,

        shopifyCustomerId:
          tradeAccount.shopifyCustomerId,

        tradeAccountId:
          tradeAccount.id,
      },
      {
        status: 500,
      }
    );
  }
}

    /**
     * ========================================================
     * REJECT APPLICATION
     * ========================================================
     */
    if (actionType === "reject") {
      const rejectionReason =
        formData
          .get("rejectionReason")
          ?.toString()
          .trim() || null;

      const rejectedApplication =
        await prisma.tradeApplication.update({
          where: {
            id: application.id,
          },

          data: {
            status: "REJECTED",

            rejectedAt:
              new Date(),

            rejectionReason,
          },
        });

      console.log(
        "APPLICATION REJECTED:",
        rejectedApplication.id
      );
      /* ============================================================
   SEND REJECTION EMAIL
============================================================ */

try {

  const emailResult =
    await sendTradeRejectionEmail(
      rejectedApplication,
      rejectionReason
    );

  console.log(
    "TRADE REJECTION EMAIL RESULT:",
    emailResult
  );

} catch (emailError) {

  console.error(
    "TRADE REJECTION EMAIL FAILED:",
    emailError
  );

}



      return Response.json({
        success: true,

        action: "reject",

        message:
          "Trade application rejected successfully.",
      });
    }

    /**
     * ========================================================
     * APPROVE APPLICATION
     * ========================================================
     */
    if (actionType === "approve") {
      const result = await approveApplication({
        admin,
        application,
      });

      return Response.json(result.body, {
        status: result.status,
      });
    }

    
    /**
     * ========================================================
     * UNKNOWN ACTION
     * ========================================================
     */
    return Response.json(
      {
        success: false,

        message:
          "Invalid action.",
      },
      {
        status: 400,
      }
    );
  } catch (error) {
    console.error(
      "================================="
    );

    console.error(
      "TRADE APPLICATION ACTION ERROR"
    );

    console.error(error);

    console.error(
      "================================="
    );

    return Response.json(
      {
        success: false,

        message:
          error?.message ||
          "Something went wrong while processing the application.",
      },
      {
        status: 500,
      }
    );
  }
}

/**
 * ============================================================
 * PAGE
 * ============================================================
 */
export default function TradeApplicationDetail() {
  const {
    application,
    tradeAccount,
  } = useLoaderData();

  const actionData =
    useActionData();

  const navigation =
    useNavigation();

  const isSubmitting =
    navigation.state ===
    "submitting";

  const isApproved =
    application.status ===
    "APPROVED";

  const isRejected =
    application.status ===
    "REJECTED";

  return (
    <div style={pageStyle}>

      {/* =====================================================
          HEADER
      ====================================================== */}

      <div style={headerStyle}>

        <div >
            <Link style={backStyle}  to="/app/trade-applications">
              ← Back to Trade Applications
            </Link >
            {" "}
            <Link
              style={backStyle}
              to={`/app/emails/${application.id}`}
            >
              Email trail
            </Link>
          </div>
        <div>
          <h1 style={titleStyle}>
            Trade Application
          </h1>

          <p style={subtitleStyle}>
            Application ID:{" "}
            {application.id}
          </p>
        </div>

        <StatusBadge
          status={
            application.status
          }
        />

      </div>

      {/* =====================================================
          ACTION RESPONSE
      ====================================================== */}

      {actionData?.message && (
        <div
          style={{
            ...messageStyle,

            ...(actionData.success
              ? successMessageStyle
              : errorMessageStyle),
          }}
        >
          {actionData.message}

          {actionData.referralCode && (
            <div
              style={{
                marginTop:
                  "8px",

                fontWeight:
                  "600",
              }}
            >
              Referral Code:{" "}
              {actionData.referralCode}
            </div>
          )}

          {actionData.rollbackSuccessful ===
            false && (
            <div
              style={{
                marginTop:
                  "10px",

                fontWeight:
                  "600",
              }}
            >
              IMPORTANT: Check the
              server console for the
              Shopify customer ID that
              could not be deleted.
            </div>
          )}
        </div>
      )}

      {/* =====================================================
          APPLICATION DETAILS
      ====================================================== */}

      <div style={gridStyle}>

        {/* PERSONAL INFORMATION */}

        <section style={cardStyle}>

          <h2 style={sectionTitleStyle}>
            Personal Information
          </h2>

          <Detail
            label="First Name"
            value={
              application.firstName
            }
          />

          <Detail
            label="Last Name"
            value={
              application.lastName
            }
          />

          <Detail
            label="Email"
            value={
              application.email
            }
          />

          <Detail
            label="Phone"
            value={
              application.phone
            }
          />

        </section>

        {/* BUSINESS INFORMATION */}

        <section style={cardStyle}>

          <h2 style={sectionTitleStyle}>
            Business Information
          </h2>

          <Detail
            label="Business Name"
            value={
              application.businessName
            }
          />
<Detail
  label="Business Type"
  value={
    application.businessType === "Other"
      ? application.businessTypeOther
      : application.businessType
  }
/>

        

          <Detail
            label="Company Registration Number"
            value={
              application.companyNumber
            }
          />

          <Detail
            label="VAT Number"
            value={
              application.vatNumber
            }
          />

          <Detail
            label="Website"
            value={
              application.website
            }
          />

          <Detail
            label="Instagram"
            value={
              application.instagram
            }
          />

        </section>

        {/* BUSINESS DETAILS */}

        <section style={cardStyle}>

          <h2 style={sectionTitleStyle}>
            Business Details
          </h2>

          <Detail
            label="Years Trading"
            value={
              application.yearsTrading
            }
          />

          <Detail
            label="Typical Project Value"
            value={
              application.typicalProjectValue
            }
          />

          <Detail
            label="Portfolio"
            value={
              application.portfolioUrl
            }
          />

          <Detail
            label="Project Information"
            value={
              application.projectInformation
            }
          />

        </section>

        {/* ADDRESS */}

        <section style={cardStyle}>

          <h2 style={sectionTitleStyle}>
            Address
          </h2>

          <Detail
            label="Address"
            value={
              application.address
            }
          />

          <Detail
            label="City"
            value={
              application.city
            }
          />

          <Detail
            label="County"
            value={
              application.county
            }
          />

          <Detail
            label="Postcode"
            value={
              application.postcode
            }
          />

          <Detail
            label="Country"
            value={
              application.country
            }
          />

        </section>

      </div>

      {/* =====================================================
          TRADE ACCOUNT
      ====================================================== */}

      {tradeAccount && (
        <section
          style={{
            ...cardStyle,
            marginTop: "20px",
          }}
        >

          <h2 style={sectionTitleStyle}>
            Trade Account
          </h2>

          <Detail
            label="Trade Account ID"
            value={
              tradeAccount.id
            }
          />

          <Detail
            label="Shopify Customer ID"
            value={
              tradeAccount.shopifyCustomerId
            }
          />

          <Detail
            label="Referral Code"
            value={
              tradeAccount.referralCode
            }
          />

          <Detail
            label="Discount"
            value={`${tradeAccount.discountPercent}%`}
          />

          <Detail
            label="Commission"
            value={`${tradeAccount.commissionPercent}%`}
          />

          <Detail
            label="Account Status"
            value={
              tradeAccount.status
            }
          />

        </section>
      )}

      {/* =====================================================
          ACTION BUTTONS
      ====================================================== */}

      {!isApproved &&
        !isRejected && (
          <div
            style={
              actionsContainerStyle
            }
          >

            {/* APPROVE */}

            <Form
              method="post"
              onSubmit={(event) => {
                const confirmed =
                  window.confirm(
                    "Are you sure you want to approve this trade application?\n\nThis will create a Shopify customer and trade account."
                  );

                if (!confirmed) {
                  event.preventDefault();
                }
              }}
            >

              <input
                type="hidden"
                name="action"
                value="approve"
              />

              <button
                type="submit"
                disabled={
                  isSubmitting
                }
                style={
                  approveButtonStyle
                }
              >
                {isSubmitting
                  ? "Processing..."
                  : "Approve Application"}
              </button>

            </Form>

            {/* REJECT */}

            <Form
              method="post"
              onSubmit={(event) => {
                const confirmed =
                  window.confirm(
                    "Are you sure you want to reject this trade application?"
                  );

                if (!confirmed) {
                  event.preventDefault();
                }
              }}
            >

              <input
                type="hidden"
                name="action"
                value="reject"
              />

              <button
                type="submit"
                disabled={
                  isSubmitting
                }
                style={
                  rejectButtonStyle
                }
              >
                {isSubmitting
                  ? "Processing..."
                  : "Reject Application"}
              </button>

            </Form>

          </div>
        )}

      {/* =====================================================
          CURRENT STATUS MESSAGE
      ====================================================== */}

     {isApproved && (
  <>
    <div
      style={{
        ...statusMessageStyle,
        ...approvedMessageStyle,
      }}
    >
      <strong>
        This application has been approved.
      </strong>

      <div
        style={{
          marginTop: "5px",
        }}
      >
        The Shopify customer and trade account
        have been created.
      </div>
    </div>

    {tradeAccount && (
      <div
        style={deleteCustomerContainerStyle}
      >
        <div>
          <strong>
            Customer Management
          </strong>

          <div
            style={deleteCustomerDescriptionStyle}
          >
            Delete the Shopify customer and
            associated trade account.
            The application record will be
            retained.
          </div>
        </div>

        <Form
          method="post"
          onSubmit={(event) => {
            const confirmed =
              window.confirm(
                "WARNING: This will permanently delete the Shopify customer and the associated trade account.\n\nThe trade application record will be kept for history.\n\nAre you absolutely sure you want to continue?"
              );

            if (!confirmed) {
              event.preventDefault();
            }
          }}
        >
          <input
            type="hidden"
            name="action"
            value="deleteCustomer"
          />

          <button
            type="submit"
            disabled={isSubmitting}
            style={deleteCustomerButtonStyle}
          >
            {isSubmitting
              ? "Deleting..."
              : "Delete Customer"}
          </button>
        </Form>
      </div>
    )}
  </>
)}

      {isRejected && (
        <div
          style={{
            ...statusMessageStyle,
            ...rejectedMessageStyle,
          }}
        >
          <strong>
            This application has been rejected.
          </strong>

          {application.rejectionReason && (
            <div
              style={{
                marginTop:
                  "5px",
              }}
            >
              Reason:{" "}
              {application.rejectionReason}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

/**
 * ============================================================
 * DETAIL COMPONENT
 * ============================================================
 */

function Detail({
  label,
  value,
}) {
  return (
    <div
      style={
        detailRowStyle
      }
    >
      <div
        style={
          detailLabelStyle
        }
      >
        {label}
      </div>

      <div
        style={
          detailValueStyle
        }
      >
        {value || "—"}
      </div>
    </div>
  );
}

/**
 * ============================================================
 * STATUS BADGE
 * ============================================================
 */

function StatusBadge({
  status,
}) {
  const styles = {
    PENDING: {
      background:
        "#fff3cd",
      color:
        "#856404",
    },

    APPROVED: {
      background:
        "#d1e7dd",
      color:
        "#0f5132",
    },

    REJECTED: {
      background:
        "#f8d7da",
      color:
        "#842029",
    },
  };

  const currentStyle =
    styles[status] || {
      background:
        "#e9ecef",

      color:
        "#495057",
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

/**
 * ============================================================
 * STYLES
 * ============================================================
 */

const pageStyle = {
  padding: "30px",

  maxWidth:
    "1200px",

  margin:
    "0 auto",
};

const headerStyle = {
  display:
    "flex",

  justifyContent:
    "space-between",

  alignItems:
    "flex-start",

  marginBottom:
    "30px",
};

const backStyle = {
  marginBottom: "20px",
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 14px",
  fontSize: "14px",
  fontWeight: "500",
  color: "#4A4A4A",
  backgroundColor: "#F6F6F6",
  border: "1px solid #E1E1E1",
  borderRadius: "6px",
  textDecoration: "none",
  cursor: "pointer",
};
const titleStyle = {
  margin: 0,

  fontSize:
    "28px",
};

const subtitleStyle = {
  marginTop:
    "8px",

  color:
    "#666",
};

const gridStyle = {
  display:
    "grid",

  gridTemplateColumns:
    "repeat(auto-fit, minmax(400px, 1fr))",

  gap:
    "20px",
};

const cardStyle = {
  background:
    "#fff",

  border:
    "1px solid #e5e5e5",

  borderRadius:
    "8px",

  padding:
    "24px",
};

const sectionTitleStyle = {
  marginTop: 0,

  marginBottom:
    "20px",

  fontSize:
    "18px",

  borderBottom:
    "1px solid #eee",

  paddingBottom:
    "12px",
};

const detailRowStyle = {
  display:
    "grid",

  gridTemplateColumns:
    "180px 1fr",

  gap:
    "15px",

  padding:
    "10px 0",

  borderBottom:
    "1px solid #f1f1f1",
};

const detailLabelStyle = {
  fontWeight:
    "600",

  color:
    "#666",

  fontSize:
    "13px",
};

const detailValueStyle = {
  color:
    "#222",

  fontSize:
    "14px",

  wordBreak:
    "break-word",
};

const badgeStyle = {
  display:
    "inline-block",

  padding:
    "7px 12px",

  borderRadius:
    "6px",

  fontSize:
    "13px",

  fontWeight:
    "600",
};

const messageStyle = {
  padding:
    "15px 18px",

  borderRadius:
    "6px",

  marginBottom:
    "20px",

  fontSize:
    "14px",
};

const successMessageStyle = {
  background:
    "#d1e7dd",

  color:
    "#0f5132",

  border:
    "1px solid #badbcc",
};

const errorMessageStyle = {
  background:
    "#f8d7da",

  color:
    "#842029",

  border:
    "1px solid #f5c2c7",
};

const actionsContainerStyle = {
  display:
    "flex",

  gap:
    "12px",

  marginTop:
    "30px",

  paddingTop:
    "20px",

  borderTop:
    "1px solid #e5e5e5",
};

const approveButtonStyle = {
  padding:
    "11px 20px",

  background:
    "#198754",

  color:
    "#fff",

  border:
    "none",

  borderRadius:
    "6px",

  cursor:
    "pointer",

  fontSize:
    "14px",

  fontWeight:
    "600",
};

const rejectButtonStyle = {
  padding:
    "11px 20px",

  background:
    "#dc3545",

  color:
    "#fff",

  border:
    "none",

  borderRadius:
    "6px",

  cursor:
    "pointer",

  fontSize:
    "14px",

  fontWeight:
    "600",
};

const statusMessageStyle = {
  marginTop:
    "30px",

  padding:
    "18px",

  borderRadius:
    "6px",
};

const approvedMessageStyle = {
  background:
    "#d1e7dd",

  color:
    "#0f5132",

  border:
    "1px solid #badbcc",
};

const rejectedMessageStyle = {
  background:
    "#f8d7da",

  color:
    "#842029",

  border:
    "1px solid #f5c2c7",
};
const deleteCustomerContainerStyle = {
  marginTop: "20px",
  padding: "20px",
  border: "1px solid #f5c2c7",
  borderRadius: "8px",
  background: "#fff5f5",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "20px",
};

const deleteCustomerDescriptionStyle = {
  marginTop: "6px",
  color: "#666",
  fontSize: "13px",
};

const deleteCustomerButtonStyle = {
  padding: "11px 20px",
  background: "#dc3545",
  color: "#fff",
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: "600",
  whiteSpace: "nowrap",
};

/**
 * ============================================================
 * ERROR BOUNDARY
 * ============================================================
 */

export function ErrorBoundary() {
  return boundary.error(
    useRouteError()
  );
}

/**
 * ============================================================
 * HEADERS
 * ============================================================
 */

export const headers = (
  headersArgs
) => {
  return boundary.headers(
    headersArgs
  );
};
