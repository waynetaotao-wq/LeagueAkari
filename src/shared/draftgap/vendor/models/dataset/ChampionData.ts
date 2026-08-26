// @ts-nocheck -- vendored from DraftGap (MIT); excluded from host strict typecheck. See PORTING-NOTES.md
import { type ChampionRoleData } from "./ChampionRoleData";
import { Role } from "../Role";

export interface ChampionData {
    id: string;
    key: string;
    name: string;
    i18n: Record<
        string,
        {
            name: string;
        }
    >;
    statsByRole: Record<Role, ChampionRoleData>;
}
