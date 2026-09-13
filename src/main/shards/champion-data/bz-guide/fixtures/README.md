# Bz image fixtures

These seven small game icons were extracted from the public Bz matchup workbook on
2026-09-12 and visually checked against their spell/item identities. The workbook is
not included. Game artwork belongs to Riot Games.

Source: <https://docs.google.com/spreadsheets/d/1FInDZ2JhIyto2y-FnCcgCVlAYcjRaF7egcpsV41Spic/edit#gid=1026317672>.

`../icon-references.json` stores SHA-256 digests and base64-encoded 16 × 16 RGB colour
samples (768 bytes each). These identify image **content**, never an export filename,
hero, or fixed spreadsheet row. They cover Flash, Ignite, Cleanse, Teleport, Exhaust,
Doran's Blade, and Doran's Shield. To extend the library, independently verify the
source icon and its current game ID, generate its descriptor with `describeBzIcon`,
and add representative positive and negative recognition checks.

`workbook.ts` builds small OOXML fixtures for row movement, alternate anchors,
overlapping icons, unknown images, and current-source replacement tests. It contains
synthetic advice and is never shipped as a real matchup guide.
