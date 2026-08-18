import {
  Form,
  useLoaderData,
  useNavigation,
  useActionData,
} from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

import {
  createTradePriceDiscount,
  deleteTradePriceDiscount,
} from "../services/trade-price.server";


/* ============================================================
   LOADER
============================================================ */

export async function loader({ request, params }) {
  await authenticate.admin(request);

  console.log("=================================");
  console.log("TRADE ACCOUNT DETAIL ROUTE HIT");
  console.log("ID:", params.id);
  console.log("=================================");

  const account =
    await prisma.tradeAccount.findUnique({
      where: {
        id: params.id,
      },

      include: {
        application: true,

        referrals: {
          orderBy: {
            createdAt: "desc",
          },
        },

        commissions: {
          orderBy: {
            createdAt: "desc",
          },
        },

        clientSpecialOffers: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

  if (!account) {
    throw new Response(
      "Trade account not found",
      {
        status: 404,
      }
    );
  }

  return {
    account: {
      id:
        account.id,

      applicationId:
        account.applicationId,

      shopifyCustomerId:
        account.shopifyCustomerId,

      shopifyTradeDiscountId:
        account.shopifyTradeDiscountId,

      email:
        account.email,

      businessName:
        account.businessName,

      /* --------------------------------------------------------
         STANDARD PRICING
      -------------------------------------------------------- */

      discountPercent:
        Number(account.discountPercent),

      commissionPercent:
        Number(account.commissionPercent),

      pricingOption:
        account.pricingOption,

      /* --------------------------------------------------------
         ACCOUNT
      -------------------------------------------------------- */

      referralCode:
        account.referralCode,

      status:
        account.status,

      createdAt:
        account.createdAt,

      updatedAt:
        account.updatedAt,

      /* --------------------------------------------------------
         APPLICATION
      -------------------------------------------------------- */

      application:
        account.application,

      /* --------------------------------------------------------
         REFERRALS
      -------------------------------------------------------- */

      referrals:
        account.referrals.map(
          (referral) => ({
            id:
              referral.id,

            referralCode:
              referral.referralCode,

            landingSessionId:
              referral.landingSessionId,

            createdAt:
              referral.createdAt,
          })
        ),

      /* --------------------------------------------------------
         COMMISSIONS
      -------------------------------------------------------- */

      commissions:
        account.commissions.map(
          (commission) => ({
            id:
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

            createdAt:
              commission.createdAt,

            approvedAt:
              commission.approvedAt,

            paidAt:
              commission.paidAt,
          })
        ),

      /* --------------------------------------------------------
         CLIENT SPECIAL OFFERS
      -------------------------------------------------------- */

      clientSpecialOffers:
        account.clientSpecialOffers.map(
          (offer) => ({
            id:
              offer.id,

            discountCode:
              offer.discountCode,

            shopifyDiscountId:
              offer.shopifyDiscountId,

            shopifyCustomerId:
              offer.shopifyCustomerId,

            clientName:
              offer.clientName,

            clientEmail:
              offer.clientEmail,

            clientPhone:
              offer.clientPhone,

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

            createdAt:
              offer.createdAt,

            updatedAt:
              offer.updatedAt,
          })
        ),
    },
  };
}


/* ============================================================
   ACTION
============================================================ */

export async function action({
  request,
  params,
}) {
  const { admin } =
    await authenticate.admin(request);

  const formData =
    await request.formData();

  const intent =
    formData.get("intent");

  console.log("=================================");
  console.log("TRADE ACCOUNT ACTION");
  console.log("ID:", params.id);
  console.log("INTENT:", intent);
  console.log("=================================");


  /* ==========================================================
     SAVE PRICING OPTION
  ========================================================== */

  if (
    intent ===
    "savePricingOption"
  ) {
    const pricingOption =
      formData
        .get("pricingOption")
        ?.toString();


    const discountPercent =
      Number(
        formData.get(
          "discountPercent"
        ) || 0
      );


    const commissionPercent =
      Number(
        formData.get(
          "commissionPercent"
        ) || 0
      );


    /* ----------------------------------------------------------
       VALIDATE PRICING OPTION
    ---------------------------------------------------------- */

    const allowedPricingOptions = [
      "TRADE_PRICE",
      "REFERRAL",
      "CLIENT_SPECIAL_PRICE",
    ];


    if (
      !allowedPricingOptions.includes(
        pricingOption
      )
    ) {
      return {
        success: false,
        error:
          "Invalid pricing option.",
      };
    }


    /* ----------------------------------------------------------
       VALIDATE TRADE DISCOUNT
    ---------------------------------------------------------- */

    if (
      Number.isNaN(
        discountPercent
      ) ||
      discountPercent < 0 ||
      discountPercent > 100
    ) {
      return {
        success: false,
        error:
          "Trade discount must be between 0 and 100%.",
      };
    }


    /* ----------------------------------------------------------
       VALIDATE REFERRAL COMMISSION
    ---------------------------------------------------------- */

    if (
      Number.isNaN(
        commissionPercent
      ) ||
      commissionPercent < 0 ||
      commissionPercent > 100
    ) {
      return {
        success: false,
        error:
          "Commission must be between 0 and 100%.",
      };
    }


    /* ----------------------------------------------------------
       GET EXISTING ACCOUNT
    ---------------------------------------------------------- */

    const existingAccount =
      await prisma.tradeAccount.findUnique({
        where: {
          id: params.id,
        },
      });


    if (!existingAccount) {
      return {
        success: false,
        error:
          "Trade account not found.",
      };
    }


    /* ----------------------------------------------------------
       PRICING RULES
    ---------------------------------------------------------- */

    let finalDiscountPercent = 0;

    let finalCommissionPercent = 0;


    /*
     * TRADE PRICE
     *
     * Designer receives trade discount.
     * No commission.
     */

    if (
      pricingOption ===
      "TRADE_PRICE"
    ) {
      finalDiscountPercent =
        discountPercent;

      finalCommissionPercent = 0;
    }


    /*
     * REFERRAL
     *
     * No trade discount.
     * Designer receives referral commission.
     */

    if (
      pricingOption ===
      "REFERRAL"
    ) {
      finalDiscountPercent = 0;

      finalCommissionPercent =
        commissionPercent;
    }


    /*
     * CLIENT SPECIAL PRICE
     *
     * Each client offer has its own
     * discount + commission split.
     */

    if (
      pricingOption ===
      "CLIENT_SPECIAL_PRICE"
    ) {
      finalDiscountPercent = 0;

      finalCommissionPercent = 0;
    }


    /* ----------------------------------------------------------
       UPDATE DATABASE
    ---------------------------------------------------------- */

    const updatedAccount =
      await prisma.tradeAccount.update({
        where: {
          id: params.id,
        },

        data: {
          pricingOption,

          discountPercent:
            finalDiscountPercent,

          commissionPercent:
            finalCommissionPercent,
        },
      });


    console.log(
      "================================="
    );

    console.log(
      "PRICING OPTION SAVED"
    );

    console.log({
      id:
        updatedAccount.id,

      pricingOption:
        updatedAccount.pricingOption,

      discountPercent:
        Number(
          updatedAccount.discountPercent
        ),

      commissionPercent:
        Number(
          updatedAccount.commissionPercent
        ),

      existingShopifyTradeDiscountId:
        existingAccount.shopifyTradeDiscountId,
    });

    console.log(
      "================================="
    );


    /* ==========================================================
       SHOPIFY TRADE PRICE SYNC
    ========================================================== */

    try {

      /*
       * --------------------------------------------------------
       * TRADE PRICE ACTIVE
       * --------------------------------------------------------
       */

      if (
        pricingOption ===
        "TRADE_PRICE"
      ) {

        console.log(
          "================================="
        );

        console.log(
          "SYNCING TRADE PRICE TO SHOPIFY"
        );

        console.log({
          tradeAccountId:
            updatedAccount.id,

          businessName:
            updatedAccount.businessName,

          shopifyCustomerId:
            updatedAccount.shopifyCustomerId,

          discountPercent:
            Number(
              updatedAccount.discountPercent
            ),

          existingShopifyTradeDiscountId:
            updatedAccount.shopifyTradeDiscountId,
        });

        console.log(
          "================================="
        );


        await createTradePriceDiscount({
          admin,

          tradeAccount:
            updatedAccount,
        });


        console.log(
          "================================="
        );

        console.log(
          "TRADE PRICE SHOPIFY SYNC COMPLETE"
        );

        console.log(
          "================================="
        );
      }


      /*
       * --------------------------------------------------------
       * SWITCHING AWAY FROM TRADE PRICE
       * --------------------------------------------------------
       *
       * If this account previously had a Shopify
       * Trade Price automatic discount, remove it.
       */

      else {

        if (
          updatedAccount.shopifyTradeDiscountId
        ) {

          console.log(
            "================================="
          );

          console.log(
            "REMOVING SHOPIFY TRADE PRICE"
          );

          console.log({
            tradeAccountId:
              updatedAccount.id,

            shopifyTradeDiscountId:
              updatedAccount.shopifyTradeDiscountId,
          });

          console.log(
            "================================="
          );


          await deleteTradePriceDiscount({
            admin,

            tradeAccount:
              updatedAccount,
          });


          console.log(
            "================================="
          );

          console.log(
            "SHOPIFY TRADE PRICE REMOVED"
          );

          console.log(
            "================================="
          );
        }
      }

    } catch (error) {

      console.error(
        "================================="
      );

      console.error(
        "SHOPIFY TRADE PRICE SYNC FAILED"
      );

      console.error(
        error
      );

      console.error(
        "================================="
      );


      return {
        success: false,

        error:
          "Pricing was saved, but Shopify could not be updated: " +
          error.message,
      };
    }


    /* ----------------------------------------------------------
       FINAL SUCCESS
    ---------------------------------------------------------- */

    return {
      success: true,

      message:
        "Pricing option saved and Shopify pricing updated successfully.",
    };
  }


  /* ==========================================================
     CREATE CLIENT SPECIAL OFFER
  ========================================================== */

  if (
    intent ===
    "createClientSpecialOffer"
  ) {

    /* ----------------------------------------------------------
       FORM VALUES
    ---------------------------------------------------------- */

    const clientName =
      formData
        .get("clientName")
        ?.toString()
        .trim();


    const clientEmail =
      formData
        .get("clientEmail")
        ?.toString()
        .trim();


    const clientPhone =
      formData
        .get("clientPhone")
        ?.toString()
        .trim();


    const discountCode =
      formData
        .get("discountCode")
        ?.toString()
        .trim()
        .toUpperCase();


    const expiresAtRaw =
      formData
        .get("expiresAt")
        ?.toString()
        .trim();


    /* ----------------------------------------------------------
       ALLOCATION VALUES
    ---------------------------------------------------------- */

    const allocationPercent =
      Number(
        formData.get(
          "allocationPercent"
        ) || 0
      );


    const clientDiscountPercent =
      Number(
        formData.get(
          "clientDiscountPercent"
        ) || 0
      );


    const specialCommissionPercent =
      Number(
        formData.get(
          "specialCommissionPercent"
        ) || 0
      );


    /* ----------------------------------------------------------
       GET ACCOUNT
    ---------------------------------------------------------- */

    const account =
      await prisma.tradeAccount.findUnique({
        where: {
          id: params.id,
        },
      });


    if (!account) {
      return {
        success: false,
        error:
          "Trade account not found.",
      };
    }


    /* ----------------------------------------------------------
       CHECK PRICING MODEL
    ---------------------------------------------------------- */

    if (
      account.pricingOption !==
      "CLIENT_SPECIAL_PRICE"
    ) {
      return {
        success: false,
        error:
          "This designer is not using Client Special Price.",
      };
    }


    /* ----------------------------------------------------------
       CHECK SHOPIFY CUSTOMER
    ---------------------------------------------------------- */

    if (
      !account.shopifyCustomerId
    ) {
      return {
        success: false,

        error:
          "This designer does not have a Shopify Customer ID. " +
          "The client special offer cannot be created until " +
          "the Shopify customer is linked.",
      };
    }


    /* ----------------------------------------------------------
       DISCOUNT CODE
    ---------------------------------------------------------- */

    if (!discountCode) {
      return {
        success: false,
        error:
          "Discount code is required.",
      };
    }


    /* ----------------------------------------------------------
       VALIDATE ALLOCATION
    ---------------------------------------------------------- */

    if (
      Number.isNaN(
        allocationPercent
      ) ||
      allocationPercent < 0 ||
      allocationPercent > 100
    ) {
      return {
        success: false,
        error:
          "Allocation must be between 0 and 100%.",
      };
    }


    /* ----------------------------------------------------------
       VALIDATE CLIENT DISCOUNT
    ---------------------------------------------------------- */

    if (
      Number.isNaN(
        clientDiscountPercent
      ) ||
      clientDiscountPercent < 0 ||
      clientDiscountPercent > 100
    ) {
      return {
        success: false,
        error:
          "Client discount must be between 0 and 100%.",
      };
    }


    /* ----------------------------------------------------------
       VALIDATE COMMISSION
    ---------------------------------------------------------- */

    if (
      Number.isNaN(
        specialCommissionPercent
      ) ||
      specialCommissionPercent < 0 ||
      specialCommissionPercent > 100
    ) {
      return {
        success: false,
        error:
          "Designer commission must be between 0 and 100%.",
      };
    }


    /* ----------------------------------------------------------
       VALIDATE EXPIRY DATE
    ---------------------------------------------------------- */

    let expiresAt = null;


    if (expiresAtRaw) {

      const parsedExpiresAt =
        new Date(
          expiresAtRaw
        );


      if (
        Number.isNaN(
          parsedExpiresAt.getTime()
        )
      ) {
        return {
          success: false,
          error:
            "Invalid expiry date.",
        };
      }


      expiresAt =
        parsedExpiresAt;


      if (
        expiresAt.getTime() <=
        Date.now()
      ) {
        return {
          success: false,
          error:
            "Expiry date must be in the future.",
        };
      }
    }


    /* ----------------------------------------------------------
       ALLOCATION SPLIT
    ---------------------------------------------------------- */

    const totalAllocation =
      clientDiscountPercent +
      specialCommissionPercent;


    const roundedTotalAllocation =
      Math.round(
        totalAllocation * 100
      ) / 100;


    if (
      roundedTotalAllocation !==
      allocationPercent
    ) {
      return {
        success: false,

        error:
          `Client discount (${clientDiscountPercent}%) + ` +
          `commission (${specialCommissionPercent}%) = ` +
          `${roundedTotalAllocation}%. ` +
          `This must equal the allocation of ` +
          `${allocationPercent}%.`,
      };
    }


    /* ----------------------------------------------------------
       CHECK LOCAL DISCOUNT CODE
    ---------------------------------------------------------- */

    const existingOffer =
      await prisma.clientSpecialOffer.findUnique({
        where: {
          discountCode,
        },
      });


    if (existingOffer) {
      return {
        success: false,
        error:
          "This discount code is already being used.",
      };
    }


    /* ==========================================================
       CREATE SHOPIFY DISCOUNT
    ========================================================== */

    console.log(
      "================================="
    );

    console.log(
      "CREATING SHOPIFY CLIENT SPECIAL DISCOUNT"
    );

    console.log({
      discountCode,

      shopifyCustomerId:
        account.shopifyCustomerId,

      clientDiscountPercent,

      allocationPercent,

      specialCommissionPercent,

      expiresAt:
        expiresAt
          ? expiresAt.toISOString()
          : null,

      usageLimit: 1,

      appliesOncePerCustomer: true,
    });

    console.log(
      "================================="
    );


    const shopifyResponse =
      await admin.graphql(
        `#graphql
          mutation CreateClientSpecialDiscount(
            $basicCodeDiscount: DiscountCodeBasicInput!
          ) {
            discountCodeBasicCreate(
              basicCodeDiscount: $basicCodeDiscount
            ) {
              codeDiscountNode {
                id

                codeDiscount {
                  ... on DiscountCodeBasic {
                    title

                    codes(first: 10) {
                      nodes {
                        code
                      }
                    }

                    startsAt
                    endsAt

                    customerSelection {
                      ... on DiscountCustomerAll {
                        allCustomers
                      }

                      ... on DiscountCustomers {
                        customers {
                          id
                        }
                      }
                    }

                    customerGets {
                      value {
                        ... on DiscountPercentage {
                          percentage
                        }
                      }
                    }
                  }
                }
              }

              userErrors {
                field
                message
                code
              }
            }
          }
        `,
        {
          variables: {
            basicCodeDiscount: {

              title:
                `Client Special - ${discountCode}`,

              code:
                discountCode,

              startsAt:
                new Date().toISOString(),

              endsAt:
                expiresAt
                  ? expiresAt.toISOString()
                  : null,

              /*
               * CURRENTLY YOUR EXISTING
               * CLIENT SPECIAL LOGIC.
               *
               * NOTE:
               * This currently targets ALL customers.
               *
               * We will fix this separately when
               * Client Special Price is tested.
               */

              context: {
                all: "ALL",
              },

              customerGets: {
                value: {
                  percentage:
                    clientDiscountPercent /
                    100,
                },

                items: {
                  all: true,
                },
              },

              usageLimit: 1,

              appliesOncePerCustomer:
                true,
            },
          },
        }
      );


    /* ----------------------------------------------------------
       PARSE SHOPIFY RESPONSE
    ---------------------------------------------------------- */

    const shopifyData =
      await shopifyResponse.json();


    console.log(
      "================================="
    );

    console.log(
      "SHOPIFY DISCOUNT RESPONSE"
    );

    console.log(
      JSON.stringify(
        shopifyData,
        null,
        2
      )
    );

    console.log(
      "================================="
    );


    /* ----------------------------------------------------------
       HANDLE SHOPIFY GRAPHQL ERRORS
    ---------------------------------------------------------- */

    if (
      shopifyData.errors &&
      shopifyData.errors.length > 0
    ) {
      return {
        success: false,

        error:
          "Shopify API error: " +
          shopifyData.errors
            .map(
              (error) =>
                error.message
            )
            .join(", "),
      };
    }


    /* ----------------------------------------------------------
       GET DISCOUNT RESULT
    ---------------------------------------------------------- */

    const discountResult =
      shopifyData?.data
        ?.discountCodeBasicCreate;


    /* ----------------------------------------------------------
       HANDLE SHOPIFY USER ERRORS
    ---------------------------------------------------------- */

    if (
      discountResult?.userErrors &&
      discountResult.userErrors.length > 0
    ) {
      return {
        success: false,

        error:
          "Shopify could not create the discount: " +
          discountResult.userErrors
            .map(
              (error) =>
                error.message
            )
            .join(", "),
      };
    }


    /* ----------------------------------------------------------
       GET SHOPIFY DISCOUNT ID
    ---------------------------------------------------------- */

    const shopifyDiscountId =
      discountResult
        ?.codeDiscountNode
        ?.id;


    if (!shopifyDiscountId) {
      return {
        success: false,

        error:
          "Shopify discount was not created because no discount ID was returned.",
      };
    }


    /* ==========================================================
       SHOPIFY DISCOUNT CREATED
    ========================================================== */

    console.log(
      "================================="
    );

    console.log(
      "SHOPIFY DISCOUNT CREATED"
    );

    console.log({

      discountCode,

      shopifyDiscountId,

      shopifyCustomerId:
        account.shopifyCustomerId,

      clientDiscountPercent,

      designerCommission:
        specialCommissionPercent,

      allocationPercent,

      usageLimit:
        1,

      appliesOncePerCustomer:
        true,

      expiresAt:
        expiresAt
          ? expiresAt.toISOString()
          : null,
    });

    console.log(
      "================================="
    );


    /* ==========================================================
       CREATE LOCAL DATABASE OFFER
    ========================================================== */

    const offer =
      await prisma.clientSpecialOffer.create({
        data: {

          tradeAccountId:
            account.id,

          shopifyCustomerId:
            account.shopifyCustomerId,

          discountCode,

          shopifyDiscountId,

          clientName:
            clientName || null,

          clientEmail:
            clientEmail || null,

          clientPhone:
            clientPhone || null,

          allocationPercent,

          clientDiscountPercent,

          commissionPercent:
            specialCommissionPercent,

          status:
            "ACTIVE",

          expiresAt:
            expiresAt,
        },
      });


    /* ==========================================================
       LOG OFFER
    ========================================================== */

    console.log(
      "================================="
    );

    console.log(
      "CLIENT SPECIAL OFFER CREATED"
    );

    console.log({

      id:
        offer.id,

      tradeAccountId:
        offer.tradeAccountId,

      shopifyCustomerId:
        offer.shopifyCustomerId,

      discountCode:
        offer.discountCode,

      shopifyDiscountId:
        offer.shopifyDiscountId,

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

      expiresAt:
        offer.expiresAt,
    });

    console.log(
      "================================="
    );


    return {
      success: true,

      message:
        `Client Special Price offer created successfully. ` +
        `${clientDiscountPercent}% customer discount and ` +
        `${specialCommissionPercent}% designer commission.`,
    };
  }


  /* ==========================================================
     CANCEL CLIENT SPECIAL OFFER
  ========================================================== */

  if (
    intent ===
    "cancelClientSpecialOffer"
  ) {

    const offerId =
      formData
        .get("offerId")
        ?.toString();


    if (!offerId) {
      return {
        success: false,
        error:
          "Offer ID is required.",
      };
    }


    const offer =
      await prisma.clientSpecialOffer.findFirst({
        where: {
          id: offerId,

          tradeAccountId:
            params.id,
        },
      });


    if (!offer) {
      return {
        success: false,
        error:
          "Client special offer not found.",
      };
    }


    /* ----------------------------------------------------------
       CANCEL SHOPIFY DISCOUNT
    ---------------------------------------------------------- */

    if (
      offer.shopifyDiscountId
    ) {

      try {

        const deleteResponse =
          await admin.graphql(
            `#graphql
              mutation DeleteClientSpecialDiscount(
                $id: ID!
              ) {
                discountCodeBasicDelete(
                  id: $id
                ) {
                  deletedCodeDiscountId

                  userErrors {
                    field
                    message
                    code
                  }
                }
              }
            `,
            {
              variables: {
                id:
                  offer.shopifyDiscountId,
              },
            }
          );


        const deleteData =
          await deleteResponse.json();


        console.log(
          "SHOPIFY DISCOUNT DELETE RESPONSE"
        );

        console.log(
          JSON.stringify(
            deleteData,
            null,
            2
          )
        );


        const deleteErrors =
          deleteData
            ?.data
            ?.discountCodeBasicDelete
            ?.userErrors;


        if (
          deleteErrors &&
          deleteErrors.length > 0
        ) {

          console.error(
            "SHOPIFY DISCOUNT DELETE ERROR",
            deleteErrors
          );

        }

      } catch (error) {

        console.error(
          "FAILED TO DELETE SHOPIFY DISCOUNT",
          error
        );

      }
    }


    /* ----------------------------------------------------------
       UPDATE LOCAL OFFER
    ---------------------------------------------------------- */

    await prisma.clientSpecialOffer.update({
      where: {
        id: offer.id,
      },

      data: {
        status:
          "CANCELLED",
      },
    });


    return {
      success: true,

      message:
        "Client special offer cancelled.",
    };
  }


  /* ==========================================================
     SUSPEND ACCOUNT
  ========================================================== */

  if (
    intent ===
    "suspendAccount"
  ) {

    await prisma.tradeAccount.update({
      where: {
        id: params.id,
      },

      data: {
        status:
          "SUSPENDED",
      },
    });


    return {
      success: true,

      message:
        "Trade account suspended.",
    };
  }


  /* ==========================================================
     REACTIVATE ACCOUNT
  ========================================================== */

  if (
    intent ===
    "reactivateAccount"
  ) {

    await prisma.tradeAccount.update({
      where: {
        id: params.id,
      },

      data: {
        status:
          "ACTIVE",
      },
    });


    return {
      success: true,

      message:
        "Trade account reactivated.",
    };
  }


  /* ==========================================================
     UNKNOWN ACTION
  ========================================================== */

  return {
    success: false,

    error:
      "Unknown action.",
  };
}


/* ============================================================
   PAGE
============================================================ */

export default function TradeAccountDetail() {

  const { account } =
    useLoaderData();


  const actionData =
    useActionData();


  const navigation =
    useNavigation();


  const isSaving =
    navigation.state === "submitting";


  const application =
    account.application;


  return (
    <div style={pageStyle}>

      {/* ======================================================
          HEADER
      ====================================================== */}

      <div style={headerStyle}>

        <div>

          <div style={backStyle}>
            <a href="/app/trade-accounts">
              ← Back to Trade Accounts
            </a>
          </div>

          <h1 style={titleStyle}>
            {account.businessName}
          </h1>

          <p style={subtitleStyle}>
            {application.firstName}{" "}
            {application.lastName}
            {" · "}
            {account.email}
          </p>

        </div>

        <div>
          <StatusBadge
            status={account.status}
          />
        </div>

      </div>


      {/* ======================================================
          ACCOUNT SUMMARY
      ====================================================== */}

      <div style={gridStyle}>

        <InfoCard
          title="Pricing Model"
          value={formatPricingOption(
            account.pricingOption
          )}
        />

        <InfoCard
          title="Trade Discount"
          value={`${account.discountPercent}%`}
        />

        <InfoCard
          title="Referral Commission"
          value={`${account.commissionPercent}%`}
        />

        <InfoCard
          title="Referral Code"
          value={account.referralCode}
        />

      </div>


      {/* ======================================================
          PRICING MODEL
      ====================================================== */}

      <Section title="Pricing Model">

        <div style={pricingContainerStyle}>

          <div style={pricingIntroStyle}>
            Choose how this designer works with
            Urban Deco. Only one pricing model can
            be active at a time.
          </div>


          <PricingOptionCard
            value="TRADE_PRICE"
            selected={
              account.pricingOption ===
              "TRADE_PRICE"
            }
            title="Trade Price"
            description={
              "The designer purchases products " +
              "directly from Urban Deco at their " +
              "agreed trade discount."
            }
          />


          <PricingOptionCard
            value="REFERRAL"
            selected={
              account.pricingOption ===
              "REFERRAL"
            }
            title="Referral"
            description={
              "The designer refers clients using " +
              "their referral system and earns " +
              "commission on eligible orders."
            }
          />


          <PricingOptionCard
            value="CLIENT_SPECIAL_PRICE"
            selected={
              account.pricingOption ===
              "CLIENT_SPECIAL_PRICE"
            }
            title="Client Special Price"
            description={
              "Each client receives a separately " +
              "configured offer. The allocation for " +
              "each offer is split between the client " +
              "discount and designer commission."
            }
          />

        </div>


        {/* ====================================================
            SAVE FORM
        ==================================================== */}

        <Form
          method="post"
          style={pricingFormStyle}
        >

          <input
            type="hidden"
            name="intent"
            value="savePricingOption"
          />


          <div style={fieldGroupStyle}>

            <label style={fieldLabelStyle}>
              Active Pricing Model
            </label>

            <select
              name="pricingOption"
              defaultValue={
                account.pricingOption
              }
              style={selectStyle}
            >

              <option value="TRADE_PRICE">
                Trade Price
              </option>

              <option value="REFERRAL">
                Referral
              </option>

              <option value="CLIENT_SPECIAL_PRICE">
                Client Special Price
              </option>

            </select>

          </div>


          <div style={fieldGroupStyle}>

            <label style={fieldLabelStyle}>
              Trade Discount (%)
            </label>

            <input
              type="number"
              name="discountPercent"
              defaultValue={
                account.discountPercent
              }
              min="0"
              max="100"
              step="0.01"
              style={inputStyle}
            />

            <div style={fieldHelpStyle}>
              Used only when Trade Price is active.
            </div>

          </div>


          <div style={fieldGroupStyle}>

            <label style={fieldLabelStyle}>
              Referral Commission (%)
            </label>

            <input
              type="number"
              name="commissionPercent"
              defaultValue={
                account.commissionPercent
              }
              min="0"
              max="100"
              step="0.01"
              style={inputStyle}
            />

            <div style={fieldHelpStyle}>
              Used only when Referral is active.
            </div>

          </div>


          <div style={pricingRuleStyle}>

            <strong>
              Client Special Price rule:
            </strong>

            {" "}
            Each Client Special Price offer has
            its own allocation. The client discount
            and designer commission must equal that
            offer's allocation.

            <br />

            Example:
            {" "}
            <strong>
              15% allocation = 10% client discount
              + 5% designer commission.
            </strong>

          </div>


          <button
            type="submit"
            style={primaryButton}
            disabled={isSaving}
          >
            {isSaving
              ? "Saving..."
              : "Save Pricing Model"}
          </button>


          {actionData?.success && (
            <div style={successMessageStyle}>
              {actionData.message}
            </div>
          )}


          {actionData?.error && (
            <div style={errorMessageStyle}>
              {actionData.error}
            </div>
          )}

        </Form>

      </Section>


      {/* ======================================================
          CLIENT SPECIAL PRICE OFFERS
      ====================================================== */}

      <Section title="Client Special Price Offers">

        <div style={specialOfferIntroStyle}>

          <strong>
            Client Special Price
          </strong>

          <br />

          Each client offer has its own allocation.

          The allocation is split between the
          client discount and the designer commission.

          <br />

          Example:
          {" "}
          <strong>
            15% allocation = 10% client discount
            + 5% designer commission.
          </strong>

          <br />

          The client discount and designer commission
          must equal the allocation for that offer.

          <br />
          <br />

          <strong>
            Discount usage:
          </strong>

          {" "}
          Each generated discount can be used only
          once and is restricted to the linked
          Shopify customer.

        </div>


        {/* CREATE OFFER */}

        <Form
          method="post"
          style={offerFormStyle}
        >

          <input
            type="hidden"
            name="intent"
            value="createClientSpecialOffer"
          />


          <div style={offerFormGridStyle}>

            <div style={fieldGroupStyle}>

              <label style={fieldLabelStyle}>
                Client Name
              </label>

              <input
                type="text"
                name="clientName"
                style={inputStyle}
                placeholder="Client name"
              />

            </div>


            <div style={fieldGroupStyle}>

              <label style={fieldLabelStyle}>
                Client Email
              </label>

              <input
                type="email"
                name="clientEmail"
                style={inputStyle}
                placeholder="client@example.com"
              />

            </div>


            <div style={fieldGroupStyle}>

              <label style={fieldLabelStyle}>
                Client Phone
              </label>

              <input
                type="text"
                name="clientPhone"
                style={inputStyle}
                placeholder="Phone number"
              />

            </div>


            <div style={fieldGroupStyle}>

              <label style={fieldLabelStyle}>
                Client Discount Code
              </label>

              <input
                type="text"
                name="discountCode"
                style={inputStyle}
                placeholder="DESIGNER10"
              />

              <div style={fieldHelpStyle}>
                This code will be created automatically
                in Shopify.
              </div>

            </div>


            <div style={fieldGroupStyle}>

              <label style={fieldLabelStyle}>
                Offer Allocation (%)
              </label>

              <input
                type="number"
                name="allocationPercent"
                min="0"
                max="100"
                step="0.01"
                style={inputStyle}
                placeholder="15"
              />

              <div style={fieldHelpStyle}>
                Total percentage available for this
                specific client offer.
              </div>

            </div>


            <div style={fieldGroupStyle}>

              <label style={fieldLabelStyle}>
                Client Discount (%)
              </label>

              <input
                type="number"
                name="clientDiscountPercent"
                min="0"
                max="100"
                step="0.01"
                style={inputStyle}
                placeholder="10"
              />

              <div style={fieldHelpStyle}>
                Percentage of the offer allocation
                given to the client as a discount.
              </div>

            </div>


            <div style={fieldGroupStyle}>

              <label style={fieldLabelStyle}>
                Designer Commission (%)
              </label>

              <input
                type="number"
                name="specialCommissionPercent"
                min="0"
                max="100"
                step="0.01"
                style={inputStyle}
                placeholder="5"
              />

              <div style={fieldHelpStyle}>
                Percentage of the offer allocation
                paid to the designer as commission.
              </div>

            </div>


            <div style={fieldGroupStyle}>

              <label style={fieldLabelStyle}>
                Offer Expiry Date
              </label>

              <input
                type="datetime-local"
                name="expiresAt"
                style={inputStyle}
              />

              <div style={fieldHelpStyle}>
                Optional. Leave blank if the offer
                should not have an expiry date.
              </div>

            </div>

          </div>


          <div style={allocationRuleStyle}>

            <strong>
              Allocation rule:
            </strong>

            {" "}
            Client discount + designer commission
            must equal the offer allocation.

            <br />

            Example:
            {" "}
            <strong>
              15% = 10% client discount + 5%
              designer commission.
            </strong>

          </div>


          <button
            type="submit"
            style={primaryButton}
            disabled={isSaving}
          >
            {isSaving
              ? "Creating..."
              : "Create Client Special Offer"}
          </button>

        </Form>


        {/* OFFER LIST */}

        <div style={offersListStyle}>

          {account.clientSpecialOffers.length === 0 ? (

            <EmptyState>
              No client special offers have
              been created yet.
            </EmptyState>

          ) : (

            <table style={tableStyle}>

              <thead>

                <tr>

                  <th style={thStyle}>
                    Client
                  </th>

                  <th style={thStyle}>
                    Discount Code
                  </th>

                  <th style={thStyle}>
                    Client Discount
                  </th>

                  <th style={thStyle}>
                    Commission
                  </th>

                  <th style={thStyle}>
                    Allocation
                  </th>

                  <th style={thStyle}>
                    Expires
                  </th>

                  <th style={thStyle}>
                    Status
                  </th>

                  <th style={thStyle}>
                    Created
                  </th>

                  <th style={thStyle}>
                    Action
                  </th>

                </tr>

              </thead>

              <tbody>

                {account.clientSpecialOffers.map(
                  (offer) => (

                    <tr key={offer.id}>

                      <td style={tdStyle}>

                        <strong>
                          {offer.clientName ||
                            "—"}
                        </strong>

                        {offer.clientEmail && (
                          <div
                            style={
                              smallTextStyle
                            }
                          >
                            {offer.clientEmail}
                          </div>
                        )}

                        {offer.clientPhone && (
                          <div
                            style={
                              smallTextStyle
                            }
                          >
                            {offer.clientPhone}
                          </div>
                        )}

                      </td>


                      <td style={tdStyle}>

                        <code>
                          {offer.discountCode}
                        </code>

                      </td>


                      <td style={tdStyle}>
                        {offer.clientDiscountPercent}%
                      </td>


                      <td style={tdStyle}>
                        {offer.commissionPercent}%
                      </td>


                      <td style={tdStyle}>
                        {offer.allocationPercent}%
                      </td>


                      <td style={tdStyle}>

                        {formatDateTime(
                          offer.expiresAt
                        )}

                      </td>


                      <td style={tdStyle}>

                        <OfferStatusBadge
                          status={
                            offer.status
                          }
                        />

                      </td>


                      <td style={tdStyle}>

                        {formatDate(
                          offer.createdAt
                        )}

                      </td>


                      <td style={tdStyle}>

                        {offer.status ===
                          "ACTIVE" && (

                          <Form method="post">

                            <input
                              type="hidden"
                              name="intent"
                              value="cancelClientSpecialOffer"
                            />

                            <input
                              type="hidden"
                              name="offerId"
                              value={offer.id}
                            />

                            <button
                              type="submit"
                              style={
                                smallDangerButton
                              }
                            >
                              Cancel
                            </button>

                          </Form>

                        )}

                      </td>

                    </tr>

                  )
                )}

              </tbody>

            </table>

          )}

        </div>

      </Section>


      {/* ======================================================
          BUSINESS INFORMATION
      ====================================================== */}

      <Section title="Business Information">

        <InfoGrid>

          <InfoItem
            label="Business Name"
            value={
              application.businessName
            }
          />

          <InfoItem
            label="Business Type"
            value={
              application.businessType
            }
          />

          <InfoItem
            label="Company Registration Number"
            value={
              application.companyNumber
            }
          />

          <InfoItem
            label="VAT Number"
            value={
              application.vatNumber
            }
          />

          <InfoItem
            label="Website"
            value={
              application.website
            }
          />

          <InfoItem
            label="Instagram"
            value={
              application.instagram
            }
          />

        </InfoGrid>

      </Section>


      {/* ======================================================
          CONTACT INFORMATION
      ====================================================== */}

      <Section title="Contact Information">

        <InfoGrid>

          <InfoItem
            label="Contact Name"
            value={
              `${application.firstName} ${application.lastName}`
            }
          />

          <InfoItem
            label="Email"
            value={
              application.email
            }
          />

          <InfoItem
            label="Phone"
            value={
              application.phone
            }
          />

          <InfoItem
            label="Address"
            value={
              application.address
            }
          />

          <InfoItem
            label="City"
            value={
              application.city
            }
          />

          <InfoItem
            label="County"
            value={
              application.county
            }
          />

          <InfoItem
            label="Postcode"
            value={
              application.postcode
            }
          />

          <InfoItem
            label="Country"
            value={
              application.country
            }
          />

        </InfoGrid>

      </Section>


      {/* ======================================================
          BUSINESS PROFILE
      ====================================================== */}

      <Section title="Business Profile">

        <InfoGrid>

          <InfoItem
            label="Years Trading"
            value={
              application.yearsTrading
            }
          />

          <InfoItem
            label="Typical Project Value"
            value={
              application.typicalProjectValue
            }
          />

          <InfoItem
            label="Portfolio"
            value={
              application.portfolioUrl
            }
          />

          <InfoItem
            label="Project Information"
            value={
              application.projectInformation
            }
          />

        </InfoGrid>

      </Section>


      {/* ======================================================
          TRADE ACCOUNT
      ====================================================== */}

      <Section title="Trade Account">

        <InfoGrid>

          <InfoItem
            label="Trade Account ID"
            value={
              account.id
            }
          />

          <InfoItem
            label="Application ID"
            value={
              account.applicationId
            }
          />

          <InfoItem
            label="Pricing Model"
            value={
              formatPricingOption(
                account.pricingOption
              )
            }
          />

          <InfoItem
            label="Trade Discount"
            value={
              `${account.discountPercent}%`
            }
          />

          <InfoItem
            label="Shopify Trade Discount ID"
            value={
              account.shopifyTradeDiscountId
            }
          />

          <InfoItem
            label="Referral Code"
            value={
              account.referralCode
            }
          />

          <InfoItem
            label="Shopify Customer ID"
            value={
              account.shopifyCustomerId
            }
          />

          <InfoItem
            label="Account Created"
            value={
              formatDate(
                account.createdAt
              )
            }
          />

          <InfoItem
            label="Last Updated"
            value={
              formatDate(
                account.updatedAt
              )
            }
          />

        </InfoGrid>

      </Section>


      {/* ======================================================
          REFERRALS
      ====================================================== */}

      <Section title="Referrals">

        {account.referrals.length === 0 ? (

          <EmptyState>
            No referrals yet.
          </EmptyState>

        ) : (

          <table style={tableStyle}>

            <thead>

              <tr>

                <th style={thStyle}>
                  Referral Code
                </th>

                <th style={thStyle}>
                  Landing Session
                </th>

                <th style={thStyle}>
                  Created
                </th>

              </tr>

            </thead>

            <tbody>

              {account.referrals.map(
                (referral) => (

                  <tr key={referral.id}>

                    <td style={tdStyle}>
                      {referral.referralCode}
                    </td>

                    <td style={tdStyle}>
                      {referral.landingSessionId ||
                        "—"}
                    </td>

                    <td style={tdStyle}>
                      {formatDate(
                        referral.createdAt
                      )}
                    </td>

                  </tr>

                )
              )}

            </tbody>

          </table>

        )}

      </Section>


      {/* ======================================================
          COMMISSIONS
      ====================================================== */}

      <Section title="Commissions">

        {account.commissions.length === 0 ? (

          <EmptyState>
            No commissions or orders yet.
          </EmptyState>

        ) : (

          <table style={tableStyle}>

            <thead>

              <tr>

                <th style={thStyle}>
                  Order
                </th>

                <th style={thStyle}>
                  Order Total
                </th>

                <th style={thStyle}>
                  Eligible Amount
                </th>

                <th style={thStyle}>
                  Rate
                </th>

                <th style={thStyle}>
                  Commission
                </th>

                <th style={thStyle}>
                  Status
                </th>

              </tr>

            </thead>

            <tbody>

              {account.commissions.map(
                (commission) => (

                  <tr key={commission.id}>

                    <td style={tdStyle}>
                      {commission.orderNumber ||
                        commission.shopifyOrderId}
                    </td>

                    <td style={tdStyle}>
                      £
                      {commission.orderTotal.toFixed(
                        2
                      )}
                    </td>

                    <td style={tdStyle}>
                      £
                      {commission.eligibleAmount.toFixed(
                        2
                      )}
                    </td>

                    <td style={tdStyle}>
                      {commission.commissionRate}%
                    </td>

                    <td style={tdStyle}>
                      £
                      {commission.commissionAmount.toFixed(
                        2
                      )}
                    </td>

                    <td style={tdStyle}>
                      <CommissionBadge
                        status={
                          commission.status
                        }
                      />
                    </td>

                  </tr>

                )
              )}

            </tbody>

          </table>

        )}

      </Section>


      {/* ======================================================
          ACCOUNT ACTIONS
      ====================================================== */}

      <Section title="Account Actions">

        <div style={actionsContainerStyle}>

          {account.status ===
          "ACTIVE" ? (

            <Form method="post">

              <input
                type="hidden"
                name="intent"
                value="suspendAccount"
              />

              <button
                type="submit"
                style={dangerButton}
              >
                Suspend Account
              </button>

            </Form>

          ) : (

            <Form method="post">

              <input
                type="hidden"
                name="intent"
                value="reactivateAccount"
              />

              <button
                type="submit"
                style={primaryButton}
              >
                Reactivate Account
              </button>

            </Form>

          )}

        </div>

      </Section>

    </div>
  );
}


/* ============================================================
   COMPONENTS
============================================================ */

function Section({
  title,
  children,
}) {
  return (
    <section style={sectionStyle}>

      <h2 style={sectionTitleStyle}>
        {title}
      </h2>

      {children}

    </section>
  );
}


function InfoCard({
  title,
  value,
}) {
  return (
    <div style={infoCardStyle}>

      <div style={infoCardTitle}>
        {title}
      </div>

      <div style={infoCardValue}>
        {value}
      </div>

    </div>
  );
}


function PricingOptionCard({
  value,
  selected,
  title,
  description,
}) {
  return (
    <div
      style={{
        ...pricingOptionCardStyle,

        ...(selected
          ? pricingOptionSelectedStyle
          : {}),
      }}
    >

      <div
        style={
          pricingOptionRadioStyle
        }
      >
        {selected
          ? "●"
          : "○"}
      </div>

      <div>

        <div
          style={
            pricingOptionTitleStyle
          }
        >
          {title}
        </div>

        <div
          style={
            pricingOptionDescriptionStyle
          }
        >
          {description}
        </div>

      </div>

    </div>
  );
}


function InfoGrid({
  children,
}) {
  return (
    <div style={infoGridStyle}>
      {children}
    </div>
  );
}


function InfoItem({
  label,
  value,
}) {
  return (
    <div style={infoItemStyle}>

      <div style={labelStyle}>
        {label}
      </div>

      <div style={valueStyle}>
        {value || "—"}
      </div>

    </div>
  );
}


function EmptyState({
  children,
}) {
  return (
    <div style={emptyStateStyle}>
      {children}
    </div>
  );
}


function StatusBadge({
  status,
}) {
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


  const current =
    styles[status] ||
    styles.ACTIVE;


  return (
    <span
      style={{
        ...badgeStyle,
        ...current,
      }}
    >
      {status}
    </span>
  );
}


function OfferStatusBadge({
  status,
}) {
  const styles = {

    ACTIVE: {
      background: "#d1e7dd",
      color: "#0f5132",
    },

    EXPIRED: {
      background: "#fff3cd",
      color: "#856404",
    },

    CANCELLED: {
      background: "#f8d7da",
      color: "#842029",
    },

  };


  return (
    <span
      style={{
        ...badgeStyle,
        ...(styles[status] ||
          {}),
      }}
    >
      {status}
    </span>
  );
}


function CommissionBadge({
  status,
}) {
  const styles = {

    PENDING: {
      background: "#fff3cd",
      color: "#856404",
    },

    APPROVED: {
      background: "#d1e7dd",
      color: "#0f5132",
    },

    PAID: {
      background: "#cff4fc",
      color: "#055160",
    },

    CANCELLED: {
      background: "#f8d7da",
      color: "#842029",
    },

  };


  return (
    <span
      style={{
        ...badgeStyle,
        ...(styles[status] ||
          {}),
      }}
    >
      {status}
    </span>
  );
}


function formatPricingOption(
  pricingOption
) {
  const labels = {

    TRADE_PRICE:
      "Trade Price",

    REFERRAL:
      "Referral",

    CLIENT_SPECIAL_PRICE:
      "Client Special Price",

  };


  return (
    labels[pricingOption] ||
    pricingOption ||
    "Trade Price"
  );
}


function formatDate(date) {
  if (!date) {
    return "—";
  }

  return new Date(
    date
  ).toLocaleDateString(
    "en-GB",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }
  );
}


function formatDateTime(date) {
  if (!date) {
    return "No expiry";
  }

  return new Date(
    date
  ).toLocaleString(
    "en-GB",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}


/* ============================================================
   STYLES
============================================================ */

const pageStyle = {
  padding: "30px",
  maxWidth: "1400px",
  margin: "0 auto",
};


const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: "30px",
};


const backStyle = {
  marginBottom: "12px",
  fontSize: "14px",
};


const titleStyle = {
  margin: 0,
  fontSize: "30px",
  fontWeight: "600",
};


const subtitleStyle = {
  marginTop: "8px",
  color: "#666",
  fontSize: "15px",
};


const gridStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
  marginBottom: "25px",
};


const infoCardStyle = {
  background: "#fff",
  border: "1px solid #e5e5e5",
  borderRadius: "8px",
  padding: "20px",
};


const infoCardTitle = {
  fontSize: "13px",
  color: "#666",
  marginBottom: "8px",
};


const infoCardValue = {
  fontSize: "22px",
  fontWeight: "600",
};


const sectionStyle = {
  background: "#fff",
  border: "1px solid #e5e5e5",
  borderRadius: "8px",
  padding: "24px",
  marginBottom: "20px",
};


const sectionTitleStyle = {
  marginTop: 0,
  marginBottom: "20px",
  fontSize: "20px",
  fontWeight: "600",
};


const infoGridStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(250px, 1fr))",
  gap: "20px",
};


const infoItemStyle = {
  minWidth: 0,
};


const labelStyle = {
  fontSize: "12px",
  color: "#777",
  marginBottom: "6px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};


const valueStyle = {
  fontSize: "15px",
  color: "#222",
  wordBreak: "break-word",
};


/* ============================================================
   PRICING STYLES
============================================================ */

const pricingContainerStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};


const pricingIntroStyle = {
  color: "#666",
  fontSize: "14px",
  marginBottom: "8px",
  lineHeight: "1.5",
};


const pricingOptionCardStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: "14px",
  padding: "18px",
  border: "1px solid #ddd",
  borderRadius: "8px",
  background: "#fafafa",
};


const pricingOptionSelectedStyle = {
  border: "2px solid #222",
  background: "#f5f5f5",
};


const pricingOptionRadioStyle = {
  fontSize: "20px",
  lineHeight: "1",
  marginTop: "2px",
};


const pricingOptionTitleStyle = {
  fontSize: "16px",
  fontWeight: "600",
  marginBottom: "5px",
};


const pricingOptionDescriptionStyle = {
  fontSize: "14px",
  color: "#666",
  lineHeight: "1.5",
};


const pricingFormStyle = {
  marginTop: "25px",
  paddingTop: "25px",
  borderTop: "1px solid #eee",
};


const fieldGroupStyle = {
  marginBottom: "18px",
  maxWidth: "420px",
};


const fieldLabelStyle = {
  display: "block",
  fontSize: "13px",
  fontWeight: "600",
  marginBottom: "7px",
};


const selectStyle = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  background: "#fff",
  fontSize: "14px",
};


const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  fontSize: "14px",
  boxSizing: "border-box",
};


const fieldHelpStyle = {
  marginTop: "5px",
  fontSize: "12px",
  color: "#777",
};


const pricingRuleStyle = {
  padding: "12px 14px",
  marginBottom: "18px",
  background: "#f7f7f7",
  borderRadius: "6px",
  fontSize: "13px",
  color: "#555",
  lineHeight: "1.5",
};


const successMessageStyle = {
  marginTop: "15px",
  padding: "10px 14px",
  background: "#d1e7dd",
  color: "#0f5132",
  borderRadius: "6px",
  fontSize: "14px",
};


const errorMessageStyle = {
  marginTop: "15px",
  padding: "10px 14px",
  background: "#f8d7da",
  color: "#842029",
  borderRadius: "6px",
  fontSize: "14px",
};


/* ============================================================
   SPECIAL OFFER STYLES
============================================================ */

const specialOfferIntroStyle = {
  padding: "14px 16px",
  marginBottom: "20px",
  background: "#f7f7f7",
  borderRadius: "6px",
  fontSize: "13px",
  color: "#555",
  lineHeight: "1.6",
};


const offerFormStyle = {
  padding: "20px",
  border: "1px solid #eee",
  borderRadius: "8px",
  background: "#fafafa",
};


const offerFormGridStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(280px, 1fr))",
  columnGap: "24px",
};


const allocationRuleStyle = {
  padding: "12px 14px",
  marginBottom: "18px",
  background: "#f0f0f0",
  borderRadius: "6px",
  fontSize: "13px",
  color: "#444",
  lineHeight: "1.6",
};


const offersListStyle = {
  marginTop: "30px",
  overflowX: "auto",
};


const smallTextStyle = {
  marginTop: "4px",
  fontSize: "12px",
  color: "#777",
};


const smallDangerButton = {
  padding: "7px 10px",
  border: "none",
  borderRadius: "5px",
  background: "#b42318",
  color: "#fff",
  cursor: "pointer",
  fontSize: "12px",
};


/* ============================================================
   TABLE STYLES
============================================================ */

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
};


const thStyle = {
  textAlign: "left",
  padding: "12px",
  background: "#f7f7f7",
  borderBottom: "2px solid #ddd",
  fontSize: "13px",
  whiteSpace: "nowrap",
};


const tdStyle = {
  padding: "12px",
  borderBottom: "1px solid #eee",
  fontSize: "14px",
};


/* ============================================================
   BADGES
============================================================ */

const badgeStyle = {
  display: "inline-block",
  padding: "6px 11px",
  borderRadius: "5px",
  fontSize: "12px",
  fontWeight: "600",
};


/* ============================================================
   OTHER
============================================================ */

const emptyStateStyle = {
  padding: "25px",
  background: "#f8f8f8",
  borderRadius: "6px",
  color: "#666",
};


const actionsContainerStyle = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
};


const primaryButton = {
  padding: "10px 16px",
  border: "none",
  borderRadius: "6px",
  background: "#222",
  color: "#fff",
  cursor: "pointer",
};


const dangerButton = {
  padding: "10px 16px",
  border: "none",
  borderRadius: "6px",
  background: "#b42318",
  color: "#fff",
  cursor: "pointer",
};