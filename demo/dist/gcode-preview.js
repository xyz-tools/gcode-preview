!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?e(exports,require("three"),require("three-orbitcontrols")):"function"==typeof define&&define.amd?define(["exports","three","three-orbitcontrols"],e):e((t=t||self).GCodePreview={},t.THREE,t.THREE.OrbitControls)}(this,(function(t,e,n){"use strict";class i extends class{constructor(t,e){this.gcode=t,this.comment=e}}{constructor(t,e,n){super(t,n),this.params=e}}class r{constructor(t,e){this.layer=t,this.commands=e}}class s{constructor(){this.layers=[],this.curZ=0,this.maxZ=0}parseCommand(t,e=!0){const n=t.trim().split(";"),r=n[0],s=e&&n[1]||null,a=r.split(/ +/g),o=a[0].toLowerCase();switch(o){case"g0":case"g1":const t=this.parseMove(a.slice(1));return new i(o,t,s);default:return null}}parseMove(t){return t.reduce((t,e)=>{const n=e.charAt(0).toLowerCase();return"x"!=n&&"y"!=n&&"z"!=n&&"e"!=n||(t[n]=parseFloat(e.slice(1))),t},{})}groupIntoLayers(t){for(const e of t.filter(t=>t instanceof i)){const t=e.params;t.z&&(this.curZ=t.z),t.e>0&&(null!=t.x||null!=t.y)&&this.curZ>this.maxZ?(this.maxZ=this.curZ,this.currentLayer=new r(this.layers.length,[e]),this.layers.push(this.currentLayer)):this.currentLayer&&this.currentLayer.commands.push(e)}return this.layers}parseGcode(t){const e=Array.isArray(t)?t:t.split("\n").filter(t=>t.length>0),n=this.lines2commands(e);return this.groupIntoLayers(n),{layers:this.layers}}lines2commands(t){return t.filter(t=>t.length>0).map(t=>this.parseCommand(t)).filter(t=>null!==t)}}e.UniformsLib.line={linewidth:{value:1},resolution:{value:new e.Vector2(1,1)},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}},e.ShaderLib.line={uniforms:e.UniformsUtils.merge([e.UniformsLib.common,e.UniformsLib.fog,e.UniformsLib.line]),vertexShader:"\n\t\t#include <common>\n\t\t#include <color_pars_vertex>\n\t\t#include <fog_pars_vertex>\n\t\t#include <logdepthbuf_pars_vertex>\n\t\t#include <clipping_planes_pars_vertex>\n\n\t\tuniform float linewidth;\n\t\tuniform vec2 resolution;\n\n\t\tattribute vec3 instanceStart;\n\t\tattribute vec3 instanceEnd;\n\n\t\tattribute vec3 instanceColorStart;\n\t\tattribute vec3 instanceColorEnd;\n\n\t\tvarying vec2 vUv;\n\n\t\t#ifdef USE_DASH\n\n\t\t\tuniform float dashScale;\n\t\t\tattribute float instanceDistanceStart;\n\t\t\tattribute float instanceDistanceEnd;\n\t\t\tvarying float vLineDistance;\n\n\t\t#endif\n\n\t\tvoid trimSegment( const in vec4 start, inout vec4 end ) {\n\n\t\t\t// trim end segment so it terminates between the camera plane and the near plane\n\n\t\t\t// conservative estimate of the near plane\n\t\t\tfloat a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column\n\t\t\tfloat b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column\n\t\t\tfloat nearEstimate = - 0.5 * b / a;\n\n\t\t\tfloat alpha = ( nearEstimate - start.z ) / ( end.z - start.z );\n\n\t\t\tend.xyz = mix( start.xyz, end.xyz, alpha );\n\n\t\t}\n\n\t\tvoid main() {\n\n\t\t\t#ifdef USE_COLOR\n\n\t\t\t\tvColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;\n\n\t\t\t#endif\n\n\t\t\t#ifdef USE_DASH\n\n\t\t\t\tvLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;\n\n\t\t\t#endif\n\n\t\t\tfloat aspect = resolution.x / resolution.y;\n\n\t\t\tvUv = uv;\n\n\t\t\t// camera space\n\t\t\tvec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );\n\t\t\tvec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );\n\n\t\t\t// special case for perspective projection, and segments that terminate either in, or behind, the camera plane\n\t\t\t// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space\n\t\t\t// but we need to perform ndc-space calculations in the shader, so we must address this issue directly\n\t\t\t// perhaps there is a more elegant solution -- WestLangley\n\n\t\t\tbool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column\n\n\t\t\tif ( perspective ) {\n\n\t\t\t\tif ( start.z < 0.0 && end.z >= 0.0 ) {\n\n\t\t\t\t\ttrimSegment( start, end );\n\n\t\t\t\t} else if ( end.z < 0.0 && start.z >= 0.0 ) {\n\n\t\t\t\t\ttrimSegment( end, start );\n\n\t\t\t\t}\n\n\t\t\t}\n\n\t\t\t// clip space\n\t\t\tvec4 clipStart = projectionMatrix * start;\n\t\t\tvec4 clipEnd = projectionMatrix * end;\n\n\t\t\t// ndc space\n\t\t\tvec2 ndcStart = clipStart.xy / clipStart.w;\n\t\t\tvec2 ndcEnd = clipEnd.xy / clipEnd.w;\n\n\t\t\t// direction\n\t\t\tvec2 dir = ndcEnd - ndcStart;\n\n\t\t\t// account for clip-space aspect ratio\n\t\t\tdir.x *= aspect;\n\t\t\tdir = normalize( dir );\n\n\t\t\t// perpendicular to dir\n\t\t\tvec2 offset = vec2( dir.y, - dir.x );\n\n\t\t\t// undo aspect ratio adjustment\n\t\t\tdir.x /= aspect;\n\t\t\toffset.x /= aspect;\n\n\t\t\t// sign flip\n\t\t\tif ( position.x < 0.0 ) offset *= - 1.0;\n\n\t\t\t// endcaps\n\t\t\tif ( position.y < 0.0 ) {\n\n\t\t\t\toffset += - dir;\n\n\t\t\t} else if ( position.y > 1.0 ) {\n\n\t\t\t\toffset += dir;\n\n\t\t\t}\n\n\t\t\t// adjust for linewidth\n\t\t\toffset *= linewidth;\n\n\t\t\t// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...\n\t\t\toffset /= resolution.y;\n\n\t\t\t// select end\n\t\t\tvec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;\n\n\t\t\t// back to clip space\n\t\t\toffset *= clip.w;\n\n\t\t\tclip.xy += offset;\n\n\t\t\tgl_Position = clip;\n\n\t\t\tvec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation\n\n\t\t\t#include <logdepthbuf_vertex>\n\t\t\t#include <clipping_planes_vertex>\n\t\t\t#include <fog_vertex>\n\n\t\t}\n\t\t",fragmentShader:"\n\t\tuniform vec3 diffuse;\n\t\tuniform float opacity;\n\n\t\t#ifdef USE_DASH\n\n\t\t\tuniform float dashSize;\n\t\t\tuniform float gapSize;\n\n\t\t#endif\n\n\t\tvarying float vLineDistance;\n\n\t\t#include <common>\n\t\t#include <color_pars_fragment>\n\t\t#include <fog_pars_fragment>\n\t\t#include <logdepthbuf_pars_fragment>\n\t\t#include <clipping_planes_pars_fragment>\n\n\t\tvarying vec2 vUv;\n\n\t\tvoid main() {\n\n\t\t\t#include <clipping_planes_fragment>\n\n\t\t\t#ifdef USE_DASH\n\n\t\t\t\tif ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps\n\n\t\t\t\tif ( mod( vLineDistance, dashSize + gapSize ) > dashSize ) discard; // todo - FIX\n\n\t\t\t#endif\n\n\t\t\tif ( abs( vUv.y ) > 1.0 ) {\n\n\t\t\t\tfloat a = vUv.x;\n\t\t\t\tfloat b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;\n\t\t\t\tfloat len2 = a * a + b * b;\n\n\t\t\t\tif ( len2 > 1.0 ) discard;\n\n\t\t\t}\n\n\t\t\tvec4 diffuseColor = vec4( diffuse, opacity );\n\n\t\t\t#include <logdepthbuf_fragment>\n\t\t\t#include <color_fragment>\n\n\t\t\tgl_FragColor = vec4( diffuseColor.rgb, diffuseColor.a );\n\n\t\t\t#include <tonemapping_fragment>\n\t\t\t#include <encodings_fragment>\n\t\t\t#include <fog_fragment>\n\t\t\t#include <premultiplied_alpha_fragment>\n\n\t\t}\n\t\t"};var a=function(t){e.ShaderMaterial.call(this,{type:"LineMaterial",uniforms:e.UniformsUtils.clone(e.ShaderLib.line.uniforms),vertexShader:e.ShaderLib.line.vertexShader,fragmentShader:e.ShaderLib.line.fragmentShader,clipping:!0}),this.dashed=!1,Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(t){this.uniforms.diffuse.value=t}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(t){this.uniforms.linewidth.value=t}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(t){this.uniforms.dashScale.value=t}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(t){this.uniforms.dashSize.value=t}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(t){this.uniforms.gapSize.value=t}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(t){this.uniforms.resolution.value.copy(t)}}}),this.setValues(t)};(a.prototype=Object.create(e.ShaderMaterial.prototype)).constructor=a,a.prototype.isLineMaterial=!0;var o,c,l=function(){e.InstancedBufferGeometry.call(this),this.type="LineSegmentsGeometry";this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute("position",new e.Float32BufferAttribute([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute("uv",new e.Float32BufferAttribute([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))};l.prototype=Object.assign(Object.create(e.InstancedBufferGeometry.prototype),{constructor:l,isLineSegmentsGeometry:!0,applyMatrix4:function(t){var e=this.attributes.instanceStart,n=this.attributes.instanceEnd;return void 0!==e&&(e.applyMatrix4(t),n.applyMatrix4(t),e.data.needsUpdate=!0),null!==this.boundingBox&&this.computeBoundingBox(),null!==this.boundingSphere&&this.computeBoundingSphere(),this},setPositions:function(t){var n;t instanceof Float32Array?n=t:Array.isArray(t)&&(n=new Float32Array(t));var i=new e.InstancedInterleavedBuffer(n,6,1);return this.setAttribute("instanceStart",new e.InterleavedBufferAttribute(i,3,0)),this.setAttribute("instanceEnd",new e.InterleavedBufferAttribute(i,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this},setColors:function(t){var n;t instanceof Float32Array?n=t:Array.isArray(t)&&(n=new Float32Array(t));var i=new e.InstancedInterleavedBuffer(n,6,1);return this.setAttribute("instanceColorStart",new e.InterleavedBufferAttribute(i,3,0)),this.setAttribute("instanceColorEnd",new e.InterleavedBufferAttribute(i,3,3)),this},fromWireframeGeometry:function(t){return this.setPositions(t.attributes.position.array),this},fromEdgesGeometry:function(t){return this.setPositions(t.attributes.position.array),this},fromMesh:function(t){return this.fromWireframeGeometry(new e.WireframeGeometry(t.geometry)),this},fromLineSegements:function(t){var e=t.geometry;return e.isGeometry?this.setPositions(e.vertices):e.isBufferGeometry&&this.setPositions(e.position.array),this},computeBoundingBox:(c=new e.Box3,function(){null===this.boundingBox&&(this.boundingBox=new e.Box3);var t=this.attributes.instanceStart,n=this.attributes.instanceEnd;void 0!==t&&void 0!==n&&(this.boundingBox.setFromBufferAttribute(t),c.setFromBufferAttribute(n),this.boundingBox.union(c))}),computeBoundingSphere:(o=new e.Vector3,function(){null===this.boundingSphere&&(this.boundingSphere=new e.Sphere),null===this.boundingBox&&this.computeBoundingBox();var t=this.attributes.instanceStart,n=this.attributes.instanceEnd;if(void 0!==t&&void 0!==n){var i=this.boundingSphere.center;this.boundingBox.getCenter(i);for(var r=0,s=0,a=t.count;s<a;s++)o.fromBufferAttribute(t,s),r=Math.max(r,i.distanceToSquared(o)),o.fromBufferAttribute(n,s),r=Math.max(r,i.distanceToSquared(o));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error("THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.",this)}}),toJSON:function(){},applyMatrix:function(t){return console.warn("THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4()."),this.applyMatrix4(t)}});var u=function(){l.call(this),this.type="LineGeometry"};u.prototype=Object.assign(Object.create(l.prototype),{constructor:u,isLineGeometry:!0,setPositions:function(t){for(var e=t.length-3,n=new Float32Array(2*e),i=0;i<e;i+=3)n[2*i]=t[i],n[2*i+1]=t[i+1],n[2*i+2]=t[i+2],n[2*i+3]=t[i+3],n[2*i+4]=t[i+4],n[2*i+5]=t[i+5];return l.prototype.setPositions.call(this,n),this},setColors:function(t){for(var e=t.length-3,n=new Float32Array(2*e),i=0;i<e;i+=3)n[2*i]=t[i],n[2*i+1]=t[i+1],n[2*i+2]=t[i+2],n[2*i+3]=t[i+3],n[2*i+4]=t[i+4],n[2*i+5]=t[i+5];return l.prototype.setColors.call(this,n),this},fromLine:function(t){var e=t.geometry;return e.isGeometry?this.setPositions(e.vertices):e.isBufferGeometry&&this.setPositions(e.position.array),this},copy:function(){return this}});var d,h,f=function(t,n){e.Mesh.call(this),this.type="LineSegments2",this.geometry=void 0!==t?t:new l,this.material=void 0!==n?n:new a({color:16777215*Math.random()})};f.prototype=Object.assign(Object.create(e.Mesh.prototype),{constructor:f,isLineSegments2:!0,computeLineDistances:(d=new e.Vector3,h=new e.Vector3,function(){for(var t=this.geometry,n=t.attributes.instanceStart,i=t.attributes.instanceEnd,r=new Float32Array(2*n.data.count),s=0,a=0,o=n.data.count;s<o;s++,a+=2)d.fromBufferAttribute(n,s),h.fromBufferAttribute(i,s),r[a]=0===a?0:r[a-1],r[a+1]=r[a]+d.distanceTo(h);var c=new e.InstancedInterleavedBuffer(r,2,1);return t.setAttribute("instanceDistanceStart",new e.InterleavedBufferAttribute(c,1,0)),t.setAttribute("instanceDistanceEnd",new e.InterleavedBufferAttribute(c,1,1)),this}),raycast:function(){var t=new e.Vector4,n=new e.Vector4,i=new e.Vector4,r=new e.Vector3,s=new e.Matrix4,a=new e.Line3,o=new e.Vector3;return function(c,l){null===c.camera&&console.error('LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2.');var u=c.ray,d=c.camera,h=d.projectionMatrix,f=this.geometry,p=this.material,m=p.resolution,v=p.linewidth,y=f.attributes.instanceStart,g=f.attributes.instanceEnd;u.at(1,i),i.w=1,i.applyMatrix4(d.matrixWorldInverse),i.applyMatrix4(h),i.multiplyScalar(1/i.w),i.x*=m.x/2,i.y*=m.y/2,i.z=0,r.copy(i);var b=this.matrixWorld;s.multiplyMatrices(d.matrixWorldInverse,b);for(var x=0,S=y.count;x<S;x++){t.fromBufferAttribute(y,x),n.fromBufferAttribute(g,x),t.w=1,n.w=1,t.applyMatrix4(s),n.applyMatrix4(s),t.applyMatrix4(h),n.applyMatrix4(h),t.multiplyScalar(1/t.w),n.multiplyScalar(1/n.w);var w=t.z<-1&&n.z<-1,L=t.z>1&&n.z>1;if(!w&&!L){t.x*=m.x/2,t.y*=m.y/2,n.x*=m.x/2,n.y*=m.y/2,a.start.copy(t),a.start.z=0,a.end.copy(n),a.end.z=0;var z=a.closestPointToPointParameter(r,!0);a.at(z,o);var B=e.MathUtils.lerp(t.z,n.z,z),A=B>=-1&&B<=1,E=r.distanceTo(o)<.5*v;if(A&&E){a.start.fromBufferAttribute(y,x),a.end.fromBufferAttribute(g,x),a.start.applyMatrix4(b),a.end.applyMatrix4(b);var M=new e.Vector3,C=new e.Vector3;u.distanceSqToSegment(a.start,a.end,C,M),l.push({point:C,pointOnLine:M,distance:u.origin.distanceTo(C),object:this,face:null,faceIndex:x,uv:null,uv2:null})}}}}}()});t.WebGLPreview=class{constructor(t){if(this.parser=new s,this.backgroundColor=14737632,this.travelColor=10027008,this.extrusionColor=65280,this.renderExtrusion=!0,this.renderTravel=!1,this.lineWidth=null,this.scene=new e.Scene,this.scene.background=new e.Color(this.backgroundColor),this.canvas=t.canvas,this.targetId=t.targetId,this.limit=t.limit,this.topLayerColor=t.topLayerColor,this.lastSegmentColor=t.lastSegmentColor,this.lineWidth=t.lineWidth,console.debug("opts",t),this.canvas)this.renderer=new e.WebGLRenderer({canvas:this.canvas});else{const t=document.getElementById(this.targetId);if(!t)throw new Error("Unable to find element "+this.targetId);this.renderer=new e.WebGLRenderer,this.canvas=this.renderer.domElement,t.appendChild(this.canvas)}this.renderer.setPixelRatio(window.devicePixelRatio),this.camera=new e.PerspectiveCamera(75,this.canvas.offsetWidth/this.canvas.offsetHeight,10,1e3),this.camera.position.set(0,0,50),this.resize();new n(this.camera,this.renderer.domElement);this.animate()}get layers(){return this.parser.layers}animate(){requestAnimationFrame(()=>this.animate()),this.renderer.render(this.scene,this.camera)}processGCode(t){this.parser.parseGcode(t),this.render()}render(){for(;this.scene.children.length>0;)this.scene.remove(this.scene.children[0]);this.group=new e.Group,this.group.name="gcode";const t={x:0,y:0,z:0,e:0};for(let n=0;n<this.layers.length&&!(n>this.limit);n++){const i={extrusion:[],travel:[],z:t.z},r=this.layers[n];for(const e of r.commands)if("g0"==e.gcode||"g1"==e.gcode){const n=e,r={x:void 0!==n.params.x?n.params.x:t.x,y:void 0!==n.params.y?n.params.y:t.y,z:void 0!==n.params.z?n.params.z:t.z,e:void 0!==n.params.e?n.params.e:t.e},s=n.params.e>0;(s&&this.renderExtrusion||!s&&this.renderTravel)&&this.addLineSegment(i,t,r,s),n.params.x&&(t.x=n.params.x),n.params.y&&(t.y=n.params.y),n.params.z&&(t.z=n.params.z),n.params.e&&(t.e=n.params.e)}if(this.renderExtrusion){const t=Math.round(80*n/this.layers.length),r=new e.Color(`hsl(0, 0%, ${t}%)`).getHex();if(n==this.layers.length-1){const t=void 0!==this.topLayerColor?this.topLayerColor:r,e=void 0!==this.lastSegmentColor?this.lastSegmentColor:t,n=i.extrusion.splice(-3);this.addLine(i.extrusion,t);const s=i.extrusion.splice(-3);this.addLine([...s,...n],e)}else this.addLine(i.extrusion,r)}this.renderTravel&&this.addLine(i.travel,this.travelColor)}this.group.quaternion.setFromEuler(new e.Euler(-Math.PI/2,0,0)),this.group.position.set(-100,-20,100),this.scene.add(this.group),this.renderer.render(this.scene,this.camera)}clear(){this.limit=1/0,this.parser=new s}resize(){const[t,e]=[this.canvas.offsetWidth,this.canvas.offsetHeight];this.camera.aspect=t/e,this.camera.updateProjectionMatrix(),this.renderer.setPixelRatio(window.devicePixelRatio),this.renderer.setSize(t,e,!1)}addLineSegment(t,e,n,i){(i?t.extrusion:t.travel).push(e.x,e.y,e.z,n.x,n.y,n.z)}addLine(t,n){if("number"==typeof this.lineWidth)return void this.addThickLine(t,n);const i=new e.BufferGeometry;i.setAttribute("position",new e.Float32BufferAttribute(t,3));const r=new e.LineBasicMaterial({color:n}),s=new e.LineSegments(i,r);this.group.add(s)}addThickLine(t,e){const n=new u;n.setPositions(t);const i=new a({color:e,linewidth:this.lineWidth}),r=new f(n,i);this.group.add(r)}},Object.defineProperty(t,"__esModule",{value:!0})}));
