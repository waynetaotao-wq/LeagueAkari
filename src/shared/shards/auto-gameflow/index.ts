export type AutoHonorStrategy =
  | 'prefer-lobby-member'
  | 'only-lobby-member'
  | 'all-member'
  | 'opt-out'
  | 'all-member-including-opponent'

export type AutoReportScope = 'opponents-only' | 'all'

export type AutoReportCategory =
  | 'NEGATIVE_ATTITUDE'
  | 'VERBAL_ABUSE'
  | 'LEAVING_AFK'
  | 'ASSISTING_ENEMY_TEAM'
  | 'HATE_SPEECH'
  | 'THIRD_PARTY_TOOLS'
  | 'INAPPROPRIATE_NAME'

export type AutoMatchmakingStrategy = 'never' | 'fixed-duration' | 'estimated-duration'
