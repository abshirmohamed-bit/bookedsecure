import { operationTool } from '../operation-tool';
export default operationTool('bulk_update_lead_status', 'Change a group of lead statuses', 'Apply the owner-requested inbox status and filters atomically to at most 5000 matching active leads. Does not send, change consent, or clear opt-outs. Read matching leads first.');
