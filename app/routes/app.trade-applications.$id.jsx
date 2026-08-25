
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

/**
 * ============================================================
 * NORMALISE PHONE NUMBER
 * ============================================================
 *
 * Handles common UK formats:
 *
 * 0116 296 3800
 * 0330 333 1144
 * +44 330 333 1144
 * 0044 330 333 1144
 *
 * Shopify receives:
 *
 * +441162963800
 * +443303331144
 */
function normalisePhone(phone) {
  if (!phone) return null;

  let value = phone.toString().trim();

  // Remove spaces, brackets, dots and hyphens
  value = value.replace(/[\s().-]/g, "");

  // Convert UK local number to international
  //
  // 01162963800
  // becomes
  // +441162963800
  //
  if (value.startsWith("0")) {
    value = "+44" + value.substring(1);
  }

  // Convert 0044 format
  //
  // 00443303331144
  // becomes
  // +443303331144
  //
  if (value.startsWith("0044")) {
    value = "+" + value.substring(2);
  }

  /**
   * Basic international phone validation.
   *
   * E.164:
   * + followed by country code and 7-14 digits
   */
  if (!/^\+[1-9]\d{7,14}$/.test(value)) {
    return null;
  }

  return value;
}

/**
 * ============================================================
 * GENERATE REFERRAL CODE
 * ============================================================
 */
async function generateReferralCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code =
      "UD-" +
      Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();

    const existing =
      await prisma.tradeAccount.findUnique({
        where: {
          referralCode: code,
        },
      });

    if (!existing) {
      return code;
    }
  }

  throw new Error(
    "Unable to generate a unique referral code."
  );
}

/**
 * ============================================================
 * FIND SHOPIFY CUSTOMER BY EMAIL
 * ============================================================
 *
 * Used before creating a new Shopify customer on approval.
 *
 * If a customer already exists in this store with the
 * applicant's email (whether they became a customer through
 * a normal storefront order, a previous trade account, or
 * any other route), we should reuse that record instead of
 * creating a duplicate.
 *
 * Returns the customer node (id, email, tags, etc.) or null
 * if no customer exists with that email.
 */
async function findExistingShopifyCustomer(admin, email, phone) {
  console.log("=================================");
  console.log("SEARCHING SHOPIFY CUSTOMER");
  console.log("EMAIL:", email);
  console.log("PHONE:", phone);
  console.log("=================================");

  // ------------------------------------------------------------
  // SEARCH BY EMAIL
  // ------------------------------------------------------------

  const emailResponse = await admin.graphql(
    `#graphql
      query FindCustomerByEmail($query: String!) {
        customers(
          first: 10
          query: $query
        ) {
          edges {
            node {
              id
              firstName
              lastName
              email
              phone
              tags
            }
          }
        }
      }
    `,
    {
      variables: {
        query: `email:"${email}"`,
      },
    }
  );

  const emailResult = await emailResponse.json();

  if (emailResult.errors?.length) {
    throw new Error(
      "Shopify email customer search failed: " +
        emailResult.errors
          .map((error) => error.message)
          .join(", ")
    );
  }

  const emailCustomers =
    emailResult?.data?.customers?.edges?.map(
      (edge) => edge.node
    ) || [];

  // Exact email match
  const emailCustomer =
    emailCustomers.find(
      (customer) =>
        customer.email?.toLowerCase() ===
        email.toLowerCase()
    );

  if (emailCustomer) {
    console.log(
      "EXISTING CUSTOMER FOUND BY EMAIL:",
      emailCustomer.id
    );

    return emailCustomer;
  }

  // ------------------------------------------------------------
  // SEARCH BY PHONE
  // ------------------------------------------------------------

  const phoneResponse = await admin.graphql(
    `#graphql
      query FindCustomerByPhone($query: String!) {
        customers(
          first: 10
          query: $query
        ) {
          edges {
            node {
              id
              firstName
              lastName
              email
              phone
              tags
            }
          }
        }
      }
    `,
    {
      variables: {
        query: `phone:${phone}`,
      },
    }
  );

  const phoneResult = await phoneResponse.json();

  if (phoneResult.errors?.length) {
    throw new Error(
      "Shopify phone customer search failed: " +
        phoneResult.errors
          .map((error) => error.message)
          .join(", ")
    );
  }

  const phoneCustomers =
    phoneResult?.data?.customers?.edges?.map(
      (edge) => edge.node
    ) || [];

  const phoneCustomer =
    phoneCustomers.find(
      (customer) =>
        customer.phone === phone
    );

  if (phoneCustomer) {
    console.log(
      "EXISTING CUSTOMER FOUND BY PHONE:",
      phoneCustomer.id
    );

    return phoneCustomer;
  }

  console.log(
    "NO EXISTING SHOPIFY CUSTOMER FOUND BY EMAIL OR PHONE."
  );

  return null;
}

/**
 * ============================================================
 * ADD TRADE_ACCOUNT TAG TO EXISTING CUSTOMER
 * ============================================================
 *
 * Used when reusing an existing Shopify customer. This only
 * ADDS the TRADE_ACCOUNT tag on top of whatever tags the
 * customer already has - it never removes existing tags.
 *
 * If the customer already has the TRADE_ACCOUNT tag (e.g. a
 * previous trade account that was deleted and is being
 * re-approved), this is a no-op and no mutation is sent.
 */
async function addTradeAccountTag(
  admin,
  customer
) {
  const existingTags =
    customer.tags || [];

  if (
    existingTags.includes(
      "TRADE_ACCOUNT"
    )
  ) {
    console.log(
      "CUSTOMER ALREADY HAS TRADE_ACCOUNT TAG. SKIPPING TAG UPDATE."
    );

    return true;
  }

  const mergedTags = [
    ...existingTags,
    "TRADE_ACCOUNT",
  ];

  console.log(
    "================================="
  );

  console.log(
    "ADDING TRADE_ACCOUNT TAG TO EXISTING CUSTOMER"
  );

  console.log(
    "CUSTOMER ID:",
    customer.id
  );

  console.log(
    "MERGED TAGS:",
    mergedTags
  );

  console.log(
    "================================="
  );

  const response =
    await admin.graphql(
      `#graphql
        mutation customerUpdate(
          $input: CustomerInput!
        ) {
          customerUpdate(
            input: $input
          ) {
            customer {
              id
              tags
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          input: {
            id: customer.id,
            tags: mergedTags,
          },
        },
      }
    );

  const result =
    await response.json();

  console.log(
    "CUSTOMER TAG UPDATE RESPONSE:"
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  const userErrors =
    result?.data?.customerUpdate
      ?.userErrors || [];

  if (userErrors.length > 0) {
    console.error(
      "CUSTOMER TAG UPDATE ERROR:",
      userErrors
    );

    return false;
  }

  return true;
}

/**
 * ============================================================
 * REMOVE TRADE_ACCOUNT TAG FROM EXISTING CUSTOMER
 * ============================================================
 *
 * Rollback counterpart to addTradeAccountTag.
 *
 * IMPORTANT:
 *
 * This is used instead of deleteShopifyCustomer when the
 * approval flow REUSED a pre-existing customer. We must
 * never delete a customer we did not create - they may have
 * unrelated order history in this store. The only thing this
 * flow added was the tag, so rollback only removes the tag.
 */
async function removeTradeAccountTag(
  admin,
  customer
) {
  const existingTags =
    customer.tags || [];

  const remainingTags =
    existingTags.filter(
      (tag) =>
        tag !== "TRADE_ACCOUNT"
    );

  console.log(
    "================================="
  );

  console.log(
    "ROLLBACK: REMOVING TRADE_ACCOUNT TAG FROM REUSED CUSTOMER"
  );

  console.log(
    "CUSTOMER ID:",
    customer.id
  );

  console.log(
    "================================="
  );

  try {
    const response =
      await admin.graphql(
        `#graphql
          mutation customerUpdate(
            $input: CustomerInput!
          ) {
            customerUpdate(
              input: $input
            ) {
              customer {
                id
                tags
              }

              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          variables: {
            input: {
              id: customer.id,
              tags: remainingTags,
            },
          },
        }
      );

    const result =
      await response.json();

    console.log(
      "ROLLBACK TAG REMOVAL RESPONSE:"
    );

    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    const userErrors =
      result?.data
        ?.customerUpdate
        ?.userErrors || [];

    if (userErrors.length > 0) {
      console.error(
        "ROLLBACK TAG REMOVAL FAILED:",
        userErrors
      );

      return false;
    }

    return true;
  } catch (error) {
    console.error(
      "ROLLBACK TAG REMOVAL ERROR:",
      error
    );

    return false;
  }
}

/**
 * ============================================================
 * DELETE SHOPIFY CUSTOMER
 * ============================================================
 *
 * This is used as a rollback/cleanup operation, and by the
 * explicit "Delete Customer" admin action.
 *
 * IMPORTANT: only ever call this for a customer that THIS
 * app created. Never call this for a reused/pre-existing
 * customer - use removeTradeAccountTag for that instead.
 *
 * Example:
 *
 * Shopify customer created successfully
 * ↓
 * Prisma operation fails
 * ↓
 * Delete Shopify customer
 *
 * This prevents orphaned Shopify customers.
 */
async function deleteShopifyCustomer(
  admin,
  customerId
) {
  if (!customerId) {
    return;
  }

  try {
    console.log(
      "================================="
    );

    console.log(
      "ROLLBACK: DELETING SHOPIFY CUSTOMER"
    );

    console.log(
      "CUSTOMER ID:",
      customerId
    );

    console.log(
      "================================="
    );

    const response =
      await admin.graphql(
        `#graphql
          mutation customerDelete(
            $input: CustomerDeleteInput!
          ) {
            customerDelete(
              input: $input
            ) {
              deletedCustomerId

              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          variables: {
            input: {
              id: customerId,
            },
          },
        }
      );

    const result =
      await response.json();

    console.log(
      "SHOPIFY CUSTOMER DELETE RESPONSE:"
    );

    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    const deleteResult =
      result?.data?.customerDelete;

    const userErrors =
      deleteResult?.userErrors || [];

    if (userErrors.length > 0) {
      console.error(
        "ROLLBACK CUSTOMER DELETE FAILED:",
        userErrors
      );

      return false;
    }

    console.log(
      "ROLLBACK CUSTOMER DELETED SUCCESSFULLY:",
      customerId
    );

    return true;
  } catch (error) {
    console.error(
      "================================="
    );

    console.error(
      "ROLLBACK CUSTOMER DELETE ERROR"
    );

    console.error(error);

    console.error(
      "================================="
    );

    return false;
  }
}

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

  return {
    application,
    tradeAccount,
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
      /**
       * ------------------------------------------------------
       * Make sure application is not already approved
       * ------------------------------------------------------
       */
      if (
        application.status ===
        "APPROVED"
      ) {
        return Response.json(
          {
            success: false,

            message:
              "This application has already been approved.",
          },
          {
            status: 400,
          }
        );
      }

      /**
       * ------------------------------------------------------
       * Validate phone
       * ------------------------------------------------------
       */
      if (!application.phone) {
        return Response.json(
          {
            success: false,

            message:
              "The applicant does not have a phone number.",
          },
          {
            status: 400,
          }
        );
      }

      /**
       * ------------------------------------------------------
       * Validate email
       * ------------------------------------------------------
       */
      if (!application.email) {
        return Response.json(
          {
            success: false,

            message:
              "The applicant does not have an email address.",
          },
          {
            status: 400,
          }
        );
      }

      /**
       * ------------------------------------------------------
       * Normalise phone
       * ------------------------------------------------------
       */
      const phone =
        normalisePhone(
          application.phone
        );

      console.log(
        "ORIGINAL PHONE:",
        application.phone
      );

      console.log(
        "NORMALISED PHONE:",
        phone
      );

      if (!phone) {
        return Response.json(
          {
            success: false,

            message:
              "The applicant's phone number is invalid. Please correct the phone number before approving the application.",
          },
          {
            status: 400,
          }
        );
      }

      /**
       * ------------------------------------------------------
       * Check existing Trade Account
       * ------------------------------------------------------
       */
      const existingTradeAccount =
        await prisma.tradeAccount.findUnique({
          where: {
            applicationId:
              application.id,
          },
        });

      if (existingTradeAccount) {
        return Response.json(
          {
            success: false,

            message:
              "A trade account already exists for this application.",
          },
          {
            status: 400,
          }
        );
      }

      /**
       * ======================================================
       * FIND OR CREATE SHOPIFY CUSTOMER
       * ======================================================
       *
       * IMPORTANT:
       *
       * Shopify is outside the Prisma transaction.
       *
       * If we CREATED a new customer and the database
       * operation fails later, we explicitly delete that
       * customer (deleteShopifyCustomer).
       *
       * If we REUSED an existing customer, we must NEVER
       * delete them on rollback - they may have order
       * history unrelated to this trade application. We
       * only added a tag, so rollback only removes that tag
       * (removeTradeAccountTag).
       *
       * customerWasCreatedByThisFlow tracks which rollback
       * path to use.
       */
      console.log(
        "================================="
      );

      console.log(
        "CHECKING FOR EXISTING SHOPIFY CUSTOMER..."
      );

      console.log(
        "================================="
      );

      let shopifyCustomerId;
      let customerWasCreatedByThisFlow = false;
      let reusedCustomer = null;

      try {
        reusedCustomer =
          await findExistingShopifyCustomer(
            admin,
            application.email,
            phone
          );
      } catch (searchError) {
        console.error(
          "SHOPIFY CUSTOMER SEARCH FAILED:",
          searchError
        );

        return Response.json(
          {
            success: false,

            message:
              "Unable to check for an existing Shopify customer. The application was not approved: " +
              searchError.message,
          },
          {
            status: 500,
          }
        );
      }

      if (reusedCustomer) {
        /**
         * ----------------------------------------------------
         * REUSE EXISTING CUSTOMER
         * ----------------------------------------------------
         */
        console.log(
          "================================="
        );

        console.log(
          "REUSING EXISTING SHOPIFY CUSTOMER"
        );

        console.log(
          "CUSTOMER ID:",
          reusedCustomer.id
        );

        console.log(
          "================================="
        );

        const tagAdded =
          await addTradeAccountTag(
            admin,
            reusedCustomer
          );

        if (!tagAdded) {
          return Response.json(
            {
              success: false,

              message:
                "An existing Shopify customer was found for this email, but the TRADE_ACCOUNT tag could not be added. The application was not approved.",
            },
            {
              status: 500,
            }
          );
        }

        shopifyCustomerId =
          reusedCustomer.id;

        customerWasCreatedByThisFlow = false;
      } else {
        /**
         * ----------------------------------------------------
         * CREATE NEW CUSTOMER
         * ----------------------------------------------------
         */
        console.log(
          "================================="
        );

        console.log(
          "NO EXISTING CUSTOMER FOUND. CREATING NEW SHOPIFY CUSTOMER..."
        );

        console.log(
          "================================="
        );

        const customerResponse =
          await admin.graphql(
            `#graphql
              mutation customerCreate(
                $input: CustomerInput!
              ) {
                customerCreate(
                  input: $input
                ) {
                  customer {
                    id
                    firstName
                    lastName
                    email
                    phone
                    tags
                  }

                  userErrors {
                    field
                    message
                  }
                }
              }
            `,
            {
              variables: {
                input: {
                  firstName:
                    application.firstName,

                  lastName:
                    application.lastName,

                  email:
                    application.email,

                  phone,
                  tags:[
"TRADE_ACCOUNT"
]
                },
              },
            }
          );

        const customerResult =
          await customerResponse.json();

        console.log(
          "SHOPIFY CUSTOMER RESPONSE:"
        );

        console.log(
          JSON.stringify(
            customerResult,
            null,
            2
          )
        );

        /**
         * --------------------------------------------------
         * Shopify customer creation errors
         * --------------------------------------------------
         */
        const customerCreate =
          customerResult
            ?.data
            ?.customerCreate;

        const userErrors =
          customerCreate
            ?.userErrors || [];

        if (
          userErrors.length > 0
        ) {
          const errorMessage =
            userErrors
              .map(
                (error) =>
                  error.message
              )
              .join(", ");

          console.error(
            "SHOPIFY CUSTOMER CREATION ERROR:",
            errorMessage
          );

          return Response.json(
            {
              success: false,

              message:
                `Shopify customer creation failed: ${errorMessage}`,
            },
            {
              status: 400,
            }
          );
        }

        /**
         * --------------------------------------------------
         * Make sure customer was returned
         * --------------------------------------------------
         */
        const customer =
          customerCreate?.customer;

        if (!customer?.id) {
          console.error(
            "SHOPIFY CUSTOMER WAS NOT CREATED."
          );

          return Response.json(
            {
              success: false,

              message:
                "Shopify did not return a customer ID. The application has not been approved.",
            },
            {
              status: 500,
            }
          );
        }

        shopifyCustomerId =
          customer.id;

        customerWasCreatedByThisFlow = true;

        console.log(
          "SHOPIFY CUSTOMER CREATED:"
        );

        console.log(
          shopifyCustomerId
        );
      }

      /**
       * ======================================================
       * ROLLBACK HELPER
       * ======================================================
       *
       * Picks the correct rollback strategy depending on
       * whether the customer was created or reused above.
       */
      async function rollbackShopifyCustomer() {
        if (
          customerWasCreatedByThisFlow
        ) {
          return await deleteShopifyCustomer(
            admin,
            shopifyCustomerId
          );
        }

        return await removeTradeAccountTag(
          admin,
          reusedCustomer
        );
      }

      /**
       * ======================================================
       * GENERATE REFERRAL CODE
       * ======================================================
       */
      let referralCode;

      try {
        referralCode =
          await generateReferralCode();

        console.log(
          "REFERRAL CODE:",
          referralCode
        );
      } catch (error) {
        /**
         * ----------------------------------------------------
         * REFERRAL CODE GENERATION FAILED
         * ----------------------------------------------------
         *
         * Shopify customer already exists (created or
         * reused). Roll it back because approval cannot
         * continue.
         * ----------------------------------------------------
         */
        console.error(
          "REFERRAL CODE GENERATION FAILED."
        );

        console.error(error);

        await rollbackShopifyCustomer();

        return Response.json(
          {
            success: false,

            message:
              "Unable to generate a unique referral code. The Shopify customer change was rolled back and the application was not approved.",
          },
          {
            status: 500,
          }
        );
      }

      /**
       * ======================================================
       * DATABASE TRANSACTION
       * ======================================================
       *
       * These operations must succeed together:
       *
       * 1. Create Trade Account
       * 2. Approve Application
       *
       * If either operation fails:
       *
       * - Prisma transaction rolls back
       * - Shopify customer change is rolled back below
       *
       * This prevents:
       *
       * Shopify Customer
       *       +
       * No Trade Account
       *
       * from being left behind.
       */
      try {
        console.log(
          "================================="
        );

        console.log(
          "STARTING DATABASE TRANSACTION..."
        );

        console.log(
          "================================="
        );

        const result =
          await prisma.$transaction(
            async (tx) => {
              /**
               * ----------------------------------------------
               * Create Trade Account
               * ----------------------------------------------
               */
              const tradeAccount =
                await tx.tradeAccount.create({
                  data: {
                    applicationId:
                      application.id,

                    shopifyCustomerId:
                      shopifyCustomerId,

                    email:
                      application.email,

                    businessName:
                      application.businessName,

                    discountPercent:
                      0,

                    commissionPercent:
                      0,

                    referralCode,

                    status:
                      "ACTIVE",
                  },
                });

              console.log(
                "TRADE ACCOUNT CREATED:",
                tradeAccount.id
              );

              /**
               * ----------------------------------------------
               * Approve Application
               * ----------------------------------------------
               */
              const approvedApplication =
                await tx.tradeApplication.update({
                  where: {
                    id: application.id,
                  },

                  data: {
                    status:
                      "APPROVED",

                    approvedAt:
                      new Date(),
                  },
                });

              console.log(
                "APPLICATION APPROVED:",
                approvedApplication.id
              );

              return {
                tradeAccount,

                approvedApplication,
              };
            }
          );

        /**
         * ====================================================
         * DATABASE TRANSACTION SUCCESS
         * ====================================================
         */
        console.log(
          "================================="
        );

        console.log(
          "DATABASE TRANSACTION SUCCESS"
        );

        console.log(
          "================================="
        );

        console.log(
          "APPLICATION ID:",
          result
            .approvedApplication
            .id
        );

        console.log(
          "TRADE ACCOUNT ID:",
          result
            .tradeAccount
            .id
        );

        console.log(
          "SHOPIFY CUSTOMER ID:",
          shopifyCustomerId
        );

        console.log(
          "CUSTOMER WAS REUSED:",
          !customerWasCreatedByThisFlow
        );

        console.log(
          "REFERRAL CODE:",
          referralCode
        );

        /**
         * ----------------------------------------------------
         * SUCCESS
         * ----------------------------------------------------
         */
        return Response.json({
          success: true,

          action: "approve",

          message:
            customerWasCreatedByThisFlow
              ? "Trade application approved successfully."
              : "Trade application approved successfully using an existing Shopify customer.",

          applicationId:
            result
              .approvedApplication
              .id,

          shopifyCustomerId,

          tradeAccountId:
            result
              .tradeAccount
              .id,

          referralCode:
            result
              .tradeAccount
              .referralCode,
        });
      } catch (databaseError) {
        /**
         * ====================================================
         * DATABASE TRANSACTION FAILED
         * ====================================================
         *
         * At this point:
         *
         * Shopify customer exists (created or reused, and
         * tagged TRADE_ACCOUNT).
         *
         * Prisma transaction has rolled back.
         *
         * Therefore we MUST attempt to roll back the Shopify
         * side too, so it does not end up in an inconsistent
         * state.
         */
        console.error(
          "================================="
        );

        console.error(
          "DATABASE TRANSACTION FAILED"
        );

        console.error(
          databaseError
        );

        console.error(
          "================================="
        );

        console.log(
          "STARTING SHOPIFY CUSTOMER ROLLBACK..."
        );

        const rollbackSuccessful =
          await rollbackShopifyCustomer();

        if (
          rollbackSuccessful
        ) {
          console.log(
            "SHOPIFY CUSTOMER ROLLBACK SUCCESSFUL."
          );
        } else {
          /**
           * --------------------------------------------------
           * IMPORTANT
           * --------------------------------------------------
           *
           * If Shopify rollback also fails, log the
           * customer ID very clearly.
           *
           * This allows you to manually fix it later.
           * --------------------------------------------------
           */
          console.error(
            "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
          );

          console.error(
            "CRITICAL: SHOPIFY CUSTOMER COULD NOT BE ROLLED BACK."
          );

          console.error(
            "SHOPIFY CUSTOMER ID:",
            shopifyCustomerId
          );

          console.error(
            "CUSTOMER WAS CREATED BY THIS FLOW:",
            customerWasCreatedByThisFlow
          );

          console.error(
            "APPLICATION ID:",
            application.id
          );

          console.error(
            "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
          );
        }

        return Response.json(
          {
            success: false,

            message:
              rollbackSuccessful
                ? "Approval failed. The database transaction was rolled back and the Shopify customer change was undone."
                : "Approval failed. The database transaction was rolled back, but the Shopify customer change could not be undone. Check the server logs for the Shopify customer ID.",

            applicationId:
              application.id,

            rollbackSuccessful,
          },
          {
            status: 500,
          }
        );
      }
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
              application.businessType
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
