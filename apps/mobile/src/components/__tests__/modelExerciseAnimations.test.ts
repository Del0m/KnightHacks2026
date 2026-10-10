/** Exercise the shipped GLB and vendored Three.js rather than a mock skeleton. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const modelDirectory = path.resolve(__dirname, '../../../public/model');

test('all five skeletal previews stay finite, plant bodyweight limbs, and reset across transitions', () => {
  const result = execFileSync(process.execPath, ['--input-type=module', '-'], {
    input: `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';
      import { pathToFileURL } from 'node:url';
      const source = ${JSON.stringify(modelDirectory)};
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spotter-model-'));
      try {
        for (const file of ['three.core.js', 'three.module.js', 'BufferGeometryUtils.js', 'GLTFLoader.js', 'movement.js']) {
          const text = fs.readFileSync(path.join(source, file), 'utf8')
            .replaceAll("'three'", "'./three.module.mjs'")
            .replaceAll("'./three.core.js'", "'./three.core.mjs'")
            .replaceAll("'./BufferGeometryUtils.js'", "'./BufferGeometryUtils.mjs'");
          fs.writeFileSync(path.join(temp, file.replace('.js', '.mjs')), text);
        }
        const THREE = await import(pathToFileURL(path.join(temp, 'three.module.mjs')));
        const { GLTFLoader } = await import(pathToFileURL(path.join(temp, 'GLTFLoader.mjs')));
        const { createMovement } = await import(pathToFileURL(path.join(temp, 'movement.mjs')));
        const load = async file => {
          const buffer = fs.readFileSync(path.join(source, file));
          // Texture decoding requires a browser; geometry and bones remain the real assets.
          const loader = new GLTFLoader().register(() => ({ name: 'headless-textures', loadTexture: async () => new THREE.Texture() }));
          return (await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '')).scene;
        };
        const model = await load('rigged-human.glb');
        const movement = createMovement(model, await load('dumbbell.glb'));
        const rest = Object.fromEntries(Object.entries(movement.bones).map(([name, bone]) => [name, { q: bone.quaternion.clone(), p: bone.position.clone() }]));
        const position = name => movement.bones[name].getWorldPosition(new THREE.Vector3());
        for (const exercise of ['curl', 'squat', 'press', 'push_up', 'lunge']) {
          movement.select(exercise);
          assert.equal(movement.weights.length, 2);
          assert(movement.weights.every(weight => weight.visible === ['curl', 'press', 'lunge'].includes(exercise)));
          const roots = [], wrists = [];
          for (let frame = 0; frame < 300; frame++) {
            movement.update(1 / 60, false);
            for (const bone of Object.values(movement.bones)) {
              assert([...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.matrixWorld.elements].every(Number.isFinite), exercise + ': finite transforms');
              assert(Math.abs(bone.quaternion.length() - 1) < .00001, exercise + ': unit quaternion');
            }
            if (frame < 45) continue;
            roots.push(position('root').y);
            wrists.push(position('wrist.L').y);
            if (exercise === 'push_up') {
              for (const side of ['L', 'R']) {
                const hand = position('wrist.' + side), foot = position('foot.' + side), shoulder = position('upperarm01.' + side);
                assert(Math.abs(hand.y - .045) < .025, 'push-up hand stays on floor');
                assert(Math.abs(hand.z - .48) < .025, 'push-up hand stays beside chest');
                assert(Math.abs(foot.y - .075) < .025, 'push-up toes stay on floor');
                assert(shoulder.y > .15, 'push-up chest stays above floor');
                assert(shoulder.z - foot.z > 1.2, 'push-up body is prone');
              }
            }
            if (exercise === 'lunge') {
              for (const side of ['L', 'R']) {
                const arm = position('wrist.' + side).sub(position('upperarm01.' + side)).normalize();
                assert(arm.y < -.95, 'lunge arms hang down');
                assert(movement.weights.find(weight => weight.name.endsWith(side)).parent === movement.bones['wrist.' + side], 'lunge weights follow wrists');
                assert(movement.bones['finger3-2.' + side].quaternion.angleTo(rest['finger3-2.' + side].q) > .5, 'lunge fingers close around weights');
              }

              assert(position('foot.L').z - position('foot.R').z > .75, 'lunge has split stance');
              assert(Math.abs(position('foot.L').y - .075) < .035, 'lunge front foot stays planted');
              assert(Math.abs(position('foot.R').y - .075) < .035, 'lunge rear foot stays planted');
            }
          }
          const range = values => Math.max(...values) - Math.min(...values);
          assert(range(['curl', 'press'].includes(exercise) ? wrists : roots) > .12, exercise + ': visible rep motion');
          movement.pause();
          for (let frame = 0; frame < 120; frame++) movement.update(1 / 60, true);
          const paused = position('root').clone(), pausedHand = position('wrist.L').clone();
          for (let frame = 0; frame < 30; frame++) movement.update(1 / 60, true);
          assert(position('root').distanceTo(paused) < .0001, 'paused root stable');
          assert(position('wrist.L').distanceTo(pausedHand) < .0001, 'paused hand stable');
          movement.select(null);
          for (const [name, bone] of Object.entries(movement.bones)) {
            assert(bone.position.distanceTo(rest[name].p) < .000001, 'reset position');
            assert(1 - Math.abs(bone.quaternion.dot(rest[name].q)) < .000001, 'reset orientation');
          }
        }
        movement.select('unsupported');
        assert.equal(movement.playing, false);
        movement.update(1 / 60, false);
        console.log('five GLB previews verified');
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    `,
    encoding: 'utf8',
  });
  expect(result).toContain('five GLB previews verified');
});

test('renderer yaw rejects malformed input, bounds rotation, and preserves target and distance', () => {
  const html = readFileSync(path.join(modelDirectory, 'index.html'), 'utf8');
  const rotate = html.match(/function rotate\(degrees\)\{[\s\S]*?\n\}/)![0];
  const result = execFileSync(process.execPath, ['--input-type=module', '-'], {
    input: `
      import assert from 'node:assert/strict';
      const camera = { position: { clone: () => offset, copy() { return this; }, add() { return this; } } };
      const offset = { sub: () => offset, setFromSpherical: orbit => { last = { ...orbit }; return offset; } };
      const controls = { target: {}, update() {} };
      const THREE = { Spherical: class { setFromVector3() { this.radius = 3; this.phi = 1; this.theta = .2; return this; } }, MathUtils: { degToRad: d => d * Math.PI / 180, clamp: (d, min, max) => Math.max(min, Math.min(max, d)) } };
      let animation = { cameraCancelled: false }, rotationBase = .2, last = null;
      ${rotate}
      for (const invalid of [NaN, Infinity, -Infinity, '90', null, undefined]) rotate(invalid);
      assert.equal(last, null);
      assert.equal(animation.cameraCancelled, false);
      rotate(90);
      assert.equal(animation.cameraCancelled, true);
      assert.equal(last.theta, .2 + Math.PI / 2);
      assert.equal(last.radius, 3);
      assert.equal(last.phi, 1);
      rotate(500); assert.equal(last.theta, .2 + Math.PI);
      rotate(-500); assert.equal(last.theta, .2 - Math.PI);
      rotate(0); assert.equal(last.theta, .2);
      console.log('yaw verified');
    `,
    encoding: 'utf8',
  });
  expect(result).toContain('yaw verified');
  expect(html).toContain("if(data?.type==='spotter:rotate')rotate(data.degrees)");
});
