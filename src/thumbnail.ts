const prefix = 'data:image/jpeg;base64,';

/**
 * Represents a thumbnail image extracted from G-code
 */
export class Thumbnail {
  /** Base64 encoded image characters */
  public chars = '';

  /**
   * Creates a new Thumbnail instance
   * @param size - Dimensions in "WxH" format
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @param charLength - Expected length of base64 characters
   */
  constructor(
    public size: string, // eslint-disable-line no-unused-vars
    public width: number, // eslint-disable-line no-unused-vars
    public height: number, // eslint-disable-line no-unused-vars
    public charLength: number // eslint-disable-line no-unused-vars
  ) {}

  /**
   * Parses thumbnail information string into a Thumbnail instance
   * @param thumbInfo - Thumbnail info string in format "WxH charLength"
   * @returns New Thumbnail instance
   */
  public static parse(thumbInfo: string): Thumbnail {
    const infoParts = thumbInfo.split(' ');
    const size = infoParts[0];
    const sizeParts = size.split('x');
    return new Thumbnail(size, +sizeParts[0], +sizeParts[1], +infoParts[1]);
  }

  /**
   * Gets the complete base64 image source string
   * @returns Data URL for the thumbnail image
   */
  get src(): string {
    return prefix + this.chars;
  }

  /**
   * Checks if the thumbnail data is valid
   * @returns True if the base64 data matches expected length and format
   * @see https://stackoverflow.com/questions/475074/regex-to-parse-or-validate-base64-data/475217#475217
   */
  get isValid(): boolean {
    const base64regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    return this.chars.length == this.charLength && base64regex.test(this.chars);
  }
}
