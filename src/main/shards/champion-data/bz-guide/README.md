# Bz workbook records

`verified-snapshot.json` contains image and loadout records parsed from the author's public
[Google workbook](https://docs.google.com/spreadsheets/d/1FInDZ2JhIyto2y-FnCcgCVlAYcjRaF7egcpsV41Spic/edit#gid=1026317672),
read on **2026-09-13 at 15:52:01 UTC**. `fetchedAt` records this successful read,
not the author's last edit time. The 63 rows were parsed with `parseBzWorkbook`;
62 contain a unique spell pair and starter. Lissandra's overlapping spell choices
remain unresolved. Image previews and the author's prose are omitted from the bundled
copy; prose continues to load from the public exports. A user's local successful
workbook cache can retain the text for offline reading.

`championSlugs` was matched uniquely against Riot's Data Dragon **16.18.1** champion
catalog for all 63 rows. These identities let the guide open without first waiting
for OP.GG. New opponents can still use the existing online slug lookup.

The application returns this record immediately on first use, or a more recent
successful workbook stored in `<userData>/champion-data/bz-workbook.json`. It reads
the live workbook in the background, checks its schema and icons, and notifies
open consumers with `bz-guide-updated`. A successful refresh replaces the entire
record and is saved atomically; an unsuccessful refresh retries after one minute
while the relevant page remains active. The normal refresh interval is ten minutes.

Saved images are explicitly separate from fresh CSV text. They are displayed
automatically in both Bz surfaces and in the recommendation sections, with their
own time and status. They cannot satisfy the automatic client-write contract.
Only a fresh workbook plus a current resource catalog can do that. A live image
conflict is never completed using a saved record or the old manual defaults.

When intentionally replacing the bundled record, parse a fresh XLSX with the
production parser, compare all five text fields with the independent CSV export,
verify champion identities and current spell/item catalogs, retain conflicts,
and record the actual acquisition time. Do not update only the timestamp or reuse
the old manual `BzExtras` table as though it came from the live workbook.
