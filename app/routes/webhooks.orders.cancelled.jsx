import prisma from "../db.server";
import { authenticate } from "../shopify.server";

/**
 * ============================================================
 * SHOPIFY ORDER CANCELLED WEBHOOK
 * ============================================================
 *
 * Purpose:
 *
 * When a Shopify order is cancelled, find the commission
 * associated with that Shopify order and mark it as CANCELLED.
 *
 * IMPORTANT:
 *
 * We DO NOT delete the commission record.
 *
 * This preserves the commission history for accounting,
 * reporting and audit purposes.
 *
 * Example:
 *
 * Order #1008
 *
 * Original Order Value: £100
 * Designer Commission: £5
 * Status: PENDING
 *
 * Order cancelled
 *
 * ↓
 *
 * Status: CANCELLED
 * Commission Amount: £0
 *
 * ============================================================
 */

export const action = async ({ request }) => {
  console.log("=================================");
  console.log("SHOPIFY ORDER CANCELLED WEBHOOK HIT");
  console.log("=================================");

  try {
    /*
     * ==========================================================
     * 1. AUTHENTICATE SHOPIFY WEBHOOK
     * ==========================================================
     */

    const { payload, shop, topic } =
      await authenticate.webhook(request);

    const order = payload;

    console.log("SHOP:", shop);
    console.log("TOPIC:", topic);

    /*
     * ==========================================================
     * 2. CHECK SHOPIFY ORDER ID
     * ==========================================================
     */

    if (!order?.id) {
      console.error(
        "ORDER CANCELLED WEBHOOK DID NOT CONTAIN AN ORDER ID"
      );

      /*
       * Return 400 because we cannot safely process the
       * cancellation without the Shopify order ID.
       */

      return new Response(
        "Missing Shopify order ID",
        {
          status: 400,
        }
      );
    }

    /*
     * Shopify REST webhook payload normally gives us the
     * numeric order ID.
     *
     * Convert it to String because your Commission model
     * stores shopifyOrderId as a String.
     */

    const shopifyOrderId = String(order.id);

    const orderNumber = order.order_number
      ? String(order.order_number)
      : null;

    /*
     * ==========================================================
     * 3. LOG ORDER INFORMATION
     * ==========================================================
     */

    console.log("=================================");
    console.log("CANCELLED ORDER INFORMATION");
    console.log("=================================");

    console.log({
      shopifyOrderId,
      orderNumber,
      customerEmail:
        order.customer?.email ?? null,
      cancelledAt:
        order.cancelled_at ?? null,
      cancelReason:
        order.cancel_reason ?? null,
      financialStatus:
        order.financial_status ?? null,
      fulfillmentStatus:
        order.fulfillment_status ?? null,
    });

    console.log("=================================");

    /*
     * ==========================================================
     * 4. FIND COMMISSION
     * ==========================================================
     *
     * The commission was originally created by:
     *
     * /webhooks/orders/create
     *
     * using:
     *
     * commission.shopifyOrderId
     *
     * Therefore this is the safest way to locate it.
     */

    const commission =
      await prisma.commission.findUnique({
        where: {
          shopifyOrderId,
        },
      });

    /*
     * ==========================================================
     * 5. COMMISSION NOT FOUND
     * ==========================================================
     *
     * This can happen if:
     *
     * - The order was created before the commission system
     *   was installed.
     *
     * - The orders/create webhook failed.
     *
     * - The order does not belong to a trade account.
     *
     * - The commission was never created.
     *
     * We return 200 because there is nothing to update.
     *
     * We do NOT return 500.
     */

    if (!commission) {
      console.log("=================================");
      console.log(
        "NO COMMISSION FOUND FOR CANCELLED ORDER"
      );
      console.log("=================================");

      console.log({
        shopifyOrderId,
        orderNumber,
      });

      console.log(
        "Nothing to update."
      );

      console.log("=================================");

      return new Response("OK", {
        status: 200,
      });
    }

    /*
     * ==========================================================
     * 6. LOG EXISTING COMMISSION
     * ==========================================================
     */

    console.log("=================================");
    console.log("COMMISSION FOUND");
    console.log("=================================");

    console.log({
      commissionId:
        commission.id,

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
        Number(
          commission.orderTotal
        ),

      eligibleAmount:
        Number(
          commission.eligibleAmount
        ),

      commissionRate:
        Number(
          commission.commissionRate
        ),

      commissionAmount:
        Number(
          commission.commissionAmount
        ),

      status:
        commission.status,
    });

    console.log("=================================");

    /*
     * ==========================================================
     * 7. CHECK IF ALREADY CANCELLED
     * ==========================================================
     *
     * Shopify webhooks can be delivered more than once.
     *
     * If the commission is already CANCELLED, there is nothing
     * else to do.
     *
     * This makes the webhook idempotent.
     */

    if (
      commission.status ===
      "CANCELLED"
    ) {
      console.log("=================================");
      console.log(
        "COMMISSION ALREADY CANCELLED"
      );
      console.log("=================================");

      console.log({
        commissionId:
          commission.id,

        shopifyOrderId:
          commission.shopifyOrderId,

        status:
          commission.status,

        commissionAmount:
          Number(
            commission.commissionAmount
          ),
      });

      console.log("No update required.");

      console.log("=================================");

      return new Response("OK", {
        status: 200,
      });
    }

    /*
     * ==========================================================
     * 8. CANCEL COMMISSION
     * ==========================================================
     *
     * IMPORTANT:
     *
     * We keep:
     *
     * - Original orderTotal
     * - Original eligibleAmount
     * - Original commissionRate
     *
     * because these values represent what the commission
     * originally would have been.
     *
     * We change:
     *
     * - commissionAmount → 0
     * - status → CANCELLED
     *
     * This gives you a complete audit trail.
     */

    const cancelledCommission =
      await prisma.commission.update({
        where: {
          id: commission.id,
        },

        data: {
          commissionAmount: 0,

          status: "CANCELLED",
        },
      });

    /*
     * ==========================================================
     * 9. LOG UPDATED COMMISSION
     * ==========================================================
     */

    console.log("=================================");
    console.log(
      "COMMISSION SUCCESSFULLY CANCELLED"
    );
    console.log("=================================");

    console.log({
      commissionId:
        cancelledCommission.id,

      tradeAccountId:
        cancelledCommission.tradeAccountId,

      clientSpecialOfferId:
        cancelledCommission.clientSpecialOfferId,

      shopifyOrderId:
        cancelledCommission.shopifyOrderId,

      orderNumber:
        cancelledCommission.orderNumber,

      originalOrderTotal:
        Number(
          cancelledCommission.orderTotal
        ),

      originalEligibleAmount:
        Number(
          cancelledCommission.eligibleAmount
        ),

      originalCommissionRate:
        Number(
          cancelledCommission.commissionRate
        ),

      finalCommissionAmount:
        Number(
          cancelledCommission.commissionAmount
        ),

      finalStatus:
        cancelledCommission.status,
    });

    console.log("=================================");

    /*
     * ==========================================================
     * 10. SUCCESS
     * ==========================================================
     */

    return new Response("OK", {
      status: 200,
    });
  } catch (error) {
    /*
     * ==========================================================
     * ERROR HANDLING
     * ==========================================================
     */

    console.error("=================================");
    console.error(
      "ORDER CANCELLED WEBHOOK ERROR"
    );
    console.error("=================================");

    console.error(error);

    console.error("=================================");

    /*
     * Return 500 so Shopify knows that the webhook processing
     * failed and can retry the webhook.
     */

    return new Response(
      "Webhook processing failed",
      {
        status: 500,
      }
    );
  }
};