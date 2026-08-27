export const EXIT = Object.freeze({
  OK: 0,
  FAILURE: 1,
  NOT_FOUND: 2,
  TIMEOUT: 3,
  AMBIGUOUS: 4,
  USAGE: 64,
});

export class HonError extends Error {
  constructor(code, message, exitCode = EXIT.FAILURE, details = undefined) {
    super(message);
    this.name = 'HonError';
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function asHonError(error) {
  if (error instanceof HonError) return error;
  return new HonError('INTERNAL', error?.message ?? String(error));
}
