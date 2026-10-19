/** Base of every domain error; `name` is the concrete subclass name. */
export abstract class AppError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
