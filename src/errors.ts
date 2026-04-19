export class GobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GobError';
  }
}

export class GobDecodeError extends GobError {
  constructor(message: string) {
    super(message);
    this.name = 'GobDecodeError';
  }
}

export class GobEncodeError extends GobError {
  constructor(message: string) {
    super(message);
    this.name = 'GobEncodeError';
  }
}

export class EndOfStreamError extends GobError {
  constructor(message = 'end of gob stream') {
    super(message);
    this.name = 'EndOfStreamError';
  }
}
