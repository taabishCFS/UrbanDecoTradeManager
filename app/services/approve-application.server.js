import prisma from "../db.server";

import { sendTradeApprovalEmail } from "./email.server";

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
export function normalisePhone(phone) {
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
export async function deleteShopifyCustomer(
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
 * APPROVE APPLICATION
 * ============================================================
 *
 * Returns { status, body }. Thrown errors propagate to the caller.
 */
export async function approveApplication({ admin, application }) {
      /**
       * ------------------------------------------------------
       * Make sure application is not already approved
       * ------------------------------------------------------
       */
      if (
        application.status ===
        "APPROVED"
      ) {
        return {
          status: 400,
          body: {
            success: false,

            message:
              "This application has already been approved.",
          },
        };
      }

      /**
       * ------------------------------------------------------
       * Validate phone
       * ------------------------------------------------------
       */
      if (!application.phone) {
        return {
          status: 400,
          body: {
            success: false,

            message:
              "The applicant does not have a phone number.",
          },
        };
      }

      /**
       * ------------------------------------------------------
       * Validate email
       * ------------------------------------------------------
       */
      if (!application.email) {
        return {
          status: 400,
          body: {
            success: false,

            message:
              "The applicant does not have an email address.",
          },
        };
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
        return {
          status: 400,
          body: {
            success: false,

            message:
              "The applicant's phone number is invalid. Please correct the phone number before approving the application.",
          },
        };
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
        return {
          status: 400,
          body: {
            success: false,

            message:
              "A trade account already exists for this application.",
          },
        };
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

        return {
          status: 500,
          body: {
            success: false,

            message:
              "Unable to check for an existing Shopify customer. The application was not approved: " +
              searchError.message,
          },
        };
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
          return {
            status: 500,
            body: {
              success: false,

              message:
                "An existing Shopify customer was found for this email, but the TRADE_ACCOUNT tag could not be added. The application was not approved.",
            },
          };
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

          return {
            status: 400,
            body: {
              success: false,

              message:
                `Shopify customer creation failed: ${errorMessage}`,
            },
          };
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

          return {
            status: 500,
            body: {
              success: false,

              message:
                "Shopify did not return a customer ID. The application has not been approved.",
            },
          };
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

        return {
          status: 500,
          body: {
            success: false,

            message:
              "Unable to generate a unique referral code. The Shopify customer change was rolled back and the application was not approved.",
          },
        };
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
        /* ============================================================
   SEND APPROVAL EMAIL
============================================================ */

try {

  const emailResult =
    await sendTradeApprovalEmail(
      application
    );

  console.log(
    "TRADE APPROVAL EMAIL RESULT:",
    emailResult
  );

} catch (emailError) {

  console.error(
    "TRADE APPROVAL EMAIL FAILED:",
    emailError
  );

}

        /**
         * ----------------------------------------------------
         * SUCCESS
         * ----------------------------------------------------
         */
        return {
          status: 200,
          body: {
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
          },
        };
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

        return {
          status: 500,
          body: {
            success: false,

            message:
              rollbackSuccessful
                ? "Approval failed. The database transaction was rolled back and the Shopify customer change was undone."
                : "Approval failed. The database transaction was rolled back, but the Shopify customer change could not be undone. Check the server logs for the Shopify customer ID.",

            applicationId:
              application.id,

            rollbackSuccessful,
          },
        };
      }
}
