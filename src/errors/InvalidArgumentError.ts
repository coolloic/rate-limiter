import { AppError } from './AppError';

/** Thrown when a caller passes an invalid argument, e.g. a negative wait or a zero limit. */
export class InvalidArgumentError extends AppError {}
