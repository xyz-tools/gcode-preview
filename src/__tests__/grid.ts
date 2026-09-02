import { test, expect, describe, vi } from 'vitest';
import { BufferGeometry, Color, LineBasicMaterial, Material } from 'three';
import { Grid } from '../helpers/grid';

/** Collects the geometry's vertex pairs as order-independent, undirected edges */
function edges(geometry: BufferGeometry): Set<string> {
  const position = geometry.getAttribute('position');
  const result = new Set<string>();
  // The constructor rotates the geometry, which leaves tiny floating point
  // residue (sin(PI) is not exactly 0), so round the coordinates.
  const round = (value: number): number => Math.round(value * 1e6) / 1e6;

  for (let i = 0; i < position.count; i += 2) {
    const a = [round(position.getX(i)), round(position.getY(i)), round(position.getZ(i))].join(',');
    const b = [round(position.getX(i + 1)), round(position.getY(i + 1)), round(position.getZ(i + 1))].join(',');
    result.add([a, b].sort().join('|'));
  }

  return result;
}

function expectedGridEdges(sizeX: number, stepX: number, sizeZ: number, stepZ: number): Set<string> {
  const edge = (a: number[], b: number[]): string => [a.join(','), b.join(',')].sort().join('|');

  const result = new Set<string>();
  // The grid is rotated onto the XZ plane, extending into negative z
  for (let z = 0; z <= sizeZ; z += stepZ) {
    result.add(edge([0, 0, -z], [sizeX, 0, -z]));
  }
  for (let x = 0; x <= sizeX; x += stepX) {
    result.add(edge([x, 0, 0], [x, 0, -sizeZ]));
  }
  return result;
}

describe('constructor', () => {
  test('draws a line at every step along both axes, flipped into negative z', () => {
    const grid = new Grid(10, 5, 20, 10);

    const position = grid.geometry.getAttribute('position');
    expect(position.count).toEqual(12); // 3 lines per axis, 2 vertices each

    const actual = edges(grid.geometry);
    expect(actual.size).toEqual(6); // no duplicate or degenerate lines
    expect(actual).toEqual(expectedGridEdges(10, 5, 20, 10));
  });

  test('uses a basic material driven by vertex colors', () => {
    const grid = new Grid(10, 5, 20, 10);

    expect(grid.material).toBeInstanceOf(LineBasicMaterial);
    const material = grid.material as LineBasicMaterial;
    expect(material.vertexColors).toEqual(true);
    expect(material.toneMapped).toEqual(false);
  });

  test.each([
    ['number', 0xff8800],
    ['string', '#ff8800'],
    ['Color', new Color(0xff8800)]
  ] as const)('applies the color given as a %s to every vertex', (_kind, color) => {
    const grid = new Grid(10, 5, 20, 10, color);

    const colors = grid.geometry.getAttribute('color');
    const expected = new Color(0xff8800);
    expect(colors.count).toEqual(grid.geometry.getAttribute('position').count);
    for (let i = 0; i < colors.count; i++) {
      expect(colors.getX(i)).toBeCloseTo(expected.r, 5);
      expect(colors.getY(i)).toBeCloseTo(expected.g, 5);
      expect(colors.getZ(i)).toBeCloseTo(expected.b, 5);
    }
  });

  test('defaults to a gray (0x888888) grid when no color is given', () => {
    const grid = new Grid(10, 5, 20, 10);

    const colors = grid.geometry.getAttribute('color');
    const expected = new Color(0x888888);
    for (let i = 0; i < colors.count; i++) {
      expect(colors.getX(i)).toBeCloseTo(expected.r, 5);
      expect(colors.getY(i)).toBeCloseTo(expected.g, 5);
      expect(colors.getZ(i)).toBeCloseTo(expected.b, 5);
    }
  });

  test('reports the GridHelper type', () => {
    expect(new Grid(10, 5, 20, 10).type).toEqual('GridHelper');
  });
});

describe('.dispose', () => {
  test('disposes the geometry and the material', () => {
    const grid = new Grid(10, 5, 20, 10);
    const geometryDispose = vi.spyOn(grid.geometry, 'dispose');
    const materialDispose = vi.spyOn(grid.material as Material, 'dispose');

    grid.dispose();

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  test('disposes every material when the material is an array', () => {
    const grid = new Grid(10, 5, 20, 10);
    const materials = [new LineBasicMaterial(), new LineBasicMaterial()];
    const spies = materials.map((material) => vi.spyOn(material, 'dispose'));
    grid.material = materials;

    grid.dispose();

    spies.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
  });
});
