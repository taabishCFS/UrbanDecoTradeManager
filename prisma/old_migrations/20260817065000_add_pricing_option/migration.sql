-- CreateEnum
CREATE TYPE "PricingOption" AS ENUM ('TRADE_PRICE', 'REFERRAL', 'CLIENT_SPECIAL_PRICE');

-- AlterTable
ALTER TABLE "TradeAccount"
ADD COLUMN "pricingOption" "PricingOption" NOT NULL DEFAULT 'TRADE_PRICE';
