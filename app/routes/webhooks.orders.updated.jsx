import prisma from "../db.server";
import { authenticate } from "../shopify.server";

/**
 * ============================================================
 * SHOPIFY ORDERS UPDATED WEBHOOK
 * ============================================================
 *
 * Handles:
 *
 * 1. Partial refunds
 * 2. Multiple partial refunds
 * 3. Full refunds
 * 4. Order cancellations
 * 5. Repeated Shopify webhook deliveries
 * 6. Commission adjustment audit trail
 *
 * ============================================================
 *
 * CLIENT SPECIAL PRICE EXAMPLE
 *
 * Original product/order value:
 *
 * £100
 *
 * Designer allocation:
 *
 * 15%
 *
 * Customer discount:
 *
 * 10%
 *
 * Designer commission:
 *
 * 5%
 *
 * Customer pays:
 *
 * £90
 *
 * Designer commission:
 *
 * £100 × 5% = £5
 *
 * ============================================================
 *
 * REFUND EXAMPLE
 *
 * Customer refunds £20.
 *
 * Original eligible amount:
 *
 * £100
 *
 * Original commission:
 *
 * £5
 *
 * Refund:
 *
 * £20
 *
 * Refund percentage:
 *
 * 20%
 *
 * Commission reduction:
 *
 * £5 × 20% = £1
 *
 * Remaining commission:
 *
 * £4
 *
 * ============================================================
 *
 * SECOND REFUND EXAMPLE
 *
 * Another £30 is refunded.
 *
 * Total refunded:
 *
 * £50
 *
 * Original commission:
 *
 * £5
 *
 * Total commission reduction:
 *
 * £5 × 50% = £2.50
 *
 * Final commission:
 *
 * £2.50
 *
 * ============================================================
 *
 * IMPORTANT
 *
 * Commission is ALWAYS calculated from the original
 * eligible amount and original commission rate.
 *
 * We NEVER calculate a new percentage from the already
 * reduced commission amount.
 *
 * ============================================================
 */

export const action = async ({ request }) => {
  console.log("=================================");
  console.log("SHOPIFY ORDERS UPDATED WEBHOOK HIT");
  console.log("=================================");

  try {
    /*
     * ============================================================
     * 1. AUTHENTICATE WEBHOOK
     * ============================================================
     */

    const { payload, shop, topic } =
      await authenticate.webhook(request);

    const order = payload;

    console.log("SHOP:", shop);
    console.log("TOPIC:", topic);

    /*
     * ============================================================
     * 2. BASIC ORDER INFORMATION
     * ============================================================
     */

    const shopifyOrderId = String(order.id);

    const orderNumber = order.order_number
      ? String(order.order_number)
      : null;

    const customerEmail =
      order.customer?.email
        ?.toString()
        .trim() || null;

    const financialStatus =
      order.financial_status
        ?.toString()
        .toLowerCase() || null;

    const cancelledAt =
      order.cancelled_at || null;

    const cancelReason =
      order.cancel_reason || null;

    console.log("=================================");
    console.log("ORDER INFORMATION");
    console.log("=================================");

    console.log({
      shopifyOrderId,
      orderNumber,
      customerEmail,
      financialStatus,
      cancelledAt,
      cancelReason,
    });

    console.log("=================================");

    /*
     * ============================================================
     * 3. FIND COMMISSION
     * ============================================================
     */

    const commission =
      await prisma.commission.findUnique({
        where: {
          shopifyOrderId,
        },

        include: {
          tradeAccount: true,
          clientSpecialOffer: true,
          referral: true,
          adjustments: true,
        },
      });

    /*
     * ============================================================
     * 4. NO COMMISSION
     * ============================================================
     */

    if (!commission) {
      console.log("=================================");
      console.log("NO COMMISSION FOUND");
      console.log("=================================");

      console.log({
        shopifyOrderId,
        orderNumber,
      });

      console.log(
        "ORDER DOES NOT HAVE A COMMISSION RECORD"
      );

      return new Response("OK", {
        status: 200,
      });
    }

    /*
     * ============================================================
     * 5. CURRENT COMMISSION INFORMATION
     * ============================================================
     */

    console.log("=================================");
    console.log("COMMISSION FOUND");
    console.log("=================================");

    console.log({
      commissionId: commission.id,

      tradeAccountId:
        commission.tradeAccountId,

      referralId:
        commission.referralId,

      clientSpecialOfferId:
        commission.clientSpecialOfferId,

      shopifyOrderId:
        commission.shopifyOrderId,

      orderNumber:
        commission.orderNumber,

      orderTotal:
        Number(commission.orderTotal),

      eligibleAmount:
        Number(commission.eligibleAmount),

      commissionRate:
        Number(commission.commissionRate),

      currentCommissionAmount:
        Number(commission.commissionAmount),

      status:
        commission.status,

      existingAdjustmentCount:
        commission.adjustments.length,
    });

    console.log("=================================");

    /*
     * ============================================================
     * 6. ORIGINAL COMMISSION VALUES
     * ============================================================
     *
     * IMPORTANT:
     *
     * commissionAmount may already have been reduced because
     * of previous refunds.
     *
     * Therefore we MUST NOT use commission.commissionAmount
     * as the original commission.
     *
     * Instead:
     *
     * Original commission =
     *
     * eligibleAmount × commissionRate
     *
     * Example:
     *
     * £100 × 5% = £5
     */

    const originalEligibleAmount =
      Number(commission.eligibleAmount) || 0;

    const originalCommissionRate =
      Number(commission.commissionRate) || 0;

    const originalCommissionAmount =
      Number(
        (
          originalEligibleAmount *
          (originalCommissionRate / 100)
        ).toFixed(2)
      );

    console.log("=================================");
    console.log("ORIGINAL COMMISSION VALUES");
    console.log("=================================");

    console.log({
      originalEligibleAmount,
      originalCommissionRate,
      originalCommissionAmount,
    });

    console.log("=================================");

    /*
     * ============================================================
     * 7. DETERMINE ORDER STATE
     * ============================================================
     */

    const isPartiallyRefunded =
      financialStatus ===
      "partially_refunded";

    const isFullyRefunded =
      financialStatus ===
      "refunded";

    const isCancelled =
      Boolean(cancelledAt);

      /*
 * ============================================================
 * 7A. ALREADY CANCELLED COMMISSION
 * ============================================================
 *
 * Once a commission has been cancelled, a later
 * ORDERS_UPDATED webhook must NEVER restore commission.
 *
 * Shopify can send ORDERS_UPDATED after ORDERS_CANCELLED.
 */

if (commission.status === "CANCELLED") {
  console.log("=================================");
  console.log(
    "COMMISSION ALREADY CANCELLED - NO RECALCULATION"
  );
  console.log("=================================");

  console.log({
    commissionId: commission.id,
    shopifyOrderId,
    orderNumber,
    currentCommissionAmount:
      Number(commission.commissionAmount),
    status: commission.status,
  });

  return new Response("OK", {
    status: 200,
  });
}

    /*
     * ============================================================
     * 8. IF ORDER HAS NO REFUND OR CANCELLATION
     * ============================================================
     */

    if (
      !isPartiallyRefunded &&
      !isFullyRefunded &&
      !isCancelled
    ) {
      console.log("=================================");
      console.log(
        "NO REFUND / CANCELLATION ACTION REQUIRED"
      );
      console.log("=================================");

      console.log({
        financialStatus,
        isPartiallyRefunded,
        isFullyRefunded,
        isCancelled,
      });

      return new Response("OK", {
        status: 200,
      });
    }

    /*
     * ============================================================
     * 9. GET ALL EXISTING REFUND ADJUSTMENTS
     * ============================================================
     *
     * We use the adjustment records to make the process
     * idempotent.
     *
     * If Shopify sends the same webhook again:
     *
     * SAME TRANSACTION ID
     *
     * → adjustment already exists
     * → DO NOT create another adjustment
     * → DO NOT double-count the refund
     */

    const existingRefundAdjustments =
      commission.adjustments.filter(
        (adjustment) =>
          adjustment.type === "REFUND"
      );

    /*
     * ============================================================
     * 10. HANDLE REFUND TRANSACTIONS
     * ============================================================
     */

    const refunds = Array.isArray(
      order.refunds
    )
      ? order.refunds
      : [];

    console.log("=================================");
    console.log("REFUND INFORMATION");
    console.log("=================================");

    console.log({
      numberOfRefunds:
        refunds.length,
    });

    console.log("=================================");

    /*
     * Track whether a new refund adjustment was created.
     */

    let newRefundAdjustmentCreated =
      false;

    /*
     * Track the total successful refund amount currently
     * reported by Shopify.
     */

    let totalRefundedAmount =
      0;

    /*
     * ============================================================
     * LOOP THROUGH REFUNDS
     * ============================================================
     */

    for (
      const refund of refunds
    ) {
      const refundId =
        refund?.id
          ? String(refund.id)
          : null;

      const transactions =
        Array.isArray(
          refund?.transactions
        )
          ? refund.transactions
          : [];

      /*
       * ----------------------------------------------------------
       * LOOP THROUGH REFUND TRANSACTIONS
       * ----------------------------------------------------------
       */

      for (
        const transaction of transactions
      ) {
        const transactionKind =
          transaction?.kind
            ?.toString()
            .toLowerCase();

        const transactionStatus =
          transaction?.status
            ?.toString()
            .toLowerCase();

        /*
         * Only refund transactions.
         */

        if (
          transactionKind !==
          "refund"
        ) {
          continue;
        }

        /*
         * Ignore failed refund transactions.
         */

        if (
          transactionStatus &&
          transactionStatus !==
            "success"
        ) {
          continue;
        }

        const transactionId =
          transaction?.id
            ? String(transaction.id)
            : null;

        const transactionAmount =
          Number(
            transaction?.amount
          ) || 0;

        /*
         * Ignore invalid amounts.
         */

        if (
          transactionAmount <= 0
        ) {
          continue;
        }

        /*
         * --------------------------------------------------------
         * ADD TO CURRENT SHOPIFY REFUND TOTAL
         * --------------------------------------------------------
         */

        totalRefundedAmount +=
          transactionAmount;

        console.log("=================================");
        console.log("REFUND TRANSACTION");
        console.log("=================================");

        console.log({
          refundId,
          transactionId,
          amount: transactionAmount,
          currency:
            transaction?.currency,
          kind: transactionKind,
          status: transactionStatus,
        });

        /*
         * --------------------------------------------------------
         * CHECK WHETHER THIS REFUND WAS ALREADY RECORDED
         * --------------------------------------------------------
         */

        const alreadyRecorded =
          transactionId
            ? existingRefundAdjustments.some(
                (adjustment) =>
                  adjustment
                    .shopifyTransactionId ===
                  transactionId
              )
            : false;

        if (
          alreadyRecorded
        ) {
          console.log(
            "REFUND TRANSACTION ALREADY RECORDED"
          );

          console.log({
            transactionId,
          });

          continue;
        }

        /*
         * --------------------------------------------------------
         * CALCULATE COMMISSION ADJUSTMENT
         * --------------------------------------------------------
         *
         * Example:
         *
         * Refund = £20
         *
         * Commission rate = 5%
         *
         * Adjustment:
         *
         * £20 × 5% = £1
         *
         * Therefore:
         *
         * commissionAdjustment = -£1
         */

        const refundCommissionAdjustment =
          Number(
            (
              transactionAmount *
              (originalCommissionRate / 100)
            ).toFixed(2)
          );

        /*
         * --------------------------------------------------------
         * CALCULATE CURRENT COMMISSION AFTER THIS ADJUSTMENT
         * --------------------------------------------------------
         *
         * We calculate this from:
         *
         * ORIGINAL COMMISSION
         *
         * minus
         *
         * ALL PREVIOUS REFUND ADJUSTMENTS
         *
         * minus
         *
         * THIS REFUND
         */

        let previousRefundAdjustments =
          0;

        for (
          const adjustment of
            existingRefundAdjustments
        ) {
          previousRefundAdjustments +=
            Math.abs(
              Number(
                adjustment
                  .commissionAdjustment
              ) || 0
            );
        }

        /*
         * Include refund adjustments created earlier during
         * this same webhook execution.
         */

        const commissionAfterAdjustment =
          Number(
            Math.max(
              0,
              originalCommissionAmount -
                previousRefundAdjustments -
                refundCommissionAdjustment
            ).toFixed(2)
          );

        /*
         * --------------------------------------------------------
         * CREATE AUDIT RECORD
         * --------------------------------------------------------
         */

        const adjustment =
          await prisma.commissionAdjustment.create({
            data: {
              commissionId:
                commission.id,

              shopifyOrderId:
                shopifyOrderId,

              type: "REFUND",

              shopifyRefundId:
                refundId,

              shopifyTransactionId:
                transactionId,

              refundAmount:
                transactionAmount,

              commissionAdjustment:
                -refundCommissionAdjustment,

              commissionAfterAdjustment:
                commissionAfterAdjustment,

              note:
                `Shopify refund transaction ${transactionId || "unknown"}`,
            },
          });

        /*
         * Add newly created adjustment to our local list so
         * subsequent refund transactions in this SAME webhook
         * are calculated correctly.
         */

        existingRefundAdjustments.push(
          adjustment
        );

        newRefundAdjustmentCreated =
          true;

        console.log("=================================");
        console.log(
          "COMMISSION REFUND ADJUSTMENT CREATED"
        );
        console.log("=================================");

        console.log({
          adjustmentId:
            adjustment.id,

          commissionId:
            adjustment.commissionId,

          shopifyOrderId:
            adjustment.shopifyOrderId,

          shopifyRefundId:
            adjustment.shopifyRefundId,

          shopifyTransactionId:
            adjustment.shopifyTransactionId,

          refundAmount:
            transactionAmount,

          commissionRate:
            originalCommissionRate,

          commissionAdjustment:
            -refundCommissionAdjustment,

          commissionAfterAdjustment,
        });

        console.log("=================================");
      }
    }

    /*
     * ============================================================
     * 11. NORMALISE TOTAL REFUND
     * ============================================================
     */

    totalRefundedAmount =
      Number(
        totalRefundedAmount.toFixed(2)
      );

    console.log("=================================");
    console.log("TOTAL REFUNDED AMOUNT");
    console.log("=================================");

    console.log({
      originalEligibleAmount,
      totalRefundedAmount,
      originalCommissionRate,
      originalCommissionAmount,
    });

    console.log("=================================");

    /*
     * ============================================================
     * 12. CALCULATE TOTAL COMMISSION ADJUSTMENTS
     * ============================================================
     *
     * IMPORTANT:
     *
     * We calculate the current commission from the ORIGINAL
     * commission amount.
     *
     * Never:
     *
     * current commission × refund percentage
     *
     * Instead:
     *
     * original commission
     * -
     * all recorded refund adjustments
     */

    let totalCommissionAdjustments =
      0;

    for (
      const adjustment of
        existingRefundAdjustments
    ) {
      totalCommissionAdjustments +=
        Math.abs(
          Number(
            adjustment
              .commissionAdjustment
          ) || 0
        );
    }

    totalCommissionAdjustments =
      Number(
        totalCommissionAdjustments.toFixed(2)
      );

    /*
     * ============================================================
     * 13. CALCULATE FINAL COMMISSION
     * ============================================================
     */

    let finalCommissionAmount =
      originalCommissionAmount -
      totalCommissionAdjustments;

    finalCommissionAmount =
      Number(
        Math.max(
          0,
          finalCommissionAmount
        ).toFixed(2)
      );

      /*
 * ============================================================
 * CANCELLATION OVERRIDE
 * ============================================================
 *
 * Cancellation always means £0 commission.
 *
 * This MUST override the refund calculation.
 *
 * Example:
 *
 * Original commission: £10
 * Refunds: £95
 * Refund calculation: £0.50
 *
 * BUT if the order is cancelled:
 *
 * Final commission: £0
 */

if (isCancelled) {
  finalCommissionAmount = 0;
}

    /*
     * ============================================================
     * 14. CALCULATE REFUND PERCENTAGE
     * ============================================================
     */

    const cappedRefundAmount =
      Math.min(
        totalRefundedAmount,
        originalEligibleAmount
      );

    let refundPercentage = 0;

    if (
      originalEligibleAmount > 0
    ) {
      refundPercentage =
        cappedRefundAmount /
        originalEligibleAmount;
    }

    refundPercentage =
      Number(
        (
          refundPercentage *
          100
        ).toFixed(2)
      );

    /*
     * ============================================================
     * 15. REMAINING ELIGIBLE AMOUNT
     * ============================================================
     */

    const remainingEligibleAmount =
      Number(
        Math.max(
          0,
          originalEligibleAmount -
            cappedRefundAmount
        ).toFixed(2)
      );

    /*
     * ============================================================
     * 16. FULL REFUND / FULL CANCELLATION
     * ============================================================
     *
     * If the entire eligible amount has been refunded:
     *
     * commission = £0
     *
     * status = CANCELLED
     */

    const entireAmountRefunded =
      originalEligibleAmount > 0 &&
      cappedRefundAmount >=
        originalEligibleAmount;

    /*
     * ============================================================
     * 17. HANDLE CANCELLED ORDER WITHOUT REFUND
     * ============================================================
     *
     * If Shopify says the order is cancelled but there are no
     * successful refund transactions, we still prevent the
     * commission from remaining payable.
     *
     * We create a CANCELLATION adjustment.
     *
     * However, if refund adjustments already exist, we calculate
     * the remaining commission first.
     */

    if (
      isCancelled &&
      totalRefundedAmount <= 0
    ) {
      console.log("=================================");
      console.log("ORDER CANCELLED WITHOUT REFUND");
      console.log("=================================");

      /*
       * Check whether cancellation adjustment already exists.
       */

      const existingCancellation =
        commission.adjustments.find(
          (adjustment) =>
            adjustment.type ===
            "CANCELLATION"
        );

      if (
        !existingCancellation
      ) {
        const cancellationAdjustmentAmount =
          finalCommissionAmount;

        const cancellationAdjustment =
          await prisma.commissionAdjustment.create({
            data: {
              commissionId:
                commission.id,

              shopifyOrderId:
                shopifyOrderId,

              type:
                "CANCELLATION",

              commissionAdjustment:
                -cancellationAdjustmentAmount,

              commissionAfterAdjustment:
                0,

              note:
                `Order cancelled by ${cancelReason || "unknown reason"}`,
            },
          });

        console.log("=================================");
        console.log(
          "CANCELLATION ADJUSTMENT CREATED"
        );
        console.log("=================================");

        console.log({
          adjustmentId:
            cancellationAdjustment.id,

          commissionAdjustment:
            -cancellationAdjustmentAmount,

          commissionAfterAdjustment:
            0,
        });
      } else {
        console.log(
          "CANCELLATION ADJUSTMENT ALREADY EXISTS"
        );
      }

      /*
       * Update commission to zero.
       */

      const updatedCommission =
        await prisma.commission.update({
          where: {
            id: commission.id,
          },

          data: {
            commissionAmount: 0,

            status: "CANCELLED",
          },
        });

      console.log("=================================");
      console.log(
        "COMMISSION SUCCESSFULLY CANCELLED"
      );
      console.log("=================================");

      console.log({
        commissionId:
          updatedCommission.id,

        tradeAccountId:
          updatedCommission.tradeAccountId,

        clientSpecialOfferId:
          updatedCommission.clientSpecialOfferId,

        shopifyOrderId:
          updatedCommission.shopifyOrderId,

        orderNumber:
          updatedCommission.orderNumber,

        originalEligibleAmount,

        originalCommissionAmount,

        finalCommissionAmount: 0,

        finalStatus:
          updatedCommission.status,
      });

      console.log("=================================");

      return new Response("OK", {
        status: 200,
      });
    }

    /*
     * ============================================================
     * 18. DETERMINE FINAL STATUS
     * ============================================================
     */

 let finalStatus =
  commission.status;

/*
 * ============================================================
 * CANCELLATION / FULL REFUND STATUS
 * ============================================================
 *
 * Cancellation ALWAYS takes priority.
 */

if (
  isCancelled ||
  isFullyRefunded ||
  entireAmountRefunded
) {
  finalStatus = "CANCELLED";

  /*
   * A cancelled or fully refunded order must never
   * retain commission.
   */
  finalCommissionAmount = 0;
}

    /*
     * Partial refund:
     *
     * Keep current status.
     *
     * PENDING remains PENDING.
     *
     * APPROVED remains APPROVED.
     *
     * PAID remains PAID.
     *
     * A separate payout/clawback process can later handle
     * refunds against already-paid commissions.
     */

    /*
     * ============================================================
     * 19. UPDATE COMMISSION
     * ============================================================
     */

    const updatedCommission =
      await prisma.commission.update({
        where: {
          id: commission.id,
        },

        data: {
          /*
           * IMPORTANT:
           *
           * eligibleAmount NEVER changes.
           *
           * It remains the original £100.
           */

          eligibleAmount:
            commission.eligibleAmount,

          /*
           * commissionAmount is the CURRENT commission after
           * all refund adjustments.
           */

          commissionAmount:
            finalCommissionAmount,

          status:
            finalStatus,
        },
      });

    /*
     * ============================================================
     * 20. LOG FINAL RESULT
     * ============================================================
     */

    console.log("=================================");
    console.log(
      "COMMISSION SUCCESSFULLY UPDATED"
    );
    console.log("=================================");

    console.log({
      commissionId:
        updatedCommission.id,

      tradeAccountId:
        updatedCommission.tradeAccountId,

      clientSpecialOfferId:
        updatedCommission.clientSpecialOfferId,

      shopifyOrderId:
        updatedCommission.shopifyOrderId,

      orderNumber:
        updatedCommission.orderNumber,

      originalEligibleAmount,

      totalRefundedAmount,

      cappedRefundAmount,

      remainingEligibleAmount,

      originalCommissionRate,

      originalCommissionAmount,

      totalCommissionAdjustments,

      refundPercentage,

      finalCommissionAmount,

      finalStatus:
        updatedCommission.status,

      newRefundAdjustmentCreated,
    });

    console.log("=================================");

    /*
     * ============================================================
     * 21. SUCCESS
     * ============================================================
     */

    return new Response("OK", {
      status: 200,
    });
  } catch (error) {
    /*
     * ============================================================
     * ERROR HANDLING
     * ============================================================
     */

    console.error("=================================");
    console.error(
      "SHOPIFY ORDERS UPDATED WEBHOOK ERROR"
    );
    console.error("=================================");

    console.error(error);

    console.error("=================================");

    return new Response(
      "Webhook processing failed",
      {
        status: 500,
      }
    );
  }
};