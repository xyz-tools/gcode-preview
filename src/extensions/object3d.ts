import { Object3D } from "three";

declare module 'three' {
  interface Object3D {
    // eslint-disable-next-line no-unused-vars
    getByUserData(name: string, value: unknown): Array<Object3D>;
  }
}

// from https://discourse.threejs.org/t/getobject-by-any-custom-property-present-in-userdata-of-object/3378/3
Object3D.prototype.getByUserData = function (this: Object3D, name: string, value: unknown) {
  const meshes: Array<Object3D> = [];

  this.traverse((node) => {
    if (node.userData[name] === value) {
      meshes.push(node);
    }
  });

  return meshes;
}
