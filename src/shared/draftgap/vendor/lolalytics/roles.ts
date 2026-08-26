// @ts-nocheck -- vendored from DraftGap (MIT); excluded from host strict typecheck. See PORTING-NOTES.md
export const LOLALYTICS_ROLES = [
    "top",
    "jungle",
    "middle",
    "bottom",
    "support",
] as const;
export type LolalyticsRole = (typeof LOLALYTICS_ROLES)[number];
