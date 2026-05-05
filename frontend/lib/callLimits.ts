const DEFAULT_CALL_DURATION_SECONDS = 120
const DEFAULT_CALL_WARNING_SECONDS = 5

const readPositiveNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const CALL_DURATION_SECONDS = readPositiveNumber(
  process.env.NEXT_PUBLIC_CALL_DURATION_SECONDS,
  DEFAULT_CALL_DURATION_SECONDS
)

export const CALL_WARNING_SECONDS = Math.min(
  readPositiveNumber(
    process.env.NEXT_PUBLIC_CALL_WARNING_SECONDS,
    DEFAULT_CALL_WARNING_SECONDS
  ),
  CALL_DURATION_SECONDS
)
