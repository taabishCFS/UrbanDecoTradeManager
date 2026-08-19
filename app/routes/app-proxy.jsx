import prisma from "../db.server";


export async function loader({ request }) {

  try {

    const url = new URL(request.url);


    const customerId =
      url.searchParams.get(
        "logged_in_customer_id"
      );


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
    CALCULATE TOTALS
    =====================================
    */


    let totalOrders =
      commissions.length;


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