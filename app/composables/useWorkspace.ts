export function useWorkspace() {
  const { $workspace } = useNuxtApp()
  return $workspace
}
