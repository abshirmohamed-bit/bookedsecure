import { operationTool } from '../operation-tool';
export default operationTool('update_customer', 'Update customer details', 'Change only owner-requested customer fields. Look up the customer first. Null leaves a field unchanged. clearOptOut is allowed only when the owner explicitly states renewed customer consent; never infer consent.');
