# SteadyForum rename rollout

The repository uses `SteadyForum` for display text, `steadyforum` for service identifiers, and `STEADYFORUM` for environment variable prefixes. Deployment and device rebuilds are required to apply the technical rename.

- **API environment:** set `STEADYFORUM_PSEUDONYM_SECRET` to the existing HMAC secret value. Preserve that value to keep exported user pseudonyms stable. Update the Databricks volume path to `/Volumes/steadyforum/raw/sessions`.
- **Databricks:** provision the `steadyforum` catalog, `raw` and `ml` schemas, sessions volume, and secret scope; migrate existing data and secret values. Reconfigure the pipeline from `databricks/pipelines/steadyforum_sessions/pipeline.json` and publish the renamed model and job definitions. Preserve access permissions and verify session export, scoring, insight sync, and account deletion before switching production traffic.
- **Hugging Face:** make the models and manifest available under `bubblesmal/steadyforum-models` before shipping the mobile configuration. Update deployment references and access permissions.
- **Mobile:** reinstall dependencies so `steadyforum-pose` resolves to `modules/steadyforum-pose`. Regenerate the native project from `app.json` and rebuild with the `SteadyForum` target. Existing ignored Xcode projects and build caches retain their previous names until regenerated. Preserve duplicate project/workspace copies separately before regeneration; use only the primary project for builds.
- **Signing and links:** register `com.knighthacks.steadyforum` with the existing signing team and update auth redirect allowlists for `steadyforum://`. The new bundle identifier installs a separate app rather than updating the previous installation.
- **Device data:** renamed secure-storage and training-storage prefixes start new local state. Export any needed data from the previous installation first; sign in again after installing the rebuilt app.

No remote resource migration or device installation is performed by the repository rename.
