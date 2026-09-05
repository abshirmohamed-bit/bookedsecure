import { extractIntake, applyIntake } from "../src/lib/web-chat-intake";
const tenant = { businessId:"b", name:"Glocast", timezone:"Australia/Sydney",
  services:[{id:"1",name:"Full Detail Interior + Exterior"},{id:"2",name:"Full Interior Detail"}],
  locations:["Sydney metro (Inner West","Eastern Suburbs","North Shore)"] } as never;
const msg = "Full interior detail in Bankstown for my Mazda CX-5, name Sam Rivers, mobile 0400 555 899, pet hair in the back, email sam899@example.com";
const ex = extractIntake(msg, tenant as never, new Date());
console.log(JSON.stringify(ex, null, 1));
const r = applyIntake({} as never, ex, { name:"Glocast", services:[{id:"1",name:"Full Detail Interior + Exterior"},{id:"2",name:"Full Interior Detail"}] } as never);
console.log("applied", r.applied, JSON.stringify(r.collected));
