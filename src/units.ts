/** Units a G-code file can select with G20 (inches) or G21 (millimeters) */
export type Units = 'mm' | 'in';

/** Millimeters per inch, for converting values from inch-based G-code */
export const MM_PER_INCH = 25.4;
