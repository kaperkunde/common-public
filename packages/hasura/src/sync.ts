export {
  CONFIG_FILE,
  LOCK_FILE,
  planSync,
  readConfig,
  runSync,
  serializeLock,
  type AppConfig,
  type LockFile,
  type LockMigration,
  type LockPackage,
  type SyncOptions,
  type SyncPlan,
  type SyncResult,
} from "./sync/sync"
export {
  PackageError,
  loadPackage,
  resolvePackageDir,
  checkVarValue,
  resolveVars,
  type LoadedPackage,
  type MigrationTemplate,
  type PackageManifest,
  type VarSpec,
  type VarType,
} from "./sync/package"
export { STANDARD_VARS, TemplateError, renderTemplate } from "./sync/template"
