"use client";

import { useEffect, useRef } from "react";

export default function Harmonics3D({ stateRef }) {
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

      // Enable transparency (alpha: true) so it overlays seamlessly
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setClearColor(0x000000, 0); // transparent background
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();

      const BASE_FOV = 45;
      const camera = new THREE.PerspectiveCamera(
        BASE_FOV,
        container.clientWidth / container.clientHeight,
        0.1,
        1000
      );

      // Add lights (GLB has no baked lights)
      scene.add(new THREE.AmbientLight(0xffffff, 1.2));
      const dir = new THREE.DirectionalLight(0xffffff, 1.5);
      dir.position.set(5, 10, 7);
      scene.add(dir);

      let mixer;
      const clock = new THREE.Clock();
      const circleNodes = [];

      // Set after the model loads
      const center = new THREE.Vector3();
      let baseDist = 10;

      const frameModel = (object) => {
        const box = new THREE.Box3().setFromObject(object);
        box.getCenter(center);
        const size = box.getSize(new THREE.Vector3());
        
        // Fit the front (XY) face of the figure tightly in view
        const halfFov = (BASE_FOV * Math.PI) / 360;
        const distY = size.y / 2 / Math.tan(halfFov);
        const distX = size.x / 2 / (Math.tan(halfFov) * camera.aspect);
        baseDist = Math.max(distX, distY) * 2.2 + size.z / 2;
        camera.near = baseDist / 100;
        camera.far = baseDist * 1000;
      };

      new GLTFLoader().load("/3dharmonics.glb", (gltf) => {
        if (cancelled) return;
        scene.add(gltf.scene);
        frameModel(gltf.scene);

        gltf.scene.traverse((o) => {
          if (o.name.startsWith("Circle")) circleNodes.push(o);
        });

        // Play every clip — the figure is split across 16 actions
        mixer = new THREE.AnimationMixer(gltf.scene);
        for (const clip of gltf.animations) {
          mixer.clipAction(clip).play();
        }
      });

      renderer.setAnimationLoop(() => {
        const dt = clock.getDelta();
        
        // Read animSpeed from stateRef dynamically
        const animSpeed = stateRef?.current?.animSpeed ?? 0;
        mixer?.update(dt * animSpeed);

        const flat = 1.0; 
        for (const n of circleNodes) n.scale.z = flat;

        // Read scroll progress from stateRef dynamically
        const progress = stateRef?.current?.progress ?? 0;

        // Orbit 90° around the vertical axis with a dolly-zoom
        const angle = progress * (Math.PI / 2) * 0.985; // Limit to ~88.6° for outline rasterization visibility
        const k = 1 + progress * 149;
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
        if (!container) return;
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
  }, [stateRef]);

  return <div ref={containerRef} className="w-full h-full" />;
}
