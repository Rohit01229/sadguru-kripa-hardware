export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class InsufficientStock extends DomainError {
  constructor(productId: string) {
    super(`Insufficient stock for product ${productId}`, "INSUFFICIENT_STOCK");
  }
}

export class Forbidden extends DomainError {
  constructor(permission: string) {
    super(`Missing permission: ${permission}`, "FORBIDDEN");
  }
}

export class FractionalPieceError extends DomainError {
  constructor(unitCode: string) {
    super(`Unit "${unitCode}" is piece-type and cannot take a fractional quantity`, "FRACTIONAL_PIECE");
  }
}
