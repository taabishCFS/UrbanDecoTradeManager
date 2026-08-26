import prisma from "../db.server";
import { authenticate } from "../shopify.server";

console.log(
 "🔥 API TRADE DASHBOARD HIT"
);
export async function loader({ request }) {

  try {
const { admin } =
      await authenticate.admin(request);
    const url = new URL(request.url);


    const customerId =
      url.searchParams.get(
        "logged_in_customer_id"
      );

      const customerResponse =
await admin.graphql(
`
query getCustomer($id:ID!){
 customer(id:$id){
   id
   email
   tags
 }
}
`,
{
 variables:{
   id:`gid://shopify/Customer/${customerId}`
 }
}
);


const customerResult =
await customerResponse.json();


const customer =
customerResult.data.customer;


if(
 !customer ||
 !customer.tags.includes("TRADE_ACCOUNT")
){

 return Response.json(
 {
   success:false,
   message:
   "Trade account access required."
 },
 {
   status:403
 }
 );

}

    console.log(
      "SHOPIFY CUSTOMER ID:",
      customerId
    );

console.log(
  "ALL QUERY PARAMS:",
  Object.fromEntries(url.searchParams)
);
    if (!customerId) {

      return Response.json(
        {
          success:false,
          message:"Customer not logged in"
        },
        {
          status:401
        }
      );

    }


    /*
    =====================================
    FIND TRADE ACCOUNT
    =====================================
    */


   const tradeAccount =
await prisma.tradeAccount.findFirst({

  where:{
    OR:[

      {
        shopifyCustomerId:
        customerId.toString()
      },

      {
        shopifyCustomerId:
        `gid://shopify/Customer/${customerId}`
      }

    ],

    status:"ACTIVE"

  }

});



    if(!tradeAccount){

      return Response.json(
        {
          success:false,
          message:"Trade account not found"
        },
        {
          status:403
        }
      );

    }
switch(tradeAccount.status){

case "SUSPENDED":

return Response.json({
 success:false,
 status:"SUSPENDED",
 message:
 "Your trade account is currently suspended."
});


case "CLOSED":

return Response.json({
 success:false,
 status:"CLOSED",
 message:
 "Your trade account has been closed."
});


}


    /*
    =====================================
    GET COMMISSIONS
    =====================================
    */


    const commissions =
      await prisma.commission.findMany({

        where:{
          tradeAccountId:
            tradeAccount.id
        },

        orderBy:{
          createdAt:"desc"
        }

      });


/*
=====================================
GET CUSTOMER ORDERS
=====================================
*/

const ordersResponse =
  await admin.graphql(
    `#graphql
      query getCustomerOrders(
        $id: ID!
        $first: Int!
      ) {
        customer(id: $id) {
          orders(
            first: $first
          ) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `,
    {
      variables: {
        id:
          tradeAccount.shopifyCustomerId.startsWith(
            "gid://"
          )
            ? tradeAccount.shopifyCustomerId
            : `gid://shopify/Customer/${tradeAccount.shopifyCustomerId}`,

        first: 250,
      },
    }
  );


const ordersResult =
  await ordersResponse.json();


console.log(
  "SHOPIFY CUSTOMER ORDERS RESPONSE:"
);

console.log(
  JSON.stringify(
    ordersResult,
    null,
    2
  )
);


/*
=====================================
TOTAL CUSTOMER ORDERS
=====================================
*/

const totalOrders =
  ordersResult
    ?.data
    ?.customer
    ?.orders
    ?.edges
    ?.length || 0;



    /*
    =====================================
    CALCULATE TOTALS
    =====================================
    */


    // let totalOrders =
    //   commissions.length;


    let totalCommission =
      0;


    let receivedCommission =
      0;


    let pendingCommission =
      0;



    commissions.forEach((commission)=>{


      const amount =
        Number(
          commission.commissionAmount
        );


      totalCommission += amount;



      if(
        commission.status === "PAID"
      ){

        receivedCommission += amount;

      }


      if(
        commission.status === "PENDING" ||
        commission.status === "APPROVED"
      ){

        pendingCommission += amount;

      }


    });



    /*
    =====================================
    REFERRAL LINK
    =====================================
    */


    let referral = null;


    if(
      tradeAccount.pricingOption ===
      "REFERRAL"
    ){

      referral = {

        enabled:true,

        code:
        tradeAccount.referralCode,


        link:
        `/trade/ref/${tradeAccount.referralCode}`

      };

    }
    else{

      referral = {

        enabled:false

      };

    }



    /*
    =====================================
    RESPONSE
    =====================================
    */


    return Response.json({

      success:true,


      dashboard:{

        designer:{

          businessName:
          tradeAccount.businessName,

          email:
          tradeAccount.email

        },


        pricingModel:
        tradeAccount.pricingOption,


        orders:{

          total:
          totalOrders

        },


        commission:{

          total:
          Number(
            totalCommission.toFixed(2)
          ),


          received:
          Number(
            receivedCommission.toFixed(2)
          ),


          pending:
          Number(
            pendingCommission.toFixed(2)
          )

        },


        referral

      }

    });



  }


  catch(error){


    console.error(
      "TRADE DASHBOARD ERROR",
      error
    );


    return Response.json(
      {
        success:false,
        message:error.message
      },
      {
        status:500
      }
    );


  }

}