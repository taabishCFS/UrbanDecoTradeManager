import {
  Form,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useState } from "react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * ============================================================
 * COMMISSION LEDGER
 * ============================================================
 *
 * Workflow:
 *
 * PENDING
 *    ↓
 * APPROVED
 *    ↓
 * PAID
 *
 * CANCELLED cannot be approved or paid.
 *
 * PAID cannot be changed through this workflow.
 * ============================================================
 */

/**
 * ============================================================
 * LOADER
 * ============================================================
 */

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);

  const status = url.searchParams.get("status") || "ALL";

  const search = url.searchParams.get("search")?.trim() || "";

  const where = {};

  /*
   * ------------------------------------------------------------
   * STATUS FILTER
   * ------------------------------------------------------------
   */

  if (status && status !== "ALL") {
    where.status = status;
  }

  /*
   * ------------------------------------------------------------
   * SEARCH
   * ------------------------------------------------------------
   */

  if (search) {
    where.OR = [
      {
        orderNumber: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        shopifyOrderId: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        tradeAccount: {
          businessName: {
            contains: search,
            mode: "insensitive",
          },
        },
      },
      {
        tradeAccount: {
          email: {
            contains: search,
            mode: "insensitive",
          },
        },
      },
    ];
  }

  /*
   * ------------------------------------------------------------
   * FETCH COMMISSIONS
   * ------------------------------------------------------------
   */

  const commissions = await prisma.commission.findMany({
    where,
    include: {
      tradeAccount: true,
      clientSpecialOffer: true,
      referral: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  /*
   * ------------------------------------------------------------
   * SUMMARY
   * ------------------------------------------------------------
   */

  const summaryRows = await prisma.commission.findMany({
    select: {
      status: true,
      commissionAmount: true,
    },
  });

  let pendingAmount = 0;
  let approvedAmount = 0;
  let paidAmount = 0;
  let cancelledAmount = 0;

  let pendingCount = 0;
  let approvedCount = 0;
  let paidCount = 0;
  let cancelledCount = 0;

  let totalCount = 0;
  let totalAmount = 0;

  for (const commission of summaryRows) {
    const amount = Number(commission.commissionAmount) || 0;

    totalCount++;
    totalAmount += amount;

    if (commission.status === "PENDING") {
      pendingAmount += amount;
      pendingCount++;
    }

    if (commission.status === "APPROVED") {
      approvedAmount += amount;
      approvedCount++;
    }

    if (commission.status === "PAID") {
      paidAmount += amount;
      paidCount++;
    }

    if (commission.status === "CANCELLED") {
      cancelledAmount += amount;
      cancelledCount++;
    }
  }

  /*
   * ------------------------------------------------------------
   * SERIALISE DECIMAL VALUES
   * ------------------------------------------------------------
   */

  const formattedCommissions = commissions.map((commission) => ({
    id: commission.id,
    tradeAccountId: commission.tradeAccountId,
    shopifyOrderId: commission.shopifyOrderId,
    orderNumber: commission.orderNumber,
    orderTotal: Number(commission.orderTotal),
    eligibleAmount: Number(commission.eligibleAmount),
    commissionRate: Number(commission.commissionRate),
    commissionAmount: Number(commission.commissionAmount),
    status: commission.status,
    createdAt: commission.createdAt,
    approvedAt: commission.approvedAt,
    paidAt: commission.paidAt,
    transactionReference: commission.transactionReference || null,
    tradeAccount: commission.tradeAccount
      ? {
          id: commission.tradeAccount.id,
          businessName: commission.tradeAccount.businessName,
          email: commission.tradeAccount.email,
          pricingOption: commission.tradeAccount.pricingOption,
        }
      : null,
    clientSpecialOffer: commission.clientSpecialOffer
      ? {
          id: commission.clientSpecialOffer.id,
          discountCode: commission.clientSpecialOffer.discountCode,
          clientDiscountPercent: Number(
            commission.clientSpecialOffer.clientDiscountPercent
          ),
          commissionPercent: Number(
            commission.clientSpecialOffer.commissionPercent
          ),
          allocationPercent: Number(
            commission.clientSpecialOffer.allocationPercent
          ),
        }
      : null,
    referral: commission.referral
      ? {
          id: commission.referral.id,
          referralCode: commission.referral.referralCode,
        }
      : null,
  }));

  /*
   * ------------------------------------------------------------
   * RETURN
   * ------------------------------------------------------------
   */

  return {
    commissions: formattedCommissions,
    filters: {
      status,
      search,
    },
    summary: {
      totalCount,
      totalAmount: Number(totalAmount.toFixed(2)),
      pendingAmount: Number(pendingAmount.toFixed(2)),
      approvedAmount: Number(approvedAmount.toFixed(2)),
      paidAmount: Number(paidAmount.toFixed(2)),
      cancelledAmount: Number(cancelledAmount.toFixed(2)),
      pendingCount,
      approvedCount,
      paidCount,
      cancelledCount,
    },
  };
};

/**
 * ============================================================
 * ACTION
 * ============================================================
 *
 * Supported actions:
 *
 * approve
 * pay
 *
 * ============================================================
 */

export const action = async ({ request }) => {
  await authenticate.admin(request);

  const formData = await request.formData();

  const intent = formData.get("intent");

  const commissionId = formData.get("commissionId");

  /*
   * ------------------------------------------------------------
   * VALIDATE
   * ------------------------------------------------------------
   */

  if (!commissionId || typeof commissionId !== "string") {
    return {
      success: false,
      error: "Commission ID is required.",
    };
  }

  if (intent !== "approve" && intent !== "pay") {
    return {
      success: false,
      error: "Invalid commission action.",
    };
  }

  /*
   * ------------------------------------------------------------
   * FIND COMMISSION
   * ------------------------------------------------------------
   */

  const commission = await prisma.commission.findUnique({
    where: { id: commissionId },
    include: {
      tradeAccount: true,
      clientSpecialOffer: true,
    },
  });

  if (!commission) {
    return {
      success: false,
      error: "Commission record not found.",
    };
  }

  /*
   * ------------------------------------------------------------
   * APPROVE
   * ------------------------------------------------------------
   */

  if (intent === "approve") {
    if (commission.status !== "PENDING") {
      return {
        success: false,
        error: `Commission cannot be approved because its current status is ${commission.status}.`,
      };
    }

    if (Number(commission.commissionAmount) <= 0) {
      return {
        success: false,
        error: "A commission of £0.00 cannot be approved.",
      };
    }

    const transactionReference =
      formData.get("transactionReference")?.toString().trim() || null;

    const updated = await prisma.commission.update({
      where: { id: commission.id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        transactionReference: transactionReference,
      },
    });

    console.log("=================================");
    console.log("COMMISSION APPROVED");
    console.log("=================================");
    console.log({
      commissionId: updated.id,
      tradeAccountId: updated.tradeAccountId,
      shopifyOrderId: updated.shopifyOrderId,
      orderNumber: updated.orderNumber,
      commissionAmount: Number(updated.commissionAmount),
      transactionReference: updated.transactionReference,
      status: updated.status,
      approvedAt: updated.approvedAt,
    });
    console.log("=================================");

    return {
      success: true,
      action: "approve",
      commissionId: updated.id,
      message: "Commission approved successfully.",
    };
  }

  /*
   * ------------------------------------------------------------
   * PAY
   * ------------------------------------------------------------
   */

  if (intent === "pay") {
    if (commission.status !== "APPROVED") {
      return {
        success: false,
        error: `Commission cannot be paid because its current status is ${commission.status}.`,
      };
    }

    if (Number(commission.commissionAmount) <= 0) {
      return {
        success: false,
        error: "A commission of £0.00 cannot be paid.",
      };
    }

    const updated = await prisma.commission.update({
      where: { id: commission.id },
      data: {
        status: "PAID",
        paidAt: new Date(),
      },
    });

    console.log("=================================");
    console.log("COMMISSION MARKED AS PAID");
    console.log("=================================");
    console.log({
      commissionId: updated.id,
      tradeAccountId: updated.tradeAccountId,
      shopifyOrderId: updated.shopifyOrderId,
      orderNumber: updated.orderNumber,
      commissionAmount: Number(updated.commissionAmount),
      status: updated.status,
      paidAt: updated.paidAt,
    });
    console.log("=================================");

    return {
      success: true,
      action: "pay",
      commissionId: updated.id,
      message: "Commission marked as paid successfully.",
    };
  }

  return {
    success: false,
    error: "Unknown action.",
  };
};

/**
 * ============================================================
 * HELPERS
 * ============================================================
 */

function money(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * ============================================================
 * STATUS BADGE
 * ============================================================
 */

function StatusBadge({ status }) {
  let className = "status-badge";
  if (status === "PENDING") className += " status-pending";
  if (status === "APPROVED") className += " status-approved";
  if (status === "PAID") className += " status-paid";
  if (status === "CANCELLED") className += " status-cancelled";
  return <span className={className}>{status}</span>;
}

/**
 * ============================================================
 * MAIN PAGE
 * ============================================================
 */

export default function CommissionLedger() {
  const { commissions, summary, filters } = useLoaderData();

  const navigation = useNavigation();

  const isSubmitting = navigation.state === "submitting";

  /*
   * Track which commission row is in "pending approve" mode
   * and the current transaction reference input value.
   */
  const [approvingId, setApprovingId] = useState(null);
  const [txRef, setTxRef] = useState("");

  function handleApproveClick(commissionId) {
    setApprovingId(commissionId);
    setTxRef("");
  }

  function handleCancelApprove() {
    setApprovingId(null);
    setTxRef("");
  }

  return (
    <div className="commission-page">

      {/* ======================================================
          HEADER
      ====================================================== */}

      <div className="page-header">
        <div>
          <h1>Commission Ledger</h1>
          <p>Manage designer commissions, approvals, refunds and payments.</p>
        </div>
      </div>

      {/* ======================================================
          SUMMARY CARDS
      ====================================================== */}

      <div className="summary-grid">

        <div className="summary-card">
          <div className="summary-label">Total Orders</div>
          <div className="summary-value">{summary.totalCount}</div>
          <div className="summary-count">
            {money(summary.totalAmount)} total commission
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-label">Pending</div>
          <div className="summary-value">{money(summary.pendingAmount)}</div>
          <div className="summary-count">
            {summary.pendingCount} commission
            {summary.pendingCount !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-label">Approved</div>
          <div className="summary-value">{money(summary.approvedAmount)}</div>
          <div className="summary-count">
            {summary.approvedCount} commission
            {summary.approvedCount !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-label">Paid</div>
          <div className="summary-value">{money(summary.paidAmount)}</div>
          <div className="summary-count">
            {summary.paidCount} commission
            {summary.paidCount !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-label">Cancelled</div>
          <div className="summary-value">{money(summary.cancelledAmount)}</div>
          <div className="summary-count">
            {summary.cancelledCount} commission
            {summary.cancelledCount !== 1 ? "s" : ""}
          </div>
        </div>

      </div>

      {/* ======================================================
          FILTERS
      ====================================================== */}

      <Form method="get" className="filters">

        <input
          type="text"
          name="search"
          defaultValue={filters.search}
          placeholder="Search order, designer or email..."
          className="search-input"
        />

        <select
          name="status"
          defaultValue={filters.status}
          className="status-filter"
        >
          <option value="ALL">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="PAID">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        <button type="submit" className="filter-button">
          Filter
        </button>

      </Form>

      {/* ======================================================
          LEDGER
      ====================================================== */}

      <div className="ledger-card">

        <div className="ledger-header">
          <div>Commission Ledger</div>
          <div>
            {commissions.length} record
            {commissions.length !== 1 ? "s" : ""}
          </div>
        </div>

        {commissions.length === 0 ? (
          <div className="empty-state">
            <h3>No commissions found</h3>
            <p>There are no commissions matching the current filters.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="commission-table">

              <thead>
                <tr>
                  <th>Order</th>
                  <th>Designer</th>
                  <th>Order Value</th>
                  <th>Eligible Amount</th>
                  <th>Rate</th>
                  <th>Commission</th>
                  <th>Status</th>
                  <th>Tx Reference</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {commissions.map((commission) => (
                  <tr key={commission.id}>

                    {/* ORDER */}
                    <td>
                      <strong>
                        #{commission.orderNumber || commission.shopifyOrderId}
                      </strong>
                      <div className="small-text">
                        Shopify ID: {commission.shopifyOrderId}
                      </div>
                    </td>

                    {/* DESIGNER */}
                    <td>
                      <strong>
                        {commission.tradeAccount?.businessName || "—"}
                      </strong>
                      <div className="small-text">
                        {commission.tradeAccount?.email || "—"}
                      </div>
                    </td>

                    {/* ORDER VALUE */}
                    <td>{money(commission.orderTotal)}</td>

                    {/* ELIGIBLE */}
                    <td>{money(commission.eligibleAmount)}</td>

                    {/* RATE */}
                    <td>{commission.commissionRate}%</td>

                    {/* COMMISSION */}
                    <td>
                      <strong>{money(commission.commissionAmount)}</strong>
                      {commission.clientSpecialOffer && (
                        <div className="small-text">
                          {commission.clientSpecialOffer.discountCode}
                          {" · "}
                          Client {commission.clientSpecialOffer.clientDiscountPercent}%
                        </div>
                      )}
                    </td>

                    {/* STATUS */}
                    <td>
                      <StatusBadge status={commission.status} />
                      {commission.approvedAt && (
                        <div className="small-text">
                          {formatDate(commission.approvedAt)}
                        </div>
                      )}
                    </td>

                    {/* TRANSACTION REFERENCE */}
                    <td>
                      {commission.transactionReference ? (
                        <span className="tx-ref-display">
                          {commission.transactionReference}
                        </span>
                      ) : (
                        <span className="tx-ref-empty">—</span>
                      )}
                    </td>

                    {/* CREATED */}
                    <td>{formatDate(commission.createdAt)}</td>

                    {/* ACTION */}
                    <td>

                      {/*
                       * PENDING
                       *
                       * If commission is £0.00 this is a trade-discount
                       * order with no payable commission — show a label
                       * instead of the approve workflow.
                       *
                       * Otherwise show the inline approve expand.
                       */}
                      {commission.status === "PENDING" && (
                        commission.commissionAmount === 0 ? (
                          <span className="trade-pricing-label">
                            Trade Pricing
                          </span>
                        ) : approvingId === commission.id ? (
                          <Form
                            method="post"
                            onSubmit={() => {
                              setApprovingId(null);
                              setTxRef("");
                            }}
                          >
                            <input type="hidden" name="intent" value="approve" />
                            <input
                              type="hidden"
                              name="commissionId"
                              value={commission.id}
                            />
                            <input
                              type="text"
                              name="transactionReference"
                              value={txRef}
                              onChange={(e) => setTxRef(e.target.value)}
                              placeholder="Transaction ref (optional)"
                              className="tx-ref-input"
                              autoFocus
                            />
                            <div className="tx-ref-actions">
                              <button
                                type="submit"
                                className="action-button approve-button"
                                disabled={isSubmitting}
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                className="action-button cancel-button"
                                onClick={handleCancelApprove}
                              >
                                Cancel
                              </button>
                            </div>
                          </Form>
                        ) : (
                          <button
                            type="button"
                            className="action-button approve-button"
                            onClick={() => handleApproveClick(commission.id)}
                          >
                            Approve
                          </button>
                        )
                      )}

                      {/* APPROVED → Mark Paid */}
                      {commission.status === "APPROVED" && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="pay" />
                          <input
                            type="hidden"
                            name="commissionId"
                            value={commission.id}
                          />
                          <button
                            type="submit"
                            className="action-button pay-button"
                            disabled={isSubmitting}
                          >
                            Mark Paid
                          </button>
                        </Form>
                      )}

                      {/* PAID */}
                      {commission.status === "PAID" && (
                        <div className="completed-action">
                          Paid
                          {commission.paidAt && (
                            <div className="small-text">
                              {formatDate(commission.paidAt)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* CANCELLED */}
                      {commission.status === "CANCELLED" && (
                        <span className="disabled-action">Cancelled</span>
                      )}

                    </td>

                  </tr>
                ))}
              </tbody>

            </table>
          </div>
        )}

      </div>

      {/* ======================================================
          CSS
      ====================================================== */}

      <style>{`

        .commission-page {
          padding: 32px;
          max-width: 1600px;
          margin: 0 auto;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 28px;
        }

        .page-header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 650;
        }

        .page-header p {
          margin: 7px 0 0;
          color: #6b7280;
          font-size: 14px;
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }

        .summary-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 20px;
        }

        .summary-label {
          font-size: 13px;
          color: #6b7280;
          margin-bottom: 8px;
        }

        .summary-value {
          font-size: 26px;
          font-weight: 650;
        }

        .summary-count {
          margin-top: 6px;
          font-size: 12px;
          color: #9ca3af;
        }

        .filters {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
        }

        .search-input {
          width: 360px;
          border: 1px solid #d1d5db;
          border-radius: 7px;
          padding: 10px 12px;
          font-size: 14px;
        }

        .status-filter {
          border: 1px solid #d1d5db;
          border-radius: 7px;
          padding: 10px 12px;
          background: #fff;
        }

        .filter-button {
          border: 0;
          border-radius: 7px;
          padding: 10px 18px;
          background: #111827;
          color: #fff;
          cursor: pointer;
        }

        .ledger-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          overflow: hidden;
        }

        .ledger-header {
          display: flex;
          justify-content: space-between;
          padding: 18px 20px;
          border-bottom: 1px solid #e5e7eb;
          font-weight: 600;
        }

        .table-wrapper {
          overflow-x: auto;
        }

        .commission-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1200px;
        }

        .commission-table th {
          text-align: left;
          font-size: 12px;
          color: #6b7280;
          font-weight: 600;
          padding: 13px 16px;
          background: #f9fafb;
          border-bottom: 1px solid #e5e7eb;
        }

        .commission-table td {
          padding: 16px;
          border-bottom: 1px solid #f0f0f0;
          font-size: 14px;
          vertical-align: middle;
        }

        .commission-table tbody tr:hover {
          background: #fafafa;
        }

        .small-text {
          font-size: 11px;
          color: #9ca3af;
          margin-top: 4px;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          padding: 5px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 650;
        }

        .status-pending {
          background: #fff7ed;
          color: #c2410c;
        }

        .status-approved {
          background: #eff6ff;
          color: #1d4ed8;
        }

        .status-paid {
          background: #ecfdf5;
          color: #047857;
        }

        .status-cancelled {
          background: #f3f4f6;
          color: #6b7280;
        }

        /* Transaction reference display */

        .tx-ref-display {
          display: inline-block;
          font-size: 12px;
          font-weight: 600;
          font-family: monospace;
          background: #f0f4ff;
          color: #1d4ed8;
          padding: 4px 8px;
          border-radius: 4px;
          letter-spacing: 0.02em;
        }

        .tx-ref-empty {
          color: #d1d5db;
          font-size: 14px;
        }

        /* Inline approve expand */

        .tx-ref-input {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          padding: 7px 10px;
          font-size: 12px;
          margin-bottom: 6px;
          box-sizing: border-box;
          min-width: 180px;
        }

        .tx-ref-input:focus {
          outline: none;
          border-color: #6366f1;
          box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
        }

        .tx-ref-actions {
          display: flex;
          gap: 6px;
        }

        /* Action buttons */

        .action-button {
          border: 0;
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }

        .action-button:disabled {
          opacity: .5;
          cursor: not-allowed;
        }

        .approve-button {
          background: #111827;
          color: white;
        }

        .pay-button {
          background: #047857;
          color: white;
        }

        .cancel-button {
          background: #f3f4f6;
          color: #374151;
        }

        /* Trade pricing label — shown instead of Approve
           when commission amount is £0.00 */

        .trade-pricing-label {
          display: inline-block;
          font-size: 12px;
          font-weight: 600;
          color: #6b7280;
          background: #f3f4f6;
          padding: 5px 10px;
          border-radius: 6px;
        }

        .completed-action {
          color: #047857;
          font-size: 12px;
          font-weight: 600;
        }

        .disabled-action {
          color: #9ca3af;
          font-size: 12px;
        }

        .empty-state {
          text-align: center;
          padding: 70px 20px;
        }

        .empty-state h3 {
          margin: 0 0 8px;
        }

        .empty-state p {
          margin: 0;
          color: #6b7280;
        }

        @media (max-width: 1100px) {
          .summary-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        @media (max-width: 900px) {
          .commission-page {
            padding: 18px;
          }

          .summary-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .filters {
            flex-wrap: wrap;
          }

          .search-input {
            width: 100%;
          }
        }

      `}</style>

    </div>
  );
}