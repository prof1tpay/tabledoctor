TableDoctor — local CSV/XLSX cleanup
===================================

1. Unzip this folder anywhere.
2. Open index.html in Chrome, Edge, Safari or Firefox.
3. Drop a .csv, .tsv or .xlsx file. Nothing is uploaded: the app makes zero network requests.

What it fixes
- broken quotes, stray delimiters, padded/short rows
- BOM, non-breaking spaces, zero-width characters, Windows-1251 and UTF-16 encodings
- duplicate rows (exact, smart match on email/phone, optional fuzzy company match)
- empty rows and duplicate/empty headers
- formula-injection cells (=, +, -, @) that can execute on import
- Excel artifacts like ="007"

What you get
- clean CSV (UTF-8 with BOM, opens correctly in Excel) or XLSX
- a Markdown report with column types, invalid values and removed duplicates
- a preview with the exact rows that will be exported

Limits
- FREE build: up to 250 rows, CSV export.
- PRO build: no row limit, CSV + XLSX export.

Support: reply to your purchase receipt.
No analytics, no telemetry, no accounts, no subscription.
