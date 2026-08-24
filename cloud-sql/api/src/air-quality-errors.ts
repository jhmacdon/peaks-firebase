export class AirQualityRequestAbortedError extends Error {
  constructor() {
    super("Air quality request aborted");
    this.name = "AbortError";
  }
}
