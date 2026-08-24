import { test, expect, describe, vi } from 'vitest';
import { BufferGeometry, Color, LineBasicMaterial, LineDashedMaterial, Material } from 'three';
import { LineBox } from '../helpers/line-box';

/** Collects the geometry's vertex pairs as order-independent, undirected edges */
function edges(geometry: BufferGeometry): Set<string> {
  const position = geometry.getAttribute('position');
  const result = new Set<string>();

  for (let i = 0; i < position.count; i += 2) {
    const a = [position.getX(i), position.getY(i), position.getZ(i)].join(',');
    const b = [position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1)].join(',');
    result.add([a, b].sort().join('|'));
  }

  return result;
}

function expectedBoxEdges(x: number, y: number, z: number): Set<string> {
  const corner = (cx: number, cy: number, cz: number): string => [cx, cy, cz].join(',');
  const edge = (a: string, b: string): string => [a, b].sort().join('|');

  const result = new Set<string>();
  // 4 edges along each axis, connecting the corners of the (0,0,0)-(x,y,z) box
  for (const cy of [0, y]) {
    for (const cz of [0, z]) {
      result.add(edge(corner(0, cy, cz), corner(x, cy, cz)));
    }
  }
  for (const cx of [0, x]) {
    for (const cz of [0, z]) {
      result.add(edge(corner(cx, 0, cz), corner(cx, y, cz)));
    }
  }
  for (const cx of [0, x]) {
    for (const cy of [0, y]) {
      result.add(edge(corner(cx, cy, 0), corner(cx, cy, z)));
    }
  }
  return result;
}

describe('.createBoxGeometry', () => {
  test('creates the 12 edges of the box spanning (0,0,0) to (x,y,z)', () => {
    const geometry = LineBox.createBoxGeometry(10, 20, 30);

    const position = geometry.getAttribute('position');
    expect(position.count).toEqual(24); // 12 edges, 2 vertices each

    const actual = edges(geometry);
    expect(actual.size).toEqual(12); // no duplicate or degenerate edges
    expect(actual).toEqual(expectedBoxEdges(10, 20, 30));
  });
});

describe('constructor', () => {
  test('builds a box that extends into negative z, mirroring the scene z-flip', () => {
    const box = new LineBox(10, 20, 30, 0x888888, false);

    box.geometry.computeBoundingBox();
    expect(box.geometry.boundingBox.min).toEqual({ x: 0, y: 0, z: -30 });
    expect(box.geometry.boundingBox.max).toEqual({ x: 10, y: 20, z: 0 });
  });

  test('is dashed by default', () => {
    const box = new LineBox(10, 20, 30, 0x888888);

    expect(box.material).toBeInstanceOf(LineDashedMaterial);
    const material = box.material as LineDashedMaterial;
    expect(material.dashSize).toEqual(3);
    expect(material.gapSize).toEqual(1);
  });

  test('computes line distances when dashed, so dashes actually render', () => {
    const box = new LineBox(10, 20, 30, 0x888888);

    const lineDistance = box.geometry.getAttribute('lineDistance');
    expect(lineDistance).toBeDefined();
    expect(lineDistance.count).toEqual(box.geometry.getAttribute('position').count);
  });

  test('uses a basic material without line distances when not dashed', () => {
    const box = new LineBox(10, 20, 30, 0x888888, false);

    expect(box.material).toBeInstanceOf(LineBasicMaterial);
    expect(box.material).not.toBeInstanceOf(LineDashedMaterial);
    expect(box.geometry.getAttribute('lineDistance')).toBeUndefined();
  });

  test.each([
    ['number', 0xff8800],
    ['string', '#ff8800'],
    ['Color', new Color(0xff8800)]
  ] as const)('applies the color given as a %s', (_kind, color) => {
    const box = new LineBox(10, 20, 30, color, false);

    expect((box.material as LineBasicMaterial).color).toEqual(new Color(0xff8800));
  });
});

describe('.dispose', () => {
  test('disposes the geometry and the material', () => {
    const box = new LineBox(10, 20, 30, 0x888888);
    const geometryDispose = vi.spyOn(box.geometry, 'dispose');
    const materialDispose = vi.spyOn(box.material as Material, 'dispose');

    box.dispose();

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  test('disposes every material when the material is an array', () => {
    const box = new LineBox(10, 20, 30, 0x888888);
    const materials = [new LineBasicMaterial(), new LineBasicMaterial()];
    const spies = materials.map((material) => vi.spyOn(material, 'dispose'));
    box.material = materials;

    box.dispose();

    spies.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
  });
});
