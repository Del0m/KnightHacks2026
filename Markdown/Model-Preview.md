# Rigged human workout preview

The approved browser model is now integrated into the Expo website's Train and Workout screens. The standalone demonstration remains available for inspecting the rig separately.

## Run

```sh
python3 -m http.server 8093 --bind 127.0.0.1 --directory Markdown/Previews/Rigged-Model
```

Open http://127.0.0.1:8093/. Under **Today’s workout plan:**, select Bicep curl, Squat, or Shoulder press to focus and play a slow four-second movement loop. Pause/resume freezes or continues the repetition. Select the active row again to clear the glow, return to the original pose, and zoom out. Drag to orbit; scroll or pinch to zoom. Reduced-motion preference stops shimmer, makes camera changes immediate, and starts exercise previews paused; Play movement explicitly enables the selected movement.

## User reference

Initial reference: a faceless retail display mannequin with a continuous human body, natural shoulders, restrained muscle definition, a smooth neutral pelvis, and no genital detail. The preview approximates that style with a relaxed A-pose rather than the reference's hands-on-hips pose.

## Asset provenance and edits

- [Official MakeHuman base mesh](https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/3dobjs/base.obj). The file explicitly declares the asset CC0 since September 2020, with Data Collection AB, Joel Palmius, and Jonas Hauquier credited.
- [Official body-shape targets](https://github.com/makehumancommunity/makehuman/tree/master/makehuman/data/targets/macrodetails). The masculine adult and average-muscle/weight targets shape the body.
- [MakeHuman asset license](https://static.makehumancommunity.org/about/license.html).

The previous anatomy mesh is replaced with this clean body base. The `body` and two eye groups are used; genital helper meshes and all remaining helpers are excluded. The original head, jaw, chin, neck, facial surface, and eye geometry are restored following the user’s correction; the oval replacement head has been removed. Standard Blender smoothing and subdivision give the body its retail finish. The preview uses a restrained silver material and studio reflections, with a soft emissive bicep-region overlay and low-amplitude travelling shimmer. No generative art is used. The glow illustrates a target region, not measured physical tension.

The sourced mesh, shape targets, skeleton, weights, reproducible `build_rig.py`, editable `rigged-human.blend`, and browser-ready `rigged-human.glb` are saved under `Previews/Rigged-Model/`. Three.js 0.180.0 and OrbitControls are used under MIT. Barlow uses the SIL Open Font License (see `Font-Licenses/Barlow.md`).

## Verified

- Full-body model with original face loads and renders with a continuous torso/pelvis.
- No genital helper geometry is included.
- Selecting the exercise focuses its upper-arm region and adds the red glow.
- A second click deselects, clears the glow, and resets framing.
- Requested list heading is present; Whole body list row is absent.
- Screenshots: `Previews/Model-Whole-Body.jpg` and `Previews/Model-Bicep-Focus.jpg`.

Web integration is verified. Native Expo uses a textual muscle-target fallback; physical-device 3D performance remains unverified.

## Interaction motion

- Camera target, orbit angle, and distance tween together with a quintic ease (900 ms focus, 720 ms reset). Rotation follows the shortest arc from the current view.
- The red glow fades in/out alongside camera movement and has a travelling sheen plus a gentle intensity wave.
- Workout list fades/rises into view once the model loads. Hover, press, selection colour/marker, and arrow direction transition gently. Status changes fade into place.
- Repeated clicks replace the active transition using the current camera/glow state. Manual orbit interrupts camera tweening while the glow fade can finish.
- Reduced-motion settings disable entrance/row motion, camera tweening, status animation, and shimmer.
- Browser verification: rapid select/deselect/select, final deselection, and console check passed with no errors.

## Skeleton and exercise movement

The 163-joint skeleton and skin weights come from the matching official MakeHuman [default rig](https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/rigs/default.mhskel) and [weights](https://github.com/makehumancommunity/makehuman/blob/master/makehuman/data/rigs/default_weights.mhw), both CC0. Subdivision interpolates those weights; glTF retains the strongest four influences per vertex. The original facial surface and excluded genital helpers are unchanged.

`movement.js` poses the actual skinned mesh using shoulder, elbow, hip, knee, ankle, and torso bones. Direction-based rotations avoid dependence on bone roll, with smooth pose transitions and four-second repetitions. Curls bend both elbows; controlled squats bend hips/knees and lower the pelvis to about parallel; shoulder presses raise both arms. Curls and presses now use dumbbells; squats remain bodyweight demonstrations. These are animated demonstrations rather than a recorded exercise-coaching sequence. Muscle-region glow follows joint positions on both sides of the body.

Run the retained check from the repository root:

```sh
node Markdown/Previews/Rigged-Model/check-rig.mjs
```

Verification: all three exercises move, pause without continuing repetition, and return to the original pose. Across 480 simulated frames per exercise, all joint matrices and sampled skinned vertex coordinates stay finite. Browser inspection checked each movement, selection/reset, pause/resume, and phone width at 390 × 844. Earlier missing-joint load errors were resolved by preserving the original glTF bone names; no new error appeared in the subsequent preview run. Expo/native integration remains a separate step.

## Full repetitions and grips

- Squat depth is limited to about parallel after feedback that the initial full-depth version dropped too far. Two-link leg calculations retain the original ankle positions and level soles. At the bottom, the hip joint is about 1.9 cm above the knee joint.
- Curls move from straight arms to roughly 135° of elbow flexion. Presses finish with near-straight elbows overhead.
- Forearm rotation is spread through both forearm bones, with separate wrist alignment, avoiding a sharp wrist-only twist. The source mesh also has a smooth 32% local wrist-width increase that tapers into the forearm and palm.
- Fingers wrap around the handles; the thumb opposes across the index/middle fingers. Each dumbbell is a child of the corresponding wrist joint with a fixed grip transform.
- Dumbbell: [CreativeTrio on Poly Pizza](https://poly.pizza/m/PW9q10xh5g), Public Domain / CC0. Source file: `Previews/Rigged-Model/dumbbell.glb`; normalized to 28 cm overall width. No generated artwork.
- `node Markdown/Previews/Rigged-Model/check-full-reps.mjs` checks the squat stop, planted ankles, full curl/press ranges, and fixed dumbbell attachments. Both retained rig checks pass after these changes.
