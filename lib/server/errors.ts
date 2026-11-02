import 'server-only';

/** An error whose message is safe to show to the user. */
export class UserFacingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    /** Optional machine-readable context that is safe to return (counts, never secrets). */
    public detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}
