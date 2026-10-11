# Continuous verification

`.github/workflows/ci.yml` runs on every push, pull request and manual dispatch. It verifies changes without deploying them or using production credentials.

## Checks

| Job | Checks | Runtime |
| --- | --- | --- |
| API | Typecheck, ESLint, all Vitest tests using in-memory PGlite and local HTTP sockets; installs RAG and mobile dependencies for integration imports | Ubuntu 24.04, Node 22, npm |
| Mobile | Typecheck, Expo lint, all Jest tests | Ubuntu 24.04, Node 22, pnpm version from `apps/mobile/package.json` |
| Contracts | Exercise validation, shared schema tests, all labelling tests | Ubuntu 24.04, Node 22 |
| Python | Export contract checks, real YOLO cloud pose inference, synthetic session and injury-risk model contracts | macOS 15, Python 3.11, locked uv dependencies |
| Spark | Bronze/silver/gold integration tests, session round trips and medal parity | Ubuntu 24.04, Java 21, Python 3.11 for both driver and workers |
| Swift | All PoseCore tests and Swift package compilation | macOS 15, runner-provided Swift/Xcode |

The six jobs run independently. `All checks passed` succeeds only when all six succeed; failed, skipped and cancelled jobs do not satisfy the gate. There are no path filters, so shared-code changes always receive the complete test run.

## Enable the merge gate

Commit and push the workflow together with the renamed source directories and lockfiles. After its first run, configure the default branch's GitHub ruleset or branch protection to require **All checks passed** before merging. Adding the workflow alone does not change repository branch-protection settings.

Manual runs are available under **Actions → SteadyForum CI → Run workflow** once the workflow is on the default branch. Individual jobs can also be rerun from a completed workflow run.

JUnit reports for API, contracts, Python and Spark; Jest JSON results; and the Swift log are saved as separate downloadable artifacts for seven days, including on test failure when a report was produced. Superseded runs on the same branch are cancelled.

## Dependency updates

API and RAG installs use `npm ci`; mobile uses `pnpm install --frozen-lockfile`; Python projects use `uv sync --locked`. Commit the corresponding lockfile whenever a dependency changes. The Spark project now includes `databricks/pipelines/uv.lock`.

GitHub Actions are pinned to immutable commits. Update the commit and adjacent version comment together when upgrading an action. Dependency caches speed up installation without reusing a project's installed `node_modules` or virtual environment.

The cloud pose tests download public YOLO model weights into a temporary directory and need outbound access to GitHub. They perform real CPU inference; no Hugging Face token or deployed endpoint is required. API tests use local Postgres emulation instead of Neon, and Spark tests use a local pipeline stand-in instead of a Databricks workspace.

## Decisions

Verification only was explicitly selected for this pipeline. Existing package managers and lockfiles are retained. Node 22 follows the repository's supported runtime; Java 21 and explicit Python worker paths prevent the runtime mismatches found during local testing. macOS jobs cover the Apple-native library and ML dependencies. The workflow uses a read-only repository token and does not persist checkout credentials.

These automated tests do not replace rebuilding and testing the complete iOS app on a device, or checking renamed resources against deployed services. Those rollout steps remain in `docs/runbooks/steadyforum-rename.md`.

Notebook model tests install pinned XGBoost 2.1.3, pandas and scikit-learn from the ML dev dependency group. Pose inference and notebook tests run in separate Python processes because the combined native ML runtimes crashed on macOS during validation. Both suites produce JUnit reports.
