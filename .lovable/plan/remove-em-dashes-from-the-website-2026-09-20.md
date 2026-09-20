# Remove em dashes from the website

## Changes
- Replace every literal em dash in live page titles, labels, notices, forms, assistant messages, booking messages, and customer-facing status text with natural punctuation.
- Replace standalone em-dash placeholders with clear text such as “Not available”.
- Keep sanitizer tests that deliberately contain em dashes, so the app continues cleaning tenant-provided and AI-generated text automatically.

## Verification
- Search all production website code again to confirm no literal em dashes remain.
- Run the relevant text tests and verify the app builds cleanly.
