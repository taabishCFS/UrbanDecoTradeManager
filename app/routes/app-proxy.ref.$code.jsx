import { redirect } from "react-router";
import prisma from "../db.server";

/**
 * ============================================================
 * REFERRAL TRACKING
 * ============================================================
 *
 * Public URL:
 *
 * /apps/trade/ref/UD-ABC123
 *
 * Flow:
 *
 * Referral link
 *      ↓
 * Find Trade Account
 *      ↓
 * Create Referral record
 *      ↓
 * Generate landing session
 *      ↓
 * Redirect to Shopify storefront
 * with referral tracking parameters
 *
 */

export async function loader({ params, request }) {
  const referralCode =
    params.code
      ?.toString()
      .trim()
      .toUpperCase();

  console.log("=================================");
  console.log("REFERRAL LINK OPENED");
  console.log("REFERRAL CODE:", referralCode);
  console.log("=================================");

  /**
   * ----------------------------------------------------------
   * VALIDATE REFERRAL CODE
   * ----------------------------------------------------------
   */

  if (!referralCode) {
    return redirect("/");
  }

  /**
   * ----------------------------------------------------------
   * FIND TRADE ACCOUNT
   * ----------------------------------------------------------
   */

  const tradeAccount =
    await prisma.tradeAccount.findUnique({
      where: {
        referralCode,
      },
    });

  if (!tradeAccount) {
    console.log(
      "INVALID REFERRAL CODE:",
      referralCode
    );

    return redirect("/");
  }

  /**
   * ----------------------------------------------------------
   * CHECK TRADE ACCOUNT STATUS
   * ----------------------------------------------------------
   */

  if (tradeAccount.status !== "ACTIVE") {
    console.log(
      "INACTIVE TRADE ACCOUNT:",
      tradeAccount.id
    );

    return redirect("/");
  }

  /**
   * ----------------------------------------------------------
   * GENERATE UNIQUE LANDING SESSION
   * ----------------------------------------------------------
   */

  const landingSessionId =
    crypto.randomUUID();

  /**
   * ----------------------------------------------------------
   * CREATE REFERRAL RECORD
   * ----------------------------------------------------------
   */

  const referral =
    await prisma.referral.create({
      data: {
        tradeAccountId:
          tradeAccount.id,

        referralCode,

        landingSessionId,
      },
    });

  console.log(
    "REFERRAL CREATED:",
    referral.id
  );

  /**
   * ----------------------------------------------------------
   * GET SHOP DOMAIN
   * ----------------------------------------------------------
   *
   * Shopify App Proxy sends the shop
   * as a query parameter.
   *
   */

  const url =
    new URL(request.url);

  const shop =
    url.searchParams.get("shop");

  /**
   * If Shopify shop cannot be detected,
   * redirect normally.
   */

  if (!shop) {
    console.error(
      "SHOP DOMAIN NOT FOUND IN APP PROXY REQUEST"
    );

    return redirect("/");
  }

  /**
   * ----------------------------------------------------------
   * BUILD STOREFRONT URL
   * ----------------------------------------------------------
   *
   * Example:
   *
   * https://your-store.com/
   * ?ud_referral=REFERRAL_ID
   * &ud_session=SESSION_ID
   *
   */

  const storefrontUrl =
    new URL(
      `https://${shop}/`
    );

  storefrontUrl.searchParams.set(
    "ud_referral",
    referral.id
  );

  storefrontUrl.searchParams.set(
    "ud_session",
    landingSessionId
  );

  console.log(
    "REDIRECTING TO:",
    storefrontUrl.toString()
  );

  /**
   * ----------------------------------------------------------
   * REDIRECT CUSTOMER TO STOREFRONT
   * ----------------------------------------------------------
   */

  return redirect(
    storefrontUrl.toString()
  );
}