import { useLoaderData } from "react-router";
import prisma from "../db.server";


export async function loader({request}) {


const url = new URL(request.url);


const customerId =
url.searchParams.get(
"logged_in_customer_id"
);


console.log(
"TRADE DASHBOARD CUSTOMER:",
customerId
);



const tradeAccount =
await prisma.tradeAccount.findFirst({

where:{
OR:[

{
shopifyCustomerId:customerId
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

return {
success:false,
message:"Trade account not found"
};

}



const commissions =
await prisma.commission.findMany({

where:{
tradeAccountId:
tradeAccount.id
}

});



let total=0;


commissions.forEach(c=>{

total += Number(
c.commissionAmount
);

});



return {

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
commissions.length

},


commission:{

total

}


}

};


}




export default function TradeDashboard(){


const data =
useLoaderData();



if(!data.success){

return <h2>{data.message}</h2>;

}



return (

<div style={{
padding:"40px"
}}>


<h1>
Trade Dashboard
</h1>


<h2>
{data.dashboard.designer.businessName}
</h2>


<p>
{data.dashboard.designer.email}
</p>


<h3>
Orders
</h3>


<p>
{data.dashboard.orders.total}
</p>


<h3>
Commission
</h3>


<p>
£{data.dashboard.commission.total}
</p>


</div>

);

}