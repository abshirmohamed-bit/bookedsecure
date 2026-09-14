# Edit campaign drafts inside Cowork

## What will change
- Add an inline campaign editor to Cowork’s campaign proposal card.
- Let tenants select individual recipients or select all messages.
- Let tenants update the shared campaign wording for the selected messages without leaving Cowork.
- Refresh the visible previews after saving, while retaining each lead’s name, private quote link, tenant signature, and opt-out wording.
- Keep campaign sending behind the existing permission checkbox and confirmation action.

## Technical details
- Reuse the existing tenant-scoped bulk campaign update function and its 180-character editable-copy limit.
- Update only the Cowork campaign proposal interface; no schema, campaign targeting, or sending-rule changes.
- Use the existing design-system controls and verify desktop/mobile behavior plus targeted tests and the preview build.
