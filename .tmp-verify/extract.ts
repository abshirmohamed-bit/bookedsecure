import { extractIntake, parseApprovedLocations, applyIntake, outstandingFields } from "@/lib/web-chat-intake";
const services=[
{id:"c9f996ba-2581-413d-bf1d-5edf4b3391aa",name:"Ceramic Coating"},
{id:"9cb4d188-784a-4a8f-af8c-aa31efe7d365",name:"Full Detail Interior + Exterior"},
{id:"710cdf04-aae0-48e3-b84a-0e01ccec1da8",name:"Full Interior Detail"},
{id:"69889f82-9eef-427a-990d-87e22630ea02",name:"Paint Enhancement Detail"},
{id:"5602140c-5d52-4925-a203-317548fb5119",name:"Pet Hair & Odour Treatment"}];
const serviceArea="Sydney metro (Inner West, Eastern Suburbs, North Shore)";
const locations=parseApprovedLocations(serviceArea);
const tenant={timezone:"Australia/Sydney",services,locations};
const msg="Book ceramic coat in Punchbowl station. I drive a Toyota RAV4. My name is Alex Smith.";
const e=extractIntake(msg,tenant,new Date());
console.log("locations:",JSON.stringify(locations));
console.log("extraction:",JSON.stringify(e,null,1));
const chatTenant={name:"Glocast",flexibleRequestsEnabled:true,services} as never;
const a=applyIntake({},e,chatTenant);
console.log("applied:",a.applied,"collected:",JSON.stringify(a.collected));
console.log("outstanding:",outstandingFields(a.collected));
const c=extractIntake("Actually, change the vehicle to a Mazda CX-5 and the suburb to Bankstown.",tenant,new Date());
console.log("correction:",JSON.stringify({intent:c.intent,vehicle:c.vehicle,location:c.location,unmatched:c.unmatched}));
