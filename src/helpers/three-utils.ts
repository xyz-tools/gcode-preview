/**
 * Represents an object that can be disposed of to free up resources
 * @remarks
 * Used for Three.js objects that need cleanup when no longer needed
 */
export type Disposable = {
  dispose(): void;
};
