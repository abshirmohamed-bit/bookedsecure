import { extractNotes, extractIntake } from "../src/lib/web-chat-intake";
const msg = "Full interior detail in Bankstown for my Mazda CX-5, name Sam Rivers, mobile 0400 555 899, pet hair in the back, email sam899@example.com";
console.log("notes:", JSON.stringify(extractNotes(msg)));
