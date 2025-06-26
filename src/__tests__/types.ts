import { describe, it, expect } from 'vitest';
import { GCodeVector3 } from '../types';
import { Vector3 } from 'three';

describe('GCodeVector3', () => {
  it('should be the identity when converting to Vector3 and back', () => {
    const original = new GCodeVector3(1, 2, 3);
    const converted = GCodeVector3.fromVector3(original.toVector3());
    expect(converted.x).toBe(original.x);
    expect(converted.y).toBe(original.y);
    expect(converted.z).toBe(original.z);
  });

  it('should be the identity when converting from Vector3 and back', () => {
    const original = new Vector3(4, 5, 6);
    const converted = GCodeVector3.fromVector3(original).toVector3();
    expect(converted.x).toBe(original.x);
    expect(converted.y).toBe(original.y);
    expect(converted.z).toBe(original.z);
  });
});