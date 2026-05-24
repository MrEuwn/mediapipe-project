import * as THREE from 'three';
import { AudioFX } from './audio.js';

// PERFORMANCES OPTIMIZATION: REUSABLE VECTOR SCRATCHPADS (Mencegah Garbage Collection Stutter)
const _camPos = new THREE.Vector3();
const _crossPos = new THREE.Vector3();
const _shootDir = new THREE.Vector3();
const _armPos = new THREE.Vector3();
const _bulletDir = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _eBallPos = new THREE.Vector3();
const _lerpScale = new THREE.Vector3(1, 1, 1);

// Buka audio context lewat interaksi awal user
window.addEventListener('click', () => AudioFX.init());
window.addEventListener('touchstart', () => AudioFX.init());

// STATE MANAGER
const state = {
    isPlaying: false, health: 100, mana: 100, score: 0, enemyHealth: 100,
    lastFireTime: 0, isRecharging: false, shieldActive: false, leftHandTracked: false,
    enemyLastAttack: 0, cameraShake: 0, lastChargeSoundTime: 0,
    smoothedHands: { right: new THREE.Vector3(), left: new THREE.Vector3() },
    isCameraLoaded: false
};

const DOM = {
    video: document.getElementById('webcam'), gameCanvas: document.getElementById('game-canvas'),
    trackingCanvas: document.getElementById('tracking-canvas'),
    hpFill: document.getElementById('health-fill'), manaFill: document.getElementById('mana-fill'),
    enemyHpFill: document.getElementById('enemy-health-fill'), enemyHpText: document.getElementById('enemy-hp-text'),
    scoreText: document.getElementById('score-text'), hpText: document.getElementById('hp-text'),
    manaText: document.getElementById('mana-text'), damageOverlay: document.getElementById('damage-overlay'), 
    trackingStatus: document.getElementById('tracking-status'), loadingToast: document.getElementById('loading-toast')
};
const trackingCtx = DOM.trackingCanvas.getContext('2d');

// SETUP THREE.JS SCENE
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xecf2ff); 
scene.fog = new THREE.FogExp2(0xecf2ff, 0.03);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000); 
camera.position.set(0, 1.6, 0); scene.add(camera);

const renderer = new THREE.WebGLRenderer({ canvas: DOM.gameCanvas, antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight); 
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Limit pixel ratio ke maksimal 1.5 demi menjaga performa GPU ringan
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// LIGHTING
scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 2.5); 
dirLight.position.set(10, 20, 10); 
dirLight.castShadow = true; 
scene.add(dirLight);

// GROUND & GRID
const gridHelper = new THREE.GridHelper(100, 100, 0x6c63ff, 0xccd5ff); gridHelper.position.y = 0.01; scene.add(gridHelper);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// GEOMETRY & MATERIALS SHARING (Optimasi Reuse Asset)
const bulletGeo = new THREE.DodecahedronGeometry(0.12, 0);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0x6c63ff });
const enemyBulletGeo = new THREE.DodecahedronGeometry(0.25, 0);
const enemyBulletMat = new THREE.MeshStandardMaterial({color: 0xff7675, emissive: 0xd63031});
const beamGeo = new THREE.CylinderGeometry(0.015, 0.015, 1, 6);
const beamMat = new THREE.MeshBasicMaterial({ color: 0x6c63ff, transparent: true, opacity: 0.8 });

// PLAYER ARMS
const fpsArmsGroup = new THREE.Group(); camera.add(fpsArmsGroup);
const handMagicRings = []; const handCores = []; const spellBeams = [];
let coreL;

function createAdvancedArm(isRight) {
    const armGroup = new THREE.Group();
    const armorMat = new THREE.MeshStandardMaterial({ color: 0xe0e6ed, metalness: 0.5, roughness: 0.2 });
    const coreMat = new THREE.MeshStandardMaterial({ color: isRight ? 0xff7675 : 0x00e6cf, emissive: isRight ? 0xd63031 : 0x00aaff, emissiveIntensity: 1.5 });
    
    const bracer = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.35, 8), armorMat); bracer.position.set(0, 0, -0.25); bracer.rotation.x = Math.PI / 2; armGroup.add(bracer);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.14), armorMat); palm.position.set(0, 0, -0.5); armGroup.add(palm);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.04, 0), coreMat); core.position.set(0, 0.03, -0.5); armGroup.add(core); 
    handCores.push(core); if (!isRight) coreL = core;

    const magicRing = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.005, 8, 32), new THREE.MeshBasicMaterial({ color: isRight ? 0xff7675 : 0x6c63ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    magicRing.position.set(0, 0, -0.4); armGroup.add(magicRing); handMagicRings.push({ mesh: magicRing, speed: isRight ? 0.05 : -0.05 });

    armGroup.position.set(isRight ? 0.4 : -0.4, -0.4, -0.2); return armGroup;
}

const armR = createAdvancedArm(true); const armL = createAdvancedArm(false); fpsArmsGroup.add(armR, armL);

// MUSUH (ARCANE ORB)
const enemyGroup = new THREE.Group(); enemyGroup.position.set(0, 0, -10); scene.add(enemyGroup);
const clock = new THREE.Clock();

const arcaneOrbGroup = new THREE.Group(); enemyGroup.add(arcaneOrbGroup);
arcaneOrbGroup.position.y = 1.0;

const coreOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x00ccff, emissiveIntensity: 2.0, transparent: true, opacity: 0.9 })
);
arcaneOrbGroup.add(coreOrb);

const ringMat = new THREE.MeshStandardMaterial({ color: 0xccccff, transparent: true, opacity: 0.6 });
for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.04, 8, 50), ringMat);
    ring.rotation.x = Math.random() * Math.PI; ring.rotation.y = Math.random() * Math.PI;
    arcaneOrbGroup.add(ring);
    handMagicRings.push({ mesh: ring, speed: (Math.random() - 0.5) * 0.03 });
}
const orbLight = new THREE.PointLight(0x00ccff, 1.5, 5); arcaneOrbGroup.add(orbLight);

// CROSSHAIR & SHIELD
const crosshair = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.03, 32), new THREE.MeshBasicMaterial({ color: 0x6c63ff, transparent: true, opacity: 0.8 })); crosshair.position.z = -1.5; camera.add(crosshair); 
const shield = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 1), new THREE.MeshBasicMaterial({ color: 0x00ccff, wireframe: true, transparent: true, opacity: 0.2 })); shield.position.set(0.4, 0, -2); shield.visible = false; camera.add(shield);

const projectiles = []; const particles = []; const raycaster = new THREE.Raycaster();
const trajectoryPoints = Array.from({length: 15}, () => { // Dikurangi ke 15 dot agar kalkulasi matematika ringkas
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 4), new THREE.MeshBasicMaterial({ color: 0x6c63ff, transparent: true, opacity: 0.4 }));
    dot.visible = false; scene.add(dot); return dot;
});

function checkAutoStart() {
    if (state.isCameraLoaded && !state.isPlaying) {
        DOM.loadingToast.style.opacity = '0';
        setTimeout(() => DOM.loadingToast.style.display = 'none', 500);
        state.isPlaying = true;
        state.enemyLastAttack = performance.now() + 2500;
    }
}

// OPTIMIZED PARTICLE SYSTEM DISPOSAL
function createExplosion(pos, color, pCount = 30) {
    const geo = new THREE.BufferGeometry(); const posArr = new Float32Array(pCount * 3); const velArr = [];
    for(let i=0; i<pCount; i++) {
        posArr[i*3] = pos.x; posArr[i*3+1] = pos.y; posArr[i*3+2] = pos.z; 
        velArr.push((Math.random() - 0.5)*0.4, (Math.random() - 0.5)*0.4, (Math.random() - 0.5)*0.4);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3)); 
    const ptsMat = new THREE.PointsMaterial({ size: 0.12, color: color, transparent: true, opacity: 1.0 });
    const pts = new THREE.Points(geo, ptsMat);
    scene.add(pts); particles.push({ mesh: pts, vel: velArr, life: 1.0 });
}

function getCrosshairWorldTarget() {
    camera.getWorldPosition(_camPos);
    crosshair.getWorldPosition(_crossPos);
    _shootDir.copy(_crossPos).sub(_camPos).normalize();
    raycaster.set(_camPos, _shootDir);
    const intersects = raycaster.intersectObject(enemyGroup, true);
    if (intersects.length > 0) {
        return { point: intersects[0].point, isHit: true };
    } else {
        _targetPos.copy(_camPos).addScaledVector(_shootDir, 25);
        return { point: _targetPos, isHit: false };
    }
}

function updateTrajectoryLine() {
    if (!state.isPlaying || !state.leftHandTracked) { trajectoryPoints.forEach(d => d.visible = false); return; }
    const targetData = getCrosshairWorldTarget();
    armL.getWorldPosition(_armPos); _armPos.y += 0.03;
    _bulletDir.copy(targetData.point).sub(_armPos).normalize();
    const dist = _armPos.distanceTo(targetData.point);
    const step = dist / trajectoryPoints.length;

    trajectoryPoints.forEach((dot, i) => {
        const cDist = step * (i + 1);
        if (cDist <= dist) {
            dot.position.copy(_armPos).addScaledVector(_bulletDir, cDist); dot.visible = true;
            dot.material.opacity = 0.1 + Math.sin(performance.now() * 0.01 + i) * 0.3;
        } else dot.visible = false;
    });
}

function shootFireball() {
    if (state.mana < 10 || performance.now() - state.lastFireTime < 350) return;
    state.mana -= 10; updateUI(); state.lastFireTime = performance.now();

    AudioFX.playShoot();
    const targetData = getCrosshairWorldTarget();
    armL.getWorldPosition(_armPos); _armPos.y += 0.03;
    _bulletDir.copy(targetData.point).sub(_armPos).normalize();

    const ball = new THREE.Mesh(bulletGeo, bulletMat);
    ball.position.copy(_armPos); projectiles.push({ mesh: ball, dir: _bulletDir.clone(), speed: 0.8, isPlayer: true }); scene.add(ball);
    
    state.cameraShake = 0.05; if(coreL) coreL.scale.set(1.8, 1.8, 1.8);

    if (targetData.isHit) {
        setTimeout(() => {
            AudioFX.playHitEnemy();
            createExplosion(targetData.point, 0x6c63ff);
            state.enemyHealth = Math.max(0, state.enemyHealth - 10); state.cameraShake = 0.2; enemyGroup.position.z -= 0.3; updateUI();
            if (state.enemyHealth <= 0) {
                createExplosion(enemyGroup.position, 0xff7675, 80); state.score += 200; state.enemyHealth = 100;
                enemyGroup.position.z = -15; updateUI();
            }
        }, 120);
    }

    const beamLength = _armPos.distanceTo(targetData.point);
    const beamMesh = new THREE.Mesh(beamGeo, beamMat);
    beamMesh.scale.set(1, beamLength, 1); beamMesh.position.copy(_armPos).add(targetData.point).multiplyScalar(0.5);
    beamMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _bulletDir);
    scene.add(beamMesh); spellBeams.push({ mesh: beamMesh, life: 1.0 });
}

function updateUI() {
    DOM.hpText.innerText = state.health; DOM.manaText.innerText = Math.floor(state.mana); DOM.scoreText.innerText = state.score; DOM.enemyHpText.innerText = state.enemyHealth;
    DOM.hpFill.style.width = `${state.health}%`; DOM.manaFill.style.width = `${state.mana}%`; DOM.enemyHpFill.style.width = `${state.enemyHealth}%`;
}

function takeDamage(amt) {
    AudioFX.playHitPlayer();
    state.health = Math.max(0, state.health - amt); updateUI(); state.cameraShake = 0.4; DOM.damageOverlay.style.opacity = 1;
    setTimeout(() => DOM.damageOverlay.style.opacity = 0, 300);
    if (state.health <= 0) {
        state.isPlaying = false;
        AudioFX.playGameOver();
        DOM.loadingToast.innerText = `GAME OVER - SKOR: ${state.score}`;
        DOM.loadingToast.style.background = "#d63031";
        DOM.loadingToast.style.display = "block"; DOM.loadingToast.style.opacity = "1";
        setTimeout(() => location.reload(), 4000);
    }
}

// MEDIAPIPE HANDS ENGINE
const hands = new window.Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.55, minTrackingConfidence: 0.55 });

hands.onResults((results) => {
    trackingCtx.save(); trackingCtx.clearRect(0, 0, DOM.trackingCanvas.width, DOM.trackingCanvas.height);
    trackingCtx.drawImage(results.image, 0, 0, DOM.trackingCanvas.width, DOM.trackingCanvas.height);
    if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
            window.drawConnectors(trackingCtx, landmarks, window.HAND_CONNECTIONS, {color: '#0077ff', lineWidth: 2});
            window.drawLandmarks(trackingCtx, landmarks, {color: '#ff7675', lineWidth: 1, radius: 2});
        }
    }
    trackingCtx.restore();

    if (!state.isPlaying) return;
    state.shieldActive = false; state.isRecharging = false; state.leftHandTracked = false;

    const handCount = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
    if (handCount > 0) {
        DOM.trackingStatus.innerText = `[ ${handCount} TANGAN TERDETEKSI ]`;
        DOM.trackingStatus.style.background = "rgba(0, 150, 255, 0.1)"; DOM.trackingStatus.style.color = "#0077ff"; DOM.trackingStatus.style.borderColor = "rgba(0,119,255,0.3)";
    } else {
        DOM.trackingStatus.innerText = "MENCARI TANGAN...";
        DOM.trackingStatus.style.background = "rgba(255, 80, 80, 0.1)"; DOM.trackingStatus.style.color = "#d63031"; DOM.trackingStatus.style.borderColor = "rgba(255,80,80,0.3)";
    }

    if (results.multiHandLandmarks) {
        results.multiHandLandmarks.forEach((landmarks) => {
            const isRightSide = landmarks[0].x > 0.5; 
            const getDist = (p1, p2) => Math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2);
            const ndcX = -(landmarks[8].x * 2) + 1; const ndcY = -(landmarks[8].y * 2) + 1;
            const avgDist = (getDist(landmarks[8], landmarks[0]) + getDist(landmarks[12], landmarks[0]) + getDist(landmarks[16], landmarks[0]) + getDist(landmarks[20], landmarks[0])) / 4;

            if (isRightSide) {
                state.leftHandTracked = true;
                state.smoothedHands.left.x = THREE.MathUtils.lerp(state.smoothedHands.left.x, ndcX, 0.35);
                state.smoothedHands.left.y = THREE.MathUtils.lerp(state.smoothedHands.left.y, ndcY, 0.35);
                crosshair.position.x = state.smoothedHands.left.x * 1.5; crosshair.position.y = state.smoothedHands.left.y * 1.0;
                armL.position.x = -0.4 + (state.smoothedHands.left.x * 0.15); armL.position.y = -0.4 + (state.smoothedHands.left.y * 0.1);
                armL.rotation.y = state.smoothedHands.left.x * 0.3; armL.rotation.x = state.smoothedHands.left.y * -0.2;
                if (avgDist < 0.20) shootFireball(); 
            } else {
                state.smoothedHands.right.x = THREE.MathUtils.lerp(state.smoothedHands.right.x, ndcX, 0.35);
                state.smoothedHands.right.y = THREE.MathUtils.lerp(state.smoothedHands.right.y, ndcY, 0.35);
                armR.position.x = 0.4 + (state.smoothedHands.right.x * 0.15); armR.position.y = -0.4 + (state.smoothedHands.right.y * 0.1);
                armR.rotation.y = state.smoothedHands.right.x * 0.3; armR.rotation.x = state.smoothedHands.right.y * -0.2;
                if (avgDist > 0.36) state.shieldActive = true;       
                else if (avgDist < 0.20) state.isRecharging = true;  
            }
        });
    }
});

const mpCamera = new window.Camera(DOM.video, { onFrame: async () => { await hands.send({image: DOM.video}); }, width: 640, height: 480 });
mpCamera.start().then(() => { state.isCameraLoaded = true; checkAutoStart(); });

// HIGH PERFORMANCE GAME RENDERING LOOP
function renderLoop() {
    requestAnimationFrame(renderLoop);
    const now = performance.now(); const delta = clock.getDelta(); 

    updateTrajectoryLine();

    // Laser Beam FX Cleanup (Pembersihan memori otomatis)
    for (let i = spellBeams.length - 1; i >= 0; i--) {
        const b = spellBeams[i]; b.life -= 0.15;
        if (b.life <= 0) { 
            scene.remove(b.mesh); 
            spellBeams.splice(i, 1); 
        } else { 
            b.mesh.material.opacity = b.life; b.mesh.scale.x = b.life; b.mesh.scale.z = b.life; 
        }
    }

    // Animasi Rotasi Cincin Sihir
    handMagicRings.forEach(ringObj => { ringObj.mesh.rotation.z += ringObj.speed; ringObj.mesh.rotation.y = Math.sin(now * 0.002) * 0.2; });
    handCores.forEach(core => { core.rotation.y += 0.05; core.scale.lerp(_lerpScale, 0.1); });

    // Efek Melayang & Rotasi Lembut Arcane Orb
    arcaneOrbGroup.position.y = 1.0 + Math.sin(now * 0.002) * 0.05;
    coreOrb.rotation.y += 0.01;

    enemyGroup.position.z = THREE.MathUtils.lerp(enemyGroup.position.z, -10, 0.05);

    if (state.isPlaying) {
        shield.visible = state.shieldActive;
        if (state.shieldActive) shield.rotation.y += 0.08;
        
        if (state.isRecharging && state.mana < 100) { 
            state.mana = Math.min(100, state.mana + 1.2); 
            updateUI(); 
            if (now - state.lastChargeSoundTime > 120) {
                state.lastChargeSoundTime = now;
                AudioFX.playChargePulse();
            }
        }

        // Serangan Orb Musuh
        if (now - state.enemyLastAttack > 3000) {
            state.enemyLastAttack = now;
            const eBall = new THREE.Mesh(enemyBulletGeo, enemyBulletMat);
            eBall.position.copy(enemyGroup.position); eBall.position.y += 1.0; 
            _camPos.copy(camera.position); _camPos.y -= 0.2;
            _bulletDir.copy(_camPos).sub(eBall.position).normalize();
            projectiles.push({ mesh: eBall, dir: _bulletDir.clone(), speed: 0.18, isPlayer: false }); scene.add(eBall);
        }

        // Projectile Collision Matrix Loop
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i]; p.mesh.position.addScaledVector(p.dir, p.speed); p.mesh.rotation.x += 0.1; p.mesh.rotation.y += 0.1;
            if (!p.isPlayer && p.mesh.position.distanceTo(camera.position) < 2.5) {
                scene.remove(p.mesh); projectiles.splice(i, 1);
                if (state.shieldActive) { 
                    AudioFX.playShieldBlock();
                    createExplosion(p.mesh.position, 0x00ccff); state.score += 15; updateUI(); 
                } else { 
                    takeDamage(20); 
                }
                continue;
            }
            if (p.mesh.position.lengthSq() > 600) { scene.remove(p.mesh); projectiles.splice(i, 1); }
        }
    }

    // High Performance Particle Render & Disposal (RAM Anti Bocor)
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]; p.life -= 0.05;
        if (p.life <= 0) { 
            scene.remove(p.mesh); 
            p.mesh.geometry.dispose(); 
            p.mesh.material.dispose(); 
            particles.splice(i, 1); 
            continue; 
        }
        const pos = p.mesh.geometry.attributes.position.array;
        for(let j=0; j<pos.length/3; j++) { pos[j*3] += p.vel[j*3]; pos[j*3+1] += p.vel[j*3+1]; pos[j*3+2] += p.vel[j*3+2]; }
        p.mesh.geometry.attributes.position.needsUpdate = true; p.mesh.material.opacity = p.life;
    }

    // Camera Shake Matrix Optimization
    if (state.cameraShake > 0) { camera.position.x += (Math.random() - 0.5) * state.cameraShake; camera.position.y += (Math.random() - 0.5) * state.cameraShake; state.cameraShake *= 0.85; } 
    else { camera.position.x = 0; camera.position.y = 1.6; }

    renderer.render(scene, camera);
}

// Jalankan Engine Render Instan
renderLoop();

window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });