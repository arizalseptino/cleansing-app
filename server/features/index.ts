import fillEmptyFromMasterText from './fill-empty-from-master-text'
import type { CleansingFeature } from './types'

const features: CleansingFeature[] = [fillEmptyFromMasterText]

export function listCleansingFeatures() {
  return features.map(({ preview: _preview, ...definition }) => definition)
}

export function findCleansingFeature(id: string) {
  return features.find((feature) => feature.id === id)
}
