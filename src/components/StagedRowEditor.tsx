// Modal editor for ONE staged CRM import row.
//
// Preview-only: saving calls the owner-gated `editCrmImportRow` server function,
// which writes to the staged row (and one audit record) and nothing else. No
// live lead is created or updated, and nothing is committed by saving.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { editCrmImportRow } from "@/lib/csv-import.functions";
import { LEAD_STATUSES } from "@/lib/domain";
import { readCommitState } from "@/lib/commit-gate";
import {
  EDITABLE_FIELDS,
  EDITABLE_FIELD_LABELS,
  STAGED_EDIT_SCOPE_NOTICE,
  STAGED_ROW_STATE_LABELS,
  exceptionLabel,
  isCreatedDateEditable,
  issuesForField,
  maskContact,
  maskLeadId,
  readEditableValues,
  readOriginalValues,
  resolveStagedRowState,
  type EditableField,
  type EditableValues,
} from "@/lib/staged-row-edit";

export type StagedRowLike = {
  row_number: number;
  validation_errors: { code: string; field?: string; detail?: string }[];
  dedupe_match_lead_id: string | null;
  duplicate_of_row: number | null;
  normalized_payload: Record<string, unknown>;
  review?: { decision: string } | null;
  classification?: { classification: string } | null;
};

const LONG_FIELDS: EditableField[] = ["labels"];

export function StagedRowEditor({
  batchId,
  row,
  rawRow,
  onClose,
  onDirtyChange,
}: {
  batchId: string;
  row: StagedRowLike;
  rawRow: Record<string, unknown>;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const save = useServerFn(editCrmImportRow);
  const queryClient = useQueryClient();
  const closeRef = useRef<HTMLButtonElement>(null);

  const payload = row.normalized_payload as Parameters<typeof readEditableValues>[0];
  const parsed = useMemo(() => readEditableValues(payload), [payload]);
  const original = useMemo(() => readOriginalValues(payload), [payload]);
  const dateEditable = isCreatedDateEditable(payload);

  const [values, setValues] = useState<EditableValues>(parsed);
  const [reason, setReason] = useState("");

  const dirty = EDITABLE_FIELDS.some((field) => values[field] !== parsed[field]);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const beforeState = resolveStagedRowState({
    commit_status: readCommitState(row.normalized_payload).status,
    review_decision: row.review?.decision,
    classification: row.classification?.classification,
    validation_errors: row.validation_errors,
    dedupe_match_lead_id: row.dedupe_match_lead_id,
    duplicate_of_row: row.duplicate_of_row,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const changed: Partial<Record<EditableField, string>> = {};
      for (const field of EDITABLE_FIELDS) {
        if (values[field] !== parsed[field]) changed[field] = values[field];
      }
      return save({
        data: {
          batchId,
          rowNumber: row.row_number,
          fields: changed,
          reason: reason.trim() || null,
        },
      });
    },
    onSuccess: async (result) => {
      // No customer contact values are logged or toasted. state names only.
      toast.success(
        `Row ${result.rowNumber} saved (staged only). now ${STAGED_ROW_STATE_LABELS[result.state]}`,
      );
      onDirtyChange?.(false);
      await queryClient.invalidateQueries({ queryKey: ["crm-import-batch", batchId] });
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rawFor = (field: EditableField): string => original[field] || "";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-background/80 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="staged-edit-title"
        className="panel my-6 w-full max-w-2xl space-y-4 p-4"
      >
        <div className="space-y-1">
          <h2 id="staged-edit-title" className="text-sm font-semibold">
            Edit staged row {row.row_number}
          </h2>
          <p className="text-xs text-muted-foreground">{STAGED_EDIT_SCOPE_NOTICE}</p>
          <p className="text-xs text-muted-foreground">
            Current state: {STAGED_ROW_STATE_LABELS[beforeState]}
          </p>
        </div>

        {row.validation_errors.length ? (
          <ul className="space-y-0.5 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            {row.validation_errors.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>{exceptionLabel(issue.code)}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            No issues on this row. Editing it re-runs validation.
          </p>
        )}

        {row.dedupe_match_lead_id || row.duplicate_of_row !== null ? (
          <p className="text-xs text-warning">
            Potential duplicate:{" "}
            {row.dedupe_match_lead_id
              ? `existing lead ${maskLeadId(row.dedupe_match_lead_id)}`
              : `staged row ${row.duplicate_of_row}`}{" "}
            · {maskContact(parsed.phone || parsed.email)} · records are never merged automatically.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {EDITABLE_FIELDS.map((field) => {
            const disabled = field === "created_at" && !dateEditable;
            const issues = issuesForField(row.validation_errors, field);
            const raw = rawFor(field);
            const inputId = `staged-${row.row_number}-${field}`;
            return (
              <div
                key={field}
                className={LONG_FIELDS.includes(field) ? "space-y-1 sm:col-span-2" : "space-y-1"}
              >
                <label htmlFor={inputId} className="block text-xs font-medium">
                  {EDITABLE_FIELD_LABELS[field]}
                </label>
                {field === "status" ? (
                  <select
                    id={inputId}
                    value={values.status}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, status: event.target.value }))
                    }
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <option value="">- not set -</option>
                    {LEAD_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={inputId}
                    value={values[field]}
                    disabled={disabled}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [field]: event.target.value }))
                    }
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                )}
                {issues.length ? (
                  <p className="text-[11px] text-destructive">
                    {issues.map((issue) => exceptionLabel(issue.code)).join(" · ")}
                  </p>
                ) : null}
                {raw && raw !== values[field] ? (
                  <p className="text-[11px] text-muted-foreground">Uploaded: {raw}</p>
                ) : null}
                {values[field] !== parsed[field] ? (
                  <button
                    type="button"
                    onClick={() => setValues((prev) => ({ ...prev, [field]: parsed[field] }))}
                    className="text-[11px] text-muted-foreground underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Reset field to original parsed value
                  </button>
                ) : null}
                {disabled ? (
                  <p className="text-[11px] text-muted-foreground">
                    The parsed date is valid, so it cannot be changed.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="space-y-1">
          <label htmlFor={`staged-${row.row_number}-reason`} className="block text-xs font-medium">
            Correction reason (optional)
          </label>
          <input
            id={`staged-${row.row_number}-reason`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Saving revalidates the row and updates its state. It does not import the row, send SMS or
          change any live lead. Raw uploaded values are kept permanently.
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setValues(parsed)}
            disabled={!dirty || mutation.isPending}
            className="rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Reset entire row
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={() => {
              onDirtyChange?.(false);
              onClose();
            }}
            className="rounded-md border border-input px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={mutation.isPending || !dirty}
            onClick={() => mutation.mutate()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {mutation.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
        {Object.keys(rawRow).length ? (
          <p className="text-[11px] text-muted-foreground">
            Original uploaded row preserved ({Object.keys(rawRow).length} columns).
          </p>
        ) : null}
      </div>
    </div>
  );
}
