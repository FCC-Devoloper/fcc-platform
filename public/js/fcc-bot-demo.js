import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.171.0/build/three.module.js";
import { RoundedBoxGeometry } from "https://cdn.jsdelivr.net/npm/three@0.171.0/examples/jsm/geometries/RoundedBoxGeometry.js";

const host = document.querySelector("#robot-stage");
const loading = document.querySelector("#robot-loading");
const message = document.querySelector("#bot-message");
const helloButton = document.querySelector("#hello-button");
const moodButton = document.querySelector("#mood-button");

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!host) throw new Error("FCC Bot stage was not found.");

if (!("WebGLRenderingContext" in window)) {
  if (loading) loading.textContent = "Для 3D-модели нужен браузер с поддержкой WebGL.";
} else {
  startBot();
}

function startBot() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  camera.position.set(0, 1.25, 6.8);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power"
    });
  } catch (error) {
    if (loading) loading.textContent = "3D не запустился в этом браузере. Проверь поддержку WebGL.";
    console.error("[FCC Bot] WebGL initialization failed:", error);
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  host.appendChild(renderer.domElement);
  if (loading) loading.remove();

  scene.add(new THREE.HemisphereLight(0x9dc9ff, 0x10162b, 2.0));

  const keyLight = new THREE.DirectionalLight(0xddeaff, 3.1);
  keyLight.position.set(-3, 5, 5);
  scene.add(keyLight);

  const blueLight = new THREE.PointLight(0x087dff, 24, 8);
  blueLight.position.set(2, 1.2, 2.2);
  scene.add(blueLight);

  const greenLight = new THREE.PointLight(0x43ff5d, 5, 3.2);
  greenLight.position.set(0, 1.2, 1.5);
  scene.add(greenLight);

  const materials = {
    shell: new THREE.MeshPhysicalMaterial({
      color: 0x182a49, metalness: 0.78, roughness: 0.24,
      clearcoat: 0.85, clearcoatRoughness: 0.2
    }),
    lightShell: new THREE.MeshPhysicalMaterial({
      color: 0xb8c9e3, metalness: 0.68, roughness: 0.22,
      clearcoat: 0.9, clearcoatRoughness: 0.17
    }),
    dark: new THREE.MeshPhysicalMaterial({
      color: 0x030711, metalness: 0.42, roughness: 0.18,
      clearcoat: 1, clearcoatRoughness: 0.1
    }),
    blue: new THREE.MeshStandardMaterial({
      color: 0x087cff, emissive: 0x006eff, emissiveIntensity: 2.2,
      metalness: 0.35, roughness: 0.24
    }),
    green: new THREE.MeshStandardMaterial({
      color: 0x8dff70, emissive: 0x38ff42, emissiveIntensity: 4.6,
      roughness: 0.2, metalness: 0.08
    }),
    black: new THREE.MeshStandardMaterial({ color: 0x080f1d, metalness: 0.5, roughness: 0.3 })
  };

  const robot = new THREE.Group();
  scene.add(robot);

  const torso = new THREE.Group();
  robot.add(torso);

  // Rounded, compact chest.
  const chest = new THREE.Mesh(
    new RoundedBoxGeometry(0.88, 0.98, 0.58, 8, 0.19),
    materials.shell
  );
  chest.position.y = 0.12;
  torso.add(chest);

  const chestPanel = new THREE.Mesh(
    new RoundedBoxGeometry(0.65, 0.58, 0.035, 6, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x10213b, metalness: 0.6, roughness: 0.3 })
  );
  chestPanel.position.set(0, 0.18, 0.302);
  torso.add(chestPanel);

  // FCC mark, drawn as two luminous slanted strokes.
  const logo = new THREE.Group();
  logo.position.set(0, 0.22, 0.33);
  torso.add(logo);
  const logoBar1 = new THREE.Mesh(new RoundedBoxGeometry(0.29, 0.075, 0.035, 4, 0.025), materials.blue);
  logoBar1.rotation.z = -0.56;
  logoBar1.position.set(-0.025, 0.04, 0);
  logo.add(logoBar1);
  const logoBar2 = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.075, 0.035, 4, 0.025), materials.blue);
  logoBar2.rotation.z = -0.56;
  logoBar2.position.set(0.055, -0.105, 0);
  logo.add(logoBar2);

  const chestLight = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.018, 8, 48),
    materials.blue
  );
  chestLight.position.set(0, -0.18, 0.336);
  torso.add(chestLight);

  // Floating shoulder arms: pivot groups make the wave animation simple.
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.48, 0.38, 0.02);
    torso.add(pivot);

    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.19, 28, 20), materials.black);
    joint.scale.set(0.9, 1, 0.8);
    pivot.add(joint);

    const fin = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 32, 24),
      materials.lightShell
    );
    fin.scale.set(0.8, 1.45, 0.65);
    fin.position.set(side * 0.14, -0.2, 0.06);
    fin.rotation.z = side * -0.28;
    pivot.add(fin);

    const finEdge = new THREE.Mesh(
      new THREE.TorusGeometry(0.115, 0.018, 8, 32),
      materials.blue
    );
    finEdge.scale.set(0.78, 1.35, 1);
    finEdge.position.set(side * 0.14, -0.2, 0.19);
    pivot.add(finEdge);

    return pivot;
  }

  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);
  leftArm.rotation.z = 0.12;
  rightArm.rotation.z = -0.12;

  // A short neck and a smooth helmet.
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.19, 0.24, 0.25, 32),
    materials.black
  );
  neck.position.y = 0.73;
  torso.add(neck);

  const headPivot = new THREE.Group();
  headPivot.position.y = 1.22;
  robot.add(headPivot);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.78, 64, 48), materials.lightShell);
  helmet.scale.set(1.04, 0.83, 0.79);
  headPivot.add(helmet);

  const helmetCrown = new THREE.Mesh(
    new THREE.SphereGeometry(0.755, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.56),
    materials.shell
  );
  helmetCrown.scale.set(1.045, 0.85, 0.8);
  helmetCrown.position.y = 0.025;
  headPivot.add(helmetCrown);

  // Visor rim + dark glass.
  const visorRim = new THREE.Mesh(
    new RoundedBoxGeometry(1.37, 0.67, 0.16, 10, 0.19),
    materials.black
  );
  visorRim.position.set(0, -0.015, 0.62);
  headPivot.add(visorRim);

  const visor = new THREE.Mesh(
    new RoundedBoxGeometry(1.29, 0.59, 0.09, 10, 0.16),
    new THREE.MeshPhysicalMaterial({
      color: 0x020711, metalness: 0.32, roughness: 0.13,
      clearcoat: 1, clearcoatRoughness: 0.06
    })
  );
  visor.position.set(0, -0.015, 0.715);
  headPivot.add(visor);

  // The eye shapes are custom, so they do not resemble a stock robot face.
  function createEye() {
    const shape = new THREE.Shape();
    shape.moveTo(-0.12, 0);
    shape.bezierCurveTo(-0.065, 0.14, 0.065, 0.15, 0.125, 0.005);
    shape.bezierCurveTo(0.055, -0.07, -0.06, -0.075, -0.12, 0);
    const geometry = new THREE.ShapeGeometry(shape, 24);
    const eye = new THREE.Mesh(geometry, materials.green);
    eye.scale.set(1.1, 1.05, 1);
    eye.position.z = 0.77;
    return eye;
  }

  const leftEye = createEye();
  leftEye.position.set(-0.31, 0.01, 0.77);
  headPivot.add(leftEye);

  const rightEye = createEye();
  rightEye.position.set(0.31, 0.01, 0.77);
  rightEye.scale.x = -1.1;
  headPivot.add(rightEye);

  // Side details: small blue-lit ear modules.
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 32, 24),
      materials.shell
    );
    ear.scale.set(0.42, 1.04, 0.84);
    ear.position.set(side * 0.77, 0.015, 0.02);
    headPivot.add(ear);

    const earGlow = new THREE.Mesh(
      new THREE.TorusGeometry(0.115, 0.021, 8, 32),
      materials.blue
    );
    earGlow.scale.set(0.75, 1, 1);
    earGlow.position.set(side * 0.82, 0.015, 0.06);
    earGlow.rotation.y = Math.PI / 2;
    headPivot.add(earGlow);
  }

  // Soft blue details around the shell.
  const foreheadLine = new THREE.Mesh(
    new THREE.TorusGeometry(0.49, 0.012, 6, 64, Math.PI * 0.7),
    materials.blue
  );
  foreheadLine.position.set(0, 0.46, 0.36);
  foreheadLine.rotation.z = Math.PI;
  headPivot.add(foreheadLine);

  // Hover platform.
  const platform = new THREE.Group();
  platform.position.y = -0.73;
  robot.add(platform);

  const ringOuter = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.018, 8, 100), materials.blue);
  ringOuter.rotation.x = Math.PI / 2;
  platform.add(ringOuter);

  const ringInner = new THREE.Mesh(
    new THREE.TorusGeometry(0.56, 0.009, 6, 80),
    new THREE.MeshBasicMaterial({ color: 0x2aa6ff, transparent: true, opacity: 0.65 })
  );
  ringInner.rotation.x = Math.PI / 2;
  ringInner.position.y = -0.015;
  platform.add(ringInner);

  const groundGlow = new THREE.Mesh(
    new THREE.CircleGeometry(0.9, 64),
    new THREE.MeshBasicMaterial({ color: 0x087aff, transparent: true, opacity: 0.065, side: THREE.DoubleSide })
  );
  groundGlow.rotation.x = -Math.PI / 2;
  groundGlow.position.y = -0.025;
  platform.add(groundGlow);

  // A few quiet particles give the stage depth without external image assets.
  const particlePositions = [];
  for (let i = 0; i < 42; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.15 + Math.random() * 1.25;
    particlePositions.push(
      Math.cos(angle) * radius,
      Math.random() * 2.9 - 0.45,
      (Math.random() - 0.5) * 1.25 - 0.25
    );
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.Float32BufferAttribute(particlePositions, 3));
  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({ color: 0x399cff, size: 0.018, transparent: true, opacity: 0.55 })
  );
  scene.add(particles);

  let targetRotation = 0;
  let waveStartedAt = 0;
  let nextBlinkAt = performance.now() + 2600;
  let blinkStartedAt = 0;
  let mood = "friendly";
  const clock = new THREE.Clock();

  function greet() {
    waveStartedAt = performance.now();
    setMessage("Привет! Я FCC Bot. Покажу тебе платформу и помогу найти нужный раздел.");
  }

  function setMessage(text) {
    if (message) message.textContent = text;
  }

  function setMood() {
    mood = mood === "friendly" ? "curious" : mood === "curious" ? "focused" : "friendly";
    if (mood === "curious") {
      setMessage("Хм… Что сегодня будем изучать? Я готов исследовать FCC вместе с тобой.");
    } else if (mood === "focused") {
      setMessage("Режим концентрации активирован. Давай сосредоточимся на коде!");
    } else {
      setMessage("Улыбка включена. Рад снова тебя видеть!");
    }
  }

  helloButton?.addEventListener("click", greet);
  moodButton?.addEventListener("click", setMood);
  host.addEventListener("click", greet);

  const replies = {
    learning: "Загляни в раздел «Обучение». Там можно будет найти направления, материалы и задания. Я помогу сориентироваться.",
    projects: "В разделе «Проекты» собраны работы и идеи сообщества FCC. Посмотри, что уже создано, и вдохновись для своего проекта.",
    contacts: "Открой раздел «Контакты», чтобы найти способы связи с командой Fast Coding Crew."
  };
  document.querySelectorAll("[data-question]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.getAttribute("data-question");
      setMessage(replies[key] || "Я пока учусь отвечать на вопросы о FCC.");
      waveStartedAt = performance.now();
    });
  });

  host.addEventListener("pointermove", (event) => {
    const rect = host.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
    targetRotation = (x - 0.5) * 0.35;
  });
  host.addEventListener("pointerleave", () => { targetRotation = 0; });

  function resize() {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    camera.aspect = width / height;
    camera.position.z = width < 480 ? 7.25 : 6.8;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();

  function animate(now) {
    requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();

    if (!prefersReducedMotion) {
      robot.position.y = 0.06 + Math.sin(elapsed * 1.55) * 0.075;
      robot.rotation.y += (targetRotation - robot.rotation.y) * 0.035;
      headPivot.rotation.y = Math.sin(elapsed * 0.7) * 0.035;
      headPivot.rotation.x = Math.sin(elapsed * 0.9) * 0.012;
      platform.rotation.y = elapsed * 0.12;
      particles.rotation.y = Math.sin(elapsed * 0.08) * 0.05;

      const waveAge = now - waveStartedAt;
      if (waveStartedAt && waveAge < 1450) {
        const wave = Math.sin(waveAge * 0.019) * Math.sin(Math.PI * waveAge / 1450);
        rightArm.rotation.z = -0.12 - Math.abs(wave) * 1.05;
        rightArm.rotation.x = Math.sin(waveAge * 0.019) * 0.25;
      } else {
        rightArm.rotation.z += (-0.12 - rightArm.rotation.z) * 0.08;
        rightArm.rotation.x *= 0.86;
      }
      leftArm.rotation.z = 0.12 + Math.sin(elapsed * 1.5) * 0.025;
    }

    if (!prefersReducedMotion && now >= nextBlinkAt && !blinkStartedAt) {
      blinkStartedAt = now;
    }
    if (blinkStartedAt) {
      const blinkAge = now - blinkStartedAt;
      const blinkScale = blinkAge < 85 ? 1 - blinkAge / 85 : blinkAge < 170 ? (blinkAge - 85) / 85 : 1;
      const eyeScale = Math.max(0.08, blinkScale);
      leftEye.scale.y = 1.05 * eyeScale;
      rightEye.scale.y = 1.05 * eyeScale;
      if (blinkAge >= 170) {
        leftEye.scale.y = 1.05;
        rightEye.scale.y = 1.05;
        blinkStartedAt = 0;
        nextBlinkAt = now + 2200 + Math.random() * 2600;
      }
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);
}
