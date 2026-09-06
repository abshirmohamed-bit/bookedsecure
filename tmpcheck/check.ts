import { loadReactivationCandidates, draftReactivationCampaign } from "../src/lib/reactivation.server";
const b = "11111111-1111-1111-1111-111111111111";
const c = await loadReactivationCandidates(b);
console.log("candidates", c.candidates.length, "excluded", c.excluded, c.candidates.slice(0,3));
const view = await draftReactivationCampaign({ businessId: b, userId: "00000000-0000-0000-0000-000000000000", maxLeads: 3 });
console.log("offer", view.campaign?.offerText, "drafts", view.drafts.length);
console.log(view.drafts.slice(0,3).map(d => d.body));
