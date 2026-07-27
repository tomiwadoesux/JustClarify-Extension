"use client";

import { useEffect, useRef } from "react";

export default function Harmonics3DPage() {
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup;

    (async () => {
      const THREE = await import("three");
      const { GLTFLoader } = await import(
        "three/examples/jsm/loaders/GLTFLoader.js"
      );
      if (cancelled || !containerRef.current) return;

      const container = containerRef.current;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xffffff);

      const BASE_FOV = 45;
      const camera = new THREE.PerspectiveCamera(
        BASE_FOV,
        container.clientWidth / container.clientHeight,
        0.1,
        1000
      );

      // GLB has no baked lights
      scene.add(new THREE.AmbientLight(0xffffff, 1.2));
      const dir = new THREE.DirectionalLight(0xffffff, 1.5);
      dir.position.set(5, 10, 7);
      scene.add(dir);

      let mixer;
      const clock = new THREE.Clock();

      // The circles are tori, so edge-on they're as thick as their tube.
      // Squashing them along Z (their plane normal) as we reach the side
      // view collapses each one into a hairline stroke. Dots stay spheres.
      const circleNodes = [];

      // How much of each torus's tube to keep (1 = unchanged). Lower = thinner
      // circle stroke. Contracts every ring vertex toward its centerline.
      const CIRCLE_THINNESS = 0.5;
      const thinnedGeo = new Set();
      const thinTorus = (geo, t) => {
        if (!geo?.attributes?.position || thinnedGeo.has(geo)) return;
        thinnedGeo.add(geo);
        geo.computeBoundingBox();
        const size = new THREE.Vector3();
        const c = new THREE.Vector3();
        geo.boundingBox.getSize(size);
        geo.boundingBox.getCenter(c);
        const dims = [size.x, size.y, size.z];
        const comp = ["x", "y", "z"];
        // Ring-normal axis = smallest extent (only spans the tube); the other
        // two axes are the ring plane. Works regardless of the torus' rotation.
        const nAxis = dims.indexOf(Math.min(...dims));
        const [aAxis, bAxis] = [0, 1, 2].filter((a) => a !== nAxis);
        const r = dims[nAxis] / 2; // tube radius
        const R = Math.max(dims[aAxis], dims[bAxis]) / 2 - r; // major radius
        const pos = geo.attributes.position;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).sub(c);
          const a = v[comp[aAxis]];
          const b = v[comp[bAxis]];
          const rho = Math.hypot(a, b) || 1e-6;
          const s = (R + (rho - R) * t) / rho; // pull the ring in toward R
          v[comp[aAxis]] = a * s;
          v[comp[bAxis]] = b * s;
          v[comp[nAxis]] *= t; // and flatten the tube
          v.add(c);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
      };

      // Set after the model loads
      const center = new THREE.Vector3();
      let baseDist = 10;

      const frameModel = (object) => {
        const box = new THREE.Box3().setFromObject(object);
        box.getCenter(center);
        const size = box.getSize(new THREE.Vector3());
        // Fit the front (XY) face of the figure tightly in view. Lower padding
        // factor = the figure fills more of the frame (larger on screen).
        const halfFov = (BASE_FOV * Math.PI) / 360;
        const distY = size.y / 2 / Math.tan(halfFov);
        const distX = size.x / 2 / (Math.tan(halfFov) * camera.aspect);
        baseDist = Math.max(distX, distY) * 1.35 + size.z / 2;
        camera.near = baseDist / 100;
        camera.far = baseDist * 1000;
      };

      new GLTFLoader().load("/3dharmonics.glb", (gltf) => {
        if (cancelled) return;
        scene.add(gltf.scene);
        frameModel(gltf.scene);

        gltf.scene.traverse((o) => {
          if (o.name.startsWith("Circle")) {
            circleNodes.push(o);
            o.traverse((m) => {
              if (m.isMesh) {
                thinTorus(m.geometry, CIRCLE_THINNESS);
                // Unlit pure black so the stroke reads solid regardless of lighting
                m.material = new THREE.MeshBasicMaterial({ color: 0x000000 });
              }
            });
          }
        });

        // Play every clip — the figure is split across 16 actions
        mixer = new THREE.AnimationMixer(gltf.scene);
        for (const clip of gltf.animations) {
          mixer.clipAction(clip).play();
        }
      });

      // Scroll drives the camera: 0 = front view, 1 = side view where the
      // circles sit edge-on and read as lines. Smoothed each frame.
      let eased = 0;
      const scrollProgress = () => {
        const denom =
          document.documentElement.scrollHeight - window.innerHeight;
        return denom > 0 ? Math.min(1, Math.max(0, window.scrollY / denom)) : 0;
      };

      renderer.setAnimationLoop(() => {
        const dt = clock.getDelta();
        mixer?.update(dt);

        eased += (scrollProgress() - eased) * Math.min(1, dt * 6);

        const flat = 1.0; // keep full thickness since perspective flattening handles the 2D look
        for (const n of circleNodes) n.scale.z = flat;

        // Orbit 90° around the vertical axis, with a dolly-zoom (pull back +
        // narrow the fov) so perspective flattens and the side view looks 2D.
        const angle = eased * (Math.PI / 2); // Full 90° = exactly edge-on, so each ring reads as a straight vertical line
        const k = 1 + eased * 149;
        const dist = baseDist * k;
        camera.fov =
          (Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) / k) * 360) /
          Math.PI;
        camera.position.set(
          center.x + Math.sin(angle) * dist,
          center.y,
          center.z + Math.cos(angle) * dist
        );
        camera.lookAt(center);
        camera.updateProjectionMatrix();

        renderer.render(scene, camera);
      });

      const onResize = () => {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
      };
      window.addEventListener("resize", onResize);

      cleanup = () => {
        window.removeEventListener("resize", onResize);
        renderer.setAnimationLoop(null);
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <main className="relative h-[300vh] w-full bg-white">
      <div ref={containerRef} className="fixed inset-0 h-screen w-screen" />
    </main>
  );
}
