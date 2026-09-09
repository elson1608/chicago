import {
    useEffect,
    useState,
} from 'react'

import type {PlayerStats as PlayerStatsData} from '../../shared/player-stats'
import {getPlayerStats} from '../stats'

type PlayerStatsProps = {
    userId: string
}

type StatRingProps = {
    value: number
    label: string
}

function StatRing({
                      value,
                      label,
                  }: StatRingProps) {
    const percentage =
        Math.max(
            0,
            Math.min(100, value),
        )

    return (
        <div className="stat-ring-container">
            <div
                className="stat-ring"
                style={{
                    background:
                        `conic-gradient(
                            var(--chicago-accent) ${percentage}%,
                            var(--chicago-panel-light) ${percentage}% 100%
                        )`,
                }}
            >
                <div className="stat-ring-inner">
                    {Math.round(percentage)}%
                </div>
            </div>

            <span>{label}</span>
        </div>
    )
}

export function PlayerStats({
                                userId,
                            }: PlayerStatsProps) {
    const [stats, setStats] =
        useState<PlayerStatsData | null>(null)

    const [error, setError] =
        useState<string | null>(null)

    useEffect(() => {
        let cancelled = false

        getPlayerStats(userId)
            .then((playerStats) => {
                if (!cancelled) {
                    setStats(playerStats)
                }
            })
            .catch((error: unknown) => {
                if (cancelled) {
                    return
                }

                setError(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load statistics.',
                )
            })

        return () => {
            cancelled = true
        }
    }, [userId])

    if (error) {
        return (
            <section className="panel stats-panel">
                <p>
                    Failed to load statistics.
                </p>
            </section>
        )
    }

    if (!stats) {
        return (
            <section className="panel stats-panel">
                <p>
                    Loading statistics...
                </p>
            </section>
        )
    }

    const gameLossRatio =
        stats.games_played === 0
            ? 0
            : stats.games_lost /
            stats.games_played *
            100

    const roundLossRatio =
        stats.rounds_played === 0
            ? 0
            : stats.rounds_lost /
            stats.rounds_played *
            100

    return (
        <section className="panel stats-panel">
            <h2>Statistics</h2>

            <div className="stats-counts">
                <div>
                    <span className="label">
                        Games
                    </span>

                    <strong>
                        {stats.games_played}
                    </strong>
                </div>

                <div>
                    <span className="label">
                        Rounds
                    </span>

                    <strong>
                        {stats.rounds_played}
                    </strong>
                </div>
            </div>

            <div className="stats-rings">
                <StatRing
                    value={gameLossRatio}
                    label="Game loss ratio"
                />

                <StatRing
                    value={roundLossRatio}
                    label="Round loss ratio"
                />
            </div>

            <div className="stats-secondary">
                <div>
                    <span className="label">
                        Chicagos
                    </span>

                    <strong>
                        {stats.chicagos}
                    </strong>
                </div>

                <div>
                    <span className="label">
                        Extra lives
                    </span>

                    <strong>
                        {stats.extra_lives_claimed}
                    </strong>
                </div>
            </div>

            <div className="stats-average">
                <span className="label">
                    Average points per turn
                </span>

                <strong>
                    {stats.average_round_score.toFixed(1)}
                </strong>
            </div>
        </section>
    )
}