// Expo config plugin: bundles the pose Core ML models into the iOS app.
//
// At `expo prebuild` it copies each .mlpackage into ios/<project>/Models/ and
// adds it to the app target's Sources build phase. Xcode then compiles it to
// <name>.mlmodelc in the main bundle, where PoseCore's ModelLocator finds it.
// The .mlpackage files are not committed; they come from `uv run export.py`.

const fs = require('fs');
const path = require('path');
const { withXcodeProject, IOSConfig } = require('expo/config-plugins');

const MODEL_NAMES = ['yolov8n-pose-320', 'yolov8n-pose-256'];

const DEFAULT_MODELS_DIR = '../../ml/pose_export/PoseBench/PoseBench/Models';

/**
 * Absolute paths of every model's .mlpackage in `modelsDir`, in MODEL_NAMES
 * order. Throws if any is missing, so prebuild stops before a broken build.
 */
function findModels(modelsDir) {
  const dir = path.resolve(modelsDir);
  const paths = MODEL_NAMES.map((name) => path.join(dir, `${name}.mlpackage`));
  const missing = paths.filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    throw new Error(
      `Pose models not found:\n${missing.map((p) => `  ${p}`).join('\n')}\n` +
        'Export them first: cd ml/pose_export && uv run export.py'
    );
  }
  return paths;
}

const withPoseModels = (config, props = {}) =>
  withXcodeProject(config, (cfg) => {
    const { projectRoot, platformProjectRoot } = cfg.modRequest;
    const modelsDir = path.resolve(projectRoot, props.modelsDir ?? DEFAULT_MODELS_DIR);
    const models = findModels(modelsDir);

    const project = cfg.modResults;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const target = IOSConfig.XcodeUtils.getApplicationNativeTarget({ project, projectName });
    const groupKey = project.findPBXGroupKey({ name: projectName });
    if (!groupKey) {
      throw new Error(`withPoseModels: Xcode group "${projectName}" not found`);
    }

    const destDir = path.join(platformProjectRoot, projectName, 'Models');
    fs.mkdirSync(destDir, { recursive: true });

    for (const src of models) {
      const base = path.basename(src);
      const dest = path.join(destDir, base);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true });

      // Same project-relative path style as the template's own files.
      const filepath = `${projectName}/Models/${base}`;
      if (project.hasFile(filepath)) continue;
      const file = project.addSourceFile(
        filepath,
        { target: target.uuid, lastKnownFileType: 'folder.mlpackage' },
        groupKey
      );
      // The xcode library writes unset fields as the literal `undefined`.
      const ref = project.pbxFileReferenceSection()[file.fileRef];
      for (const key of Object.keys(ref)) {
        if (ref[key] === undefined) delete ref[key];
      }
    }

    return cfg;
  });

module.exports = withPoseModels;
module.exports.findModels = findModels;
module.exports.MODEL_NAMES = MODEL_NAMES;
