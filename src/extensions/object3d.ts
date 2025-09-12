import { Object3D } from "three";

declare module 'three' {
  interface Object3D {
    // eslint-disable-next-line no-unused-vars
    getObjectByUserDataProperty(name: string, value: unknown): Array<Object3D>;
  }
}

Object3D.prototype.getObjectByUserDataProperty = function (this: Object3D, name: string, value: unknown) {
  const result: Array<Object3D> = [];

  if (this.userData[name] === value)
    result.push(this);

  for (const child of this.children) {
    const objects = child.getObjectByUserDataProperty(name, value);
    result.push(...objects);
  }

  return result;
}
