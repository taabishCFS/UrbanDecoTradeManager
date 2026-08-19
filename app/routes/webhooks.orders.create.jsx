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
     * Example CLIENT SPECIAL PRICE:
     *
     * Original product value: £100
     * Customer discount: 10%
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
     * Used by CLIENT_SPECIAL_PRICE.
     *
     * Example:
     *
     * Product: £100
     * Customer pays: £90
     *
     * originalOrderValue = £100
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

    /* ==========================================================
       2. CUSTOMER INFORMATION
       ========================================================== */

    const customerEmail =
      order.customer?.email
        ?.toString()
        .trim() || null;

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

    /* ==========================================================
       3. READ ORDER NOTE ATTRIBUTES
       ==========================================================
       
       Referral orders use:
       
       UD Referral ID
       UD Referral Session
       
       Client Special Price orders use:
       
       Shopify discount code
       
       The customer purchasing a Client Special Price order
       does NOT need to be the designer's Trade Account.
    */

    const noteAttributes =
      Array.isArray(order.note_attributes)
        ? order.note_attributes
        : [];

    console.log(
      "================================="
    );

    console.log(
      "ORDER NOTE ATTRIBUTES"
    );

    console.log(
      noteAttributes
    );

    console.log(
      "================================="
    );

    /* ==========================================================
       4. FIND REFERRAL INFORMATION
       ========================================================== */

    const referralIdFromOrder =
      noteAttributes.find(
        (attribute) =>
          attribute?.name ===
          "UD Referral ID"
      )?.value
        ?.toString()
        .trim() || null;

    const referralSessionFromOrder =
      noteAttributes.find(
        (attribute) =>
          attribute?.name ===
          "UD Referral Session"
      )?.value
        ?.toString()
        .trim() || null;

    console.log(
      "================================="
    );

    console.log(
      "REFERRAL ATTRIBUTES"
    );

    console.log({
      referralIdFromOrder,
      referralSessionFromOrder,
    });

    console.log(
      "================================="
    );

    /* ==========================================================
       5. FIND REFERRAL
       ========================================================== */

    let referral = null;
    let referralId = null;

    if (referralIdFromOrder) {
      referral =
        await prisma.referral.findFirst({
          where: {
            id:
              referralIdFromOrder,
          },

          include: {
            tradeAccount: true,
          },
        });

      if (referral) {
        referralId =
          referral.id;

        console.log(
          "================================="
        );

        console.log(
          "REFERRAL FOUND FROM ORDER ATTRIBUTES"
        );

        console.log({
          referralId:
            referral.id,

          referralCode:
            referral.referralCode,

          tradeAccountId:
            referral.tradeAccountId,

          landingSessionId:
            referral.landingSessionId,

          orderReferralSession:
            referralSessionFromOrder,

          referralTradeAccountPricingOption:
            referral.tradeAccount?.pricingOption,

          referralTradeAccountCommissionPercent:
            Number(
              referral.tradeAccount?.commissionPercent ?? 0
            ),
        });

        console.log(
          "================================="
        );
      } else {
        console.log(
          "REFERRAL ID FOUND IN ORDER BUT NO MATCHING REFERRAL RECORD"
        );

        console.log(
          "REFERRAL ID:",
          referralIdFromOrder
        );
      }
    } else {
      console.log(
        "NO UD REFERRAL ID FOUND ON ORDER"
      );
    }

    /* ==========================================================
       6. READ DISCOUNT CODES
       ==========================================================
       
       IMPORTANT:
       
       This happens BEFORE Trade Account lookup.
       
       Why?
       
       A Client Special Price customer is NOT necessarily
       the designer's Shopify customer.
       
       Example:
       
       Designer:
       Urban Deco
       
       Trade Account:
       cmsx5hjo80001fercdrf9ipov
       
       Client Special Offer:
       DESIGNER25
       
       Customer:
       test@example.com
       
       The customer's email cannot identify Urban Deco.
       
       DESIGNER25 DOES identify the ClientSpecialOffer,
       and the ClientSpecialOffer identifies Urban Deco.
    */

    const discountCodes =
      Array.isArray(order.discount_codes)
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

    /* ==========================================================
       7. FIND CLIENT SPECIAL OFFER FROM DISCOUNT CODE
       ==========================================================
       
       IMPORTANT:
       
       We DO NOT require a Trade Account here.
       
       The discount code itself is used to locate the
       ClientSpecialOffer.
       
       Then the ClientSpecialOffer gives us:
       
       clientSpecialOffer.tradeAccountId
       
       and:
       
       clientSpecialOffer.tradeAccount
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
        "CHECKING CLIENT SPECIAL DISCOUNT CODE:",
        code
      );

      const offer =
        await prisma.clientSpecialOffer.findFirst({
          where: {
            discountCode: {
              equals:
                code,

              mode:
                "insensitive",
            },

            status:
              "ACTIVE",
          },

          include: {
            tradeAccount: true,
          },
        });

      /*
       * --------------------------------------------------------
       * NO CLIENT SPECIAL OFFER FOR THIS CODE
       * --------------------------------------------------------
       */

      if (!offer) {
        console.log(
          "NO CLIENT SPECIAL OFFER FOUND FOR CODE:",
          code
        );

        continue;
      }

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

      /*
       * --------------------------------------------------------
       * ACTIVE TRADE ACCOUNT CHECK
       * --------------------------------------------------------
       */

      if (
        !offer.tradeAccount ||
        offer.tradeAccount.status !==
          "ACTIVE"
      ) {
        console.log(
          "CLIENT SPECIAL OFFER HAS NO ACTIVE TRADE ACCOUNT"
        );

        console.log({
          clientSpecialOfferId:
            offer.id,

          tradeAccountId:
            offer.tradeAccountId,

          tradeAccountStatus:
            offer.tradeAccount?.status ?? null,
        });

        continue;
      }

      /*
       * --------------------------------------------------------
       * CLIENT SPECIAL OFFER FOUND
       * --------------------------------------------------------
       */

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
          offer.id,

        tradeAccountId:
          offer.tradeAccountId,

        tradeAccountBusinessName:
          offer.tradeAccount.businessName,

        discountCode:
          offer.discountCode,

        allocationPercent:
          Number(
            offer.allocationPercent
          ),

        clientDiscountPercent:
          Number(
            offer.clientDiscountPercent
          ),

        commissionPercent:
          Number(
            offer.commissionPercent
          ),

        status:
          offer.status,

        expiresAt:
          offer.expiresAt,
      });

      console.log(
        "================================="
      );

      /*
       * We found the Client Special Offer.
       *
       * There is no reason to check any other discount code.
       */

      break;
    }

    /* ==========================================================
       8. FIND TRADE ACCOUNT
       ==========================================================
       
       PRIORITY:
       
       1. CLIENT SPECIAL OFFER
          ↓
          ClientSpecialOffer.tradeAccount
       
       2. REFERRAL
          ↓
          Referral.tradeAccount
       
       3. NORMAL TRADE ACCOUNT
          ↓
          Shopify Customer ID / Email
       
       This order is VERY IMPORTANT.
    */

    let tradeAccount = null;

    /* ==========================================================
       8A. CLIENT SPECIAL PRICE TRADE ACCOUNT
       ==========================================================
       
       This is the critical fix.
       
       The purchaser is the designer's CLIENT.
       
       Therefore:
       
       customerEmail != designerEmail
       
       Instead:
       
       discountCode
          ↓
       ClientSpecialOffer
          ↓
       TradeAccount
    */

    if (
      clientSpecialOffer &&
      clientSpecialOffer.tradeAccount
    ) {
      tradeAccount =
        clientSpecialOffer.tradeAccount;

      console.log(
        "================================="
      );

      console.log(
        "TRADE ACCOUNT FOUND FROM CLIENT SPECIAL OFFER"
      );

      console.log({
        tradeAccountId:
          tradeAccount.id,

        businessName:
          tradeAccount.businessName,

        email:
          tradeAccount.email,

        pricingOption:
          tradeAccount.pricingOption,

        commissionPercent:
          Number(
            tradeAccount.commissionPercent
          ),

        clientSpecialOfferId:
          clientSpecialOffer.id,

        discountCode:
          clientSpecialOffer.discountCode,
      });

      console.log(
        "================================="
      );
    }

    /* ==========================================================
       8B. REFERRAL TRADE ACCOUNT
       ========================================================== */

    if (
      !tradeAccount &&
      referral &&
      referral.tradeAccount
    ) {
      tradeAccount =
        referral.tradeAccount;

      console.log(
        "================================="
      );

      console.log(
        "TRADE ACCOUNT FOUND FROM REFERRAL"
      );

      console.log({
        tradeAccountId:
          tradeAccount.id,

        businessName:
          tradeAccount.businessName,

        email:
          tradeAccount.email,

        pricingOption:
          tradeAccount.pricingOption,

        commissionPercent:
          Number(
            tradeAccount.commissionPercent
          ),

        referralCode:
          tradeAccount.referralCode,
      });

      console.log(
        "================================="
      );
    }

    /* ==========================================================
       8C. NORMAL TRADE ACCOUNT LOOKUP
       ==========================================================
       
       This is only used when the order has not already been
       associated with a Client Special Offer or Referral.
    */

    if (!tradeAccount) {
      /*
       * --------------------------------------------------------
       * FIND BY SHOPIFY CUSTOMER ID
       * --------------------------------------------------------
       */

      if (shopifyCustomerId) {
        tradeAccount =
          await prisma.tradeAccount.findFirst({
            where: {
              shopifyCustomerId,

              status:
                "ACTIVE",
            },
          });

        if (tradeAccount) {
          console.log(
            "TRADE ACCOUNT FOUND BY SHOPIFY CUSTOMER ID"
          );
        }
      }

      /*
       * --------------------------------------------------------
       * FALL BACK TO EMAIL
       * --------------------------------------------------------
       */

      if (
        !tradeAccount &&
        customerEmail
      ) {
        tradeAccount =
          await prisma.tradeAccount.findFirst({
            where: {
              email: {
                equals:
                  customerEmail,

                mode:
                  "insensitive",
              },

              status:
                "ACTIVE",
            },
          });

        if (tradeAccount) {
          console.log(
            "TRADE ACCOUNT FOUND BY EMAIL"
          );
        }
      }
    }

    /* ==========================================================
       9. NO TRADE ACCOUNT
       ==========================================================
       
       If there is:
       
       - no Client Special Offer owner
       - no Referral owner
       - no normal Trade Account
       
       then this is simply a normal Shopify order.
    */

    if (!tradeAccount) {
      console.log(
        "================================="
      );

      console.log(
        "NO ACTIVE TRADE ACCOUNT FOUND"
      );

      console.log(
        "ORDER DOES NOT BELONG TO A TRADE ACCOUNT"
      );

      console.log({
        shopifyOrderId,
        orderNumber,
        customerEmail,
        discountCodes,
      });

      console.log(
        "================================="
      );

      return new Response(
        "OK",
        {
          status: 200,
        }
      );
    }

    /* ==========================================================
       10. TRADE ACCOUNT FOUND
       ========================================================== */

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

      referralId,

      clientSpecialOfferId:
        clientSpecialOffer
          ? clientSpecialOffer.id
          : null,

      clientSpecialOfferDiscountCode:
        clientSpecialOffer
          ? clientSpecialOffer.discountCode
          : null,
    });

    console.log(
      "================================="
    );

    /* ==========================================================
       11. DETERMINE PRICING OPTION
       ========================================================== */

    let commissionRate = 0;

    /*
     * ----------------------------------------------------------
     * ELIGIBLE AMOUNT
     * ----------------------------------------------------------
     *
     * Default:
     *
     * Customer-paid subtotal.
     */

    let eligibleAmount =
      orderTotal;

    /* ==========================================================
       12. TRADE PRICE
       ==========================================================
       
       Designer purchases products themselves.
       
       No commission.
    */

    if (
      tradeAccount.pricingOption ===
      "TRADE_PRICE"
    ) {
      commissionRate =
        0;

      eligibleAmount =
        orderTotal;

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

    /* ==========================================================
       13. REFERRAL
       ==========================================================
       
       Referral orders:
       
       Customer pays normal retail price.
       
       Designer receives their configured referral commission.
       
       Example:
       
       Retail:
       £1,000
       
       Commission:
       15%
       
       Customer pays:
       £1,000
       
       Designer earns:
       £150
    */

    if (
      tradeAccount.pricingOption ===
      "REFERRAL"
    ) {
      /*
       * --------------------------------------------------------
       * VALID REFERRAL REQUIRED
       * --------------------------------------------------------
       */

      if (
        referral &&
        referral.tradeAccountId ===
          tradeAccount.id
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
          "VALID REFERRAL: YES"
        );

        console.log(
          "REFERRAL ID:",
          referral.id
        );

        console.log(
          "REFERRAL CODE:",
          referral.referralCode
        );

        console.log(
          "COMMISSION RATE:",
          commissionRate
        );

        console.log(
          "CUSTOMER RETAIL SUBTOTAL:",
          orderTotal
        );

        console.log(
          "ELIGIBLE AMOUNT:",
          eligibleAmount
        );

        console.log(
          "CUSTOMER DISCOUNT: 0%"
        );

        console.log(
          "================================="
        );
      } else {
        /*
         * ------------------------------------------------------
         * REFERRAL ACCOUNT BUT INVALID REFERRAL
         * ------------------------------------------------------
         */

        commissionRate =
          0;

        eligibleAmount =
          orderTotal;

        console.log(
          "================================="
        );

        console.log(
          "REFERRAL ACCOUNT BUT NO VALID REFERRAL FOUND"
        );

        console.log(
          "COMMISSION: 0%"
        );

        console.log(
          "================================="
        );
      }
    }

    /* ==========================================================
       14. CLIENT SPECIAL PRICE
       ==========================================================
       
       BUSINESS RULE:
       
       Allocation:
       15%
       
       Customer discount:
       10%
       
       Designer commission:
       5%
       
       Product original value:
       £100
       
       Customer pays:
       £90
       
       Designer commission:
       £5
       
       IMPORTANT:
       
       Commission is calculated from ORIGINAL product value,
       not the customer's discounted payment.
       
       Therefore:
       
       eligibleAmount = originalOrderValue
    */

    if (
      tradeAccount.pricingOption ===
      "CLIENT_SPECIAL_PRICE"
    ) {
      /*
       * --------------------------------------------------------
       * VALID CLIENT SPECIAL OFFER REQUIRED
       * --------------------------------------------------------
       */

      if (
        clientSpecialOffer &&
        clientSpecialOffer.tradeAccountId ===
          tradeAccount.id
      ) {
        commissionRate =
          Number(
            clientSpecialOffer.commissionPercent
          ) || 0;

        /*
         * IMPORTANT:
         *
         * Commission is based on the original product value.
         *
         * Example:
         *
         * Original = £100
         * Customer discount = 10%
         * Customer pays = £90
         * Commission = 5%
         *
         * Commission:
         *
         * £100 × 5% = £5
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
          "VALID CLIENT SPECIAL OFFER: YES"
        );

        console.log(
          "CLIENT SPECIAL OFFER ID:",
          clientSpecialOffer.id
        );

        console.log(
          "TRADE ACCOUNT ID:",
          tradeAccount.id
        );

        console.log(
          "TRADE ACCOUNT:",
          tradeAccount.businessName
        );

        console.log(
          "DISCOUNT CODE:",
          clientSpecialOffer.discountCode
        );

        console.log(
          "ALLOCATION PERCENT:",
          Number(
            clientSpecialOffer.allocationPercent
          )
        );

        console.log(
          "CLIENT DISCOUNT PERCENT:",
          Number(
            clientSpecialOffer.clientDiscountPercent
          )
        );

        console.log(
          "DESIGNER COMMISSION PERCENT:",
          commissionRate
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
          "ELIGIBLE AMOUNT:",
          eligibleAmount
        );

        console.log(
          "================================="
        );
      } else {
        /*
         * ------------------------------------------------------
         * NO VALID CLIENT SPECIAL OFFER
         * ------------------------------------------------------
         */

        commissionRate =
          0;

        eligibleAmount =
          orderTotal;

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

    /* ==========================================================
       15. SAFETY CHECK
       ========================================================== */

    if (
      commissionRate < 0 ||
      commissionRate > 100
    ) {
      console.error(
        "INVALID COMMISSION RATE:",
        commissionRate
      );

      commissionRate =
        0;
    }

    /* ==========================================================
       16. CALCULATE COMMISSION AMOUNT
       ========================================================== */

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

      tradeAccountId:
        tradeAccount.id,

      tradeAccountBusinessName:
        tradeAccount.businessName,

      clientSpecialOfferId:
        clientSpecialOffer
          ? clientSpecialOffer.id
          : null,

      clientSpecialOfferDiscountCode:
        clientSpecialOffer
          ? clientSpecialOffer.discountCode
          : null,

      clientDiscountPercent:
        clientSpecialOffer
          ? Number(
              clientSpecialOffer.clientDiscountPercent
            )
          : 0,

      allocationPercent:
        clientSpecialOffer
          ? Number(
              clientSpecialOffer.allocationPercent
            )
          : 0,

      referralId,

      referralCode:
        referral
          ? referral.referralCode
          : null,
    });

    console.log(
      "================================="
    );

    /* ==========================================================
       17. SAVE COMMISSION
       ==========================================================
       
       Shopify can send duplicate webhooks.
       
       shopifyOrderId is unique.
       
       Therefore upsert prevents duplicate commission records.
    */

    const commission =
      await prisma.commission.upsert({
        where: {
          shopifyOrderId:
            shopifyOrderId,
        },

        /* ------------------------------------------------------
           UPDATE EXISTING COMMISSION
        ------------------------------------------------------ */

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
           * REFERRAL:
           * customer-paid retail subtotal.
           *
           * CLIENT SPECIAL PRICE:
           * original product value.
           */

          eligibleAmount:
            eligibleAmount,

          commissionRate:
            commissionRate,

          commissionAmount:
            commissionAmount,
        },

        /* ------------------------------------------------------
           CREATE NEW COMMISSION
        ------------------------------------------------------ */

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
           * Amount used to calculate commission.
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

    /* ==========================================================
       18. LOG RESULT
       ========================================================== */

    console.log(
      "================================="
    );

    console.log(
      "ORDER / COMMISSION RECORD SAVED"
    );

    console.log(
      "================================="
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
       * What customer actually paid after discount.
       */

      orderTotal:
        Number(
          commission.orderTotal
        ),

      /*
       * Amount used to calculate commission.
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

    /* ==========================================================
       19. SUCCESS
       ========================================================== */

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