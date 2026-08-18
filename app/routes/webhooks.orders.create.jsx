import prisma from "../db.server";
import { authenticate } from "../shopify.server";


/* ============================================================
   SHOPIFY ORDER CREATE WEBHOOK
============================================================ */

export const action = async ({ request }) => {
  console.log("=================================");
  console.log("SHOPIFY ORDER CREATE WEBHOOK HIT");
  console.log("=================================");

  try {
    const { payload, shop, topic } =
      await authenticate.webhook(request);

    const order = payload;


    /* ==========================================================
       WEBHOOK INFORMATION
    ========================================================== */

    console.log("SHOP:", shop);
    console.log("TOPIC:", topic);
    console.log("ORDER ID:", order.id);
    console.log("ORDER NUMBER:", order.order_number);
    console.log("CUSTOMER:", order.customer?.email);


    /* ==========================================================
       1. PREPARE ORDER VALUES
    ========================================================== */

    const shopifyOrderId =
      String(order.id);


    const orderNumber =
      order.order_number
        ? String(order.order_number)
        : null;


    /*
     * ----------------------------------------------------------
     * CUSTOMER PAID PRODUCT TOTAL
     * ----------------------------------------------------------
     *
     * This is the product subtotal AFTER discounts.
     *
     * Example:
     *
     * Product price: £100
     * Client discount: 10%
     * Customer pays: £90
     *
     * orderTotal = £90
     */

    const orderTotal =
      Number(
        order.current_subtotal_price ??
        order.subtotal_price ??
        order.total_price ??
        0
      );


    /*
     * ----------------------------------------------------------
     * ORIGINAL PRODUCT VALUE
     * ----------------------------------------------------------
     *
     * We calculate the original merchandise value from
     * the line items BEFORE discounts.
     *
     * Example:
     *
     * Product price: £100
     * Quantity: 1
     *
     * originalOrderValue = £100
     *
     * IMPORTANT:
     *
     * Client Special Price commission must be calculated
     * from this value.
     */

    const originalOrderValue =
      Array.isArray(order.line_items)
        ? order.line_items.reduce(
            (total, item) => {
              const originalPrice =
                Number(
                  item.original_price ??
                  item.price ??
                  0
                );

              const quantity =
                Number(
                  item.quantity ?? 0
                );

              return (
                total +
                (
                  originalPrice *
                  quantity
                )
              );
            },
            0
          )
        : 0;


    console.log(
      "================================="
    );

    console.log(
      "ORDER VALUES"
    );

    console.log({
      shopifyOrderId,
      orderNumber,
      orderTotal,
      originalOrderValue,
    });

    console.log(
      "================================="
    );


    /*
     * ============================================================
     * 2. CUSTOMER INFORMATION
     * ============================================================
     */

    const customerEmail =
      order.customer?.email
        ?.toString()
        .trim();


    const shopifyCustomerId =
      order.customer?.id
        ? `gid://shopify/Customer/${order.customer.id}`
        : null;


    console.log(
      "================================="
    );

    console.log(
      "CUSTOMER INFORMATION"
    );

    console.log({
      customerEmail,
      shopifyCustomerId,
    });

    console.log(
      "================================="
    );


    /*
     * ============================================================
     * 3. FIND TRADE ACCOUNT
     * ============================================================
     *
     * First try Shopify Customer ID.
     *
     * If no account is found, fall back to email.
     */

    let tradeAccount = null;


    /* ----------------------------------------------------------
       FIND BY SHOPIFY CUSTOMER ID
    ---------------------------------------------------------- */

    if (shopifyCustomerId) {
      tradeAccount =
        await prisma.tradeAccount.findFirst({
          where: {
            shopifyCustomerId,

            status: "ACTIVE",
          },
        });


      if (tradeAccount) {
        console.log(
          "TRADE ACCOUNT FOUND BY SHOPIFY CUSTOMER ID"
        );
      }
    }


    /* ----------------------------------------------------------
       FALL BACK TO EMAIL
    ---------------------------------------------------------- */

    if (
      !tradeAccount &&
      customerEmail
    ) {
      tradeAccount =
        await prisma.tradeAccount.findFirst({
          where: {
            email: {
              equals: customerEmail,
              mode: "insensitive",
            },

            status: "ACTIVE",
          },
        });


      if (tradeAccount) {
        console.log(
          "TRADE ACCOUNT FOUND BY EMAIL"
        );
      }
    }


    /*
     * ============================================================
     * 4. NO TRADE ACCOUNT
     * ============================================================
     */

    if (!tradeAccount) {
      console.log(
        "NO ACTIVE TRADE ACCOUNT FOUND"
      );

      console.log(
        "ORDER DOES NOT BELONG TO A TRADE ACCOUNT"
      );

      return new Response(
        "OK",
        {
          status: 200,
        }
      );
    }


    /*
     * ============================================================
     * 5. TRADE ACCOUNT FOUND
     * ============================================================
     */

    console.log(
      "================================="
    );

    console.log(
      "TRADE ACCOUNT FOUND"
    );

    console.log({
      tradeAccountId:
        tradeAccount.id,

      businessName:
        tradeAccount.businessName,

      email:
        tradeAccount.email,

      shopifyCustomerId:
        tradeAccount.shopifyCustomerId,

      pricingOption:
        tradeAccount.pricingOption,

      discountPercent:
        Number(
          tradeAccount.discountPercent
        ),

      commissionPercent:
        Number(
          tradeAccount.commissionPercent
        ),

      referralCode:
        tradeAccount.referralCode,

      status:
        tradeAccount.status,
    });

    console.log(
      "================================="
    );


    /*
     * ============================================================
     * 6. GET DISCOUNT CODES
     * ============================================================
     */

    const discountCodes =
      Array.isArray(
        order.discount_codes
      )
        ? order.discount_codes
        : [];


    console.log(
      "================================="
    );

    console.log(
      "DISCOUNT CODES"
    );

    console.log(
      discountCodes
    );

    console.log(
      "================================="
    );


    /*
     * ============================================================
     * 7. FIND CLIENT SPECIAL OFFER
     * ============================================================
     *
     * We check every discount code used on the order.
     *
     * If a discount code matches an ACTIVE ClientSpecialOffer
     * belonging to this TradeAccount, we use that offer's
     * commission percentage.
     */

    let clientSpecialOffer = null;


    for (
      const discount of discountCodes
    ) {
      const code =
        discount?.code
          ?.toString()
          .trim()
          .toUpperCase();


      if (!code) {
        continue;
      }


      console.log(
        "CHECKING DISCOUNT CODE:",
        code
      );


      const offer =
        await prisma.clientSpecialOffer.findFirst({
          where: {
            discountCode: {
              equals: code,
              mode: "insensitive",
            },

            tradeAccountId:
              tradeAccount.id,

            status:
              "ACTIVE",
          },
        });


      if (offer) {
        /*
         * --------------------------------------------------------
         * EXPIRY CHECK
         * --------------------------------------------------------
         */

        const now =
          new Date();


        if (
          offer.expiresAt &&
          new Date(
            offer.expiresAt
          ) < now
        ) {
          console.log(
            "CLIENT SPECIAL OFFER IS EXPIRED"
          );

          console.log({
            clientSpecialOfferId:
              offer.id,

            discountCode:
              offer.discountCode,

            expiresAt:
              offer.expiresAt,
          });

          continue;
        }


        clientSpecialOffer =
          offer;


        console.log(
          "================================="
        );

        console.log(
          "CLIENT SPECIAL OFFER FOUND"
        );

        console.log({
          clientSpecialOfferId:
            clientSpecialOffer.id,

          tradeAccountId:
            clientSpecialOffer.tradeAccountId,

          discountCode:
            clientSpecialOffer.discountCode,

          allocationPercent:
            Number(
              clientSpecialOffer.allocationPercent
            ),

          clientDiscountPercent:
            Number(
              clientSpecialOffer.clientDiscountPercent
            ),

          commissionPercent:
            Number(
              clientSpecialOffer.commissionPercent
            ),

          status:
            clientSpecialOffer.status,

          expiresAt:
            clientSpecialOffer.expiresAt,
        });

        console.log(
          "================================="
        );


        break;
      }
    }


    /*
     * ============================================================
     * 8. FIND REFERRAL
     * ============================================================
     *
     * We also check whether one of the discount codes
     * belongs to a Referral record.
     */

    let referralId = null;


    for (
      const discount of discountCodes
    ) {
      const code =
        discount?.code
          ?.toString()
          .trim();


      if (!code) {
        continue;
      }


      const referral =
        await prisma.referral.findFirst({
          where: {
            referralCode: {
              equals: code,
              mode: "insensitive",
            },

            tradeAccountId:
              tradeAccount.id,
          },
        });


      if (referral) {
        referralId =
          referral.id;


        console.log(
          "REFERRAL FOUND:",
          referral.id
        );


        break;
      }
    }


    /*
     * ============================================================
     * 9. CALCULATE COMMISSION
     * ============================================================
     */

    let commissionRate = 0;


    /*
     * eligibleAmount is the amount on which commission
     * will be calculated.
     */

    let eligibleAmount =
      orderTotal;


    /*
     * ------------------------------------------------------------
     * TRADE PRICE
     * ------------------------------------------------------------
     *
     * Designer purchases products themselves using their
     * trade discount.
     *
     * No commission.
     */

    if (
      tradeAccount.pricingOption ===
      "TRADE_PRICE"
    ) {
      commissionRate = 0;


      console.log(
        "================================="
      );

      console.log(
        "PRICING OPTION: TRADE_PRICE"
      );

      console.log(
        "COMMISSION: 0%"
      );

      console.log(
        "================================="
      );
    }


    /*
     * ------------------------------------------------------------
     * REFERRAL
     * ------------------------------------------------------------
     *
     * Commission is calculated using the TradeAccount's
     * configured commission percentage.
     *
     * Commission is currently based on the customer's
     * product subtotal.
     */

    if (
      tradeAccount.pricingOption ===
      "REFERRAL"
    ) {
      commissionRate =
        Number(
          tradeAccount.commissionPercent
        ) || 0;


      eligibleAmount =
        orderTotal;


      console.log(
        "================================="
      );

      console.log(
        "PRICING OPTION: REFERRAL"
      );

      console.log(
        "COMMISSION RATE:",
        commissionRate
      );

      console.log(
        "ELIGIBLE AMOUNT:",
        eligibleAmount
      );

      console.log(
        "================================="
      );
    }


    /*
     * ------------------------------------------------------------
     * CLIENT SPECIAL PRICE
     * ------------------------------------------------------------
     *
     * IMPORTANT BUSINESS LOGIC:
     *
     * Example:
     *
     * Original product price: £100
     *
     * Designer allocation: 15%
     *
     * Client discount: 10%
     * Designer commission: 5%
     *
     * Customer pays:
     *
     * £100 - 10% = £90
     *
     * BUT the designer's commission is calculated
     * from the ORIGINAL product value:
     *
     * £100 × 5% = £5
     *
     * NOT:
     *
     * £90 × 5% = £4.50
     */

    if (
      tradeAccount.pricingOption ===
      "CLIENT_SPECIAL_PRICE"
    ) {
      /*
       * We only calculate commission if the order
       * actually used a valid Client Special Offer.
       */

      if (clientSpecialOffer) {
        commissionRate =
          Number(
            clientSpecialOffer.commissionPercent
          ) || 0;


        /*
         * IMPORTANT
         *
         * Use the ORIGINAL product value before
         * the customer discount.
         */

        eligibleAmount =
          originalOrderValue;


        console.log(
          "================================="
        );

        console.log(
          "PRICING OPTION: CLIENT_SPECIAL_PRICE"
        );

        console.log(
          "CLIENT SPECIAL OFFER:",
          clientSpecialOffer.id
        );

        console.log(
          "DISCOUNT CODE:",
          clientSpecialOffer.discountCode
        );

        console.log(
          "ORIGINAL ORDER VALUE:",
          originalOrderValue
        );

        console.log(
          "CUSTOMER PAID:",
          orderTotal
        );

        console.log(
          "COMMISSION RATE:",
          commissionRate
        );

        console.log(
          "================================="
        );
      } else {
        /*
         * Client Special Price account, but no valid
         * Client Special Offer discount code was found.
         *
         * Therefore no commission is created.
         */

        commissionRate = 0;


        console.log(
          "================================="
        );

        console.log(
          "CLIENT_SPECIAL_PRICE BUT NO VALID CLIENT SPECIAL OFFER FOUND"
        );

        console.log(
          "COMMISSION: 0%"
        );

        console.log(
          "================================="
        );
      }
    }


    /*
     * ============================================================
     * 10. SAFETY CHECK
     * ============================================================
     */

    if (
      commissionRate < 0 ||
      commissionRate > 100
    ) {
      console.error(
        "INVALID COMMISSION RATE:",
        commissionRate
      );

      commissionRate = 0;
    }


    /*
     * ============================================================
     * 11. CALCULATE COMMISSION AMOUNT
     * ============================================================
     */

    const commissionAmount =
      Number(
        (
          eligibleAmount *
          (
            commissionRate / 100
          )
        ).toFixed(2)
      );


    console.log(
      "================================="
    );

    console.log(
      "COMMISSION CALCULATION"
    );

    console.log({
      originalOrderValue,
      orderTotal,
      eligibleAmount,
      commissionRate,
      commissionAmount,

      clientSpecialOfferId:
        clientSpecialOffer
          ? clientSpecialOffer.id
          : null,

      referralId,
    });

    console.log(
      "================================="
    );


    /*
     * ============================================================
     * 12. SAVE COMMISSION
     * ============================================================
     *
     * Shopify can send duplicate webhooks.
     *
     * shopifyOrderId is unique.
     *
     * Therefore upsert prevents duplicate commission records.
     */

    const commission =
      await prisma.commission.upsert({
        where: {
          shopifyOrderId:
            shopifyOrderId,
        },


        /*
         * --------------------------------------------------------
         * UPDATE EXISTING COMMISSION
         * --------------------------------------------------------
         */

        update: {
          tradeAccountId:
            tradeAccount.id,

          referralId:
            referralId,

          clientSpecialOfferId:
            clientSpecialOffer
              ? clientSpecialOffer.id
              : null,

          orderNumber:
            orderNumber,

          /*
           * Customer-paid subtotal after discount.
           */

          orderTotal:
            orderTotal,

          /*
           * Amount used to calculate commission.
           *
           * For Client Special Price:
           * original product value.
           */

          eligibleAmount:
            eligibleAmount,

          commissionRate:
            commissionRate,

          commissionAmount:
            commissionAmount,
        },


        /*
         * --------------------------------------------------------
         * CREATE NEW COMMISSION
         * --------------------------------------------------------
         */

        create: {
          tradeAccountId:
            tradeAccount.id,

          referralId:
            referralId,

          clientSpecialOfferId:
            clientSpecialOffer
              ? clientSpecialOffer.id
              : null,

          shopifyOrderId:
            shopifyOrderId,

          orderNumber:
            orderNumber,

          /*
           * Customer-paid subtotal after discount.
           */

          orderTotal:
            orderTotal,

          /*
           * Amount used for commission calculation.
           */

          eligibleAmount:
            eligibleAmount,

          commissionRate:
            commissionRate,

          commissionAmount:
            commissionAmount,

          status:
            "PENDING",
        },
      });


    /*
     * ============================================================
     * 13. LOG RESULT
     * ============================================================
     */

    console.log(
      "================================="
    );

    console.log(
      "ORDER / COMMISSION RECORD SAVED"
    );

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

      /*
       * What customer paid after discount.
       */

      orderTotal:
        Number(
          commission.orderTotal
        ),

      /*
       * Original amount used to calculate commission.
       */

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

    console.log(
      "================================="
    );


    /*
     * ============================================================
     * 14. SUCCESS
     * ============================================================
     */

    return new Response(
      "OK",
      {
        status: 200,
      }
    );

  } catch (error) {

    console.error(
      "================================="
    );

    console.error(
      "ORDER WEBHOOK ERROR"
    );

    console.error(error);

    console.error(
      "================================="
    );


    /*
     * Return 500 so Shopify knows that
     * processing failed.
     */

    return new Response(
      "Webhook processing failed",
      {
        status: 500,
      }
    );
  }
};