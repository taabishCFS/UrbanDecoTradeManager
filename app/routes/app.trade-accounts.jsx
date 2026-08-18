import { Outlet, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  await authenticate.admin(request);

  return null;
}

export default function TradeAccountsLayout() {
  return <Outlet />;
}