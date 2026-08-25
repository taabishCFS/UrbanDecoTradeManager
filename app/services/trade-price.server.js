import prisma from "../db.server";

/**
 * ============================================================
 * SHOPIFY TRADE PRICE SERVICE
 * ============================================================
 *
 * TRADE PRICE
 *
 * Example:
 *
 * Retail price: £100
 * Trade discount: 10%
 *
 * Customer pays: £90
 *
 * The Shopify automatic discount is restricted to the
 * specific Shopify customer belonging to the Trade Account.
 *
 * This service does NOT handle referral commission.
 * ============================================================
 */

/**
 * ============================================================
 * SHOPIFY GRAPHQL HELPER
 * ============================================================
 */

async function shopifyGraphQL({
  admin,
  query,
  variables = {},
}) {
  const response = await admin.graphql(query, {
    variables,
  });

  const json = await response.json();

  /**
   * ----------------------------------------------------------
   * GRAPHQL LEVEL ERRORS
   * ----------------------------------------------------------
   */

  if (json.errors?.length) {
    console.error(
      "================================="
    );

    console.error(
      "SHOPIFY GRAPHQL ERRORS"
    );

    console.error(
      JSON.stringify(
        json.errors,
        null,
        2
      )
    );

    console.error(
      "================================="
    );

    throw new Error(
      json.errors
        .map(
          (error) =>
            error.message
        )
        .join(", ")
    );
  }

  return json;
}

/**
 * ============================================================
 * VALIDATE DISCOUNT
 * ============================================================
 */

function validateDiscountPercent(
  discountPercent
) {
  const value = Number(
    discountPercent
  );

  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 100
  ) {
    throw new Error(
      `Invalid trade discount: ${discountPercent}%`
    );
  }

  return value;
}

/**
 * ============================================================
 * CREATE TRADE PRICE DISCOUNT
 * ============================================================
 */

export async function createTradePriceDiscount({
  admin,
  tradeAccount,
}) {
  console.log(
    "================================="
  );

  console.log(
    "CREATE TRADE PRICE DISCOUNT"
  );

  console.log({
    tradeAccountId:
      tradeAccount.id,

    businessName:
      tradeAccount.businessName,

    shopifyCustomerId:
      tradeAccount.shopifyCustomerId,

    discountPercent:
      tradeAccount.discountPercent,

    existingDiscountId:
      tradeAccount.shopifyTradeDiscountId,
  });

  console.log(
    "================================="
  );

  /**
   * ----------------------------------------------------------
   * Shopify customer is required
   * ----------------------------------------------------------
   */

  if (
    !tradeAccount.shopifyCustomerId
  ) {
    throw new Error(
      "Trade account does not have a Shopify Customer ID."
    );
  }

  /**
   * ----------------------------------------------------------
   * Validate percentage
   * ----------------------------------------------------------
   */

  const discountPercent =
    validateDiscountPercent(
      tradeAccount.discountPercent
    );

  /**
   * ----------------------------------------------------------
   * If discount already exists,
   * update it instead.
   * ----------------------------------------------------------
   */

  if (
    tradeAccount.shopifyTradeDiscountId
  ) {
    console.log(
      "Existing Shopify trade discount found."
    );

    console.log(
      "Updating existing discount instead of creating another one."
    );

    return updateTradePriceDiscount({
      admin,
      tradeAccount,
    });
  }

  /**
   * ----------------------------------------------------------
   * Discount title
   * ----------------------------------------------------------
   */

  const title =
    `Trade Price - ${tradeAccount.businessName}`;

  /**
   * ==========================================================
   * SHOPIFY MUTATION
   * ==========================================================
   *
   * IMPORTANT:
   *
   * DiscountItems is a GraphQL UNION.
   *
   * Therefore this is INVALID:
   *
   * items {
   *   all
   * }
   *
   * The correct response selection is:
   *
   * items {
   *   ... on AllDiscountItems {
   *     allItems
   *   }
   * }
   *
   * The INPUT remains:
   *
   * items: {
   *   all: true
   * }
   *
   * We only request the ID and userErrors here because the
   * application does not need the complete discount object
   * after creation.
   * ==========================================================
   */

  const mutation = `
    mutation CreateTradeDiscount(
      $automaticBasicDiscount: DiscountAutomaticBasicInput!
    ) {
      discountAutomaticBasicCreate(
        automaticBasicDiscount: $automaticBasicDiscount
      ) {
        automaticDiscountNode {
          id
        }

        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  /**
   * ----------------------------------------------------------
   * Mutation variables
   * ----------------------------------------------------------
   *
   * Example:
   *
   * 10%
   *
   * becomes:
   *
   * 0.10
   *
   * The discount is restricted to the Shopify customer
   * belonging to this Trade Account.
   * ----------------------------------------------------------
   */

  const variables = {
    automaticBasicDiscount: {
      title,

      startsAt:
        new Date().toISOString(),

      customerGets: {
        value: {
          percentage:
            discountPercent / 100,
        },

        items: {
          all: true,
        },
      },
      // =========================================================
    // ALLOW TRADE PRICE TO COMBINE WITH OTHER DISCOUNT CLASSES
    // =========================================================
          combinesWith: {
      productDiscounts: true,
      orderDiscounts: true,
      shippingDiscounts: true,
    },
      context: {
        customers: {
          add: [
            tradeAccount.shopifyCustomerId,
          ],
        },
      },
    },
  };

  console.log(
    "================================="
  );

  console.log(
    "CREATING SHOPIFY TRADE DISCOUNT"
  );

  console.log(
    JSON.stringify(
      variables,
      null,
      2
    )
  );

  console.log(
    "================================="
  );

  /**
   * ----------------------------------------------------------
   * Execute mutation
   * ----------------------------------------------------------
   */

  const result =
    await shopifyGraphQL({
      admin,
      query: mutation,
      variables,
    });

  const payload =
    result.data
      ?.discountAutomaticBasicCreate;

  /**
   * ----------------------------------------------------------
   * Safety check
   * ----------------------------------------------------------
   */

  if (!payload) {
    throw new Error(
      "Shopify did not return a discount creation response."
    );
  }

  /**
   * ----------------------------------------------------------
   * Shopify user errors
   * ----------------------------------------------------------
   */

  if (
    payload.userErrors?.length
  ) {
    console.error(
      "================================="
    );

    console.error(
      "TRADE DISCOUNT CREATION ERRORS"
    );

    console.error(
      JSON.stringify(
        payload.userErrors,
        null,
        2
      )
    );

    console.error(
      "================================="
    );

    throw new Error(
      payload.userErrors
        .map(
          (error) =>
            `${error.field?.join(".") || "unknown"}: ${error.message}`
        )
        .join(", ")
    );
  }

  /**
   * ----------------------------------------------------------
   * Get Shopify discount node ID
   * ----------------------------------------------------------
   *
   * The ID belongs to:
   *
   * automaticDiscountNode.id
   *
   * NOT:
   *
   * automaticDiscount.id
   * ----------------------------------------------------------
   */

  const discountNode =
    payload.automaticDiscountNode;

  if (
    !discountNode?.id
  ) {
    throw new Error(
      "Shopify trade discount was created but no automatic discount node ID was returned."
    );
  }

  const shopifyTradeDiscountId =
    discountNode.id;

  /**
   * ----------------------------------------------------------
   * Save Shopify discount ID in Prisma
   * ----------------------------------------------------------
   */

  const updatedTradeAccount =
    await prisma.tradeAccount.update({
      where: {
        id: tradeAccount.id,
      },

      data: {
        shopifyTradeDiscountId,
      },
    });

  /**
   * ----------------------------------------------------------
   * SUCCESS LOG
   * ----------------------------------------------------------
   */

  console.log(
    "================================="
  );

  console.log(
    "TRADE PRICE DISCOUNT CREATED SUCCESSFULLY"
  );

  console.log({
    tradeAccountId:
      updatedTradeAccount.id,

    businessName:
      updatedTradeAccount.businessName,

    shopifyCustomerId:
      updatedTradeAccount.shopifyCustomerId,

    shopifyTradeDiscountId:
      updatedTradeAccount.shopifyTradeDiscountId,

    discountPercent,
  });

  console.log(
    "================================="
  );

  return updatedTradeAccount;
}

/**
 * ============================================================
 * UPDATE TRADE PRICE DISCOUNT
 * ============================================================
 */

export async function updateTradePriceDiscount({
  admin,
  tradeAccount,
}) {
  console.log(
    "================================="
  );

  console.log(
    "UPDATE TRADE PRICE DISCOUNT"
  );

  console.log({
    tradeAccountId:
      tradeAccount.id,

    businessName:
      tradeAccount.businessName,

    shopifyCustomerId:
      tradeAccount.shopifyCustomerId,

    existingDiscountId:
      tradeAccount.shopifyTradeDiscountId,

    discountPercent:
      tradeAccount.discountPercent,
  });

  console.log(
    "================================="
  );

  /**
   * ----------------------------------------------------------
   * If there is no existing Shopify discount,
   * create one.
   * ----------------------------------------------------------
   */

  if (
    !tradeAccount.shopifyTradeDiscountId
  ) {
    return createTradePriceDiscount({
      admin,
      tradeAccount,
    });
  }

  /**
   * ----------------------------------------------------------
   * Shopify customer is required
   * ----------------------------------------------------------
   */

  if (
    !tradeAccount.shopifyCustomerId
  ) {
    throw new Error(
      "Trade account does not have a Shopify Customer ID."
    );
  }

  /**
   * ----------------------------------------------------------
   * Validate discount
   * ----------------------------------------------------------
   */

  const discountPercent =
    validateDiscountPercent(
      tradeAccount.discountPercent
    );

  /**
   * ==========================================================
   * SHOPIFY UPDATE MUTATION
   * ==========================================================
   *
   * We only request the automatic discount node ID and
   * userErrors.
   *
   * This avoids querying any union fields unnecessarily.
   * ==========================================================
   */

  const mutation = `
    mutation UpdateTradeDiscount(
      $id: ID!
      $automaticBasicDiscount: DiscountAutomaticBasicInput!
    ) {
      discountAutomaticBasicUpdate(
        id: $id
        automaticBasicDiscount: $automaticBasicDiscount
      ) {
        automaticDiscountNode {
          id
        }

        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  /**
   * ----------------------------------------------------------
   * Update variables
   * ----------------------------------------------------------
   */

  const variables = {
    id:
      tradeAccount.shopifyTradeDiscountId,

    automaticBasicDiscount: {
      title:
        `Trade Price - ${tradeAccount.businessName}`,

      customerGets: {
        value: {
          percentage:
            discountPercent / 100,
        },

        items: {
          all: true,
        },
      },
// =========================================================
    // ALLOW TRADE PRICE TO COMBINE WITH OTHER DISCOUNT CLASSES
    // =========================================================

    combinesWith: {
      productDiscounts: true,
      orderDiscounts: true,
      shippingDiscounts: true,
    },
      context: {
        customers: {
          add: [
            tradeAccount.shopifyCustomerId,
          ],
        },
      },
    },
  };

  console.log(
    "================================="
  );

  console.log(
    "UPDATING SHOPIFY TRADE DISCOUNT"
  );

  console.log(
    JSON.stringify(
      variables,
      null,
      2
    )
  );

  console.log(
    "================================="
  );

  /**
   * ----------------------------------------------------------
   * Execute mutation
   * ----------------------------------------------------------
   */

  const result =
    await shopifyGraphQL({
      admin,
      query: mutation,
      variables,
    });

  const payload =
    result.data
      ?.discountAutomaticBasicUpdate;

  /**
   * ----------------------------------------------------------
   * Safety check
   * ----------------------------------------------------------
   */

  if (!payload) {
    throw new Error(
      "Shopify did not return a discount update response."
    );
  }

  /**
   * ----------------------------------------------------------
   * Shopify user errors
   * ----------------------------------------------------------
   */

  if (
    payload.userErrors?.length
  ) {
    console.error(
      "================================="
    );

    console.error(
      "TRADE DISCOUNT UPDATE ERRORS"
    );

    console.error(
      JSON.stringify(
        payload.userErrors,
        null,
        2
      )
    );

    console.error(
      "================================="
    );

    throw new Error(
      payload.userErrors
        .map(
          (error) =>
            `${error.field?.join(".") || "unknown"}: ${error.message}`
        )
        .join(", ")
    );
  }

  /**
   * ----------------------------------------------------------
   * Confirm Shopify returned the node
   * ----------------------------------------------------------
   */

  const discountNode =
    payload.automaticDiscountNode;

  if (
    !discountNode?.id
  ) {
    throw new Error(
      "Shopify updated the trade discount but did not return the discount node ID."
    );
  }

  /**
   * ----------------------------------------------------------
   * SUCCESS
   * ----------------------------------------------------------
   */

  console.log(
    "================================="
  );

  console.log(
    "TRADE PRICE DISCOUNT UPDATED SUCCESSFULLY"
  );

  console.log({
    tradeAccountId:
      tradeAccount.id,

    businessName:
      tradeAccount.businessName,

    shopifyCustomerId:
      tradeAccount.shopifyCustomerId,

    shopifyTradeDiscountId:
      discountNode.id,

    discountPercent,
  });

  console.log(
    "================================="
  );

  return true;
}

/**
 * ============================================================
 * DELETE TRADE PRICE DISCOUNT
 * ============================================================
 */

export async function deleteTradePriceDiscount({
  admin,
  tradeAccount,
}) {
  console.log(
    "================================="
  );

  console.log(
    "DELETE TRADE PRICE DISCOUNT"
  );

  console.log({
    tradeAccountId:
      tradeAccount.id,

    businessName:
      tradeAccount.businessName,

    shopifyTradeDiscountId:
      tradeAccount.shopifyTradeDiscountId,
  });

  console.log(
    "================================="
  );

  /**
   * ----------------------------------------------------------
   * Nothing to delete
   * ----------------------------------------------------------
   */

  if (
    !tradeAccount.shopifyTradeDiscountId
  ) {
    console.log(
      "No Shopify trade discount exists."
    );

    return;
  }

  /**
   * ----------------------------------------------------------
   * Delete mutation
   * ----------------------------------------------------------
   */

  const mutation = `
    mutation DeleteTradeDiscount(
      $id: ID!
    ) {
      discountAutomaticDelete(
        id: $id
      ) {
        deletedAutomaticDiscountId

        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  /**
   * ----------------------------------------------------------
   * Execute mutation
   * ----------------------------------------------------------
   */

  const result =
    await shopifyGraphQL({
      admin,
      query: mutation,
      variables: {
        id:
          tradeAccount.shopifyTradeDiscountId,
      },
    });

  const payload =
    result.data
      ?.discountAutomaticDelete;

  /**
   * ----------------------------------------------------------
   * Safety check
   * ----------------------------------------------------------
   */

  if (!payload) {
    throw new Error(
      "Shopify did not return a discount deletion response."
    );
  }

  /**
   * ----------------------------------------------------------
   * Shopify errors
   * ----------------------------------------------------------
   */

  if (
    payload.userErrors?.length
  ) {
    console.error(
      "================================="
    );

    console.error(
      "TRADE DISCOUNT DELETE ERRORS"
    );

    console.error(
      JSON.stringify(
        payload.userErrors,
        null,
        2
      )
    );

    console.error(
      "================================="
    );

    throw new Error(
      payload.userErrors
        .map(
          (error) =>
            `${error.field?.join(".") || "unknown"}: ${error.message}`
        )
        .join(", ")
    );
  }

  /**
   * ----------------------------------------------------------
   * Clear Prisma reference
   * ----------------------------------------------------------
   */

  await prisma.tradeAccount.update({
    where: {
      id: tradeAccount.id,
    },

    data: {
      shopifyTradeDiscountId:
        null,
    },
  });

  /**
   * ----------------------------------------------------------
   * SUCCESS
   * ----------------------------------------------------------
   */

  console.log(
    "================================="
  );

  console.log(
    "TRADE PRICE DISCOUNT DELETED SUCCESSFULLY"
  );

  console.log({
    tradeAccountId:
      tradeAccount.id,

    businessName:
      tradeAccount.businessName,
  });

  console.log(
    "================================="
  );
}