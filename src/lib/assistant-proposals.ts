/**
 * Proposals the assistant hands back for the owner to confirm on screen.
 * Client-safe: shapes only, no server imports.
 */

/** One text to one customer. Nothing sends until the owner confirms. */
export type SendTextProposal = {
  kind: "send_text";
  leadId: string;
  leadName: string;
  mobileNumber: string;
  message: string;
  summary: string;
};

/** A checked contact file, ready to import once the owner confirms. */
export type ImportProposal = {
  kind: "import";
  batchId: string;
  filename: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  summary: string;
};

/** Connected assistants request existing work; the owner starts it in Cowork. */
export type AssistantRequestProposal = {
  kind: 'assistant_request';
  request: string;
  summary: string;
};
