import*as t from"three";import e,{EventDispatcher as n,Vector3 as i,MOUSE as a,TOUCH as s,Quaternion as o,Spherical as r,Vector2 as l,UniformsLib as c,ShaderLib as d,UniformsUtils as u,ShaderMaterial as h,Box3 as p,InstancedBufferGeometry as m,Float32BufferAttribute as f,InstancedInterleavedBuffer as g,InterleavedBufferAttribute as v,WireframeGeometry as y,Sphere as b,Vector4 as w,Matrix4 as x,Line3 as S,Mesh as E,MathUtils as L,LineSegments as A,Color as z,BufferGeometry as O,LineBasicMaterial as P}from"three";function T(t,e,n,i){return new(n||(n=Promise))((function(a,s){function o(t){try{l(i.next(t))}catch(t){s(t)}}function r(t){try{l(i.throw(t))}catch(t){s(t)}}function l(t){var e;t.done?a(t.value):(e=t.value,e instanceof n?e:new n((function(t){t(e)}))).then(o,r)}l((i=i.apply(t,e||[])).next())}))}class _{constructor(){this.chars=""}static parse(t){const e=new _,n=t.split(" ");e.size=n[0];const i=e.size.split("x");return e.width=+i[0],e.height=+i[1],e.charLength=+n[1],e}get src(){return"data:image/jpeg;base64,"+this.chars}get isValid(){return this.chars.length==this.charLength&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(this.chars)}}class M{constructor(t,e,n,i){this.src=t,this.gcode=e,this.params=n,this.comment=i}}class D extends M{constructor(t,e,n,i){super(t,e,n,i),this.params=n}}class C{constructor(t,e,n){this.layer=t,this.commands=e,this.lineNumber=n}}class N{constructor(){this.lines=[],this.preamble=new C(-1,[],0),this.layers=[],this.curZ=0,this.maxZ=0,this.metadata={thumbnails:{}}}parseGCode(t){const e=Array.isArray(t)?t:t.split("\n");this.lines=this.lines.concat(e);const n=this.lines2commands(e);this.groupIntoLayers(n.filter((t=>t instanceof D)));const i=this.parseMetadata(n.filter((t=>t.comment))).thumbnails;for(const[t,e]of Object.entries(i))this.metadata.thumbnails[t]=e;return{layers:this.layers,metadata:this.metadata}}lines2commands(t){return t.map((t=>this.parseCommand(t)))}parseCommand(t,e=!0){const n=t.trim().split(";"),i=n[0],a=e&&n[1]||null,s=i.split(/ +/g),o=s[0].toLowerCase();let r;switch(o){case"g0":case"g1":return r=this.parseMove(s.slice(1)),new D(t,o,r,a);default:return r=this.parseParams(s.slice(1)),new M(t,o,r,a)}}parseMove(t){return t.reduce(((t,e)=>{const n=e.charAt(0).toLowerCase();return"x"!=n&&"y"!=n&&"z"!=n&&"e"!=n&&"f"!=n||(t[n]=parseFloat(e.slice(1))),t}),{})}isAlpha(t){const e=t.charCodeAt(0);return e>=97&&e<=122||e>=65&&e<=90}parseParams(t){return t.reduce(((t,e)=>{const n=e.charAt(0).toLowerCase();return this.isAlpha(n)&&(t[n]=parseFloat(e.slice(1))),t}),{})}groupIntoLayers(t){for(let e=0;e<t.length;e++){const n=t[e];if(!(n instanceof D)){this.currentLayer?this.currentLayer.commands.push(n):this.preamble.commands.push(n);continue}const i=n.params;i.z&&(this.curZ=i.z),i.e>0&&(null!=i.x||null!=i.y)&&this.curZ>this.maxZ?(this.maxZ=this.curZ,this.currentLayer=new C(this.layers.length,[n],e),this.layers.push(this.currentLayer)):this.currentLayer?this.currentLayer.commands.push(n):this.preamble.commands.push(n)}return this.layers}parseMetadata(t){const e={};let n=null;for(const i of t){const t=i.comment,a=t.indexOf("thumbnail begin"),s=t.indexOf("thumbnail end");a>-1?n=_.parse(t.slice(a+15).trim()):n&&(-1==s?n.chars+=t.trim():(n.isValid?(e[n.size]=n,console.debug("thumb found",n.size),console.debug("declared length",n.charLength,"actual length",n.chars.length)):console.warn("thumb found but seems to be invalid"),n=null))}return{thumbnails:e}}}N.prototype.parseGcode=N.prototype.parseGCode;const U={type:"change"},j={type:"start"},I={type:"end"};class R extends n{constructor(t,e){super(),this.object=t,this.domElement=e,this.domElement.style.touchAction="none",this.enabled=!0,this.target=new i,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:a.ROTATE,MIDDLE:a.DOLLY,RIGHT:a.PAN},this.touches={ONE:s.ROTATE,TWO:s.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this.getPolarAngle=function(){return h.phi},this.getAzimuthalAngle=function(){return h.theta},this.getDistance=function(){return this.object.position.distanceTo(this.target)},this.listenToKeyEvents=function(t){t.addEventListener("keydown",$),this._domElementKeyEvents=t},this.saveState=function(){n.target0.copy(n.target),n.position0.copy(n.object.position),n.zoom0=n.object.zoom},this.reset=function(){n.target.copy(n.target0),n.object.position.copy(n.position0),n.object.zoom=n.zoom0,n.object.updateProjectionMatrix(),n.dispatchEvent(U),n.update(),d=c.NONE},this.update=function(){const e=new i,a=(new o).setFromUnitVectors(t.up,new i(0,1,0)),s=a.clone().invert(),r=new i,l=new o,v=2*Math.PI;return function(){const t=n.object.position;e.copy(t).sub(n.target),e.applyQuaternion(a),h.setFromVector3(e),n.autoRotate&&d===c.NONE&&T(2*Math.PI/60/60*n.autoRotateSpeed),n.enableDamping?(h.theta+=p.theta*n.dampingFactor,h.phi+=p.phi*n.dampingFactor):(h.theta+=p.theta,h.phi+=p.phi);let i=n.minAzimuthAngle,o=n.maxAzimuthAngle;return isFinite(i)&&isFinite(o)&&(i<-Math.PI?i+=v:i>Math.PI&&(i-=v),o<-Math.PI?o+=v:o>Math.PI&&(o-=v),h.theta=i<=o?Math.max(i,Math.min(o,h.theta)):h.theta>(i+o)/2?Math.max(i,h.theta):Math.min(o,h.theta)),h.phi=Math.max(n.minPolarAngle,Math.min(n.maxPolarAngle,h.phi)),h.makeSafe(),h.radius*=m,h.radius=Math.max(n.minDistance,Math.min(n.maxDistance,h.radius)),!0===n.enableDamping?n.target.addScaledVector(f,n.dampingFactor):n.target.add(f),e.setFromSpherical(h),e.applyQuaternion(s),t.copy(n.target).add(e),n.object.lookAt(n.target),!0===n.enableDamping?(p.theta*=1-n.dampingFactor,p.phi*=1-n.dampingFactor,f.multiplyScalar(1-n.dampingFactor)):(p.set(0,0,0),f.set(0,0,0)),m=1,!!(g||r.distanceToSquared(n.object.position)>u||8*(1-l.dot(n.object.quaternion))>u)&&(n.dispatchEvent(U),r.copy(n.object.position),l.copy(n.object.quaternion),g=!1,!0)}}(),this.dispose=function(){n.domElement.removeEventListener("contextmenu",J),n.domElement.removeEventListener("pointerdown",Z),n.domElement.removeEventListener("pointercancel",K),n.domElement.removeEventListener("wheel",Q),n.domElement.removeEventListener("pointermove",X),n.domElement.removeEventListener("pointerup",q),null!==n._domElementKeyEvents&&n._domElementKeyEvents.removeEventListener("keydown",$)};const n=this,c={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6};let d=c.NONE;const u=1e-6,h=new r,p=new r;let m=1;const f=new i;let g=!1;const v=new l,y=new l,b=new l,w=new l,x=new l,S=new l,E=new l,L=new l,A=new l,z=[],O={};function P(){return Math.pow(.95,n.zoomSpeed)}function T(t){p.theta-=t}function _(t){p.phi-=t}const M=function(){const t=new i;return function(e,n){t.setFromMatrixColumn(n,0),t.multiplyScalar(-e),f.add(t)}}(),D=function(){const t=new i;return function(e,i){!0===n.screenSpacePanning?t.setFromMatrixColumn(i,1):(t.setFromMatrixColumn(i,0),t.crossVectors(n.object.up,t)),t.multiplyScalar(e),f.add(t)}}(),C=function(){const t=new i;return function(e,i){const a=n.domElement;if(n.object.isPerspectiveCamera){const s=n.object.position;t.copy(s).sub(n.target);let o=t.length();o*=Math.tan(n.object.fov/2*Math.PI/180),M(2*e*o/a.clientHeight,n.object.matrix),D(2*i*o/a.clientHeight,n.object.matrix)}else n.object.isOrthographicCamera?(M(e*(n.object.right-n.object.left)/n.object.zoom/a.clientWidth,n.object.matrix),D(i*(n.object.top-n.object.bottom)/n.object.zoom/a.clientHeight,n.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),n.enablePan=!1)}}();function N(t){n.object.isPerspectiveCamera?m/=t:n.object.isOrthographicCamera?(n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom*t)),n.object.updateProjectionMatrix(),g=!0):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),n.enableZoom=!1)}function R(t){n.object.isPerspectiveCamera?m*=t:n.object.isOrthographicCamera?(n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom/t)),n.object.updateProjectionMatrix(),g=!0):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),n.enableZoom=!1)}function B(t){v.set(t.clientX,t.clientY)}function H(t){w.set(t.clientX,t.clientY)}function k(){if(1===z.length)v.set(z[0].pageX,z[0].pageY);else{const t=.5*(z[0].pageX+z[1].pageX),e=.5*(z[0].pageY+z[1].pageY);v.set(t,e)}}function F(){if(1===z.length)w.set(z[0].pageX,z[0].pageY);else{const t=.5*(z[0].pageX+z[1].pageX),e=.5*(z[0].pageY+z[1].pageY);w.set(t,e)}}function V(){const t=z[0].pageX-z[1].pageX,e=z[0].pageY-z[1].pageY,n=Math.sqrt(t*t+e*e);E.set(0,n)}function Y(t){if(1==z.length)y.set(t.pageX,t.pageY);else{const e=nt(t),n=.5*(t.pageX+e.x),i=.5*(t.pageY+e.y);y.set(n,i)}b.subVectors(y,v).multiplyScalar(n.rotateSpeed);const e=n.domElement;T(2*Math.PI*b.x/e.clientHeight),_(2*Math.PI*b.y/e.clientHeight),v.copy(y)}function G(t){if(1===z.length)x.set(t.pageX,t.pageY);else{const e=nt(t),n=.5*(t.pageX+e.x),i=.5*(t.pageY+e.y);x.set(n,i)}S.subVectors(x,w).multiplyScalar(n.panSpeed),C(S.x,S.y),w.copy(x)}function W(t){const e=nt(t),i=t.pageX-e.x,a=t.pageY-e.y,s=Math.sqrt(i*i+a*a);L.set(0,s),A.set(0,Math.pow(L.y/E.y,n.zoomSpeed)),N(A.y),E.copy(L)}function Z(t){!1!==n.enabled&&(0===z.length&&(n.domElement.setPointerCapture(t.pointerId),n.domElement.addEventListener("pointermove",X),n.domElement.addEventListener("pointerup",q)),function(t){z.push(t)}(t),"touch"===t.pointerType?function(t){switch(et(t),z.length){case 1:switch(n.touches.ONE){case s.ROTATE:if(!1===n.enableRotate)return;k(),d=c.TOUCH_ROTATE;break;case s.PAN:if(!1===n.enablePan)return;F(),d=c.TOUCH_PAN;break;default:d=c.NONE}break;case 2:switch(n.touches.TWO){case s.DOLLY_PAN:if(!1===n.enableZoom&&!1===n.enablePan)return;n.enableZoom&&V(),n.enablePan&&F(),d=c.TOUCH_DOLLY_PAN;break;case s.DOLLY_ROTATE:if(!1===n.enableZoom&&!1===n.enableRotate)return;n.enableZoom&&V(),n.enableRotate&&k(),d=c.TOUCH_DOLLY_ROTATE;break;default:d=c.NONE}break;default:d=c.NONE}d!==c.NONE&&n.dispatchEvent(j)}(t):function(t){let e;switch(t.button){case 0:e=n.mouseButtons.LEFT;break;case 1:e=n.mouseButtons.MIDDLE;break;case 2:e=n.mouseButtons.RIGHT;break;default:e=-1}switch(e){case a.DOLLY:if(!1===n.enableZoom)return;!function(t){E.set(t.clientX,t.clientY)}(t),d=c.DOLLY;break;case a.ROTATE:if(t.ctrlKey||t.metaKey||t.shiftKey){if(!1===n.enablePan)return;H(t),d=c.PAN}else{if(!1===n.enableRotate)return;B(t),d=c.ROTATE}break;case a.PAN:if(t.ctrlKey||t.metaKey||t.shiftKey){if(!1===n.enableRotate)return;B(t),d=c.ROTATE}else{if(!1===n.enablePan)return;H(t),d=c.PAN}break;default:d=c.NONE}d!==c.NONE&&n.dispatchEvent(j)}(t))}function X(t){!1!==n.enabled&&("touch"===t.pointerType?function(t){switch(et(t),d){case c.TOUCH_ROTATE:if(!1===n.enableRotate)return;Y(t),n.update();break;case c.TOUCH_PAN:if(!1===n.enablePan)return;G(t),n.update();break;case c.TOUCH_DOLLY_PAN:if(!1===n.enableZoom&&!1===n.enablePan)return;!function(t){n.enableZoom&&W(t),n.enablePan&&G(t)}(t),n.update();break;case c.TOUCH_DOLLY_ROTATE:if(!1===n.enableZoom&&!1===n.enableRotate)return;!function(t){n.enableZoom&&W(t),n.enableRotate&&Y(t)}(t),n.update();break;default:d=c.NONE}}(t):function(t){switch(d){case c.ROTATE:if(!1===n.enableRotate)return;!function(t){y.set(t.clientX,t.clientY),b.subVectors(y,v).multiplyScalar(n.rotateSpeed);const e=n.domElement;T(2*Math.PI*b.x/e.clientHeight),_(2*Math.PI*b.y/e.clientHeight),v.copy(y),n.update()}(t);break;case c.DOLLY:if(!1===n.enableZoom)return;!function(t){L.set(t.clientX,t.clientY),A.subVectors(L,E),A.y>0?N(P()):A.y<0&&R(P()),E.copy(L),n.update()}(t);break;case c.PAN:if(!1===n.enablePan)return;!function(t){x.set(t.clientX,t.clientY),S.subVectors(x,w).multiplyScalar(n.panSpeed),C(S.x,S.y),w.copy(x),n.update()}(t)}}(t))}function q(t){tt(t),0===z.length&&(n.domElement.releasePointerCapture(t.pointerId),n.domElement.removeEventListener("pointermove",X),n.domElement.removeEventListener("pointerup",q)),n.dispatchEvent(I),d=c.NONE}function K(t){tt(t)}function Q(t){!1!==n.enabled&&!1!==n.enableZoom&&d===c.NONE&&(t.preventDefault(),n.dispatchEvent(j),function(t){t.deltaY<0?R(P()):t.deltaY>0&&N(P()),n.update()}(t),n.dispatchEvent(I))}function $(t){!1!==n.enabled&&!1!==n.enablePan&&function(t){let e=!1;switch(t.code){case n.keys.UP:C(0,n.keyPanSpeed),e=!0;break;case n.keys.BOTTOM:C(0,-n.keyPanSpeed),e=!0;break;case n.keys.LEFT:C(n.keyPanSpeed,0),e=!0;break;case n.keys.RIGHT:C(-n.keyPanSpeed,0),e=!0}e&&(t.preventDefault(),n.update())}(t)}function J(t){!1!==n.enabled&&t.preventDefault()}function tt(t){delete O[t.pointerId];for(let e=0;e<z.length;e++)if(z[e].pointerId==t.pointerId)return void z.splice(e,1)}function et(t){let e=O[t.pointerId];void 0===e&&(e=new l,O[t.pointerId]=e),e.set(t.pageX,t.pageY)}function nt(t){const e=t.pointerId===z[0].pointerId?z[1]:z[0];return O[e.pointerId]}n.domElement.addEventListener("contextmenu",J),n.domElement.addEventListener("pointerdown",Z),n.domElement.addEventListener("pointercancel",K),n.domElement.addEventListener("wheel",Q,{passive:!1}),this.update()}}c.line={worldUnits:{value:1},linewidth:{value:1},resolution:{value:new l(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}},d.line={uniforms:u.merge([c.common,c.fog,c.line]),vertexShader:"\n\t\t#include <common>\n\t\t#include <color_pars_vertex>\n\t\t#include <fog_pars_vertex>\n\t\t#include <logdepthbuf_pars_vertex>\n\t\t#include <clipping_planes_pars_vertex>\n\n\t\tuniform float linewidth;\n\t\tuniform vec2 resolution;\n\n\t\tattribute vec3 instanceStart;\n\t\tattribute vec3 instanceEnd;\n\n\t\tattribute vec3 instanceColorStart;\n\t\tattribute vec3 instanceColorEnd;\n\n\t\t#ifdef WORLD_UNITS\n\n\t\t\tvarying vec4 worldPos;\n\t\t\tvarying vec3 worldStart;\n\t\t\tvarying vec3 worldEnd;\n\n\t\t\t#ifdef USE_DASH\n\n\t\t\t\tvarying vec2 vUv;\n\n\t\t\t#endif\n\n\t\t#else\n\n\t\t\tvarying vec2 vUv;\n\n\t\t#endif\n\n\t\t#ifdef USE_DASH\n\n\t\t\tuniform float dashScale;\n\t\t\tattribute float instanceDistanceStart;\n\t\t\tattribute float instanceDistanceEnd;\n\t\t\tvarying float vLineDistance;\n\n\t\t#endif\n\n\t\tvoid trimSegment( const in vec4 start, inout vec4 end ) {\n\n\t\t\t// trim end segment so it terminates between the camera plane and the near plane\n\n\t\t\t// conservative estimate of the near plane\n\t\t\tfloat a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column\n\t\t\tfloat b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column\n\t\t\tfloat nearEstimate = - 0.5 * b / a;\n\n\t\t\tfloat alpha = ( nearEstimate - start.z ) / ( end.z - start.z );\n\n\t\t\tend.xyz = mix( start.xyz, end.xyz, alpha );\n\n\t\t}\n\n\t\tvoid main() {\n\n\t\t\t#ifdef USE_COLOR\n\n\t\t\t\tvColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;\n\n\t\t\t#endif\n\n\t\t\t#ifdef USE_DASH\n\n\t\t\t\tvLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;\n\t\t\t\tvUv = uv;\n\n\t\t\t#endif\n\n\t\t\tfloat aspect = resolution.x / resolution.y;\n\n\t\t\t// camera space\n\t\t\tvec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );\n\t\t\tvec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );\n\n\t\t\t#ifdef WORLD_UNITS\n\n\t\t\t\tworldStart = start.xyz;\n\t\t\t\tworldEnd = end.xyz;\n\n\t\t\t#else\n\n\t\t\t\tvUv = uv;\n\n\t\t\t#endif\n\n\t\t\t// special case for perspective projection, and segments that terminate either in, or behind, the camera plane\n\t\t\t// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space\n\t\t\t// but we need to perform ndc-space calculations in the shader, so we must address this issue directly\n\t\t\t// perhaps there is a more elegant solution -- WestLangley\n\n\t\t\tbool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column\n\n\t\t\tif ( perspective ) {\n\n\t\t\t\tif ( start.z < 0.0 && end.z >= 0.0 ) {\n\n\t\t\t\t\ttrimSegment( start, end );\n\n\t\t\t\t} else if ( end.z < 0.0 && start.z >= 0.0 ) {\n\n\t\t\t\t\ttrimSegment( end, start );\n\n\t\t\t\t}\n\n\t\t\t}\n\n\t\t\t// clip space\n\t\t\tvec4 clipStart = projectionMatrix * start;\n\t\t\tvec4 clipEnd = projectionMatrix * end;\n\n\t\t\t// ndc space\n\t\t\tvec3 ndcStart = clipStart.xyz / clipStart.w;\n\t\t\tvec3 ndcEnd = clipEnd.xyz / clipEnd.w;\n\n\t\t\t// direction\n\t\t\tvec2 dir = ndcEnd.xy - ndcStart.xy;\n\n\t\t\t// account for clip-space aspect ratio\n\t\t\tdir.x *= aspect;\n\t\t\tdir = normalize( dir );\n\n\t\t\t#ifdef WORLD_UNITS\n\n\t\t\t\t// get the offset direction as perpendicular to the view vector\n\t\t\t\tvec3 worldDir = normalize( end.xyz - start.xyz );\n\t\t\t\tvec3 offset;\n\t\t\t\tif ( position.y < 0.5 ) {\n\n\t\t\t\t\toffset = normalize( cross( start.xyz, worldDir ) );\n\n\t\t\t\t} else {\n\n\t\t\t\t\toffset = normalize( cross( end.xyz, worldDir ) );\n\n\t\t\t\t}\n\n\t\t\t\t// sign flip\n\t\t\t\tif ( position.x < 0.0 ) offset *= - 1.0;\n\n\t\t\t\tfloat forwardOffset = dot( worldDir, vec3( 0.0, 0.0, 1.0 ) );\n\n\t\t\t\t// don't extend the line if we're rendering dashes because we\n\t\t\t\t// won't be rendering the endcaps\n\t\t\t\t#ifndef USE_DASH\n\n\t\t\t\t\t// extend the line bounds to encompass  endcaps\n\t\t\t\t\tstart.xyz += - worldDir * linewidth * 0.5;\n\t\t\t\t\tend.xyz += worldDir * linewidth * 0.5;\n\n\t\t\t\t\t// shift the position of the quad so it hugs the forward edge of the line\n\t\t\t\t\toffset.xy -= dir * forwardOffset;\n\t\t\t\t\toffset.z += 0.5;\n\n\t\t\t\t#endif\n\n\t\t\t\t// endcaps\n\t\t\t\tif ( position.y > 1.0 || position.y < 0.0 ) {\n\n\t\t\t\t\toffset.xy += dir * 2.0 * forwardOffset;\n\n\t\t\t\t}\n\n\t\t\t\t// adjust for linewidth\n\t\t\t\toffset *= linewidth * 0.5;\n\n\t\t\t\t// set the world position\n\t\t\t\tworldPos = ( position.y < 0.5 ) ? start : end;\n\t\t\t\tworldPos.xyz += offset;\n\n\t\t\t\t// project the worldpos\n\t\t\t\tvec4 clip = projectionMatrix * worldPos;\n\n\t\t\t\t// shift the depth of the projected points so the line\n\t\t\t\t// segments overlap neatly\n\t\t\t\tvec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;\n\t\t\t\tclip.z = clipPose.z * clip.w;\n\n\t\t\t#else\n\n\t\t\t\tvec2 offset = vec2( dir.y, - dir.x );\n\t\t\t\t// undo aspect ratio adjustment\n\t\t\t\tdir.x /= aspect;\n\t\t\t\toffset.x /= aspect;\n\n\t\t\t\t// sign flip\n\t\t\t\tif ( position.x < 0.0 ) offset *= - 1.0;\n\n\t\t\t\t// endcaps\n\t\t\t\tif ( position.y < 0.0 ) {\n\n\t\t\t\t\toffset += - dir;\n\n\t\t\t\t} else if ( position.y > 1.0 ) {\n\n\t\t\t\t\toffset += dir;\n\n\t\t\t\t}\n\n\t\t\t\t// adjust for linewidth\n\t\t\t\toffset *= linewidth;\n\n\t\t\t\t// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...\n\t\t\t\toffset /= resolution.y;\n\n\t\t\t\t// select end\n\t\t\t\tvec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;\n\n\t\t\t\t// back to clip space\n\t\t\t\toffset *= clip.w;\n\n\t\t\t\tclip.xy += offset;\n\n\t\t\t#endif\n\n\t\t\tgl_Position = clip;\n\n\t\t\tvec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation\n\n\t\t\t#include <logdepthbuf_vertex>\n\t\t\t#include <clipping_planes_vertex>\n\t\t\t#include <fog_vertex>\n\n\t\t}\n\t\t",fragmentShader:"\n\t\tuniform vec3 diffuse;\n\t\tuniform float opacity;\n\t\tuniform float linewidth;\n\n\t\t#ifdef USE_DASH\n\n\t\t\tuniform float dashOffset;\n\t\t\tuniform float dashSize;\n\t\t\tuniform float gapSize;\n\n\t\t#endif\n\n\t\tvarying float vLineDistance;\n\n\t\t#ifdef WORLD_UNITS\n\n\t\t\tvarying vec4 worldPos;\n\t\t\tvarying vec3 worldStart;\n\t\t\tvarying vec3 worldEnd;\n\n\t\t\t#ifdef USE_DASH\n\n\t\t\t\tvarying vec2 vUv;\n\n\t\t\t#endif\n\n\t\t#else\n\n\t\t\tvarying vec2 vUv;\n\n\t\t#endif\n\n\t\t#include <common>\n\t\t#include <color_pars_fragment>\n\t\t#include <fog_pars_fragment>\n\t\t#include <logdepthbuf_pars_fragment>\n\t\t#include <clipping_planes_pars_fragment>\n\n\t\tvec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {\n\n\t\t\tfloat mua;\n\t\t\tfloat mub;\n\n\t\t\tvec3 p13 = p1 - p3;\n\t\t\tvec3 p43 = p4 - p3;\n\n\t\t\tvec3 p21 = p2 - p1;\n\n\t\t\tfloat d1343 = dot( p13, p43 );\n\t\t\tfloat d4321 = dot( p43, p21 );\n\t\t\tfloat d1321 = dot( p13, p21 );\n\t\t\tfloat d4343 = dot( p43, p43 );\n\t\t\tfloat d2121 = dot( p21, p21 );\n\n\t\t\tfloat denom = d2121 * d4343 - d4321 * d4321;\n\n\t\t\tfloat numer = d1343 * d4321 - d1321 * d4343;\n\n\t\t\tmua = numer / denom;\n\t\t\tmua = clamp( mua, 0.0, 1.0 );\n\t\t\tmub = ( d1343 + d4321 * ( mua ) ) / d4343;\n\t\t\tmub = clamp( mub, 0.0, 1.0 );\n\n\t\t\treturn vec2( mua, mub );\n\n\t\t}\n\n\t\tvoid main() {\n\n\t\t\t#include <clipping_planes_fragment>\n\n\t\t\t#ifdef USE_DASH\n\n\t\t\t\tif ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps\n\n\t\t\t\tif ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX\n\n\t\t\t#endif\n\n\t\t\tfloat alpha = opacity;\n\n\t\t\t#ifdef WORLD_UNITS\n\n\t\t\t\t// Find the closest points on the view ray and the line segment\n\t\t\t\tvec3 rayEnd = normalize( worldPos.xyz ) * 1e5;\n\t\t\t\tvec3 lineDir = worldEnd - worldStart;\n\t\t\t\tvec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );\n\n\t\t\t\tvec3 p1 = worldStart + lineDir * params.x;\n\t\t\t\tvec3 p2 = rayEnd * params.y;\n\t\t\t\tvec3 delta = p1 - p2;\n\t\t\t\tfloat len = length( delta );\n\t\t\t\tfloat norm = len / linewidth;\n\n\t\t\t\t#ifndef USE_DASH\n\n\t\t\t\t\t#ifdef USE_ALPHA_TO_COVERAGE\n\n\t\t\t\t\t\tfloat dnorm = fwidth( norm );\n\t\t\t\t\t\talpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );\n\n\t\t\t\t\t#else\n\n\t\t\t\t\t\tif ( norm > 0.5 ) {\n\n\t\t\t\t\t\t\tdiscard;\n\n\t\t\t\t\t\t}\n\n\t\t\t\t\t#endif\n\n\t\t\t\t#endif\n\n\t\t\t#else\n\n\t\t\t\t#ifdef USE_ALPHA_TO_COVERAGE\n\n\t\t\t\t\t// artifacts appear on some hardware if a derivative is taken within a conditional\n\t\t\t\t\tfloat a = vUv.x;\n\t\t\t\t\tfloat b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;\n\t\t\t\t\tfloat len2 = a * a + b * b;\n\t\t\t\t\tfloat dlen = fwidth( len2 );\n\n\t\t\t\t\tif ( abs( vUv.y ) > 1.0 ) {\n\n\t\t\t\t\t\talpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );\n\n\t\t\t\t\t}\n\n\t\t\t\t#else\n\n\t\t\t\t\tif ( abs( vUv.y ) > 1.0 ) {\n\n\t\t\t\t\t\tfloat a = vUv.x;\n\t\t\t\t\t\tfloat b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;\n\t\t\t\t\t\tfloat len2 = a * a + b * b;\n\n\t\t\t\t\t\tif ( len2 > 1.0 ) discard;\n\n\t\t\t\t\t}\n\n\t\t\t\t#endif\n\n\t\t\t#endif\n\n\t\t\tvec4 diffuseColor = vec4( diffuse, alpha );\n\n\t\t\t#include <logdepthbuf_fragment>\n\t\t\t#include <color_fragment>\n\n\t\t\tgl_FragColor = vec4( diffuseColor.rgb, alpha );\n\n\t\t\t#include <tonemapping_fragment>\n\t\t\t#include <encodings_fragment>\n\t\t\t#include <fog_fragment>\n\t\t\t#include <premultiplied_alpha_fragment>\n\n\t\t}\n\t\t"};class B extends h{constructor(t){super({type:"LineMaterial",uniforms:u.clone(d.line.uniforms),vertexShader:d.line.vertexShader,fragmentShader:d.line.fragmentShader,clipping:!0}),this.isLineMaterial=!0,Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(t){this.uniforms.diffuse.value=t}},worldUnits:{enumerable:!0,get:function(){return"WORLD_UNITS"in this.defines},set:function(t){!0===t?this.defines.WORLD_UNITS="":delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(t){this.uniforms.linewidth.value=t}},dashed:{enumerable:!0,get:function(){return Boolean("USE_DASH"in this.defines)},set(t){Boolean(t)!==Boolean("USE_DASH"in this.defines)&&(this.needsUpdate=!0),!0===t?this.defines.USE_DASH="":delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(t){this.uniforms.dashScale.value=t}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(t){this.uniforms.dashSize.value=t}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(t){this.uniforms.dashOffset.value=t}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(t){this.uniforms.gapSize.value=t}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(t){this.uniforms.opacity.value=t}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(t){this.uniforms.resolution.value.copy(t)}},alphaToCoverage:{enumerable:!0,get:function(){return Boolean("USE_ALPHA_TO_COVERAGE"in this.defines)},set:function(t){Boolean(t)!==Boolean("USE_ALPHA_TO_COVERAGE"in this.defines)&&(this.needsUpdate=!0),!0===t?(this.defines.USE_ALPHA_TO_COVERAGE="",this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(t)}}const H=new p,k=new i;class F extends m{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type="LineSegmentsGeometry";this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute("position",new f([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute("uv",new f([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(t){const e=this.attributes.instanceStart,n=this.attributes.instanceEnd;return void 0!==e&&(e.applyMatrix4(t),n.applyMatrix4(t),e.needsUpdate=!0),null!==this.boundingBox&&this.computeBoundingBox(),null!==this.boundingSphere&&this.computeBoundingSphere(),this}setPositions(t){let e;t instanceof Float32Array?e=t:Array.isArray(t)&&(e=new Float32Array(t));const n=new g(e,6,1);return this.setAttribute("instanceStart",new v(n,3,0)),this.setAttribute("instanceEnd",new v(n,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(t){let e;t instanceof Float32Array?e=t:Array.isArray(t)&&(e=new Float32Array(t));const n=new g(e,6,1);return this.setAttribute("instanceColorStart",new v(n,3,0)),this.setAttribute("instanceColorEnd",new v(n,3,3)),this}fromWireframeGeometry(t){return this.setPositions(t.attributes.position.array),this}fromEdgesGeometry(t){return this.setPositions(t.attributes.position.array),this}fromMesh(t){return this.fromWireframeGeometry(new y(t.geometry)),this}fromLineSegments(t){const e=t.geometry;return this.setPositions(e.attributes.position.array),this}computeBoundingBox(){null===this.boundingBox&&(this.boundingBox=new p);const t=this.attributes.instanceStart,e=this.attributes.instanceEnd;void 0!==t&&void 0!==e&&(this.boundingBox.setFromBufferAttribute(t),H.setFromBufferAttribute(e),this.boundingBox.union(H))}computeBoundingSphere(){null===this.boundingSphere&&(this.boundingSphere=new b),null===this.boundingBox&&this.computeBoundingBox();const t=this.attributes.instanceStart,e=this.attributes.instanceEnd;if(void 0!==t&&void 0!==e){const n=this.boundingSphere.center;this.boundingBox.getCenter(n);let i=0;for(let a=0,s=t.count;a<s;a++)k.fromBufferAttribute(t,a),i=Math.max(i,n.distanceToSquared(k)),k.fromBufferAttribute(e,a),i=Math.max(i,n.distanceToSquared(k));this.boundingSphere.radius=Math.sqrt(i),isNaN(this.boundingSphere.radius)&&console.error("THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.",this)}}toJSON(){}applyMatrix(t){return console.warn("THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4()."),this.applyMatrix4(t)}}class V extends F{constructor(){super(),this.isLineGeometry=!0,this.type="LineGeometry"}setPositions(t){const e=t.length-3,n=new Float32Array(2*e);for(let i=0;i<e;i+=3)n[2*i]=t[i],n[2*i+1]=t[i+1],n[2*i+2]=t[i+2],n[2*i+3]=t[i+3],n[2*i+4]=t[i+4],n[2*i+5]=t[i+5];return super.setPositions(n),this}setColors(t){const e=t.length-3,n=new Float32Array(2*e);for(let i=0;i<e;i+=3)n[2*i]=t[i],n[2*i+1]=t[i+1],n[2*i+2]=t[i+2],n[2*i+3]=t[i+3],n[2*i+4]=t[i+4],n[2*i+5]=t[i+5];return super.setColors(n),this}fromLine(t){const e=t.geometry;return this.setPositions(e.attributes.position.array),this}}const Y=new i,G=new i,W=new w,Z=new w,X=new w,q=new i,K=new x,Q=new S,$=new i,J=new p,tt=new b,et=new w;let nt,it,at,st;function ot(t,e,n){return et.set(0,0,-e,1).applyMatrix4(t.projectionMatrix),et.multiplyScalar(1/et.w),et.x=st/n.width,et.y=st/n.height,et.applyMatrix4(t.projectionMatrixInverse),et.multiplyScalar(1/et.w),Math.abs(Math.max(et.x,et.y))}class rt extends E{constructor(t=new F,e=new B({color:16777215*Math.random()})){super(t,e),this.isLineSegments2=!0,this.type="LineSegments2"}computeLineDistances(){const t=this.geometry,e=t.attributes.instanceStart,n=t.attributes.instanceEnd,i=new Float32Array(2*e.count);for(let t=0,a=0,s=e.count;t<s;t++,a+=2)Y.fromBufferAttribute(e,t),G.fromBufferAttribute(n,t),i[a]=0===a?0:i[a-1],i[a+1]=i[a]+Y.distanceTo(G);const a=new g(i,2,1);return t.setAttribute("instanceDistanceStart",new v(a,1,0)),t.setAttribute("instanceDistanceEnd",new v(a,1,1)),this}raycast(t,e){const n=this.material.worldUnits,a=t.camera;null!==a||n||console.error('LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.');const s=void 0!==t.params.Line2&&t.params.Line2.threshold||0;nt=t.ray;const o=this.matrixWorld,r=this.geometry,l=this.material;let c,d;if(st=l.linewidth+s,it=r.attributes.instanceStart,at=r.attributes.instanceEnd,null===r.boundingSphere&&r.computeBoundingSphere(),tt.copy(r.boundingSphere).applyMatrix4(o),n)c=.5*st;else{c=ot(a,Math.max(a.near,tt.distanceToPoint(nt.origin)),l.resolution)}if(tt.radius+=c,!1!==nt.intersectsSphere(tt)){if(null===r.boundingBox&&r.computeBoundingBox(),J.copy(r.boundingBox).applyMatrix4(o),n)d=.5*st;else{d=ot(a,Math.max(a.near,J.distanceToPoint(nt.origin)),l.resolution)}J.expandByScalar(d),!1!==nt.intersectsBox(J)&&(n?function(t,e){for(let n=0,a=it.count;n<a;n++){Q.start.fromBufferAttribute(it,n),Q.end.fromBufferAttribute(at,n);const a=new i,s=new i;nt.distanceSqToSegment(Q.start,Q.end,s,a),s.distanceTo(a)<.5*st&&e.push({point:s,pointOnLine:a,distance:nt.origin.distanceTo(s),object:t,face:null,faceIndex:n,uv:null,uv2:null})}}(this,e):function(t,e,n){const a=e.projectionMatrix,s=t.material.resolution,o=t.matrixWorld,r=t.geometry,l=r.attributes.instanceStart,c=r.attributes.instanceEnd,d=-e.near;nt.at(1,X),X.w=1,X.applyMatrix4(e.matrixWorldInverse),X.applyMatrix4(a),X.multiplyScalar(1/X.w),X.x*=s.x/2,X.y*=s.y/2,X.z=0,q.copy(X),K.multiplyMatrices(e.matrixWorldInverse,o);for(let e=0,r=l.count;e<r;e++){if(W.fromBufferAttribute(l,e),Z.fromBufferAttribute(c,e),W.w=1,Z.w=1,W.applyMatrix4(K),Z.applyMatrix4(K),W.z>d&&Z.z>d)continue;if(W.z>d){const t=W.z-Z.z,e=(W.z-d)/t;W.lerp(Z,e)}else if(Z.z>d){const t=Z.z-W.z,e=(Z.z-d)/t;Z.lerp(W,e)}W.applyMatrix4(a),Z.applyMatrix4(a),W.multiplyScalar(1/W.w),Z.multiplyScalar(1/Z.w),W.x*=s.x/2,W.y*=s.y/2,Z.x*=s.x/2,Z.y*=s.y/2,Q.start.copy(W),Q.start.z=0,Q.end.copy(Z),Q.end.z=0;const r=Q.closestPointToPointParameter(q,!0);Q.at(r,$);const u=L.lerp(W.z,Z.z,r),h=u>=-1&&u<=1,p=q.distanceTo($)<.5*st;if(h&&p){Q.start.fromBufferAttribute(l,e),Q.end.fromBufferAttribute(c,e),Q.start.applyMatrix4(o),Q.end.applyMatrix4(o);const a=new i,s=new i;nt.distanceSqToSegment(Q.start,Q.end,s,a),n.push({point:s,pointOnLine:a,distance:nt.origin.distanceTo(s),object:t,face:null,faceIndex:e,uv:null,uv2:null})}}}(this,a,e))}}}class lt extends A{constructor(t,e,n,i,a=4473924,s=8947848){a=new z(a),s=new z(s);const o=Math.round(t/e);n=Math.round(n/i)*i/2;const r=[],l=[];let c=0;for(let i=-1*(t=o*e/2);i<=t;i+=e){r.push(i,0,-1*n,i,0,n);const t=0===i?a:s;t.toArray(l,c),c+=3,t.toArray(l,c),c+=3,t.toArray(l,c),c+=3,t.toArray(l,c),c+=3}for(let e=-1*n;e<=n;e+=i){r.push(-1*t,0,e,t,0,e);const n=0===e?a:s;n.toArray(l,c),c+=3,n.toArray(l,c),c+=3,n.toArray(l,c),c+=3,n.toArray(l,c),c+=3}const d=new O;d.setAttribute("position",new f(r,3)),d.setAttribute("color",new f(l,3));super(d,new P({vertexColors:!0,toneMapped:!1}))}}function ct(t,n,i,a){const s=function(t,n,i){t*=.5,n*=.5,i*=.5;const a=new e.BufferGeometry,s=[];return s.push(-t,-n,-i,-t,n,-i,-t,n,-i,t,n,-i,t,n,-i,t,-n,-i,t,-n,-i,-t,-n,-i,-t,-n,i,-t,n,i,-t,n,i,t,n,i,t,n,i,t,-n,i,t,-n,i,-t,-n,i,-t,-n,-i,-t,-n,i,-t,n,-i,-t,n,i,t,n,-i,t,n,i,t,-n,-i,t,-n,i),a.setAttribute("position",new e.Float32BufferAttribute(s,3)),a}(t,n,i),o=new e.LineSegments(s,new e.LineDashedMaterial({color:new e.Color(a),dashSize:3,gapSize:1}));return o.computeLineDistances(),o}class dt{constructor(e){var n,i,a;if(this.parser=new N,this.backgroundColor=14737632,this.travelColor=10027008,this.extrusionColor=65280,this.renderExtrusion=!0,this.renderTravel=!1,this.singleLayerMode=!1,this.initialCameraPosition=[-100,400,450],this.debug=!1,this.allowDragNDrop=!1,this.disposables=[],this.scene=new t.Scene,this.scene.background=new t.Color(this.backgroundColor),this.canvas=e.canvas,this.targetId=e.targetId,this.endLayer=e.endLayer,this.startLayer=e.startLayer,this.topLayerColor=e.topLayerColor,this.lastSegmentColor=e.lastSegmentColor,this.lineWidth=e.lineWidth,this.buildVolume=e.buildVolume,this.initialCameraPosition=null!==(n=e.initialCameraPosition)&&void 0!==n?n:this.initialCameraPosition,this.debug=null!==(i=e.debug)&&void 0!==i?i:this.debug,this.allowDragNDrop=null!==(a=e.allowDragNDrop)&&void 0!==a?a:this.allowDragNDrop,console.info("Using THREE r"+t.REVISION),console.debug("opts",e),this.targetId&&console.warn("`targetId` is deprecated and will removed in the future. Use `canvas` instead."),!this.canvas&&!this.targetId)throw Error("Set either opts.canvas or opts.targetId");if(this.canvas)this.renderer=new t.WebGLRenderer({canvas:this.canvas,preserveDrawingBuffer:!0});else{const e=document.getElementById(this.targetId);if(!e)throw new Error("Unable to find element "+this.targetId);this.renderer=new t.WebGLRenderer({preserveDrawingBuffer:!0}),this.canvas=this.renderer.domElement,e.appendChild(this.canvas)}this.camera=new t.PerspectiveCamera(25,this.canvas.offsetWidth/this.canvas.offsetHeight,10,5e3),this.camera.position.fromArray(this.initialCameraPosition);const s=this.camera.far,o=.8*s;this.scene.fog=new t.Fog(this.scene.background,o,s),this.resize(),this.controls=new R(this.camera,this.renderer.domElement),this.animate(),this.allowDragNDrop&&this._enableDropHandler()}get layers(){return this.parser.layers}get maxLayerIndex(){var t;return(null!==(t=this.endLayer)&&void 0!==t?t:this.layers.length)-1}get minLayerIndex(){var t;return this.singleLayerMode?this.maxLayerIndex:(null!==(t=this.startLayer)&&void 0!==t?t:0)-1}animate(){requestAnimationFrame((()=>this.animate())),this.renderer.render(this.scene,this.camera)}processGCode(t){this.parser.parseGCode(t),this.render()}render(){for(var e,n;this.scene.children.length>0;)this.scene.remove(this.scene.children[0]);for(;this.disposables.length>0;)this.disposables.pop().dispose();if(this.debug){const e=new t.AxesHelper(Math.max(this.buildVolume.x/2,this.buildVolume.y/2)+20);this.scene.add(e)}this.buildVolume&&this.drawBuildVolume(),this.group=new t.Group,this.group.name="gcode";const i={x:0,y:0,z:0,e:0};for(let a=0;a<this.layers.length&&!(a>this.maxLayerIndex);a++){const s={extrusion:[],travel:[],z:i.z},o=this.layers[a];for(const t of o.commands)if("g0"==t.gcode||"g1"==t.gcode){const e=t,n={x:void 0!==e.params.x?e.params.x:i.x,y:void 0!==e.params.y?e.params.y:i.y,z:void 0!==e.params.z?e.params.z:i.z,e:void 0!==e.params.e?e.params.e:i.e};if(a>=this.minLayerIndex){const t=e.params.e>0;(t&&this.renderExtrusion||!t&&this.renderTravel)&&this.addLineSegment(s,i,n,t)}e.params.x&&(i.x=e.params.x),e.params.y&&(i.y=e.params.y),e.params.z&&(i.z=e.params.z),e.params.e&&(i.e=e.params.e)}if(this.renderExtrusion){const i=Math.round(80*a/this.layers.length),o=new t.Color(`hsl(0, 0%, ${i}%)`).getHex();if(a==this.layers.length-1){const t=null!==(e=this.topLayerColor)&&void 0!==e?e:o,i=null!==(n=this.lastSegmentColor)&&void 0!==n?n:t,a=s.extrusion.splice(-3);this.addLine(s.extrusion,t);const r=s.extrusion.splice(-3);this.addLine([...r,...a],i)}else this.addLine(s.extrusion,o)}this.renderTravel&&this.addLine(s.travel,this.travelColor)}this.group.quaternion.setFromEuler(new t.Euler(-Math.PI/2,0,0)),this.buildVolume?this.group.position.set(-this.buildVolume.x/2,0,this.buildVolume.y/2):this.group.position.set(-100,0,100),this.scene.add(this.group),this.renderer.render(this.scene,this.camera)}drawBuildVolume(){this.scene.add(new lt(this.buildVolume.x,10,this.buildVolume.y,10));const t=ct(this.buildVolume.x,this.buildVolume.z,this.buildVolume.y,8947848);t.position.setY(this.buildVolume.z/2),this.scene.add(t)}clear(){this.startLayer=1,this.endLayer=1/0,this.singleLayerMode=!1,this.parser=new N}resize(){const[t,e]=[this.canvas.offsetWidth,this.canvas.offsetHeight];this.camera.aspect=t/e,this.camera.updateProjectionMatrix(),this.renderer.setPixelRatio(window.devicePixelRatio),this.renderer.setSize(t,e,!1)}addLineSegment(t,e,n,i){(i?t.extrusion:t.travel).push(e.x,e.y,e.z,n.x,n.y,n.z)}addLine(e,n){if("number"==typeof this.lineWidth&&this.lineWidth>0)return void this.addThickLine(e,n);const i=new t.BufferGeometry;i.setAttribute("position",new t.Float32BufferAttribute(e,3)),this.disposables.push(i);const a=new t.LineBasicMaterial({color:n});this.disposables.push(a);const s=new t.LineSegments(i,a);this.group.add(s)}addThickLine(t,e){if(!t.length)return;const n=new V;this.disposables.push(n);const i=new B({color:e,linewidth:this.lineWidth/(1e3*window.devicePixelRatio)});this.disposables.push(i),n.setPositions(t);const a=new rt(n,i);this.group.add(a)}_enableDropHandler(){this.canvas.addEventListener("dragover",(t=>{t.stopPropagation(),t.preventDefault(),t.dataTransfer.dropEffect="copy",this.canvas.classList.add("dragging")})),this.canvas.addEventListener("dragleave",(t=>{t.stopPropagation(),t.preventDefault(),this.canvas.classList.remove("dragging")})),this.canvas.addEventListener("drop",(t=>T(this,void 0,void 0,(function*(){t.stopPropagation(),t.preventDefault(),this.canvas.classList.remove("dragging");const e=t.dataTransfer.files[0];this.clear(),yield this._readFromStream(e.stream()),this.render()}))))}_readFromStream(t){var e,n;return T(this,void 0,void 0,(function*(){const i=t.getReader();let a,s="",o=0;do{a=yield i.read(),o+=null!==(n=null===(e=a.value)||void 0===e?void 0:e.length)&&void 0!==n?n:0;const t=(r=a.value,new TextDecoder("utf-8").decode(r)),l=t.lastIndexOf("\n"),c=t.slice(0,l);this.parser.parseGCode(s+c),s=t.slice(l)}while(!a.done);var r;console.debug("read from stream",o)}))}}const ut=dt;export{dt as WebGLPreview,ut as init};
