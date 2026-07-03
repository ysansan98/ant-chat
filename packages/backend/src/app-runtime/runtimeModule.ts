export interface RuntimeModule {
  initialize?: () => Promise<void> | void
  dispose?: () => Promise<void> | void
}
