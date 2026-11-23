import type { RankLogEntryKind, RankLogQueueType } from '@shared/shards/rank-log'
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * [lolps] 上分日志的一行：一局排位、一次漏记、一次非对局的胜点变动，或一个起点。
 * 只记录使用 League Akari 的本人账号。时间一律是毫秒时间戳。
 */
@Entity('RankLogEntries')
@Index('rank_log_entries_game_unique', ['puuid', 'sgpServerId', 'gameId'], { unique: true })
@Index('rank_log_entries_owner_time_index', ['puuid', 'sgpServerId', 'occurredAt'])
export class RankLogEntry {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', nullable: false })
  puuid: string

  @Column({ type: 'varchar', nullable: false })
  sgpServerId: string

  @Column({ type: 'varchar', nullable: false })
  kind: RankLogEntryKind

  @Column({ type: 'varchar', nullable: false })
  queueType: RankLogQueueType

  /** 已识别的对局是对局结束时间，其余是看到变化的时间 */
  @Column({ type: 'integer', nullable: false })
  occurredAt: number

  /** 读到这一行之后段位的时间；仅从战绩补录、没有段位的行为空 */
  @Column({ type: 'integer', nullable: true })
  observedAt: number | null

  @Column({ type: 'integer', nullable: true })
  gameId: number | null

  @Column({ type: 'integer', nullable: true })
  gameCreation: number | null

  /** 秒 */
  @Column({ type: 'integer', nullable: true })
  gameDuration: number | null

  @Column({ type: 'integer', nullable: true })
  championId: number | null

  @Column({ type: 'varchar', nullable: true })
  position: string | null

  @Column({ type: 'boolean', nullable: true })
  win: boolean | null

  @Column({ type: 'boolean', nullable: true })
  remake: boolean | null

  @Column({ type: 'integer', nullable: true })
  kills: number | null

  @Column({ type: 'integer', nullable: true })
  deaths: number | null

  @Column({ type: 'integer', nullable: true })
  assists: number | null

  @Column({ type: 'integer', nullable: true })
  cs: number | null

  /** 漏记行覆盖的对局数 */
  @Column({ type: 'integer', nullable: true })
  games: number | null

  @Column({ type: 'integer', nullable: true })
  lpDelta: number | null

  @Column({ type: 'varchar', nullable: true })
  tier: string | null

  @Column({ type: 'varchar', nullable: true })
  division: string | null

  @Column({ type: 'integer', nullable: true })
  leaguePoints: number | null

  @Column({ type: 'integer', nullable: true })
  absoluteLp: number | null

  @Column({ type: 'boolean', nullable: true })
  provisional: boolean | null

  @Column({ type: 'integer', nullable: true })
  wins: number | null

  @Column({ type: 'integer', nullable: true })
  losses: number | null
}
