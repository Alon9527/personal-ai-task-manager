import type { WorkspaceModel } from '../models/workspace-model'

declare module '#app' {
  interface NuxtApp {
    $workspace: WorkspaceModel
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $workspace: WorkspaceModel
  }
}

export {}
