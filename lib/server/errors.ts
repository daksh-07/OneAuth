import 'server-only';

/** An error whose message is safe to show to the user. */
export class UserFacingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
