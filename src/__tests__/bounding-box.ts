import { describe, it, expect } from 'vitest';
import { BoundingBox } from '../bounding-box';
import { GCodeVector3 } from '../GCodeVector3';

describe('BoundingBox', () => {
  it('should return null for center if bounding box is not valid', () => {
    const bbox = new BoundingBox();
    expect(bbox.center).toBeNull();
  });

  it('should calculate the correct center coordinates', () => {
    const bbox = new BoundingBox();
    bbox.update(0, 0, 0);
    bbox.update(10, 10, 10);

    const center = bbox.center as GCodeVector3;
    expect(center).toBeInstanceOf(GCodeVector3);
    expect(center.x).toBe(5);
    expect(center.y).toBe(5);
    expect(center.z).toBe(5);

    bbox.update(-5, -5, -5);
    const newCenter = bbox.center as GCodeVector3;
    expect(newCenter.x).toBe(2.5);
    expect(newCenter.y).toBe(2.5);
    expect(newCenter.z).toBe(2.5);
  });
});
